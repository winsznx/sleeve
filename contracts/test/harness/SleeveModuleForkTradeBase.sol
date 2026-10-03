// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";
import {SleeveModuleForkBase} from "./SleeveModuleForkBase.sol";

/// @notice Shared setup for the split and settle fork tests: the five allowlisted pools, accounts on the deployed Kernel
/// with a rule, the three triggers, and the checks every fill on a real pool must pass: each SPEC 13 field rebuilt
/// here from chain state, I1 to I4 and I8 by balance, and the lot.
abstract contract SleeveModuleForkTradeBase is SleeveModuleForkBase {
    uint256 internal constant PAYMENT = 1_000e6;
    uint256 internal constant EQUITY = 100e6;
    uint256 internal constant SPEND_PART = 900e6;
    uint32 internal constant CALENDAR_VERSION = 0x00010000;

    SleeveModule internal module;

    /// @notice One allowlisted pool and its ticker.
    struct Leg {
        string name;
        uint8 tickerId;
        address pool;
    }

    /// @notice What a fill changed, measured around the trigger.
    struct Measured {
        uint256 accountUsdgBefore;
        uint256 accountTokensBefore;
        uint256 poolUsdgBefore;
        uint256 poolTokensBefore;
        uint256 nextId;
    }

    function _setUpTrade() internal {
        _setUpTradeAt(IN_SESSION_BLOCK);
    }

    function _setUpTradeAt(uint256 blockNumber) internal {
        _setUpForkAt(blockNumber);
        module = _deployModule();
    }

    /// @notice The D-010 allowlist.
    function _legs() internal pure returns (Leg[5] memory legs) {
        legs[0] = Leg("SPY fee 500", SPY, LaunchConfig.SPY_POOL_500);
        legs[1] = Leg("QQQ fee 500", QQQ, LaunchConfig.QQQ_POOL_500);
        legs[2] = Leg("NVDA fee 500", NVDA, LaunchConfig.NVDA_POOL_500);
        legs[3] = Leg("AAPL fee 500", AAPL, LaunchConfig.AAPL_POOL_500);
        legs[4] = Leg("AAPL fee 3000", AAPL, LaunchConfig.AAPL_POOL_3000);
    }

    /// @notice A fresh account with the module and `rule` installed through a root UserOp, then paid PAYMENT.
    function _account(bytes32 salt, ISleeveModule.RuleInput memory rule) internal returns (address account) {
        account = _installedAccount(address(module), salt, 0, _installData(address(0), rule));
        _pay(account, PAYMENT);
    }

    // Triggers

    function _keeperSplit(address account, address pool, uint256 quote) internal returns (Vm.Log[] memory) {
        vm.recordLogs();
        vm.prank(keeper);
        module.split(account, pool, quote);
        return vm.getRecordedLogs();
    }

    function _keeperSettle(address account, uint8 tickerId, address pool, uint256 quote)
        internal
        returns (Vm.Log[] memory)
    {
        vm.recordLogs();
        vm.prank(keeper);
        module.settle(account, tickerId, pool, quote);
        return vm.getRecordedLogs();
    }

    /// @notice The owner's split in a bracketed owner op through handleOps.
    function _ownerSplit(address account, address pool, uint256 quote) internal returns (OpResult memory result) {
        result = _ownerOp(
            account,
            OwnerOps.single(
                address(module), address(module), abi.encodeCall(ISleeveModule.split, (account, pool, quote))
            )
        );
        assertTrue(result.success, "owner split UserOp");
    }

    function _onlyReceipt(Vm.Log[] memory logs) internal view returns (ISleeveModule.Receipt memory) {
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(logs, address(module));
        assertEq(receipts.length, 1, "one receipt");
        return receipts[0];
    }

    // Fill checks

    function _measure(address account, uint8 tickerId, address pool) internal view returns (Measured memory m) {
        (address token,) = _tokenOf(tickerId);
        m.accountUsdgBefore = USDG.balanceOf(account);
        m.accountTokensBefore = IERC20(token).balanceOf(account);
        m.poolUsdgBefore = USDG.balanceOf(pool);
        m.poolTokensBefore = IERC20(token).balanceOf(pool);
        m.nextId = module.nextReceiptId();
    }

    /// @notice A FILLED or SETTLED receipt on a real pool equals, field for field, the receipt rebuilt here from chain
    /// state and the balances measured around the trigger, and I1 to I4 and I8 hold.
    /// @param usdgIn PAYMENT for a split, zero for a settle.
    /// @param amount The equity part or the bucket.
    function _assertFill(
        ISleeveModule.Receipt memory receipt,
        address account,
        Leg memory leg,
        Measured memory m,
        Status status,
        Trigger trigger,
        uint256 usdgIn,
        uint256 amount,
        uint256 quote
    ) internal view {
        Fill memory fill = Fill({
            account: account,
            leg: leg,
            m: m,
            status: status,
            trigger: trigger,
            usdgIn: usdgIn,
            amount: amount,
            quote: quote,
            tokensOut: 0
        });
        fill.tokensOut = _assertFillBalances(fill);
        ISleeveModule.Receipt memory expected = _expectedFill(fill, receipt);
        assertEq(abi.encode(receipt), abi.encode(expected), string.concat(leg.name, ": every receipt field"));
        assertEq(module.receiptHash(receipt.id), keccak256(abi.encode(expected)), "stored hash");
        if (usdgIn != 0) {
            assertEq(receipt.usdgIn, receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued, "I2");
        }
        _assertI8(receipt, account);

        ISleeveModule.Lot memory lot = module.lot(receipt.id);
        assertEq(lot.account, account, "lot account");
        assertEq(lot.tickerId, leg.tickerId, "lot ticker");
        assertEq(uint8(lot.status), uint8(status), "lot status");
        assertEq(lot.tokensBought, fill.tokensOut, "lot tokens");
        assertEq(lot.tokensRemaining, fill.tokensOut, "lot remaining");
    }

    /// @dev One fill under check.
    struct Fill {
        address account;
        Leg leg;
        Measured m;
        Status status;
        Trigger trigger;
        uint256 usdgIn;
        uint256 amount;
        uint256 quote;
        uint256 tokensOut;
    }

    /// @dev I1, I3 and I4 by balance: exactly the amount left the account and reached the pool, the pool's tokens
    /// reached the account, the allowance is zero and the module holds nothing.
    function _assertFillBalances(Fill memory fill) private view returns (uint256 tokensOut) {
        (address token,) = _tokenOf(fill.leg.tickerId);
        string memory name = fill.leg.name;
        tokensOut = IERC20(token).balanceOf(fill.account) - fill.m.accountTokensBefore;
        assertGt(tokensOut, 0, string.concat(name, ": I3 tokens in the account"));
        assertEq(
            fill.m.accountUsdgBefore - USDG.balanceOf(fill.account), fill.amount, string.concat(name, ": I4 amount")
        );
        assertEq(USDG.balanceOf(fill.leg.pool) - fill.m.poolUsdgBefore, fill.amount, string.concat(name, ": I4 venue"));
        assertEq(fill.m.poolTokensBefore - IERC20(token).balanceOf(fill.leg.pool), tokensOut, "the pool paid them");
        assertEq(USDG.allowance(fill.account, Chain4663.SWAP_ROUTER_02), 0, string.concat(name, ": I4 allowance"));
        _assertHoldsNothingAtAll(address(module));
    }

    /// @dev The receipt rebuilt from chain state: token views, the feeds' latest rounds, the rule, the calendar and
    /// the measured fill. A settle's reason and queuedSince are the bucket's, read from the receipt.
    function _expectedFill(Fill memory fill, ISleeveModule.Receipt memory receipt)
        private
        view
        returns (ISleeveModule.Receipt memory expected)
    {
        (address token, address feed) = _tokenOf(fill.leg.tickerId);
        ISleeveModule.Rule memory rule = module.ruleOf(fill.account);
        expected.id = fill.m.nextId;
        expected.account = fill.account;
        expected.ruleVersion = rule.version;
        expected.trigger = fill.trigger;
        expected.status = fill.status;
        expected.mode = AccountingMode.WRAPPED;
        expected.tickerId = fill.leg.tickerId;
        expected.token = token;
        expected.tokenUid = IStockToken(token).uid();
        expected.usdgIn = fill.usdgIn;
        expected.usdgToSpend = fill.usdgIn == 0 ? 0 : fill.usdgIn - fill.amount;
        expected.usdgToEquity = fill.amount;
        expected.usdgSpent = fill.amount;
        expected.tokensOut = fill.tokensOut;
        expected.uiMultiplier = IStockToken(token).uiMultiplier();
        expected.execPrice = Math.ceilDiv(fill.amount * 1e18, fill.tokensOut);
        (expected.roundId, expected.answer,, expected.updatedAt,) = IAggregatorV3(feed).latestRoundData();
        (expected.usdgRoundId, expected.usdgAnswer,,,) = IAggregatorV3(Chain4663.USDG_USD_FEED).latestRoundData();
        uint256 value = fill.tokensOut * uint256(expected.answer);
        expected.premiumBps = int256(Math.ceilDiv(fill.amount * 1e20 * 10_000, value)) - 10_000;
        expected.quote = fill.quote;
        expected.minOut = fill.amount * fill.quote / 1e6 * (10_000 - rule.slippageBps) / 10_000;
        expected.venueId = 1;
        expected.pool = fill.leg.pool;
        expected.calendarVersion = calendar.version();
        expected.disclosureHash = DISCLOSURE_HASH;
        expected.l2Block = block.number;
        expected.timestamp = block.timestamp;
        expected.lotId = fill.m.nextId;
        if (fill.status == Status.SETTLED) {
            expected.reason = receipt.reason;
            expected.queuedSince = receipt.queuedSince;
        }
    }

    /// @notice I8 on a FILLED or SETTLED receipt: premium at most the cap, the round at most 25 hours old and from the
    /// open session, and the token's oracle not paused.
    function _assertI8(ISleeveModule.Receipt memory receipt, address account) internal view {
        assertLe(receipt.premiumBps, int256(uint256(module.ruleOf(account).premiumCapBps)), "I8: premium above cap");
        assertLe(block.timestamp - receipt.updatedAt, 25 hours, "I8: stale round");
        assertGe(receipt.updatedAt, module.sessionOpenedAt(receipt.tickerId), "I8: round from before the session");
        assertGt(module.sessionOpenedAt(receipt.tickerId), 0, "I8: session open");
        assertFalse(IStockToken(receipt.token).oraclePaused(), "I8: oracle paused");
        assertFalse(IStockToken(receipt.token).paused(), "I8: token paused");
    }

    /// @notice A QUEUED split receipt for the default payment, with the bucket it filled.
    function _assertQueued(ISleeveModule.Receipt memory receipt, address account, uint8 tickerId, Reason reason)
        internal
        view
    {
        assertEq(uint8(receipt.status), uint8(Status.QUEUED), "QUEUED");
        assertEq(uint8(receipt.reason), uint8(reason), "reason");
        assertEq(receipt.usdgIn, PAYMENT);
        assertEq(receipt.usdgToSpend, SPEND_PART);
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgQueued, EQUITY);
        assertEq(receipt.usdgSpent + receipt.tokensOut, 0, "nothing bought");
        assertEq(receipt.lotId, 0, "no lot");
        assertEq(receipt.usdgIn, receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued, "I2");
        ISleeveModule.Bucket memory bucket = module.bucketOf(account, tickerId);
        assertEq(bucket.amount, EQUITY, "bucket");
        assertEq(bucket.since, block.timestamp, "since");
        assertEq(uint8(bucket.reason), uint8(reason), "bucket reason");
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, PAYMENT, "the equity part stayed in the account");
        assertEq(spend, SPEND_PART);
        assertEq(pendingTotal, EQUITY);
        assertEq(unsorted, 0);
        _assertHoldsNothingAtAll(address(module));
    }
}
