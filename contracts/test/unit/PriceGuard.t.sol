// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAccessControlsRegistry} from "../../src/interfaces/IAccessControlsRegistry.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {AccountingMode, GuardParams, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockRegistry} from "../mocks/MockRegistry.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {PriceGuardHarness} from "../mocks/PriceGuardHarness.sol";

/// @notice PriceGuard's guard steps against mocks: one test per failure reason and revert, every boundary, and the
/// PRD 7.4 order. The numbers are the live ones at fork block 78,312,136.
contract PriceGuardTest is Test {
    /// @dev Block 78,312,136: Friday 2 October 2026 10:44:26 EDT.
    uint256 private constant NOW = 1_790_952_266;
    /// @dev Sunday 27 September 2026 20:00 EDT, when the ALL_DAY session open at NOW began.
    uint256 private constant SESSION_OPENED_AT = 1_790_553_600;
    /// @dev Thursday 26 November 2026 20:00 EST: the ALL_DAY session reopens after the Thanksgiving closure.
    uint256 private constant THANKSGIVING_REOPEN = 1_795_741_200;
    SessionCalendar.SessionType private constant ALL_DAY = SessionCalendar.SessionType.ALL_DAY;
    int256 private constant SPY_ANSWER = 77_071_210_575;
    int256 private constant USDG_ANSWER = 100_001_038;
    uint256 private constant MAX_AGE = 25 hours;
    uint256 private constant WINDOW = 24 hours;
    uint16 private constant TOLERANCE = 50;
    /// @dev The four observed multiplier changes were scheduled 580 to 588 seconds ahead.
    uint256 private constant OBSERVED_LEAD = 584;
    uint256 private constant NEW_MULTIPLIER = 1_001_717_991_187_472_003;

    PriceGuardHarness private guard;
    MockRegistry private registry;
    MockStockToken private token;
    MockFeed private feed;
    MockFeed private usdgFeed;
    address private account = makeAddr("account");
    address private pool = makeAddr("pool");

    function setUp() public {
        vm.warp(NOW);
        guard = new PriceGuardHarness();
        registry = new MockRegistry();
        token = new MockStockToken("SPDR S&P 500 ETF Trust", "SPY", address(registry));
        feed = new MockFeed(8, "RHSPY / USD");
        usdgFeed = new MockFeed(8, "USDG / USD");
        feed.setRound(154, SPY_ANSWER, NOW - 2 hours);
        usdgFeed.setRound(119, USDG_ANSWER, NOW - 23 hours);
    }

    // Parameters

    function test_defaultGuardParams_areTheD014Values() public view {
        GuardParams memory params = guard.defaultGuardParams();
        assertEq(params.stockFeedMaxAge, 90_000, "stock feed max age");
        assertEq(params.usdgFeedMaxAge, 90_000, "USDG feed max age");
        assertEq(params.depegToleranceBps, 50, "depeg tolerance");
        assertEq(params.multiplierWindow, 86_400, "multiplier window");
    }

    // checkBuy

    function test_checkBuy_allClear_returnsNoneWithBothRounds() public view {
        PriceGuard.BuyCheck memory check = _checkBuy(true);
        assertFalse(check.accountBlocked);
        assertEq(uint8(check.reason), uint8(Reason.NONE));
        assertEq(check.roundId, 154);
        assertEq(check.answer, SPY_ANSWER);
        assertEq(check.updatedAt, NOW - 2 hours);
        assertEq(check.usdgRoundId, 119);
        assertEq(check.usdgAnswer, USDG_ANSWER);
    }

    function test_checkBuy_firstFailureWins_inPrdOrder() public {
        registry.setBlocked(account, true);
        token.setPaused(true);
        token.setOraclePaused(true);
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + OBSERVED_LEAD);
        feed.setAnswer(0);
        usdgFeed.setAnswer(98_000_000);

        PriceGuard.BuyCheck memory check = _checkBuy(false);
        assertTrue(check.accountBlocked, "step 2: account blocked");
        assertEq(uint8(check.reason), uint8(Reason.NONE), "REFUSED_ACCOUNT carries no reason");
        assertEq(check.roundId, 0, "no feed read after REFUSED_ACCOUNT");

        registry.setBlocked(account, false);
        _assertReason(_checkBuy(false), Reason.PAUSED, "step 3: paused");
        token.setPaused(false);
        _assertReason(_checkBuy(false), Reason.ORACLE_PAUSED, "step 3: oracle paused");
        token.setOraclePaused(false);
        _assertReason(_checkBuy(false), Reason.SESSION, "step 4: session");
        _assertReason(_checkBuy(true), Reason.MULTIPLIER, "step 5: multiplier");
        token.scheduleMultiplier(token.uiMultiplier(), NOW + OBSERVED_LEAD);
        _assertReason(_checkBuy(true), Reason.STALE, "step 6: stale");
        feed.setAnswer(SPY_ANSWER);
        _assertReason(_checkBuy(true), Reason.DEPEG, "step 7: depeg");
        usdgFeed.setAnswer(USDG_ANSWER);
        _assertReason(_checkBuy(true), Reason.NONE, "clear");
    }

    function test_checkBuy_blockedAccountWinsOverBlockedPool() public {
        registry.setBlocked(account, true);
        registry.setBlocked(pool, true);
        PriceGuard.BuyCheck memory check = _checkBuy(true);
        assertTrue(check.accountBlocked);
        assertEq(uint8(check.reason), uint8(Reason.NONE));
    }

    function test_checkBuy_blockedPool_revertsBeforeThePauseStep() public {
        registry.setBlocked(pool, true);
        token.setPaused(true);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PoolBlocked.selector, pool));
        _checkBuy(true);
    }

    function test_checkBuy_sessionClosed_readsNoFeed() public {
        feed.setDecimals(18);
        usdgFeed.setDecimals(18);
        PriceGuard.BuyCheck memory check = _checkBuy(false);
        assertEq(uint8(check.reason), uint8(Reason.SESSION));
        assertEq(check.roundId, 0);
        assertEq(check.usdgRoundId, 0);
    }

    function test_checkBuy_stale_returnsTheStockRoundOnly() public {
        feed.setUpdatedAt(NOW - MAX_AGE - 1);
        usdgFeed.setDecimals(18);
        PriceGuard.BuyCheck memory check = _checkBuy(true);
        assertEq(uint8(check.reason), uint8(Reason.STALE));
        assertEq(check.roundId, 154);
        assertEq(check.answer, SPY_ANSWER);
        assertEq(check.updatedAt, NOW - MAX_AGE - 1);
        assertEq(check.usdgRoundId, 0, "USDG feed not read");
    }

    /// @dev The gap B2-2 closes: after a 24-hour midweek closure the last round before it is still inside the age
    /// limit, so only the session-opening check refuses it.
    function test_checkBuy_roundHeldOverAMidweekClosure_isStale() public {
        vm.warp(THANKSGIVING_REOPEN + 30);
        assertEq(SessionCalendar.sessionOpenedAt(block.timestamp, ALL_DAY), THANKSGIVING_REOPEN, "calendar");
        usdgFeed.setUpdatedAt(block.timestamp - 1 hours);
        feed.setUpdatedAt(THANKSGIVING_REOPEN - 24 hours - 60);
        GuardParams memory params = PriceGuard.defaultGuardParams();
        PriceGuard.BuyCheck memory check =
            guard.checkBuy(token, feed, usdgFeed, account, pool, true, THANKSGIVING_REOPEN, params);
        _assertReason(check, Reason.STALE, "round held over the holiday");

        feed.setRound(155, SPY_ANSWER, THANKSGIVING_REOPEN + 20);
        check = guard.checkBuy(token, feed, usdgFeed, account, pool, true, THANKSGIVING_REOPEN, params);
        _assertReason(check, Reason.NONE, "first round after the reopen");
    }

    function test_checkBuy_depeg_returnsBothRounds() public {
        usdgFeed.setAnswer(99_000_000);
        PriceGuard.BuyCheck memory check = _checkBuy(true);
        assertEq(uint8(check.reason), uint8(Reason.DEPEG));
        assertEq(check.roundId, 154);
        assertEq(check.usdgRoundId, 119);
        assertEq(check.usdgAnswer, 99_000_000);
    }

    function test_checkBuy_appliesTheParamsGiven() public view {
        GuardParams memory params = PriceGuard.defaultGuardParams();
        params.stockFeedMaxAge = 1 hours;
        PriceGuard.BuyCheck memory check =
            guard.checkBuy(token, feed, usdgFeed, account, pool, true, SESSION_OPENED_AT, params);
        assertEq(uint8(check.reason), uint8(Reason.STALE), "two-hour-old round against a one-hour limit");

        params = PriceGuard.defaultGuardParams();
        params.usdgFeedMaxAge = 22 hours;
        check = guard.checkBuy(token, feed, usdgFeed, account, pool, true, SESSION_OPENED_AT, params);
        assertEq(uint8(check.reason), uint8(Reason.DEPEG), "23-hour-old USDG round against a 22-hour limit");
    }

    // checkToken: steps 2 and 3

    function test_checkToken_freshAccount_isClear() public view {
        (bool accountBlocked, Reason reason) = guard.checkToken(token, account, pool);
        assertFalse(accountBlocked);
        assertEq(uint8(reason), uint8(Reason.NONE));
    }

    function test_checkToken_blockedAccount_signalsRefusedAccount() public {
        registry.setBlocked(account, true);
        token.setPaused(true);
        (bool accountBlocked, Reason reason) = guard.checkToken(token, account, pool);
        assertTrue(accountBlocked);
        assertEq(uint8(reason), uint8(Reason.NONE), "the pause step does not run");
    }

    function test_checkToken_blockedPool_revertsPoolBlocked() public {
        registry.setBlocked(pool, true);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PoolBlocked.selector, pool));
        guard.checkToken(token, account, pool);
    }

    function test_checkToken_paused_givesPaused() public {
        token.setPaused(true);
        (bool accountBlocked, Reason reason) = guard.checkToken(token, account, pool);
        assertFalse(accountBlocked);
        assertEq(uint8(reason), uint8(Reason.PAUSED));
    }

    function test_checkToken_oraclePaused_givesOraclePaused() public {
        token.setOraclePaused(true);
        (, Reason reason) = guard.checkToken(token, account, pool);
        assertEq(uint8(reason), uint8(Reason.ORACLE_PAUSED));
    }

    function test_checkToken_pausedWinsOverOraclePaused() public {
        token.setPaused(true);
        token.setOraclePaused(true);
        (, Reason reason) = guard.checkToken(token, account, pool);
        assertEq(uint8(reason), uint8(Reason.PAUSED));
    }

    function test_checkToken_readsTheRegistryTheTokenNamesOnEveryCall() public {
        MockRegistry upgraded = new MockRegistry();
        upgraded.setBlocked(account, true);
        token.setRegistry(address(upgraded));
        (bool accountBlocked,) = guard.checkToken(token, account, pool);
        assertTrue(accountBlocked);
    }

    function test_checkToken_wrongDecimals_reverts() public {
        token.setDecimals(6);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.UnexpectedDecimals.selector, address(token), 6, 18));
        guard.checkToken(token, account, pool);
    }

    function test_checkToken_zeroToken_reverts() public {
        vm.expectRevert(PriceGuard.ZeroAddress.selector);
        guard.checkToken(IStockToken(address(0)), account, pool);
    }

    function test_checkToken_zeroRegistry_reverts() public {
        token.setRegistry(address(0));
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.NoRegistry.selector, address(token)));
        guard.checkToken(token, account, pool);
    }

    // checkMultiplier: step 5

    function test_checkMultiplier_neverScheduled_isNone() public view {
        assertEq(token.effectiveAt(), 0);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.NONE));
    }

    function test_checkMultiplier_observedTenMinuteLead_givesMultiplier() public {
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + OBSERVED_LEAD);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.MULTIPLIER));
    }

    function test_checkMultiplier_atTheWindowEdge_givesMultiplier() public {
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + WINDOW);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.MULTIPLIER));
    }

    function test_checkMultiplier_justOutsideTheWindow_isNone() public {
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + WINDOW + 1);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.NONE));
        vm.warp(NOW + 1);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.MULTIPLIER), "one second later");
    }

    function test_checkMultiplier_changeThatTookEffect_isNone() public {
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + OBSERVED_LEAD);
        vm.warp(NOW + OBSERVED_LEAD - 1);
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.MULTIPLIER), "last second before");
        vm.warp(NOW + OBSERVED_LEAD);
        assertEq(token.uiMultiplier(), NEW_MULTIPLIER, "the mock switched at effectiveAt");
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.NONE), "no after-clause");
    }

    function test_checkMultiplier_sameValueScheduled_isNone() public {
        token.scheduleMultiplier(1e18, NOW + OBSERVED_LEAD);
        assertEq(token.newUIMultiplier(), token.uiMultiplier());
        assertEq(uint8(guard.checkMultiplier(token, WINDOW)), uint8(Reason.NONE));
    }

    function test_checkMultiplier_zeroWindow_isNone() public {
        token.scheduleMultiplier(NEW_MULTIPLIER, NOW + 1);
        assertEq(uint8(guard.checkMultiplier(token, 0)), uint8(Reason.NONE));
    }

    function test_checkMultiplier_zeroToken_reverts() public {
        vm.expectRevert(PriceGuard.ZeroAddress.selector);
        guard.checkMultiplier(IStockToken(address(0)), WINDOW);
    }

    // readStockFeed: step 6

    function test_readStockFeed_freshRound_isNone_andReturnsTheRound() public view {
        (Reason reason, uint80 roundId, int256 answer, uint256 updatedAt) =
            guard.readStockFeed(feed, MAX_AGE, SESSION_OPENED_AT);
        assertEq(uint8(reason), uint8(Reason.NONE));
        assertEq(roundId, 154);
        assertEq(answer, SPY_ANSWER);
        assertEq(updatedAt, NOW - 2 hours);
    }

    function test_readStockFeed_zeroAnswer_isStale() public {
        feed.setAnswer(0);
        _assertFeedReason(Reason.STALE);
    }

    function test_readStockFeed_negativeAnswer_isStale() public {
        feed.setAnswer(-1);
        _assertFeedReason(Reason.STALE);
    }

    function test_readStockFeed_futureUpdatedAt_isStale() public {
        feed.setUpdatedAt(NOW + 1);
        _assertFeedReason(Reason.STALE);
    }

    function test_readStockFeed_ageOfExactly25Hours_isNone() public {
        vm.warp(SESSION_OPENED_AT + MAX_AGE + 2 hours);
        feed.setUpdatedAt(block.timestamp - MAX_AGE);
        _assertFeedReason(Reason.NONE);
    }

    function test_readStockFeed_ageJustAbove25Hours_isStale() public {
        vm.warp(SESSION_OPENED_AT + MAX_AGE + 2 hours);
        feed.setUpdatedAt(block.timestamp - MAX_AGE - 1);
        _assertFeedReason(Reason.STALE);
    }

    function test_readStockFeed_updatedAtBeforeSessionOpen_isStale() public {
        vm.warp(THANKSGIVING_REOPEN + 30);
        feed.setUpdatedAt(THANKSGIVING_REOPEN - 1);
        (Reason reason,,,) = guard.readStockFeed(feed, MAX_AGE, THANKSGIVING_REOPEN);
        assertEq(uint8(reason), uint8(Reason.STALE));
    }

    function test_readStockFeed_updatedAtEqualToSessionOpen_isNone() public {
        vm.warp(THANKSGIVING_REOPEN + 30);
        feed.setUpdatedAt(THANKSGIVING_REOPEN);
        (Reason reason,,,) = guard.readStockFeed(feed, MAX_AGE, THANKSGIVING_REOPEN);
        assertEq(uint8(reason), uint8(Reason.NONE));
    }

    function test_readStockFeed_noRoundYet_isStale() public {
        MockFeed empty = new MockFeed(8, "empty");
        (Reason reason,,,) = guard.readStockFeed(empty, MAX_AGE, SESSION_OPENED_AT);
        assertEq(uint8(reason), uint8(Reason.STALE));
    }

    function test_readStockFeed_wrongDecimals_reverts() public {
        feed.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.UnexpectedDecimals.selector, address(feed), 18, 8));
        guard.readStockFeed(feed, MAX_AGE, SESSION_OPENED_AT);
    }

    function test_readStockFeed_zeroFeed_reverts() public {
        vm.expectRevert(PriceGuard.ZeroAddress.selector);
        guard.readStockFeed(IAggregatorV3(address(0)), MAX_AGE, SESSION_OPENED_AT);
    }

    function testFuzz_readStockFeed_matchesTheRule(
        int256 answer,
        uint256 updatedAt,
        uint256 maxAge,
        uint256 sessionOpenedAt
    ) public {
        updatedAt = bound(updatedAt, 0, NOW + 30 days);
        maxAge = bound(maxAge, 0, 60 days);
        sessionOpenedAt = bound(sessionOpenedAt, 0, NOW);
        feed.setRound(7, answer, updatedAt);
        bool stale = answer <= 0 || updatedAt > NOW || NOW - updatedAt > maxAge || updatedAt < sessionOpenedAt;
        (Reason reason, uint80 roundId, int256 readAnswer, uint256 readUpdatedAt) =
            guard.readStockFeed(feed, maxAge, sessionOpenedAt);
        assertEq(uint8(reason), uint8(stale ? Reason.STALE : Reason.NONE));
        assertEq(roundId, 7);
        assertEq(readAnswer, answer);
        assertEq(readUpdatedAt, updatedAt);
    }

    // checkUsdg: step 7

    function test_checkUsdg_atOne_isNone_andReturnsTheRound() public {
        usdgFeed.setAnswer(1e8);
        (Reason reason, uint80 roundId, int256 answer) = guard.checkUsdg(usdgFeed, TOLERANCE, MAX_AGE);
        assertEq(uint8(reason), uint8(Reason.NONE));
        assertEq(roundId, 119);
        assertEq(answer, 1e8);
    }

    function test_checkUsdg_lowerEdge_isNone() public {
        usdgFeed.setAnswer(99_500_000);
        _assertUsdgReason(TOLERANCE, Reason.NONE);
    }

    function test_checkUsdg_oneUnitBelowTheLowerEdge_isDepeg() public {
        usdgFeed.setAnswer(99_499_999);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
    }

    function test_checkUsdg_upperEdge_isNone() public {
        usdgFeed.setAnswer(100_500_000);
        _assertUsdgReason(TOLERANCE, Reason.NONE);
    }

    function test_checkUsdg_oneUnitAboveTheUpperEdge_isDepeg() public {
        usdgFeed.setAnswer(100_500_001);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
    }

    function test_checkUsdg_roundOfExactlyMaxAge_isNone() public {
        usdgFeed.setUpdatedAt(NOW - MAX_AGE);
        _assertUsdgReason(TOLERANCE, Reason.NONE);
    }

    function test_checkUsdg_staleRound_isDepeg() public {
        usdgFeed.setUpdatedAt(NOW - MAX_AGE - 1);
        (Reason reason, uint80 roundId, int256 answer) = guard.checkUsdg(usdgFeed, TOLERANCE, MAX_AGE);
        assertEq(uint8(reason), uint8(Reason.DEPEG));
        assertEq(roundId, 119, "the round is returned whatever the verdict");
        assertEq(answer, USDG_ANSWER);
    }

    function test_checkUsdg_futureRound_isDepeg() public {
        usdgFeed.setUpdatedAt(NOW + 1);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
    }

    function test_checkUsdg_zeroOrNegativeAnswer_isDepeg() public {
        usdgFeed.setAnswer(0);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
        usdgFeed.setAnswer(-1e8);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
    }

    function test_checkUsdg_hugeAnswer_isDepegWithoutOverflow() public {
        usdgFeed.setAnswer(type(int256).max);
        _assertUsdgReason(TOLERANCE, Reason.DEPEG);
    }

    function test_checkUsdg_zeroTolerance_acceptsOnlyExactlyOne() public {
        usdgFeed.setAnswer(1e8);
        _assertUsdgReason(0, Reason.NONE);
        usdgFeed.setAnswer(1e8 + 1);
        _assertUsdgReason(0, Reason.DEPEG);
        usdgFeed.setAnswer(1e8 - 1);
        _assertUsdgReason(0, Reason.DEPEG);
    }

    function test_checkUsdg_fullTolerance_acceptsUpToTwo() public {
        usdgFeed.setAnswer(1);
        _assertUsdgReason(10_000, Reason.NONE);
        usdgFeed.setAnswer(2e8);
        _assertUsdgReason(10_000, Reason.NONE);
        usdgFeed.setAnswer(2e8 + 1);
        _assertUsdgReason(10_000, Reason.DEPEG);
    }

    function test_checkUsdg_toleranceAboveTotal_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.ToleranceAboveTotal.selector, 10_001));
        guard.checkUsdg(usdgFeed, 10_001, MAX_AGE);
    }

    function test_checkUsdg_wrongDecimals_reverts() public {
        usdgFeed.setDecimals(6);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.UnexpectedDecimals.selector, address(usdgFeed), 6, 8));
        guard.checkUsdg(usdgFeed, TOLERANCE, MAX_AGE);
    }

    function test_checkUsdg_zeroFeed_reverts() public {
        vm.expectRevert(PriceGuard.ZeroAddress.selector);
        guard.checkUsdg(IAggregatorV3(address(0)), TOLERANCE, MAX_AGE);
    }

    function testFuzz_checkUsdg_matchesTheBand(int256 answer, uint16 toleranceBps) public {
        answer = bound(answer, -1e9, 3e8);
        toleranceBps = uint16(bound(toleranceBps, 0, 10_000));
        usdgFeed.setAnswer(answer);
        bool inBand = answer > 0 && uint256(answer) * 10_000 >= 1e8 * (10_000 - uint256(toleranceBps))
            && uint256(answer) * 10_000 <= 1e8 * (10_000 + uint256(toleranceBps));
        _assertUsdgReason(toleranceBps, inBand ? Reason.NONE : Reason.DEPEG);
    }

    // Helpers

    function _checkBuy(bool sessionOpen) private view returns (PriceGuard.BuyCheck memory) {
        return guard.checkBuy(
            token, feed, usdgFeed, account, pool, sessionOpen, SESSION_OPENED_AT, PriceGuard.defaultGuardParams()
        );
    }

    function _assertReason(PriceGuard.BuyCheck memory check, Reason expected, string memory label) private pure {
        assertFalse(check.accountBlocked, label);
        assertEq(uint8(check.reason), uint8(expected), label);
    }

    function _assertFeedReason(Reason expected) private view {
        (Reason reason,,,) = guard.readStockFeed(feed, MAX_AGE, SESSION_OPENED_AT);
        assertEq(uint8(reason), uint8(expected));
    }

    function _assertUsdgReason(uint16 toleranceBps, Reason expected) private view {
        (Reason reason,,) = guard.checkUsdg(usdgFeed, toleranceBps, MAX_AGE);
        assertEq(uint8(reason), uint8(expected));
    }
}

/// @notice The enum numbering receipts carry. The keeper, the verifier and the app decode these values.
contract SleeveTypesTest is Test {
    function test_sleeveTypes_enumNumberingIsFixed() public pure {
        assertEq(uint8(Reason.NONE), 0);
        assertEq(uint8(Reason.PAUSED), 1);
        assertEq(uint8(Reason.ORACLE_PAUSED), 2);
        assertEq(uint8(Reason.SESSION), 3);
        assertEq(uint8(Reason.MULTIPLIER), 4);
        assertEq(uint8(Reason.STALE), 5);
        assertEq(uint8(Reason.DEPEG), 6);
        assertEq(uint8(Reason.CLIP), 7);
        assertEq(uint8(Reason.PREMIUM), 8);
        assertEq(uint8(type(Reason).max), 8);

        assertEq(uint8(Status.FILLED), 0);
        assertEq(uint8(Status.QUEUED), 1);
        assertEq(uint8(Status.SETTLED), 2);
        assertEq(uint8(Status.REFUSED_TICKER), 3);
        assertEq(uint8(Status.REFUSED_ACCOUNT), 4);
        assertEq(uint8(Status.RELEASED), 5);
        assertEq(uint8(Status.PART_SOLD), 6);
        assertEq(uint8(Status.SOLD), 7);
        assertEq(uint8(Status.RECONCILED), 8);
        assertEq(uint8(type(Status).max), 8);

        assertEq(uint8(Trigger.KEEPER), 0);
        assertEq(uint8(Trigger.OWNER), 1);
        assertEq(uint8(Trigger.PAYLINK), 2);
        assertEq(uint8(Trigger.PUBLIC), 3);
        assertEq(uint8(type(Trigger).max), 3);

        assertEq(uint8(AccountingMode.WRAPPED), 0);
        assertEq(uint8(type(AccountingMode).max), 0);
    }
}

/// @notice Every interface function against the selector docs/research/chain-constants.md and the deployed bytecode
/// record.
contract InterfaceSelectorsTest is Test {
    function test_interfaceSelectors_matchChainConstants() public pure {
        assertEq(IStockToken.paused.selector, bytes4(0x5c975abb), "paused()");
        assertEq(IStockToken.oraclePaused.selector, bytes4(0x7706ba52), "oraclePaused()");
        assertEq(IStockToken.uiMultiplier.selector, bytes4(0xa60bf13d), "uiMultiplier()");
        assertEq(IStockToken.newUIMultiplier.selector, bytes4(0xdc767007), "newUIMultiplier()");
        assertEq(IStockToken.effectiveAt.selector, bytes4(0x97a4064f), "effectiveAt()");
        assertEq(IStockToken.uid.selector, bytes4(0xf514ce36), "uid()");
        assertEq(IStockToken.ACCESS_CONTROLLED_REGISTRY.selector, bytes4(0x50c09be3), "ACCESS_CONTROLLED_REGISTRY()");
        assertEq(IStockToken.decimals.selector, bytes4(0x313ce567), "token decimals()");
        assertEq(IAccessControlsRegistry.isBlocked.selector, bytes4(0xfbac3951), "isBlocked(address)");
        assertEq(IAggregatorV3.decimals.selector, bytes4(0x313ce567), "feed decimals()");
        assertEq(IAggregatorV3.description.selector, bytes4(0x7284e416), "description()");
        assertEq(IAggregatorV3.getRoundData.selector, bytes4(0x9a6fc8f5), "getRoundData(uint80)");
        assertEq(IAggregatorV3.latestRoundData.selector, bytes4(0xfeaf968c), "latestRoundData()");
        assertEq(IUniswapV3Factory.getPool.selector, bytes4(0x1698ee82), "getPool(address,address,uint24)");
        assertEq(IUniswapV3Pool.token0.selector, bytes4(0x0dfe1681), "token0()");
        assertEq(IUniswapV3Pool.token1.selector, bytes4(0xd21220a7), "token1()");
        assertEq(IUniswapV3Pool.fee.selector, bytes4(0xddca3f43), "fee()");
        assertEq(ISwapRouter02.exactInputSingle.selector, bytes4(0x04e45aaf), "SwapRouter02 exactInputSingle");
        assertEq(IQuoterV2.quoteExactInputSingle.selector, bytes4(0xc6a5026a), "QuoterV2 quoteExactInputSingle");
    }
}
