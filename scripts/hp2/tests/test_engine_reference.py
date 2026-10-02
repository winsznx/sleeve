import unittest

from hp2.engine.calendar import PORT_ORACLE, ModuleCalendar
from hp2.engine.reference import FIRST_AFTER_OPEN, IN_FORCE, NoReference, primary_reference, secondary_reference
from hp2.session import PortSession
from hp2.tests.engine_fixtures import DAY, HOUR, feed

# The module's ALL_DAY calendar through the Python port, New York time.
FRI_CLOSE = 1_790_380_800  # Fri 2026-09-25 20:00 EDT
SAT_NOON = 1_790_424_000  # Sat 2026-09-26 12:00 UTC
SUN_OPEN = 1_790_553_600  # Sun 2026-09-27 20:00 EDT
LABOR_DAY_REOPEN = 1_788_825_600  # Mon 2026-09-07 20:00 EDT
LABOR_DAY_WEEKEND = 1_788_609_600  # Sat 2026-09-05 12:00 UTC
THANKSGIVING_EVE_CLOSE = 1_795_654_800  # Wed 2026-11-25 20:00 EST
THANKSGIVING_NOON = 1_795_712_400  # Thu 2026-11-26 12:00 EST
THANKSGIVING_REOPEN = 1_795_741_200  # Thu 2026-11-26 20:00 EST


class ReferenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calendar = ModuleCalendar(PortSession(), PORT_ORACLE)

    def test_calendar_shape_the_cases_rely_on(self):
        c = self.calendar
        self.assertEqual(c.session_state(FRI_CLOSE - 1)[0], True)
        self.assertEqual(c.session_state(FRI_CLOSE), (False, 0))
        self.assertEqual(c.session_state(SUN_OPEN), (True, SUN_OPEN))
        self.assertEqual(c.session_state(THANKSGIVING_EVE_CLOSE), (False, 0))
        self.assertEqual(c.session_state(THANKSGIVING_REOPEN), (True, THANKSGIVING_REOPEN))
        self.assertEqual(c.session_state(THANKSGIVING_REOPEN + 3 * HOUR), (True, THANKSGIVING_REOPEN))

    def test_weekend_fill(self):
        friday_round = FRI_CLOSE - 4 * 60
        rounds = feed([friday_round, SUN_OPEN + 40, SUN_OPEN + 2 * HOUR])
        primary = primary_reference(SAT_NOON, self.calendar, rounds)
        self.assertEqual(
            (primary.rule, primary.session_open, primary.round.updated_at), (FIRST_AFTER_OPEN, SUN_OPEN, SUN_OPEN + 40)
        )
        self.assertEqual(secondary_reference(SAT_NOON, rounds).round.updated_at, friday_round)

    def test_monday_holiday_weekend_fill(self):
        held = LABOR_DAY_WEEKEND - DAY
        rounds = feed([held, LABOR_DAY_REOPEN + 31])
        self.assertEqual(self.calendar.next_open(LABOR_DAY_WEEKEND), LABOR_DAY_REOPEN)
        primary = primary_reference(LABOR_DAY_WEEKEND + 2 * DAY, self.calendar, rounds)
        self.assertEqual(primary.round.updated_at, LABOR_DAY_REOPEN + 31)
        self.assertEqual(secondary_reference(LABOR_DAY_WEEKEND, rounds).round.updated_at, held)

    def test_midweek_holiday_fill(self):
        # The round held over Thanksgiving is under 25 hours old at noon, so only the calendar knows it is held.
        eve_round = THANKSGIVING_EVE_CLOSE - 15 * 60
        rounds = feed([eve_round, THANKSGIVING_REOPEN + 35, THANKSGIVING_REOPEN + HOUR])
        self.assertLess(THANKSGIVING_NOON - eve_round, 25 * HOUR)
        primary = primary_reference(THANKSGIVING_NOON, self.calendar, rounds)
        self.assertEqual(primary.rule, FIRST_AFTER_OPEN)
        self.assertEqual(primary.session_open, THANKSGIVING_REOPEN)
        self.assertEqual(primary.round.updated_at, THANKSGIVING_REOPEN + 35)
        self.assertEqual(secondary_reference(THANKSGIVING_NOON, rounds).round.updated_at, eve_round)

    def test_reopen_with_a_held_round(self):
        held = FRI_CLOSE - 4 * 60
        rounds = feed([held, SUN_OPEN + 40])
        fill = SUN_OPEN + 10
        primary = primary_reference(fill, self.calendar, rounds)
        self.assertEqual((primary.rule, primary.session_open), (FIRST_AFTER_OPEN, SUN_OPEN))
        self.assertEqual(primary.round.updated_at, SUN_OPEN + 40)
        self.assertEqual(secondary_reference(fill, rounds).round.updated_at, held)

    def test_fresh_round_in_force(self):
        rounds = feed([FRI_CLOSE - 60, SUN_OPEN + 40, SUN_OPEN + 5 * HOUR])
        fill = SUN_OPEN + 6 * HOUR
        primary = primary_reference(fill, self.calendar, rounds)
        self.assertEqual((primary.rule, primary.round.updated_at), (IN_FORCE, SUN_OPEN + 5 * HOUR))
        self.assertEqual(secondary_reference(fill, rounds).round, primary.round)

    def test_a_round_updated_at_the_opening_second_is_live(self):
        rounds = feed([FRI_CLOSE - 60, SUN_OPEN, SUN_OPEN + HOUR])
        primary = primary_reference(SUN_OPEN + 5, self.calendar, rounds)
        self.assertEqual((primary.rule, primary.round.updated_at), (IN_FORCE, SUN_OPEN))

    def test_no_round_after_the_open_raises(self):
        rounds = feed([FRI_CLOSE - 60])
        with self.assertRaises(NoReference):
            primary_reference(SAT_NOON, self.calendar, rounds)
        with self.assertRaises(NoReference):
            secondary_reference(FRI_CLOSE - 61, rounds)


if __name__ == "__main__":
    unittest.main()
