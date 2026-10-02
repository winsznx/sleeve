"""Per-payment results of a replay, the CSV rows, and the figures docs/HP2_PROTOCOL.md asks to report.

An Outcome is one payment's fill under one policy at one size, priced against both references. outcome_row() and
evaluation_row() flatten outcomes and evaluations for the CSV files, and figures() computes the statistics, the
bootstrap intervals and the verdict from the outcomes.
"""

import math
import random
from collections import Counter
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from fractions import Fraction

from hp2.constants import PREMIUM_CAP_BPS
from hp2.engine.guard import Market, Reason
from hp2.engine.market import Feed, Round
from hp2.engine.policies import ARRIVAL, CALENDAR_ONLY, GUARDED, POLICIES, Evaluation, Fill, Payment
from hp2.engine.premium import exec_price_buy, premium_bps, premium_exact
from hp2.engine.reference import Reference, SessionTest, primary_reference, secondary_reference
from hp2.engine.stats import mean, median, percentile_interval, quantile, resampled_means, verdict
from hp2.timefmt import iso

PRIMARY = "primary"
SECONDARY = "secondary"
REFERENCES = (PRIMARY, SECONDARY)
POOLED = "pooled"
COMPARISONS = {
    "arrival_minus_guarded": (ARRIVAL, GUARDED),
    "calendar_only_minus_guarded": (CALENDAR_ONLY, GUARDED),
}
VERDICT_SIZE = 100
VERDICT_COMPARISON = "arrival_minus_guarded"
HOUR = 3600
P90 = Fraction(9, 10)


@dataclass(frozen=True)
class Outcome:
    payment: Payment
    size: int
    fill: Fill
    references: dict[str, Reference]
    premiums: dict[str, Fraction]

    @property
    def evaluation(self) -> Evaluation:
        return self.fill.evaluation

    @property
    def key(self) -> tuple[str, int]:
        return self.payment.ticker, self.payment.i


def price(payment: Payment, size: int, fill: Fill, calendar: SessionTest, feed: Feed) -> Outcome:
    """The fill against both references. USDG is valued at 1 USD."""
    instant = fill.evaluation.instant
    references = {PRIMARY: primary_reference(instant, calendar, feed), SECONDARY: secondary_reference(instant, feed)}
    quote = fill.evaluation.quote
    premiums = {name: premium_exact(quote.usdg_in, quote.amount_out, r.round.answer) for name, r in references.items()}
    return Outcome(payment, size, fill, references, premiums)


# Formatting


def fixed(value, places: int = 6) -> str:
    """A Fraction, int or float as a decimal string, rounded half to even at `places`."""
    rounded = round(Fraction(value) * 10**places)
    sign = "-" if rounded < 0 else ""
    digits = str(abs(rounded)).rjust(places + 1, "0")
    return f"{sign}{digits[:-places]}.{digits[-places:]}"


def number(value, places: int = 6) -> float:
    return round(float(value), places)


def flag(value: bool) -> str:
    return "true" if value else "false"


def pool_text(pools: Sequence[tuple[str, int, int | None]]) -> str:
    """fee:amount_out per allowlisted pool, or fee:revert."""
    return "|".join(f"{fee}:{'revert' if out is None else out}" for _, fee, out in pools)


def _round_fields(names: tuple[str, str, str, str], r: Round | None, instant: int) -> dict:
    if r is None:
        return dict.fromkeys(names, "")
    return dict(zip(names, (r.round_id, r.answer, r.updated_at, instant - r.updated_at), strict=True))


STOCK_ROUND = ("round_id", "round_answer", "round_updated_at", "round_age_seconds")
USDG_ROUND = ("usdg_round_id", "usdg_answer", "usdg_updated_at", "usdg_age_seconds")


def _market_fields(m: Market) -> dict:
    return {
        "session_open": flag(m.session_open),
        "session_opened_at": m.opened_at,
        **_round_fields(STOCK_ROUND, m.round, m.instant),
        **_round_fields(USDG_ROUND, m.usdg_round, m.instant),
        "paused": flag(m.paused),
        "oracle_paused": flag(m.oracle_paused),
        "multiplier_pending": flag(m.multiplier_pending),
    }


# CSV rows

OUTCOME_COLUMNS = (
    "size_usdg",
    "ticker",
    "i",
    "policy",
    "arrival_t",
    "arrival_unix",
    "arrival_iso",
    "arrival_session_open",
    "fill_unix",
    "fill_iso",
    "fill_kinds",
    "fill_at_arrival",
    "delay_seconds",
    "delay_hours",
    "evaluations",
    "no_quote_skips",
    "wait_reasons",
    "block",
    "pool",
    "fee",
    "usdg_in",
    "amount_out",
    "exec_price",
    "pool_quotes",
    "session_open",
    "session_opened_at",
    *STOCK_ROUND,
    *USDG_ROUND,
    "paused",
    "oracle_paused",
    "multiplier_pending",
    "guard_reason",
    "primary_rule",
    "primary_session_open",
    "primary_round_id",
    "primary_answer",
    "primary_updated_at",
    "primary_premium_bps",
    "primary_premium_bps_receipt",
    "secondary_round_id",
    "secondary_answer",
    "secondary_updated_at",
    "secondary_premium_bps",
    "secondary_premium_bps_receipt",
)

EVALUATION_COLUMNS = (
    "size_usdg",
    "ticker",
    "i",
    "step",
    "instant",
    "iso",
    "kinds",
    "block",
    "session_open",
    "session_opened_at",
    *STOCK_ROUND,
    *USDG_ROUND,
    "paused",
    "oracle_paused",
    "multiplier_pending",
    "pool_quotes",
    "best_amount_out",
    "premium_vs_round_bps",
    "guard_reason",
    "fills",
)


def outcome_row(o: Outcome, arrival_open: bool) -> dict:
    """One payment, one policy: the fill and every input that decided it and its premiums."""
    e, p, q = o.evaluation, o.payment, o.evaluation.quote
    delay = o.fill.delay(p)
    row = {
        "size_usdg": o.size,
        "ticker": p.ticker,
        "i": p.i,
        "policy": o.fill.policy,
        "arrival_t": repr(p.t),
        "arrival_unix": p.unix,
        "arrival_iso": iso(p.t),
        "arrival_session_open": flag(arrival_open),
        "fill_unix": e.instant,
        "fill_iso": iso(e.instant),
        "fill_kinds": "+".join(e.kinds),
        "fill_at_arrival": flag(o.fill.at_arrival),
        "delay_seconds": fixed(delay),
        "delay_hours": fixed(Fraction(delay) / HOUR),
        "evaluations": o.fill.evaluations,
        "no_quote_skips": o.fill.no_quote_skips,
        "wait_reasons": ";".join(f"{reason}:{count}" for reason, count in o.fill.wait_reasons),
        "block": e.block,
        "pool": q.pool,
        "fee": q.fee,
        "usdg_in": q.usdg_in,
        "amount_out": q.amount_out,
        "exec_price": exec_price_buy(q.usdg_in, q.amount_out),
        "pool_quotes": pool_text(e.pools),
        **_market_fields(e.market),
        "guard_reason": e.reason.value,
        "primary_rule": o.references[PRIMARY].rule,
        "primary_session_open": o.references[PRIMARY].session_open or "",
    }
    for name in REFERENCES:
        r = o.references[name].round
        row[f"{name}_round_id"] = r.round_id
        row[f"{name}_answer"] = r.answer
        row[f"{name}_updated_at"] = r.updated_at
        row[f"{name}_premium_bps"] = fixed(o.premiums[name])
        row[f"{name}_premium_bps_receipt"] = premium_bps(q.usdg_in, q.amount_out, r.answer)
    return {column: row[column] for column in OUTCOME_COLUMNS}


def evaluation_row(size: int, payment: Payment, step: int, e: Evaluation, filled: Sequence[str]) -> dict:
    """One evaluation instant of one payment: what every policy saw there, and which of them bought."""
    m = e.market
    premium = ""
    if e.quote is not None and m.round is not None and m.round.answer > 0:
        premium = fixed(premium_exact(e.quote.usdg_in, e.quote.amount_out, m.round.answer))
    row = {
        "size_usdg": size,
        "ticker": payment.ticker,
        "i": payment.i,
        "step": step,
        "instant": e.instant,
        "iso": iso(e.instant),
        "kinds": "+".join(e.kinds),
        "block": e.block,
        **_market_fields(m),
        "pool_quotes": pool_text(e.pools),
        "best_amount_out": "" if e.quote is None else e.quote.amount_out,
        "premium_vs_round_bps": premium,
        "guard_reason": e.reason.value,
        "fills": ";".join(filled),
    }
    return {column: row[column] for column in EVALUATION_COLUMNS}


# Figures


class Table:
    """The outcomes of one size by payment and policy, with each scope's payment order: tickers in protocol order,
    payments in draw order."""

    def __init__(self, outcomes: Sequence[Outcome], tickers: Sequence[str]):
        self.tickers = list(tickers)
        self.by_key: dict[tuple[str, int], dict[str, Outcome]] = {}
        for o in outcomes:
            self.by_key.setdefault(o.key, {})[o.fill.policy] = o
        for key, policies in self.by_key.items():
            if set(policies) != set(POLICIES):
                raise ValueError(f"payment {key} lacks a policy: {sorted(policies)}")

    def keys(self, scope: str) -> list[tuple[str, int]]:
        tickers = self.tickers if scope == POOLED else [scope]
        chosen = [k for k in self.by_key if k[0] in tickers]
        return sorted(chosen, key=lambda k: (self.tickers.index(k[0]), k[1]))

    def outcomes(self, scope: str, policy: str) -> list[Outcome]:
        return [self.by_key[k][policy] for k in self.keys(scope)]

    def all_outcomes(self) -> list[Outcome]:
        return [o for policies in self.by_key.values() for o in policies.values()]

    def differences(self, scope: str, reference: str, first: str, second: str) -> list[Fraction]:
        return [
            self.by_key[k][first].premiums[reference] - self.by_key[k][second].premiums[reference]
            for k in self.keys(scope)
        ]


def _delay_figures(outcomes: Sequence[Outcome]) -> dict:
    delays = sorted(o.fill.delay(o.payment) for o in outcomes)
    waited = sum(1 for o in outcomes if not o.fill.at_arrival)
    return {
        "median_hours": number(median(delays) / HOUR, 4),
        "p90_hours": number(quantile(delays, P90) / HOUR, 4),
        "mean_hours": number(math.fsum(delays) / len(delays) / HOUR, 4),
        "max_hours": number(delays[-1] / HOUR, 4),
        "waited": waited,
        "waited_share": number(Fraction(waited, len(outcomes)), 4),
    }


def _instants_without_quote(trails: list[tuple[Payment, list[Evaluation]]], members: set) -> int:
    return sum(
        sum(1 for e in trail if e.quote is None) for payment, trail in trails if (payment.ticker, payment.i) in members
    )


def _kinds(outcomes: Sequence[Outcome]) -> dict:
    return dict(sorted(Counter("+".join(o.evaluation.kinds) for o in outcomes).items()))


def _premium_figures(table: Table, scope: str, ref: str, exact_means: dict, intervals: dict, size: int) -> dict:
    policies = {}
    for policy in POLICIES:
        values = [o.premiums[ref] for o in table.outcomes(scope, policy)]
        policies[policy] = {"mean_bps": number(mean(values)), "median_bps": number(median(values))}
    differences = {}
    for name in COMPARISONS:
        low, high = intervals[(size, ref, scope, name)]
        differences[name] = {
            "mean_bps": number(exact_means[(size, ref, scope, name)]),
            "ci95_bps": [number(low), number(high)],
            "interval_excludes_zero": low > 0 or high < 0,
        }
    return {"payments": len(table.keys(scope)), "policies": policies, "differences": differences}


def _count_figures(
    tables: dict[int, Table], trails: dict, arrival_open: dict, scope: str
) -> tuple[dict, dict[str, dict], dict[str, dict]]:
    """Counts for one scope, and per size the guarded policy's wait reasons and the kinds of instant each policy
    bought at."""
    sizes = sorted(tables)
    keys = tables[sizes[0]].keys(scope)
    members = set(keys)
    counts = {
        "payments": len(keys),
        "off_hours_arrivals": sum(1 for k in keys if not arrival_open[k]),
        "arrival_fallbacks": {},
        "evaluated_instants_without_quote": {},
        "calendar_only_no_quote_skips": {},
        "guarded_no_quote_skips": {},
    }
    wait_reasons, fill_kinds = {}, {}
    for size in sizes:
        table = tables[size]
        guarded = table.outcomes(scope, GUARDED)
        arrival = table.outcomes(scope, ARRIVAL)
        counts["arrival_fallbacks"][str(size)] = sum(1 for o in arrival if not o.fill.at_arrival)
        counts["evaluated_instants_without_quote"][str(size)] = _instants_without_quote(trails[size], members)
        counts["calendar_only_no_quote_skips"][str(size)] = sum(
            o.fill.no_quote_skips for o in table.outcomes(scope, CALENDAR_ONLY)
        )
        counts["guarded_no_quote_skips"][str(size)] = sum(o.fill.no_quote_skips for o in guarded)
        reasons: Counter = Counter()
        for o in guarded:
            reasons.update(dict(o.fill.wait_reasons))
        wait_reasons[str(size)] = {r.value: reasons[r.value] for r in Reason if reasons[r.value]}
        fill_kinds[str(size)] = {policy: _kinds(table.outcomes(scope, policy)) for policy in POLICIES}
    return counts, wait_reasons, fill_kinds


def _drivers(table: Table, ref: str, cap_bps: int, largest: int = 5) -> dict:
    """What makes up the pooled mean of arrival minus guarded premium: each ticker's share, the share of the payments
    whose arrival quote reverted, the share of the payments whose arrival fill paid more than the guard's cap over
    the reference, and the payments with the largest differences. Every share is the members' differences summed
    and divided by the pooled count, so each split adds up to the pooled mean."""
    keys = table.keys(POOLED)
    diffs = {k: table.by_key[k][ARRIVAL].premiums[ref] - table.by_key[k][GUARDED].premiums[ref] for k in keys}

    def part(members: list) -> dict:
        return {
            "payments": len(members),
            "contribution_bps": number(sum((diffs[k] for k in members), Fraction(0)) / len(keys)),
            "mean_bps": number(mean([diffs[k] for k in members])) if members else None,
        }

    fallback = [k for k in keys if not table.by_key[k][ARRIVAL].fill.at_arrival]
    above_cap = [k for k in keys if table.by_key[k][ARRIVAL].premiums[ref] > cap_bps]
    within_cap = [k for k in keys if table.by_key[k][ARRIVAL].premiums[ref] <= cap_bps]
    fallback_fills = Counter(iso(table.by_key[k][ARRIVAL].evaluation.instant) for k in fallback)

    # Payments that bought at the same instants under both policies have the same difference, so they show as one.
    alike: dict[tuple, list[tuple[str, int]]] = {}
    for k in keys:
        a, g = table.by_key[k][ARRIVAL], table.by_key[k][GUARDED]
        alike.setdefault((k[0], a.evaluation.instant, g.evaluation.instant, diffs[k]), []).append(k)
    ranked = sorted(alike.items(), key=lambda item: (-item[0][3], table.tickers.index(item[0][0]), item[0][1]))

    def described(group: tuple, members: list) -> dict:
        ticker, arrival_fill, guarded_fill, difference = group
        first = table.by_key[members[0]]
        arrivals = sorted(table.by_key[k][ARRIVAL].payment.t for k in members)
        return {
            "ticker": ticker,
            "payments": [i for _, i in members],
            "first_arrival_iso": iso(arrivals[0]),
            "last_arrival_iso": iso(arrivals[-1]),
            "arrival_fill_iso": iso(arrival_fill),
            "guarded_fill_iso": iso(guarded_fill),
            "arrival_premium_bps": number(first[ARRIVAL].premiums[ref]),
            "guarded_premium_bps": number(first[GUARDED].premiums[ref]),
            "difference_bps": number(difference),
        }

    return {
        "by_ticker": {t: part([k for k in keys if k[0] == t]) for t in table.tickers},
        "arrival_fallbacks": {**part(fallback), "arrival_fills_at": dict(sorted(fallback_fills.items()))},
        "arrival_above_cap": {
            **part(above_cap),
            "cap_bps": cap_bps,
            "arrival_fallbacks_among_them": len(set(above_cap) & set(fallback)),
        },
        "arrival_within_cap": part(within_cap),
        "largest_for_guarded": [described(*item) for item in ranked[:largest]],
        "largest_against_guarded": [described(*item) for item in reversed(ranked[-largest:])],
    }


def _usdg_at_fills(table: Table) -> dict:
    markets = [o.evaluation.market for o in table.all_outcomes()]
    return {
        "min_answer": min(m.usdg_round.answer for m in markets),
        "max_answer": max(m.usdg_round.answer for m in markets),
        "max_age_hours": number(max(m.instant - m.usdg_round.updated_at for m in markets) / HOUR, 4),
    }


def figures(
    tables: dict[int, Table],
    trails: dict[int, list[tuple[Payment, list[Evaluation]]]],
    arrival_open: dict[tuple[str, int], bool],
    *,
    resamples: int,
    seed: int,
    progress: Callable[[str], None] | None = None,
) -> dict:
    """Every reported figure per size, reference and scope, and the verdict.

    The bootstrap uses one random.Random(seed). Scopes draw in the order pooled, then each ticker in protocol order,
    and within a scope every size, reference and comparison shares the scope's resamples."""
    sizes = sorted(tables)
    scopes = [POOLED, *tables[sizes[0]].tickers]
    rng = random.Random(seed)
    exact_means: dict = {}
    intervals: dict = {}
    for scope in scopes:
        series = {}
        for size in sizes:
            for ref in REFERENCES:
                for name, (first, second) in COMPARISONS.items():
                    diffs = tables[size].differences(scope, ref, first, second)
                    exact_means[(size, ref, scope, name)] = mean(diffs)
                    series[(size, ref, name)] = [float(d) for d in diffs]
        if progress:
            progress(f"bootstrap, {scope}: {resamples} resamples of {len(tables[sizes[0]].keys(scope))} payments")
        for (size, ref, name), means in resampled_means(series, resamples, rng).items():
            intervals[(size, ref, scope, name)] = percentile_interval(means)

    premiums = {
        str(size): {
            ref: {scope: _premium_figures(tables[size], scope, ref, exact_means, intervals, size) for scope in scopes}
            for ref in REFERENCES
        }
        for size in sizes
    }
    delays = {
        str(size): {
            scope: {policy: _delay_figures(tables[size].outcomes(scope, policy)) for policy in POLICIES}
            for scope in scopes
        }
        for size in sizes
    }
    counts, wait_reasons, fill_kinds = {}, {str(s): {} for s in sizes}, {str(s): {} for s in sizes}
    for scope in scopes:
        counts[scope], reasons, kinds = _count_figures(tables, trails, arrival_open, scope)
        for size in sizes:
            wait_reasons[str(size)][scope] = reasons[str(size)]
            fill_kinds[str(size)][scope] = kinds[str(size)]

    def apply_rule(size: int, ref: str) -> dict:
        guarded_delays = [o.fill.delay(o.payment) for o in tables[size].outcomes(POOLED, GUARDED)]
        key = (size, ref, POOLED, VERDICT_COMPARISON)
        v = verdict(exact_means[key], intervals[key], median(guarded_delays))
        return {
            "outcome": v.outcome,
            "scope": POOLED,
            "size_usdg": size,
            "reference": ref,
            "mean_difference_bps": number(v.mean_difference),
            "ci95_bps": [number(v.interval[0]), number(v.interval[1])],
            "guarded_median_delay_hours": number(v.median_delay / HOUR, 4),
            "conditions": {
                "mean_difference_above_zero": v.mean_difference_above_zero,
                "interval_excludes_zero": v.interval_excludes_zero,
                "median_delay_at_most_72_hours": v.median_delay_within_limit,
            },
        }

    others = [apply_rule(size, ref) for size in sizes for ref in REFERENCES if (size, ref) != (VERDICT_SIZE, PRIMARY)]
    return {
        "verdict": {
            **apply_rule(VERDICT_SIZE, PRIMARY),
            "drivers": _drivers(tables[VERDICT_SIZE], PRIMARY, PREMIUM_CAP_BPS),
            "same_rule_on_other_cuts": others,
        },
        "premiums": premiums,
        "delays": delays,
        "counts": counts,
        "guard_wait_reasons": wait_reasons,
        "fill_instant_kinds": fill_kinds,
        "usdg_at_fills": {str(size): _usdg_at_fills(tables[size]) for size in sizes},
    }
