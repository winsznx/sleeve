#!/usr/bin/env python3
"""Independent oracle for PriceGuard's premium arithmetic.

Writes contracts/test/fixtures/premium_vectors.json. PriceGuardVectors.t.sol replays every vector against
PriceGuard, and the verifier and the HP2 replay read the same file, so all three agree to the unit (D-009 Q11).

The arithmetic here is Python integers and fractions written from docs/SPEC.md section 4. It shares no code and no
derived constant with the Solidity: where PriceGuard scales the USDG side by 10^(t + f - u), this script multiplies
the token side by 10^u instead. With u, t and f the USDG, token and feed decimals:

    exceedsPremium   usdg * 10^(t + f) * 10000 > tokens * answer * 10^u * (10000 + cap)
    exceedsDiscount  usdg * 10^(t + f) * 10000 < tokens * answer * 10^u * (10000 - cap)
    execPriceBuy     ceil(usdg * 10^18 / tokens)      USDG base units per 1e18 token units, rounded up for the buyer
    execPriceSell    floor(usdg * 10^18 / tokens)     rounded down for the seller
    ratio            usdg * 10^(t + f) * 10000 / (tokens * answer * 10^u), as an exact fraction
    premiumBps       ceil(ratio - 10000)              the exact premium rounded up, against the buyer
    discountBps      ceil(10000 - ratio)              the exact discount rounded up, against the seller

Every rounding goes against the owner.

The decision block covers PriceGuard's whole input domain, uint256 amounts up to 2^256 - 1 included, with caps up
to 10,000 bps so that both tests are defined. The receipt block covers inputs where all four receipt figures fit
their types; PriceGuard reverts outside it, which the unit tests cover. Before writing, the script checks itself:
every boundary family must flip exactly where it claims, and the premiums of the raw quotes in
docs/research/pools.md must round to the values that note reports.

Usage, from anywhere:
    python3 scripts/premium_vectors.py           write the fixture
    python3 scripts/premium_vectors.py --check   exit 1 if the fixture on disk is not what this script writes
"""

import argparse
import json
import math
import random
import sys
from fractions import Fraction
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent.parent / "contracts" / "test" / "fixtures" / "premium_vectors.json"

MAX_UINT = 2**256 - 1
MAX_INT = 2**255 - 1
BPS = 10_000
PRICE_UNIT = 10**18
SEED = 4663

# PriceGuard's documented domain: t + f >= u and t + f - u <= 73, so that 10^(t + f - u) * 10000 fits a uint256.
MAX_SCALE_EXPONENT = 73

PRODUCTION = (6, 18, 8)  # USDG, stock token, feed decimals on chain 4663
OTHER_DECIMALS = [(6, 6, 8), (18, 18, 8), (6, 18, 18), (0, 0, 0), (8, 0, 8), (0, 37, 36)]

# Feed answers at the research blocks, 8 decimals: SPY, QQQ, NVDA and AAPL at 78,323,256, and NVDA at 78,327,113.
SPY, QQQ, NVDA, AAPL, NVDA_LATER = 77_071_210_575, 75_199_912_534, 23_755_399_953, 33_388_329_774, 23_625_799_569
HUNDRED_USD = 100 * 10**8
REAL_ANSWERS = [SPY, QQQ, NVDA, AAPL, HUNDRED_USD]

# Raw QuoterV2 outputs from docs/research/pools.md (appendix A and B, block 78,323,256) and
# docs/research/chain-constants.md (A.3, block 78,327,113): label, USDG in, tokens out, answer, and the premium in bps
# the note reports to two decimals, or None where it reports none.
RESEARCH_BUYS = [
    ("SPY fee 500, 100 USDG", 100_000_000, 129_483_823_700_188_790, SPY, 20.57),
    ("NVDA fee 500, 10 USDG", 10_000_000, 42_243_310_748_938_711, NVDA, -34.94),
    ("NVDA fee 500, 100 USDG", 100_000_000, 422_432_541_826_686_745, NVDA, -34.93),
    ("NVDA fee 500, 1,000 USDG", 1_000_000_000, 4_224_268_852_830_020_168, NVDA, -34.80),
    ("NVDA fee 500, 10,000 USDG", 10_000_000_000, 42_237_032_817_681_568_679, NVDA, -33.46),
    ("NVDA fee 3000, 100 USDG", 100_000_000, 420_302_527_898_622_378, NVDA, 15.57),
    ("NVDA fee 100, drained pool, 100 USDG", 100_000_000, 10_809_261_490, NVDA, None),
    ("NVDA fee 10000, drained pool, 100 USDG", 100_000_000, 18_970_284_859_849_569, NVDA, None),
    ("AAPL fee 500, 100 USDG", 100_000_000, 300_289_038_638_572_938, AAPL, -26.08),
    ("AAPL fee 500, 10,000 USDG", 10_000_000_000, 29_997_888_047_647_274_052, AAPL, -15.77),
    ("AAPL fee 3000, 100 USDG", 100_000_000, 298_932_952_993_294_512, AAPL, 19.16),
    ("AAPL fee 10000, 1,000 USDG", 1_000_000_000, 1_879_563_258_901_046_803, AAPL, 5934.86),
    ("NVDA fee 500 at block 78,327,113, 100 USDG", 100_000_000, 424_582_767_425_073_121, NVDA_LATER, None),
]

# Sell-backs of the 100 USDG fills, same note: label, tokens in, USDG out, answer, reported discount in bps.
RESEARCH_SELLS = [
    ("NVDA fee 500 sell-back", 422_432_541_826_686_745, 99_899_727, NVDA, 44.92),
    ("NVDA fee 3000 sell-back", 420_302_527_898_622_378, 99_322_055, NVDA, 52.33),
    ("AAPL fee 500 sell-back", 300_289_038_638_572_938, 99_897_969, AAPL, 36.26),
    ("AAPL fee 3000 sell-back", 298_932_952_993_294_512, 99_390_156, AAPL, 41.94),
    ("AAPL fee 10000 sell-back", 296_996_517_818_318_138, 97_198_543, AAPL, 198.02),
    ("NVDA fee 100 sell-back of the drained fill", 10_809_261_490, 2, NVDA, None),
]


# The oracle


def scaled(usdg: int, tokens: int, answer: int, decimals: tuple) -> tuple[int, int]:
    """Both sides of every comparison before the cap: USDG paid against the feed value of the tokens."""
    usdg_decimals, token_decimals, feed_decimals = decimals
    return usdg * 10 ** (token_decimals + feed_decimals) * BPS, tokens * answer * 10**usdg_decimals


def exceeds_premium(usdg: int, tokens: int, answer: int, cap: int, decimals: tuple) -> bool:
    paid, value = scaled(usdg, tokens, answer, decimals)
    return paid > value * (BPS + cap)


def exceeds_discount(usdg: int, tokens: int, answer: int, cap: int, decimals: tuple) -> bool:
    received, value = scaled(usdg, tokens, answer, decimals)
    return received < value * (BPS - cap)


def ratio(usdg: int, tokens: int, answer: int, decimals: tuple) -> Fraction:
    paid, value = scaled(usdg, tokens, answer, decimals)
    return Fraction(paid, value)


def premium_bps(usdg: int, tokens: int, answer: int, decimals: tuple) -> int:
    return math.ceil(ratio(usdg, tokens, answer, decimals) - BPS)


def discount_bps(usdg: int, tokens: int, answer: int, decimals: tuple) -> int:
    return math.ceil(BPS - ratio(usdg, tokens, answer, decimals))


def exec_price_buy(usdg: int, tokens: int) -> int:
    return math.ceil(Fraction(usdg * PRICE_UNIT, tokens))


def exec_price_sell(usdg: int, tokens: int) -> int:
    return math.floor(Fraction(usdg * PRICE_UNIT, tokens))


def decisions_defined(usdg: int, tokens: int, answer: int, cap: int, decimals: tuple) -> bool:
    usdg_decimals, token_decimals, feed_decimals = decimals
    exponent = token_decimals + feed_decimals - usdg_decimals
    return (
        0 <= usdg <= MAX_UINT
        and 0 <= tokens <= MAX_UINT
        and 1 <= answer <= MAX_INT
        and 0 <= cap <= BPS
        and 0 <= exponent <= MAX_SCALE_EXPONENT
        and all(0 <= d <= 255 for d in decimals)
    )


def receipts_defined(usdg: int, tokens: int, answer: int, decimals: tuple) -> bool:
    if not decisions_defined(usdg, tokens, answer, 0, decimals) or tokens == 0:
        return False
    if tokens * answer > MAX_UINT or exec_price_buy(usdg, tokens) > MAX_UINT:
        return False
    return math.ceil(ratio(usdg, tokens, answer, decimals)) <= MAX_INT


# Vector collection


class Vectors:
    def __init__(self) -> None:
        self.decisions: dict[tuple, str] = {}
        self.receipts: dict[tuple, str] = {}

    def decision(self, label: str, usdg: int, tokens: int, answer: int, cap: int, decimals: tuple = PRODUCTION):
        if not decisions_defined(usdg, tokens, answer, cap, decimals):
            sys.exit(f"decision vector outside PriceGuard's domain: {label}")
        self.decisions.setdefault((usdg, tokens, answer, cap, decimals), label)

    def receipt(self, label: str, usdg: int, tokens: int, answer: int, decimals: tuple = PRODUCTION):
        if not receipts_defined(usdg, tokens, answer, decimals):
            sys.exit(f"receipt vector outside PriceGuard's domain: {label}")
        self.receipts.setdefault((usdg, tokens, answer, decimals), label)

    def expect(self, label: str, case: tuple, side: str, fails: bool) -> None:
        """Adds a decision vector after checking the oracle flips where the boundary family says it does."""
        usdg, tokens, answer, cap, decimals = case
        outcome = (exceeds_premium if side == "premium" else exceeds_discount)(usdg, tokens, answer, cap, decimals)
        if outcome != fails:
            sys.exit(f"boundary family is wrong at '{label}': expected {'fail' if fails else 'pass'}")
        self.decision(label, usdg, tokens, answer, cap, decimals)


def gcd_tokens(answer: int, cap_factor: int, decimals: tuple) -> int:
    """Smallest token amount for which a whole USDG amount meets the cap with exact equality."""
    usdg_decimals, token_decimals, feed_decimals = decimals
    per_usdg = 10 ** (token_decimals + feed_decimals) * BPS
    per_token = answer * 10**usdg_decimals * cap_factor
    return per_usdg // math.gcd(per_usdg, per_token)


def premium_family(v: Vectors, name: str, tokens: int, answer: int, cap: int, decimals: tuple = PRODUCTION) -> None:
    """The USDG amount where a buy stops passing, with one unit either side in USDG, tokens and answer."""
    paid_per_usdg, value = scaled(1, tokens, answer, decimals)
    limit = value * (BPS + cap)
    last = limit // paid_per_usdg

    def case(label: str, usdg: int, fails: bool, token_amount: int = tokens, feed_answer: int = answer) -> None:
        vector = (usdg, token_amount, feed_answer, cap, decimals)
        v.expect(f"{name}, cap {cap}: premium{label}", vector, "premium", fails)

    if last > MAX_UINT:
        case(", every amount passes", MAX_UINT, False)
        return
    if limit % paid_per_usdg:
        case(", last passing USDG", last, False)
        if last < MAX_UINT:
            case(", first failing USDG", last + 1, True)
        return
    case(" at equality", last, False)
    if last < MAX_UINT:
        case(" at equality, USDG + 1", last + 1, True)
    if last > 0:
        case(" at equality, USDG - 1", last - 1, False)
    if last > 0 and tokens > 0:
        case(" at equality, tokens - 1", last, True, token_amount=tokens - 1)
    if tokens < MAX_UINT:
        case(" at equality, tokens + 1", last, False, token_amount=tokens + 1)
    if last > 0 and tokens > 0 and answer > 1:
        case(" at equality, answer - 1", last, True, feed_answer=answer - 1)
    if answer < MAX_INT:
        case(" at equality, answer + 1", last, False, feed_answer=answer + 1)


def discount_family(v: Vectors, name: str, tokens: int, answer: int, cap: int, decimals: tuple = PRODUCTION) -> None:
    """The USDG amount where a sell starts passing, with one unit either side in USDG, tokens and answer."""
    paid_per_usdg, value = scaled(1, tokens, answer, decimals)
    floor_value = value * (BPS - cap)
    first = -(-floor_value // paid_per_usdg)

    def case(label: str, usdg: int, fails: bool, token_amount: int = tokens, feed_answer: int = answer) -> None:
        vector = (usdg, token_amount, feed_answer, cap, decimals)
        v.expect(f"{name}, cap {cap}: discount{label}", vector, "discount", fails)

    if first > MAX_UINT:
        case(", every amount fails", MAX_UINT, True)
        return
    if floor_value % paid_per_usdg:
        case(", last failing USDG", first - 1, True)
        case(", first passing USDG", first, False)
        return
    case(" at equality", first, False)
    if first > 0:
        case(" at equality, USDG - 1", first - 1, True)
    if first < MAX_UINT:
        case(" at equality, USDG + 1", first + 1, False)
    if cap < BPS and first > 0:
        if tokens < MAX_UINT:
            case(" at equality, tokens + 1", first, True, token_amount=tokens + 1)
        if answer < MAX_INT:
            case(" at equality, answer + 1", first, True, feed_answer=answer + 1)
        case(" at equality, tokens - 1", first, False, token_amount=tokens - 1)
        if answer > 1:
            case(" at equality, answer - 1", first, False, feed_answer=answer - 1)


class Draws:
    """Deterministic draws from getrandbits only, which is stable across Python versions for an integer seed."""

    def __init__(self, seed: int) -> None:
        self.rng = random.Random(seed)

    def bits(self, max_bits: int) -> int:
        """A value with a uniformly drawn bit length up to max_bits, so every magnitude shows up."""
        length = self.rng.getrandbits(9) % (max_bits + 1)
        return self.rng.getrandbits(length) if length else 0

    def below(self, bound: int) -> int:
        while True:
            value = self.rng.getrandbits(bound.bit_length())
            if value < bound:
                return value

    def pick(self, items: list):
        return items[self.below(len(items))]


# Families


def boundary_decisions(v: Vectors) -> None:
    caps = [0, 1, 50, 100, 500, 9_999, 10_000]
    for answer in REAL_ANSWERS:
        for cap in caps:
            for multiple in (1, 1_000):
                name = f"answer {answer}, x{multiple}"
                premium_family(v, name, gcd_tokens(answer, BPS + cap, PRODUCTION) * multiple, answer, cap)
                # At a 10,000 bps cap the discount side is zero, so any token amount gives equality at zero USDG.
                tokens = gcd_tokens(answer, BPS - cap, PRODUCTION) if cap < BPS else 10**18
                discount_family(v, name, tokens * multiple, answer, cap)
    for decimals in OTHER_DECIMALS:
        name = f"decimals {decimals[0]}, {decimals[1]}, {decimals[2]}"
        for answer, cap in ((HUNDRED_USD, 0), (HUNDRED_USD, 100), (SPY, 100), (1, 500)):
            premium_family(v, name, gcd_tokens(answer, BPS + cap, decimals), answer, cap, decimals)
            discount_family(v, name, gcd_tokens(answer, BPS - cap, decimals), answer, cap, decimals)
    for label, _, tokens, answer, _ in RESEARCH_BUYS:
        for cap in (0, 100, 500):
            premium_family(v, f"{label} quote", tokens, answer, cap)
    for label, tokens, _, answer, _ in RESEARCH_SELLS:
        for cap in (0, 100, 500):
            discount_family(v, f"{label} quote", tokens, answer, cap)


def extreme_decisions(v: Vectors) -> None:
    amounts = [0, 1, 2**128, 2**255, MAX_UINT]
    answers = [1, 2**127, MAX_INT]
    for usdg in amounts:
        for tokens in amounts:
            for answer in answers:
                for cap in (0, 10_000):
                    v.decision(f"extreme: usdg {usdg}, tokens {tokens}, answer {answer}", usdg, tokens, answer, cap)
    # Exact equality at the top of the range: with answer 10^20 and cap 0, USDG equal to tokens meets the cap.
    premium_family(v, "top of range", MAX_UINT, 10**20, 0)
    discount_family(v, "top of range", MAX_UINT, 10**20, 0)
    # Right sides above 512 bits.
    v.decision("right side above 512 bits", MAX_UINT, MAX_UINT, MAX_INT, 10_000)
    v.decision("right side above 512 bits, cap 0", MAX_UINT, MAX_UINT, MAX_INT, 0)
    # tokens * answer * (10000 + cap) is exactly 2^523 and tokens * answer * (10000 - cap) exactly 2^522, so an
    # implementation that keeps only the low 512 bits of that product reads zero.
    v.decision("premium side is 2^523: a 512-bit wraparound reads zero", 1, 2**255, 2**254, 6_384)
    v.decision("discount side is 2^522: a 512-bit wraparound reads zero", MAX_UINT, 2**255, 2**254, 1_808)
    for cap in (0, 100, 500):
        tokens, answer = carry_trap(BPS + cap)
        v.decision(f"premium side passes 2^512 only through the carry, cap {cap}", 2**200, tokens, answer, cap)
        tokens, answer = carry_trap(BPS - cap)
        v.decision(f"discount side passes 2^512 only through the carry, cap {cap}", 2**200, tokens, answer, cap)


def carry_trap(factor: int) -> tuple[int, int]:
    """tokens and answer whose product times factor reaches 2^512 although the high word of tokens * answer times
    factor stays below 2^256: only the carry out of the low word pushes it over."""
    high = MAX_UINT // factor
    gap = 2**256 - high * factor
    lower = high * 2**256 + -(-gap * 2**256 // factor)
    upper = (high + 1) * 2**256 - 1
    for exponent in range(243, 255):
        answer = 2**exponent
        tokens = -(-lower // answer)
        if tokens <= MAX_UINT and tokens * answer <= upper:
            product = tokens * answer
            top = (product >> 256) * factor
            carry = (product & MAX_UINT) * factor >> 256
            if not top < 2**256 <= top + carry:
                sys.exit("carry trap construction is wrong")
            return tokens, answer
    sys.exit(f"no carry trap for factor {factor}")


def random_decisions(v: Vectors, draws: Draws, count: int) -> None:
    for i in range(count):
        decimals = PRODUCTION if i % 3 else draws.pick(OTHER_DECIMALS)
        answer = max(1, draws.bits(255))
        v.decision(f"random {i}", draws.bits(256), draws.bits(256), answer, draws.below(BPS + 1), decimals)


def huge_product_decisions(v: Vectors, draws: Draws, count: int) -> None:
    """Token amounts and answers so large that tokens * answer * (10000 +- cap) passes 2^512 in most draws."""
    for i in range(count):
        tokens = (1 << 255) | draws.rng.getrandbits(255)
        answer = (1 << 254) | draws.rng.getrandbits(254)
        v.decision(f"random huge product {i}", draws.bits(256), tokens, answer, draws.below(BPS + 1))


def near_threshold_decisions(v: Vectors, draws: Draws, count: int) -> None:
    for i in range(count):
        tokens = max(1, draws.bits(130))
        answer = max(1, draws.bits(64))
        cap = draws.below(BPS + 1)
        paid_per_usdg, value = scaled(1, tokens, answer, PRODUCTION)
        threshold = value * (BPS + cap) // paid_per_usdg if i % 2 else -(-value * (BPS - cap) // paid_per_usdg)
        offset = draws.below(5) - 2
        usdg = min(MAX_UINT, max(0, threshold + offset))
        v.decision(f"random near the {'premium' if i % 2 else 'discount'} threshold {i}", usdg, tokens, answer, cap)


def receipt_vectors(v: Vectors, draws: Draws, random_count: int) -> None:
    # One token at 100 USD: the ratio is usdg / 10^4 bps, so these walk every rounding direction around whole bps.
    deltas = [
        -100_000_000, -1_000_001, -1_000_000, -999_999, -170_400, -10_001, -10_000, -9_999, -5_000, -1, 0, 1,
        5_000, 9_999, 10_000, 10_001, 355_700, 999_999, 1_000_000, 1_000_001, 100_000_000,
    ]
    for delta in deltas:
        v.receipt(f"one token at 100 USD, {100_000_000 + delta} USDG units", 100_000_000 + delta, 10**18, HUNDRED_USD)
    for tokens in (1, 3, 7, 3 * 10**17, 10**18 - 1, 10**18, 10**18 + 1, 2 * 10**18, 10**24):
        for usdg in (0, 1, 99_999_999, 100_000_000, 100_000_001):
            v.receipt(f"execution price rounding, {usdg} USDG units for {tokens} token units", usdg, tokens, SPY)
    for label, usdg, tokens, answer, _ in RESEARCH_BUYS:
        v.receipt(f"{label} quote", usdg, tokens, answer)
    for label, tokens, usdg, answer, _ in RESEARCH_SELLS:
        v.receipt(f"{label} quote", usdg, tokens, answer)
    for decimals in OTHER_DECIMALS:
        usdg_decimals, token_decimals, feed_decimals = decimals
        hundred_usd = 100 * 10**feed_decimals
        for usdg in (0, 10**usdg_decimals * 100 - 1, 10**usdg_decimals * 100, 10**usdg_decimals * 100 + 1):
            label = f"decimals {usdg_decimals}, {token_decimals}, {feed_decimals}: {usdg} USDG units for 1 token"
            v.receipt(f"{label} at 100 USD", usdg, 10**token_decimals, hundred_usd, decimals)
    # The largest figures that still fit their types.
    v.receipt("largest buy price", MAX_UINT, 10**18, 10**7)
    v.receipt("tokens times answer is 2^256 - 1", MAX_UINT, 2**128 + 1, 2**128 - 1)
    v.receipt("tokens times answer is 2^256 - 1, tokens at the maximum", MAX_UINT, MAX_UINT, 1)
    for tokens in (10**20, 3 * 10**20, 7 * 10**20):
        # With decimals 0, 37 and 36 and answer 1 the ratio is usdg * 10^77 / tokens, so this is the largest USDG
        # amount whose rounded-up ratio fits an int256.
        usdg = MAX_INT * tokens // 10**77
        v.receipt(f"largest ratio that fits int256, {tokens} token units", usdg, tokens, 1, (0, 37, 36))
    count = 0
    while count < random_count:
        decimals = PRODUCTION if count % 4 else draws.pick(OTHER_DECIMALS)
        if count % 2:
            usdg, tokens, answer = draws.bits(200), max(1, draws.bits(200)), max(1, draws.bits(56))
        else:
            usdg, tokens, answer = draws.bits(48), max(1, draws.bits(80)), max(1, draws.bits(44))
        if receipts_defined(usdg, tokens, answer, decimals):
            v.receipt(f"random {count}", usdg, tokens, answer, decimals)
            count += 1


# Self-checks


def check_known_values() -> None:
    checks = [
        (exceeds_premium(101_000_000, 10**18, HUNDRED_USD, 100, PRODUCTION), False, "101 USDG for 1 token at 100 USD"),
        (exceeds_premium(101_000_001, 10**18, HUNDRED_USD, 100, PRODUCTION), True, "one unit more"),
        (exceeds_discount(99_000_000, 10**18, HUNDRED_USD, 100, PRODUCTION), False, "99 USDG for 1 token"),
        (exceeds_discount(98_999_999, 10**18, HUNDRED_USD, 100, PRODUCTION), True, "one unit less"),
        (premium_bps(101_000_000, 10**18, HUNDRED_USD, PRODUCTION), 100, "premium 100"),
        (premium_bps(98_296_000, 10**18, HUNDRED_USD, PRODUCTION), -170, "premium -170.4 rounds up"),
        (discount_bps(99_999_999, 10**18, HUNDRED_USD, PRODUCTION), 1, "discount 0.0001 rounds up"),
        (discount_bps(100_000_001, 10**18, HUNDRED_USD, PRODUCTION), 0, "discount -0.0001 rounds up"),
        (exec_price_buy(100_000_000, 3 * 10**17), 333_333_334, "buy price rounds up"),
        (exec_price_sell(100_000_000, 3 * 10**17), 333_333_333, "sell price rounds down"),
    ]
    for got, expected, label in checks:
        if got != expected:
            sys.exit(f"oracle self-check failed: {label}: {got} != {expected}")


def check_research() -> None:
    """The premiums and discounts of the raw research quotes round to the values the research note reports."""
    for label, usdg, tokens, answer, reported in RESEARCH_BUYS:
        exact = ratio(usdg, tokens, answer, PRODUCTION) - BPS
        if reported is not None and round(float(exact), 2) != reported:
            sys.exit(f"{label}: premium {float(exact):.4f} bps, research note says {reported}")
        if premium_bps(usdg, tokens, answer, PRODUCTION) != math.ceil(exact):
            sys.exit(f"{label}: premiumBps is not the ceiling of the exact premium")
    for label, tokens, usdg, answer, reported in RESEARCH_SELLS:
        exact = BPS - ratio(usdg, tokens, answer, PRODUCTION)
        if reported is not None and round(float(exact), 2) != reported:
            sys.exit(f"{label}: discount {float(exact):.4f} bps, research note says {reported}")


def check_rounding_coverage(receipts: dict) -> None:
    """Every rounding direction appears: each figure both exact and rounded, premiums and discounts on both signs."""
    seen = set()
    for usdg, tokens, answer, decimals in receipts:
        if (usdg * PRICE_UNIT) % tokens:
            seen.add("execution price rounded")
        else:
            seen.add("execution price exact")
        exact = ratio(usdg, tokens, answer, decimals)
        sign = "positive" if exact > BPS else "negative" if exact < BPS else "zero"
        seen.add(f"premium {sign} {'whole' if exact.denominator == 1 else 'fraction'}")
        seen.add(f"discount {'negative' if sign == 'positive' else 'positive' if sign == 'negative' else 'zero'} "
                 f"{'whole' if exact.denominator == 1 else 'fraction'}")
    required = {
        "execution price rounded", "execution price exact",
        "premium positive whole", "premium positive fraction", "premium negative whole", "premium negative fraction",
        "premium zero whole", "discount positive whole", "discount positive fraction", "discount negative whole",
        "discount negative fraction", "discount zero whole",
    }
    missing = required - seen
    if missing:
        sys.exit(f"receipt vectors miss rounding cases: {sorted(missing)}")


# Output


def render(value, depth: int = 0) -> str:
    """JSON with one key per line and each array on one line, so the file stays small and diffs stay readable."""
    if not isinstance(value, dict):
        return json.dumps(value, separators=(",", ":"))
    pad = "  " * (depth + 1)
    body = ",\n".join(f"{pad}{json.dumps(key)}: {render(item, depth + 1)}" for key, item in value.items())
    return "{\n" + body + "\n" + "  " * depth + "}"


LAYOUT = (
    "Two blocks of parallel arrays indexed by vector. Amounts are decimal strings, because many exceed 2^53. "
    "decisions: exceedsPremium(usdg, tokens, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals) and "
    "exceedsDiscount with the same arguments, where usdg is USDG spent for a buy or received for a sell and tokens is "
    "tokens received or sold. receipts: execPriceBuy(usdg, tokens), execPriceSell(usdg, tokens), premiumBps(usdg, "
    "tokens, answer, decimals) and discountBps(usdg, tokens, answer, decimals), every input chosen so all four fit "
    "their types. Labels say why each vector is there."
)


def build() -> str:
    check_known_values()
    check_research()
    v = Vectors()
    draws = Draws(SEED)
    boundary_decisions(v)
    extreme_decisions(v)
    random_decisions(v, draws, 200)
    near_threshold_decisions(v, draws, 200)
    huge_product_decisions(v, draws, 100)
    receipt_vectors(v, draws, 250)
    check_rounding_coverage(v.receipts)

    decisions = list(v.decisions.items())
    receipts = list(v.receipts.items())
    document = {
        "generator": "scripts/premium_vectors.py",
        "layout": LAYOUT,
        "formulas": {
            "exceedsPremium": "usdg * 10^(t + f) * 10000 > tokens * answer * 10^u * (10000 + capBps)",
            "exceedsDiscount": "usdg * 10^(t + f) * 10000 < tokens * answer * 10^u * (10000 - capBps)",
            "execPriceBuy": "ceil(usdg * 10^18 / tokens)",
            "execPriceSell": "floor(usdg * 10^18 / tokens)",
            "premiumBps": "ceil(usdg * 10^(t + f) * 10000 / (tokens * answer * 10^u) - 10000)",
            "discountBps": "ceil(10000 - usdg * 10^(t + f) * 10000 / (tokens * answer * 10^u))",
            "decimals": "u, t and f are the USDG, token and feed decimals; chain 4663 has 6, 18 and 8",
        },
        "seed": SEED,
        "counts": {"decisions": len(decisions), "receipts": len(receipts)},
        "decisions": {
            "label": [label for _, label in decisions],
            "usdg": [str(key[0]) for key, _ in decisions],
            "tokens": [str(key[1]) for key, _ in decisions],
            "answer": [str(key[2]) for key, _ in decisions],
            "capBps": [key[3] for key, _ in decisions],
            "usdgDecimals": [key[4][0] for key, _ in decisions],
            "tokenDecimals": [key[4][1] for key, _ in decisions],
            "feedDecimals": [key[4][2] for key, _ in decisions],
            "exceedsPremium": [exceeds_premium(*key) for key, _ in decisions],
            "exceedsDiscount": [exceeds_discount(*key) for key, _ in decisions],
        },
        "receipts": {
            "label": [label for _, label in receipts],
            "usdg": [str(key[0]) for key, _ in receipts],
            "tokens": [str(key[1]) for key, _ in receipts],
            "answer": [str(key[2]) for key, _ in receipts],
            "usdgDecimals": [key[3][0] for key, _ in receipts],
            "tokenDecimals": [key[3][1] for key, _ in receipts],
            "feedDecimals": [key[3][2] for key, _ in receipts],
            "execPriceBuy": [str(exec_price_buy(key[0], key[1])) for key, _ in receipts],
            "execPriceSell": [str(exec_price_sell(key[0], key[1])) for key, _ in receipts],
            "premiumBps": [str(premium_bps(*key)) for key, _ in receipts],
            "discountBps": [str(discount_bps(*key)) for key, _ in receipts],
        },
    }
    return render(document) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="compare with the fixture on disk instead of writing")
    args = parser.parse_args()
    text = build()
    if args.check:
        if not FIXTURE.exists() or FIXTURE.read_text() != text:
            sys.exit(f"stale: {FIXTURE}. Run python3 scripts/premium_vectors.py")
        print("fixture is current")
        return
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE.write_text(text)
    counts = json.loads(text)["counts"]
    print(f"wrote {FIXTURE}: {counts['decisions']} decision vectors, {counts['receipts']} receipt vectors")


if __name__ == "__main__":
    main()
