import random
import unittest
from bisect import bisect_right

from hp2.blocks import BlockIndex, NonMonotonic
from hp2.tests.helpers import FakeChainEndpoint, random_chain, steady_chain, temp_cache


def brute(stamps: list[int], instant: int) -> int:
    return bisect_right(stamps, instant) - 1


class BlockIndexTest(unittest.TestCase):
    def test_exact_against_brute_force_on_random_chains(self):
        for seed in range(6):
            stamps = random_chain(60_000, seed)
            endpoint = FakeChainEndpoint(stamps)
            index = BlockIndex(endpoint)
            index.build_coarse(0, len(stamps) - 1, 5_000)
            rng = random.Random(100 + seed)
            for _ in range(300):
                instant = rng.randint(stamps[0], stamps[-2])
                if brute(stamps, instant) + 1 >= len(stamps):
                    continue
                with self.subTest(seed=seed, instant=instant):
                    block = index.at_or_before(instant)
                    self.assertEqual(block, brute(stamps, instant))
                    b, ts_b, ts_next = index.proof(instant)
                    self.assertTrue(ts_b <= instant < ts_next)

    def test_shared_second_gives_last_block_of_that_second(self):
        stamps = [10, 10, 11, 11, 11, 11, 12, 20, 20, 21] + [30 + i for i in range(100)]
        endpoint = FakeChainEndpoint(stamps)
        index = BlockIndex(endpoint, batch=3, final_batch=2)
        index.timestamps([0, len(stamps) - 1])
        self.assertEqual(index.at_or_before(11), 5)
        self.assertEqual(index.at_or_before(10), 1)
        self.assertEqual(index.at_or_before(19), 6)
        self.assertEqual(index.at_or_before(20), 8)

    def _cost(self, stamps, lookups=200):
        endpoint = FakeChainEndpoint(stamps)
        index = BlockIndex(endpoint)
        index.build_coarse(0, len(stamps) - 1, 5_000)
        before_requests, before_headers = endpoint.requests, endpoint.headers_served
        rng = random.Random(8)
        instants = [
            t
            for t in sorted(rng.randint(stamps[0], stamps[-2]) for _ in range(lookups))
            if brute(stamps, t) + 1 < len(stamps)
        ]
        for instant in instants:
            self.assertEqual(index.at_or_before(instant), brute(stamps, instant))
        n = len(instants)
        return (endpoint.requests - before_requests) / n, (endpoint.headers_served - before_headers) / n

    def test_lookups_on_a_steady_chain_take_two_requests(self):
        requests, headers = self._cost(steady_chain(400_000, 7))
        self.assertLessEqual(requests, 2.1)
        self.assertLess(headers, 20)

    def test_lookups_on_a_bursty_chain_stay_bounded(self):
        requests, _ = self._cost(random_chain(200_000, 7))
        self.assertLess(requests, 5)

    def test_cache_makes_rerun_free(self):
        stamps = random_chain(30_000, 3)
        cache = temp_cache()
        first = FakeChainEndpoint(stamps, cache)
        index = BlockIndex(first)
        index.build_coarse(0, len(stamps) - 1, 5_000)
        answers = [index.at_or_before(t) for t in range(stamps[0], stamps[0] + 2_000, 37)]
        second = FakeChainEndpoint(stamps, cache)
        again = BlockIndex(second)
        self.assertEqual([again.at_or_before(t) for t in range(stamps[0], stamps[0] + 2_000, 37)], answers)
        self.assertEqual(second.requests, 0)

    def test_decreasing_timestamps_are_refused(self):
        stamps = [5, 6, 7, 3, 9, 10]
        index = BlockIndex(FakeChainEndpoint(stamps))
        with self.assertRaises(NonMonotonic):
            index.timestamps(range(len(stamps)))
            index.bracket(6)

    def test_instant_outside_known_headers_is_an_error(self):
        stamps = random_chain(1_000, 1)
        index = BlockIndex(FakeChainEndpoint(stamps))
        index.timestamps([100, 900])
        with self.assertRaises(ValueError):
            index.at_or_before(stamps[0] - 1)
        with self.assertRaises(ValueError):
            index.at_or_before(stamps[-1] + 1)


if __name__ == "__main__":
    unittest.main()
