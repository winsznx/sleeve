"""run.py end to end on the committed data, with few bootstrap resamples so the test stays quick."""

import csv
import json
import subprocess
import sys
import tempfile
import unittest
from collections import defaultdict
from pathlib import Path

from hp2.constants import REPO

RUN = REPO / "scripts" / "hp2" / "run.py"


def run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(RUN), *args], capture_output=True, text=True, timeout=600, check=False)


class RunTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workdir = tempfile.TemporaryDirectory(prefix="hp2-run-test-")
        cls.first = Path(cls.workdir.name) / "first"
        cls.second = Path(cls.workdir.name) / "second"
        for out in (cls.first, cls.second):
            done = run("--out-dir", str(out), "--report", str(out / "report.md"), "--resamples", "50")
            if done.returncode != 0:
                raise AssertionError(done.stderr[-3000:])
        cls.summary = json.loads((cls.first / "summary.json").read_text())

    @classmethod
    def tearDownClass(cls):
        cls.workdir.cleanup()

    def rows(self, size: int) -> list[dict]:
        with open(self.first / f"rows_{size}.csv", newline="") as fh:
            return list(csv.DictReader(fh))

    def test_outputs_are_byte_identical_across_runs(self):
        for name in ("summary.json", "report.md", "rows_100.csv", "rows_1000.csv", "evaluations_100.csv"):
            self.assertEqual((self.first / name).read_bytes(), (self.second / name).read_bytes(), name)

    def test_report_renders_from_the_summary_alone(self):
        out = self.first / "again.md"
        done = run("--out-dir", str(self.first), "--report", str(out), "--report-only")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(out.read_text(), (self.first / "report.md").read_text())

    def test_one_row_per_payment_per_policy(self):
        for size in (100, 1000):
            rows = self.rows(size)
            self.assertEqual(len(rows), 3000)
            keys = {(r["ticker"], r["i"], r["policy"]) for r in rows}
            self.assertEqual(len(keys), 3000)

    def test_fill_order_and_guard_invariants(self):
        for size in (100, 1000):
            by_payment = defaultdict(dict)
            for r in self.rows(size):
                by_payment[(r["ticker"], r["i"])][r["policy"]] = r
            for key, p in by_payment.items():
                arrival, calendar, guarded = (int(p[n]["fill_unix"]) for n in ("arrival", "calendar_only", "guarded"))
                self.assertLessEqual(arrival, calendar, key)
                self.assertLessEqual(calendar, guarded, key)
                g = p["guarded"]
                self.assertEqual(g["guard_reason"], "NONE", key)
                self.assertEqual(g["session_open"], "true", key)
                self.assertEqual(g["primary_rule"], "round in force", key)
                self.assertLessEqual(float(g["primary_premium_bps"]), 100, key)
                self.assertGreaterEqual(int(g["round_updated_at"]), int(g["session_opened_at"]), key)
                self.assertEqual(p["calendar_only"]["session_open"], "true", key)

    def test_every_split_of_the_pooled_mean_adds_up_to_it(self):
        v = self.summary["verdict"]
        d = v["drivers"]
        by_ticker = sum(part["contribution_bps"] for part in d["by_ticker"].values())
        by_cap = d["arrival_above_cap"]["contribution_bps"] + d["arrival_within_cap"]["contribution_bps"]
        self.assertAlmostEqual(by_ticker, v["mean_difference_bps"], places=4)
        self.assertAlmostEqual(by_cap, v["mean_difference_bps"], places=4)
        self.assertEqual(
            d["arrival_fallbacks"]["payments"], self.summary["counts"]["pooled"]["arrival_fallbacks"]["100"]
        )

    def test_summary_shape(self):
        s = self.summary
        self.assertIn(s["verdict"]["outcome"], ("PASS", "NULL", "FAIL"))
        self.assertTrue(s["status"]["provisional"])
        self.assertEqual(s["inputs"]["resamples"], 50)
        self.assertEqual(s["counts"]["pooled"]["payments"], 1000)
        self.assertEqual(set(s["premiums"]), {"100", "1000"})
        self.assertEqual(list(s["premiums"]["100"]["primary"]), ["pooled", "SPY", "QQQ", "NVDA", "AAPL"])
        self.assertEqual(s["checks"]["rounds_updated_at_an_opening_instant"], [])

    def test_provider_rerun_comparison(self):
        out = Path(self.workdir.name) / "compared"
        done = run(
            "--out-dir", str(out), "--report", str(out / "report.md"), "--resamples", "50",
            "--provider-rerun", str(self.first),
        )  # fmt: skip
        self.assertEqual(done.returncode, 0, done.stderr)
        summary = json.loads((out / "summary.json").read_text())
        self.assertEqual(summary["provider_rerun"]["rows_compared"], 6000)
        self.assertEqual(summary["provider_rerun"]["differences"], [])
        self.assertEqual(summary["status"]["provisional"], summary["calendar"]["provisional_reason"] is not None)


if __name__ == "__main__":
    unittest.main()
