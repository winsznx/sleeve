import tempfile
import unittest
from pathlib import Path

from hp2.cache import ResponseCache, request_key
from hp2.tests.helpers import temp_cache


class CacheTest(unittest.TestCase):
    def test_hex_case_does_not_split_keys(self):
        cache = temp_cache()
        cache.put("archive", "eth_call", [{"to": "0xAbC", "data": "0x01"}, "0x10"], result="0x2a")
        self.assertEqual(cache.get("archive", "eth_call", [{"data": "0x01", "to": "0xabc"}, "0x10"]).result, "0x2a")
        self.assertIsNone(cache.get("archive", "eth_call", [{"data": "0x01", "to": "0xabc"}, "0x11"]))

    def test_errors_are_kept(self):
        cache = temp_cache()
        error = {"code": 3, "message": "execution reverted", "data": "0x08c379a0"}
        cache.put("archive", "eth_call", ["x"], error=error)
        entry = cache.get("archive", "eth_call", ["x"])
        self.assertIsNone(entry.result)
        self.assertEqual(entry.error, error)

    def test_compact_round_trip_is_deterministic_and_prunes_headers(self):
        cache = temp_cache()
        cache.set_meta("latest_pin:0xfeed", 123)
        cache.put("public", "eth_getBlockByNumber", ["0x1", False], result={"number": "0x1", "timestamp": "0x10"})
        cache.put("public", "eth_getBlockByNumber", ["0x2", False], result={"number": "0x2", "timestamp": "0x11"})
        cache.put("archive", "eth_call", [{"to": "0x1"}, "0x1"], result="0xff")
        out = Path(tempfile.mkdtemp())
        first, second = out / "a.jsonl.gz", out / "b.jsonl.gz"
        self.assertEqual(cache.export_compact(first, keep_headers={2}), 2)
        cache.export_compact(second, keep_headers={2})
        self.assertEqual(first.read_bytes(), second.read_bytes())
        rebuilt = ResponseCache(out / "rebuilt.sqlite")
        self.assertEqual(rebuilt.import_compact(first), 2)
        self.assertEqual(rebuilt.meta("latest_pin:0xfeed"), 123)
        self.assertIsNone(rebuilt.get("public", "eth_getBlockByNumber", ["0x1", False]))
        self.assertEqual(rebuilt.get("public", "eth_getBlockByNumber", ["0x2", False]).result["timestamp"], "0x11")
        self.assertEqual(rebuilt.get("archive", "eth_call", [{"to": "0x1"}, "0x1"]).result, "0xff")

    def test_key_covers_endpoint_method_and_params(self):
        self.assertNotEqual(request_key("a", "eth_call", [1]), request_key("a", "eth_getLogs", [1]))
        self.assertNotEqual(request_key("a", "eth_call", [1]), request_key("a", "eth_call", [2]))
        self.assertNotEqual(request_key("a", "eth_call", [1]), request_key("b", "eth_call", [1]))

    def test_same_request_to_two_endpoints_is_two_entries(self):
        cache = temp_cache()
        cache.put("archive", "eth_chainId", [], result="0x1237")
        self.assertIsNone(cache.get("public", "eth_chainId", []))


if __name__ == "__main__":
    unittest.main()
