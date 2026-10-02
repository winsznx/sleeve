import unittest

from hp2.engine.market import TokenState
from hp2.engine.policies import (
    ARRIVAL,
    CALENDAR_ONLY,
    GUARDED,
    Payment,
    TickerReplay,
    Unresolved,
    open_grid,
)
from hp2.tests.engine_fixtures import (
    CLOSE,
    DAY,
    HOUR,
    NEXT_OPEN,
    OPEN,
    PricedQuotes,
    calendar,
    feed,
    multiplier_event,
    usdg_feed,
)

ROUNDS = [OPEN - 2 * DAY, OPEN + 40, OPEN + 5 * HOUR + 7, OPEN + 2 * DAY + 11, NEXT_OPEN + 30]


def replay(premium_at=lambda t: 10, rounds=ROUNDS, events=(), last=NEXT_OPEN + 4 * DAY):
    cal = calendar()
    return TickerReplay(
        "AAPL",
        calendar=cal,
        feed=feed(rounds),
        usdg=usdg_feed([OPEN - 3 * DAY + d * DAY for d in range(14)]),
        token=TokenState("AAPL", list(events)),
        quotes=PricedQuotes(premium_at),
        grid=open_grid(cal, OPEN - 3 * DAY, last),
        last_instant=last,
    )


def payment(t: float) -> Payment:
    return Payment("AAPL", 0, t, int(t // 1))


def instants(fills):
    return {policy: fill.evaluation.instant for policy, fill in fills.items()}


class EvaluationInstantsTest(unittest.TestCase):
    def test_grid_is_open_points_only_and_rounds_come_in_any_session_state(self):
        r = replay(rounds=[OPEN - 2 * DAY, OPEN + 40])
        self.assertIn(OPEN, r.instants)
        self.assertNotIn(OPEN - 900, r.instants)
        self.assertNotIn(CLOSE, r.instants)
        self.assertIn(CLOSE - 900, r.instants)
        self.assertIn(OPEN - 2 * DAY, r.kinds)
        self.assertEqual(r.kinds[OPEN + 40], ("round",))
        self.assertEqual(r.kinds[OPEN], ("grid",))

    def test_walk_starts_at_the_arrival_and_skips_its_own_second(self):
        r = replay()
        walked = [instant for instant, _ in zip(r.walk(payment(OPEN + 0.5)), range(3))]
        self.assertEqual(walked, [(OPEN, ("arrival", "grid")), (OPEN + 40, ("round",)), (OPEN + 900, ("grid",))])


class PoliciesTest(unittest.TestCase):
    def test_in_session_arrival_buys_at_once_under_every_policy(self):
        p = payment(OPEN + HOUR + 0.25)
        fills, trail = replay().replay(p, 100)
        self.assertEqual(instants(fills), dict.fromkeys((ARRIVAL, GUARDED, CALENDAR_ONLY), OPEN + HOUR))
        self.assertTrue(all(f.at_arrival and f.delay(p) == 0 for f in fills.values()))
        self.assertEqual(len(trail), 1)

    def test_weekend_arrival(self):
        p = payment(OPEN - DAY + 0.5)
        fills, trail = replay().replay(p, 100)
        self.assertEqual(instants(fills), {ARRIVAL: OPEN - DAY, CALENDAR_ONLY: OPEN, GUARDED: OPEN + 40})
        self.assertEqual(fills[GUARDED].wait_reasons, (("SESSION", 1), ("STALE", 1)))
        self.assertEqual(fills[GUARDED].evaluations, 3)
        self.assertEqual(fills[GUARDED].delay(p), DAY + 40 - 0.5)
        self.assertEqual([e.instant for e in trail], [OPEN - DAY, OPEN, OPEN + 40])

    def test_premium_above_the_cap_waits_for_the_next_instant_under_it(self):
        start = OPEN + HOUR + 1
        fills, _ = replay(premium_at=lambda t: 150 if t < OPEN + 2 * HOUR else 30).replay(payment(start), 100)
        self.assertEqual(instants(fills), {ARRIVAL: start, CALENDAR_ONLY: start, GUARDED: OPEN + 2 * HOUR})
        self.assertEqual(fills[GUARDED].wait_reasons, (("PREMIUM", 4),))

    def test_reverting_pools_send_arrival_to_the_first_working_quote(self):
        start = OPEN - DAY
        fills, _ = replay(premium_at=lambda t: None if t < OPEN + 900 else 10).replay(payment(start), 100)
        self.assertEqual(instants(fills), {ARRIVAL: OPEN + 900, CALENDAR_ONLY: OPEN + 900, GUARDED: OPEN + 900})
        self.assertFalse(fills[ARRIVAL].at_arrival)
        self.assertEqual(fills[ARRIVAL].no_quote_skips, 3)
        self.assertEqual(fills[CALENDAR_ONLY].no_quote_skips, 2)
        self.assertEqual(fills[GUARDED].no_quote_skips, 1)
        self.assertEqual(fills[GUARDED].wait_reasons, (("SESSION", 1), ("STALE", 1), ("NO_QUOTE", 1)))

    def test_pending_multiplier_holds_only_the_guarded_policy(self):
        scheduled, effective = OPEN + DAY, OPEN + DAY + 600
        r = replay(events=[multiplier_event(scheduled, effective)])
        fills, _ = r.replay(payment(scheduled + 100), 100)
        self.assertEqual(fills[ARRIVAL].evaluation.instant, scheduled + 100)
        self.assertEqual(fills[CALENDAR_ONLY].evaluation.instant, scheduled + 100)
        self.assertEqual(fills[GUARDED].evaluation.instant, OPEN + DAY + 900)
        self.assertEqual(fills[GUARDED].wait_reasons, (("MULTIPLIER", 1),))

    def test_sizes_are_independent(self):
        def premium(t):
            return 50 if t >= OPEN + 2 * HOUR else 150

        r = replay(premium_at=premium)
        self.assertEqual(r.replay(payment(OPEN + HOUR), 1000)[0][GUARDED].evaluation.instant, OPEN + 2 * HOUR)

    def test_a_policy_that_never_fills_is_unresolved(self):
        with self.assertRaises(Unresolved):
            replay(premium_at=lambda t: 500).replay(payment(OPEN + HOUR), 100)


if __name__ == "__main__":
    unittest.main()
