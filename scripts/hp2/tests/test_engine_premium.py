import json
import unittest
from fractions import Fraction

from hp2.constants import CONTRACTS
from hp2.engine.premium import exceeds_premium, exec_price_buy, premium_bps, premium_exact

FIXTURE = CONTRACTS / "test" / "fixtures" / "premium_vectors.json"
ONE_TOKEN = 10**18
HUNDRED_USD = 100 * 10**8


class HandComputedTest(unittest.TestCase):
    """One token at 100 USD: the premium in bps is (usdg base units - 1e8) / 1e4."""

    def test_exact_cap_equality_passes_and_one_unit_more_fails(self):
        self.assertFalse(exceeds_premium(101_000_000, ONE_TOKEN, HUNDRED_USD, 100))
        self.assertTrue(exceeds_premium(101_000_001, ONE_TOKEN, HUNDRED_USD, 100))

    def test_cap_equality_with_more_tokens_or_a_higher_answer_passes(self):
        self.assertFalse(exceeds_premium(101_000_000, ONE_TOKEN + 1, HUNDRED_USD, 100))
        self.assertFalse(exceeds_premium(101_000_000, ONE_TOKEN, HUNDRED_USD + 1, 100))
        self.assertTrue(exceeds_premium(101_000_000, ONE_TOKEN - 1, HUNDRED_USD, 100))
        self.assertTrue(exceeds_premium(101_000_000, ONE_TOKEN, HUNDRED_USD - 1, 100))

    def test_zero_cap(self):
        self.assertFalse(exceeds_premium(100_000_000, ONE_TOKEN, HUNDRED_USD, 0))
        self.assertTrue(exceeds_premium(100_000_001, ONE_TOKEN, HUNDRED_USD, 0))

    def test_exact_premium_is_signed_and_unrounded(self):
        self.assertEqual(premium_exact(101_000_000, ONE_TOKEN, HUNDRED_USD), 100)
        self.assertEqual(premium_exact(98_296_000, ONE_TOKEN, HUNDRED_USD), Fraction(-1704, 10))
        self.assertEqual(premium_exact(100_000_001, ONE_TOKEN, HUNDRED_USD), Fraction(1, 10_000))

    def test_receipt_premium_rounds_up_against_the_owner(self):
        self.assertEqual(premium_bps(101_000_000, ONE_TOKEN, HUNDRED_USD), 100)
        self.assertEqual(premium_bps(98_296_000, ONE_TOKEN, HUNDRED_USD), -170)
        self.assertEqual(premium_bps(100_000_001, ONE_TOKEN, HUNDRED_USD), 1)
        self.assertEqual(premium_bps(99_999_999, ONE_TOKEN, HUNDRED_USD), 0)

    def test_execution_price_rounds_up(self):
        self.assertEqual(exec_price_buy(100_000_000, 3 * 10**17), 333_333_334)
        self.assertEqual(exec_price_buy(100_000_000, ONE_TOKEN), 100_000_000)

    def test_real_quote_from_the_research_note(self):
        # docs/research/pools.md: SPY fee 500, 100 USDG bought 0.129483823700188790 SPY at answer 770.71210575.
        exact = premium_exact(100_000_000, 129_483_823_700_188_790, 77_071_210_575)
        self.assertEqual(round(float(exact), 2), 20.57)
        self.assertFalse(exceeds_premium(100_000_000, 129_483_823_700_188_790, 77_071_210_575, 100))
        self.assertTrue(exceeds_premium(100_000_000, 129_483_823_700_188_790, 77_071_210_575, 20))

    def test_bad_inputs_raise(self):
        with self.assertRaises(ValueError):
            exceeds_premium(1, 1, 0, 100)
        with self.assertRaises(ValueError):
            premium_exact(1, 0, HUNDRED_USD)
        with self.assertRaises(ValueError):
            exec_price_buy(1, 0)


class SharedVectorTest(unittest.TestCase):
    """contracts/test/fixtures/premium_vectors.json, the file the module tests and the verifier replay (D-009 Q11)."""

    @classmethod
    def setUpClass(cls):
        cls.doc = json.loads(FIXTURE.read_text())

    def test_every_decision_vector(self):
        d = self.doc["decisions"]
        for n, label in enumerate(d["label"]):
            decimals = (d["usdgDecimals"][n], d["tokenDecimals"][n], d["feedDecimals"][n])
            got = exceeds_premium(int(d["usdg"][n]), int(d["tokens"][n]), int(d["answer"][n]), d["capBps"][n], decimals)
            self.assertEqual(got, d["exceedsPremium"][n], label)
        self.assertEqual(len(d["label"]), self.doc["counts"]["decisions"])

    def test_every_receipt_vector(self):
        r = self.doc["receipts"]
        for n, label in enumerate(r["label"]):
            usdg, tokens, answer = int(r["usdg"][n]), int(r["tokens"][n]), int(r["answer"][n])
            decimals = (r["usdgDecimals"][n], r["tokenDecimals"][n], r["feedDecimals"][n])
            self.assertEqual(exec_price_buy(usdg, tokens), int(r["execPriceBuy"][n]), label)
            self.assertEqual(premium_bps(usdg, tokens, answer, decimals), int(r["premiumBps"][n]), label)
        self.assertEqual(len(r["label"]), self.doc["counts"]["receipts"])


if __name__ == "__main__":
    unittest.main()
