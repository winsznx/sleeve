// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {TamperingAccount} from "../mocks/TamperingAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Reverts every call with whatever revert data it is armed with: code that runs inside an account's
/// executeFromExecutor, as an owner's executor hook does on Kernel v3.1.
contract ArmedReverter {
    bytes public data;

    function arm(bytes calldata data_) external {
        data = data_;
    }

    fallback() external {
        bytes memory reason = data;
        assembly ("memory-safe") {
            revert(add(reason, 0x20), mload(reason))
        }
    }
}

/// @notice Audit round 1, buy execution, after the fixes: A1-01 (a stray balance on the module blocks neither a split
/// nor a settle), A1-12 (the premium cap queues before the trigger's minimum reverts, PRD 7.4 steps 8 and 9), A1-19
/// (only the module's own premium check can make split queue PREMIUM) and A1-37 (a quote too large for the minOut
/// arithmetic reverts a named error). The proofs of concept on commit 6535108 are listed in docs/audit/AUDIT_R1.md.
contract AuditBuyExecTest is SleeveModuleTradeUnitBase {
    uint256 private constant EQUITY = 50e6;

    function setUp() public {
        _setUpTrade();
    }

    // A1-01

    /// One base unit of USDG and of SPY sent to the module blocks neither a split's buy nor a settle's, and no call
    /// moves them (I1 as a delta).
    function test_A1_01_strayBalancesOnTheModuleBlockNoSplitAndNoSettle() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        MockAccount queued = _account(_defaultRule(), 0);
        module.seedBucket(address(queued), SPY, uint128(EQUITY), Reason.SESSION);
        usdg.mint(address(queued), EQUITY);
        usdg.mint(address(module), 1);
        tokens[SPY].mint(address(module), 1);

        vm.recordLogs();
        _keeperSplit(address(account));
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.FILLED), "the split filled");
        vm.recordLogs();
        _keeperSettle(address(queued), SPY);
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.SETTLED), "the settle filled");

        assertEq(usdg.balanceOf(address(module)), 1, "the donated USDG is untouched");
        assertEq(tokens[SPY].balanceOf(address(module)), 1, "the donated SPY is untouched");
    }

    /// The delta still catches a buy that leaves tokens with the module, and the error carries the module's balance
    /// after the swap, donation included, as its NatSpec says.
    function test_A1_01_aLeakDuringTheBuyStillReverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].mint(address(module), 1);
        (address pool, uint256 quote) = _splitInputs(address(account));
        router.setLeak(address(module), 5);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.ModuleHoldsFunds.selector, address(tokens[SPY]), 6));
        vm.prank(keeper);
        module.split(address(account), pool, quote);
    }

    // A1-12

    /// The pool moved 150 bps after the keeper's quote, so both step 8 and step 9 fail: step 8 comes first and the
    /// equity part queues PREMIUM with a receipt, as PRD 7.4 orders, where the router's minimum used to revert.
    function test_A1_12_poolMovedAfterTheQuote_queuesPremium() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quoteBeforeTheMove) = _splitInputs(address(account));
        router.setPrice(FAIR_PRICE * 10_000 / 10_150);

        vm.recordLogs();
        vm.prank(keeper);
        module.split(address(account), pool, quoteBeforeTheMove);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(receipt.reason), uint8(Reason.PREMIUM));
        assertGt(receipt.premiumBps, 100, "above the cap");
        assertEq(module.bucketOf(address(account), SPY).amount, EQUITY, "the equity part waits");
        assertEq(tokens[SPY].balanceOf(address(account)), 0, "the swap was undone");
    }

    /// Step 9 alone still reverts with nothing moved, now with the module's named TooFewTokens.
    function test_A1_12_minimumOutAloneStillReverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        uint256 minOut = EQUITY * (quote * 2) / 1e6 * 9_950 / 10_000;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, router.quote(EQUITY), minOut));
        vm.prank(keeper);
        module.split(address(account), pool, quote * 2);
        assertEq(tokens[SPY].balanceOf(address(account)), 0, "nothing moved");
    }

    /// A settle with a quote from before the move waits on the premium, GuardNotClear(PREMIUM), instead of the
    /// router's string.
    function test_A1_12_settleWithAStaleQuoteWaitsOnThePremium() public {
        MockAccount account = _account(_defaultRule(), 0);
        module.seedBucket(address(account), SPY, uint128(EQUITY), Reason.SESSION);
        usdg.mint(address(account), EQUITY);
        address pool = _pool(SPY);
        uint256 quoteBeforeTheMove = _quote(EQUITY);
        router.setPrice(FAIR_PRICE * 10_000 / 10_150);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PREMIUM));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, quoteBeforeTheMove);
    }

    // A1-19

    /// Code inside the account's batch reverts with the PremiumAboveCap selector and a premium the guard never
    /// measured. The split reverts BatchReverted and writes no receipt, where it used to queue a forged PREMIUM.
    function test_A1_19_aForgedPremiumFromTheBatchRevertsTheSplit() public {
        (TamperingAccount account, ArmedReverter reverter) = _tampering();
        bytes memory forged = abi.encodeWithSelector(ISleeveModule.PremiumAboveCap.selector, int256(-4242));
        reverter.arm(forged);
        (address pool, uint256 quote) = _splitInputs(address(account));
        uint256 next = module.nextReceiptId();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BatchReverted.selector, forged));
        vm.prank(keeper);
        module.split(address(account), pool, quote);
        assertEq(module.nextReceiptId(), next, "no forged receipt");
        assertEq(module.bucketOf(address(account), SPY).amount, 0, "nothing queued");
    }

    /// A forged PremiumAboveCap from the batch on settle reverts BatchReverted too, never GuardNotClear(PREMIUM).
    function test_A1_19_aForgedPremiumOnSettleRevertsBatchReverted() public {
        (TamperingAccount account, ArmedReverter reverter) = _tampering();
        module.seedBucket(address(account), SPY, uint128(EQUITY), Reason.SESSION);
        usdg.mint(address(account), EQUITY);
        bytes memory forged = abi.encodeWithSelector(ISleeveModule.PremiumAboveCap.selector, int256(-4242));
        reverter.arm(forged);
        address pool = _pool(SPY);
        uint256 quote = _quote(EQUITY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BatchReverted.selector, forged));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, quote);
    }

    /// Every other revert from the batch still bubbles unchanged.
    function test_A1_19_otherBatchRevertsStillBubbleUnchanged() public {
        (TamperingAccount account, ArmedReverter reverter) = _tampering();
        bytes memory other = abi.encodeWithSignature("Error(string)", "hook says no");
        reverter.arm(other);
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(other);
        vm.prank(keeper);
        module.split(address(account), pool, quote);
    }

    /// The module's own premium check still queues PREMIUM.
    function test_A1_19_theRealPremiumStillQueues() public {
        router.setPrice(FAIR_PRICE * 10_000 / 10_150);
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.reason), uint8(Reason.PREMIUM));
        assertGt(receipt.premiumBps, 100);
    }

    /// Residual, in docs/audit/AUDIT_R1.md: a read executeBuy makes outside the batch can still raise the selector.
    /// Here the stock token's balanceOf(module) reverts PremiumAboveCap(7), standing in for a beacon upgrade. USDG,
    /// the Stock Token and the feed can already fake a fill through balanceOf, so screening each read adds nothing.
    function test_A1_19_residual_aReadInsideExecuteBuyCanStillRaiseIt() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.mockCallRevert(
            address(tokens[SPY]),
            abi.encodeCall(IERC20.balanceOf, (address(module))),
            abi.encodeWithSelector(ISleeveModule.PremiumAboveCap.selector, int256(7))
        );
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.reason), uint8(Reason.PREMIUM));
        assertEq(receipt.premiumBps, 7);
    }

    // A1-37

    /// The first quote whose product with the 50 USDG equity part overflows the minOut arithmetic, and the largest
    /// quote, revert QuoteTooLarge on split and settle where mulDiv used to panic; one below the edge reaches the
    /// module's minimum check.
    function test_A1_37_hugeQuoteRevertsQuoteTooLarge() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        address pool = _pool(SPY);
        uint256 firstOverflowing = type(uint256).max / 50 + 1;

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, firstOverflowing));
        vm.prank(keeper);
        module.split(address(account), pool, firstOverflowing);

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, type(uint256).max));
        vm.prank(keeper);
        module.split(address(account), pool, type(uint256).max);

        uint256 minOut = Math.mulDiv(50 * (firstOverflowing - 1), 9_950, 10_000);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, router.quote(EQUITY), minOut));
        vm.prank(keeper);
        module.split(address(account), pool, firstOverflowing - 1);

        MockAccount queued = _account(_defaultRule(), 0);
        module.seedBucket(address(queued), SPY, uint128(EQUITY), Reason.SESSION);
        usdg.mint(address(queued), EQUITY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, type(uint256).max));
        vm.prank(keeper);
        module.settle(address(queued), SPY, pool, type(uint256).max);
    }

    function _tampering() private returns (TamperingAccount account, ArmedReverter reverter) {
        account = new TamperingAccount();
        usdg.mint(address(account), INSTALLED);
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));
        _pay(address(account), PAYMENT);
        reverter = new ArmedReverter();
        account.setExtraCall(address(reverter), hex"01");
    }
}

/// @notice Audit A1-37 for sells: the owner's quote gets the same named error as a trigger's. A lot of 100 tokens
/// makes the edge reachable: tokenAmount * quote reaches 1e18 * 2^256 once the quote passes 2^256 / 100.
contract AuditSellQuoteTest is SleeveModuleSellUnitBase {
    uint256 private constant BIG_LOT = 1e6;
    uint256 private constant BIG_LOT_TOKENS = 100e18;

    function setUp() public {
        _setUpSell();
    }

    function test_A1_37_sell_hugeQuoteRevertsQuoteTooLarge() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        module.seedLot(BIG_LOT, address(account), SPY, Status.FILLED, BIG_LOT_TOKENS);
        tokens[SPY].mint(address(account), BIG_LOT_TOKENS);
        OwnerOps.SellArgs memory args = _args(SPY, BIG_LOT_TOKENS, BIG_LOT);
        uint256 firstOverflowing = type(uint256).max / 100 + 1;

        args.quote = firstOverflowing;
        _assertSellReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, firstOverflowing)
        );
        args.quote = type(uint256).max;
        _assertSellReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, type(uint256).max)
        );
    }
}
