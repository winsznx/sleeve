// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SessionCalendar
/// @notice Says whether a ticker's market session is open at a timestamp, and when the open session began, for New
/// York calendar years 2026 and 2027. The schedule runs on New York time from precomputed daylight-saving instants and
/// the NYSE holiday and early-close lists. Sources and checks are in docs/research/session-calendar.md.
/// SessionCalendarExtension applies the same rule to later years and to changes made through the timelock, and it is
/// the calendar SleeveModule reads.
/// @dev Internal pure functions only: no external calls, no storage, no events. A New York date is a day number, the
/// days since 1970-01-01, and every conversion is day-number arithmetic against the constants below, never general
/// calendar math. Sessions are half-open: open at the opening second, closed at the closing second. Every answer
/// fails closed. A timestamp outside the covered years is closed with reason OUT_OF_RANGE, and the zero value of each
/// enum reads closed.
library SessionCalendar {
    /// @notice A ticker's market session, set per ticker from the issuer's assets API.
    /// @dev NONE is the zero value and never opens: an unset ticker, or one with no tradable session. ALL_DAY is the
    /// 24/5 session, for a ticker whose tradingCapabilities.overnight.whole is TRADING_STATUS_TRADABLE, which covers
    /// all four launch tickers. REGULAR is 09:30 to 16:00 New York time, the safe type for a ticker that loses
    /// overnight trading. There is no extended-hours type, because its start time is unsettled (research Q2).
    enum SessionType {
        NONE,
        ALL_DAY,
        REGULAR
    }

    /// @notice Why a session is open or closed. The numbering never changes, because the keeper, the app and the
    /// verifier read it.
    /// @dev NO_SESSION: the session type is NONE. It is the zero value, so an unset reason reads closed. OPEN: the
    /// session is open. WEEKEND: Saturday or Sunday, or the evening before one. HOLIDAY: an NYSE full-day closure, a
    /// listed holiday or one added through the extension, or the evening before one. EARLY_CLOSE: a half-day after its
    /// early close, until the time a full day would close. OUTSIDE_HOURS: a trading day outside REGULAR hours.
    /// OUT_OF_RANGE: the calendar has no data for the timestamp.
    enum Reason {
        NO_SESSION,
        OPEN,
        WEEKEND,
        HOLIDAY,
        EARLY_CLOSE,
        OUTSIDE_HOURS,
        OUT_OF_RANGE
    }

    /// @notice What a New York calendar day is for the market.
    /// @dev UNKNOWN is the zero value: a weekday outside the covered years. It reads closed with OUT_OF_RANGE.
    enum DayKind {
        UNKNOWN,
        TRADING,
        EARLY_CLOSE,
        HOLIDAY,
        WEEKEND
    }

    /// @notice A change of New York's UTC offset: from `at` on, New York is `offset` seconds behind UTC.
    struct OffsetSwitch {
        uint64 at;
        uint32 offset;
    }

    /// @notice Version of the built-in data and rules. SessionCalendarExtension.version() carries it in its high 16
    /// bits, and receipts record that. Any change to the data or the rules ships as a new version in a new library and
    /// module.
    uint16 internal constant CALENDAR_VERSION = 1;

    /// @notice First covered instant: Thu 2026-01-01 00:00 EST, 2026-01-01T05:00:00Z.
    uint256 internal constant COVERAGE_START = 1_767_243_600;

    /// @notice First instant after coverage: Sat 2028-01-01 00:00 EST, 2028-01-01T05:00:00Z.
    uint256 internal constant COVERAGE_END = 1_830_315_600;

    /// @notice First covered New York day, Thu 1 Jan 2026, as a day number.
    uint256 internal constant FIRST_DAY = 20_454;

    /// @notice First New York day after coverage, Sat 1 Jan 2028, as a day number.
    uint256 internal constant END_DAY = 21_184;

    /// @notice Last covered New York calendar year.
    uint256 internal constant LAST_YEAR = 2027;

    /// @notice How far New York is behind UTC on standard time, EST.
    uint32 internal constant STANDARD_OFFSET = 5 hours;

    /// @notice How far New York is behind UTC on daylight-saving time, EDT.
    uint32 internal constant DAYLIGHT_OFFSET = 4 hours;

    /// @notice New York time of every daylight-saving switch, in seconds after midnight.
    uint256 internal constant SWITCH_TIME = 2 hours;

    /// @notice weekday() of a Sunday.
    uint256 internal constant SUNDAY = 0;

    /// @notice weekday() of a Saturday.
    uint256 internal constant SATURDAY = 6;

    /// @notice 20:00 New York time, in seconds after midnight. The ALL_DAY session for trading day D opens at this time
    /// on the calendar day before D and, unless D closes early, closes at this time on D.
    uint256 internal constant ALL_DAY_START = 20 hours;

    /// @notice 17:00 New York time, the ALL_DAY close on an early-close day. Research Q3: Robinhood's 24 Hour Market
    /// and NYSE's late sessions end at 17:00 on a half-day. Not seen onchain before 27 Nov 2026.
    uint256 internal constant ALL_DAY_EARLY_CLOSE = 17 hours;

    /// @notice 09:30 New York time, the REGULAR open.
    uint256 internal constant REGULAR_OPEN = 9 hours + 30 minutes;

    /// @notice 16:00 New York time, the REGULAR close.
    uint256 internal constant REGULAR_CLOSE = 16 hours;

    /// @notice 13:00 New York time, the REGULAR close on an early-close day.
    uint256 internal constant REGULAR_EARLY_CLOSE = 13 hours;

    // Daylight saving: New York is on EDT from each start, inclusive, to the matching end, exclusive, and on EST
    // otherwise. Every switch is at 02:00 local time on a Sunday, inside the weekend closure, so no session spans one.
    // Computed with zoneinfo America/New_York, which matches 15 U.S.C. 260a(a).
    uint64 internal constant DAYLIGHT_START_2026 = 1_772_953_200; // Sun 2026-03-08 02:00 EST, 07:00Z
    uint64 internal constant DAYLIGHT_END_2026 = 1_793_512_800; // Sun 2026-11-01 02:00 EDT, 06:00Z
    uint64 internal constant DAYLIGHT_START_2027 = 1_805_007_600; // Sun 2027-03-14 02:00 EST, 07:00Z
    uint64 internal constant DAYLIGHT_END_2027 = 1_825_567_200; // Sun 2027-11-07 02:00 EDT, 06:00Z

    // NYSE full-day holidays as day numbers, from nyse.com/trade/hours-calendars, read 2026-10-02.
    uint256 private constant NEW_YEARS_DAY_2026 = 20_454; // Thu 1 Jan 2026
    uint256 private constant MARTIN_LUTHER_KING_JR_DAY_2026 = 20_472; // Mon 19 Jan 2026
    uint256 private constant WASHINGTONS_BIRTHDAY_2026 = 20_500; // Mon 16 Feb 2026
    uint256 private constant GOOD_FRIDAY_2026 = 20_546; // Fri 3 Apr 2026
    uint256 private constant MEMORIAL_DAY_2026 = 20_598; // Mon 25 May 2026
    uint256 private constant JUNETEENTH_2026 = 20_623; // Fri 19 Jun 2026
    uint256 private constant INDEPENDENCE_DAY_2026 = 20_637; // Fri 3 Jul 2026, observed
    uint256 private constant LABOR_DAY_2026 = 20_703; // Mon 7 Sep 2026
    uint256 private constant THANKSGIVING_DAY_2026 = 20_783; // Thu 26 Nov 2026
    uint256 private constant CHRISTMAS_DAY_2026 = 20_812; // Fri 25 Dec 2026
    uint256 private constant NEW_YEARS_DAY_2027 = 20_819; // Fri 1 Jan 2027
    uint256 private constant MARTIN_LUTHER_KING_JR_DAY_2027 = 20_836; // Mon 18 Jan 2027
    uint256 private constant WASHINGTONS_BIRTHDAY_2027 = 20_864; // Mon 15 Feb 2027
    uint256 private constant GOOD_FRIDAY_2027 = 20_903; // Fri 26 Mar 2027
    uint256 private constant MEMORIAL_DAY_2027 = 20_969; // Mon 31 May 2027
    uint256 private constant JUNETEENTH_2027 = 20_987; // Fri 18 Jun 2027, observed
    uint256 private constant INDEPENDENCE_DAY_2027 = 21_004; // Mon 5 Jul 2027, observed
    uint256 private constant LABOR_DAY_2027 = 21_067; // Mon 6 Sep 2027
    uint256 private constant THANKSGIVING_DAY_2027 = 21_147; // Thu 25 Nov 2027
    uint256 private constant CHRISTMAS_DAY_2027 = 21_176; // Fri 24 Dec 2027, observed

    // NYSE early closes as day numbers, same source: 13:00 for REGULAR, 17:00 for ALL_DAY.
    uint256 private constant DAY_AFTER_THANKSGIVING_2026 = 20_784; // Fri 27 Nov 2026
    uint256 private constant CHRISTMAS_EVE_2026 = 20_811; // Thu 24 Dec 2026
    uint256 private constant DAY_AFTER_THANKSGIVING_2027 = 21_148; // Fri 26 Nov 2027

    /// @notice sessionOpenedAt was asked about a timestamp at which the session is closed.
    /// @param timestamp The timestamp given.
    /// @param reason Why the session is closed then, as isOpen gives it.
    error SessionClosed(uint256 timestamp, Reason reason);

    /// @notice localTime was given a timestamp outside coverage, where the library does not know New York's offset.
    /// @param timestamp The timestamp given.
    error TimestampOutOfRange(uint256 timestamp);

    /// @notice Whether a session type's market session is open at a timestamp, and why. Never reverts.
    /// @param timestamp Seconds since the Unix epoch, as in block.timestamp.
    /// @param sessionType The ticker's session type.
    /// @return open True only while the session is open.
    /// @return reason OPEN when open, otherwise why it is closed. NO_SESSION for type NONE at every timestamp, and
    /// OUT_OF_RANGE for every other type outside coverage.
    function isOpen(uint256 timestamp, SessionType sessionType) internal pure returns (bool open, Reason reason) {
        (open, reason,,) = _session(timestamp, sessionType);
    }

    /// @notice When the session open at a timestamp began: the end of the most recent closure, which starts the
    /// unbroken open stretch that contains the timestamp. For ALL_DAY that is the 20:00 New York reopen after a
    /// weekend, a holiday or an early close, so every instant of a normal week gives the Sunday 20:00 reopen. For
    /// REGULAR it is 09:30 that day. PriceGuard refuses a feed round from before it (research Q4), and the public
    /// settle grace counts from it.
    /// @dev ALL_DAY walks back over the full trading days before the session day. A weekend, a holiday or an early
    /// close ends the walk, so it takes at most four steps.
    /// @param timestamp Seconds since the Unix epoch.
    /// @param sessionType The ticker's session type.
    /// @return The opening instant, at or before the timestamp. When the session is closed, reverts with
    /// SessionClosed and the reason isOpen gives, so a closed session never yields an instant to compare against.
    function sessionOpenedAt(uint256 timestamp, SessionType sessionType) internal pure returns (uint256) {
        (bool open, Reason reason, uint256 day, uint256 secondOfDay) = _session(timestamp, sessionType);
        if (!open) revert SessionClosed(timestamp, reason);
        if (sessionType == SessionType.REGULAR) return _utcTime(day, REGULAR_OPEN);
        uint256 firstSessionDay = sessionDay(sessionType, day, secondOfDay);
        while (dayKind(firstSessionDay - 1) == DayKind.TRADING) {
            --firstSessionDay;
        }
        return _utcTime(firstSessionDay - 1, ALL_DAY_START);
    }

    /// @notice The session rule on its own, so SessionCalendarExtension applies the same rule to its own data.
    /// @dev ALL_DAY is open on any trading session day except from 17:00 to 20:00 on an early-close day. REGULAR is
    /// open on a trading day from 09:30 to 16:00, or 13:00 on an early-close day.
    /// @param sessionType The ticker's session type.
    /// @param secondOfDay Seconds since New York midnight, below 1 days.
    /// @param kind What sessionDay(sessionType, day, secondOfDay) is for the market.
    /// @return open True only while the session is open.
    /// @return reason OPEN when open, otherwise why it is closed. An UNKNOWN day gives OUT_OF_RANGE.
    function decide(SessionType sessionType, uint256 secondOfDay, DayKind kind)
        internal
        pure
        returns (bool open, Reason reason)
    {
        if (sessionType == SessionType.NONE) return (false, Reason.NO_SESSION);
        if (kind == DayKind.WEEKEND) return (false, Reason.WEEKEND);
        if (kind == DayKind.HOLIDAY) return (false, Reason.HOLIDAY);
        if (kind != DayKind.TRADING && kind != DayKind.EARLY_CLOSE) return (false, Reason.OUT_OF_RANGE);
        bool earlyClose = kind == DayKind.EARLY_CLOSE;
        if (sessionType == SessionType.ALL_DAY) {
            if (earlyClose && secondOfDay >= ALL_DAY_EARLY_CLOSE && secondOfDay < ALL_DAY_START) {
                return (false, Reason.EARLY_CLOSE);
            }
            return (true, Reason.OPEN);
        }
        if (secondOfDay < REGULAR_OPEN) return (false, Reason.OUTSIDE_HOURS);
        if (secondOfDay < (earlyClose ? REGULAR_EARLY_CLOSE : REGULAR_CLOSE)) return (true, Reason.OPEN);
        if (secondOfDay < REGULAR_CLOSE) return (false, Reason.EARLY_CLOSE);
        return (false, Reason.OUTSIDE_HOURS);
    }

    /// @notice The trading day whose session an instant belongs to. The ALL_DAY session that opens at 20:00 trades for
    /// the next calendar day, so from 20:00 on it is the next day. Otherwise it is the same day.
    /// @param sessionType The ticker's session type.
    /// @param day New York day number of the instant.
    /// @param secondOfDay Seconds since New York midnight of the instant.
    /// @return The day number of the session day.
    function sessionDay(SessionType sessionType, uint256 day, uint256 secondOfDay) internal pure returns (uint256) {
        if (sessionType == SessionType.ALL_DAY && secondOfDay >= ALL_DAY_START) return day + 1;
        return day;
    }

    /// @notice What a New York day is for the market, from the built-in lists.
    /// @dev Weekends follow from the day number alone, so any Saturday or Sunday is WEEKEND even outside coverage.
    /// That lets 31 Dec 2027 after 20:00 read WEEKEND, because 1 Jan 2028 is a Saturday.
    /// @param day New York day number.
    /// @return WEEKEND, HOLIDAY, EARLY_CLOSE or TRADING, or UNKNOWN for a weekday outside coverage.
    function dayKind(uint256 day) internal pure returns (DayKind) {
        if (isWeekend(day)) return DayKind.WEEKEND;
        if (day < FIRST_DAY || day >= END_DAY) return DayKind.UNKNOWN;
        if (_isHoliday(day)) return DayKind.HOLIDAY;
        if (_isEarlyClose(day)) return DayKind.EARLY_CLOSE;
        return DayKind.TRADING;
    }

    /// @notice The built-in UTC-offset switches, ascending. New York is on EST before the first.
    /// @return switches The 2026 and 2027 daylight-saving starts and ends, each with the offset it switches to.
    function builtInSwitches() internal pure returns (OffsetSwitch[4] memory switches) {
        switches[0] = OffsetSwitch(DAYLIGHT_START_2026, DAYLIGHT_OFFSET);
        switches[1] = OffsetSwitch(DAYLIGHT_END_2026, STANDARD_OFFSET);
        switches[2] = OffsetSwitch(DAYLIGHT_START_2027, DAYLIGHT_OFFSET);
        switches[3] = OffsetSwitch(DAYLIGHT_END_2027, STANDARD_OFFSET);
    }

    /// @notice New York date and time of day at a covered timestamp.
    /// @param timestamp Seconds since the Unix epoch, inside coverage.
    /// @return day New York day number.
    /// @return secondOfDay Seconds since New York midnight.
    function localTime(uint256 timestamp) internal pure returns (uint256 day, uint256 secondOfDay) {
        if (timestamp < COVERAGE_START || timestamp >= COVERAGE_END) revert TimestampOutOfRange(timestamp);
        uint256 local = timestamp - _utcOffset(timestamp);
        return (local / 1 days, local % 1 days);
    }

    /// @notice Whether a day number is a Saturday or a Sunday.
    /// @param day A day number.
    /// @return True on Saturday and Sunday.
    function isWeekend(uint256 day) internal pure returns (bool) {
        uint256 dayOfWeek = weekday(day);
        return dayOfWeek == SATURDAY || dayOfWeek == SUNDAY;
    }

    /// @notice Day of the week of a day number, 0 for Sunday to 6 for Saturday. Defined for every uint256.
    /// @param day A day number.
    /// @return SUNDAY, 0, up to SATURDAY, 6. Day 0, 1 Jan 1970, was a Thursday, 4.
    function weekday(uint256 day) internal pure returns (uint256) {
        return (day % 7 + 4) % 7;
    }

    /// @dev isOpen plus the local day and time, which sessionOpenedAt reuses. Both are zero when the session type is
    /// NONE or the timestamp is outside coverage.
    function _session(uint256 timestamp, SessionType sessionType)
        private
        pure
        returns (bool open, Reason reason, uint256 day, uint256 secondOfDay)
    {
        if (sessionType == SessionType.NONE) return (false, Reason.NO_SESSION, 0, 0);
        if (timestamp < COVERAGE_START || timestamp >= COVERAGE_END) return (false, Reason.OUT_OF_RANGE, 0, 0);
        (day, secondOfDay) = localTime(timestamp);
        (open, reason) = decide(sessionType, secondOfDay, dayKind(sessionDay(sessionType, day, secondOfDay)));
    }

    /// @dev Exact inside coverage, where the four switches are the only offset changes.
    function _utcOffset(uint256 timestamp) private pure returns (uint256) {
        bool daylight = (timestamp >= DAYLIGHT_START_2026 && timestamp < DAYLIGHT_END_2026)
            || (timestamp >= DAYLIGHT_START_2027 && timestamp < DAYLIGHT_END_2027);
        return daylight ? DAYLIGHT_OFFSET : STANDARD_OFFSET;
    }

    /// @dev The UTC instant of a covered New York wall-clock time from 03:00 to midnight. Such a time is never in the
    /// hour a switch skips or repeats, because every switch is at 02:00, so it has exactly one offset.
    function _utcTime(uint256 day, uint256 secondOfDay) private pure returns (uint256) {
        uint256 onDaylightTime = day * 1 days + secondOfDay + DAYLIGHT_OFFSET;
        if (_utcOffset(onDaylightTime) == DAYLIGHT_OFFSET) return onDaylightTime;
        return onDaylightTime + (STANDARD_OFFSET - DAYLIGHT_OFFSET);
    }

    function _isHoliday(uint256 day) private pure returns (bool) {
        return day == NEW_YEARS_DAY_2026 || day == MARTIN_LUTHER_KING_JR_DAY_2026 || day == WASHINGTONS_BIRTHDAY_2026
            || day == GOOD_FRIDAY_2026 || day == MEMORIAL_DAY_2026 || day == JUNETEENTH_2026
            || day == INDEPENDENCE_DAY_2026 || day == LABOR_DAY_2026 || day == THANKSGIVING_DAY_2026
            || day == CHRISTMAS_DAY_2026 || day == NEW_YEARS_DAY_2027 || day == MARTIN_LUTHER_KING_JR_DAY_2027
            || day == WASHINGTONS_BIRTHDAY_2027 || day == GOOD_FRIDAY_2027 || day == MEMORIAL_DAY_2027
            || day == JUNETEENTH_2027 || day == INDEPENDENCE_DAY_2027 || day == LABOR_DAY_2027
            || day == THANKSGIVING_DAY_2027 || day == CHRISTMAS_DAY_2027;
    }

    function _isEarlyClose(uint256 day) private pure returns (bool) {
        return day == DAY_AFTER_THANKSGIVING_2026 || day == CHRISTMAS_EVE_2026 || day == DAY_AFTER_THANKSGIVING_2027;
    }
}
