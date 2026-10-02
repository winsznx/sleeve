"""Synthetic inputs for the engine tests: a calendar on fixed intervals, rounds, token events and quotes priced at a
chosen premium."""

from hp2.constants import FEED_DECIMALS, TOKEN_DECIMALS, USDG_DECIMALS
from hp2.engine.calendar import ModuleCalendar
from hp2.engine.market import Feed, Round
from hp2.session import SessionState

HOUR = 3600
DAY = 86_400
# Sunday 2026-09-27 20:00 EDT to Friday 2026-10-02 20:00 EDT, the last session in the data, and the next one.
OPEN, CLOSE = 1_790_553_600, 1_790_985_600
NEXT_OPEN = 1_791_158_400
ONE_USD = 10**FEED_DECIMALS
ANSWER = 30_000_000_000  # 300 USD
POOL_A = "0x00000000000000000000000000000000000000a5"
POOL_B = "0x00000000000000000000000000000000000000b3"
VALUE_SCALE = 10 ** (TOKEN_DECIMALS + FEED_DECIMALS - USDG_DECIMALS)


class IntervalSessions:
    """A session backend on fixed half-open intervals, answering like PortSession."""

    source_sha256 = "intervals"

    def __init__(self, intervals=((OPEN, CLOSE), (NEXT_OPEN, NEXT_OPEN + 5 * DAY))):
        self.intervals = list(intervals)
        self.asked = 0

    def states(self, timestamps):
        out = {}
        for ts in timestamps:
            self.asked += 1
            hit = next(((o, c) for o, c in self.intervals if o <= int(ts) < c), None)
            out[int(ts)] = SessionState(hit is not None, hit[0] if hit else 0, 1 if hit else 2)
        return out


def calendar(intervals=((OPEN, CLOSE), (NEXT_OPEN, NEXT_OPEN + 5 * DAY))) -> ModuleCalendar:
    return ModuleCalendar(IntervalSessions(intervals), "intervals")


def feed(instants, answer=ANSWER, name="AAPL") -> Feed:
    answers = answer if isinstance(answer, list) else [answer] * len(instants)
    return Feed(name, [Round(1000 + n, n + 1, a, t, 10 * t) for n, (t, a) in enumerate(zip(instants, answers))])


def usdg_feed(instants, answer=ONE_USD) -> Feed:
    return feed(instants, answer, name="USDG/USD")


def multiplier_event(scheduled: int, effective: int, old=10**18, new=10**18 + 5 * 10**14, contract="AAPL") -> dict:
    return {
        "contract": contract,
        "event": "UIMultiplierUpdated",
        "block": scheduled,
        "log_index": 0,
        "block_ts": scheduled,
        "args": {"old_multiplier": str(old), "new_multiplier": str(new), "effective_at": effective},
    }


def flag_event(at: int, event: str, contract="AAPL") -> dict:
    return {"contract": contract, "event": event, "block": at, "log_index": 0, "block_ts": at, "args": {}}


def tokens_for(premium_bps, size: int, answer: int = ANSWER) -> int:
    """The amount_out that puts a buy of `size` USDG exactly premium_bps above `answer`, rounded down."""
    return size * 10**USDG_DECIMALS * VALUE_SCALE * 10_000 // (answer * (10_000 + premium_bps))


def quote(pool: str, fee: int, size: int, amount_out: int | None, sqrt_after: int = 2**96) -> dict:
    if amount_out is None:
        return {"pool": pool, "fee": fee, "usdg_in": size, "ok": False, "error": {"code": 3, "message": "revert"}}
    return {
        "pool": pool,
        "fee": fee,
        "usdg_in": size,
        "ok": True,
        "amount_out": str(amount_out),
        "sqrt_price_x96_after": str(sqrt_after),
        "initialized_ticks_crossed": 1,
        "gas_estimate": 100_000,
    }


class PricedQuotes:
    """Quotes from one pool at premium_at(instant) bps over `answer`, None meaning the pool reverts. The block of an
    instant is the instant itself."""

    def __init__(self, premium_at, answer: int = ANSWER):
        self.premium_at = premium_at
        self.answer = answer

    def at(self, instant: int) -> dict:
        premium = self.premium_at(instant)
        quotes = [
            quote(POOL_A, 500, size, None if premium is None else tokens_for(premium, size, self.answer))
            for size in (100, 1000)
        ]
        return {"block": instant, "block_ts": instant, "instants": [instant], "quotes": quotes}
