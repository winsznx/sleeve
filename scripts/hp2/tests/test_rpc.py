import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from hp2 import rpc
from hp2.rpc import CacheMiss, Endpoint, Revert, StateUnavailable
from hp2.tests.helpers import temp_cache


class Server:
    """A local JSON-RPC server that plays a script of answers and records concurrency."""

    def __init__(self):
        self.script = []
        self.requests = []
        self.in_flight = 0
        self.max_in_flight = 0
        self.lock = threading.Lock()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                with outer.lock:
                    outer.requests.append(body)
                    outer.in_flight += 1
                    outer.max_in_flight = max(outer.max_in_flight, outer.in_flight)
                    action = outer.script.pop(0) if outer.script else "echo"
                time.sleep(0.02)
                status, payload, headers = outer.answer(action, body)
                with outer.lock:
                    outer.in_flight -= 1
                data = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
                self.send_response(status)
                for k, v in headers.items():
                    self.send_header(k, v)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def answer(self, action, body):
        def result(item):
            return {"jsonrpc": "2.0", "id": item["id"], "result": "0x" + item["method"].encode().hex()}

        if action == "429":
            return 429, "slow down", {}
        if action == "cloudflare":
            return 403, "<title>Just a moment...</title>", {}
        if action == "revert":
            return (
                200,
                {
                    "jsonrpc": "2.0",
                    "id": body["id"],
                    "error": {"code": 3, "message": "execution reverted", "data": "0xdead"},
                },
                {},
            )
        if action == "pruned":
            return (
                200,
                {
                    "jsonrpc": "2.0",
                    "id": body["id"],
                    "error": {"code": -32000, "message": "historical state abc is not available"},
                },
                {},
            )
        if action == "half_batch":
            items = [result(body[0])] + [
                {"jsonrpc": "2.0", "id": i["id"], "error": {"code": -32000, "message": "busy"}} for i in body[1:]
            ]
            return 200, items, {}
        if isinstance(body, list):
            return 200, [result(i) for i in body], {}
        return 200, result(body), {}

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


class EndpointTest(unittest.TestCase):
    def setUp(self):
        self.sleeps = []
        self.clock = 1_000.0
        self._real = (rpc._sleep, rpc._now)

        def fake_sleep(seconds):
            self.sleeps.append(seconds)
            self.clock += seconds

        rpc._sleep = fake_sleep
        rpc._now = lambda: self.clock
        self.server = Server()
        self.endpoints = []

    def tearDown(self):
        rpc._sleep, rpc._now = self._real
        for ep in self.endpoints:
            ep.close()
        self.server.close()

    def endpoint(self, slots=1, offline=False, cache=None):
        ep = Endpoint("archive", self.server.url, cache or temp_cache(), slots=slots, pause=(0.2, 0.5), offline=offline)
        self.endpoints.append(ep)
        return ep

    def test_429_backs_off_then_caches(self):
        ep = self.endpoint()
        self.server.script = ["429", "429"]
        self.assertEqual(ep.call("eth_chainId", []), "0x" + b"eth_chainId".hex())
        self.assertEqual(ep.stats.http_429, 2)
        self.assertEqual(ep.stats.retries, 2)
        self.assertTrue(any(s >= 12 for s in self.sleeps))
        sent = len(self.server.requests)
        ep.call("eth_chainId", [])
        self.assertEqual(len(self.server.requests), sent)
        self.assertEqual(ep.stats.cache_hits, 1)

    def test_every_request_is_followed_by_a_pause(self):
        ep = self.endpoint()
        ep.call("a", [])
        ep.call("b", [])
        pauses = [s for s in self.sleeps if 0.2 <= s <= 0.5]
        self.assertEqual(len(pauses), 2)

    def test_revert_is_a_cached_result(self):
        ep = self.endpoint()
        self.server.script = ["revert"]
        outcome = ep.call_revertible("eth_call", [{"to": "0x1"}, "0x5"])
        self.assertIsInstance(outcome, Revert)
        self.assertEqual(outcome.data, "0xdead")
        again = ep.call_revertible("eth_call", [{"to": "0x1"}, "0x5"])
        self.assertEqual(again, outcome)
        self.assertEqual(len(self.server.requests), 1)

    def test_cloudflare_challenge_waits(self):
        ep = self.endpoint()
        self.server.script = ["cloudflare"]
        ep.call("eth_blockNumber", [])
        self.assertEqual(ep.stats.cloudflare_challenges, 1)
        self.assertTrue(any(s >= 90 for s in self.sleeps))

    def test_pruned_state_fails_fast(self):
        ep = self.endpoint()
        self.server.script = ["pruned"]
        with self.assertRaises(StateUnavailable):
            ep.call("eth_call", [{"to": "0x1"}, "0x5"])
        self.assertEqual(len(self.server.requests), 1)

    def test_batch_retries_only_failed_items(self):
        ep = self.endpoint()
        self.server.script = ["half_batch"]
        out = ep.batch([("m0", [0]), ("m1", [1]), ("m2", [2])])
        self.assertEqual(out, ["0x" + f"m{i}".encode().hex() for i in range(3)])
        self.assertEqual(len(self.server.requests[0]), 3)
        self.assertEqual(len(self.server.requests[1]), 2)

    def test_offline_never_sends(self):
        cache = temp_cache()
        online = self.endpoint(cache=cache)
        online.call("x", [1])
        offline = self.endpoint(cache=cache, offline=True)
        self.assertEqual(offline.call("x", [1]), "0x" + b"x".hex())
        with self.assertRaises(CacheMiss):
            offline.call("x", [2])

    def test_token_bucket_paces_batched_calls(self):
        ep = Endpoint(
            "public", self.server.url, temp_cache(), slots=1, pause=(0.0, 0.0), calls_per_second=5.0, burst=10
        )
        self.endpoints.append(ep)
        start = self.clock
        for i in range(6):
            ep.batch([("m", [i, j]) for j in range(10)])
        self.assertGreaterEqual(self.clock - start, (60 - 10) / 5.0 - 1e-9)

    def test_slots_bound_concurrency(self):
        for slots in (1, 2):
            self.server.max_in_flight = 0
            ep = self.endpoint(slots=slots)
            rpc._sleep, rpc._now = (lambda seconds: time.sleep(0.001)), time.monotonic
            threads = [threading.Thread(target=ep.call, args=("m", [i])) for i in range(12)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            self.assertEqual(self.server.max_in_flight, slots)


if __name__ == "__main__":
    unittest.main()
