// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice settle, release, observe, the previews and sessionOpenedAt without a fork: the SETTLED receipt and lot, the
/// current rule's caps, GuardNotClear for every timing reason and the premium with nothing changed, the clip, the
/// refusals, the public grace from the latest of since, the session's opening and the observation, the owner's
/// bracket, release with the rule paused, and the observation clock.
contract SleeveModuleSettleTest is SleeveModuleTradeUnitBase {
    uint256 private constant EQUITY = 50e6;
    uint256 private constant SPEND_PART = 450e6;

    function setUp() public {
        _setUpTrade();
    }

    // SETTLED

    function test_settle_SETTLED_byKeeper_writesEveryFieldAndALot() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        uint256 tokensOut = router.quote(EQUITY);
        uint256 quote = _quote(EQUITY);
        vm.warp(block.timestamp + 5 minutes);

        address pool = _pool(SPY);
        vm.recordLogs();
        vm.prank(keeper);
        uint256 id = module.settle(address(account), SPY, pool, quote);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(id, 2, "after the QUEUED receipt");
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        assertEq(uint8(receipt.reason), uint8(Reason.PAUSED), "the bucket's reason");
        assertEq(uint8(receipt.trigger), uint8(Trigger.KEEPER));
        assertEq(receipt.ruleVersion, 1);
        assertEq(receipt.tickerId, SPY);
        assertEq(receipt.token, address(tokens[SPY]));
        assertEq(receipt.tokenUid, keccak256(abi.encode("uid", uint256(SPY))));
        assertEq(receipt.usdgIn, 0, "a settle sorts nothing new");
        assertEq(receipt.usdgToSpend, 0);
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgSpent, EQUITY);
        assertEq(receipt.usdgQueued, 0);
        assertEq(receipt.tokensOut, tokensOut);
        assertEq(receipt.uiMultiplier, 1e18);
        assertEq(receipt.execPrice, Math.ceilDiv(EQUITY * 1e18, tokensOut));
        assertEq(receipt.premiumBps, 0);
        assertEq(receipt.roundId, 1);
        assertEq(receipt.answer, FEED_ANSWER);
        assertEq(receipt.usdgRoundId, 1);
        assertEq(receipt.usdgAnswer, USDG_ANSWER);
        assertEq(receipt.quote, quote);
        assertEq(receipt.minOut, EQUITY * quote / 1e6 * 9_950 / 10_000);
        assertEq(receipt.venueId, 1);
        assertEq(receipt.pool, _pool(SPY));
        assertEq(receipt.lotId, id, "the lot takes the receipt id");
        assertEq(receipt.queuedSince, since);
        _assertModuleFields(receipt, address(account));
        ISleeveModule.Lot memory lot = module.lot(id);
        assertEq(uint8(lot.status), uint8(Status.SETTLED));
        assertEq(lot.tokensBought, tokensOut);
        assertEq(lot.tokensRemaining, tokensOut);
        assertEq(module.bucketOf(address(account), SPY).amount, 0, "bucket emptied");
        assertEq(module.bucketOf(address(account), SPY).since, 0, "bucket deleted");
        _assertLedger(address(account), INSTALLED + SPEND_PART, INSTALLED + SPEND_PART, 0, 0);
        assertEq(tokens[SPY].balanceOf(address(account)), tokensOut, "I3");
        assertEq(IERC20(address(usdg)).allowance(address(account), address(router)), 0, "I4");
        _assertI1();
    }

    /// D-009 Q24: a settle applies the current rule's caps and records the current rule version.
    function test_settle_appliesTheCurrentRulesCapsAndVersion() public {
        (MockAccount account,) = _queuedOnPause();
        ISleeveModule.RuleInput memory tighter = _defaultRule();
        tighter.premiumCapBps = 0;
        _ownerOp(account, OwnerOps.setRule(address(module), tighter));
        router.setPrice(FAIR_PRICE * 10_000 / 10_002);

        State memory before = _state(address(account));
        uint256 quote = _quote(EQUITY);
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PREMIUM));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, quote);
        _assertUnchanged(before, _state(address(account)));

        router.setPrice(FAIR_PRICE);
        vm.recordLogs();
        _keeperSettle(address(account), SPY);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        assertEq(receipt.ruleVersion, 2, "the current rule version");
        assertEq(receipt.premiumBps, 0, "inside the zero cap");
    }

    /// D-009 Q24: a bucket for a ticker the rule no longer names keeps waiting and settles on its own ticker.
    function test_settle_aBucketOffTheRulesTickerStillSettles() public {
        (MockAccount account,) = _queuedOnPause();
        _ownerOp(account, OwnerOps.setRule(address(module), _ruleOn(NVDA)));
        vm.recordLogs();
        _keeperSettle(address(account), SPY);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        assertEq(receipt.tickerId, SPY);
        assertEq(tokens[SPY].balanceOf(address(account)), receipt.tokensOut);
    }

    /// The owner's settle inside its bracket is the module's USDG delta, not the owner's.
    function test_settle_byOwnerInsideABracket_isTheModulesDelta() public {
        (MockAccount account,) = _queuedOnPause();
        uint256 quote = _quote(EQUITY);
        vm.recordLogs();
        _ownerOp(
            account,
            OwnerOps.single(
                address(module),
                address(module),
                abi.encodeCall(ISleeveModule.settle, (address(account), SPY, _pool(SPY), quote))
            )
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ISleeveModule.Receipt memory receipt = _onlyReceipt(logs);
        assertEq(uint8(receipt.trigger), uint8(Trigger.OWNER));
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ISleeveModule.OwnerOpEnded.selector) continue;
            (, int256 moduleDelta, int256 ownerDelta,,,) =
                abi.decode(logs[i].data, (uint256, int256, int256, uint256, uint256, uint256[]));
            assertEq(moduleDelta, -int256(EQUITY));
            assertEq(ownerDelta, 0);
        }
        _assertLedger(address(account), INSTALLED + SPEND_PART, INSTALLED + SPEND_PART, 0, 0);
    }

    // GuardNotClear and the clip, with nothing changed

    function test_settle_guardNotClear_PAUSED() public {
        (MockAccount account,) = _queuedOnPause();
        tokens[SPY].setPaused(true);
        _assertNotClear(account, Reason.PAUSED);
    }

    function test_settle_guardNotClear_ORACLE_PAUSED() public {
        (MockAccount account,) = _queuedOnPause();
        tokens[SPY].setOraclePaused(true);
        _assertNotClear(account, Reason.ORACLE_PAUSED);
    }

    function test_settle_guardNotClear_SESSION() public {
        (MockAccount account,) = _queuedOnPause();
        vm.warp(NOW + 1 days);
        _assertNotClear(account, Reason.SESSION);
    }

    function test_settle_guardNotClear_MULTIPLIER() public {
        (MockAccount account,) = _queuedOnPause();
        tokens[SPY].scheduleMultiplier(1.002e18, block.timestamp + 600);
        _assertNotClear(account, Reason.MULTIPLIER);
    }

    function test_settle_guardNotClear_STALE() public {
        (MockAccount account,) = _queuedOnPause();
        feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp - 25 hours - 1);
        _assertNotClear(account, Reason.STALE);
    }

    function test_settle_guardNotClear_DEPEG() public {
        (MockAccount account,) = _queuedOnPause();
        usdgUsdFeed.setRound(2, 1.006e8, block.timestamp - 10 minutes);
        _assertNotClear(account, Reason.DEPEG);
    }

    function test_settle_guardNotClear_PREMIUM() public {
        (MockAccount account,) = _queuedOnPause();
        router.setPrice(FAIR_PRICE * 10_000 / 10_200);
        _assertNotClear(account, Reason.PREMIUM);
    }

    function test_settle_belowTheCurrentRulesClip_reverts() public {
        (MockAccount account,) = _queuedOnPause();
        ISleeveModule.RuleInput memory bigger = _defaultRule();
        bigger.minClip = uint128(EQUITY + 1);
        _ownerOp(account, OwnerOps.setRule(address(module), bigger));
        _assertSettleReverts(account, SPY, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, EQUITY, EQUITY + 1));
        _assertSettleReverts(account, QQQ, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 0, EQUITY + 1));
    }

    function test_settle_otherReverts() public {
        (MockAccount account,) = _queuedOnPause();
        _assertSettleReverts(account, SPY, abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector), 0, _pool(SPY));
        _assertSettleReverts(
            account,
            SPY,
            abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, _pool(NVDA)),
            1,
            _pool(NVDA)
        );
        address pool = _pool(SPY);
        registry.setBlocked(pool, true);
        _assertSettleReverts(account, SPY, abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, pool));
        registry.setBlocked(pool, false);
        uint256 quote = _quote(EQUITY);
        uint256 minOut = EQUITY * quote * 2 / 1e6 * 9_950 / 10_000;
        _assertSettleReverts(
            account,
            SPY,
            abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, router.quote(EQUITY), minOut),
            quote * 2,
            pool
        );
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _assertSettleReverts(
            account, SPY, abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, address(account))
        );
    }

    // Refusals

    function test_settle_REFUSED_TICKER_sendsTheBucketToSpend() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        tokenSource.removeTicker(SPY);
        _assertSettleRefused(account, Status.REFUSED_TICKER, since);
    }

    function test_settle_REFUSED_ACCOUNT_sendsTheBucketToSpend() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        registry.setBlocked(address(account), true);
        _assertSettleRefused(account, Status.REFUSED_ACCOUNT, since);
    }

    // Public grace

    /// D-009 Q16 as amended by audit A1-05: a public settle waits for the grace after the later of the bucket's since
    /// and the session's opening. QQQ's REGULAR session opens 09:30, after the 06:00 queue. An observation neither
    /// helps nor hinders, and the settle leaves it for the split it serves.
    function test_settle_publicGraceRunsFromTheLaterOfSinceAndTheOpening() public {
        uint256 friday0600 = NOW - (4 hours + 44 minutes + 26);
        uint256 opening = friday0600 + 3 hours + 30 minutes;
        vm.warp(friday0600);
        _setMarket();
        MockAccount account = _account(_ruleOn(QQQ), PAYMENT);
        _keeperSplit(address(account));
        assertEq(uint8(module.bucketOf(address(account), QQQ).reason), uint8(Reason.SESSION), "closed at 06:00");
        vm.prank(stranger);
        module.observe(address(account));

        vm.warp(opening + 15 minutes);
        _setMarket();
        assertEq(module.sessionOpenedAt(QQQ), opening);
        uint256 quote = _quote(EQUITY);
        address pool = _pool(QQQ);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, opening + GRACE));
        vm.prank(stranger);
        module.settle(address(account), QQQ, pool, quote);
        assertEq(module.previewSettle(address(account), QQQ).publicReadyAt, opening + GRACE, "preview agrees");

        vm.warp(opening + GRACE);
        _setMarket();
        vm.recordLogs();
        vm.prank(stranger);
        module.settle(address(account), QQQ, pool, quote);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.PUBLIC));
        (uint64 observedAt,) = module.observationOf(address(account));
        assertGt(observedAt, 0, "a settle leaves the split's observation alone");
    }

    function test_settle_publicNeedsNoObservation() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        uint256 quote = _quote(EQUITY);
        address pool = _pool(SPY);
        vm.warp(uint256(since) + GRACE - 1);
        _setMarket();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, uint256(since) + GRACE));
        vm.prank(stranger);
        module.settle(address(account), SPY, pool, quote);
        vm.warp(uint256(since) + GRACE);
        _setMarket();
        vm.prank(stranger);
        module.settle(address(account), SPY, pool, quote);
        assertEq(module.bucketOf(address(account), SPY).amount, 0);
    }

    /// A bucket queued after the opening: its since sets the clock, and an observation plays no part (audit A1-05).
    function test_settle_publicGraceRunsFromSinceWhenTheBucketIsNewer() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        vm.warp(block.timestamp + 30 minutes);
        _setMarket();
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        uint256 since = module.bucketOf(address(account), SPY).since;
        vm.prank(stranger);
        module.observe(address(account));
        (uint64 observedAt,) = module.observationOf(address(account));
        assertEq(observedAt, since, "the split cleared the old clock, observe restarted it now");
        vm.warp(since + GRACE - 1);
        uint256 quote = _quote(EQUITY);
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, since + GRACE));
        vm.prank(stranger);
        module.settle(address(account), SPY, pool, quote);
    }

    function test_settle_keeperWhileTheOwnersBracketIsOpen_reverts() public {
        (MockAccount account,) = _queuedOnPause();
        uint256 quote = _quote(EQUITY);
        address pool = _pool(SPY);
        vm.prank(address(account));
        module.beginOwnerOp();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.OwnerOpOpen.selector, address(account)));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, quote);
    }

    // Release

    /// I11: the owner releases a whole bucket to spend with no guard, the rule paused and the token paused.
    function test_release_movesTheWholeBucketToSpendWithTheRuleAndTokenPaused() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        tokens[SPY].setPaused(true);
        _ownerOp(account, OwnerOps.pauseRule(address(module)));

        vm.recordLogs();
        _ownerOp(
            account, OwnerOps.single(address(module), address(module), abi.encodeCall(ISleeveModule.release, (SPY)))
        );
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.RELEASED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.OWNER));
        assertEq(uint8(receipt.reason), uint8(Reason.PAUSED));
        assertEq(receipt.usdgToSpend, EQUITY);
        assertEq(receipt.queuedSince, since);
        assertEq(receipt.ruleVersion, 1);
        assertEq(receipt.token, address(tokens[SPY]));
        assertEq(receipt.tokenUid, bytes32(0), "no token call");
        _assertModuleFields(receipt, address(account));
        _assertLedger(address(account), INSTALLED + PAYMENT, INSTALLED + PAYMENT, 0, 0);
        assertEq(module.bucketOf(address(account), SPY).since, 0, "bucket deleted");
        _assertI1();
    }

    function test_release_returnsTheReceiptId() public {
        (MockAccount account,) = _queuedOnPause();
        vm.prank(address(account));
        uint256 id = module.release(SPY);
        assertEq(id, 2);
        assertEq(module.nextReceiptId(), 3);
    }

    function test_release_emptyBucket_reverts() public {
        MockAccount account = _account(_defaultRule(), 0);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.EmptyBucket.selector, address(account), SPY));
        vm.prank(address(account));
        module.release(SPY);
    }

    function test_release_callerWithoutTheModule_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.release(SPY);
    }

    /// Part A, D-019: the internal release refuses an empty bucket too.
    function test_releaseBucket_emptyBucket_reverts() public {
        MockAccount account = _account(_defaultRule(), 0);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.EmptyBucket.selector, address(account), NVDA));
        module.releaseBucket(address(account), NVDA, Trigger.OWNER);
    }

    // Observe

    function test_observe_storesTheClockAndKeepsItUntilUnsortedGrows() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.expectEmit(address(module));
        emit ISleeveModule.Observed(address(account), uint64(block.timestamp), uint128(PAYMENT));
        vm.prank(stranger);
        assertEq(module.observe(address(account)), block.timestamp);
        uint256 first = block.timestamp;

        vm.warp(block.timestamp + 20 minutes);
        vm.recordLogs();
        vm.prank(stranger);
        assertEq(module.observe(address(account)), first, "unchanged while unsorted did not grow");
        assertEq(vm.getRecordedLogs().length, 0, "no event");

        _pay(address(account), 1e6 - 1);
        vm.prank(stranger);
        assertEq(module.observe(address(account)), first, "dust below 1 USDG keeps the clock");

        _pay(address(account), 1);
        vm.prank(stranger);
        assertEq(module.observe(address(account)), block.timestamp, "restarts when unsorted grows by 1 USDG");
        (uint64 observedAt, uint128 observedUnsorted) = module.observationOf(address(account));
        assertEq(observedAt, block.timestamp);
        assertEq(observedUnsorted, PAYMENT + 1e6);
    }

    function test_observe_aBucketAloneIsWorthObserving() public {
        (MockAccount account,) = _queuedOnPause();
        vm.prank(stranger);
        module.observe(address(account));
        (uint64 observedAt, uint128 observedUnsorted) = module.observationOf(address(account));
        assertEq(observedAt, block.timestamp);
        assertEq(observedUnsorted, 0);
    }

    function test_observe_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        module.observe(stranger);
        MockAccount account = _account(_defaultRule(), 0);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NothingWaiting.selector, address(account)));
        module.observe(address(account));
    }

    // Previews

    function test_previewSplit_matchesWhatSplitDoes() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        ISleeveModule.SplitPreview memory preview = module.previewSplit(address(account));
        assertEq(uint8(preview.ruleStatus), uint8(ISleeveModule.RuleStatus.ACTIVE));
        assertEq(preview.tickerId, SPY);
        assertEq(preview.shortfall, 0);
        assertEq(preview.unsorted, PAYMENT);
        assertEq(preview.spendPart, SPEND_PART);
        assertEq(preview.equityPart, EQUITY);
        assertEq(uint8(preview.status), uint8(Status.FILLED));
        assertTrue(preview.buy);
        assertEq(preview.publicReadyAt, 0, "no observation");

        vm.prank(stranger);
        module.observe(address(account));
        assertEq(module.previewSplit(address(account)).publicReadyAt, block.timestamp + GRACE);

        tokens[SPY].setOraclePaused(true);
        preview = module.previewSplit(address(account));
        assertEq(uint8(preview.status), uint8(Status.QUEUED));
        assertEq(uint8(preview.reason), uint8(Reason.ORACLE_PAUSED));
        assertFalse(preview.buy);
        tokens[SPY].setOraclePaused(false);

        registry.setBlocked(address(account), true);
        assertEq(uint8(module.previewSplit(address(account)).status), uint8(Status.REFUSED_ACCOUNT));
        registry.setBlocked(address(account), false);

        registry.setBlocked(_pool(SPY), true);
        assertTrue(module.previewSplit(address(account)).buy, "the preview leaves the pool to the trigger");
        registry.setBlocked(_pool(SPY), false);

        tokenSource.removeTicker(SPY);
        assertEq(uint8(module.previewSplit(address(account)).status), uint8(Status.REFUSED_TICKER));
    }

    function test_previewSplit_clipShortfallAndInactiveRule() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        MockAccount account = _account(rule, PAYMENT);
        ISleeveModule.SplitPreview memory preview = module.previewSplit(address(account));
        assertEq(uint8(preview.reason), uint8(Reason.CLIP));
        assertFalse(preview.buy);

        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        preview = module.previewSplit(address(account));
        assertEq(uint8(preview.ruleStatus), uint8(ISleeveModule.RuleStatus.PAUSED));
        assertFalse(preview.buy);
        assertEq(preview.unsorted, PAYMENT);

        assertEq(module.previewSplit(stranger).unsorted, 0, "not installed");
    }

    function test_previewSettle_matchesWhatSettleDoes() public {
        (MockAccount account, uint64 since) = _queuedOnPause();
        ISleeveModule.SettlePreview memory preview = module.previewSettle(address(account), SPY);
        assertEq(preview.amount, EQUITY);
        assertEq(preview.since, since);
        assertEq(uint8(preview.bucketReason), uint8(Reason.PAUSED));
        assertEq(preview.minClip, 25e6);
        assertEq(uint8(preview.status), uint8(Status.SETTLED));
        assertTrue(preview.buy);
        assertEq(preview.publicReadyAt, uint256(since) + GRACE, "since plus the grace, no observation needed");

        tokens[SPY].scheduleMultiplier(1.002e18, block.timestamp + 600);
        preview = module.previewSettle(address(account), SPY);
        assertEq(uint8(preview.status), uint8(Status.QUEUED));
        assertEq(uint8(preview.reason), uint8(Reason.MULTIPLIER), "settle would revert GuardNotClear(MULTIPLIER)");

        preview = module.previewSettle(address(account), QQQ);
        assertEq(uint8(preview.reason), uint8(Reason.CLIP), "an empty bucket is below the clip");
        assertFalse(preview.buy);
    }

    function test_sessionOpenedAt_isTheOpeningWhileOpenAndZeroWhileClosed() public {
        assertEq(module.sessionOpenedAt(SPY), WEEK_OPENED_AT);
        vm.warp(NOW + 1 days);
        assertEq(module.sessionOpenedAt(SPY), 0);
    }

    // Helpers

    /// @dev An account paid PAYMENT whose equity part queued PAUSED in the SPY bucket, with the token unpaused again.
    function _queuedOnPause() private returns (MockAccount account, uint64 since) {
        account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        since = module.bucketOf(address(account), SPY).since;
        assertEq(module.bucketOf(address(account), SPY).amount, EQUITY, "queued");
    }

    function _assertNotClear(MockAccount account, Reason reason) private {
        _assertSettleReverts(account, SPY, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, reason));
    }

    function _assertSettleReverts(MockAccount account, uint8 tickerId, bytes memory reason) private {
        uint256 amount = module.bucketOf(address(account), tickerId).amount;
        _assertSettleReverts(account, tickerId, reason, _quote(amount == 0 ? 1e6 : amount), _pool(tickerId));
    }

    function _assertSettleReverts(MockAccount account, uint8 tickerId, bytes memory reason, uint256 quote, address pool)
        private
    {
        State memory before = _state(address(account));
        vm.expectRevert(reason);
        vm.prank(keeper);
        module.settle(address(account), tickerId, pool, quote);
        _assertUnchanged(before, _state(address(account)));
        _assertI1();
    }

    function _assertSettleRefused(MockAccount account, Status status, uint64 since) private {
        address pool = _pool(SPY);
        vm.recordLogs();
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, 1);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(status));
        assertEq(uint8(receipt.reason), uint8(Reason.NONE));
        assertEq(receipt.usdgIn, 0);
        assertEq(receipt.usdgToSpend, EQUITY, "the bucket went to spend");
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgSpent, 0);
        assertEq(receipt.queuedSince, since);
        assertEq(receipt.venueId, 0, "no swap");
        assertEq(receipt.lotId, 0);
        _assertLedger(address(account), INSTALLED + PAYMENT, INSTALLED + PAYMENT, 0, 0);
        assertEq(router.swaps(), 0);
        _assertI1();
    }

    function _assertLedger(address account, uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
        private
        view
    {
        (uint256 actualBalance, uint256 actualSpend, uint256 actualPending, uint256 actualUnsorted) =
            module.ledger(account);
        assertEq(actualBalance, balance, "balance");
        assertEq(actualSpend, spend, "spend");
        assertEq(actualPending, pendingTotal, "pendingTotal");
        assertEq(actualUnsorted, unsorted, "unsorted");
    }
}
