import unittest
from dataclasses import replace

from hp2.engine.guard import GuardParams, Market, Reason, check, depegged, stale
from hp2.engine.market import Quote, Round
from hp2.tests.engine_fixtures import ANSWER, DAY, HOUR, ONE_USD, OPEN, POOL_A, tokens_for

NOW = OPEN + 2 * HOUR
FRESH = Round(2, 2, ANSWER, OPEN + 40, None)
USDG = Round(9, 9, ONE_USD, NOW - 23 * HOUR, None)
PASSING = Market(
    instant=NOW,
    session_open=True,
    opened_at=OPEN,
    paused=False,
    oracle_paused=False,
    multiplier_pending=False,
    round=FRESH,
    usdg_round=USDG,
)
PARAMS = GuardParams()


def at_premium(bps, size=100, answer=ANSWER) -> Quote:
    return Quote(POOL_A, 500, size * 10**6, tokens_for(bps, size, answer))


class ChecksTest(unittest.TestCase):
    def test_everything_passing_buys(self):
        self.assertEqual(check(PASSING, at_premium(20)), Reason.NONE)

    def test_paused_token_or_registry(self):
        self.assertEqual(check(replace(PASSING, paused=True), at_premium(20)), Reason.PAUSED)

    def test_oracle_paused(self):
        self.assertEqual(check(replace(PASSING, oracle_paused=True), at_premium(20)), Reason.ORACLE_PAUSED)

    def test_session_closed(self):
        self.assertEqual(check(replace(PASSING, session_open=False, opened_at=0), at_premium(20)), Reason.SESSION)

    def test_multiplier_change_pending(self):
        self.assertEqual(check(replace(PASSING, multiplier_pending=True), at_premium(20)), Reason.MULTIPLIER)

    def test_no_round_or_a_non_positive_answer_is_stale(self):
        self.assertEqual(check(replace(PASSING, round=None), at_premium(20)), Reason.STALE)
        self.assertEqual(check(replace(PASSING, round=replace(FRESH, answer=0)), at_premium(20)), Reason.STALE)
        self.assertEqual(check(replace(PASSING, round=replace(FRESH, answer=-1)), at_premium(20)), Reason.STALE)

    def test_round_from_the_future_is_stale(self):
        self.assertEqual(
            check(replace(PASSING, round=replace(FRESH, updated_at=NOW + 1)), at_premium(20)), Reason.STALE
        )

    def test_feed_age_limit_is_25_hours_and_equality_passes(self):
        late = replace(PASSING, opened_at=OPEN - 3 * DAY)
        at_limit = replace(late, round=replace(FRESH, updated_at=NOW - 25 * HOUR))
        over = replace(late, round=replace(FRESH, updated_at=NOW - 25 * HOUR - 1))
        self.assertFalse(stale(at_limit, PARAMS.feed_max_age))
        self.assertEqual(check(at_limit, at_premium(20)), Reason.NONE)
        self.assertEqual(check(over, at_premium(20)), Reason.STALE)

    def test_a_round_held_over_the_reopen_is_stale_until_a_fresh_one_lands(self):
        held = replace(PASSING, instant=OPEN + 10, round=replace(FRESH, updated_at=OPEN - 2 * HOUR))
        self.assertEqual(check(held, at_premium(20)), Reason.STALE)
        at_open = replace(held, round=replace(FRESH, updated_at=OPEN))
        self.assertEqual(check(at_open, at_premium(20)), Reason.NONE)

    def test_usdg_band_edges_pass(self):
        for answer, reason in [
            (ONE_USD * 9950 // 10_000, Reason.NONE),
            (ONE_USD * 9950 // 10_000 - 1, Reason.DEPEG),
            (ONE_USD * 10_050 // 10_000, Reason.NONE),
            (ONE_USD * 10_050 // 10_000 + 1, Reason.DEPEG),
            (0, Reason.DEPEG),
        ]:
            market = replace(PASSING, usdg_round=replace(USDG, answer=answer))
            self.assertEqual(check(market, at_premium(20)), reason, answer)

    def test_usdg_age_limit_is_25_hours(self):
        at_limit = replace(PASSING, usdg_round=replace(USDG, updated_at=NOW - 25 * HOUR))
        over = replace(PASSING, usdg_round=replace(USDG, updated_at=NOW - 25 * HOUR - 1))
        self.assertFalse(depegged(at_limit, PARAMS.usdg_tolerance_bps, PARAMS.usdg_max_age))
        self.assertEqual(check(over, at_premium(20)), Reason.DEPEG)
        self.assertEqual(check(replace(PASSING, usdg_round=None), at_premium(20)), Reason.DEPEG)
        future = replace(PASSING, usdg_round=replace(USDG, updated_at=NOW + 1))
        self.assertEqual(check(future, at_premium(20)), Reason.DEPEG)

    def test_every_pool_reverting(self):
        self.assertEqual(check(PASSING, None), Reason.NO_QUOTE)

    def test_premium_cap_equality_passes_and_one_unit_more_fails(self):
        # One token at 100 USD bought for 101 USDG is exactly 100 bps over the round, the cap.
        market = replace(PASSING, round=replace(FRESH, answer=100 * 10**8))
        exact = Quote(POOL_A, 500, 101 * 10**6, 10**18)
        self.assertEqual(check(market, exact), Reason.NONE)
        self.assertEqual(check(market, replace(exact, amount_out=10**18 - 1)), Reason.PREMIUM)
        self.assertEqual(check(market, replace(exact, usdg_in=101 * 10**6 + 1)), Reason.PREMIUM)

    def test_premium_cap_follows_the_parameter(self):
        self.assertEqual(check(PASSING, at_premium(60), GuardParams(premium_cap_bps=50)), Reason.PREMIUM)
        self.assertEqual(check(PASSING, at_premium(-60), GuardParams(premium_cap_bps=0)), Reason.NONE)


class OrderTest(unittest.TestCase):
    """The first failing check in the module's order is the reason."""

    def test_order(self):
        everything_wrong = Market(
            instant=NOW,
            session_open=False,
            opened_at=0,
            paused=True,
            oracle_paused=True,
            multiplier_pending=True,
            round=None,
            usdg_round=None,
        )
        expected = [
            ({}, Reason.PAUSED),
            ({"paused": False}, Reason.ORACLE_PAUSED),
            ({"oracle_paused": False}, Reason.SESSION),
            ({"session_open": True, "opened_at": OPEN}, Reason.MULTIPLIER),
            ({"multiplier_pending": False}, Reason.STALE),
            ({"round": FRESH}, Reason.DEPEG),
            ({"usdg_round": USDG}, Reason.NO_QUOTE),
        ]
        market = everything_wrong
        for change, reason in expected:
            market = replace(market, **change)
            self.assertEqual(check(market, None), reason)
        self.assertEqual(check(market, at_premium(500)), Reason.PREMIUM)
        self.assertEqual(check(market, at_premium(20)), Reason.NONE)


if __name__ == "__main__":
    unittest.main()
