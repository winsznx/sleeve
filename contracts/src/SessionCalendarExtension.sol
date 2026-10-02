// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SessionCalendar} from "./libraries/SessionCalendar.sol";

/// @title SessionCalendarExtension
/// @notice The session calendar SleeveModule reads. It answers from SessionCalendar's 2026 and 2027, from years
/// appended after them, and from closures, early closes and daylight-saving changes added inside covered years. Only
/// the timelock can write. Every write emits an event and bumps the version that receipts record, and no write
/// changes an answer for an instant already past, except that appending a year fills in answers that were
/// OUT_OF_RANGE.
/// @dev One rule, SessionCalendar.decide, runs on this contract's data: a UTC-offset switch table seeded with the
/// library's four switches, the library's day kinds for 2026 and 2027, and a list of days this contract sets, which
/// holds each appended year's holidays and early closes plus every added closure and early close. A listed day
/// overrides the library and is always at least as closed. The in-range powers, addClosure, addEarlyClose and
/// replaceFutureSwitch, are separate functions that can be deleted if the owner chooses append-only years (owner
/// batch 2 item 9); nothing else depends on them.
contract SessionCalendarExtension {
    /// @notice The only address that can write: an OpenZeppelin TimelockController.
    address public immutable timelock;

    /// @notice The last covered New York calendar year.
    uint256 public lastYear;

    /// @notice First New York day number after coverage: 1 January of the year after lastYear.
    uint256 public endDay;

    /// @notice Writes made so far. version() carries it in its low 16 bits.
    uint16 public writeCount;

    /// @dev Every UTC-offset switch, ascending, at most one per day. New York is on EST before the first.
    SessionCalendar.OffsetSwitch[] private _switches;

    /// @dev HOLIDAY or EARLY_CLOSE for each day this contract sets. UNKNOWN, the zero value, means not set: the library
    /// answers for 2026 and 2027, and a weekday of an appended year trades.
    mapping(uint256 day => SessionCalendar.DayKind kind) private _listed;

    /// @notice A year was appended.
    /// @param year The New York calendar year.
    /// @param version version() after the write.
    /// @param switches The year's UTC-offset switches, ascending.
    /// @param holidays The year's full-day holidays, as ascending day numbers.
    /// @param earlyCloses The year's early-close days, as ascending day numbers.
    event YearAppended(
        uint256 indexed year,
        uint32 version,
        SessionCalendar.OffsetSwitch[] switches,
        uint256[] holidays,
        uint256[] earlyCloses
    );

    /// @notice A full-day closure was added.
    /// @param day New York day number of the closure.
    /// @param previous What the day was before: TRADING or EARLY_CLOSE.
    /// @param version version() after the write.
    event ClosureAdded(uint256 indexed day, SessionCalendar.DayKind previous, uint32 version);

    /// @notice An early close was added.
    /// @param day New York day number of the early close.
    /// @param version version() after the write.
    event EarlyCloseAdded(uint256 indexed day, uint32 version);

    /// @notice A future UTC-offset switch was replaced.
    /// @param at The switch's instant before the write.
    /// @param previousOffset The offset it switched to before the write.
    /// @param newAt The switch's instant from now on.
    /// @param newOffset The offset it switches to from now on.
    /// @param version version() after the write.
    event SwitchReplaced(uint64 indexed at, uint32 previousOffset, uint64 newAt, uint32 newOffset, uint32 version);

    /// @notice The timelock given at deploy has no code, so it cannot be a TimelockController.
    /// @param timelock The address given.
    error TimelockNotContract(address timelock);

    /// @notice Only the timelock can write.
    /// @param caller The address that called.
    error CallerNotTimelock(address caller);

    /// @notice A year can only be appended right after the last covered year.
    /// @param year The year given.
    /// @param nextYear The only year that can be appended now.
    error YearNotNext(uint256 year, uint256 nextYear);

    /// @notice A switch instant is not 06:00Z or 07:00Z on a Sunday, or falls outside the days open to it: inside the
    /// appended year after the switch before it, or strictly between the neighbours of the switch it replaces.
    /// @param at The instant given.
    error InvalidSwitch(uint256 at);

    /// @notice An offset is not 4 or 5 hours, or an appended switch does not change the offset in force before it.
    /// @param offset The offset given, in seconds.
    error InvalidOffset(uint256 offset);

    /// @notice A holiday is not a weekday of the appended year above the holiday before it.
    /// @param day The day number given.
    error InvalidHoliday(uint256 day);

    /// @notice An early close is not a weekday of the appended year above the early close before it, or is a holiday.
    /// @param day The day number given.
    error InvalidEarlyClose(uint256 day);

    /// @notice The day cannot take the closure asked for: it is a weekend, a holiday or outside coverage, or it
    /// already closes early and an early close was asked for.
    /// @param day The day number given.
    /// @param current What the day is now.
    /// @param requested HOLIDAY for addClosure, EARLY_CLOSE for addEarlyClose.
    error ClosureNotStricter(uint256 day, SessionCalendar.DayKind current, SessionCalendar.DayKind requested);

    /// @notice The closure would change an answer for an instant already past.
    /// @param day The day number given.
    /// @param deadline The first instant the write is refused, the earliest UTC instant it could change an answer.
    error ClosureTooLate(uint256 day, uint256 deadline);

    /// @notice No switch is at the instant given.
    /// @param at The instant given.
    error SwitchNotFound(uint256 at);

    /// @notice A switch can only be replaced while it is in the future, and only by one in the future.
    /// @param at The instant at or before block.timestamp.
    error SwitchNotInFuture(uint256 at);

    /// @notice writeCount is at its 16-bit maximum, so version() cannot move again.
    error WriteLimitReached();

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert CallerNotTimelock(msg.sender);
        _;
    }

    /// @param timelock_ The only address that will be able to write: the TimelockController.
    constructor(address timelock_) {
        if (timelock_.code.length == 0) revert TimelockNotContract(timelock_);
        timelock = timelock_;
        lastYear = SessionCalendar.LAST_YEAR;
        endDay = SessionCalendar.END_DAY;
        SessionCalendar.OffsetSwitch[4] memory builtIn = SessionCalendar.builtInSwitches();
        for (uint256 i; i < builtIn.length; ++i) {
            _switches.push(builtIn[i]);
        }
    }

    /// @notice Appends the year after the last covered year: its UTC-offset switches, NYSE holidays and early closes.
    /// @dev Day numbers count days since 1970-01-01. The year runs from the current endDay for 365 days, or 366 in a
    /// leap year. Under current law a year has two switches: 02:00 EST on the second Sunday of March, 07:00Z, to
    /// 4 hours, and 02:00 EDT on the first Sunday of November, 06:00Z, to 5 hours. A law that keeps one offset all year
    /// lists none (research Q5). Allowed after coverage has run out, because it only fills in answers that were
    /// OUT_OF_RANGE.
    /// @param year lastYear + 1.
    /// @param switches The year's offset changes, ascending, on different Sundays at 06:00Z or 07:00Z, each to 4 or 5
    /// hours and each changing the offset in force before it.
    /// @param holidays The year's NYSE full-day holidays: ascending weekday day numbers inside the year.
    /// @param earlyCloses The year's NYSE early-close days: ascending weekday day numbers inside the year, none of
    /// them a holiday.
    function appendYear(
        uint256 year,
        SessionCalendar.OffsetSwitch[] calldata switches,
        uint256[] calldata holidays,
        uint256[] calldata earlyCloses
    ) external onlyTimelock {
        uint256 nextYear = lastYear + 1;
        if (year != nextYear) revert YearNotNext(year, nextYear);
        uint256 firstDay = endDay;
        uint256 yearEndDay = firstDay + _daysIn(year);
        _appendSwitches(switches, firstDay, yearEndDay);
        for (uint256 i; i < holidays.length; ++i) {
            if (!_isListable(holidays, i, firstDay, yearEndDay)) revert InvalidHoliday(holidays[i]);
            _listed[holidays[i]] = SessionCalendar.DayKind.HOLIDAY;
        }
        for (uint256 i; i < earlyCloses.length; ++i) {
            if (!_isListable(earlyCloses, i, firstDay, yearEndDay)) revert InvalidEarlyClose(earlyCloses[i]);
            _listed[earlyCloses[i]] = SessionCalendar.DayKind.EARLY_CLOSE;
        }
        lastYear = year;
        endDay = yearEndDay;
        emit YearAppended(year, _bumpVersion(), switches, holidays, earlyCloses);
    }

    /// @notice Adds a full-day closure on a covered trading day, which may be an early-close day or a day of 2026 or
    /// 2027. The ALL_DAY session then stays closed from 20:00 New York time the evening before until 20:00 on the day,
    /// with reason HOLIDAY. Add-only: nothing removes a closure.
    /// @dev Refused from 00:00Z on the day, which is 20:00 EDT the evening before, the earliest instant a closure can
    /// change an answer. A closure announced later is guarded only by PriceGuard (research Q6).
    /// @param day New York day number of the closure.
    function addClosure(uint256 day) external onlyTimelock {
        SessionCalendar.DayKind current = _dayKind(day);
        if (current != SessionCalendar.DayKind.TRADING && current != SessionCalendar.DayKind.EARLY_CLOSE) {
            revert ClosureNotStricter(day, current, SessionCalendar.DayKind.HOLIDAY);
        }
        uint256 deadline = (day - 1) * 1 days + SessionCalendar.ALL_DAY_START + SessionCalendar.DAYLIGHT_OFFSET;
        if (block.timestamp >= deadline) revert ClosureTooLate(day, deadline);
        _listed[day] = SessionCalendar.DayKind.HOLIDAY;
        emit ClosureAdded(day, current, _bumpVersion());
    }

    /// @notice Adds an early close on a covered full trading day, which may be a day of 2026 or 2027. ALL_DAY then
    /// closes at 17:00 and REGULAR at 13:00 New York time, and ALL_DAY reopens at 20:00 when the next day trades.
    /// Add-only: nothing removes an early close.
    /// @dev Refused from 17:00Z on the day, which is 13:00 EDT, the earliest instant an early close can change an
    /// answer.
    /// @param day New York day number of the early close.
    function addEarlyClose(uint256 day) external onlyTimelock {
        SessionCalendar.DayKind current = _dayKind(day);
        if (current != SessionCalendar.DayKind.TRADING) {
            revert ClosureNotStricter(day, current, SessionCalendar.DayKind.EARLY_CLOSE);
        }
        uint256 deadline = day * 1 days + SessionCalendar.REGULAR_EARLY_CLOSE + SessionCalendar.DAYLIGHT_OFFSET;
        if (block.timestamp >= deadline) revert ClosureTooLate(day, deadline);
        _listed[day] = SessionCalendar.DayKind.EARLY_CLOSE;
        emit EarlyCloseAdded(day, _bumpVersion());
    }

    /// @notice Replaces a UTC-offset switch that is still in the future, for a change in daylight-saving law (research
    /// Q5). Past switches never change. A replacement may move the switch, change the offset it switches to, or both.
    /// A switch to the offset already in force changes nothing, which is how a law that stops the clocks changing
    /// removes a switch: under permanent daylight time, the 2026 and 2027 ends become switches to 4 hours.
    /// @dev The new instant is 02:00 New York time on a Sunday on either offset, 06:00Z or 07:00Z, because a law change
    /// can alter the offset before a later switch. That keeps every switch inside the weekend closure.
    /// @param at The switch's current instant, which must be after block.timestamp.
    /// @param newAt Its instant from now on: after block.timestamp, on a later day than the switch before it and an
    /// earlier day than the switch after it, or than the end of coverage.
    /// @param newOffset The offset it switches to from now on, 4 or 5 hours in seconds.
    function replaceFutureSwitch(uint64 at, uint64 newAt, uint32 newOffset) external onlyTimelock {
        uint256 index = _indexOf(at);
        if (at <= block.timestamp) revert SwitchNotInFuture(at);
        if (newAt <= block.timestamp) revert SwitchNotInFuture(newAt);
        uint256 newDay = newAt / 1 days;
        uint256 lowDay = index == 0 ? SessionCalendar.FIRST_DAY : _switches[index - 1].at / 1 days + 1;
        uint256 highDay = index + 1 == _switches.length ? endDay : _switches[index + 1].at / 1 days;
        if (newDay < lowDay || newDay >= highDay || !_isSwitchInstant(newAt)) revert InvalidSwitch(newAt);
        if (!_isOffset(newOffset)) revert InvalidOffset(newOffset);
        uint32 previousOffset = _switches[index].offset;
        _switches[index] = SessionCalendar.OffsetSwitch(newAt, newOffset);
        emit SwitchReplaced(at, previousOffset, newAt, newOffset, _bumpVersion());
    }

    /// @notice Whether a session type's market session is open at a timestamp, and why. Never reverts.
    /// @param timestamp Seconds since the Unix epoch, as in block.timestamp.
    /// @param sessionType The ticker's session type.
    /// @return open True only while the session is open.
    /// @return reason As SessionCalendar.isOpen. OUT_OF_RANGE before 2026, from coverageEnd() on, and on the last
    /// evening of the last covered year when the next 1 January is a weekday the calendar does not cover yet.
    function isOpenAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        external
        view
        returns (bool open, SessionCalendar.Reason reason)
    {
        (open, reason,,) = _session(timestamp, sessionType);
    }

    /// @notice When the session open at a timestamp began, as SessionCalendar.sessionOpenedAt: the end of the most
    /// recent closure, with every added closure and early close counted.
    /// @param timestamp Seconds since the Unix epoch.
    /// @param sessionType The ticker's session type.
    /// @return The opening instant, at or before the timestamp. When the session is closed, reverts with
    /// SessionCalendar.SessionClosed and the reason isOpenAt gives.
    function sessionOpenedAt(uint256 timestamp, SessionCalendar.SessionType sessionType)
        external
        view
        returns (uint256)
    {
        (bool open, SessionCalendar.Reason reason, uint256 day, uint256 secondOfDay) = _session(timestamp, sessionType);
        if (!open) revert SessionCalendar.SessionClosed(timestamp, reason);
        return _openedAt(sessionType, day, secondOfDay);
    }

    /// @notice isOpenAt and sessionOpenedAt in one pass, for a caller that needs both, such as the module's guard.
    /// Never reverts.
    /// @param timestamp Seconds since the Unix epoch, as in block.timestamp.
    /// @param sessionType The ticker's session type.
    /// @return open As isOpenAt.
    /// @return reason As isOpenAt.
    /// @return openedAt As sessionOpenedAt while the session is open, and zero when it is closed. Zero passes any
    /// check that a time is not before the opening, so read it only when open is true.
    function sessionState(uint256 timestamp, SessionCalendar.SessionType sessionType)
        external
        view
        returns (bool open, SessionCalendar.Reason reason, uint256 openedAt)
    {
        uint256 day;
        uint256 secondOfDay;
        (open, reason, day, secondOfDay) = _session(timestamp, sessionType);
        if (open) openedAt = _openedAt(sessionType, day, secondOfDay);
    }

    /// @notice The calendar version receipts record: SessionCalendar.CALENDAR_VERSION in the high 16 bits and
    /// writeCount in the low 16 bits, so 0x00010000 is the library's version 1 with no writes.
    /// @return The version.
    function version() public view returns (uint32) {
        return (uint32(SessionCalendar.CALENDAR_VERSION) << 16) | writeCount;
    }

    /// @notice What a New York day is for the market, with every write applied.
    /// @param day New York day number.
    /// @return WEEKEND, HOLIDAY, EARLY_CLOSE or TRADING, or UNKNOWN for a weekday outside coverage.
    function dayKind(uint256 day) external view returns (SessionCalendar.DayKind) {
        return _dayKind(day);
    }

    /// @notice Every UTC-offset switch, ascending, for verifiers that recompute an answer.
    /// @return The switch table. New York is on EST before the first switch.
    function offsetSwitches() external view returns (SessionCalendar.OffsetSwitch[] memory) {
        return _switches;
    }

    /// @notice First covered instant, the library's.
    /// @return SessionCalendar.COVERAGE_START.
    function coverageStart() external pure returns (uint256) {
        return SessionCalendar.COVERAGE_START;
    }

    /// @notice First instant after coverage: 00:00 New York time on endDay. The module and keeper can read it to
    /// report an expiring calendar before answers turn OUT_OF_RANGE.
    /// @return The UTC instant.
    function coverageEnd() external view returns (uint256) {
        return _utcTime(endDay, 0);
    }

    /// @dev isOpenAt plus the local day and time, which sessionOpenedAt and sessionState reuse. Both are zero when the
    /// session type is NONE or the timestamp is outside coverage.
    function _session(uint256 timestamp, SessionCalendar.SessionType sessionType)
        private
        view
        returns (bool open, SessionCalendar.Reason reason, uint256 day, uint256 secondOfDay)
    {
        if (sessionType == SessionCalendar.SessionType.NONE) {
            return (false, SessionCalendar.Reason.NO_SESSION, 0, 0);
        }
        if (timestamp < SessionCalendar.COVERAGE_START) return (false, SessionCalendar.Reason.OUT_OF_RANGE, 0, 0);
        uint256 local = timestamp - _offsetAt(timestamp);
        day = local / 1 days;
        if (day >= endDay) return (false, SessionCalendar.Reason.OUT_OF_RANGE, 0, 0);
        secondOfDay = local % 1 days;
        SessionCalendar.DayKind kind = _dayKind(SessionCalendar.sessionDay(sessionType, day, secondOfDay));
        (open, reason) = SessionCalendar.decide(sessionType, secondOfDay, kind);
    }

    /// @dev The opening instant of a session that _session found open at a local day and time. ALL_DAY walks back
    /// over the full trading days before the session day. A weekend, a holiday or an early close ends the walk, so it
    /// takes at most four steps and never goes below FIRST_DAY, where _dayKind stops being TRADING.
    function _openedAt(SessionCalendar.SessionType sessionType, uint256 day, uint256 secondOfDay)
        private
        view
        returns (uint256)
    {
        if (sessionType == SessionCalendar.SessionType.REGULAR) return _utcTime(day, SessionCalendar.REGULAR_OPEN);
        uint256 firstSessionDay = SessionCalendar.sessionDay(sessionType, day, secondOfDay);
        while (_dayKind(firstSessionDay - 1) == SessionCalendar.DayKind.TRADING) {
            --firstSessionDay;
        }
        return _utcTime(firstSessionDay - 1, SessionCalendar.ALL_DAY_START);
    }

    /// @dev A listed day overrides the library, which answers the rest of 2026 and 2027. A write lists a day only to
    /// close it further, so an override never reopens a day.
    function _dayKind(uint256 day) private view returns (SessionCalendar.DayKind) {
        if (SessionCalendar.isWeekend(day)) return SessionCalendar.DayKind.WEEKEND;
        if (day < SessionCalendar.FIRST_DAY || day >= endDay) return SessionCalendar.DayKind.UNKNOWN;
        SessionCalendar.DayKind listed = _listed[day];
        if (listed != SessionCalendar.DayKind.UNKNOWN) return listed;
        if (day < SessionCalendar.END_DAY) return SessionCalendar.dayKind(day);
        return SessionCalendar.DayKind.TRADING;
    }

    /// @dev The offset the last switch at or before the timestamp switched to, or EST before the first switch.
    function _offsetAt(uint256 timestamp) private view returns (uint256) {
        uint256 low;
        uint256 high = _switches.length;
        while (low < high) {
            uint256 mid = (low + high) / 2;
            if (_switches[mid].at > timestamp) high = mid;
            else low = mid + 1;
        }
        return low == 0 ? SessionCalendar.STANDARD_OFFSET : _switches[low - 1].offset;
    }

    /// @dev The UTC instant of a New York wall-clock time that no switch comes within an hour of. That holds for every
    /// time asked here, 20:00 before a trading day, 09:30 on one and midnight on 1 January, because every switch is
    /// 02:00 on a Sunday of a covered year.
    function _utcTime(uint256 day, uint256 secondOfDay) private view returns (uint256) {
        uint256 onDaylightTime = day * 1 days + secondOfDay + SessionCalendar.DAYLIGHT_OFFSET;
        if (_offsetAt(onDaylightTime) == SessionCalendar.DAYLIGHT_OFFSET) return onDaylightTime;
        return onDaylightTime + (SessionCalendar.STANDARD_OFFSET - SessionCalendar.DAYLIGHT_OFFSET);
    }

    /// @dev Index of the switch at exactly the instant given.
    function _indexOf(uint256 at) private view returns (uint256 index) {
        uint256 high = _switches.length;
        while (index < high) {
            uint256 mid = (index + high) / 2;
            if (_switches[mid].at < at) index = mid + 1;
            else high = mid;
        }
        if (index == _switches.length || _switches[index].at != at) revert SwitchNotFound(at);
    }

    /// @dev Checks and stores an appended year's switches. Each is on a later day than the one before it, inside the
    /// year, and changes the offset.
    function _appendSwitches(SessionCalendar.OffsetSwitch[] calldata switches, uint256 firstDay, uint256 yearEndDay)
        private
    {
        uint256 offsetBefore = _switches[_switches.length - 1].offset;
        uint256 earliestDay = firstDay;
        for (uint256 i; i < switches.length; ++i) {
            SessionCalendar.OffsetSwitch calldata change = switches[i];
            uint256 day = change.at / 1 days;
            if (day < earliestDay || day >= yearEndDay || !_isSwitchInstant(change.at)) {
                revert InvalidSwitch(change.at);
            }
            if (!_isOffset(change.offset) || change.offset == offsetBefore) revert InvalidOffset(change.offset);
            _switches.push(change);
            offsetBefore = change.offset;
            earliestDay = day + 1;
        }
    }

    /// @dev A weekday inside [firstDay, yearEndDay), above the entry before it in the list, and not listed yet.
    function _isListable(uint256[] calldata list, uint256 i, uint256 firstDay, uint256 yearEndDay)
        private
        view
        returns (bool)
    {
        uint256 day = list[i];
        return day >= firstDay && day < yearEndDay && (i == 0 || day > list[i - 1]) && !SessionCalendar.isWeekend(day)
            && _listed[day] == SessionCalendar.DayKind.UNKNOWN;
    }

    /// @dev 02:00 New York time on a Sunday on either offset, which is 06:00Z or 07:00Z of that Sunday.
    function _isSwitchInstant(uint256 at) private pure returns (bool) {
        uint256 timeOfDay = at % 1 days;
        return SessionCalendar.weekday(at / 1 days) == SessionCalendar.SUNDAY
            && (timeOfDay == SessionCalendar.SWITCH_TIME + SessionCalendar.DAYLIGHT_OFFSET
                || timeOfDay == SessionCalendar.SWITCH_TIME + SessionCalendar.STANDARD_OFFSET);
    }

    function _isOffset(uint256 offset) private pure returns (bool) {
        return offset == SessionCalendar.DAYLIGHT_OFFSET || offset == SessionCalendar.STANDARD_OFFSET;
    }

    function _bumpVersion() private returns (uint32) {
        uint16 count = writeCount;
        if (count == type(uint16).max) revert WriteLimitReached();
        writeCount = count + 1;
        return version();
    }

    /// @dev 366 in a Gregorian leap year, otherwise 365: the only calendar rule here, used to move coverage by exactly
    /// one year.
    function _daysIn(uint256 year) private pure returns (uint256) {
        bool leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        return leap ? 366 : 365;
    }
}
