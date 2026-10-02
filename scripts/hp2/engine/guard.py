"""The guarded policy's test at one instant: the module's guard with the protocol's parameters (docs/HP2_PROTOCOL.md,
Policies; docs/SPEC.md sections 4 and 9), on the replay's view of the chain.

Checks run in the module's order and the first failure is the reason: PAUSED, ORACLE_PAUSED, SESSION, MULTIPLIER,
STALE, DEPEG, then the buy, where NO_QUOTE means every allowlisted pool's quote reverted (the replay's stand-in for a
swap that reverts) and PREMIUM is PriceGuard.exceedsPremium against the round in force. Module steps outside the
protocol's list do not run: the ticker and its pools are the allowlist, the blocklist is not one of the protocol's
checks, and the clip never binds because 100 and 1,000 USDG are above every clip a rule may set.
"""

from dataclasses import dataclass
from enum import Enum

from hp2.constants import (
    FEED_DECIMALS,
    FEED_MAX_AGE,
    MULTIPLIER_WINDOW,
    PREMIUM_CAP_BPS,
    USDG_MAX_AGE,
    USDG_TOLERANCE_BPS,
)
from hp2.engine.market import Quote, Round
from hp2.engine.premium import BPS, exceeds_premium


class Reason(str, Enum):
    NONE = "NONE"
    PAUSED = "PAUSED"
    ORACLE_PAUSED = "ORACLE_PAUSED"
    SESSION = "SESSION"
    MULTIPLIER = "MULTIPLIER"
    STALE = "STALE"
    DEPEG = "DEPEG"
    NO_QUOTE = "NO_QUOTE"
    PREMIUM = "PREMIUM"


@dataclass(frozen=True)
class GuardParams:
    """docs/HP2_PROTOCOL.md and PriceGuard.defaultGuardParams (D-014), with the default 100 bps premium cap."""

    feed_max_age: int = FEED_MAX_AGE
    multiplier_window: int = MULTIPLIER_WINDOW
    usdg_tolerance_bps: int = USDG_TOLERANCE_BPS
    usdg_max_age: int = USDG_MAX_AGE
    premium_cap_bps: int = PREMIUM_CAP_BPS


DEFAULT_PARAMS = GuardParams()


@dataclass(frozen=True)
class Market:
    """What the module would read at an instant, size aside."""

    instant: int
    session_open: bool
    opened_at: int
    paused: bool
    oracle_paused: bool
    multiplier_pending: bool
    round: Round | None
    usdg_round: Round | None


def stale(market: Market, max_age: int) -> bool:
    """PriceGuard.readStockFeed: no round, an answer at or below zero, a round from the future, one older than
    max_age, or one from before the session opened. A round updated at the opening second counts."""
    r = market.round
    return (
        r is None
        or r.answer <= 0
        or r.updated_at > market.instant
        or market.instant - r.updated_at > max_age
        or r.updated_at < market.opened_at
    )


def depegged(market: Market, tolerance_bps: int, max_age: int) -> bool:
    """PriceGuard.checkUsdg: no round, an answer at or below zero, a round from the future or older than max_age, or
    an answer outside one plus or minus tolerance_bps. Both band edges pass."""
    r = market.usdg_round
    if r is None or r.answer <= 0 or r.updated_at > market.instant or market.instant - r.updated_at > max_age:
        return True
    one = 10**FEED_DECIMALS
    return not one * (BPS - tolerance_bps) <= r.answer * BPS <= one * (BPS + tolerance_bps)


def check(market: Market, quote: Quote | None, params: GuardParams = DEFAULT_PARAMS) -> Reason:
    """The first failing check at this instant, or NONE when the guarded policy buys."""
    if market.paused:
        return Reason.PAUSED
    if market.oracle_paused:
        return Reason.ORACLE_PAUSED
    if not market.session_open:
        return Reason.SESSION
    if market.multiplier_pending:
        return Reason.MULTIPLIER
    if stale(market, params.feed_max_age):
        return Reason.STALE
    if depegged(market, params.usdg_tolerance_bps, params.usdg_max_age):
        return Reason.DEPEG
    if quote is None:
        return Reason.NO_QUOTE
    if exceeds_premium(quote.usdg_in, quote.amount_out, market.round.answer, params.premium_cap_bps):
        return Reason.PREMIUM
    return Reason.NONE
