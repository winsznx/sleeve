import unittest

from hp2.engine.market import (
    MAX_SQRT_RATIO,
    MIN_SQRT_RATIO,
    Feed,
    FlagHistory,
    Round,
    TokenState,
    UnusableQuote,
    best_quote,
    pool_outcomes,
)
from hp2.tests.engine_fixtures import (
    DAY,
    OPEN,
    POOL_A,
    POOL_B,
    feed,
    flag_event,
    multiplier_event,
    quote,
)


class FeedTest(unittest.TestCase):
    def setUp(self):
        self.feed = feed([OPEN - DAY, OPEN + 40, OPEN + 600])

    def test_round_in_force_includes_a_round_updated_that_second(self):
        self.assertIsNone(self.feed.in_force(OPEN - DAY - 1))
        self.assertEqual(self.feed.in_force(OPEN + 39).updated_at, OPEN - DAY)
        self.assertEqual(self.feed.in_force(OPEN + 40).updated_at, OPEN + 40)
        self.assertEqual(self.feed.in_force(OPEN + 10 * DAY).updated_at, OPEN + 600)

    def test_first_round_at_or_after(self):
        self.assertEqual(self.feed.first_at_or_after(OPEN).updated_at, OPEN + 40)
        self.assertEqual(self.feed.first_at_or_after(OPEN + 40).updated_at, OPEN + 40)
        self.assertIsNone(self.feed.first_at_or_after(OPEN + 601))

    def test_round_in_force_by_block_follows_transmit_blocks(self):
        self.assertEqual(self.feed.in_force_at_block(10 * (OPEN + 40)).updated_at, OPEN + 40)
        self.assertEqual(self.feed.in_force_at_block(10 * (OPEN + 40) - 1).updated_at, OPEN - DAY)

    def test_dropped_rounds_are_left_out(self):
        doc = {
            "rounds": [
                {"round_id": "1", "aggregator_round": 1, "answer": "7", "updated_at": 5, "block": 1, "dropped": True},
                {"round_id": "2", "aggregator_round": 2, "answer": "8", "updated_at": 9, "block": 2, "dropped": False},
            ]
        }
        kept = Feed.from_document("X", doc)
        self.assertEqual(kept.rounds, [Round(2, 2, 8, 9, 2)])
        self.assertIsNone(kept.in_force(8))

    def test_rounds_out_of_order_are_refused(self):
        with self.assertRaises(ValueError):
            feed([OPEN + 40, OPEN])


class FlagHistoryTest(unittest.TestCase):
    def test_no_events_means_never_set(self):
        self.assertFalse(FlagHistory([]).at(OPEN))

    def test_a_first_unpause_means_it_was_paused_before(self):
        flags = FlagHistory([(100, False), (200, True), (300, False)])
        self.assertTrue(flags.at(99))
        self.assertFalse(flags.at(100))
        self.assertTrue(flags.at(200))
        self.assertTrue(flags.at(299))
        self.assertFalse(flags.at(300))

    def test_events_that_do_not_alternate_are_refused(self):
        with self.assertRaises(ValueError):
            FlagHistory([(100, True), (200, True)])


class TokenStateTest(unittest.TestCase):
    def test_pause_is_the_token_flag_or_the_registry_pause(self):
        events = [
            flag_event(OPEN + 10, "Paused", "registry"),
            flag_event(OPEN + 20, "Unpaused", "registry"),
            flag_event(OPEN + 30, "Paused"),
            flag_event(OPEN + 40, "OraclePaused"),
            flag_event(OPEN + 15, "Paused", "QQQ"),
        ]
        state = TokenState("AAPL", events)
        paused = [state.paused(OPEN + s) for s in (9, 10, 19, 20, 29, 30)]
        self.assertEqual(paused, [False, True, True, False, False, True])
        self.assertFalse(state.oracle_paused(OPEN + 39))
        self.assertTrue(state.oracle_paused(OPEN + 40))
        self.assertEqual(state.last_flag_event(), OPEN + 40)

    def test_multiplier_pending_from_schedule_to_effective_time(self):
        scheduled, effective = OPEN + DAY, OPEN + DAY + 600
        state = TokenState("AAPL", [multiplier_event(scheduled, effective)])
        self.assertFalse(state.multiplier_pending(scheduled - 1, DAY))
        self.assertTrue(state.multiplier_pending(scheduled, DAY))
        self.assertTrue(state.multiplier_pending(effective - 1, DAY))
        self.assertFalse(state.multiplier_pending(effective, DAY))

    def test_multiplier_window_edge(self):
        scheduled, effective = OPEN, OPEN + 2 * DAY
        state = TokenState("AAPL", [multiplier_event(scheduled, effective)])
        self.assertFalse(state.multiplier_pending(effective - DAY - 1, DAY))
        self.assertTrue(state.multiplier_pending(effective - DAY, DAY))

    def test_a_schedule_to_the_same_multiplier_is_not_pending(self):
        state = TokenState("AAPL", [multiplier_event(OPEN, OPEN + 600, old=10**18, new=10**18)])
        self.assertFalse(state.multiplier_pending(OPEN + 1, DAY))

    def test_a_reschedule_replaces_the_pending_change(self):
        events = [multiplier_event(OPEN, OPEN + 600), multiplier_event(OPEN + 300, OPEN + 3 * DAY)]
        state = TokenState("AAPL", events)
        self.assertTrue(state.multiplier_pending(OPEN + 299, DAY))
        self.assertFalse(state.multiplier_pending(OPEN + 300, DAY))
        self.assertTrue(state.multiplier_pending(OPEN + 2 * DAY, DAY))

    def test_other_tokens_events_are_ignored(self):
        state = TokenState("AAPL", [multiplier_event(OPEN, OPEN + 600, contract="SPY")])
        self.assertFalse(state.multiplier_pending(OPEN + 1, DAY))


class BestQuoteTest(unittest.TestCase):
    def row(self, *quotes):
        return {"block": 7, "block_ts": OPEN, "instants": [OPEN], "quotes": list(quotes)}

    def test_largest_output_wins_and_ties_go_to_the_first_pool(self):
        row = self.row(quote(POOL_A, 500, 100, 5), quote(POOL_B, 3000, 100, 9), quote(POOL_A, 500, 1000, 50))
        self.assertEqual(best_quote(row, 100, 6).pool, POOL_B)
        self.assertEqual(best_quote(row, 100, 6).usdg_in, 100_000_000)
        tie = self.row(quote(POOL_A, 500, 100, 9), quote(POOL_B, 3000, 100, 9))
        self.assertEqual(best_quote(tie, 100, 6).pool, POOL_A)

    def test_a_revert_at_one_pool_leaves_the_other(self):
        row = self.row(quote(POOL_A, 500, 100, None), quote(POOL_B, 3000, 100, 9))
        self.assertEqual(best_quote(row, 100, 6).pool, POOL_B)
        self.assertEqual(pool_outcomes(row, 100), [(POOL_A, 500, None), (POOL_B, 3000, 9)])

    def test_every_pool_reverting_gives_no_quote(self):
        self.assertIsNone(best_quote(self.row(quote(POOL_A, 500, 100, None)), 100, 6))

    def test_a_partial_quote_that_loses_is_harmless(self):
        row = self.row(quote(POOL_A, 500, 100, 5, sqrt_after=MIN_SQRT_RATIO + 1), quote(POOL_B, 3000, 100, 9))
        self.assertEqual(best_quote(row, 100, 6).pool, POOL_B)

    def test_a_best_quote_at_the_price_limit_stops_the_run(self):
        for limit in (MIN_SQRT_RATIO + 1, MAX_SQRT_RATIO - 1):
            row = self.row(quote(POOL_A, 500, 100, 9, sqrt_after=limit), quote(POOL_B, 3000, 100, 5))
            with self.assertRaises(UnusableQuote):
                best_quote(row, 100, 6)

    def test_a_best_quote_of_zero_stops_the_run(self):
        with self.assertRaises(UnusableQuote):
            best_quote(self.row(quote(POOL_A, 500, 100, 0)), 100, 6)


if __name__ == "__main__":
    unittest.main()
