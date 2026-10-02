import unittest

from hp2.constants import GRID_SECONDS, SIZES_USDG
from hp2.planner import PREMIUM_SCALE, Planner, Rounds, TokenEvents
from hp2.quotes import AMOUNT_IN
from hp2.session import SessionState

HOUR = 3600
DAY = 86400
# Sunday 2026-08-16 20:00 EDT is 1786924800; the session runs to Friday 2026-08-21 20:00 EDT, 1787356800.
OPEN, CLOSE = 1_786_924_800, 1_787_356_800
NEXT_OPEN = OPEN + 7 * DAY
ANSWER = 30_000_000_000  # 300 USD with 8 decimals


class FakeSession:
    def __init__(self, intervals):
        self.intervals = intervals

    def states(self, timestamps):
        out = {}
        for ts in timestamps:
            ts = int(ts)
            hit = next(((o, c) for o, c in self.intervals if o <= ts < c), None)
            out[ts] = SessionState(hit is not None, hit[0] if hit else 0, 1 if hit else 2)
        return out


class IdentityIndex:
    def at_or_before(self, instant):
        return int(instant)


class FakeBook:
    """Quotes priced at a premium chosen per instant; None means every pool reverts."""

    def __init__(self, premium_at):
        self.premium_at = premium_at

    def best_out(self, symbol, block, size):
        premium = self.premium_at(block)
        if premium is None:
            return None
        return AMOUNT_IN[size] * PREMIUM_SCALE * 10_000 // (ANSWER * (10_000 + premium))


class FakeFetcher:
    def __init__(self):
        self.index = IdentityIndex()
        self.requested = []

    def ensure(self, need):
        self.requested.append(sorted(need))


def rounds(instants, answer=ANSWER):
    return Rounds([{"updated_at": t, "answer": str(answer), "dropped": False} for t in instants])


def planner(
    premium_at=lambda t: 10,
    stock=None,
    usdg=None,
    events=(),
    intervals=((OPEN, CLOSE), (NEXT_OPEN, NEXT_OPEN + 5 * DAY)),
):
    grid = {g: any(o <= g < c for o, c in intervals) for g in range(OPEN - 3 * DAY, NEXT_OPEN + 5 * DAY, GRID_SECONDS)}
    fetcher = FakeFetcher()
    p = Planner(
        session=FakeSession(intervals),
        book=FakeBook(premium_at),
        fetcher=fetcher,
        stock={"AAPL": stock or rounds([OPEN - 2 * DAY, OPEN + 40, OPEN + 5 * HOUR, OPEN + 2 * DAY, NEXT_OPEN + 30])},
        usdg=usdg or rounds([OPEN - 3 * DAY + d * DAY for d in range(14)], answer=100_000_000),
        events={"AAPL": TokenEvents(list(events), "AAPL")},
        open_intervals=list(intervals),
        grid_open=grid,
        end_ts=NEXT_OPEN + 4 * DAY,
    )
    return p, fetcher


def run(p, arrivals):
    payments = p.payments("AAPL", [{"i": i, "t": float(t), "unix": t} for i, t in enumerate(arrivals)], OPEN - 3 * DAY)
    p.walk(payments)
    p.add_margins(payments)
    return payments


class PlannerTest(unittest.TestCase):
    def test_in_session_arrival_settles_at_once(self):
        p, _ = planner()
        (pay,) = run(p, [OPEN + DAY])
        self.assertEqual(pay.walked, [OPEN + DAY])
        self.assertEqual(pay.margin, set())
        self.assertIsNone(pay.unresolved)

    def test_weekend_arrival_walks_to_the_first_fresh_round(self):
        p, _ = planner()
        start = OPEN - DAY
        (pay,) = run(p, [start])
        self.assertEqual(pay.walked, [start, OPEN, OPEN + 40])
        grid = {g for g in range(OPEN - HOUR, OPEN + HOUR + 1, GRID_SECONDS)}
        self.assertTrue(grid - set(pay.walked) <= pay.margin)
        self.assertIn(OPEN - HOUR, pay.margin)

    def test_high_premium_keeps_walking(self):
        p, _ = planner(premium_at=lambda t: 120 if t < OPEN + 2 * HOUR else 10)
        (pay,) = run(p, [OPEN + HOUR + 1])
        self.assertEqual(
            pay.walked, [OPEN + HOUR + 1, OPEN + HOUR + 900, OPEN + HOUR + 1800, OPEN + HOUR + 2700, OPEN + 2 * HOUR]
        )

    def test_premium_just_under_the_cap_is_not_enough_to_stop(self):
        p, _ = planner(premium_at=lambda t: 97 if t < OPEN + 6 * HOUR else 50)
        (pay,) = run(p, [OPEN + 4 * HOUR])
        self.assertEqual(max(pay.walked), OPEN + 6 * HOUR)

    def test_pending_multiplier_waits_past_the_effective_time(self):
        scheduled, effective = OPEN + DAY, OPEN + DAY + 600
        event = {
            "contract": "AAPL",
            "event": "UIMultiplierUpdated",
            "block_ts": scheduled,
            "args": {"old_multiplier": str(10**18), "new_multiplier": str(10**18 + 5), "effective_at": effective},
        }
        p, _ = planner(events=[event])
        (pay,) = run(p, [scheduled + 100])
        self.assertGreater(max(pay.walked), effective + 900)

    def test_stale_usdg_waits_for_the_next_usdg_round(self):
        usdg = rounds([OPEN - 3 * DAY, OPEN + DAY + 7 * HOUR], answer=100_000_000)
        stock = rounds([OPEN + 40, OPEN + 5 * HOUR, OPEN + DAY + 6 * HOUR, OPEN + 2 * DAY])
        p, _ = planner(usdg=usdg, stock=stock)
        (pay,) = run(p, [OPEN + 10 * HOUR])
        self.assertEqual(max(pay.walked), OPEN + DAY + 7 * HOUR)

    def test_depegged_usdg_keeps_walking(self):
        usdg = rounds([OPEN - DAY, OPEN + 5 * HOUR], answer=99_400_000)
        usdg.answer[-1] = 100_000_000
        p, _ = planner(usdg=usdg)
        (pay,) = run(p, [OPEN + HOUR])
        self.assertEqual(max(pay.walked), OPEN + 5 * HOUR)

    def test_reverting_quotes_delay_buy_at_arrival(self):
        p, _ = planner(premium_at=lambda t: None if t < OPEN + DAY + HOUR else 10)
        (pay,) = run(p, [OPEN + DAY])
        self.assertEqual(max(pay.walked), OPEN + DAY + HOUR)
        self.assertEqual(pay.arrival_done, set(SIZES_USDG))

    def test_never_passing_payment_is_marked_unresolved(self):
        p, _ = planner(premium_at=lambda t: 500)
        (pay,) = run(p, [NEXT_OPEN + 3 * DAY])
        self.assertIsNotNone(pay.unresolved)

    def test_lookahead_saves_rounds_without_changing_the_walk(self):
        def premium(t):
            return None if t < OPEN + 2 * DAY else 10

        arrivals = [OPEN + HOUR + 7, OPEN + 5 * HOUR, OPEN - DAY]
        p_fast, fetcher_fast = planner(premium_at=premium)
        fast = run(p_fast, arrivals)
        p_slow, fetcher_slow = planner(premium_at=premium)
        p_slow.lookahead = lambda steps: 1
        slow = run(p_slow, arrivals)
        self.assertEqual([p.walked for p in fast], [p.walked for p in slow])
        self.assertEqual([p.margin for p in fast], [p.margin for p in slow])
        self.assertLess(len(fetcher_fast.requested), len(fetcher_slow.requested) / 4)

    def test_walk_fetches_before_it_evaluates(self):
        p, fetcher = planner()
        run(p, [OPEN - DAY, OPEN + DAY])
        self.assertEqual(fetcher.requested[0], [OPEN - DAY, OPEN + DAY])


if __name__ == "__main__":
    unittest.main()
