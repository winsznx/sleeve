"""What the guard and the references read at an instant, rebuilt offline from the fetched rounds, events and quotes.

Rounds. A feed's round in force at an instant is its latest kept round with updated_at at or before the instant. That
is what latestRoundData() returns at the instant's block: every instant the replay evaluates has a block whose
timestamp equals the instant (blocks.json proves each one), and a round's updated_at is the timestamp of the block that
transmitted it. run.py checks that the two orders agree on every evaluated instant, against the transmit blocks from
the AnswerUpdated logs. Rounds the protocol drops (answer above 10 times the feed's median) are left out.

Token views. paused(), oraclePaused(), uiMultiplier(), newUIMultiplier() and effectiveAt() follow from the token's and
the registry's events (docs/research/chain-constants.md section 3). paused() is the token's flag or the registry's
pause. A change scheduled by UIMultiplierUpdated is pending while effectiveAt is in the future, and uiMultiplier()
returns the old value until then.

Quotes. The best quote for a size is the largest amount_out among the successful quotes of the ticker's allowlisted
pools, ties going to the first pool in allowlist order. A quote whose sqrt_price_x96_after sits at the swap's price
limit ran out of liquidity before spending its input, so its amount_out does not price the full payment. A best quote
like that, or one with zero output, raises UnusableQuote and stops the run instead of being priced.
"""

from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from itertools import pairwise

MIN_SQRT_RATIO = 4_295_128_739
MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
PRICE_LIMITS = frozenset({MIN_SQRT_RATIO + 1, MAX_SQRT_RATIO - 1})


class UnusableQuote(Exception):
    """The best quote at an instant does not price the full payment."""


@dataclass(frozen=True)
class Round:
    round_id: int
    aggregator_round: int
    answer: int
    updated_at: int
    block: int | None


class Feed:
    """A feed's kept rounds, in round order."""

    def __init__(self, name: str, rounds: list[Round]):
        stamps = [r.updated_at for r in rounds]
        if stamps != sorted(stamps):
            raise ValueError(f"{name} rounds are not in updated_at order")
        self.name = name
        self.rounds = rounds
        self.updated_at = stamps
        blocks = [r.block for r in rounds]
        self.blocks = blocks if None not in blocks and blocks == sorted(blocks) else None

    @classmethod
    def from_document(cls, name: str, doc: dict) -> "Feed":
        kept = [
            Round(int(r["round_id"]), r["aggregator_round"], int(r["answer"]), r["updated_at"], r["block"])
            for r in doc["rounds"]
            if not r["dropped"]
        ]
        return cls(name, kept)

    def in_force(self, instant: int) -> Round | None:
        i = bisect_right(self.updated_at, instant) - 1
        return self.rounds[i] if i >= 0 else None

    def first_at_or_after(self, instant: int) -> Round | None:
        i = bisect_left(self.updated_at, instant)
        return self.rounds[i] if i < len(self.rounds) else None

    def in_force_at_block(self, block: int) -> Round | None:
        """The latest round transmitted at or before the block, from the AnswerUpdated transmit blocks."""
        if self.blocks is None:
            raise ValueError(f"{self.name} rounds lack transmit blocks in round order")
        i = bisect_right(self.blocks, block) - 1
        return self.rounds[i] if i >= 0 else None


class FlagHistory:
    """A Pausable flag over time. Pausable emits its set and clear events alternately, so the flag before the first
    event is the opposite of what that event sets, and a flag with no events was never set."""

    def __init__(self, changes: list[tuple[int, bool]]):
        for (_, before), (at, after) in pairwise(changes):
            if before == after:
                raise ValueError(f"pause events do not alternate at {at}")
        self.initial = not changes[0][1] if changes else False
        self.stamps = [at for at, _ in changes]
        self.values = [value for _, value in changes]

    def at(self, instant: int) -> bool:
        i = bisect_right(self.stamps, instant) - 1
        return self.values[i] if i >= 0 else self.initial


@dataclass(frozen=True)
class MultiplierChange:
    scheduled_at: int
    old: int
    new: int
    effective_at: int


class TokenState:
    """One stock token's guard views at any instant, from its events and the registry's, as events.json lists them."""

    def __init__(self, symbol: str, events: list[dict]):
        ordered = sorted(events, key=lambda e: (e["block"], e["log_index"]))
        self.symbol = symbol
        self.changes = [
            MultiplierChange(
                e["block_ts"],
                int(e["args"]["old_multiplier"]),
                int(e["args"]["new_multiplier"]),
                e["args"]["effective_at"],
            )
            for e in ordered
            if e["contract"] == symbol and e["event"] == "UIMultiplierUpdated"
        ]
        self.token_paused = _flag(ordered, symbol, "Paused", "Unpaused")
        self.registry_paused = _flag(ordered, "registry", "Paused", "Unpaused")
        self.oracle = _flag(ordered, symbol, "OraclePaused", "OracleUnpaused")

    def paused(self, instant: int) -> bool:
        return self.token_paused.at(instant) or self.registry_paused.at(instant)

    def oracle_paused(self, instant: int) -> bool:
        return self.oracle.at(instant)

    def multiplier_pending(self, instant: int, window: int) -> bool:
        """PriceGuard.checkMultiplier: newUIMultiplier() != uiMultiplier() and instant < effectiveAt() <= instant +
        window. effectiveAt() is 0 before the first schedule, and a reschedule overwrites the pending change."""
        scheduled = [c for c in self.changes if c.scheduled_at <= instant]
        if not scheduled:
            return False
        change = scheduled[-1]
        if change.effective_at <= instant or change.effective_at - instant > window:
            return False
        return change.new != change.old

    def last_flag_event(self) -> int | None:
        stamps = self.token_paused.stamps + self.registry_paused.stamps + self.oracle.stamps
        return max(stamps) if stamps else None


def _flag(events: list[dict], contract: str, set_event: str, clear_event: str) -> FlagHistory:
    mine = [e for e in events if e["contract"] == contract and e["event"] in (set_event, clear_event)]
    return FlagHistory([(e["block_ts"], e["event"] == set_event) for e in mine])


@dataclass(frozen=True)
class Quote:
    pool: str
    fee: int
    usdg_in: int
    amount_out: int


def pool_outcomes(row: dict, size: int) -> list[tuple[str, int, int | None]]:
    """Every allowlisted pool's quote for the size at a block: (pool, fee, amount_out), amount_out None on a revert."""
    return [
        (q["pool"], q["fee"], int(q["amount_out"]) if q["ok"] else None) for q in row["quotes"] if q["usdg_in"] == size
    ]


def at_price_limit(quote: dict) -> bool:
    return quote["ok"] and int(quote["sqrt_price_x96_after"]) in PRICE_LIMITS


def best_quote(row: dict, size: int, usdg_decimals: int) -> Quote | None:
    """The quote a policy buys at for a payment of `size` USDG, or None when every allowlisted pool reverted."""
    best = None
    for q in row["quotes"]:
        if q["usdg_in"] == size and q["ok"] and (best is None or int(q["amount_out"]) > int(best["amount_out"])):
            best = q
    if best is None:
        return None
    if at_price_limit(best) or int(best["amount_out"]) == 0:
        raise UnusableQuote(
            f"block {row['block']}: the best {size} USDG quote, pool {best['pool']}, does not price the full payment"
        )
    return Quote(best["pool"], best["fee"], size * 10**usdg_decimals, int(best["amount_out"]))
