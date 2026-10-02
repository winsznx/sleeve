import random
import unittest
from fractions import Fraction

from hp2.chain import chunks, cross_check_rounds, exact_median, finish_rounds
from hp2.fetch import draw_arrivals, render


def raw_feed(answers_and_times):
    return {
        "feed": "0xfeed",
        "rounds_read": [
            {"aggregator_round": n + 1, "answer": str(a), "updated_at": t, "round_id": str((1 << 64) | (n + 1))}
            for n, (a, t) in enumerate(answers_and_times)
        ],
    }


class ChunkTest(unittest.TestCase):
    def test_chunks_are_aligned_and_cover_the_range(self):
        rng = random.Random(1)
        for _ in range(200):
            first = rng.randint(0, 50_000_000)
            last = first + rng.randint(0, 40_000_000)
            got = list(chunks(first, last))
            self.assertEqual(got[0][0], first)
            self.assertEqual(got[-1][1], last)
            for (_, b), (c, _) in zip(got, got[1:], strict=False):
                self.assertEqual(c, b + 1)
            for a, b in got:
                self.assertLessEqual(b - a + 1, 10_000_000)
                self.assertEqual(a // 10_000_000, b // 10_000_000)

    def test_full_history(self):
        got = list(chunks(0, 78_312_136))
        self.assertEqual(got[0], (0, 9_999_999))
        self.assertEqual(got[-1], (70_000_000, 78_312_136))
        self.assertEqual(len(got), 8)


class RoundsTest(unittest.TestCase):
    def test_exact_median(self):
        self.assertEqual(exact_median([3, 1, 2]), 2)
        self.assertEqual(exact_median([1, 2, 3, 4]), Fraction(5, 2))
        big = 7_424_400_000_000_000_001
        self.assertEqual(exact_median([big, big + 1]), Fraction(2 * big + 1, 2))

    def test_drop_rule_is_ten_times_the_median_and_strict(self):
        m = 73_000_000_000
        rows = [(10 * m, 100), (10 * m + 1, 150)] + [(m, 200 + i) for i in range(9)]
        out = finish_rounds(raw_feed(rows), end_ts=10_000)
        self.assertEqual(Fraction(out["median_answer"]), m)
        self.assertEqual([r["aggregator_round"] for r in out["rounds"] if r["dropped"]], [2])
        self.assertTrue(out["dropped_all_before_2026_06_23_1353Z"])

    def test_late_dropped_round_is_reported(self):
        m = 73_000_000_000
        rows = [(m, 1_782_000_000 + i) for i in range(5)] + [(20 * m, 1_782_300_000)]
        out = finish_rounds(raw_feed(rows), end_ts=1_790_000_000)
        self.assertEqual(out["dropped_count"], 1)
        self.assertFalse(out["dropped_all_before_2026_06_23_1353Z"])

    def test_rounds_after_the_end_are_left_out(self):
        out = finish_rounds(raw_feed([(1, 10), (2, 20), (3, 30)]), end_ts=20)
        self.assertEqual([r["updated_at"] for r in out["rounds"]], [10, 20])
        self.assertEqual(out["rounds_after_end_ts"], 1)

    def test_out_of_order_rounds_are_refused(self):
        with self.assertRaises(AssertionError):
            finish_rounds(raw_feed([(1, 20), (2, 10)]), end_ts=100)

    def test_cross_check_against_logs(self):
        out = finish_rounds(raw_feed([(5, 10), (6, 20)]), end_ts=100)
        logs = [
            {"aggregator_round": 1, "answer": "5", "updated_at": 10, "block": 111},
            {"aggregator_round": 2, "answer": "7", "updated_at": 20, "block": 222},
            {"aggregator_round": 3, "answer": "8", "updated_at": 30, "block": 333},
        ]
        cross = cross_check_rounds(out, logs)
        self.assertEqual(cross["matched"], 1)
        self.assertEqual(cross["blocks"], {1: 111})
        self.assertEqual([m["aggregator_round"] for m in cross["mismatches"]], [2])
        self.assertEqual(cross["log_rounds_not_read"], [3])


class ArrivalTest(unittest.TestCase):
    def test_arrivals_follow_the_protocol_seed(self):
        start, end = 1_786_000_000, 1_790_000_000
        rng = random.Random(4663202610 + 2)
        expected = [rng.uniform(start, end) for _ in range(250)]
        got = draw_arrivals(2, start, end)
        self.assertEqual([a["t"] for a in got], expected)
        self.assertEqual([a["i"] for a in got], list(range(250)))
        self.assertTrue(all(start <= a["unix"] <= end and a["unix"] <= a["t"] < a["unix"] + 1 for a in got))

    def test_render_round_trips(self):
        import json

        value = {"a": [1, 2], "b": [{"x": 1}, {"y": [1, 2]}], "c": {"d": [[1, 2], [3, 4]], "e": {}}, "f": []}
        self.assertEqual(json.loads(render(value)), value)


if __name__ == "__main__":
    unittest.main()
