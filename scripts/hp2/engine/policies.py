"""The evaluation instants of a payment and the fills of the three policies (docs/HP2_PROTOCOL.md, Policies).

Evaluation instants. A payment is evaluated at its arrival, then at every later instant that is an update of the
ticker's feed (the first round after each session open is one of them) or a point of the 15-minute grid at which the
session is open. The grid is every multiple of 900 s since the epoch, so each 20:00 New York open is a point. USDG/USD
rounds are not evaluation instants: the protocol's "feed round" is the ticker's feed, as in the guard's own "a feed
round newer than the session's opening instant".

The arrival instant is the float draw t. The chain is read at floor(t), which has the same block, session and rounds,
because every block timestamp and session boundary is a whole second. A fill at the arrival has delay 0, and a later
fill at instant e has delay e - t.

Policies, each for one payment size:
- arrival buys at the arrival instant at the best quote. When every allowlisted pool reverts there, it buys at the
  first later evaluation instant with a working quote, and the fill is a fallback.
- calendar_only buys at the first evaluation instant at which the session is open and some pool quotes.
- guarded buys at the first evaluation instant at which guard.check passes.
An instant at which every pool reverts holds back calendar_only and guarded too, and is counted for each.
"""

import math
from bisect import bisect_right
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass

from hp2.constants import GRID_SECONDS, USDG_DECIMALS
from hp2.engine.calendar import ModuleCalendar
from hp2.engine.guard import DEFAULT_PARAMS, GuardParams, Market, Reason, check
from hp2.engine.market import Feed, Quote, TokenState, best_quote, pool_outcomes

ARRIVAL = "arrival"
GUARDED = "guarded"
CALENDAR_ONLY = "calendar_only"
POLICIES = (ARRIVAL, GUARDED, CALENDAR_ONLY)

ARRIVAL_POINT = "arrival"
GRID_POINT = "grid"
ROUND_POINT = "round"


class Unresolved(LookupError):
    """A policy found no fill before the last instant the data covers."""


@dataclass(frozen=True)
class Payment:
    ticker: str
    i: int
    t: float
    unix: int

    @classmethod
    def from_arrival(cls, ticker: str, arrival: dict) -> "Payment":
        if arrival["unix"] != math.floor(arrival["t"]):
            raise ValueError(f"{ticker} arrival {arrival['i']}: unix {arrival['unix']} is not floor(t)")
        return cls(ticker, arrival["i"], arrival["t"], arrival["unix"])


@dataclass(frozen=True)
class Evaluation:
    instant: int
    kinds: tuple[str, ...]
    block: int
    market: Market
    pools: tuple[tuple[str, int, int | None], ...]
    quote: Quote | None
    reason: Reason


@dataclass(frozen=True)
class Fill:
    policy: str
    evaluation: Evaluation
    evaluations: int
    """Evaluation instants the policy looked at, the fill included."""
    no_quote_skips: int
    """Instants the policy would have bought at but for every pool reverting."""
    wait_reasons: tuple[tuple[str, int], ...]
    """Guarded only: the first failing check at each earlier instant, counted, in the module's check order."""

    @property
    def at_arrival(self) -> bool:
        return ARRIVAL_POINT in self.evaluation.kinds

    def delay(self, payment: Payment) -> float:
        return 0.0 if self.at_arrival else self.evaluation.instant - payment.t


def open_grid(calendar: ModuleCalendar, first: int, last: int) -> list[int]:
    """The 15-minute grid points in [first, last] at which the session is open."""
    points = range(first - first % GRID_SECONDS, last + 1, GRID_SECONDS)
    calendar.prefetch(points)
    return [p for p in points if first <= p and calendar.session_state(p)[0]]


class TickerReplay:
    """One ticker's inputs and evaluation instants, and the walk of each of its payments."""

    def __init__(
        self,
        symbol: str,
        *,
        calendar: ModuleCalendar,
        feed: Feed,
        usdg: Feed,
        token: TokenState,
        quotes,
        grid: list[int],
        last_instant: int,
        params: GuardParams = DEFAULT_PARAMS,
    ):
        self.symbol = symbol
        self.calendar = calendar
        self.feed = feed
        self.usdg = usdg
        self.token = token
        self.quotes = quotes
        self.params = params
        kinds: dict[int, list[str]] = {}
        for point in grid:
            if point <= last_instant:
                kinds.setdefault(point, []).append(GRID_POINT)
        for updated_at in feed.updated_at:
            if updated_at <= last_instant:
                kinds.setdefault(updated_at, []).append(ROUND_POINT)
        self.kinds = {instant: tuple(k) for instant, k in kinds.items()}
        self.instants = sorted(self.kinds)
        self._markets: dict[int, Market] = {}

    def market(self, instant: int) -> Market:
        if instant not in self._markets:
            is_open, opened_at = self.calendar.session_state(instant)
            self._markets[instant] = Market(
                instant=instant,
                session_open=is_open,
                opened_at=opened_at,
                paused=self.token.paused(instant),
                oracle_paused=self.token.oracle_paused(instant),
                multiplier_pending=self.token.multiplier_pending(instant, self.params.multiplier_window),
                round=self.feed.in_force(instant),
                usdg_round=self.usdg.in_force(instant),
            )
        return self._markets[instant]

    def evaluate(self, instant: int, kinds: tuple[str, ...], size: int) -> Evaluation:
        row = self.quotes.at(instant)
        market = self.market(instant)
        quote = best_quote(row, size, USDG_DECIMALS)
        pools = tuple(pool_outcomes(row, size))
        return Evaluation(instant, kinds, row["block"], market, pools, quote, check(market, quote, self.params))

    def walk(self, payment: Payment) -> Iterator[tuple[int, tuple[str, ...]]]:
        yield payment.unix, (ARRIVAL_POINT, *self.kinds.get(payment.unix, ()))
        for instant in self.instants[bisect_right(self.instants, payment.unix) :]:
            yield instant, self.kinds[instant]

    def replay(self, payment: Payment, size: int) -> tuple[dict[str, Fill], list[Evaluation]]:
        """Every policy's fill for one payment size, and the evaluations up to the last of them."""
        fills: dict[str, Fill] = {}
        trail: list[Evaluation] = []
        skips: Counter = Counter()
        waits: Counter = Counter()
        for instant, kinds in self.walk(payment):
            e = self.evaluate(instant, kinds, size)
            trail.append(e)
            if ARRIVAL not in fills:
                if e.quote is not None:
                    fills[ARRIVAL] = Fill(ARRIVAL, e, len(trail), skips[ARRIVAL], ())
                else:
                    skips[ARRIVAL] += 1
            if CALENDAR_ONLY not in fills and e.market.session_open:
                if e.quote is not None:
                    fills[CALENDAR_ONLY] = Fill(CALENDAR_ONLY, e, len(trail), skips[CALENDAR_ONLY], ())
                else:
                    skips[CALENDAR_ONLY] += 1
            if GUARDED not in fills:
                if e.reason is Reason.NONE:
                    reasons = tuple((r.value, waits[r]) for r in Reason if waits[r])
                    fills[GUARDED] = Fill(GUARDED, e, len(trail), waits[Reason.NO_QUOTE], reasons)
                else:
                    waits[e.reason] += 1
            if len(fills) == len(POLICIES):
                return fills, trail
        missing = [p for p in POLICIES if p not in fills]
        raise Unresolved(f"{self.symbol} payment {payment.i}, {size} USDG: no fill for {missing} before the data end")
