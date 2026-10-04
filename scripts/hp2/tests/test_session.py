import json
import tempfile
import unittest
from pathlib import Path

from hp2.constants import CONTRACTS
from hp2.session import (
    MAX_ARGUMENT_BYTES,
    MAX_CHUNK,
    TIMESTAMP_BYTES,
    CheckedSession,
    ForgeSession,
    PortSession,
    SessionDisagreement,
    SessionState,
    open_intervals,
)
from hp2.tests.helpers import FORGE

FIXTURE = CONTRACTS / "test" / "fixtures" / "calendar_vectors.json"


def fixture_states() -> dict[int, SessionState]:
    doc = json.loads(FIXTURE.read_text())
    out = {}
    for block in (doc["boundary"], doc["random"]):
        for t, is_open, reason, opened_at in zip(
            block["t"], block["allDayOpen"], block["allDayReason"], block["allDaySessionOpenedAt"], strict=True
        ):
            out[t] = SessionState(is_open, opened_at, reason)
    return out


class PortTest(unittest.TestCase):
    def test_port_matches_the_table_vectors(self):
        expected = fixture_states()
        got = PortSession().states(expected)
        self.assertEqual(got, expected)


@unittest.skipUnless(FORGE, "forge not installed")
class ChunkTest(unittest.TestCase):
    def test_a_full_chunk_fits_one_linux_argument(self):
        argument = "0x" + "ff" * TIMESTAMP_BYTES * MAX_CHUNK
        self.assertLessEqual(len(argument) + 1, MAX_ARGUMENT_BYTES)
        self.assertGreater(len(argument) + 1 + 2 * TIMESTAMP_BYTES, MAX_ARGUMENT_BYTES)

    def test_a_larger_chunk_asked_for_is_cut_to_the_limit(self):
        self.assertEqual(ForgeSession(Path(tempfile.mkdtemp()), chunk=15_000, offline_only=True).chunk, MAX_CHUNK)


class ForgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.forge = ForgeSession(Path(tempfile.mkdtemp()))
        cls.port = PortSession()

    def test_forge_matches_the_table_vectors_and_the_port(self):
        expected = fixture_states()
        self.assertEqual(self.forge.states(expected), expected)
        checked = CheckedSession(self.forge, self.port)
        self.assertEqual(
            {ts: (s.open, s.opened_at) for ts, s in checked.states(expected).items()},
            {ts: (s.open, s.opened_at) for ts, s in expected.items()},
        )

    def test_answers_are_cached_on_disk(self):
        directory = Path(tempfile.mkdtemp())
        first = ForgeSession(directory)
        first.states([1790952369, 1788866720])
        second = ForgeSession(directory)
        second.states([1790952369, 1788866720])
        self.assertEqual(second.forge_runs, 0)

    def test_open_intervals_match_the_port_over_the_replay_period(self):
        checked = CheckedSession(self.forge, self.port)
        first, last = 1_784_000_000, 1_791_100_000
        found = open_intervals(checked, first, last)
        expected = [iv for iv in self.port.open_intervals() if iv[1] > first and iv[0] <= last]
        self.assertEqual([tuple(iv) for iv in found], expected)

    def test_disagreement_stops_the_run(self):
        class Wrong(PortSession):
            def states(self, timestamps):
                out = super().states(timestamps)
                ts = max(out)
                state = out[ts]
                out[ts] = SessionState(state.open, state.opened_at + 1 if state.open else 0, state.reason)
                if not state.open:
                    out[ts] = SessionState(True, ts, 1)
                return out

        checked = CheckedSession(self.forge, Wrong())
        with self.assertRaises(SessionDisagreement):
            checked.states([1790952369, 1788866720])


if __name__ == "__main__":
    unittest.main()
