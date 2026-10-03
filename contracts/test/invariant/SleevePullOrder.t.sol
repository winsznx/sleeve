// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {InvPool} from "../mocks/InvPool.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {SleeveInvariantBase} from "./SleeveInvariants.t.sol";

/// @notice The invariant suite's I6 and I4 counterexamples (audit I-01 and I-02) as fixed sequences, asserting the
/// fixed behavior: a third party drains more than spend through an old approval, then the owner tops up from another
/// wallet in a bracketed op. PRD 7.2 books an outflow spend first, then unsorted, then pending equity, so the drain
/// owes the rest by the bucket. endOwnerOp now reconciles the drain before it credits the top-up, so the owner's money
/// lands whole in spend (I6), and a settle waits for that reconcile, so it never pays for the part of the bucket the
/// drain took (I4).
/// @dev Account 1 of the suite's bootstrap: 50 percent to NVDA, 1 USDG clip, keeper2, no USDG at install. A 200 USDG
/// payment split while NVDA is paused leaves spend 100 and an NVDA bucket of 100. The drain takes 150: spend 100 and
/// 50 of the bucket.
contract SleevePullOrderTest is SleeveInvariantBase {
    bytes32 private constant BATCH = bytes32(uint256(1) << 248);
    uint8 private constant NVDA = 2;
    uint256 private constant PAYMENT = 200e6;
    uint256 private constant DRAIN = 150e6;
    uint256 private constant TOP_UP = 500e6;
    /// @dev What PRD 7.2's order leaves of the bucket after the drain.
    uint256 private constant BUCKET_LEFT = 50e6;

    address private account;
    address private nvdaPool;
    address private keeper2 = vm.addr(0xBEEF02);
    address private puller = makeAddr("old approval");
    UsdgPayer private wallet;

    function setUp() public {
        _deploy();
        account = handler.accountAt(1);
        nvdaPool = handler.poolAt(4);
        wallet = new UsdgPayer(IERC20(address(usdg)));
        usdg.mint(address(wallet), TOP_UP);

        usdg.mint(account, PAYMENT);
        tokens[NVDA].setPaused(true);
        _keeper(abi.encodeCall(ISleeveModule.split, (account, nvdaPool, _quote())));
        tokens[NVDA].setPaused(false);
        assertEq(module.bucketOf(account, NVDA).amount, PAYMENT / 2, "the NVDA bucket");

        _owner(_bracket(Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (puller, DRAIN)))));
        vm.prank(puller);
        assertTrue(usdg.transferFrom(account, puller, DRAIN), "drain");
    }

    /// I6: the top-up lands whole in spend once the drain is reconciled, and the drain comes out of the bucket.
    function test_I6_aTopUpAfterADrainLandsWholeInSpend() public {
        _owner(_bracket(Execution(address(wallet), 0, abi.encodeCall(UsdgPayer.payCaller, (TOP_UP)))));
        _keeper(abi.encodeCall(ISleeveModule.split, (account, nvdaPool, _quote())));

        (uint256 balance, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
        assertEq(balance, PAYMENT - DRAIN + TOP_UP, "balance");
        assertEq(module.bucketOf(account, NVDA).amount, BUCKET_LEFT, "I6: the drain came out of the bucket");
        assertEq(spend, TOP_UP, "I6: the whole top-up is spend");
        assertEq(spend + pendingTotal, balance, "ledgers reconciled");
    }

    /// I4: a settle in the top-up's own batch finds the drain unreconciled at the virtual balance and reverts
    /// LedgersAboveBalance, so the batch buys nothing with the owner's top-up.
    function test_I4_aSettleInTheTopUpBatchBuysOnlyWhatTheDrainLeft() public {
        Execution[] memory calls = new Execution[](4);
        calls[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[1] = Execution(address(wallet), 0, abi.encodeCall(UsdgPayer.payCaller, (TOP_UP)));
        calls[2] =
            Execution(address(module), 0, abi.encodeCall(ISleeveModule.settle, (account, NVDA, nvdaPool, _quote())));
        calls[3] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        vm.prank(address(handler));
        (bool ok, bytes memory reason) =
            account.call(abi.encodeCall(MockAccount.execute, (BATCH, ERC7579Utils.encodeBatch(calls))));

        assertFalse(ok, "the batch reverted");
        assertEq(
            reason,
            abi.encodeWithSelector(ISleeveModule.LedgersAboveBalance.selector, account, DRAIN),
            "the settle waits for the reconcile"
        );
        assertEq(module.bucketOf(account, NVDA).amount, PAYMENT / 2, "nothing bought, nothing booked");
    }

    /// I4: the keeper's settle after the top-up, before any split, buys exactly what the drain left of the bucket,
    /// because the top-up's bracket reconciled the drain first.
    function test_I4_aKeeperSettleAfterTheTopUpBuysOnlyWhatTheDrainLeft() public {
        _owner(_bracket(Execution(address(wallet), 0, abi.encodeCall(UsdgPayer.payCaller, (TOP_UP)))));
        assertEq(module.bucketOf(account, NVDA).amount, BUCKET_LEFT, "the reconcile cut the bucket");
        uint256 before = usdg.balanceOf(account);
        uint256 quote = _quote();
        vm.prank(keeper2);
        (bool ok,) = address(module).call(abi.encodeCall(ISleeveModule.settle, (account, NVDA, nvdaPool, quote)));

        assertTrue(ok, "the settle ran");
        assertEq(before - usdg.balanceOf(account), BUCKET_LEFT, "I4: it bought only what the drain left");
        (uint256 balance, uint256 spend,,) = module.ledger(account);
        assertEq(spend, TOP_UP, "I6: the whole top-up is still spend");
        assertEq(balance, spend, "the ledgers account for the balance");
    }

    function _quote() private view returns (uint256) {
        return 1e26 / InvPool(nvdaPool).priceE8() * 9_990 / 10_000;
    }

    function _keeper(bytes memory call) private {
        vm.prank(keeper2);
        (bool ok, bytes memory reason) = address(module).call(call);
        assertTrue(ok, string(reason));
    }

    function _bracket(Execution memory inner) private view returns (Execution[] memory calls) {
        calls = new Execution[](3);
        calls[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[1] = inner;
        calls[2] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
    }

    function _owner(Execution[] memory calls) private {
        vm.prank(address(handler));
        MockAccount(account).execute(BATCH, ERC7579Utils.encodeBatch(calls));
    }
}
