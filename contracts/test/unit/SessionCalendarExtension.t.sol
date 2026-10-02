// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {console2} from "forge-std/console2.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {CalendarOracle} from "./SessionCalendar.t.sol";

/// @notice Tests for SessionCalendarExtension behind an OpenZeppelin TimelockController set up as D-009 Q33 sets the
/// production one: a 172,800-second delay, one address that proposes, executes and cancels, and no admin. Covers
/// timelock-only writes, year order, closures, early closes and switch replacements inside 2026 and 2027, the version
/// and the events, and the views for built-in, appended and uncovered years. The oracle tests replay
/// contracts/test/fixtures/calendar_vectors.json and calendar_extension_vectors.json, whose 2028 and in-range inputs
/// are test data, not reviewed production data.
contract SessionCalendarExtensionTest is CalendarOracle {
    uint256 private constant DELAY = 172_800;
    uint32 private constant BASE_VERSION = 0x0001_0000;
    uint256 private constant NOW = 1_790_953_062; // Fri 2026-10-02 14:57:42Z, when the research read the issuer API

    uint256 private constant COVERAGE_START = 1_767_243_600; // Thu 2026-01-01 00:00 EST
    uint256 private constant COVERAGE_END = 1_830_315_600; // Sat 2028-01-01 00:00 EST
    uint256 private constant END_OF_2028 = 1_861_938_000; // Mon 2029-01-01 00:00 EST
    uint256 private constant FIRST_DAY_OF_2028 = 21_184; // Sat 1 Jan 2028
    uint256 private constant FIRST_DAY_OF_2029 = 21_550; // Mon 1 Jan 2029
    uint64 private constant DAYLIGHT_START_2029 = 1_867_906_800; // Sun 2029-03-11 02:00 EST, 07:00Z
    uint64 private constant DAYLIGHT_END_2029 = 1_888_466_400; // Sun 2029-11-04 02:00 EDT, 06:00Z

    uint64 private constant DAYLIGHT_START_2026 = 1_772_953_200;
    uint64 private constant DAYLIGHT_END_2026 = 1_793_512_800;
    uint64 private constant DAYLIGHT_START_2027 = 1_805_007_600;
    uint64 private constant DAYLIGHT_END_2027 = 1_825_567_200;
    uint32 private constant EDT = 4 hours;
    uint32 private constant EST = 5 hours;

    // Wed 9 Dec 2026, a full trading day on EST in a normal week that opened Sun 6 Dec 20:00 EST.
    uint256 private constant WED_2026_12_09 = 20_796;
    uint256 private constant SUN_2026_12_06_2000 = 1_796_605_200;
    uint256 private constant TUE_2026_12_08_0930 = 1_796_740_200;
    uint256 private constant TUE_2026_12_08_1000 = 1_796_742_000;
    uint256 private constant TUE_2026_12_08_2000 = 1_796_778_000;
    uint256 private constant WED_2026_12_09_1200 = 1_796_835_600;
    uint256 private constant WED_2026_12_09_1300 = 1_796_839_200;
    uint256 private constant WED_2026_12_09_1600 = 1_796_850_000;
    uint256 private constant WED_2026_12_09_1700 = 1_796_853_600;
    uint256 private constant WED_2026_12_09_2000 = 1_796_864_400;
    uint256 private constant THU_2026_12_10_1000 = 1_796_914_800;

    // Fri 27 Nov 2026, the day after Thanksgiving, an early-close day.
    uint256 private constant FRI_2026_11_27 = 20_784;
    uint256 private constant THU_2026_11_26_2000 = 1_795_741_200;
    uint256 private constant FRI_2026_11_27_1200 = 1_795_798_800;
    uint256 private constant SUN_2026_11_29_2000 = 1_796_000_400;

    TimelockController private timelock;
    SessionCalendarExtension private calendar;
    address private deployer = makeAddr("deployer");
    address private stranger = makeAddr("stranger");
    uint256 private salt;

    struct YearInput {
        uint256 year;
        SessionCalendar.OffsetSwitch[] switches;
        uint256[] holidays;
        uint256[] earlyCloses;
    }

    function setUp() public {
        address[] memory deployerOnly = new address[](1);
        deployerOnly[0] = deployer;
        timelock = new TimelockController(DELAY, deployerOnly, deployerOnly, address(0));
        calendar = new SessionCalendarExtension(address(timelock));
    }

    function _calendarIsOpen(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        view
        override
        returns (bool, SessionCalendar.Reason)
    {
        return calendar.isOpenAt(timestamp, sessionType);
    }

    function _calendarSessionOpenedAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        view
        override
        returns (bool, uint256, bytes memory)
    {
        try calendar.sessionOpenedAt(timestamp, sessionType) returns (uint256 opening) {
            return (true, opening, "");
        } catch (bytes memory revertData) {
            return (false, 0, revertData);
        }
    }

    // Deploy

    function test_constructor_startsAtTheLibraryCoverage() public view {
        assertEq(calendar.timelock(), address(timelock), "timelock");
        assertEq(calendar.version(), BASE_VERSION, "library version 1, no writes");
        assertEq(calendar.writeCount(), 0, "no writes");
        assertEq(calendar.lastYear(), 2027, "last year");
        assertEq(calendar.endDay(), FIRST_DAY_OF_2028, "end day");
        assertEq(calendar.coverageStart(), COVERAGE_START, "coverage start");
        assertEq(calendar.coverageEnd(), COVERAGE_END, "coverage end");
        SessionCalendar.OffsetSwitch[] memory switches = calendar.offsetSwitches();
        SessionCalendar.OffsetSwitch[4] memory builtIn = SessionCalendar.builtInSwitches();
        assertEq(switches.length, builtIn.length, "seeded with the library's switches");
        for (uint256 i; i < builtIn.length; ++i) {
            assertEq(switches[i].at, builtIn[i].at, "switch instant");
            assertEq(switches[i].offset, builtIn[i].offset, "switch offset");
        }
    }

    function test_constructor_revertsWhenTimelockIsNotAContract() public {
        vm.expectRevert(abi.encodeWithSelector(SessionCalendarExtension.TimelockNotContract.selector, stranger));
        new SessionCalendarExtension(stranger);
        vm.expectRevert(abi.encodeWithSelector(SessionCalendarExtension.TimelockNotContract.selector, address(0)));
        new SessionCalendarExtension(address(0));
    }

    function test_timelockIsSetUpLikeProduction() public view {
        assertEq(timelock.getMinDelay(), DELAY, "48-hour minimum delay");
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), deployer), "deployer proposes");
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), deployer), "deployer executes");
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), deployer), "deployer cancels");
        assertFalse(timelock.hasRole(timelock.DEFAULT_ADMIN_ROLE(), deployer), "no admin");
        assertFalse(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0)), "execution is not open");
    }

    // Timelock-only writes

    function test_everyWriteRevertsForEveryCallerButTheTimelock() public {
        YearInput memory input = _input2028();
        address[3] memory callers = [stranger, deployer, address(this)];
        for (uint256 i; i < callers.length; ++i) {
            bytes memory notTimelock =
                abi.encodeWithSelector(SessionCalendarExtension.CallerNotTimelock.selector, callers[i]);
            vm.prank(callers[i]);
            vm.expectRevert(notTimelock);
            calendar.appendYear(input.year, input.switches, input.holidays, input.earlyCloses);
            vm.prank(callers[i]);
            vm.expectRevert(notTimelock);
            calendar.addClosure(WED_2026_12_09);
            vm.prank(callers[i]);
            vm.expectRevert(notTimelock);
            calendar.addEarlyClose(WED_2026_12_09);
            vm.prank(callers[i]);
            vm.expectRevert(notTimelock);
            calendar.replaceFutureSwitch(DAYLIGHT_END_2026, DAYLIGHT_END_2026, EDT);
        }
        assertEq(calendar.version(), BASE_VERSION, "nothing written");
    }

    function test_writeRunsOnlyOnceTheDelayHasPassed() public {
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09));
        vm.prank(deployer);
        timelock.schedule(address(calendar), 0, call, bytes32(0), bytes32(0), DELAY);
        bytes32 id = timelock.hashOperation(address(calendar), 0, call, bytes32(0), bytes32(0));
        bytes32 readyState = bytes32(2 ** uint256(TimelockController.OperationState.Ready));

        vm.warp(block.timestamp + DELAY - 1);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(TimelockController.TimelockUnexpectedOperationState.selector, id, readyState)
        );
        timelock.execute(address(calendar), 0, call, bytes32(0), bytes32(0));

        vm.warp(block.timestamp + 1);
        vm.prank(deployer);
        timelock.execute(address(calendar), 0, call, bytes32(0), bytes32(0));
        _assertDayKind(WED_2026_12_09, SessionCalendar.DayKind.HOLIDAY, "closed once ready");
    }

    function test_proposerCannotScheduleWithAShorterDelay() public {
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09));
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(TimelockController.TimelockInsufficientDelay.selector, DELAY - 1, DELAY));
        timelock.schedule(address(calendar), 0, call, bytes32(0), bytes32(0), DELAY - 1);
    }

    // appendYear

    function test_appendYear_2028_extendsCoverageByOneLeapYear() public {
        YearInput memory input = _input2028();
        _throughTimelock(_appendCall(input));
        assertEq(calendar.lastYear(), 2028, "last year");
        assertEq(calendar.endDay(), FIRST_DAY_OF_2029, "366 days later");
        assertEq(calendar.coverageEnd(), END_OF_2028, "Mon 2029-01-01 00:00 EST");
        string memory json = _readFixture(EXTENSION_FIXTURE);
        assertEq(calendar.coverageEnd(), vm.parseJsonUint(json, ".append2028.coverageEnd"), "oracle coverage end");
        _assertDayKind(21_200, SessionCalendar.DayKind.HOLIDAY, "Martin Luther King, Jr. Day 2028");
        _assertDayKind(21_368, SessionCalendar.DayKind.EARLY_CLOSE, "Mon 3 Jul 2028");
        _assertDayKind(21_512, SessionCalendar.DayKind.EARLY_CLOSE, "Fri 24 Nov 2028");
        _assertDayKind(21_185, SessionCalendar.DayKind.WEEKEND, "Sun 2 Jan 2028");
        _assertDayKind(21_186, SessionCalendar.DayKind.TRADING, "Mon 3 Jan 2028");
        _assertDayKind(FIRST_DAY_OF_2029, SessionCalendar.DayKind.UNKNOWN, "Mon 1 Jan 2029");
        SessionCalendar.OffsetSwitch[] memory switches = calendar.offsetSwitches();
        assertEq(switches.length, 6, "two switches appended");
        assertEq(switches[4].at, input.switches[0].at, "2028 start");
        assertEq(switches[4].offset, EDT, "to EDT");
        assertEq(switches[5].at, input.switches[1].at, "2028 end");
        assertEq(switches[5].offset, EST, "to EST");
    }

    function test_appendYear_emitsYearAppendedAndBumpsTheVersion() public {
        YearInput memory input = _input2028();
        bytes memory call = _appendCall(input);
        _schedule(call);
        vm.expectEmit(true, false, false, true, address(calendar));
        emit SessionCalendarExtension.YearAppended(
            2028, BASE_VERSION + 1, input.switches, input.holidays, input.earlyCloses
        );
        _execute(call);
        assertEq(calendar.version(), BASE_VERSION + 1, "after 2028");
        _throughTimelock(_appendCall(_input2029()));
        assertEq(calendar.version(), BASE_VERSION + 2, "after 2029");
        assertEq(calendar.lastYear(), 2029, "last year");
        assertEq(calendar.endDay(), FIRST_DAY_OF_2029 + 365, "2029 is not a leap year");
    }

    function test_appendYear_onlyTheYearAfterTheLastCoveredYear() public {
        YearInput memory input = _input2028();
        for (uint256 year = 2026; year <= 2027; ++year) {
            input.year = year;
            _expectAppendRevert(
                input, abi.encodeWithSelector(SessionCalendarExtension.YearNotNext.selector, year, 2028)
            );
        }
        _expectAppendRevert(
            _input2029(), abi.encodeWithSelector(SessionCalendarExtension.YearNotNext.selector, 2029, 2028)
        );
        _throughTimelock(_appendCall(_input2028()));
        _expectAppendRevert(
            _input2028(), abi.encodeWithSelector(SessionCalendarExtension.YearNotNext.selector, 2028, 2029)
        );
        assertEq(calendar.version(), BASE_VERSION + 1, "one append");
    }

    function test_appendYear_acceptsAYearWithNoHolidaysOrEarlyCloses() public {
        YearInput memory input = _input2028();
        input.holidays = new uint256[](0);
        input.earlyCloses = new uint256[](0);
        _throughTimelock(_appendCall(input));
        _assertIsOpenAt(1_846_339_200, ALL_DAY, true, OPEN, "Tue 2028-07-04 noon trades when not listed");
    }

    /// @dev Research Q5: a law that keeps one offset all year appends a year with no switches.
    function test_appendYear_acceptsAYearWithNoSwitches() public {
        YearInput memory input = _input2028();
        input.switches = new SessionCalendar.OffsetSwitch[](0);
        _throughTimelock(_appendCall(input));
        _assertIsOpenAt(1_846_800_000, ALL_DAY, false, WEEKEND, "Sun 2028-07-09 19:00 EST");
        _assertIsOpenAt(1_846_803_600, ALL_DAY, true, OPEN, "Sun 2028-07-09 20:00 EST, no daylight time");
        assertEq(calendar.offsetSwitches().length, 4, "no switch appended");
    }

    function test_appendYear_rejectsAnInvalidSwitch() public {
        uint64[6] memory wrong = [
            uint64(1_836_370_800), // Sat 2028-03-11 07:00Z
            1_836_460_800, // Sun 2028-03-12 08:00Z
            1_836_457_201, // Sun 2028-03-12 07:00:01Z
            1_829_804_400, // Sun 2027-12-26 07:00Z, before the year
            1_862_463_600, // Sun 2029-01-07 07:00Z, after the year
            DAYLIGHT_START_2027 // a switch already in the table
        ];
        for (uint256 i; i < wrong.length; ++i) {
            YearInput memory input = _input2028();
            input.switches[0].at = wrong[i];
            _expectAppendRevert(
                input, abi.encodeWithSelector(SessionCalendarExtension.InvalidSwitch.selector, wrong[i])
            );
        }
        YearInput memory reversed = _input2028();
        (reversed.switches[0], reversed.switches[1]) = (reversed.switches[1], reversed.switches[0]);
        reversed.switches[0].offset = EDT;
        reversed.switches[1].offset = EST;
        _expectAppendRevert(
            reversed,
            abi.encodeWithSelector(SessionCalendarExtension.InvalidSwitch.selector, _input2028().switches[0].at)
        );
        YearInput memory sameDay = _input2028();
        sameDay.switches[1] = SessionCalendar.OffsetSwitch(sameDay.switches[0].at - 1 hours, EST);
        _expectAppendRevert(
            sameDay, abi.encodeWithSelector(SessionCalendarExtension.InvalidSwitch.selector, sameDay.switches[1].at)
        );
    }

    function test_appendYear_rejectsAnOffsetThatIsNotFourOrFiveHoursOrDoesNotChange() public {
        uint32[4] memory wrong = [uint32(0), 3 hours, 6 hours, EST];
        for (uint256 i; i < wrong.length; ++i) {
            YearInput memory input = _input2028();
            input.switches[0].offset = wrong[i];
            _expectAppendRevert(
                input, abi.encodeWithSelector(SessionCalendarExtension.InvalidOffset.selector, wrong[i])
            );
        }
    }

    function test_appendYear_rejectsAnInvalidHoliday() public {
        uint256[2][5] memory cases = [
            [uint256(21_191), 21_200], // Sat 8 Jan 2028
            [uint256(21_183), 21_200], // Fri 31 Dec 2027, before the year
            [uint256(21_200), 21_550], // Mon 1 Jan 2029, after the year
            [uint256(21_235), 21_200], // 21 Feb then 17 Jan, descending
            [uint256(21_200), 21_200] // the same day twice
        ];
        uint256[5] memory rejected = [uint256(21_191), 21_183, 21_550, 21_200, 21_200];
        for (uint256 i; i < cases.length; ++i) {
            YearInput memory input = _input2028();
            input.holidays = new uint256[](2);
            input.holidays[0] = cases[i][0];
            input.holidays[1] = cases[i][1];
            _expectAppendRevert(
                input, abi.encodeWithSelector(SessionCalendarExtension.InvalidHoliday.selector, rejected[i])
            );
        }
    }

    function test_appendYear_rejectsAnInvalidEarlyClose() public {
        // Thanksgiving 2028, Sun 26 Nov 2028, Fri 31 Dec 2027 and Mon 1 Jan 2029.
        uint256[4] memory wrong = [uint256(21_511), 21_514, 21_183, 21_550];
        for (uint256 i; i < wrong.length; ++i) {
            YearInput memory input = _input2028();
            input.earlyCloses[0] = wrong[i];
            _expectAppendRevert(
                input, abi.encodeWithSelector(SessionCalendarExtension.InvalidEarlyClose.selector, wrong[i])
            );
        }
    }

    // addClosure: research Q6, a full-day closure inside any covered year, through the timelock.

    function test_addClosure_inside2026_closesTheViewWhereTheLibrarySaysOpen() public {
        _assertIsOpenAt(WED_2026_12_09_1200, ALL_DAY, true, OPEN, "trading before the closure");
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09));
        _schedule(call);
        vm.expectEmit(true, false, false, true, address(calendar));
        emit SessionCalendarExtension.ClosureAdded(WED_2026_12_09, SessionCalendar.DayKind.TRADING, BASE_VERSION + 1);
        _execute(call);

        assertEq(calendar.version(), BASE_VERSION + 1, "version bumped");
        _assertDayKind(WED_2026_12_09, SessionCalendar.DayKind.HOLIDAY, "closed day");
        _assertIsOpenAt(TUE_2026_12_08_2000 - 1, ALL_DAY, true, OPEN, "Tue 19:59:59 EST still open");
        assertEq(calendar.sessionOpenedAt(TUE_2026_12_08_2000 - 1, ALL_DAY), SUN_2026_12_06_2000, "week from Sunday");
        _assertIsOpenAt(TUE_2026_12_08_2000, ALL_DAY, false, HOLIDAY, "Tue 20:00 EST, the evening before");
        _assertIsOpenAt(WED_2026_12_09_1200, ALL_DAY, false, HOLIDAY, "Wed noon");
        _assertIsOpenAt(WED_2026_12_09_1200, REGULAR, false, HOLIDAY, "Wed noon, REGULAR");
        _assertIsOpenAt(WED_2026_12_09_2000 - 1, ALL_DAY, false, HOLIDAY, "Wed 19:59:59");
        _assertIsOpenAt(WED_2026_12_09_2000, ALL_DAY, true, OPEN, "Wed 20:00 reopens for Thursday");
        assertEq(calendar.sessionOpenedAt(THU_2026_12_10_1000, ALL_DAY), WED_2026_12_09_2000, "Thursday's session");
        (bool libraryOpen,) = SessionCalendar.isOpen(WED_2026_12_09_1200, ALL_DAY);
        assertTrue(libraryOpen, "the library alone still says open");
    }

    function test_addClosure_onAnEarlyCloseDay_makesItAHoliday() public {
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addClosure, (FRI_2026_11_27));
        _schedule(call);
        vm.expectEmit(true, false, false, true, address(calendar));
        emit SessionCalendarExtension.ClosureAdded(
            FRI_2026_11_27, SessionCalendar.DayKind.EARLY_CLOSE, BASE_VERSION + 1
        );
        _execute(call);
        _assertIsOpenAt(THU_2026_11_26_2000, ALL_DAY, false, HOLIDAY, "Thanksgiving evening no longer opens");
        _assertIsOpenAt(FRI_2026_11_27_1200, ALL_DAY, false, HOLIDAY, "Fri 2026-11-27 noon");
        _assertIsOpenAt(SUN_2026_11_29_2000 - 1, ALL_DAY, false, WEEKEND, "Sun 2026-11-29 19:59:59");
        _assertIsOpenAt(SUN_2026_11_29_2000, ALL_DAY, true, OPEN, "Sun 2026-11-29 20:00 still opens");
    }

    function test_addClosure_inAnAppendedYear() public {
        _throughTimelock(_appendCall(_input2028()));
        _throughTimelock(abi.encodeCall(SessionCalendarExtension.addClosure, (21_186))); // Mon 3 Jan 2028
        assertEq(calendar.version(), BASE_VERSION + 2, "year then closure");
        _assertIsOpenAt(1_830_474_000, ALL_DAY, false, HOLIDAY, "Sun 2028-01-02 20:00 EST");
        _assertIsOpenAt(1_830_531_600, ALL_DAY, false, HOLIDAY, "Mon 2028-01-03 noon EST");
        _assertIsOpenAt(1_830_560_400, ALL_DAY, true, OPEN, "Mon 2028-01-03 20:00 EST");
    }

    /// @dev Add-only and never on a day that is not trading: a weekend, a listed holiday, an added closure, and days
    /// outside coverage before and after.
    function test_addClosure_rejectsADayThatDoesNotTrade() public {
        _throughTimelock(abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09)));
        _expectClosureRevert(20_799, SessionCalendar.DayKind.WEEKEND); // Sat 12 Dec 2026
        _expectClosureRevert(20_812, SessionCalendar.DayKind.HOLIDAY); // Christmas Day 2026
        _expectClosureRevert(WED_2026_12_09, SessionCalendar.DayKind.HOLIDAY);
        _expectClosureRevert(20_453, SessionCalendar.DayKind.UNKNOWN); // Wed 31 Dec 2025
        _expectClosureRevert(21_186, SessionCalendar.DayKind.UNKNOWN); // Mon 3 Jan 2028, not appended
        _expectClosureRevert(0, SessionCalendar.DayKind.UNKNOWN);
        _expectClosureRevert(type(uint256).max, calendar.dayKind(type(uint256).max));
        assertEq(calendar.version(), BASE_VERSION + 1, "only the first closure");
    }

    function test_addClosure_refusedFrom2000EDTTheEveningBefore() public {
        uint256 deadline = WED_2026_12_09 * 1 days; // 00:00Z, Tue 19:00 EST, an hour before the evening session
        vm.warp(deadline);
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(SessionCalendarExtension.ClosureTooLate.selector, WED_2026_12_09, deadline)
        );
        calendar.addClosure(WED_2026_12_09);

        vm.warp(deadline - 1);
        vm.prank(address(timelock));
        calendar.addClosure(WED_2026_12_09);
        _assertDayKind(WED_2026_12_09, SessionCalendar.DayKind.HOLIDAY, "closed one second before the deadline");
    }

    function test_addClosure_throughTheTimelockMustBeScheduledTwoDaysAhead() public {
        uint256 deadline = WED_2026_12_09 * 1 days;
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09));
        vm.warp(deadline - DELAY);
        _schedule(call);
        vm.prank(deployer);
        vm.expectRevert(
            abi.encodeWithSelector(SessionCalendarExtension.ClosureTooLate.selector, WED_2026_12_09, deadline)
        );
        timelock.execute(address(calendar), 0, call, bytes32(0), bytes32(salt));
        assertEq(calendar.version(), BASE_VERSION, "a closure scheduled under 48 hours ahead never lands");
    }

    // addEarlyClose: an early close inside any covered year, through the timelock.

    function test_addEarlyClose_inside2026_shortensTheSession() public {
        bytes memory call = abi.encodeCall(SessionCalendarExtension.addEarlyClose, (WED_2026_12_09));
        _schedule(call);
        vm.expectEmit(true, false, false, true, address(calendar));
        emit SessionCalendarExtension.EarlyCloseAdded(WED_2026_12_09, BASE_VERSION + 1);
        _execute(call);

        assertEq(calendar.version(), BASE_VERSION + 1, "version bumped");
        _assertDayKind(WED_2026_12_09, SessionCalendar.DayKind.EARLY_CLOSE, "early-close day");
        _assertIsOpenAt(WED_2026_12_09_1700 - 1, ALL_DAY, true, OPEN, "ALL_DAY 16:59:59 EST");
        assertEq(calendar.sessionOpenedAt(WED_2026_12_09_1700 - 1, ALL_DAY), SUN_2026_12_06_2000, "week from Sunday");
        _assertIsOpenAt(WED_2026_12_09_1700, ALL_DAY, false, EARLY_CLOSE, "ALL_DAY 17:00 EST");
        _assertIsOpenAt(WED_2026_12_09_2000 - 1, ALL_DAY, false, EARLY_CLOSE, "ALL_DAY 19:59:59 EST");
        _assertIsOpenAt(WED_2026_12_09_2000, ALL_DAY, true, OPEN, "ALL_DAY 20:00 EST opens Thursday's session");
        assertEq(calendar.sessionOpenedAt(THU_2026_12_10_1000, ALL_DAY), WED_2026_12_09_2000, "a new stretch");
        _assertIsOpenAt(WED_2026_12_09_1300 - 1, REGULAR, true, OPEN, "REGULAR 12:59:59 EST");
        _assertIsOpenAt(WED_2026_12_09_1300, REGULAR, false, EARLY_CLOSE, "REGULAR 13:00 EST");
        _assertIsOpenAt(WED_2026_12_09_1600, REGULAR, false, OUTSIDE_HOURS, "REGULAR 16:00 EST");
        (bool libraryOpen,) = SessionCalendar.isOpen(WED_2026_12_09_1700, ALL_DAY);
        assertTrue(libraryOpen, "the library alone still says open");
    }

    function test_addEarlyClose_rejectsADayThatIsNotAFullTradingDay() public {
        _throughTimelock(abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09)));
        _expectEarlyCloseRevert(FRI_2026_11_27, SessionCalendar.DayKind.EARLY_CLOSE);
        _expectEarlyCloseRevert(20_812, SessionCalendar.DayKind.HOLIDAY); // Christmas Day 2026
        _expectEarlyCloseRevert(WED_2026_12_09, SessionCalendar.DayKind.HOLIDAY); // added closure
        _expectEarlyCloseRevert(20_799, SessionCalendar.DayKind.WEEKEND); // Sat 12 Dec 2026
        _expectEarlyCloseRevert(21_186, SessionCalendar.DayKind.UNKNOWN); // Mon 3 Jan 2028, not appended
        assertEq(calendar.version(), BASE_VERSION + 1, "only the closure");
    }

    function test_addEarlyClose_refusedFrom1300EDTOnTheDay() public {
        uint256 deadline = WED_2026_12_09 * 1 days + 17 hours; // 17:00Z, 12:00 EST
        vm.warp(deadline);
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(SessionCalendarExtension.ClosureTooLate.selector, WED_2026_12_09, deadline)
        );
        calendar.addEarlyClose(WED_2026_12_09);

        vm.warp(deadline - 1);
        vm.prank(address(timelock));
        calendar.addEarlyClose(WED_2026_12_09);
        _assertDayKind(WED_2026_12_09, SessionCalendar.DayKind.EARLY_CLOSE, "early close one second before");
    }

    // replaceFutureSwitch: research Q5, a daylight-saving law change, for switches still in the future.

    /// @dev H.R. 139 as law before 1 Nov 2026: New York stays on UTC-4, so the 2026 end switches to 4 hours.
    function test_replaceFutureSwitch_permanentDaylightTimeFromNovember2026() public {
        vm.warp(NOW);
        bytes memory call =
            abi.encodeCall(SessionCalendarExtension.replaceFutureSwitch, (DAYLIGHT_END_2026, DAYLIGHT_END_2026, EDT));
        _schedule(call);
        vm.expectEmit(true, false, false, true, address(calendar));
        emit SessionCalendarExtension.SwitchReplaced(DAYLIGHT_END_2026, EST, DAYLIGHT_END_2026, EDT, BASE_VERSION + 1);
        _execute(call);

        uint256 sundayOpen = 1_793_577_600; // Sun 2026-11-01 20:00 EDT
        _assertIsOpenAt(1_793_404_800 - 1, ALL_DAY, true, OPEN, "Fri 2026-10-30 19:59:59 EDT");
        _assertIsOpenAt(1_793_404_800, ALL_DAY, false, WEEKEND, "Fri 2026-10-30 20:00 EDT");
        _assertIsOpenAt(sundayOpen - 1, ALL_DAY, false, WEEKEND, "Sun 2026-11-01 19:59:59 EDT");
        _assertIsOpenAt(sundayOpen, ALL_DAY, true, OPEN, "Sun 2026-11-01 20:00 EDT");
        assertEq(calendar.sessionOpenedAt(1_793_628_000, ALL_DAY), sundayOpen, "Mon 2026-11-02 10:00 EDT");
        _assertIsOpenAt(1_794_009_600 - 1, ALL_DAY, true, OPEN, "Fri 2026-11-06 19:59:59 EDT");
        _assertIsOpenAt(1_794_009_600, ALL_DAY, false, WEEKEND, "Fri 2026-11-06 20:00 EDT");
        (bool libraryOpen, SessionCalendar.Reason libraryReason) = SessionCalendar.isOpen(sundayOpen, ALL_DAY);
        assertFalse(libraryOpen, "the library still opens at 20:00 EST");
        assertEq(uint8(libraryReason), uint8(WEEKEND), "library reason");
    }

    function test_replaceFutureSwitch_movesASwitchToAnotherSunday() public {
        uint64 laterStart = 1_805_612_400; // Sun 2027-03-21 07:00Z, a week later
        _throughTimelock(
            abi.encodeCall(SessionCalendarExtension.replaceFutureSwitch, (DAYLIGHT_START_2027, laterStart, EDT))
        );
        assertEq(calendar.offsetSwitches()[2].at, laterStart, "moved in place");
        _assertIsOpenAt(1_805_068_800, ALL_DAY, false, WEEKEND, "Sun 2027-03-14 19:00 EST");
        _assertIsOpenAt(1_805_072_400, ALL_DAY, true, OPEN, "Sun 2027-03-14 20:00 EST");
        assertEq(calendar.sessionOpenedAt(1_805_209_200, ALL_DAY), 1_805_072_400, "Tue 2027-03-16 10:00 EST");
        _assertIsOpenAt(1_805_504_400 - 1, ALL_DAY, true, OPEN, "Fri 2027-03-19 19:59:59 EST");
        _assertIsOpenAt(1_805_504_400, ALL_DAY, false, WEEKEND, "Fri 2027-03-19 20:00 EST");
        _assertIsOpenAt(1_805_673_600 - 1, ALL_DAY, false, WEEKEND, "Sun 2027-03-21 19:59:59 EDT");
        _assertIsOpenAt(1_805_673_600, ALL_DAY, true, OPEN, "Sun 2027-03-21 20:00 EDT");
    }

    function test_replaceFutureSwitch_pastSwitchesAreImmutable() public {
        vm.warp(NOW);
        _expectReplaceRevert(
            DAYLIGHT_START_2026,
            DAYLIGHT_START_2026,
            EST,
            abi.encodeWithSelector(SessionCalendarExtension.SwitchNotInFuture.selector, DAYLIGHT_START_2026)
        );
        vm.warp(DAYLIGHT_END_2026);
        _expectReplaceRevert(
            DAYLIGHT_END_2026,
            DAYLIGHT_END_2026 + 7 days,
            EST,
            abi.encodeWithSelector(SessionCalendarExtension.SwitchNotInFuture.selector, DAYLIGHT_END_2026)
        );
        vm.warp(DAYLIGHT_END_2026 - 1);
        vm.prank(address(timelock));
        calendar.replaceFutureSwitch(DAYLIGHT_END_2026, DAYLIGHT_END_2026, EDT);
        assertEq(calendar.offsetSwitches()[1].offset, EDT, "replaced one second before it took effect");
    }

    function test_replaceFutureSwitch_newInstantMustBeInTheFuture() public {
        vm.warp(NOW);
        uint64 pastSunday = 1_790_488_800; // Sun 2026-09-27 06:00Z
        _expectReplaceRevert(
            DAYLIGHT_END_2026,
            pastSunday,
            EST,
            abi.encodeWithSelector(SessionCalendarExtension.SwitchNotInFuture.selector, pastSunday)
        );
    }

    function test_replaceFutureSwitch_rejectsAnInstantThatIsNotASwitch() public {
        uint64[3] memory notSwitches = [uint64(DAYLIGHT_END_2026 + 1), DAYLIGHT_END_2026 - 1 days, 0];
        for (uint256 i; i < notSwitches.length; ++i) {
            _expectReplaceRevert(
                notSwitches[i],
                DAYLIGHT_END_2026,
                EDT,
                abi.encodeWithSelector(SessionCalendarExtension.SwitchNotFound.selector, notSwitches[i])
            );
        }
    }

    function test_replaceFutureSwitch_rejectsAnInvalidNewInstant() public {
        uint64[6] memory wrong = [
            uint64(1_793_426_400), // Sat 2026-10-31 06:00Z
            DAYLIGHT_END_2026 + 2 hours, // Sun 08:00Z
            DAYLIGHT_END_2026 + 1, // Sun 06:00:01Z
            1_772_949_600, // Sun 2026-03-08 06:00Z, the day of the switch before
            1_805_004_000, // Sun 2027-03-14 06:00Z, the day of the switch after
            DAYLIGHT_START_2027 + 7 days // after the switch after
        ];
        for (uint256 i; i < wrong.length; ++i) {
            _expectReplaceRevert(
                DAYLIGHT_END_2026,
                wrong[i],
                EST,
                abi.encodeWithSelector(SessionCalendarExtension.InvalidSwitch.selector, wrong[i])
            );
        }
        uint64 inJanuary2028 = 1_830_405_600; // Sun 2028-01-02 06:00Z, past the end of coverage
        _expectReplaceRevert(
            DAYLIGHT_END_2027,
            inJanuary2028,
            EST,
            abi.encodeWithSelector(SessionCalendarExtension.InvalidSwitch.selector, inJanuary2028)
        );
    }

    function test_replaceFutureSwitch_rejectsAnOffsetThatIsNotFourOrFiveHours() public {
        uint32[3] memory wrong = [uint32(0), 3 hours, 6 hours];
        for (uint256 i; i < wrong.length; ++i) {
            _expectReplaceRevert(
                DAYLIGHT_END_2026,
                DAYLIGHT_END_2026,
                wrong[i],
                abi.encodeWithSelector(SessionCalendarExtension.InvalidOffset.selector, wrong[i])
            );
        }
    }

    // The version receipts record

    function test_version_countsEveryWriteInTheLow16Bits() public {
        _throughTimelock(_appendCall(_input2028()));
        assertEq(calendar.version(), 0x0001_0001, "append");
        _throughTimelock(abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09)));
        assertEq(calendar.version(), 0x0001_0002, "closure");
        _throughTimelock(abi.encodeCall(SessionCalendarExtension.addEarlyClose, (WED_2026_12_09 + 1)));
        assertEq(calendar.version(), 0x0001_0003, "early close");
        _throughTimelock(
            abi.encodeCall(SessionCalendarExtension.replaceFutureSwitch, (DAYLIGHT_END_2027, DAYLIGHT_END_2027, EDT))
        );
        assertEq(calendar.version(), 0x0001_0004, "switch replaced");
        assertEq(calendar.writeCount(), 4, "four writes");
        assertEq(calendar.version() >> 16, SessionCalendar.CALENDAR_VERSION, "library version in the high bits");
    }

    function test_version_refusesAWriteOnceTheCounterIsFull() public {
        vm.store(address(calendar), bytes32(uint256(2)), bytes32(uint256(type(uint16).max))); // writeCount
        assertEq(calendar.version(), 0x0001_FFFF, "full counter");
        vm.prank(address(timelock));
        vm.expectRevert(SessionCalendarExtension.WriteLimitReached.selector);
        calendar.addClosure(WED_2026_12_09);
    }

    // The views: built-in years

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_view_matchesTheLibraryWithoutWrites(uint256 timestamp, uint8 typeSeed) public view {
        _assertMatchesLibrary(timestamp, SessionCalendar.SessionType(bound(typeSeed, 0, 2)));
    }

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_view_builtInYearsStillMatchTheLibraryAfterAnAppend(uint256 timestamp, uint8 typeSeed) public {
        _throughTimelock(_appendCall(_input2028()));
        timestamp = bound(timestamp, 0, COVERAGE_END - 1);
        _assertMatchesLibrary(timestamp, SessionCalendar.SessionType(bound(typeSeed, 0, 2)));
    }

    /// @dev Writes land only after the 48-hour delay and only on instants after it, so every answer for an instant
    /// before the execution stays what the library says.
    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_writesNeverChangeAnAnswerAlreadyPast(uint256 timestamp, uint8 typeSeed) public {
        vm.warp(NOW);
        _applyFixtureWrites();
        timestamp = bound(timestamp, 0, block.timestamp - 1);
        _assertMatchesLibrary(timestamp, SessionCalendar.SessionType(bound(typeSeed, 0, 2)));
    }

    /// @dev A closure and an early close on random covered days, probed within two days of either: wherever the view
    /// is open the library is open too, and the open stretch can only have begun later.
    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_closuresOnlyEverCloseMore(uint256 closureSeed, uint256 earlySeed, uint256 timestamp) public {
        uint256 closureDay = bound(closureSeed, SessionCalendar.FIRST_DAY, SessionCalendar.END_DAY - 1);
        uint256 earlyDay = bound(earlySeed, SessionCalendar.FIRST_DAY, SessionCalendar.END_DAY - 1);
        vm.startPrank(address(timelock));
        SessionCalendar.DayKind closureKind = calendar.dayKind(closureDay);
        if (closureKind == SessionCalendar.DayKind.TRADING || closureKind == SessionCalendar.DayKind.EARLY_CLOSE) {
            calendar.addClosure(closureDay);
        }
        if (calendar.dayKind(earlyDay) == SessionCalendar.DayKind.TRADING) calendar.addEarlyClose(earlyDay);
        vm.stopPrank();
        uint256 around = (timestamp % 2 == 0 ? closureDay : earlyDay) * 1 days;
        timestamp = bound(timestamp, around - 2 days, around + 2 days);
        for (uint8 typeId = 1; typeId <= 2; ++typeId) {
            SessionCalendar.SessionType sessionType = SessionCalendar.SessionType(typeId);
            (bool open,) = calendar.isOpenAt(timestamp, sessionType);
            if (!open) continue;
            (bool libraryOpen,) = SessionCalendar.isOpen(timestamp, sessionType);
            assertTrue(libraryOpen, "open only where the library is open");
            assertGe(
                calendar.sessionOpenedAt(timestamp, sessionType),
                SessionCalendar.sessionOpenedAt(timestamp, sessionType),
                "the stretch began no earlier"
            );
        }
    }

    function test_view_builtInYearsMatchTheOracle() public view {
        string memory json = _readFixture(BUILT_IN_FIXTURE);
        assertGt(_replay(json, ".boundary", true), 3_000, "boundary vectors");
        assertEq(_replay(json, ".random", false), 3_000, "random vectors");
    }

    /// @dev The built-in vectors from 1 Jan 2028 on were OUT_OF_RANGE, and the append covers them now.
    function test_view_builtInYearsMatchTheOracleAfterAnAppend() public {
        _throughTimelock(_appendCall(_input2028()));
        string memory json = _readFixture(BUILT_IN_FIXTURE);
        assertGt(_replayBefore(json, ".boundary", true, COVERAGE_END), 3_000, "boundary vectors");
        assertEq(_replayBefore(json, ".random", false, COVERAGE_END), 3_000, "random vectors");
    }

    /// @dev Two closures, three early closes and the switch replacements of permanent daylight time, scheduled as one
    /// batch, against the oracle's own model of the same calendar.
    function test_view_writesInside2026And2027MatchTheOracle() public {
        uint256 writes = _applyFixtureWrites();
        assertEq(calendar.version(), BASE_VERSION + writes, "one version step per write");
        string memory json = _readFixture(EXTENSION_FIXTURE);
        assertEq(calendar.coverageEnd(), vm.parseJsonUint(json, ".writes.coverageEnd"), "Sat 2028-01-01 00:00 EDT");
        assertGt(_replay(json, ".writes.boundary", true), 3_000, "boundary vectors");
        assertEq(_replay(json, ".writes.random", false), 1_000, "random vectors");
    }

    // The views: appended years

    function test_view_2028MatchesTheOracle() public {
        _throughTimelock(_appendCall(_input2028()));
        string memory json = _readFixture(EXTENSION_FIXTURE);
        assertGt(_replay(json, ".append2028.boundary", true), 1_500, "2028 boundary vectors");
        assertEq(_replay(json, ".append2028.random", false), 1_000, "2028 random vectors");
    }

    function test_view_2028DaylightSavingWeekends() public {
        _throughTimelock(_appendCall(_input2028()));
        _assertIsOpenAt(1_836_349_200 - 1, ALL_DAY, true, OPEN, "Fri 2028-03-10 19:59:59 EST");
        _assertIsOpenAt(1_836_349_200, ALL_DAY, false, WEEKEND, "Fri 2028-03-10 20:00 EST");
        _assertIsOpenAt(1_836_518_400 - 1, ALL_DAY, false, WEEKEND, "Sun 2028-03-12 19:59:59 EDT");
        _assertIsOpenAt(1_836_518_400, ALL_DAY, true, OPEN, "Sun 2028-03-12 20:00 EDT");
        assertEq(uint256(1_836_518_400 - 1_836_349_200), 47 hours, "spring weekend");
        _assertIsOpenAt(1_856_908_800, ALL_DAY, false, WEEKEND, "Fri 2028-11-03 20:00 EDT");
        _assertIsOpenAt(1_857_085_200 - 1, ALL_DAY, false, WEEKEND, "Sun 2028-11-05 19:59:59 EST");
        _assertIsOpenAt(1_857_085_200, ALL_DAY, true, OPEN, "Sun 2028-11-05 20:00 EST");
        assertEq(uint256(1_857_085_200 - 1_856_908_800), 49 hours, "fall weekend");
        assertEq(calendar.sessionOpenedAt(1_857_085_200 + 1 days, ALL_DAY), 1_857_085_200, "week opened Sunday");
    }

    /// @dev Mon 3 Jul 2028 closes early before Independence Day, NYSE footnote ** of its 2028 column.
    function test_view_2028HolidayAndEarlyClose() public {
        _throughTimelock(_appendCall(_input2028()));
        _assertIsOpenAt(1_846_256_400 - 1, REGULAR, true, OPEN, "Mon 2028-07-03 12:59:59 EDT");
        _assertIsOpenAt(1_846_256_400, REGULAR, false, EARLY_CLOSE, "Mon 2028-07-03 13:00 EDT");
        _assertIsOpenAt(1_846_270_800 - 1, ALL_DAY, true, OPEN, "Mon 2028-07-03 16:59:59 EDT");
        assertEq(calendar.sessionOpenedAt(1_846_270_800 - 1, ALL_DAY), 1_846_195_200, "opened Sun 2028-07-02 20:00");
        _assertIsOpenAt(1_846_270_800, ALL_DAY, false, EARLY_CLOSE, "Mon 2028-07-03 17:00 EDT");
        _assertIsOpenAt(1_846_281_600 - 1, ALL_DAY, false, EARLY_CLOSE, "Mon 2028-07-03 19:59:59 EDT");
        _assertIsOpenAt(1_846_281_600, ALL_DAY, false, HOLIDAY, "Mon 2028-07-03 20:00, Independence Day eve");
        _assertIsOpenAt(1_846_339_200, REGULAR, false, HOLIDAY, "Tue 2028-07-04 noon");
        _assertIsOpenAt(1_846_368_000, ALL_DAY, true, OPEN, "Tue 2028-07-04 20:00 reopens");
        assertEq(calendar.sessionOpenedAt(1_846_368_000 + 1 hours, ALL_DAY), 1_846_368_000, "reopened Tue 20:00");
        _assertIsOpenAt(1_858_701_600 - 1, REGULAR, true, OPEN, "Fri 2028-11-24 12:59:59 EST");
        _assertIsOpenAt(1_858_701_600, REGULAR, false, EARLY_CLOSE, "Fri 2028-11-24 13:00 EST");
        _assertIsOpenAt(1_858_716_000 - 1, ALL_DAY, true, OPEN, "Fri 2028-11-24 16:59:59 EST");
        _assertIsOpenAt(1_858_716_000, ALL_DAY, false, EARLY_CLOSE, "Fri 2028-11-24 17:00 EST");
        assertEq(calendar.sessionOpenedAt(1_858_716_000 - 1, ALL_DAY), 1_858_640_400, "opened Thanksgiving evening");
    }

    function test_view_seamBetween2027And2028() public {
        _throughTimelock(_appendCall(_input2028()));
        _assertIsOpenAt(1_830_301_200 - 1, ALL_DAY, true, OPEN, "Fri 2027-12-31 19:59:59 EST, library data");
        _assertIsOpenAt(COVERAGE_END - 1, ALL_DAY, false, WEEKEND, "Fri 2027-12-31 23:59:59 EST");
        _assertIsOpenAt(COVERAGE_END, ALL_DAY, false, WEEKEND, "Sat 2028-01-01 00:00 EST, appended data");
        _assertIsOpenAt(1_830_474_000 - 1, ALL_DAY, false, WEEKEND, "Sun 2028-01-02 19:59:59 EST");
        _assertIsOpenAt(1_830_474_000, ALL_DAY, true, OPEN, "Sun 2028-01-02 20:00 EST");
        assertEq(calendar.sessionOpenedAt(1_830_522_600, REGULAR), 1_830_522_600, "Mon 2028-01-03 09:30 EST");
    }

    // The views: everything uncovered is closed with OUT_OF_RANGE

    function test_view_uncoveredTimestampsAreOutOfRange() public {
        _assertIsOpenAt(0, ALL_DAY, false, OUT_OF_RANGE, "epoch");
        _assertIsOpenAt(COVERAGE_START - 1, ALL_DAY, false, OUT_OF_RANGE, "before 2026");
        _assertIsOpenAt(1_830_531_600, ALL_DAY, false, OUT_OF_RANGE, "Mon 2028-01-03 noon, 2028 not appended");
        _assertIsOpenAt(1_830_531_600, REGULAR, false, OUT_OF_RANGE, "Mon 2028-01-03 noon, 2028 not appended");
        _throughTimelock(_appendCall(_input2028()));
        _assertIsOpenAt(1_830_531_600, ALL_DAY, true, OPEN, "Mon 2028-01-03 noon, 2028 appended");
        _assertIsOpenAt(END_OF_2028, ALL_DAY, false, OUT_OF_RANGE, "Mon 2029-01-01 00:00 EST");
        _assertIsOpenAt(END_OF_2028 + 1 days + 12 hours, REGULAR, false, OUT_OF_RANGE, "Tue 2029-01-02 noon");
        _assertIsOpenAt(type(uint256).max, ALL_DAY, false, OUT_OF_RANGE, "far future");
        _assertIsOpenAt(type(uint256).max, NONE, false, NO_SESSION, "NONE stays NO_SESSION");
        vm.expectRevert(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, END_OF_2028, OUT_OF_RANGE));
        calendar.sessionOpenedAt(END_OF_2028, ALL_DAY);
        vm.expectRevert(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, 0, OUT_OF_RANGE));
        calendar.sessionOpenedAt(0, REGULAR);
    }

    /// @dev The evening of 31 December trades for 1 January, so until the next year is appended it is OUT_OF_RANGE
    /// whenever that 1 January is a weekday.
    function test_view_lastEveningOfTheLastYearWaitsForTheNextYear() public {
        _throughTimelock(_appendCall(_input2028()));
        uint256 sundayEvening = 1_861_923_600; // Sun 2028-12-31 20:00 EST
        _assertIsOpenAt(sundayEvening - 1, ALL_DAY, false, WEEKEND, "Sun 19:59:59");
        _assertIsOpenAt(sundayEvening, ALL_DAY, false, OUT_OF_RANGE, "Sun 20:00, Mon 1 Jan 2029 not covered");
        _assertIsOpenAt(END_OF_2028 - 1, ALL_DAY, false, OUT_OF_RANGE, "Sun 23:59:59");
        _throughTimelock(_appendCall(_input2029()));
        _assertIsOpenAt(sundayEvening, ALL_DAY, false, HOLIDAY, "Sun 20:00, New Year's Day 2029 eve");
        _assertIsOpenAt(1_862_010_000, ALL_DAY, true, OPEN, "Mon 2029-01-01 20:00 EST");
    }

    // sessionState: isOpenAt and sessionOpenedAt in one pass

    function test_sessionState_openGivesTheOpeningAndClosedGivesZero() public view {
        _assertSessionState(TUE_2026_12_08_1000, ALL_DAY, true, OPEN, SUN_2026_12_06_2000, "Tue 10:00 EST, ALL_DAY");
        _assertSessionState(TUE_2026_12_08_1000, REGULAR, true, OPEN, TUE_2026_12_08_0930, "Tue 10:00 EST, REGULAR");
        _assertSessionState(TUE_2026_12_08_2000, REGULAR, false, OUTSIDE_HOURS, 0, "Tue 20:00 EST, REGULAR");
        _assertSessionState(1_797_094_800, ALL_DAY, false, WEEKEND, 0, "Sat 2026-12-12 12:00 EST");
        _assertSessionState(TUE_2026_12_08_1000, NONE, false, NO_SESSION, 0, "Tue 10:00 EST, NONE");
        _assertSessionState(0, ALL_DAY, false, OUT_OF_RANGE, 0, "epoch");
        _assertSessionState(COVERAGE_END, ALL_DAY, false, OUT_OF_RANGE, 0, "Sat 2028-01-01 00:00 EST, not appended");
        _assertSessionState(type(uint256).max, REGULAR, false, OUT_OF_RANGE, 0, "far future");
    }

    function test_sessionState_builtInVectorsAgreeWithIsOpenAtAndSessionOpenedAt() public view {
        string memory json = _readFixture(BUILT_IN_FIXTURE);
        assertGt(_replaySessionState(json, ".boundary", true), 3_000, "boundary vectors");
        assertEq(_replaySessionState(json, ".random", false), 3_000, "random vectors");
    }

    function test_sessionState_2028VectorsAgreeWithIsOpenAtAndSessionOpenedAt() public {
        _throughTimelock(_appendCall(_input2028()));
        string memory json = _readFixture(EXTENSION_FIXTURE);
        assertGt(_replaySessionState(json, ".append2028.boundary", true), 1_500, "2028 boundary vectors");
        assertEq(_replaySessionState(json, ".append2028.random", false), 1_000, "2028 random vectors");
    }

    function test_sessionState_writesVectorsAgreeWithIsOpenAtAndSessionOpenedAt() public {
        _applyFixtureWrites();
        string memory json = _readFixture(EXTENSION_FIXTURE);
        assertGt(_replaySessionState(json, ".writes.boundary", true), 3_000, "boundary vectors");
        assertEq(_replaySessionState(json, ".writes.random", false), 1_000, "random vectors");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_sessionState_neverRevertsAndAgreesWithIsOpenAtAndSessionOpenedAt(
        uint256 timestamp,
        uint8 typeSeed
    ) public view {
        SessionCalendar.SessionType sessionType = SessionCalendar.SessionType(bound(typeSeed, 0, 2));
        (bool open, SessionCalendar.Reason reason, uint256 openedAt) = calendar.sessionState(timestamp, sessionType);
        assertTrue(
            _agreesWithIsOpenAtAndSessionOpenedAt(timestamp, sessionType, open, reason, openedAt),
            "sessionState agrees with isOpenAt and sessionOpenedAt"
        );
    }

    // Gas

    /// @dev Logs the cost of a typical external call with cold storage, as the module pays it once per transaction,
    /// of isOpenAt then sessionOpenedAt in one transaction, and of sessionState, which answers both in one pass. The
    /// bounds only catch a regression by an order of magnitude, and sessionState must cost less than the pair.
    function test_gas_typicalCalls() public {
        vm.cool(address(calendar));
        uint256 before = gasleft();
        (bool open,) = calendar.isOpenAt(TUE_2026_12_08_1000, ALL_DAY);
        uint256 isOpenAtGas = before - gasleft();
        assertTrue(open, "Tuesday is open");

        vm.cool(address(calendar));
        before = gasleft();
        uint256 opening = calendar.sessionOpenedAt(TUE_2026_12_08_1000, ALL_DAY);
        uint256 sessionOpenedAtGas = before - gasleft();
        assertEq(opening, SUN_2026_12_06_2000, "Tuesday opened Sunday");

        vm.cool(address(calendar));
        before = gasleft();
        calendar.isOpenAt(TUE_2026_12_08_1000, ALL_DAY);
        calendar.sessionOpenedAt(TUE_2026_12_08_1000, ALL_DAY);
        uint256 bothGas = before - gasleft();

        vm.cool(address(calendar));
        before = gasleft();
        (bool stateOpen,, uint256 openedAt) = calendar.sessionState(TUE_2026_12_08_1000, ALL_DAY);
        uint256 sessionStateGas = before - gasleft();
        assertTrue(stateOpen, "sessionState: Tuesday is open");
        assertEq(openedAt, SUN_2026_12_06_2000, "sessionState: Tuesday opened Sunday");

        console2.log("SessionCalendarExtension.isOpenAt, Tue 10:00, ALL_DAY, cold:", isOpenAtGas);
        console2.log("SessionCalendarExtension.sessionOpenedAt, Tue 10:00, ALL_DAY, cold:", sessionOpenedAtGas);
        console2.log("isOpenAt then sessionOpenedAt in one transaction, cold:", bothGas);
        console2.log("SessionCalendarExtension.sessionState, Tue 10:00, ALL_DAY, cold:", sessionStateGas);
        assertLt(isOpenAtGas, 30_000, "isOpenAt gas");
        assertLt(sessionOpenedAtGas, 60_000, "sessionOpenedAt gas");
        assertLt(sessionStateGas, bothGas, "one pass costs less than the two calls");
    }

    // Helpers

    function _input2028() private view returns (YearInput memory input) {
        string memory json = _readFixture(EXTENSION_FIXTURE);
        input.year = vm.parseJsonUint(json, ".append2028.year");
        uint256[] memory at = vm.parseJsonUintArray(json, ".append2028.switchAt");
        uint256[] memory offset = vm.parseJsonUintArray(json, ".append2028.switchOffset");
        input.switches = new SessionCalendar.OffsetSwitch[](at.length);
        for (uint256 i; i < at.length; ++i) {
            input.switches[i] = SessionCalendar.OffsetSwitch(uint64(at[i]), uint32(offset[i]));
        }
        input.holidays = vm.parseJsonUintArray(json, ".append2028.holidays");
        input.earlyCloses = vm.parseJsonUintArray(json, ".append2028.earlyCloses");
    }

    /// @dev Test input only: New Year's Day is the one 2029 holiday these tests need.
    function _input2029() private pure returns (YearInput memory input) {
        input.year = 2029;
        input.switches = new SessionCalendar.OffsetSwitch[](2);
        input.switches[0] = SessionCalendar.OffsetSwitch(DAYLIGHT_START_2029, EDT);
        input.switches[1] = SessionCalendar.OffsetSwitch(DAYLIGHT_END_2029, EST);
        input.holidays = new uint256[](1);
        input.holidays[0] = FIRST_DAY_OF_2029;
        input.earlyCloses = new uint256[](0);
    }

    /// @dev Schedules the writes block of the extension fixture as one timelock batch, waits out the delay and
    /// executes it.
    function _applyFixtureWrites() private returns (uint256 writes) {
        string memory json = _readFixture(EXTENSION_FIXTURE);
        uint256[] memory closures = vm.parseJsonUintArray(json, ".writes.closures");
        uint256[] memory earlyCloses = vm.parseJsonUintArray(json, ".writes.earlyCloses");
        uint256[] memory replacedAt = vm.parseJsonUintArray(json, ".writes.replacedSwitchAt");
        uint256[] memory newAt = vm.parseJsonUintArray(json, ".writes.replacedSwitchNewAt");
        uint256[] memory newOffset = vm.parseJsonUintArray(json, ".writes.replacedSwitchNewOffset");
        writes = closures.length + earlyCloses.length + replacedAt.length;
        address[] memory targets = new address[](writes);
        uint256[] memory values = new uint256[](writes);
        bytes[] memory payloads = new bytes[](writes);
        uint256 n;
        for (uint256 i; i < replacedAt.length; ++i) {
            payloads[n++] = abi.encodeCall(
                SessionCalendarExtension.replaceFutureSwitch,
                (uint64(replacedAt[i]), uint64(newAt[i]), uint32(newOffset[i]))
            );
        }
        for (uint256 i; i < closures.length; ++i) {
            payloads[n++] = abi.encodeCall(SessionCalendarExtension.addClosure, (closures[i]));
        }
        for (uint256 i; i < earlyCloses.length; ++i) {
            payloads[n++] = abi.encodeCall(SessionCalendarExtension.addEarlyClose, (earlyCloses[i]));
        }
        for (uint256 i; i < writes; ++i) {
            targets[i] = address(calendar);
        }
        vm.prank(deployer);
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), bytes32(0), DELAY);
        vm.warp(block.timestamp + DELAY);
        vm.prank(deployer);
        timelock.executeBatch(targets, values, payloads, bytes32(0), bytes32(0));
    }

    function _appendCall(YearInput memory input) private pure returns (bytes memory) {
        return abi.encodeCall(
            SessionCalendarExtension.appendYear, (input.year, input.switches, input.holidays, input.earlyCloses)
        );
    }

    /// @dev Schedules a call with a fresh salt and waits out the delay. _execute must follow before the next schedule.
    function _schedule(bytes memory call) private {
        ++salt;
        vm.prank(deployer);
        timelock.schedule(address(calendar), 0, call, bytes32(0), bytes32(salt), DELAY);
        vm.warp(block.timestamp + DELAY);
    }

    function _execute(bytes memory call) private {
        vm.prank(deployer);
        timelock.execute(address(calendar), 0, call, bytes32(0), bytes32(salt));
    }

    function _throughTimelock(bytes memory call) private {
        _schedule(call);
        _execute(call);
    }

    function _expectAppendRevert(YearInput memory input, bytes memory revertData) private {
        vm.prank(address(timelock));
        vm.expectRevert(revertData);
        calendar.appendYear(input.year, input.switches, input.holidays, input.earlyCloses);
    }

    function _expectClosureRevert(uint256 day, SessionCalendar.DayKind current) private {
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionCalendarExtension.ClosureNotStricter.selector, day, current, SessionCalendar.DayKind.HOLIDAY
            )
        );
        calendar.addClosure(day);
    }

    function _expectEarlyCloseRevert(uint256 day, SessionCalendar.DayKind current) private {
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(
                SessionCalendarExtension.ClosureNotStricter.selector, day, current, SessionCalendar.DayKind.EARLY_CLOSE
            )
        );
        calendar.addEarlyClose(day);
    }

    function _expectReplaceRevert(uint64 at, uint64 newAt, uint32 newOffset, bytes memory revertData) private {
        vm.prank(address(timelock));
        vm.expectRevert(revertData);
        calendar.replaceFutureSwitch(at, newAt, newOffset);
    }

    function _assertMatchesLibrary(uint256 timestamp, SessionCalendar.SessionType sessionType) private view {
        (bool open, SessionCalendar.Reason reason) = calendar.isOpenAt(timestamp, sessionType);
        (bool libraryOpen, SessionCalendar.Reason libraryReason) = SessionCalendar.isOpen(timestamp, sessionType);
        assertEq(open, libraryOpen, "open");
        assertEq(uint8(reason), uint8(libraryReason), "reason");
        if (open) {
            assertEq(
                calendar.sessionOpenedAt(timestamp, sessionType),
                SessionCalendar.sessionOpenedAt(timestamp, sessionType),
                "sessionOpenedAt"
            );
        }
    }

    function _assertDayKind(uint256 day, SessionCalendar.DayKind kind, string memory what) private view {
        assertEq(uint8(calendar.dayKind(day)), uint8(kind), what);
    }

    function _assertIsOpenAt(
        uint256 timestamp,
        SessionCalendar.SessionType sessionType,
        bool open,
        SessionCalendar.Reason reason,
        string memory what
    ) private view {
        (bool isOpen, SessionCalendar.Reason why) = calendar.isOpenAt(timestamp, sessionType);
        assertEq(isOpen, open, string.concat(what, ": open"));
        assertEq(uint8(why), uint8(reason), string.concat(what, ": reason"));
    }

    function _assertSessionState(
        uint256 timestamp,
        SessionCalendar.SessionType sessionType,
        bool open,
        SessionCalendar.Reason reason,
        uint256 openedAt,
        string memory what
    ) private view {
        (bool isOpen, SessionCalendar.Reason why, uint256 opening) = calendar.sessionState(timestamp, sessionType);
        assertEq(isOpen, open, string.concat(what, ": open"));
        assertEq(uint8(why), uint8(reason), string.concat(what, ": reason"));
        assertEq(opening, openedAt, string.concat(what, ": openedAt"));
    }

    /// @dev Checks sessionState against isOpenAt and sessionOpenedAt at every vector of a block, for ALL_DAY, REGULAR
    /// and NONE. The test_view oracle tests check those two views against the same vectors.
    function _replaySessionState(string memory json, string memory key, bool labelled)
        private
        view
        returns (uint256 checked)
    {
        Vectors memory vectors = _load(json, key, labelled);
        for (uint256 i; i < vectors.t.length; ++i) {
            _checkSessionState(vectors, i, ALL_DAY);
            _checkSessionState(vectors, i, REGULAR);
            _checkSessionState(vectors, i, NONE);
            ++checked;
        }
    }

    function _checkSessionState(Vectors memory vectors, uint256 i, SessionCalendar.SessionType sessionType)
        private
        view
    {
        uint256 timestamp = vectors.t[i];
        (bool open, SessionCalendar.Reason reason, uint256 openedAt) = calendar.sessionState(timestamp, sessionType);
        if (!_agreesWithIsOpenAtAndSessionOpenedAt(timestamp, sessionType, open, reason, openedAt)) {
            assertTrue(
                false,
                string.concat(
                    _describe(vectors, i, sessionType),
                    ": sessionState (",
                    vm.toString(open),
                    ", ",
                    vm.toString(uint256(reason)),
                    ", ",
                    vm.toString(openedAt),
                    ") disagrees with isOpenAt or sessionOpenedAt"
                )
            );
        }
    }

    /// @dev Whether a sessionState answer is what isOpenAt answers, with the instant sessionOpenedAt returns when the
    /// session is open, or with zero when it is closed and sessionOpenedAt reverts SessionClosed with the same reason.
    function _agreesWithIsOpenAtAndSessionOpenedAt(
        uint256 timestamp,
        SessionCalendar.SessionType sessionType,
        bool open,
        SessionCalendar.Reason reason,
        uint256 openedAt
    ) private view returns (bool) {
        (bool isOpen, SessionCalendar.Reason why) = calendar.isOpenAt(timestamp, sessionType);
        if (open != isOpen || reason != why) return false;
        (bool succeeded, uint256 opening, bytes memory revertData) = _calendarSessionOpenedAt(timestamp, sessionType);
        if (open) return succeeded && openedAt == opening;
        return !succeeded && openedAt == 0
            && keccak256(revertData)
                == keccak256(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, timestamp, reason));
    }
}
