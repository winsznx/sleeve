"""Shared test helpers: a temporary cache and an in-memory chain that answers header requests like the public RPC."""

import random
import shutil
import subprocess
import tempfile
from pathlib import Path

from hp2.cache import ResponseCache, normalize

CAST = shutil.which("cast")
FORGE = shutil.which("forge")


def cast(*args: str) -> str:
    return subprocess.run([CAST, *args], capture_output=True, text=True, check=True).stdout.strip()


def temp_cache() -> ResponseCache:
    return ResponseCache(Path(tempfile.mkdtemp()) / "responses.sqlite")


def random_chain(blocks: int, seed: int, start_ts: int = 1_785_000_000) -> list[int]:
    """Nondecreasing timestamps with the shapes the real chain has: bursts of blocks in one second, quiet seconds and
    the occasional long gap."""
    rng = random.Random(seed)
    stamps, ts = [], start_ts
    for _ in range(blocks):
        r = rng.random()
        if r < 0.85:
            pass
        elif r < 0.995:
            ts += rng.randint(1, 3)
        else:
            ts += rng.randint(30, 4000)
        stamps.append(ts)
    return stamps


def steady_chain(blocks: int, seed: int, start_ts: int = 1_785_000_000, rate: float = 9.96) -> list[int]:
    """About ten blocks a second with a little jitter, which is what Robinhood Chain shows between July and October
    2026 (every 5,000-block span ran at 9.58 to 10.22 blocks a second)."""
    rng = random.Random(seed)
    stamps, clock = [], float(start_ts)
    for _ in range(blocks):
        clock += rng.uniform(0.6, 1.4) / rate
        stamps.append(int(clock))
    return stamps


class FakeChainEndpoint:
    """Implements the Endpoint calls BlockIndex makes, against a list of timestamps, through a real cache."""

    name = "public"

    def __init__(self, stamps: list[int], cache: ResponseCache | None = None):
        self.stamps = stamps
        self.cache = cache or temp_cache()
        self.requests = 0
        self.headers_served = 0

    def _header(self, block: int) -> dict:
        return {"number": hex(block), "timestamp": hex(self.stamps[block]), "hash": f"0x{block:064x}"}

    def batch(self, calls):
        out, missing = [], []
        for method, params in calls:
            assert method == "eth_getBlockByNumber"
            cached = self.cache.get(self.name, method, params)
            out.append(cached.result if cached else None)
        missing = [i for i, v in enumerate(out) if v is None]
        if missing:
            self.requests += 1
            for i in missing:
                block = int(calls[i][1][0], 16)
                out[i] = self._header(block)
                self.headers_served += 1
                self.cache.put(self.name, calls[i][0], normalize(calls[i][1]), result=out[i])
        return out

    def call(self, method, params):
        return self.batch([(method, params)])[0]
