"""Which instants need quotes: the lazy frontier the brief asks for, with margins.

Quotes are fetched for every arrival, and for each payment that may wait, at every evaluation instant from its arrival
until it is certainly settled for every policy:

- buy at arrival: the first instant with a working quote, for both sizes;
- calendar only: the first instant the session is open with a working quote, for both sizes;
- guarded: the first instant where every check passes with room to spare, for both sizes: session open, a round
  at or after the session's opening instant, feed age at most 25 h less 15 min, no multiplier change scheduled
  within 24 h give or take 15 min, USDG/USD within 45 bps and at most 25 h less 15 min old, no pause, and the
  premium over the round in force at most 95 bps.

Evaluation instants (docs/HP2_PROTOCOL.md, Policies) are the arrival, every round of the ticker's feed (which
includes the first fresh round after each session open), and every 15-minute grid point (multiples of 900 s, so
every 20:00 New York open is one) at which the session is open. USDG/USD rounds that land while the session is open
are added as well, in case the engine counts them as feed rounds.

Around each session open or close a payment's span touches, within an hour, every grid point is fetched whether the
session is open or not, plus every round instant, so a calendar that differs slightly still finds its instants.

This decides only how far fetching must reach; it records no fills, premiums or statistics.
"""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass, field

from hp2.constants import (
    BOUNDARY_MARGIN,
    FEED_DECIMALS,
    FEED_MAX_AGE,
    GRID_SECONDS,
    MULTIPLIER_WINDOW,
    PREMIUM_CAP_BPS,
    SIZES_USDG,
    STOP_AGE_MARGIN,
    STOP_EVENT_MARGIN,
    STOP_PREMIUM_MARGIN_BPS,
    STOP_USDG_MARGIN_BPS,
    TOKEN_DECIMALS,
    USDG_DECIMALS,
    USDG_MAX_AGE,
    USDG_TOLERANCE_BPS,
)
from hp2.quotes import AMOUNT_IN

PREMIUM_SCALE = 10 ** (TOKEN_DECIMALS + FEED_DECIMALS - USDG_DECIMALS)
ONE_USD = 10**FEED_DECIMALS


class Rounds:
    """A feed's kept rounds, for the round in force at an instant: the latest with updated_at at or before it."""

    def __init__(self, rounds: list[dict]):
        kept = [r for r in rounds if not r["dropped"]]
        self.updated_at = [r["updated_at"] for r in kept]
        self.answer = [int(r["answer"]) for r in kept]

    def in_force(self, instant: int) -> tuple[int, int] | None:
        i = bisect_right(self.updated_at, instant) - 1
        return None if i < 0 else (self.updated_at[i], self.answer[i])

    def instants(self, first: int, last: int) -> list[int]:
        return self.updated_at[bisect_left(self.updated_at, first) : bisect_right(self.updated_at, last)]


class TokenEvents:
    """Multiplier schedules and pause flags of one token plus the registry."""

    def __init__(self, events: list[dict], contract: str):
        mine = [e for e in events if e["contract"] in (contract, "registry")]
        self.schedules = [
            (
                e["block_ts"],
                int(e["args"]["old_multiplier"]),
                int(e["args"]["new_multiplier"]),
                e["args"]["effective_at"],
            )
            for e in mine
            if e["event"] == "UIMultiplierUpdated" and e["contract"] == contract
        ]
        self.flags = [
            (e["block_ts"], e["contract"], e["event"])
            for e in mine
            if e["event"] in ("Paused", "Unpaused", "OraclePaused", "OracleUnpaused")
        ]

    def multiplier_risky(self, instant: int) -> bool:
        for scheduled, old, new, effective in self.schedules:
            if scheduled > instant + STOP_EVENT_MARGIN or new == old:
                continue
            if effective > instant - STOP_EVENT_MARGIN and effective - instant <= MULTIPLIER_WINDOW + STOP_EVENT_MARGIN:
                return True
        return False

    def pause_risky(self, instant: int) -> bool:
        token_paused = registry_paused = oracle_paused = False
        for at, contract, event in self.flags:
            if abs(at - instant) <= STOP_EVENT_MARGIN:
                return True
            if at > instant:
                break
            if event in ("Paused", "Unpaused"):
                if contract == "registry":
                    registry_paused = event == "Paused"
                else:
                    token_paused = event == "Paused"
            else:
                oracle_paused = event == "OraclePaused"
        return token_paused or registry_paused or oracle_paused


@dataclass
class Payment:
    symbol: str
    index: int
    t: float
    start: int
    candidates: list[int]
    pos: int = 0
    walked: list[int] = field(default_factory=list)
    arrival_done: set = field(default_factory=set)
    calendar_done: bool = False
    guarded_done: set = field(default_factory=set)
    margin: set = field(default_factory=set)
    unresolved: str | None = None

    @property
    def finished(self) -> bool:
        sizes = set(SIZES_USDG)
        return self.arrival_done == sizes and self.calendar_done and self.guarded_done == sizes

    def instants(self) -> list[int]:
        return sorted(set(self.walked) | self.margin)


class Planner:
    def __init__(
        self,
        *,
        session,
        book,
        fetcher,
        stock: dict[str, Rounds],
        usdg: Rounds,
        events: dict[str, TokenEvents],
        open_intervals: list[tuple[int, int]],
        grid_open: dict[int, bool],
        end_ts: int,
        progress=None,
    ):
        self.session = session
        self.book = book
        self.fetcher = fetcher
        self.stock = stock
        self.usdg = usdg
        self.events = events
        self.boundaries = sorted({b for interval in open_intervals for b in interval if b is not None})
        self.grid_open = grid_open
        self.end_ts = end_ts
        self.progress = progress
        self._candidates: dict[str, list[int]] = {}

    def candidates(self, symbol: str, first: int) -> list[int]:
        """Open grid points, the ticker's rounds, and USDG/USD rounds that land while the session is open."""
        if symbol not in self._candidates:
            grid = [g for g, is_open in self.grid_open.items() if is_open and first <= g <= self.end_ts]
            usdg = self.usdg.instants(first, self.end_ts)
            usdg_open = [t for t, state in self.session.states(usdg).items() if state.open]
            rounds = self.stock[symbol].instants(first, self.end_ts) + usdg_open
            self._candidates[symbol] = sorted(set(grid) | set(rounds))
        return self._candidates[symbol]

    def payments(self, symbol: str, arrivals: list[dict], window_start: int) -> list[Payment]:
        cands = self.candidates(symbol, window_start - GRID_SECONDS)
        out = []
        for a in arrivals:
            start = a["unix"]
            later = cands[bisect_right(cands, start) :]
            out.append(Payment(symbol, a["i"], a["t"], start, [start] + later))
        return out

    # The stopping rule

    def _robust_pass(self, p: Payment, instant: int, block: int, size: int) -> bool:
        state = self.session.states([instant])[instant]
        if not state.open:
            return False
        feed = self.stock[p.symbol].in_force(instant)
        if feed is None or feed[1] <= 0:
            return False
        updated_at, answer = feed
        if updated_at < state.opened_at or instant - updated_at > FEED_MAX_AGE - STOP_AGE_MARGIN:
            return False
        if self.events[p.symbol].multiplier_risky(instant) or self.events[p.symbol].pause_risky(instant):
            return False
        usd = self.usdg.in_force(instant)
        if usd is None or instant - usd[0] > USDG_MAX_AGE - STOP_AGE_MARGIN:
            return False
        if abs(usd[1] - ONE_USD) * 10_000 > (USDG_TOLERANCE_BPS - STOP_USDG_MARGIN_BPS) * ONE_USD:
            return False
        best = self.book.best_out(p.symbol, block, size)
        if best is None:
            return False
        cap = 10_000 + PREMIUM_CAP_BPS - STOP_PREMIUM_MARGIN_BPS
        return AMOUNT_IN[size] * PREMIUM_SCALE * 10_000 <= best * answer * cap

    def _step(self, p: Payment, instant: int) -> None:
        block = self.fetcher.index.at_or_before(instant)
        p.walked.append(instant)
        working = {size for size in SIZES_USDG if self.book.best_out(p.symbol, block, size) is not None}
        p.arrival_done |= working
        if not p.calendar_done and self.session.states([instant])[instant].open and working == set(SIZES_USDG):
            p.calendar_done = True
        for size in SIZES_USDG:
            if size not in p.guarded_done and self._robust_pass(p, instant, block, size):
                p.guarded_done.add(size)

    @staticmethod
    def lookahead(steps_taken: int) -> int:
        """How many candidates to fetch ahead for a payment: one at first, then doubling up to 32 for a payment that
        keeps waiting, such as one that arrived before its pool had liquidity. Every instant is still evaluated in
        order; fetching ahead only saves rounds, at the cost of a few quotes past the stopping point."""
        return 1 if steps_taken < 2 else min(32, 2 ** (steps_taken - 1))

    def walk(self, payments: list[Payment]) -> None:
        active = list(payments)
        rounds = 0
        while active:
            rounds += 1
            need: dict[int, set[str]] = {}
            ahead: dict[int, list[int]] = {}
            for p in active:
                ahead[id(p)] = p.candidates[p.pos : p.pos + self.lookahead(len(p.walked))]
                for instant in ahead[id(p)]:
                    need.setdefault(instant, set()).add(p.symbol)
            if self.progress:
                self.progress(f"walk round {rounds}: {len(active)} payments, {len(need)} instants")
            self.fetcher.ensure(need)
            still = []
            for p in active:
                for instant in ahead[id(p)]:
                    self._step(p, instant)
                    p.pos += 1
                    if p.finished:
                        break
                if p.finished:
                    continue
                if p.pos >= len(p.candidates):
                    p.unresolved = "no evaluation instant left before the end block"
                    continue
                still.append(p)
            active = still

    def add_margins(self, payments: list[Payment]) -> None:
        need: dict[int, set[str]] = {}
        for p in payments:
            last = max(p.walked)
            lo = bisect_right(self.boundaries, p.start - BOUNDARY_MARGIN)
            hi = bisect_right(self.boundaries, last + BOUNDARY_MARGIN)
            for boundary in self.boundaries[lo:hi]:
                first, final = max(p.start, boundary - BOUNDARY_MARGIN), min(self.end_ts, boundary + BOUNDARY_MARGIN)
                grid = range(first + (-first) % GRID_SECONDS, final + 1, GRID_SECONDS)
                cands = p.candidates[bisect_left(p.candidates, first) : bisect_right(p.candidates, final)]
                p.margin |= set(grid) | set(cands)
            p.margin -= set(p.walked)
            for instant in p.margin:
                need.setdefault(instant, set()).add(p.symbol)
        if self.progress:
            self.progress(f"margins: {len(need)} instants")
        self.fetcher.ensure(need)
