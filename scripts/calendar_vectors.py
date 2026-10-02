#!/usr/bin/env python3
"""Differential oracle for SessionCalendar and SessionCalendarExtension.

Writes two fixtures that the Solidity tests replay with vm.readFile and vm.parseJson:

  contracts/test/fixtures/calendar_vectors.json
      The built-in calendar, New York years 2026 and 2027. For ALL_DAY and REGULAR, what isOpen and
      sessionOpenedAt answer at every boundary instant at -1 s, 0 s and +1 s, and at 3,000 seeded random
      timestamps.
  contracts/test/fixtures/calendar_extension_vectors.json
      The same for two extension states. "append2028" appends 2028, from the NYSE 2028 column quoted in the
      research note: test input, not reviewed production data. "writes" adds closures and early closes inside
      2026 and 2027 and replaces the daylight-saving switches that a permanent-daylight-time law would remove.

The oracle shares no code and no derived data with the contracts. Local time comes from zoneinfo
America/New_York, or for the "writes" state from a fixed UTC-4 after the March 2026 switch, and dates come from
datetime, never from the contracts' instants or day numbers. Holidays and early closes are R4 and R5 of
docs/research/session-calendar.md. sessionOpenedAt comes from merged open intervals, not from the contracts'
walk back over trading days, and each vector is answered by both the point rule and the intervals, which must
agree. Before writing, the script checks itself against the research note: the daylight-saving instants, the
107 open intervals, every holiday closure and NYSE's monthly trading-day counts.

Usage, from anywhere:
    python3 scripts/calendar_vectors.py           write both fixtures
    python3 scripts/calendar_vectors.py --check   exit 1 if a fixture on disk is not what this script writes
"""

import argparse
import json
import sys
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

FIXTURES = Path(__file__).resolve().parent.parent / "contracts" / "test" / "fixtures"
BUILT_IN_FIXTURE = FIXTURES / "calendar_vectors.json"
EXTENSION_FIXTURE = FIXTURES / "calendar_extension_vectors.json"

NY = ZoneInfo("America/New_York")
CALENDAR_VERSION = 1
SEED = 4663
RANDOM_BUILT_IN = 3000
RANDOM_EXTENSION = 1000

# SessionCalendar.Reason, in enum order.
NO_SESSION, OPEN, WEEKEND, HOLIDAY, EARLY_CLOSE, OUTSIDE_HOURS, OUT_OF_RANGE = range(7)

# SessionCalendar.DayKind, in enum order.
DAY_UNKNOWN, DAY_TRADING, DAY_EARLY_CLOSE, DAY_HOLIDAY, DAY_WEEKEND = range(5)

ALL_DAY_START = (20, 0)
ALL_DAY_EARLY_CLOSE = (17, 0)
REGULAR_OPEN = (9, 30)
REGULAR_CLOSE = (16, 0)
REGULAR_EARLY_CLOSE = (13, 0)

# R4: NYSE full-day holidays, 2026 and 2027.
HOLIDAYS = {
    date(2026, 1, 1): "New Year's Day",
    date(2026, 1, 19): "Martin Luther King, Jr. Day",
    date(2026, 2, 16): "Washington's Birthday",
    date(2026, 4, 3): "Good Friday",
    date(2026, 5, 25): "Memorial Day",
    date(2026, 6, 19): "Juneteenth",
    date(2026, 7, 3): "Independence Day observed",
    date(2026, 9, 7): "Labor Day",
    date(2026, 11, 26): "Thanksgiving Day",
    date(2026, 12, 25): "Christmas Day",
    date(2027, 1, 1): "New Year's Day",
    date(2027, 1, 18): "Martin Luther King, Jr. Day",
    date(2027, 2, 15): "Washington's Birthday",
    date(2027, 3, 26): "Good Friday",
    date(2027, 5, 31): "Memorial Day",
    date(2027, 6, 18): "Juneteenth observed",
    date(2027, 7, 5): "Independence Day observed",
    date(2027, 9, 6): "Labor Day",
    date(2027, 11, 25): "Thanksgiving Day",
    date(2027, 12, 24): "Christmas Day observed",
}

# R5: early closes. The regular session ends at 13:00 and the ALL_DAY session at 17:00.
EARLY_CLOSES = {
    date(2026, 11, 27): "day after Thanksgiving",
    date(2026, 12, 24): "Christmas Eve",
    date(2027, 11, 26): "day after Thanksgiving",
}

# Extension test input only: the 2028 column of the NYSE table quoted in the research note, and the 24 Nov 2028
# early close from its footnote ***. The note does not quote footnote ** on Tuesday 4 July 2028, so a production
# 2028 proposal must check it for an early close on Monday 3 July.
HOLIDAYS_2028 = {
    date(2028, 1, 17): "Martin Luther King, Jr. Day",
    date(2028, 2, 21): "Washington's Birthday",
    date(2028, 4, 14): "Good Friday",
    date(2028, 5, 29): "Memorial Day",
    date(2028, 6, 19): "Juneteenth",
    date(2028, 7, 4): "Independence Day",
    date(2028, 9, 4): "Labor Day",
    date(2028, 11, 23): "Thanksgiving Day",
    date(2028, 12, 25): "Christmas Day",
}
EARLY_CLOSES_2028 = {date(2028, 11, 24): "day after Thanksgiving"}

# Extension test input only: unscheduled changes inside the built-in years. Two full-day closures, one of them on
# an early-close day, and three early closes: one the day before an existing early close, one midweek before a
# trading day, and one before a Monday holiday.
ADDED_CLOSURES = {
    date(2026, 11, 27): "added closure on the day after Thanksgiving",
    date(2026, 12, 9): "added closure, midweek",
}
ADDED_EARLY_CLOSES = {
    date(2026, 12, 23): "added early close before Christmas Eve",
    date(2027, 6, 30): "added early close, midweek",
    date(2027, 7, 2): "added early close before Independence Day observed",
}

# Section 3 of the research note: every America/New_York offset change from mid 2025 to the end of 2028.
RESEARCH_SWITCHES = [1762063200, 1772953200, 1793512800, 1805007600, 1825567200, 1836457200, 1857016800]

# Section 5 of the research note: when the ALL_DAY session closes for each holiday, and when it reopens.
RESEARCH_HOLIDAY_CLOSURES = [
    (1767229200, 1767315600),
    (1768611600, 1768870800),
    (1771030800, 1771290000),
    (1775174400, 1775433600),
    (1779494400, 1779753600),
    (1781827200, 1782086400),
    (1783036800, 1783296000),
    (1788566400, 1788825600),
    (1795654800, 1795741200),
    (1798149600, 1798419600),
    (1798765200, 1799024400),
    (1800061200, 1800320400),
    (1802480400, 1802739600),
    (1806019200, 1806278400),
    (1811548800, 1811808000),
    (1813276800, 1813536000),
    (1814572800, 1814832000),
    (1820016000, 1820275200),
    (1827104400, 1827190800),
    (1829610000, 1829869200),
]

# NYSE Trading_Days.pdf: US cash equities trading days per month.
NYSE_TRADING_DAYS = {
    2026: [20, 19, 22, 21, 20, 21, 22, 21, 21, 22, 20, 22],
    2027: [19, 19, 22, 22, 20, 21, 21, 22, 21, 21, 21, 22],
}


def seconds(clock: tuple[int, int]) -> int:
    return clock[0] * 3600 + clock[1] * 60


def utc_offset(ts: int) -> timedelta:
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY).utcoffset()


def wall_clock(dt: datetime) -> tuple[date, int]:
    return dt.date(), dt.hour * 3600 + dt.minute * 60 + dt.second


class NewYorkTime:
    """America/New_York from zoneinfo, under current law."""

    def local(self, ts: int) -> tuple[date, int]:
        return wall_clock(datetime.fromtimestamp(ts, tz=timezone.utc).astimezone(NY))

    def instant(self, day: date, clock: tuple[int, int]) -> int:
        """UTC instant of a wall-clock time. Every clock time used here exists exactly once on every day."""
        return int(datetime.combine(day, time(*clock), tzinfo=NY).timestamp())

    def describe(self, ts: int) -> str:
        day, sec = self.local(ts)
        behind = (ts - day_number(day) * 86400 - sec) // 3600
        return f"{day.strftime('%a %Y-%m-%d')} {sec // 3600:02d}:{sec // 60 % 60:02d}:{sec % 60:02d} UTC-{behind}"


class PermanentDaylightTime(NewYorkTime):
    """New York if the clocks never fall back after the March 2026 switch, which is what H.R. 139 would do if it
    became law before 1 November 2026: zoneinfo before the switch and UTC-4 from it on."""

    SINCE = int(datetime(2026, 3, 8, 7, tzinfo=timezone.utc).timestamp())
    OFFSET = timedelta(hours=-4)
    FIRST_WALL_CLOCK = (datetime.fromtimestamp(SINCE, tz=timezone.utc) + OFFSET).replace(tzinfo=None)

    def local(self, ts: int) -> tuple[date, int]:
        if ts < self.SINCE:
            return super().local(ts)
        return wall_clock(datetime.fromtimestamp(ts, tz=timezone.utc) + self.OFFSET)

    def instant(self, day: date, clock: tuple[int, int]) -> int:
        wall = datetime.combine(day, time(*clock))
        if wall < self.FIRST_WALL_CLOCK:
            return super().instant(day, clock)
        return int((wall - self.OFFSET).replace(tzinfo=timezone.utc).timestamp())


@dataclass(frozen=True)
class Calendar:
    """New York days in [first, end), with their holidays and early closes, on a time model."""

    first: date
    end: date
    holidays: frozenset
    early_closes: frozenset
    clock: NewYorkTime = field(default_factory=NewYorkTime)

    @property
    def start_ts(self) -> int:
        return self.clock.instant(self.first, (0, 0))

    @property
    def end_ts(self) -> int:
        return self.clock.instant(self.end, (0, 0))

    def kind(self, day: date) -> int:
        if day.weekday() >= 5:
            return DAY_WEEKEND
        if not self.first <= day < self.end:
            return DAY_UNKNOWN
        if day in self.holidays:
            return DAY_HOLIDAY
        if day in self.early_closes:
            return DAY_EARLY_CLOSE
        return DAY_TRADING

    def trading_days(self) -> list[date]:
        days = (self.first + timedelta(days=n) for n in range((self.end - self.first).days))
        return [day for day in days if self.kind(day) in (DAY_TRADING, DAY_EARLY_CLOSE)]

    def all_day(self, ts: int) -> tuple[bool, int]:
        """R2, point form."""
        if not self.start_ts <= ts < self.end_ts:
            return False, OUT_OF_RANGE
        day, sec = self.clock.local(ts)
        if sec >= seconds(ALL_DAY_START):
            tomorrow = self.kind(day + timedelta(days=1))
            if tomorrow in (DAY_TRADING, DAY_EARLY_CLOSE):
                return True, OPEN
            return False, closed_reason(tomorrow)
        today = self.kind(day)
        if today == DAY_TRADING:
            return True, OPEN
        if today == DAY_EARLY_CLOSE:
            return (True, OPEN) if sec < seconds(ALL_DAY_EARLY_CLOSE) else (False, EARLY_CLOSE)
        return False, closed_reason(today)

    def regular(self, ts: int) -> tuple[bool, int]:
        """R6: trading days 09:30 to 16:00, 13:00 on early-close days."""
        if not self.start_ts <= ts < self.end_ts:
            return False, OUT_OF_RANGE
        day, sec = self.clock.local(ts)
        today = self.kind(day)
        if today not in (DAY_TRADING, DAY_EARLY_CLOSE):
            return False, closed_reason(today)
        close = REGULAR_EARLY_CLOSE if today == DAY_EARLY_CLOSE else REGULAR_CLOSE
        if seconds(REGULAR_OPEN) <= sec < seconds(close):
            return True, OPEN
        if seconds(close) <= sec < seconds(REGULAR_CLOSE):
            return False, EARLY_CLOSE
        return False, OUTSIDE_HOURS

    def all_day_intervals(self) -> list[tuple[int, int]]:
        """R2, interval form: [20:00 on D-1, 20:00 on D, or 17:00 on an early close) per trading day D, merged."""
        merged: list[list[int]] = []
        for day in self.trading_days():
            opens = self.clock.instant(day - timedelta(days=1), ALL_DAY_START)
            closes = self.clock.instant(day, ALL_DAY_EARLY_CLOSE if day in self.early_closes else ALL_DAY_START)
            if merged and merged[-1][1] == opens:
                merged[-1][1] = closes
            else:
                merged.append([opens, closes])
        return [(o, c) for o, c in merged]

    def regular_intervals(self) -> list[tuple[int, int]]:
        return [
            (
                self.clock.instant(day, REGULAR_OPEN),
                self.clock.instant(day, REGULAR_EARLY_CLOSE if day in self.early_closes else REGULAR_CLOSE),
            )
            for day in self.trading_days()
        ]


def closed_reason(kind: int) -> int:
    return {DAY_WEEKEND: WEEKEND, DAY_HOLIDAY: HOLIDAY}.get(kind, OUT_OF_RANGE)


class Intervals:
    """Sorted half-open intervals."""

    def __init__(self, intervals: list[tuple[int, int]]):
        self.intervals = intervals
        self.opens = [o for o, _ in intervals]

    def opened_at(self, ts: int) -> int:
        """The open of the interval containing ts, or 0 when no interval contains it."""
        i = bisect_right(self.opens, ts) - 1
        if i >= 0 and ts < self.intervals[i][1]:
            return self.intervals[i][0]
        return 0


def offset_switches(first: int, last: int) -> list[int]:
    """Every instant in [first, last) where the America/New_York offset changes, to the second."""
    switches = []
    for hour in range(first, last, 3600):
        if utc_offset(hour) == utc_offset(hour + 3600):
            continue
        lo, hi = hour, hour + 3600
        while hi - lo > 1:
            mid = (lo + hi) // 2
            lo, hi = (mid, hi) if utc_offset(mid) == utc_offset(lo) else (lo, mid)
        switches.append(hi)
    return switches


def seconds_behind_utc(ts: int) -> int:
    return -int(utc_offset(ts).total_seconds())


def splitmix64(seed: int):
    """SplitMix64, so the random timestamps do not depend on Python's own generator."""
    mask = (1 << 64) - 1
    state = seed
    while True:
        state = (state + 0x9E3779B97F4A7C15) & mask
        z = state
        z = ((z ^ (z >> 30)) * 0xBF58476D1CE4E5B9) & mask
        z = ((z ^ (z >> 27)) * 0x94D049BB133111EB) & mask
        yield z ^ (z >> 31)


def random_timestamps(count: int, lo: int, hi: int, seed: int) -> list[int]:
    gen = splitmix64(seed)
    return [lo + next(gen) % (hi - lo) for _ in range(count)]


def boundary_marks(cal: Calendar, first: date, end: date, switches: list[int], names: dict) -> dict:
    """Every instant from first 00:00 to end 00:00 New York time where an answer can change, plus the year edges
    and the daylight-saving switches, each with what it is."""
    lo, hi = cal.clock.instant(first, (0, 0)), cal.clock.instant(end, (0, 0))
    marks: dict[int, set] = defaultdict(set)

    def mark(ts: int, what: str) -> None:
        if lo <= ts <= hi:
            marks[ts].add(what)

    for year in range(first.year, end.year + 1):
        mark(cal.clock.instant(date(year, 1, 1), (0, 0)), "year edge")
    for ts in switches:
        marks[ts].add("current-law daylight-saving switch")
    for o, c in cal.all_day_intervals():
        mark(o, "ALL_DAY opens")
        mark(c, "ALL_DAY closes")
    for o, c in cal.regular_intervals():
        mark(o, "REGULAR opens")
        mark(c, "REGULAR closes")
    for n in range((end - first).days):
        day = first + timedelta(days=n)
        if day.weekday() == 4:
            mark(cal.clock.instant(day, ALL_DAY_START), "Friday 20:00")
        if day.weekday() == 6:
            mark(cal.clock.instant(day, ALL_DAY_START), "Sunday 20:00")
        if day in cal.holidays:
            for clock in (REGULAR_OPEN, REGULAR_CLOSE, ALL_DAY_START):
                mark(cal.clock.instant(day, clock), names[day])
        if day in cal.early_closes:
            for clock in (REGULAR_EARLY_CLOSE, REGULAR_CLOSE, ALL_DAY_EARLY_CLOSE, ALL_DAY_START):
                mark(cal.clock.instant(day, clock), f"early close, {names[day]}")
    return marks


def labelled(marks: dict, prefix: str) -> dict:
    return {ts: {f"{prefix}{what}" for what in whats} for ts, whats in marks.items()}


def merge_marks(*mark_sets: dict) -> dict:
    merged: dict[int, set] = defaultdict(set)
    for marks in mark_sets:
        for ts, whats in marks.items():
            merged[ts] |= whats
    return merged


def vector_block(cal: Calendar, timestamps: list[int]) -> dict:
    """isOpen and sessionOpenedAt for ALL_DAY and REGULAR at each timestamp. sessionOpenedAt is 0 when closed.
    The point form and the interval form must agree."""
    all_day, regular = Intervals(cal.all_day_intervals()), Intervals(cal.regular_intervals())
    keys = ("t", "allDayOpen", "allDayReason", "allDaySessionOpenedAt")
    keys += ("regularOpen", "regularReason", "regularSessionOpenedAt")
    block: dict[str, list] = {key: [] for key in keys}
    for ts in timestamps:
        ad_open, ad_reason = cal.all_day(ts)
        rg_open, rg_reason = cal.regular(ts)
        ad_opened, rg_opened = all_day.opened_at(ts), regular.opened_at(ts)
        if ad_open != (ad_opened != 0) or rg_open != (rg_opened != 0):
            sys.exit(f"point form and interval form disagree at {ts}, {cal.clock.describe(ts)}")
        if rg_open and not ad_open:
            sys.exit(f"REGULAR is open outside ALL_DAY at {ts}, {cal.clock.describe(ts)}")
        for key, value in zip(keys, (ts, ad_open, ad_reason, ad_opened, rg_open, rg_reason, rg_opened)):
            block[key].append(value)
    return block


def boundary_block(cal: Calendar, marks: dict) -> dict:
    """Three vectors per mark, at -1 s, 0 s and +1 s, and one label per mark."""
    instants = sorted(marks)
    if any(b - a < 3 for a, b in zip(instants, instants[1:])):
        sys.exit("two boundary marks are under 3 s apart, so their vectors would overlap")
    labels = [f"{cal.clock.describe(ts)}: {'; '.join(sorted(marks[ts]))}" for ts in instants]
    return {"label": labels, **vector_block(cal, [ts + delta for ts in instants for delta in (-1, 0, 1)])}


def check_against_research(built_in: Calendar, switches: list[int]) -> None:
    if switches != RESEARCH_SWITCHES:
        sys.exit(f"zoneinfo daylight-saving instants {switches} differ from the research note")
    intervals = built_in.all_day_intervals()
    hours = sum(c - o for o, c in intervals) // 3600
    expected = (107, 12039, (1767315600, 1767402000), (1829869200, 1830301200))
    if (len(intervals), hours, intervals[0], intervals[-1]) != expected:
        sys.exit("ALL_DAY intervals differ from section 10 of the research note")
    closures = set(zip((c for _, c in intervals), (o for o, _ in intervals[1:])))
    for close, reopen in RESEARCH_HOLIDAY_CLOSURES:
        produced = intervals[0][0] == reopen if close < built_in.start_ts else (close, reopen) in closures
        if not produced:
            sys.exit(f"holiday closure {close} to {reopen} from section 5 of the research note not produced")
    for year, months in NYSE_TRADING_DAYS.items():
        counted = [sum(1 for d in built_in.trading_days() if (d.year, d.month) == (year, m)) for m in range(1, 13)]
        if counted != months:
            sys.exit(f"{year} trading days per month {counted} differ from NYSE {months}")


def day_number(day: date) -> int:
    return (day - date(1970, 1, 1)).days


def render(value, depth: int = 0) -> str:
    """JSON with one key per line and each array on one line, so the file stays small and diffs stay readable."""
    if not isinstance(value, dict):
        return json.dumps(value, separators=(",", ":"))
    pad = "  " * (depth + 1)
    body = ",\n".join(f"{pad}{json.dumps(key)}: {render(item, depth + 1)}" for key, item in value.items())
    return "{\n" + body + "\n" + "  " * depth + "}"


LAYOUT = (
    "Each vector block holds parallel arrays indexed by vector. A boundary block has three vectors per label, at "
    "t - 1, t and t + 1 of the labelled instant. allDayOpen and allDayReason are what isOpen answers for ALL_DAY, "
    "with reasons in SessionCalendar.Reason numbering, and allDaySessionOpenedAt is what sessionOpenedAt answers: "
    "when the open stretch containing t began, the end of the most recent closure, from the merged open intervals. "
    "It is 0 when the session is closed, where sessionOpenedAt reverts with SessionClosed(t, reason). The regular "
    "keys are the same for REGULAR. Day numbers count days since 1970-01-01."
)


def build_built_in(built_in: Calendar, switches: list[int], names: dict) -> dict:
    in_range = [ts for ts in switches if built_in.start_ts <= ts < built_in.end_ts]
    marks = boundary_marks(built_in, built_in.first, built_in.end, switches, names)
    return {
        "generator": "scripts/calendar_vectors.py",
        "layout": LAYOUT,
        "calendarVersion": CALENDAR_VERSION,
        "coverageStart": built_in.start_ts,
        "coverageEnd": built_in.end_ts,
        "switchAt": in_range,
        "switchOffset": [seconds_behind_utc(ts) for ts in in_range],
        "seed": SEED,
        "boundary": boundary_block(built_in, marks),
        "random": vector_block(
            built_in, random_timestamps(RANDOM_BUILT_IN, built_in.start_ts, built_in.end_ts, SEED)
        ),
    }


def build_append_2028(built_in: Calendar, switches: list[int], names: dict) -> dict:
    extended = Calendar(
        built_in.first,
        date(2029, 1, 1),
        built_in.holidays | frozenset(HOLIDAYS_2028),
        built_in.early_closes | frozenset(EARLY_CLOSES_2028),
    )
    year_start = extended.clock.instant(date(2028, 1, 1), (0, 0))
    switches_2028 = [ts for ts in switches if year_start <= ts < extended.end_ts]
    marks = boundary_marks(extended, date(2028, 1, 1), extended.end, switches_2028, names)
    return {
        "note": "Test input from the NYSE 2028 column of the research note. Not reviewed production data.",
        "year": 2028,
        "switchAt": switches_2028,
        "switchOffset": [seconds_behind_utc(ts) for ts in switches_2028],
        "holidays": sorted(day_number(d) for d in HOLIDAYS_2028),
        "earlyCloses": sorted(day_number(d) for d in EARLY_CLOSES_2028),
        "coverageEnd": extended.end_ts,
        "boundary": boundary_block(extended, marks),
        "random": vector_block(extended, random_timestamps(RANDOM_EXTENSION, year_start, extended.end_ts, SEED + 1)),
    }


def build_writes(built_in: Calendar, switches: list[int], names: dict) -> dict:
    """Closures, early closes and the switch replacements that keep New York on UTC-4 after March 2026."""
    clock = PermanentDaylightTime()
    if clock.SINCE not in switches:
        sys.exit("the permanent daylight time model does not start at a zoneinfo switch")
    written = Calendar(
        built_in.first,
        built_in.end,
        built_in.holidays | frozenset(ADDED_CLOSURES),
        (built_in.early_closes | frozenset(ADDED_EARLY_CLOSES)) - frozenset(ADDED_CLOSURES),
        clock,
    )
    replaced = [ts for ts in switches if clock.SINCE < ts < built_in.end_ts and seconds_behind_utc(ts) != 4 * 3600]
    window = date(2026, 10, 1)
    marks = merge_marks(
        boundary_marks(written, window, written.end, switches, {**names, **ADDED_CLOSURES, **ADDED_EARLY_CLOSES}),
        labelled(boundary_marks(built_in, window, built_in.end, [], names), "under current law, "),
    )
    return {
        "note": (
            "Test input: closures, early closes and the switch replacements a permanent daylight time law would "
            "need, applied together. Boundaries cover 1 Oct 2026 to the end of 2027 under both the new and the "
            "current law."
        ),
        "closures": sorted(day_number(d) for d in ADDED_CLOSURES),
        "earlyCloses": sorted(day_number(d) for d in ADDED_EARLY_CLOSES),
        "replacedSwitchAt": replaced,
        "replacedSwitchNewAt": replaced,
        "replacedSwitchNewOffset": [4 * 3600] * len(replaced),
        "coverageEnd": written.end_ts,
        "boundary": boundary_block(written, marks),
        "random": vector_block(
            written, random_timestamps(RANDOM_EXTENSION, written.start_ts, written.end_ts, SEED + 2)
        ),
    }


def build() -> tuple[str, str]:
    built_in = Calendar(date(2026, 1, 1), date(2028, 1, 1), frozenset(HOLIDAYS), frozenset(EARLY_CLOSES))
    switches = offset_switches(
        int(datetime(2025, 7, 1, tzinfo=timezone.utc).timestamp()),
        int(datetime(2028, 12, 31, tzinfo=timezone.utc).timestamp()),
    )
    check_against_research(built_in, switches)
    names = {**HOLIDAYS, **EARLY_CLOSES, **HOLIDAYS_2028, **EARLY_CLOSES_2028}
    built_in_doc = build_built_in(built_in, switches, names)
    extension_doc = {
        "generator": "scripts/calendar_vectors.py",
        "layout": LAYOUT,
        "append2028": build_append_2028(built_in, switches, names),
        "writes": build_writes(built_in, switches, names),
    }
    return render(built_in_doc) + "\n", render(extension_doc) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare with the fixtures on disk instead of writing")
    args = parser.parse_args()
    outputs = dict(zip((BUILT_IN_FIXTURE, EXTENSION_FIXTURE), build()))
    if args.check:
        stale = [path for path, text in outputs.items() if not path.exists() or path.read_text() != text]
        if stale:
            sys.exit(f"stale: {', '.join(map(str, stale))}. Run python3 scripts/calendar_vectors.py")
        print("fixtures are current")
        return
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for path, text in outputs.items():
        path.write_text(text)
        print(f"wrote {path}")


if __name__ == "__main__":
    main()
