"""Statistics of docs/HP2_PROTOCOL.md (Claim under test, Reported), and the verdict rule.

Conventions, fixed here because the protocol does not name them:
- Means and medians of premiums are exact over Fractions. The median of an even count is the mean of the middle two.
- A quantile is the linear interpolation between order statistics at position q * (n - 1), numpy's default, with the
  position computed exactly.
- The paired bootstrap draws each resample's payment indices with rng.choices(range(n), k=n), which is
  floor(rng.random() * n) per draw, and every statistic of a scope shares that scope's resamples. A resampled mean is
  math.fsum of the drawn differences over n, so it does not depend on summation order. The interval is the 2.5th and
  97.5th percentile of the resampled means.
- Verdict, on the pooled payments: FAIL when the mean of (arrival premium minus guarded premium) is at or below zero
  or the guarded median delay is above 72 hours; otherwise PASS when the interval excludes zero; otherwise NULL. The
  protocol lists the three outcomes without an order, and its Null and Fail conditions can both hold. Fail is checked
  first because each of its conditions withdraws the claim on its own.
"""

import math
import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from fractions import Fraction

PASS = "PASS"
NULL = "NULL"
FAIL = "FAIL"
MAX_MEDIAN_DELAY = 72 * 3600
LEVEL = Fraction(95, 100)


def mean(values: Sequence[Fraction]) -> Fraction:
    if not values:
        raise ValueError("mean of nothing")
    return sum(values, Fraction(0)) / len(values)


def median(values: Sequence):
    if not values:
        raise ValueError("median of nothing")
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def quantile(ordered: Sequence[float], q: Fraction) -> float:
    """Linear interpolation at position q * (n - 1) of values already sorted ascending."""
    if not ordered:
        raise ValueError("quantile of nothing")
    if not 0 <= q <= 1:
        raise ValueError(f"quantile {q} outside [0, 1]")
    position = Fraction(q) * (len(ordered) - 1)
    below = math.floor(position)
    if below == len(ordered) - 1:
        return float(ordered[below])
    weight = position - below
    return float(ordered[below] + (ordered[below + 1] - ordered[below]) * weight)


def resampled_means(series: Mapping[str, Sequence[float]], resamples: int, rng: random.Random) -> dict[str, list]:
    """The mean of every series over the same `resamples` draws of payment indices with replacement."""
    lengths = {len(values) for values in series.values()}
    if len(lengths) != 1:
        raise ValueError(f"series of different lengths {sorted(lengths)} cannot be paired")
    (n,) = lengths
    population = range(n)
    means: dict[str, list] = {name: [] for name in series}
    for _ in range(resamples):
        picks = rng.choices(population, k=n)
        for name, values in series.items():
            means[name].append(math.fsum([values[i] for i in picks]) / n)
    return means


def percentile_interval(means: Sequence[float], level: Fraction = LEVEL) -> tuple[float, float]:
    ordered = sorted(means)
    tail = (1 - level) / 2
    return quantile(ordered, tail), quantile(ordered, 1 - tail)


@dataclass(frozen=True)
class Verdict:
    outcome: str
    mean_difference: Fraction
    interval: tuple[float, float]
    median_delay: float
    mean_difference_above_zero: bool
    interval_excludes_zero: bool
    median_delay_within_limit: bool


def verdict(mean_difference: Fraction, interval: tuple[float, float], median_delay: float) -> Verdict:
    """The protocol's rule. mean_difference is the exact pooled mean of arrival minus guarded premium in bps,
    interval its bootstrap interval, median_delay the guarded median delay in seconds."""
    low, high = interval
    above_zero = mean_difference > 0
    excludes_zero = low > 0 or high < 0
    within_limit = median_delay <= MAX_MEDIAN_DELAY
    if not above_zero or not within_limit:
        outcome = FAIL
    elif excludes_zero:
        outcome = PASS
    else:
        outcome = NULL
    return Verdict(outcome, mean_difference, interval, median_delay, above_zero, excludes_zero, within_limit)
