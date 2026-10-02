"""Premium arithmetic for buys, the same as PriceGuard's (docs/SPEC.md section 4, docs/DECISIONS.md D-009 Q11).

With u, t and f the USDG, token and feed decimals (6, 18 and 8 on chain 4663):

    exceeds_premium  usdg * 10^(t + f - u) * 10000 > tokens * answer * (10000 + cap)   equality passes
    premium_exact    usdg * 10^(t + f - u) * 10000 / (tokens * answer) - 10000         exact, in basis points
    premium_bps      ceil(premium_exact)                                                the receipt figure
    exec_price_buy   ceil(usdg * 10^18 / tokens)                USDG base units per 1e18 token base units

Python integers are exact, so the cap test is the integer inequality the module runs and rounding never decides a fill.
Rounding only shapes the figures shown, and always goes against the owner. The statistics use premium_exact.
tests/test_engine_premium.py replays the shared vectors in contracts/test/fixtures/premium_vectors.json, the file the
module tests and the verifier also read, against these functions.
"""

import math
from fractions import Fraction

from hp2.constants import FEED_DECIMALS, TOKEN_DECIMALS, USDG_DECIMALS

BPS = 10_000
PRICE_UNIT = 10**18
CHAIN_DECIMALS = (USDG_DECIMALS, TOKEN_DECIMALS, FEED_DECIMALS)


def _usdg_scale(decimals: tuple[int, int, int]) -> int:
    """10^(t + f - u): puts USDG base units on the scale of token base units times answer units."""
    usdg_decimals, token_decimals, feed_decimals = decimals
    exponent = token_decimals + feed_decimals - usdg_decimals
    if exponent < 0:
        raise ValueError(f"token and feed decimals {decimals[1:]} are below the USDG decimals {usdg_decimals}")
    return 10**exponent


def _positive(answer: int) -> int:
    if answer <= 0:
        raise ValueError(f"feed answer {answer} is not positive")
    return answer


def exceeds_premium(
    usdg_spent: int, tokens_out: int, answer: int, cap_bps: int, decimals: tuple[int, int, int] = CHAIN_DECIMALS
) -> bool:
    """PriceGuard.exceedsPremium: true when the buy paid more than cap_bps above the feed price."""
    return usdg_spent * _usdg_scale(decimals) * BPS > tokens_out * _positive(answer) * (BPS + cap_bps)


def premium_exact(
    usdg_spent: int, tokens_out: int, answer: int, decimals: tuple[int, int, int] = CHAIN_DECIMALS
) -> Fraction:
    """10,000 * (execution price / reference price - 1), with the execution price usdg_spent / tokens_out."""
    if tokens_out <= 0:
        raise ValueError(f"tokens out {tokens_out} is not positive")
    return Fraction(usdg_spent * _usdg_scale(decimals) * BPS, tokens_out * _positive(answer)) - BPS


def premium_bps(usdg_spent: int, tokens_out: int, answer: int, decimals: tuple[int, int, int] = CHAIN_DECIMALS) -> int:
    """PriceGuard.premiumBps: the exact premium rounded up, against the owner."""
    return math.ceil(premium_exact(usdg_spent, tokens_out, answer, decimals))


def exec_price_buy(usdg_spent: int, tokens_out: int) -> int:
    """PriceGuard.execPriceBuy: USDG base units per 1e18 token base units, rounded up, against the owner."""
    if tokens_out <= 0:
        raise ValueError(f"tokens out {tokens_out} is not positive")
    return -(-usdg_spent * PRICE_UNIT // tokens_out)
