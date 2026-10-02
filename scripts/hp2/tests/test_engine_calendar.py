import gzip
import hashlib
import json
import unittest
from pathlib import Path
from unittest import mock

from hp2.constants import CACHE_DIR
from hp2.engine import calendar as engine_calendar
from hp2.engine.calendar import FORGE_ORACLE, PORT_ORACLE, ModuleCalendar, module_calendar
from hp2.session import PortSession, SessionState
from hp2.tests.helpers import FORGE

SESSION_CACHE = CACHE_DIR / "session"
SAT_NOON = 1_790_424_000  # Sat 2026-09-26 12:00 UTC
SUN_OPEN = 1_790_553_600  # Sun 2026-09-27 20:00 EDT
FRI_CLOSE = 1_790_380_800  # Fri 2026-09-25 20:00 EDT


def committed_instants(count: int) -> list[int]:
    (path,) = SESSION_CACHE.glob("forge-*.json.gz")
    with gzip.open(path, "rt") as fh:
        answers = json.load(fh)["answers"]
    return sorted(int(ts) for ts in answers)[:count]


def digest(directory: Path) -> dict[str, str]:
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.glob("*"))}


class PortCalendarTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.calendar = ModuleCalendar(PortSession(), PORT_ORACLE)

    def test_session_state_is_the_ports(self):
        port = PortSession()
        for ts in (FRI_CLOSE - 1, FRI_CLOSE, SAT_NOON, SUN_OPEN - 1, SUN_OPEN, SUN_OPEN + 5 * 3600):
            state = port.states([ts])[ts]
            self.assertEqual(self.calendar.session_state(ts), (state.open, state.opened_at))

    def test_next_open(self):
        self.assertEqual(self.calendar.next_open(SAT_NOON), SUN_OPEN)
        self.assertEqual(self.calendar.next_open(FRI_CLOSE), SUN_OPEN)
        self.assertEqual(self.calendar.next_open(SUN_OPEN - 1), SUN_OPEN)
        with self.assertRaises(ValueError):
            self.calendar.next_open(SUN_OPEN)

    def test_next_open_finds_an_open_between_grid_points(self):
        class OffGrid:
            source_sha256 = "off-grid"

            def states(self, timestamps):
                opens = SUN_OPEN + 123
                return {
                    ts: SessionState(ts >= opens, opens if ts >= opens else 0, 1 if ts >= opens else 2)
                    for ts in map(int, timestamps)
                }

        self.assertEqual(ModuleCalendar(OffGrid(), "off grid").next_open(SAT_NOON), SUN_OPEN + 123)


class ModuleCalendarTest(unittest.TestCase):
    def test_forge_answers_from_the_committed_cache_and_the_port_checks_them(self):
        before = digest(SESSION_CACHE)
        instants = committed_instants(400)
        calendar = module_calendar(instants)
        info = calendar.describe()
        self.assertEqual(calendar.oracle, FORGE_ORACLE)
        self.assertIsNone(calendar.provisional_reason)
        self.assertEqual(info["instants_checked_against_port"], len(instants))
        self.assertEqual(info["forge_runs_this_run"], 0)
        self.assertEqual(digest(SESSION_CACHE), before)

    @unittest.skipUnless(FORGE, "forge not installed")
    def test_new_instants_never_touch_the_committed_cache(self):
        before = digest(SESSION_CACHE)
        calendar = module_calendar([1_830_315_599, 1_830_315_600])
        self.assertEqual(calendar.oracle, FORGE_ORACLE)
        self.assertEqual(calendar.describe()["forge_runs_this_run"], 1)
        self.assertEqual(calendar.session_state(1_830_315_600), (False, 0))
        self.assertEqual(digest(SESSION_CACHE), before)

    def test_without_forge_the_port_answers_and_the_run_is_provisional(self):
        with mock.patch.object(engine_calendar, "ForgeSession", side_effect=FileNotFoundError("forge")):
            calendar = module_calendar([SAT_NOON, SUN_OPEN])
        self.assertEqual(calendar.oracle, PORT_ORACLE)
        self.assertIn("FileNotFoundError", calendar.provisional_reason)
        self.assertEqual(calendar.session_state(SUN_OPEN), (True, SUN_OPEN))

    def test_a_disagreement_falls_back_to_the_port_and_says_so(self):
        class Wrong(PortSession):
            def states(self, timestamps):
                out = super().states(timestamps)
                out[SAT_NOON] = SessionState(True, SAT_NOON, 1)
                return out

        with mock.patch.object(engine_calendar, "PortSession", Wrong):
            calendar = module_calendar(committed_instants(5) + [SAT_NOON])
        self.assertEqual(calendar.oracle, PORT_ORACLE)
        self.assertIn("SessionDisagreement", calendar.provisional_reason)


if __name__ == "__main__":
    unittest.main()
