// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";

/// @dev Calls SessionCalendar through external functions so tests can expect and catch its reverts.
contract SessionCalendarHarness {
    function isOpen(uint256 timestamp, SessionCalendar.SessionType sessionType)
        external
        pure
        returns (bool, SessionCalendar.Reason)
    {
        return SessionCalendar.isOpen(timestamp, sessionType);
    }

    function sessionOpenedAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        external
        pure
        returns (uint256)
    {
        return SessionCalendar.sessionOpenedAt(timestamp, sessionType);
    }

    function localTime(uint256 timestamp) external pure returns (uint256, uint256) {
        return SessionCalendar.localTime(timestamp);
    }
}

/// @dev Replays vector blocks written by scripts/calendar_vectors.py against the calendar an inheriting test names.
/// Shared by the library and extension tests.
abstract contract CalendarOracle is Test {
    SessionCalendar.SessionType internal constant NONE = SessionCalendar.SessionType.NONE;
    SessionCalendar.SessionType internal constant ALL_DAY = SessionCalendar.SessionType.ALL_DAY;
    SessionCalendar.SessionType internal constant REGULAR = SessionCalendar.SessionType.REGULAR;

    SessionCalendar.Reason internal constant NO_SESSION = SessionCalendar.Reason.NO_SESSION;
    SessionCalendar.Reason internal constant OPEN = SessionCalendar.Reason.OPEN;
    SessionCalendar.Reason internal constant WEEKEND = SessionCalendar.Reason.WEEKEND;
    SessionCalendar.Reason internal constant HOLIDAY = SessionCalendar.Reason.HOLIDAY;
    SessionCalendar.Reason internal constant EARLY_CLOSE = SessionCalendar.Reason.EARLY_CLOSE;
    SessionCalendar.Reason internal constant OUTSIDE_HOURS = SessionCalendar.Reason.OUTSIDE_HOURS;
    SessionCalendar.Reason internal constant OUT_OF_RANGE = SessionCalendar.Reason.OUT_OF_RANGE;

    string internal constant BUILT_IN_FIXTURE = "/test/fixtures/calendar_vectors.json";
    string internal constant EXTENSION_FIXTURE = "/test/fixtures/calendar_extension_vectors.json";

    /// @dev One fixture block: parallel arrays indexed by vector. A labelled block has one label per three vectors,
    /// taken at t - 1, t and t + 1 of the labelled instant. A closed session has sessionOpenedAt 0.
    struct Vectors {
        string[] labels;
        uint256[] t;
        bool[] allDayOpen;
        uint256[] allDayReason;
        uint256[] allDaySessionOpenedAt;
        bool[] regularOpen;
        uint256[] regularReason;
        uint256[] regularSessionOpenedAt;
    }

    /// @dev isOpen of the calendar under test.
    function _calendarIsOpen(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        view
        virtual
        returns (bool open, SessionCalendar.Reason reason);

    /// @dev sessionOpenedAt of the calendar under test, called externally so a revert comes back as data.
    function _calendarSessionOpenedAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        view
        virtual
        returns (bool succeeded, uint256 opening, bytes memory revertData);

    function _readFixture(string memory path) internal view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), path));
    }

    /// @dev Checks every vector of a block against the calendar under test, for ALL_DAY, REGULAR and NONE.
    function _replay(string memory json, string memory key, bool labelled) internal view returns (uint256 checked) {
        return _replayBefore(json, key, labelled, type(uint256).max);
    }

    /// @dev As _replay, for the vectors before `until` only.
    function _replayBefore(string memory json, string memory key, bool labelled, uint256 until)
        internal
        view
        returns (uint256 checked)
    {
        Vectors memory vectors = _load(json, key, labelled);
        for (uint256 i; i < vectors.t.length; ++i) {
            if (vectors.t[i] >= until) continue;
            _check(
                vectors, i, ALL_DAY, vectors.allDayOpen[i], vectors.allDayReason[i], vectors.allDaySessionOpenedAt[i]
            );
            _check(
                vectors, i, REGULAR, vectors.regularOpen[i], vectors.regularReason[i], vectors.regularSessionOpenedAt[i]
            );
            _check(vectors, i, NONE, false, uint256(NO_SESSION), 0);
            ++checked;
        }
    }

    function _load(string memory json, string memory key, bool labelled) internal pure returns (Vectors memory v) {
        if (labelled) v.labels = vm.parseJsonStringArray(json, string.concat(key, ".label"));
        v.t = vm.parseJsonUintArray(json, string.concat(key, ".t"));
        v.allDayOpen = vm.parseJsonBoolArray(json, string.concat(key, ".allDayOpen"));
        v.allDayReason = vm.parseJsonUintArray(json, string.concat(key, ".allDayReason"));
        v.allDaySessionOpenedAt = vm.parseJsonUintArray(json, string.concat(key, ".allDaySessionOpenedAt"));
        v.regularOpen = vm.parseJsonBoolArray(json, string.concat(key, ".regularOpen"));
        v.regularReason = vm.parseJsonUintArray(json, string.concat(key, ".regularReason"));
        v.regularSessionOpenedAt = vm.parseJsonUintArray(json, string.concat(key, ".regularSessionOpenedAt"));
        uint256 count = v.t.length;
        assertGt(count, 0, "empty fixture block");
        assertEq(v.allDayOpen.length, count, "allDayOpen length");
        assertEq(v.allDayReason.length, count, "allDayReason length");
        assertEq(v.allDaySessionOpenedAt.length, count, "allDaySessionOpenedAt length");
        assertEq(v.regularOpen.length, count, "regularOpen length");
        assertEq(v.regularReason.length, count, "regularReason length");
        assertEq(v.regularSessionOpenedAt.length, count, "regularSessionOpenedAt length");
        if (labelled) assertEq(v.labels.length * 3, count, "three vectors per label");
    }

    function _check(
        Vectors memory vectors,
        uint256 i,
        SessionCalendar.SessionType sessionType,
        bool open,
        uint256 reason,
        uint256 opening
    ) private view {
        uint256 timestamp = vectors.t[i];
        (bool isOpen, SessionCalendar.Reason why) = _calendarIsOpen(timestamp, sessionType);
        if (isOpen != open || uint256(why) != reason) {
            assertTrue(
                false,
                string.concat(
                    _describe(vectors, i, sessionType),
                    ": isOpen (",
                    vm.toString(isOpen),
                    ", ",
                    vm.toString(uint256(why)),
                    "), oracle (",
                    vm.toString(open),
                    ", ",
                    vm.toString(reason),
                    ")"
                )
            );
        }
        (bool succeeded, uint256 at, bytes memory revertData) = _calendarSessionOpenedAt(timestamp, sessionType);
        bool agrees = open
            ? succeeded && at == opening
            : !succeeded
                && keccak256(revertData)
                    == keccak256(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, timestamp, reason));
        if (!agrees) {
            assertTrue(
                false,
                string.concat(
                    _describe(vectors, i, sessionType),
                    ": sessionOpenedAt ",
                    succeeded ? vm.toString(at) : "reverted",
                    ", oracle ",
                    open ? vm.toString(opening) : "SessionClosed"
                )
            );
        }
    }

    function _describe(Vectors memory vectors, uint256 i, SessionCalendar.SessionType sessionType)
        internal
        pure
        returns (string memory)
    {
        string memory typeName = sessionType == ALL_DAY ? "ALL_DAY" : sessionType == REGULAR ? "REGULAR" : "NONE";
        string memory at = string.concat("t = ", vm.toString(vectors.t[i]));
        if (vectors.labels.length == 0) return string.concat(typeName, " at ", at);
        string[3] memory deltas = ["-1 s", "+0 s", "+1 s"];
        return string.concat(typeName, " at ", at, ", ", vectors.labels[i / 3], " ", deltas[i % 3]);
    }
}

/// @notice Table, fuzz, oracle and gas tests for SessionCalendar. Expected instants come from
/// docs/research/session-calendar.md: section 3 for the daylight-saving switches, section 5 for the holiday closures,
/// section 6 for the early closes and section 10 for every ALL_DAY open interval. A test named with a Q number pins
/// the default taken for that open question of section 9, so changing it takes a deliberate edit here. The oracle
/// tests replay every vector of contracts/test/fixtures/calendar_vectors.json.
contract SessionCalendarTest is CalendarOracle {
    uint256 private constant COVERAGE_START = 1_767_243_600; // Thu 2026-01-01 00:00 EST
    uint256 private constant COVERAGE_END = 1_830_315_600; // Sat 2028-01-01 00:00 EST
    uint256 private constant ALL_DAY_START = 20 hours;
    uint256 private constant REGULAR_OPEN = 9 hours + 30 minutes;
    uint256 private constant FRIDAY = 5;

    uint256 private constant SUN_2026_01_04_2000 = 1_767_574_800; // EST, opens the week of 5 Jan
    uint256 private constant TUE_2026_01_06_1000 = 1_767_711_600; // EST
    uint256 private constant SAT_2026_01_10_1200 = 1_768_064_400; // EST
    uint256 private constant MON_2026_01_19_1200 = 1_768_842_000; // EST, Martin Luther King, Jr. Day

    SessionCalendarHarness private harness;

    /// @dev Timestamps the gas test reads from storage, so the optimizer cannot fold the calls.
    uint256 private gasProbeTuesday;
    uint256 private gasProbeFriday;

    function setUp() public {
        harness = new SessionCalendarHarness();
        gasProbeTuesday = TUE_2026_01_06_1000;
        gasProbeFriday = 1_768_006_800 - 1 hours; // Fri 2026-01-09 19:00 EST, the longest walk back
    }

    function _calendarIsOpen(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        pure
        override
        returns (bool, SessionCalendar.Reason)
    {
        return SessionCalendar.isOpen(timestamp, sessionType);
    }

    function _calendarSessionOpenedAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        internal
        view
        override
        returns (bool, uint256, bytes memory)
    {
        try harness.sessionOpenedAt(timestamp, sessionType) returns (uint256 opening) {
            return (true, opening, "");
        } catch (bytes memory revertData) {
            return (false, 0, revertData);
        }
    }

    // Constants

    function test_calendarVersionIsOne() public pure {
        assertEq(SessionCalendar.CALENDAR_VERSION, 1);
    }

    function test_coverageIsNewYorkYears2026And2027() public pure {
        assertEq(SessionCalendar.COVERAGE_START, COVERAGE_START, "coverage start");
        assertEq(SessionCalendar.COVERAGE_END, COVERAGE_END, "coverage end");
        assertEq(SessionCalendar.FIRST_DAY * 1 days + 5 hours, COVERAGE_START, "first day is 1 Jan 2026 in EST");
        assertEq(SessionCalendar.END_DAY * 1 days + 5 hours, COVERAGE_END, "end day is 1 Jan 2028 in EST");
        assertEq(SessionCalendar.END_DAY - SessionCalendar.FIRST_DAY, 365 + 365, "two common years");
        assertEq(SessionCalendar.LAST_YEAR, 2027, "last year");
    }

    function test_daylightSavingInstantsMatchResearch() public pure {
        assertEq(SessionCalendar.DAYLIGHT_START_2026, 1_772_953_200, "2026-03-08T07:00:00Z");
        assertEq(SessionCalendar.DAYLIGHT_END_2026, 1_793_512_800, "2026-11-01T06:00:00Z");
        assertEq(SessionCalendar.DAYLIGHT_START_2027, 1_805_007_600, "2027-03-14T07:00:00Z");
        assertEq(SessionCalendar.DAYLIGHT_END_2027, 1_825_567_200, "2027-11-07T06:00:00Z");
    }

    function test_builtInSwitchesMatchTheOracle() public view {
        string memory json = _readFixture(BUILT_IN_FIXTURE);
        uint256[] memory at = vm.parseJsonUintArray(json, ".switchAt");
        uint256[] memory offset = vm.parseJsonUintArray(json, ".switchOffset");
        SessionCalendar.OffsetSwitch[4] memory switches = SessionCalendar.builtInSwitches();
        assertEq(at.length, switches.length, "zoneinfo finds four switches in coverage");
        for (uint256 i; i < switches.length; ++i) {
            assertEq(switches[i].at, at[i], "switch instant");
            assertEq(switches[i].offset, offset[i], "offset after the switch");
            assertEq(SessionCalendar.weekday(switches[i].at / 1 days), SessionCalendar.SUNDAY, "on a Sunday");
        }
    }

    function test_enumNumberingIsFixed() public pure {
        assertEq(uint8(NO_SESSION), 0, "NO_SESSION");
        assertEq(uint8(OPEN), 1, "OPEN");
        assertEq(uint8(WEEKEND), 2, "WEEKEND");
        assertEq(uint8(HOLIDAY), 3, "HOLIDAY");
        assertEq(uint8(EARLY_CLOSE), 4, "EARLY_CLOSE");
        assertEq(uint8(OUTSIDE_HOURS), 5, "OUTSIDE_HOURS");
        assertEq(uint8(OUT_OF_RANGE), 6, "OUT_OF_RANGE");
        assertEq(uint8(type(SessionCalendar.Reason).max), 6, "no reason after OUT_OF_RANGE");
        assertEq(uint8(SessionCalendar.DayKind.UNKNOWN), 0, "an unset day kind is UNKNOWN");
        assertEq(uint8(SessionCalendar.DayKind.TRADING), 1, "TRADING");
        assertEq(uint8(SessionCalendar.DayKind.EARLY_CLOSE), 2, "EARLY_CLOSE day");
        assertEq(uint8(SessionCalendar.DayKind.HOLIDAY), 3, "HOLIDAY day");
        assertEq(uint8(SessionCalendar.DayKind.WEEKEND), 4, "WEEKEND day");
    }

    // R2 and R3: the week runs from Sunday 20:00 to Friday 20:00 New York time, with no daily break.

    function test_closesFridayAt2000ET_standardTime() public view {
        _assertCloses(1_768_006_800, WEEKEND); // Fri 2026-01-09 20:00 EST, 2026-01-10T01:00:00Z
    }

    function test_closesFridayAt2000ET_daylightTime() public view {
        _assertCloses(1_783_728_000, WEEKEND); // Fri 2026-07-10 20:00 EDT, 2026-07-11T00:00:00Z
    }

    function test_opensSundayAt2000ET_standardTime() public view {
        _assertOpens(SUN_2026_01_04_2000, WEEKEND); // 2026-01-05T01:00:00Z
    }

    function test_opensSundayAt2000ET_daylightTime() public view {
        _assertOpens(1_783_900_800, WEEKEND); // Sun 2026-07-12 20:00 EDT, 2026-07-13T00:00:00Z
    }

    function test_noDailyBreak_openThroughEverySubSessionBoundary() public view {
        // Tue 2026-01-06 at 04:00, 09:30, 16:00 and 20:00 EST, Chainlink's sub-session boundaries, and Wed 00:00.
        uint256[5] memory boundaries =
            [uint256(1_767_690_000), 1_767_709_800, 1_767_733_200, 1_767_747_600, 1_767_762_000];
        for (uint256 i; i < boundaries.length; ++i) {
            for (uint256 at = boundaries[i] - 1; at <= boundaries[i] + 1; ++at) {
                _assertIsOpen(at, ALL_DAY, true, OPEN, "inside the week");
                assertEq(harness.sessionOpenedAt(at, ALL_DAY), SUN_2026_01_04_2000, "the week opened Sunday 20:00");
            }
        }
    }

    function test_saturdayIsClosed() public view {
        _assertIsOpen(SAT_2026_01_10_1200, ALL_DAY, false, WEEKEND, "Sat 2026-01-10 12:00 EST");
        _assertIsOpen(SAT_2026_01_10_1200, REGULAR, false, WEEKEND, "Sat 2026-01-10 12:00 EST");
    }

    /// @dev Every row of section 10 of the research note: each Sunday or post-holiday open, each Friday or pre-holiday
    /// close, one unbroken stretch in between, and closed between consecutive intervals.
    function test_everyOpenIntervalOf2026And2027_matchesResearchTable() public view {
        uint256[107] memory opens = [
            uint256(1767315600),
            1767574800,
            1768179600,
            1768870800,
            1769389200,
            1769994000,
            1770598800,
            1771290000,
            1771808400,
            1772413200,
            1773014400,
            1773619200,
            1774224000,
            1774828800,
            1775433600,
            1776038400,
            1776643200,
            1777248000,
            1777852800,
            1778457600,
            1779062400,
            1779753600,
            1780272000,
            1780876800,
            1781481600,
            1782086400,
            1782691200,
            1783296000,
            1783900800,
            1784505600,
            1785110400,
            1785715200,
            1786320000,
            1786924800,
            1787529600,
            1788134400,
            1788825600,
            1789344000,
            1789948800,
            1790553600,
            1791158400,
            1791763200,
            1792368000,
            1792972800,
            1793581200,
            1794186000,
            1794790800,
            1795395600,
            1795741200,
            1796000400,
            1796605200,
            1797210000,
            1797814800,
            1798419600,
            1799024400,
            1799629200,
            1800320400,
            1800838800,
            1801443600,
            1802048400,
            1802739600,
            1803258000,
            1803862800,
            1804467600,
            1805068800,
            1805673600,
            1806278400,
            1806883200,
            1807488000,
            1808092800,
            1808697600,
            1809302400,
            1809907200,
            1810512000,
            1811116800,
            1811808000,
            1812326400,
            1812931200,
            1813536000,
            1814140800,
            1814832000,
            1815350400,
            1815955200,
            1816560000,
            1817164800,
            1817769600,
            1818374400,
            1818979200,
            1819584000,
            1820275200,
            1820793600,
            1821398400,
            1822003200,
            1822608000,
            1823212800,
            1823817600,
            1824422400,
            1825027200,
            1825635600,
            1826240400,
            1826845200,
            1827190800,
            1827450000,
            1828054800,
            1828659600,
            1829264400,
            1829869200
        ];
        uint256[107] memory closes = [
            uint256(1767402000),
            1768006800,
            1768611600,
            1769216400,
            1769821200,
            1770426000,
            1771030800,
            1771635600,
            1772240400,
            1772845200,
            1773446400,
            1774051200,
            1774656000,
            1775174400,
            1775865600,
            1776470400,
            1777075200,
            1777680000,
            1778284800,
            1778889600,
            1779494400,
            1780099200,
            1780704000,
            1781308800,
            1781827200,
            1782518400,
            1783036800,
            1783728000,
            1784332800,
            1784937600,
            1785542400,
            1786147200,
            1786752000,
            1787356800,
            1787961600,
            1788566400,
            1789171200,
            1789776000,
            1790380800,
            1790985600,
            1791590400,
            1792195200,
            1792800000,
            1793404800,
            1794013200,
            1794618000,
            1795222800,
            1795654800,
            1795816800,
            1796432400,
            1797037200,
            1797642000,
            1798149600,
            1798765200,
            1799456400,
            1800061200,
            1800666000,
            1801270800,
            1801875600,
            1802480400,
            1803085200,
            1803690000,
            1804294800,
            1804899600,
            1805500800,
            1806019200,
            1806710400,
            1807315200,
            1807920000,
            1808524800,
            1809129600,
            1809734400,
            1810339200,
            1810944000,
            1811548800,
            1812153600,
            1812758400,
            1813276800,
            1813968000,
            1814572800,
            1815177600,
            1815782400,
            1816387200,
            1816992000,
            1817596800,
            1818201600,
            1818806400,
            1819411200,
            1820016000,
            1820620800,
            1821225600,
            1821830400,
            1822435200,
            1823040000,
            1823644800,
            1824249600,
            1824854400,
            1825459200,
            1826067600,
            1826672400,
            1827104400,
            1827266400,
            1827882000,
            1828486800,
            1829091600,
            1829610000,
            1830301200
        ];
        uint256 openHours;
        for (uint256 i; i < opens.length; ++i) {
            assertFalse(_isOpen(opens[i] - 1, ALL_DAY), "closed the second before an open");
            assertTrue(_isOpen(opens[i], ALL_DAY), "open at the opening second");
            assertTrue(_isOpen(closes[i] - 1, ALL_DAY), "open the second before a close");
            assertFalse(_isOpen(closes[i], ALL_DAY), "closed at the closing second");
            assertEq(harness.sessionOpenedAt(opens[i], ALL_DAY), opens[i], "the opening second opened the stretch");
            assertEq(harness.sessionOpenedAt(closes[i] - 1, ALL_DAY), opens[i], "one unbroken stretch to the close");
            if (i + 1 < opens.length) {
                assertFalse(_isOpen((closes[i] + opens[i + 1]) / 2, ALL_DAY), "closed between intervals");
            }
            openHours += (closes[i] - opens[i]) / 1 hours;
        }
        assertEq(openHours, 12_039, "open hours in 2026 and 2027");
    }

    // R1: every daylight-saving switch in range, at 02:00 local time on a Sunday inside the weekend closure. Each
    // weekend closes on Friday 20:00 in the old offset and opens on Sunday 20:00 in the new one.

    function test_dstStart_2026_03_08_clockSkipsAnHour_weekendIs47Hours() public view {
        _assertDaylightSwitch(1_772_953_200, true, 1_772_845_200, 1_773_014_400, 47);
    }

    function test_dstEnd_2026_11_01_clockRepeatsAnHour_weekendIs49Hours() public view {
        _assertDaylightSwitch(1_793_512_800, false, 1_793_404_800, 1_793_581_200, 49);
    }

    function test_dstStart_2027_03_14_clockSkipsAnHour_weekendIs47Hours() public view {
        _assertDaylightSwitch(1_805_007_600, true, 1_804_899_600, 1_805_068_800, 47);
    }

    function test_dstEnd_2027_11_07_clockRepeatsAnHour_weekendIs49Hours() public view {
        _assertDaylightSwitch(1_825_567_200, false, 1_825_459_200, 1_825_635_600, 49);
    }

    function test_dstSwitchesOutsideCoverageAreOutOfRange() public view {
        _assertIsOpen(1_762_063_200, ALL_DAY, false, OUT_OF_RANGE, "2025 end, 2025-11-02T06:00:00Z");
        _assertIsOpen(1_836_457_200, ALL_DAY, false, OUT_OF_RANGE, "2028 start, 2028-03-12T07:00:00Z");
    }

    function test_regularOpensAt0930ET_onBothSidesOfTheMarchSwitch() public view {
        uint256 mondayBefore = 1_772_461_800; // Mon 2026-03-02 09:30 EST
        uint256 mondayAfter = 1_773_063_000; // Mon 2026-03-09 09:30 EDT
        assertEq(mondayAfter - mondayBefore, 7 days - 1 hours, "a week minus the skipped hour");
        _assertIsOpen(mondayBefore - 1, REGULAR, false, OUTSIDE_HOURS, "09:29:59 EST");
        _assertIsOpen(mondayBefore, REGULAR, true, OPEN, "09:30 EST");
        _assertIsOpen(mondayAfter - 1, REGULAR, false, OUTSIDE_HOURS, "09:29:59 EDT");
        _assertIsOpen(mondayAfter, REGULAR, true, OPEN, "09:30 EDT");
        assertEq(harness.sessionOpenedAt(mondayAfter + 1 hours, REGULAR), mondayAfter, "opened 09:30 EDT");
    }

    // R4 and section 5: every full-day holiday in range removes the ALL_DAY session from 20:00 the evening before it
    // to 20:00 on the holiday. Each row is the research table's close, reopen and hours closed.

    function test_holiday_2026_01_01_NewYearsDay_closed() public view {
        // The closure starts Wed 2025-12-31 20:00 EST, before coverage, so the calendar answers OUT_OF_RANGE there.
        _assertIsOpen(COVERAGE_START - 1, ALL_DAY, false, OUT_OF_RANGE, "2025-12-31 23:59:59 EST");
        _assertIsOpen(COVERAGE_START, ALL_DAY, false, HOLIDAY, "2026-01-01 00:00 EST");
        _assertIsOpen(1_767_286_800, ALL_DAY, false, HOLIDAY, "2026-01-01 12:00 EST");
        _assertIsOpen(1_767_286_800, REGULAR, false, HOLIDAY, "2026-01-01 12:00 EST");
        _assertIsOpen(1_767_315_600 - 1, ALL_DAY, false, HOLIDAY, "2026-01-01 19:59:59 EST");
        _assertOpens(1_767_315_600, HOLIDAY);
    }

    function test_holiday_2026_01_19_MartinLutherKingJrDay_closed() public view {
        _assertHoliday(1_768_611_600, 1_768_870_800, MON_2026_01_19_1200, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2026_02_16_WashingtonsBirthday_closed() public view {
        _assertHoliday(1_771_030_800, 1_771_290_000, 1_771_261_200, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2026_04_03_GoodFriday_closed() public view {
        _assertHoliday(1_775_174_400, 1_775_433_600, 1_775_232_000, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2026_05_25_MemorialDay_closed() public view {
        _assertHoliday(1_779_494_400, 1_779_753_600, 1_779_724_800, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2026_06_19_Juneteenth_closed() public view {
        _assertHoliday(1_781_827_200, 1_782_086_400, 1_781_884_800, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2026_07_03_IndependenceDayObserved_closed() public view {
        _assertHoliday(1_783_036_800, 1_783_296_000, 1_783_094_400, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2026_09_07_LaborDay_closed() public view {
        _assertHoliday(1_788_566_400, 1_788_825_600, 1_788_796_800, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2026_11_26_Thanksgiving_closed() public view {
        _assertHoliday(1_795_654_800, 1_795_741_200, 1_795_712_400, 24, HOLIDAY, HOLIDAY);
    }

    function test_holiday_2026_12_25_ChristmasDay_closed() public view {
        // Christmas Eve closes early, so the closure starts at 17:00 on Thu 24 Dec.
        _assertHoliday(1_798_149_600, 1_798_419_600, 1_798_218_000, 75, EARLY_CLOSE, WEEKEND);
    }

    function test_holiday_2027_01_01_NewYearsDay_closed() public view {
        _assertHoliday(1_798_765_200, 1_799_024_400, 1_798_822_800, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2027_01_18_MartinLutherKingJrDay_closed() public view {
        _assertHoliday(1_800_061_200, 1_800_320_400, 1_800_291_600, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2027_02_15_WashingtonsBirthday_closed() public view {
        _assertHoliday(1_802_480_400, 1_802_739_600, 1_802_710_800, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2027_03_26_GoodFriday_closed() public view {
        _assertHoliday(1_806_019_200, 1_806_278_400, 1_806_076_800, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2027_05_31_MemorialDay_closed() public view {
        _assertHoliday(1_811_548_800, 1_811_808_000, 1_811_779_200, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2027_06_18_JuneteenthObserved_closed() public view {
        _assertHoliday(1_813_276_800, 1_813_536_000, 1_813_334_400, 72, HOLIDAY, WEEKEND);
    }

    function test_holiday_2027_07_05_IndependenceDayObserved_closed() public view {
        _assertHoliday(1_814_572_800, 1_814_832_000, 1_814_803_200, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2027_09_06_LaborDay_closed() public view {
        _assertHoliday(1_820_016_000, 1_820_275_200, 1_820_246_400, 72, WEEKEND, HOLIDAY);
    }

    function test_holiday_2027_11_25_Thanksgiving_closed() public view {
        _assertHoliday(1_827_104_400, 1_827_190_800, 1_827_162_000, 24, HOLIDAY, HOLIDAY);
    }

    function test_holiday_2027_12_24_ChristmasDayObserved_closed() public view {
        _assertHoliday(1_829_610_000, 1_829_869_200, 1_829_667_600, 72, HOLIDAY, WEEKEND);
    }

    function test_noHolidayOn31Dec2027_lastFridayTradesToTheEnd() public view {
        _assertIsOpen(1_830_301_200 - 1, ALL_DAY, true, OPEN, "Fri 2027-12-31 19:59:59 EST");
        _assertCloses(1_830_301_200, WEEKEND); // Fri 2027-12-31 20:00 EST, 1 Jan 2028 is a Saturday
    }

    // R5 and section 6: early closes end REGULAR at 13:00 and ALL_DAY at 17:00, with no evening session after.

    function test_earlyClose_2026_11_27_dayAfterThanksgiving() public view {
        _assertEarlyClose(1_795_802_400, 1_795_741_200, 1_796_000_400, WEEKEND);
        _assertOpens(1_795_741_200, HOLIDAY); // Thanksgiving evening opens for the half-day
    }

    function test_earlyClose_2026_12_24_christmasEve() public view {
        _assertEarlyClose(1_798_135_200, 1_797_814_800, 1_798_419_600, HOLIDAY);
        _assertIsOpen(1_798_074_000, ALL_DAY, true, OPEN, "Wed 2026-12-23 20:00 EST, the evening before");
    }

    function test_earlyClose_2027_11_26_dayAfterThanksgiving() public view {
        _assertEarlyClose(1_827_252_000, 1_827_190_800, 1_827_450_000, WEEKEND);
        _assertOpens(1_827_190_800, HOLIDAY);
    }

    // REGULAR session type.

    function test_regular_opensAt0930ET_closesAt1600ET() public view {
        uint256 opens = 1_767_709_800; // Tue 2026-01-06 09:30 EST
        uint256 closes = 1_767_733_200; // Tue 2026-01-06 16:00 EST
        _assertIsOpen(opens - 1, REGULAR, false, OUTSIDE_HOURS, "09:29:59");
        _assertIsOpen(opens, REGULAR, true, OPEN, "09:30");
        _assertIsOpen(closes - 1, REGULAR, true, OPEN, "15:59:59");
        _assertIsOpen(closes, REGULAR, false, OUTSIDE_HOURS, "16:00");
        _assertIsOpen(1_768_006_800 + 1 hours, REGULAR, false, OUTSIDE_HOURS, "Fri 21:00, a trading day");
        _assertIsOpen(MON_2026_01_19_1200, REGULAR, false, HOLIDAY, "MLK Day noon");
    }

    // sessionOpenedAt: the UTC instant the current session began, the end of the most recent closed interval.

    function test_sessionOpenedAt_normalWeek_isTheSunday2000Reopen() public view {
        _assertOpenedAt(TUE_2026_01_06_1000, SUN_2026_01_04_2000, "Tue 10:00 EST");
        _assertOpenedAt(SUN_2026_01_04_2000, SUN_2026_01_04_2000, "Sun 20:00 EST, the opening second");
        _assertOpenedAt(1_768_006_800 - 1, SUN_2026_01_04_2000, "Fri 19:59:59 EST, the last second");
        _assertOpenedAt(1_784_131_200, 1_783_900_800, "Wed 2026-07-15 12:00 EDT: Sun 12 Jul 20:00 EDT");
    }

    function test_sessionOpenedAt_afterMondayHoliday_isMonday2000() public view {
        _assertOpenedAt(1_768_921_200, 1_768_870_800, "Tue 2026-01-20 10:00 EST, after Martin Luther King, Jr. Day");
        _assertOpenedAt(1_788_876_000, 1_788_825_600, "Tue 2026-09-08 10:00 EDT, after Labor Day");
        _assertOpenedAt(1_814_918_400 - 1, 1_814_832_000, "Tue 2027-07-06 19:59:59 EDT, after Independence Day");
    }

    function test_sessionOpenedAt_afterMidweekHoliday_isTheHoliday2000() public view {
        _assertOpenedAt(1_767_366_000, 1_767_315_600, "Fri 2026-01-02 10:00 EST, after New Year's Day");
        _assertOpenedAt(1_795_791_600, 1_795_741_200, "Fri 2026-11-27 10:00 EST, after Thanksgiving");
        _assertOpenedAt(1_827_241_200, 1_827_190_800, "Fri 2027-11-26 10:00 EST, after Thanksgiving");
    }

    function test_sessionOpenedAt_aroundFridayHoliday() public view {
        _assertOpenedAt(1_775_138_400, 1_774_828_800, "Thu 2026-04-02 10:00 EDT, before Good Friday: Sunday 20:00");
        _assertOpenedAt(1_775_484_000, 1_775_433_600, "Mon 2026-04-06 10:00 EDT, after Good Friday: Sunday 20:00");
        _assertOpenedAt(1_798_470_000, 1_798_419_600, "Mon 2026-12-28 10:00 EST, after Christmas: Sunday 20:00");
    }

    function test_sessionOpenedAt_afterEarlyClose_isTheNext2000Reopen() public view {
        _assertOpenedAt(1_795_816_800 - 1, 1_795_741_200, "Fri 2026-11-27 16:59:59 EST, the half-day itself");
        _assertOpenedAt(1_796_050_800, 1_796_000_400, "Mon 2026-11-30 10:00 EST: Sun 29 Nov 20:00");
        _assertOpenedAt(1_798_149_600 - 1, 1_797_814_800, "Thu 2026-12-24 16:59:59 EST: Sun 20 Dec 20:00");
        _assertOpenedAt(1_827_500_400, 1_827_450_000, "Mon 2027-11-29 10:00 EST: Sun 28 Nov 20:00");
    }

    function test_sessionOpenedAt_aroundBothSwitches_usesTheOffsetOfTheOpen() public view {
        _assertOpenedAt(1_772_845_200 - 1, 1_772_413_200, "Fri 2026-03-06 19:59:59 EST: Sun 1 Mar 20:00 EST");
        _assertOpenedAt(1_773_064_800, 1_773_014_400, "Mon 2026-03-09 10:00 EDT: Sun 8 Mar 20:00 EDT");
        _assertOpenedAt(1_793_404_800 - 1, 1_792_972_800, "Fri 2026-10-30 19:59:59 EDT: Sun 25 Oct 20:00 EDT");
        _assertOpenedAt(1_793_631_600, 1_793_581_200, "Mon 2026-11-02 10:00 EST: Sun 1 Nov 20:00 EST");
        _assertOpenedAt(1_805_119_200, 1_805_068_800, "Mon 2027-03-15 10:00 EDT: Sun 14 Mar 20:00 EDT");
        _assertOpenedAt(1_825_686_000, 1_825_635_600, "Mon 2027-11-08 10:00 EST: Sun 7 Nov 20:00 EST");
    }

    function test_sessionOpenedAt_regularIs0930ThatDay() public view {
        assertEq(harness.sessionOpenedAt(TUE_2026_01_06_1000, REGULAR), 1_767_709_800, "Tue 2026-01-06 09:30 EST");
        assertEq(harness.sessionOpenedAt(1_795_802_400 - 1, REGULAR), 1_795_789_800, "half-day 09:30 EST");
        assertEq(harness.sessionOpenedAt(1_773_064_800, REGULAR), 1_773_063_000, "Mon 2026-03-09 09:30 EDT");
    }

    function test_sessionOpenedAt_revertsWithTheReasonWhenClosed() public {
        _expectClosed(SAT_2026_01_10_1200, ALL_DAY, WEEKEND);
        _expectClosed(MON_2026_01_19_1200, ALL_DAY, HOLIDAY);
        _expectClosed(1_795_816_800, ALL_DAY, EARLY_CLOSE); // Fri 2026-11-27 17:00 EST
        _expectClosed(1_795_802_400, REGULAR, EARLY_CLOSE); // Fri 2026-11-27 13:00 EST
        _expectClosed(1_767_733_200, REGULAR, OUTSIDE_HOURS); // Tue 2026-01-06 16:00 EST
        _expectClosed(COVERAGE_START - 1, ALL_DAY, OUT_OF_RANGE);
        _expectClosed(COVERAGE_END, ALL_DAY, OUT_OF_RANGE);
        _expectClosed(TUE_2026_01_06_1000, NONE, NO_SESSION);
    }

    // Coverage edges.

    function test_coverageEnd_lastEveningReadsWeekendThenOutOfRange() public {
        _assertIsOpen(COVERAGE_END - 1, ALL_DAY, false, WEEKEND, "Fri 2027-12-31 23:59:59 EST");
        _assertIsOpen(COVERAGE_END, ALL_DAY, false, OUT_OF_RANGE, "Sat 2028-01-01 00:00 EST");
        _assertIsOpen(COVERAGE_END, REGULAR, false, OUT_OF_RANGE, "Sat 2028-01-01 00:00 EST");
        (uint256 day, uint256 secondOfDay) = harness.localTime(COVERAGE_END - 1);
        assertEq(day, SessionCalendar.END_DAY - 1, "last covered day");
        assertEq(secondOfDay, 1 days - 1, "last covered second");
        vm.expectRevert(abi.encodeWithSelector(SessionCalendar.TimestampOutOfRange.selector, COVERAGE_END));
        harness.localTime(COVERAGE_END);
    }

    function test_coverageStart_firstSecondIsNewYearsDay() public {
        (uint256 day, uint256 secondOfDay) = harness.localTime(COVERAGE_START);
        assertEq(day, SessionCalendar.FIRST_DAY, "first covered day");
        assertEq(secondOfDay, 0, "midnight");
        _assertIsOpen(COVERAGE_START, REGULAR, false, HOLIDAY, "New Year's Day, REGULAR");
        vm.expectRevert(abi.encodeWithSelector(SessionCalendar.TimestampOutOfRange.selector, COVERAGE_START - 1));
        harness.localTime(COVERAGE_START - 1);
    }

    function test_yearEdge_2026To2027_newYearsEveClosesForNewYearsDay() public view {
        _assertCloses(1_798_765_200, HOLIDAY); // Thu 2026-12-31 20:00 EST
        _assertIsOpen(1_798_779_600, ALL_DAY, false, HOLIDAY, "Fri 2027-01-01 00:00 EST");
        _assertIsOpen(1_798_779_600 - 1, ALL_DAY, false, HOLIDAY, "Thu 2026-12-31 23:59:59 EST");
        (uint256 day, uint256 secondOfDay) = harness.localTime(1_798_779_600);
        assertEq(day, 20_819, "Fri 1 Jan 2027");
        assertEq(secondOfDay, 0, "midnight");
    }

    // Open questions of section 9: each test pins the default taken.

    /// @dev Q2: the types are NONE, ALL_DAY and REGULAR, with no extended-hours type, and NONE is the zero value.
    function test_Q2_sessionTypesAreNoneAllDayAndRegular() public view {
        assertEq(uint8(NONE), 0, "NONE is the zero value");
        assertEq(uint8(ALL_DAY), 1, "ALL_DAY");
        assertEq(uint8(REGULAR), 2, "REGULAR");
        assertEq(uint8(type(SessionCalendar.SessionType).max), 2, "no extended-hours type");
        SessionCalendar.SessionType unset;
        _assertIsOpen(TUE_2026_01_06_1000, unset, false, NO_SESSION, "an unset type, mid-week");
    }

    /// @dev Q2: a ticker with no session type never opens, at any timestamp.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_Q2_noneIsNeverOpen(uint256 timestamp) public view {
        _assertIsOpen(timestamp, NONE, false, NO_SESSION, "NONE");
        assertTrue(_sessionOpenedAtReverts(timestamp, NONE, NO_SESSION), "sessionOpenedAt reverts for NONE");
    }

    /// @dev Q3: ALL_DAY ends at 17:00 New York time on an early-close day.
    function test_Q3_allDayEarlyCloseIs1700ET() public view {
        assertEq(SessionCalendar.ALL_DAY_EARLY_CLOSE, 17 hours, "17:00");
        _assertIsOpen(1_795_816_800 - 1, ALL_DAY, true, OPEN, "Fri 2026-11-27 16:59:59 EST");
        _assertIsOpen(1_795_816_800, ALL_DAY, false, EARLY_CLOSE, "Fri 2026-11-27 17:00 EST");
    }

    /// @dev Q4: sessions are half-open, open at the opening second and closed at the closing second.
    function test_Q4_boundariesAreHalfOpen() public view {
        assertFalse(_isOpen(SUN_2026_01_04_2000 - 1, ALL_DAY), "Sun 19:59:59 closed");
        assertTrue(_isOpen(SUN_2026_01_04_2000, ALL_DAY), "Sun 20:00:00 open");
        assertTrue(_isOpen(1_768_006_800 - 1, ALL_DAY), "Fri 19:59:59 open");
        assertFalse(_isOpen(1_768_006_800, ALL_DAY), "Fri 20:00:00 closed");
    }

    /// @dev Q4: sessionOpenedAt is an open second whose previous second is closed, at 20:00 or 09:30 New York time,
    /// within one week or one day of the timestamp, and the timestamp is open all the way back to it.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_Q4_sessionOpenedAtStartsTheOpenStretch(uint256 timestamp, uint256 probe) public view {
        timestamp = bound(timestamp, COVERAGE_START, COVERAGE_END - 1);
        _assertStretch(timestamp, probe, ALL_DAY, ALL_DAY_START, 5 days);
        _assertStretch(timestamp, probe, REGULAR, REGULAR_OPEN, 6 hours + 30 minutes);
    }

    /// @dev Q7: the calendar follows New York time only. In the weeks after the US switch and before the EU one, the
    /// issuer's mint window opens Sunday 21:00 and closes Friday 21:00 New York time, and the session ignores it.
    function test_Q7_followsNewYorkTimeNotTheMintWindow() public view {
        _assertIsOpen(1_773_621_000, ALL_DAY, true, OPEN, "Sun 2026-03-15 20:30 EDT, before the mint window");
        _assertIsOpen(1_774_053_000, ALL_DAY, false, WEEKEND, "Fri 2026-03-20 20:30 EDT, inside the mint window");
    }

    /// @dev Q8 as decided in DECISIONS D-009 Q7: outside coverage every type but NONE is closed with OUT_OF_RANGE,
    /// and nothing reverts, including at a weekday hour that would be open.
    function test_Q8_outsideCoverageIsClosedWithOutOfRange() public view {
        uint256[4] memory outside = [uint256(0), 1_767_114_000, 1_830_531_600, type(uint256).max];
        for (uint256 i; i < outside.length; ++i) {
            _assertIsOpen(outside[i], ALL_DAY, false, OUT_OF_RANGE, "ALL_DAY outside coverage");
            _assertIsOpen(outside[i], REGULAR, false, OUT_OF_RANGE, "REGULAR outside coverage");
        }
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_Q8_outsideCoverageIsOutOfRange(uint256 timestamp, uint8 typeSeed) public view {
        vm.assume(timestamp < COVERAGE_START || timestamp >= COVERAGE_END);
        SessionCalendar.SessionType sessionType = SessionCalendar.SessionType(bound(typeSeed, 1, 2));
        _assertIsOpen(timestamp, sessionType, false, OUT_OF_RANGE, "outside coverage");
        assertTrue(_sessionOpenedAtReverts(timestamp, sessionType, OUT_OF_RANGE), "sessionOpenedAt reverts");
    }

    // Properties over every covered second.

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_isOpenNeverRevertsAndOpenMeansReasonOpen(uint256 timestamp, uint8 typeSeed) public view {
        SessionCalendar.SessionType sessionType = SessionCalendar.SessionType(bound(typeSeed, 0, 2));
        (bool open, SessionCalendar.Reason reason) = harness.isOpen(timestamp, sessionType);
        assertEq(open, reason == OPEN, "open exactly when the reason is OPEN");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_closedFromFriday2000ToSunday2000(uint256 timestamp) public view {
        timestamp = bound(timestamp, COVERAGE_START, COVERAGE_END - 1);
        (uint256 day, uint256 secondOfDay) = harness.localTime(timestamp);
        uint256 weekday = SessionCalendar.weekday(day);
        bool weekend = weekday == SessionCalendar.SATURDAY
            || (weekday == SessionCalendar.SUNDAY && secondOfDay < ALL_DAY_START)
            || (weekday == FRIDAY && secondOfDay >= ALL_DAY_START);
        if (weekend) _assertIsOpen(timestamp, ALL_DAY, false, WEEKEND, "weekend closure");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_weekdayAndDayKindAreDefinedForEveryDay(uint256 day) public pure {
        uint256 dayOfWeek = SessionCalendar.weekday(day);
        assertLt(dayOfWeek, 7, "a day of the week");
        if (day >= 7) assertEq(SessionCalendar.weekday(day - 7), dayOfWeek, "a week earlier");
        SessionCalendar.DayKind kind = SessionCalendar.dayKind(day);
        if (day < SessionCalendar.FIRST_DAY || day >= SessionCalendar.END_DAY) {
            assertTrue(
                kind == SessionCalendar.DayKind.UNKNOWN || kind == SessionCalendar.DayKind.WEEKEND,
                "outside coverage only weekends are known"
            );
        }
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_regularOpenOnlyInsideAllDay(uint256 timestamp) public view {
        timestamp = bound(timestamp, COVERAGE_START - 1 days, COVERAGE_END + 1 days);
        if (_isOpen(timestamp, REGULAR)) assertTrue(_isOpen(timestamp, ALL_DAY), "REGULAR open outside ALL_DAY");
    }

    // Oracle: every vector of scripts/calendar_vectors.py.

    function test_oracle_everyBoundaryVectorMatches() public view {
        uint256 checked = _replay(_readFixture(BUILT_IN_FIXTURE), ".boundary", true);
        assertGt(checked, 3_000, "boundary vectors");
    }

    function test_oracle_seededRandomVectorsMatch() public view {
        string memory json = _readFixture(BUILT_IN_FIXTURE);
        assertEq(_replay(json, ".random", false), 3_000, "random vectors");
        assertEq(vm.parseJsonUint(json, ".calendarVersion"), SessionCalendar.CALENDAR_VERSION, "fixture version");
        assertEq(vm.parseJsonUint(json, ".coverageStart"), COVERAGE_START, "fixture coverage start");
        assertEq(vm.parseJsonUint(json, ".coverageEnd"), COVERAGE_END, "fixture coverage end");
    }

    // Gas

    /// @dev Logs the cost of a typical call: an internal call from a contract, as SessionCalendarExtension and any
    /// other caller compiles it. The bounds only catch a regression by an order of magnitude.
    function test_gas_typicalCalls() public view {
        uint256 tuesday = gasProbeTuesday;
        uint256 friday = gasProbeFriday;
        uint256 before = gasleft();
        (bool open,) = SessionCalendar.isOpen(tuesday, ALL_DAY);
        uint256 isOpenGas = before - gasleft();
        before = gasleft();
        uint256 opening = SessionCalendar.sessionOpenedAt(tuesday, ALL_DAY);
        uint256 sessionOpenedAtGas = before - gasleft();
        before = gasleft();
        uint256 fridayOpening = SessionCalendar.sessionOpenedAt(friday, ALL_DAY);
        uint256 longestWalkGas = before - gasleft();
        assertTrue(open, "Tuesday is open");
        assertEq(opening, SUN_2026_01_04_2000, "Tuesday opened Sunday");
        assertEq(fridayOpening, SUN_2026_01_04_2000, "Friday opened Sunday");
        console2.log("SessionCalendar.isOpen, Tue 10:00, ALL_DAY:", isOpenGas);
        console2.log("SessionCalendar.sessionOpenedAt, Tue 10:00, ALL_DAY:", sessionOpenedAtGas);
        console2.log("SessionCalendar.sessionOpenedAt, Fri 19:00, ALL_DAY, longest walk:", longestWalkGas);
        assertLt(isOpenGas, 5_000, "isOpen gas");
        assertLt(longestWalkGas, 15_000, "sessionOpenedAt gas");
    }

    // Helpers

    function _assertIsOpen(
        uint256 timestamp,
        SessionCalendar.SessionType sessionType,
        bool open,
        SessionCalendar.Reason reason,
        string memory what
    ) private view {
        (bool isOpen, SessionCalendar.Reason why) = harness.isOpen(timestamp, sessionType);
        assertEq(isOpen, open, string.concat(what, ": open"));
        assertEq(uint8(why), uint8(reason), string.concat(what, ": reason"));
    }

    function _isOpen(uint256 timestamp, SessionCalendar.SessionType sessionType) private view returns (bool open) {
        (open,) = harness.isOpen(timestamp, sessionType);
    }

    function _assertOpenedAt(uint256 timestamp, uint256 opening, string memory what) private view {
        _assertIsOpen(timestamp, ALL_DAY, true, OPEN, what);
        assertEq(harness.sessionOpenedAt(timestamp, ALL_DAY), opening, what);
    }

    function _expectClosed(uint256 timestamp, SessionCalendar.SessionType sessionType, SessionCalendar.Reason reason)
        private
    {
        vm.expectRevert(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, timestamp, reason));
        harness.sessionOpenedAt(timestamp, sessionType);
    }

    function _sessionOpenedAtReverts(
        uint256 timestamp,
        SessionCalendar.SessionType sessionType,
        SessionCalendar.Reason reason
    ) private view returns (bool) {
        (bool succeeded,, bytes memory revertData) = _calendarSessionOpenedAt(timestamp, sessionType);
        return !succeeded
            && keccak256(revertData)
                == keccak256(abi.encodeWithSelector(SessionCalendar.SessionClosed.selector, timestamp, reason));
    }

    /// @dev ALL_DAY is open from opensAt on, closed the second before, and opensAt is where the stretch began.
    function _assertOpens(uint256 opensAt, SessionCalendar.Reason reasonBefore) private view {
        _assertIsOpen(opensAt - 1, ALL_DAY, false, reasonBefore, "the second before the open");
        _assertIsOpen(opensAt, ALL_DAY, true, OPEN, "the opening second");
        _assertIsOpen(opensAt + 1, ALL_DAY, true, OPEN, "the second after the open");
        assertEq(harness.sessionOpenedAt(opensAt, ALL_DAY), opensAt, "sessionOpenedAt the opening second");
        assertEq(harness.sessionOpenedAt(opensAt + 1 hours, ALL_DAY), opensAt, "sessionOpenedAt an hour in");
    }

    /// @dev ALL_DAY is open the second before closesAt and closed from closesAt on.
    function _assertCloses(uint256 closesAt, SessionCalendar.Reason reasonAfter) private view {
        _assertIsOpen(closesAt - 1, ALL_DAY, true, OPEN, "the second before the close");
        _assertIsOpen(closesAt, ALL_DAY, false, reasonAfter, "the closing second");
        _assertIsOpen(closesAt + 1, ALL_DAY, false, reasonAfter, "the second after the close");
    }

    function _assertDaylightSwitch(
        uint256 switchAt,
        bool toDaylight,
        uint256 fridayClose,
        uint256 sundayOpen,
        uint256 weekendHours
    ) private view {
        uint256 sunday = switchAt / 1 days;
        assertEq(SessionCalendar.weekday(sunday), SessionCalendar.SUNDAY, "switch day is a Sunday");
        (uint256 dayBefore, uint256 clockBefore) = harness.localTime(switchAt - 1);
        (uint256 dayAt, uint256 clockAt) = harness.localTime(switchAt);
        assertEq(dayBefore, sunday, "same local day before the switch");
        assertEq(dayAt, sunday, "same local day at the switch");
        assertEq(clockBefore, 2 hours - 1, "01:59:59 before the switch");
        assertEq(clockAt, toDaylight ? 3 hours : 1 hours, toDaylight ? "03:00:00 EDT" : "01:00:00 EST");
        for (uint256 at = switchAt - 1; at <= switchAt + 1; ++at) {
            _assertIsOpen(at, ALL_DAY, false, WEEKEND, "ALL_DAY at the switch");
            _assertIsOpen(at, REGULAR, false, WEEKEND, "REGULAR at the switch");
        }
        (, uint256 fridayClock) = harness.localTime(fridayClose);
        (, uint256 sundayClock) = harness.localTime(sundayOpen);
        assertEq(fridayClock, ALL_DAY_START, "Friday close at 20:00 in the old offset");
        assertEq(sundayClock, ALL_DAY_START, "Sunday open at 20:00 in the new offset");
        assertEq(fridayClose % 1 days, toDaylight ? 1 hours : 0, "Friday close in UTC");
        assertEq(sundayOpen % 1 days, toDaylight ? 0 : 1 hours, "Sunday open in UTC");
        _assertCloses(fridayClose, WEEKEND);
        _assertOpens(sundayOpen, WEEKEND);
        assertEq(sundayOpen - fridayClose, weekendHours * 1 hours, "weekend length");
        assertTrue(fridayClose < switchAt && switchAt < sundayOpen, "switch inside the weekend closure");
    }

    function _assertHoliday(
        uint256 closesAt,
        uint256 reopensAt,
        uint256 holidayNoon,
        uint256 hoursClosed,
        SessionCalendar.Reason reasonAtClose,
        SessionCalendar.Reason reasonBeforeReopen
    ) private view {
        assertEq(reopensAt - closesAt, hoursClosed * 1 hours, "hours closed");
        _assertCloses(closesAt, reasonAtClose);
        _assertIsOpen(holidayNoon - 16 hours, ALL_DAY, false, HOLIDAY, "20:00 the evening before the holiday");
        _assertIsOpen(holidayNoon, ALL_DAY, false, HOLIDAY, "ALL_DAY at noon on the holiday");
        _assertIsOpen(holidayNoon, REGULAR, false, HOLIDAY, "REGULAR at noon on the holiday");
        _assertOpens(reopensAt, reasonBeforeReopen);
    }

    function _assertEarlyClose(
        uint256 regularCloseAt,
        uint256 stretchOpenedAt,
        uint256 nextOpenAt,
        SessionCalendar.Reason reasonFrom2000
    ) private view {
        uint256 allDayCloseAt = regularCloseAt + 4 hours;
        uint256 fullDayCloseAt = regularCloseAt + 3 hours;
        _assertIsOpen(regularCloseAt - 1, REGULAR, true, OPEN, "REGULAR 12:59:59");
        _assertIsOpen(regularCloseAt, REGULAR, false, EARLY_CLOSE, "REGULAR 13:00");
        _assertIsOpen(fullDayCloseAt - 1, REGULAR, false, EARLY_CLOSE, "REGULAR 15:59:59");
        _assertIsOpen(fullDayCloseAt, REGULAR, false, OUTSIDE_HOURS, "REGULAR 16:00");
        _assertIsOpen(allDayCloseAt - 1, ALL_DAY, true, OPEN, "ALL_DAY 16:59:59");
        _assertIsOpen(allDayCloseAt, ALL_DAY, false, EARLY_CLOSE, "ALL_DAY 17:00");
        _assertIsOpen(allDayCloseAt + 3 hours - 1, ALL_DAY, false, EARLY_CLOSE, "ALL_DAY 19:59:59");
        _assertIsOpen(allDayCloseAt + 3 hours, ALL_DAY, false, reasonFrom2000, "ALL_DAY 20:00, no evening session");
        assertEq(harness.sessionOpenedAt(allDayCloseAt - 1, ALL_DAY), stretchOpenedAt, "ALL_DAY stretch start");
        assertEq(
            harness.sessionOpenedAt(regularCloseAt - 1, REGULAR), regularCloseAt - 3 hours - 30 minutes, "REGULAR 09:30"
        );
        assertFalse(_isOpen((allDayCloseAt + nextOpenAt) / 2, ALL_DAY), "closed until the next open");
        _assertOpens(nextOpenAt, WEEKEND);
    }

    function _assertStretch(
        uint256 timestamp,
        uint256 probe,
        SessionCalendar.SessionType sessionType,
        uint256 openingClock,
        uint256 longestStretch
    ) private view {
        if (!_isOpen(timestamp, sessionType)) {
            assertFalse(_calledOk(timestamp, sessionType), "sessionOpenedAt reverts when closed");
            return;
        }
        uint256 opening = harness.sessionOpenedAt(timestamp, sessionType);
        assertLe(opening, timestamp, "opens at or before the timestamp");
        assertLt(timestamp - opening, longestStretch, "within the longest stretch");
        assertTrue(_isOpen(opening, sessionType), "open at the opening second");
        assertFalse(_isOpen(opening - 1, sessionType), "closed the second before");
        assertEq(harness.sessionOpenedAt(opening, sessionType), opening, "the opening second opened itself");
        (, uint256 clock) = harness.localTime(opening);
        assertEq(clock, openingClock, "opens at the session's clock time");
        assertTrue(_isOpen(opening + bound(probe, 0, timestamp - opening), sessionType), "open since the opening");
    }

    function _calledOk(uint256 timestamp, SessionCalendar.SessionType sessionType) private view returns (bool) {
        (bool succeeded,,) = _calendarSessionOpenedAt(timestamp, sessionType);
        return succeeded;
    }
}
