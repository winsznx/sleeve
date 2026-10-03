// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Audit round 1, the public-trigger clocks and the clip, after the fixes: A1-05 (a pending bucket's public
/// settle runs from its since and the session's opening only, so no split, observe or restart moves it), S-01 and
/// A1-05 (c) (previewSplit applies the split's own coverage rule), A1-25 (an outflow, a reconcile or an observe lowers
/// the observed level to the unsorted USDG left, so later income waits out its own grace) and A1-31 (a bucket the guard
/// refuses goes to spend at any size). The residual tests pin what stays by design until the owner decides otherwise:
/// the 1 USDG restart bound (A1-05 a) and the sub-clip bucket (A1-15).
contract AuditClockTest is SleeveModuleTradeUnitBase {
    uint256 private constant EQUITY = 50e6;
    uint256 private constant ONE_USDG = 1e6;
    uint256 private constant NEW_PAYMENT = 400e6;

    address private griefer = makeAddr("griefer");
    address private settler = makeAddr("settler");
    address private puller = makeAddr("old approval");

    function setUp() public {
        _setUpTrade();
    }

    // A1-05 (b): the settle clock

    /// A keeper's dust split and a public dust split each used to clear the observation a public settle needed, so a
    /// griefer could reset the settle clock every hour. Now previewSettle reports since plus the grace throughout and
    /// the public settle runs then.
    function test_A1_05b_settleReadinessIgnoresKeeperAndPublicDustSplits() public {
        MockAccount account = _queuedOnPause();
        uint256 since = module.bucketOf(address(account), SPY).since;
        assertEq(module.previewSettle(address(account), SPY).publicReadyAt, since + GRACE, "no observation needed");

        _pay(address(account), 1);
        vm.prank(griefer);
        uint64 observedAt = module.observe(address(account));
        vm.warp(uint256(observedAt) + GRACE - 1);
        _setMarket();
        _pay(address(account), 1);
        _keeperSplit(address(account));
        assertEq(module.previewSettle(address(account), SPY).publicReadyAt, since + GRACE, "a keeper dust split");

        _pay(address(account), 1);
        vm.prank(griefer);
        observedAt = module.observe(address(account));
        vm.warp(uint256(observedAt) + GRACE);
        _setMarket();
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.prank(griefer);
        module.split(address(account), pool, quote);
        assertEq(module.previewSettle(address(account), SPY).publicReadyAt, since + GRACE, "a public dust split");
        assertEq(uint8(_publicSettle(account).status), uint8(Status.SETTLED));
    }

    /// 1 USDG restarts of the split's clock no longer postpone a pending bucket's public settle.
    function test_A1_05a_settleReadinessIgnoresOneUsdgRestarts() public {
        MockAccount account = _queuedOnPause();
        uint256 since = module.bucketOf(address(account), SPY).since;
        for (uint256 i; i < 3; ++i) {
            vm.warp(block.timestamp + 30 minutes);
            _pay(address(account), ONE_USDG);
            vm.prank(griefer);
            module.observe(address(account));
        }
        vm.warp(since + 2 * GRACE);
        _setMarket();
        assertEq(uint8(_publicSettle(account).status), uint8(Status.SETTLED));
    }

    /// The keeper still has the first hour after a session opens: a bucket queued SESSION at 06:00 on QQQ's REGULAR
    /// session is open to a public settle at 09:30 plus the grace, and not a second sooner.
    function test_A1_05_keeperKeepsTheFirstHourAfterTheOpening() public {
        uint256 friday0600 = NOW - (4 hours + 44 minutes + 26);
        uint256 opening = friday0600 + 3 hours + 30 minutes;
        vm.warp(friday0600);
        _setMarket();
        MockAccount account = _account(_ruleOn(QQQ), PAYMENT);
        _keeperSplit(address(account));
        vm.warp(opening + GRACE - 1);
        _setMarket();
        uint256 quote = _quote(EQUITY);
        address pool = _pool(QQQ);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, opening + GRACE));
        vm.prank(settler);
        module.settle(address(account), QQQ, pool, quote);
        vm.warp(opening + GRACE);
        _setMarket();
        vm.prank(settler);
        module.settle(address(account), QQQ, pool, quote);
        assertEq(module.bucketOf(address(account), QQQ).amount, 0, "settled at the opening plus the grace");
    }

    // A1-05 (c) and S-01: previewSplit and the split agree

    /// 999,999 base units of growth ride the running observation in observe, the public split and previewSplit alike;
    /// 1 USDG of growth needs a new observation in all three. The preview used to report 0 for the first case while
    /// the public split ran.
    function test_S01_previewSplitAgreesWithThePublicSplitOnGrowthUnderOneUsdg() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        _pay(address(account), ONE_USDG - 1);
        assertEq(module.previewSplit(address(account)).publicReadyAt, uint256(observedAt) + GRACE, "covered");
        vm.prank(stranger);
        assertEq(module.observe(address(account)), observedAt, "observe keeps the clock");

        uint256 snapshot = vm.snapshotState();
        vm.warp(uint256(observedAt) + GRACE);
        _setMarket();
        ISleeveModule.Receipt memory receipt = _publicSplit(account);
        assertEq(receipt.usdgIn, PAYMENT + ONE_USDG - 1, "the public split ran when the preview said");
        vm.revertToState(snapshot);

        _pay(address(account), 1);
        assertEq(module.previewSplit(address(account)).publicReadyAt, 0, "1 USDG of growth needs a new observation");
    }

    // A1-25: the observed level follows unsorted down

    /// A bracketed owner outflow drains unsorted: the clock keeps running at a level of zero, so a payment 5 hours
    /// later waits out its own grace, where it used to be split publicly in the block it landed.
    function test_A1_25_ownerOutflowLowersTheObservedLevel() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, INSTALLED + PAYMENT));
        (uint64 stillAt, uint128 level) = module.observationOf(address(account));
        assertEq(stillAt, observedAt, "the clock keeps running");
        assertEq(level, 0, "lowered to what is left unsorted");
        _newPaymentWaitsItsOwnGrace(account, 5 hours);
    }

    /// The everyday path: the rule is paused, a payment is observed, the owner spends it from the app and resumes.
    function test_A1_25_pausedRuleSpentThenResumed_newPaymentWaits() public {
        MockAccount account = _account(_defaultRule(), 0);
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _pay(address(account), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, INSTALLED + PAYMENT));
        _ownerOp(account, OwnerOps.resumeRule(address(module)));
        _newPaymentWaitsItsOwnGrace(account, 3 hours);
    }

    /// A third party pulls through an old approval and the keeper's split reconciles: the level drops to zero.
    function test_A1_25_reconcileLowersTheObservedLevel() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        _pull(account, INSTALLED + PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.RECONCILED));
        (, uint128 level) = module.observationOf(address(account));
        assertEq(level, 0);
        _newPaymentWaitsItsOwnGrace(account, 5 hours);
    }

    /// A pull below unsorted reaches no module code (D-013): an observe call after it lowers the level, so income
    /// that arrives later is not covered by the older clock.
    function test_A1_25_observeLowersTheLevelAfterAnUnseenPull() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        _pull(account, 300e6);
        vm.prank(stranger);
        assertEq(module.observe(address(account)), observedAt, "the clock keeps running");
        (, uint128 level) = module.observationOf(address(account));
        assertEq(level, PAYMENT - 300e6, "lowered to the unsorted left");
        _newPaymentWaitsItsOwnGrace(account, 5 hours);
    }

    /// Residual, recorded under D-013's WRAPPED limit: with no module call between an unseen pull and new income, the
    /// module never learns unsorted shrank, so income up to the pulled amount rides the older clock.
    function test_A1_25_residual_unseenPullWithNoModuleCallInBetween() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        _pull(account, 300e6);
        vm.warp(block.timestamp + 5 hours);
        _setMarket();
        _pay(address(account), 300e6);
        ISleeveModule.Receipt memory receipt = _publicSplit(account);
        assertEq(receipt.usdgIn, PAYMENT, "300 USDG that arrived this block sorted on the 5-hour-old clock");
    }

    // A1-05 (a) residual: the documented bound

    /// Each restart costs the griefer 1 USDG, which lands with the owner as income; the public split runs once the
    /// restarts stop. Owner triggers and release are never affected.
    function test_A1_05a_residual_oneUsdgPerRestartPostponesThePublicSplit() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        uint256 balanceBefore = usdg.balanceOf(address(account));
        uint64 last;
        for (uint256 i; i < 6; ++i) {
            vm.warp(block.timestamp + 59 minutes);
            _setMarket();
            _pay(address(account), ONE_USDG);
            vm.prank(griefer);
            last = module.observe(address(account));
            assertEq(last, block.timestamp, "1 USDG of growth restarts the clock");
        }
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, uint256(last) + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
        assertEq(usdg.balanceOf(address(account)) - balanceBefore, 6 * ONE_USDG, "the grief paid the owner 6 USDG");

        vm.warp(uint256(last) + GRACE);
        _setMarket();
        assertEq(_publicSplit(account).usdgIn, PAYMENT + 6 * ONE_USDG, "once the restarts stop, the public split runs");
    }

    /// Residual and open owner question: with the keeper down, income of at least 1 USDG every 50 minutes restarts the
    /// clock with no griefer, so the public split stays shut (D-009 Q15 known limit). Keeping two observation slots
    /// would let a matured clock sort what it covers.
    function test_A1_05a_residual_hourlyIncomeKeepsThePublicSplitShutWhileTheKeeperIsDown() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        uint256 firstArrival = block.timestamp;
        vm.prank(settler);
        module.observe(address(account));
        for (uint256 i; i < 8; ++i) {
            vm.warp(block.timestamp + 50 minutes);
            _setMarket();
            _pay(address(account), 20e6);
            (address pool, uint256 quote) = _splitInputs(address(account));
            vm.expectPartialRevert(ISleeveModule.GracePeriodActive.selector);
            vm.prank(settler);
            module.split(address(account), pool, quote);
            vm.prank(settler);
            module.observe(address(account));
        }
        assertGt(block.timestamp - firstArrival, 6 hours);
        (,,, uint256 unsorted) = module.ledger(address(account));
        assertEq(unsorted, PAYMENT + 8 * 20e6, "nothing was sorted");
    }

    // A1-31: refusals at any size

    /// A removed ticker's 10 USDG bucket, under the 25 USDG clip, goes to spend as REFUSED_TICKER (D-009 Q24), where
    /// it used to revert BelowClip and stay pending.
    function test_A1_31_settleRefusesARemovedTickersBucketBelowTheClip() public {
        MockAccount account = _account(_ruleOn(NVDA), 100e6);
        _keeperSplit(address(account));
        assertEq(module.bucketOf(address(account), NVDA).amount, 10e6, "queued CLIP");
        tokenSource.removeTicker(NVDA);
        assertEq(uint8(module.previewSettle(address(account), NVDA).status), uint8(Status.REFUSED_TICKER));
        address pool = _pool(NVDA);
        vm.recordLogs();
        vm.prank(keeper);
        module.settle(address(account), NVDA, pool, 1);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.REFUSED_TICKER));
        assertEq(receipt.usdgToSpend, 10e6);
        (,, uint256 pendingTotal,) = module.ledger(address(account));
        assertEq(pendingTotal, 0);
    }

    /// A blocked account's bucket under the clip goes to spend as REFUSED_ACCOUNT; an empty bucket still reverts
    /// BelowClip, so settle never writes an empty refusal.
    function test_A1_31_settleRefusesABlockedAccountsBucketBelowTheClipAndStillRejectsAnEmptyOne() public {
        MockAccount account = _account(_defaultRule(), 100e6);
        _keeperSplit(address(account));
        registry.setBlocked(address(account), true);
        address pool = _pool(SPY);
        address qqqPool = _pool(QQQ);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 0, 25e6));
        vm.prank(keeper);
        module.settle(address(account), QQQ, qqqPool, 1);
        vm.recordLogs();
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, 1);
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.REFUSED_ACCOUNT));
    }

    // A1-15: open owner decision

    /// Pinned until the owner decides on merging (it would change how PRD I4 reads): under the default rule a 100 USDG
    /// payment queues 10 USDG CLIP, and later 1,000 USDG payments each fill their own 100 USDG and leave the bucket,
    /// which settle cannot buy under the clip. The owner moves it by release or by lowering the clip.
    function test_A1_15_open_subClipBucketWaitsWhileLaterPaymentsFillDirectly() public {
        MockAccount account = _account(_defaultRule(), 100e6);
        _keeperSplit(address(account));
        assertEq(module.bucketOf(address(account), SPY).amount, 10e6);
        for (uint256 i; i < 3; ++i) {
            vm.warp(block.timestamp + 1 hours);
            _setMarket();
            _pay(address(account), 1_000e6);
            vm.recordLogs();
            _keeperSplit(address(account));
            ISleeveModule.Receipt memory fill = _onlyReceipt(vm.getRecordedLogs());
            assertEq(uint8(fill.status), uint8(Status.FILLED));
            assertEq(fill.usdgSpent, 100e6, "each fill buys only its own equity part");
        }
        assertEq(module.bucketOf(address(account), SPY).amount, 10e6, "the bucket waits");
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 10e6, 25e6));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, 1);
        vm.prank(address(account));
        module.release(SPY);
        assertEq(module.bucketOf(address(account), SPY).amount, 0, "released to spend");
    }

    // Helpers

    function _queuedOnPause() private returns (MockAccount account) {
        account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        assertEq(module.bucketOf(address(account), SPY).amount, EQUITY);
    }

    function _publicSettle(MockAccount account) private returns (ISleeveModule.Receipt memory receipt) {
        uint256 quote = _quote(module.bucketOf(address(account), SPY).amount);
        address pool = _pool(SPY);
        vm.recordLogs();
        vm.prank(settler);
        module.settle(address(account), SPY, pool, quote);
        receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.trigger), uint8(Trigger.PUBLIC));
    }

    function _publicSplit(MockAccount account) private returns (ISleeveModule.Receipt memory receipt) {
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.recordLogs();
        vm.prank(stranger);
        module.split(address(account), pool, quote);
        receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.trigger), uint8(Trigger.PUBLIC));
    }

    /// @dev A payment `wait` after the observation: the public split must wait out a grace of its own.
    function _newPaymentWaitsItsOwnGrace(MockAccount account, uint256 wait) private {
        vm.warp(block.timestamp + wait);
        _setMarket();
        _pay(address(account), NEW_PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
    }

    /// @dev A pull through an approval the owner gave outside Sleeve.
    function _pull(MockAccount account, uint256 amount) private {
        vm.prank(address(account));
        assertTrue(IERC20(address(usdg)).approve(puller, amount));
        vm.prank(puller);
        assertTrue(IERC20(address(usdg)).transferFrom(address(account), puller, amount));
    }
}
