import math
import random
import unittest
from fractions import Fraction

from hp2.engine.stats import (
    FAIL,
    MAX_MEDIAN_DELAY,
    NULL,
    PASS,
    mean,
    median,
    percentile_interval,
    quantile,
    resampled_means,
    verdict,
)

SEED = 4663202610 + 100


class SummaryStatisticsTest(unittest.TestCase):
    def test_mean_and_median_are_exact(self):
        values = [Fraction(1, 3), Fraction(2, 3), Fraction(5), Fraction(-1, 7)]
        self.assertEqual(mean(values), (Fraction(1, 3) + Fraction(2, 3) + 5 - Fraction(1, 7)) / 4)
        self.assertEqual(median(values), (Fraction(1, 3) + Fraction(2, 3)) / 2)
        self.assertEqual(median([3, 1, 2]), 2)

    def test_quantile_interpolates_linearly_like_numpy(self):
        ordered = [0.0, 10.0, 20.0, 30.0, 40.0]
        self.assertEqual(quantile(ordered, Fraction(0)), 0.0)
        self.assertEqual(quantile(ordered, Fraction(1)), 40.0)
        self.assertEqual(quantile(ordered, Fraction(9, 10)), 36.0)
        self.assertEqual(quantile(ordered, Fraction(1, 8)), 5.0)
        self.assertEqual(quantile([7.0], Fraction(1, 2)), 7.0)

    def test_percentile_interval_of_ten_thousand(self):
        means = [float(n) for n in range(10_000)]
        random.Random(1).shuffle(means)
        low, high = percentile_interval(means)
        self.assertEqual((low, high), (249.975, 9749.025))


class BootstrapTest(unittest.TestCase):
    def series(self):
        rng = random.Random(7)
        return {
            "a": [rng.uniform(-50, 80) for _ in range(250)],
            "b": [rng.uniform(-5, 5) for _ in range(250)],
        }

    def test_same_seed_same_means(self):
        series = self.series()
        first = resampled_means(series, 500, random.Random(SEED))
        second = resampled_means(series, 500, random.Random(SEED))
        self.assertEqual(first, second)
        other = resampled_means(series, 500, random.Random(SEED + 1))
        self.assertNotEqual(first["a"], other["a"])

    def test_draws_are_the_documented_ones(self):
        series = self.series()
        got = resampled_means(series, 50, random.Random(SEED))
        rng = random.Random(SEED)
        for b in range(50):
            picks = [math.floor(rng.random() * 250) for _ in range(250)]
            self.assertEqual(got["a"][b], math.fsum(series["a"][i] for i in picks) / 250)
            self.assertEqual(got["b"][b], math.fsum(series["b"][i] for i in picks) / 250)

    def test_series_share_resamples_whatever_their_order(self):
        series = self.series()
        forward = resampled_means(series, 100, random.Random(SEED))
        backward = resampled_means(dict(reversed(series.items())), 100, random.Random(SEED))
        self.assertEqual(forward, backward)

    def test_constant_differences_give_a_point_interval(self):
        means = resampled_means({"d": [2.5] * 40}, 200, random.Random(SEED))
        self.assertEqual(percentile_interval(means["d"]), (2.5, 2.5))

    def test_series_must_pair(self):
        with self.assertRaises(ValueError):
            resampled_means({"a": [1.0, 2.0], "b": [1.0]}, 10, random.Random(SEED))


class VerdictTest(unittest.TestCase):
    """The protocol's rule at its edges. Delays are in seconds; 72 hours is the limit."""

    def test_pass(self):
        v = verdict(Fraction(1, 10**9), (1e-9, 5.0), MAX_MEDIAN_DELAY)
        self.assertEqual(v.outcome, PASS)
        self.assertTrue(v.mean_difference_above_zero and v.interval_excludes_zero and v.median_delay_within_limit)

    def test_interval_touching_zero_includes_it(self):
        self.assertEqual(verdict(Fraction(3), (0.0, 6.0), 0).outcome, NULL)
        self.assertEqual(verdict(Fraction(3), (-0.5, 6.0), 0).outcome, NULL)

    def test_mean_equal_to_zero_fails(self):
        self.assertEqual(verdict(Fraction(0), (-1.0, 1.0), 0).outcome, FAIL)
        self.assertEqual(verdict(Fraction(0), (0.5, 1.0), 0).outcome, FAIL)

    def test_guarded_worse_fails_even_when_the_interval_includes_zero(self):
        v = verdict(Fraction(-1, 2), (-2.0, 1.0), 0)
        self.assertEqual(v.outcome, FAIL)
        self.assertFalse(v.interval_excludes_zero)

    def test_median_delay_at_72_hours_passes_and_one_second_more_fails(self):
        self.assertEqual(verdict(Fraction(5), (1.0, 9.0), MAX_MEDIAN_DELAY).outcome, PASS)
        self.assertEqual(verdict(Fraction(5), (1.0, 9.0), MAX_MEDIAN_DELAY + 1).outcome, FAIL)
        self.assertEqual(verdict(Fraction(5), (1.0, 9.0), MAX_MEDIAN_DELAY + 0.001).outcome, FAIL)

    def test_a_long_delay_fails_a_null_result(self):
        self.assertEqual(verdict(Fraction(5), (-1.0, 9.0), MAX_MEDIAN_DELAY + 1).outcome, FAIL)

    def test_an_interval_wholly_below_zero_excludes_zero(self):
        # The literal rule: a positive mean with an interval that excludes zero passes. A percentile interval of
        # resampled means always contains the mean in practice, so this pairing only shows the rule is literal.
        v = verdict(Fraction(1), (-3.0, -1.0), 0)
        self.assertTrue(v.interval_excludes_zero)
        self.assertEqual(v.outcome, PASS)


if __name__ == "__main__":
    unittest.main()
