import random
import unittest

from hp2 import abi
from hp2.constants import EVENT_SIGNATURE, SELECTOR, SIGNATURE, TOPIC
from hp2.tests.helpers import CAST, cast


@unittest.skipUnless(CAST, "cast not installed")
class AgainstCast(unittest.TestCase):
    def test_selectors_and_topics(self):
        for name, signature in SIGNATURE.items():
            with self.subTest(name=name):
                self.assertEqual(cast("sig", signature), SELECTOR[name])
        for name, signature in EVENT_SIGNATURE.items():
            with self.subTest(name=name):
                self.assertEqual(cast("sig-event", signature), TOPIC[name])

    def test_aggregate3_encoding(self):
        rng = random.Random(4663)
        for _ in range(5):
            calls = []
            for _ in range(rng.randint(1, 4)):
                target = "0x" + "".join(rng.choice("0123456789abcdef") for _ in range(40))
                data = bytes(rng.randint(0, 255) for _ in range(rng.choice([0, 4, 36, 70])))
                calls.append((target, rng.random() < 0.5, data))
            arg = "[" + ",".join(f"({t},{str(f).lower()},0x{d.hex()})" for t, f, d in calls) + "]"
            self.assertEqual(
                abi.encode_aggregate3(SELECTOR["aggregate3"], calls), cast("calldata", SIGNATURE["aggregate3"], arg)
            )

    def test_aggregate3_decoding(self):
        rng = random.Random(7)
        for _ in range(5):
            results = [
                (rng.random() < 0.5, bytes(rng.randint(0, 255) for _ in range(rng.choice([0, 2, 32, 33, 160]))))
                for _ in range(rng.randint(1, 5))
            ]
            arg = "[" + ",".join(f"({str(ok).lower()},0x{data.hex()})" for ok, data in results) + "]"
            encoded = abi.strip(cast("abi-encode", "f((bool,bytes)[])", arg))
            self.assertEqual(abi.decode_aggregate3(encoded), results)

    def test_quote_call_data(self):
        from hp2.quotes import quote_call_data

        token, amount, fee = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", 100_000_000, 500
        expected = cast(
            "calldata",
            SIGNATURE["quoteExactInputSingle"],
            f"(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,{token},{amount},{fee},0)",
        )
        self.assertEqual(quote_call_data(token, amount, fee), expected)

    def test_string(self):
        self.assertEqual(abi.decode_string(abi.strip(cast("abi-encode", "f(string)", "RHSPY / USD"))), "RHSPY / USD")


class Words(unittest.TestCase):
    def test_signed_and_words(self):
        self.assertEqual(abi.signed((1 << 256) - 1), -1)
        self.assertEqual(abi.signed(5), 5)
        self.assertEqual(abi.words(bytes(31) + b"\x07" + bytes(32)), [7, 0])
        with self.assertRaises(ValueError):
            abi.words(b"\x00" * 33)
        with self.assertRaises(ValueError):
            abi.word(-1)
        with self.assertRaises(ValueError):
            abi.to_address(1 << 160)


if __name__ == "__main__":
    unittest.main()
