// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {PriceGuardHarness} from "../mocks/PriceGuardHarness.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Audit round 1, the price guard: A1-10 after the fix (a round observed before the session opened is STALE
/// even when it was transmitted after, for buys and for sells), and A1-02 pinned as the known gap it is until the owner
/// decides on a halt (an unscheduled closure the timelock could not list in time leaves the held round looking live).
/// MockFeed reports startedAt equal to updatedAt, so the A1-10 cases mock latestRoundData with the two times apart, as
/// the OCR2 DualAggregators on chain 4663 report them (SPY round 147: startedAt 12 seconds before updatedAt).
contract AuditGuardTest is SleeveModuleSellUnitBase {
    /// @dev Sunday 4 October 2026 20:00 EDT, the ALL_DAY reopen after the weekend.
    uint256 private constant REOPEN = WEEK_OPENED_AT + 7 days;
    /// @dev Saturday 3 October 2026 12:00 EDT.
    uint256 private constant SATURDAY_NOON = REOPEN - 32 hours;
    uint80 private constant ROUND = 3;
    /// @dev Tuesday 6 October 2026 20:00 EDT: when Wednesday's ALL_DAY session would begin, and the addClosure
    /// deadline for Wednesday.
    uint256 private constant CLOSURE_START = REOPEN + 2 days;
    /// @dev Wednesday 7 October 2026 20:00 EDT.
    uint256 private constant CLOSURE_END = CLOSURE_START + 1 days;
    uint256 private constant CLOSED_DAY = CLOSURE_START / 1 days;
    /// @dev The feed's last round before the unlisted closure: Tuesday 19:59 EDT.
    uint256 private constant LAST_ROUND = CLOSURE_START - 1 minutes;

    function setUp() public {
        _setUpSell();
    }

    // A1-10

    /// A round observed at 19:59:55 and transmitted at 20:00:07 EDT carries the Friday answer: readStockFeed now calls
    /// it STALE and the keeper's settle at the reopen waits, where it used to buy on it.
    function test_A1_10_roundObservedBeforeTheReopenIsStale() public {
        MockAccount account = _queuedOverTheWeekend();
        _mockRound(REOPEN - 5, REOPEN + 7);
        vm.warp(REOPEN + 10);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 1 hours);
        assertEq(module.sessionOpenedAt(SPY), REOPEN);

        (Reason reason,,,) = new PriceGuardHarness().readStockFeed(IAggregatorV3(address(feeds[SPY])), 25 hours, REOPEN);
        assertEq(uint8(reason), uint8(Reason.STALE), "observed before the session opened");
        uint256 quote = _quote(PAYMENT / 10);
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.STALE));
        vm.prank(keeper);
        module.settle(address(account), SPY, pool, quote);
        assertEq(uint8(module.previewSettle(address(account), SPY).reason), uint8(Reason.STALE), "preview agrees");
    }

    /// A round observed and transmitted after the reopen still settles: the rule moves no honest round.
    function test_A1_10_roundObservedAfterTheReopenSettles() public {
        MockAccount account = _queuedOverTheWeekend();
        _mockRound(REOPEN + 28, REOPEN + 40);
        vm.warp(REOPEN + 60);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 1 hours);
        vm.recordLogs();
        _keeperSettle(address(account), SPY);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.SETTLED));
        assertEq(receipt.updatedAt, REOPEN + 40);
    }

    /// The sell mirrors the rule: without the override a round observed before the reopen makes the sell wait; with
    /// the override, which skips the session and age steps, the sell goes through.
    function test_A1_10_sellWaitsOnARoundObservedBeforeTheReopen() public {
        vm.warp(REOPEN - 3 days);
        _setMarket();
        (MockAccount account,) = _lotAccount(_defaultRule());
        _mockRound(REOPEN - 5, REOPEN + 7);
        vm.warp(REOPEN + 10);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 1 hours);
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE));
        args.overrideClosed = true;
        vm.recordLogs();
        _sell(account, args);
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.SOLD), "the override sells");
    }

    // A1-02: the known gap

    /// Pinned residual (MEDIUM, owner decision on a close-only guardian halt): a closure announced after its addClosure
    /// deadline cannot be listed, so on the closed Wednesday the calendar still says open since Sunday 20:00 and a
    /// keeper split buys against the 23-hour-old round held from before the closure, at the owner's cap. Only an
    /// issuer oraclePaused would queue it.
    function test_A1_02_residual_unlistedClosureBuysOnTheHeldRoundAtTheCap() public {
        vm.warp(CLOSURE_START + 1 hours);
        vm.expectRevert(
            abi.encodeWithSelector(SessionCalendarExtension.ClosureTooLate.selector, CLOSED_DAY, CLOSURE_START)
        );
        calendar.addClosure(CLOSED_DAY);

        feeds[SPY].setRound(2, FEED_ANSWER, LAST_ROUND);
        vm.warp(CLOSURE_END - 1 hours);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 1 hours);
        (bool open,, uint256 openedAt) = calendar.sessionState(block.timestamp, SessionCalendar.SessionType.ALL_DAY);
        assertTrue(open, "the calendar says the closed Wednesday trades");
        assertEq(openedAt, REOPEN, "the session counts from Sunday 20:00, before the held round");

        router.setPrice(Math.ceilDiv(FAIR_PRICE * 10_000, 10_100));
        venue.setBuyPrice(router.price());
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.FILLED), "bought while the market was closed");
        assertEq(receipt.updatedAt, LAST_ROUND, "priced against the round held from before the closure");
        assertEq(receipt.premiumBps, 100, "at the cap above the held price");
    }

    /// Contrast: the same closure listed before its deadline queues SESSION.
    function test_A1_02_closureListedBeforeTheDeadlineQueuesSession() public {
        vm.warp(CLOSURE_START - 1);
        calendar.addClosure(CLOSED_DAY);
        feeds[SPY].setRound(2, FEED_ANSWER, LAST_ROUND);
        vm.warp(CLOSURE_END - 1 hours);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 1 hours);
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(receipt.reason), uint8(Reason.SESSION));
    }

    // Helpers

    /// @dev A Saturday payment whose equity part waits in the SPY bucket with reason SESSION.
    function _queuedOverTheWeekend() private returns (MockAccount account) {
        vm.warp(SATURDAY_NOON);
        account = _account(_defaultRule(), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).reason), uint8(Reason.SESSION), "queued over the weekend");
    }

    /// @dev The SPY feed's latest round with separate observation and transmit times, carrying the Friday answer.
    function _mockRound(uint256 startedAt, uint256 updatedAt) private {
        vm.mockCall(
            address(feeds[SPY]),
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(ROUND, FEED_ANSWER, startedAt, updatedAt, ROUND)
        );
    }
}
