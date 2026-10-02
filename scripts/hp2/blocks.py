"""Instant to block: the last block whose timestamp is at or before an instant (docs/HP2_PROTOCOL.md, Data).

Robinhood Chain makes about ten blocks a second with one-second timestamps, so many blocks share a timestamp and the
answer is the last of them. Headers come from the public endpoint in small JSON-RPC batches, one request at a time.
A coarse index of evenly spaced headers brackets any instant; each lookup then samples densely around an
interpolated guess and finishes by reading every header left in the bracket, so the answer is exact: header(b) is at
or before the instant and header(b + 1) is after it. Every header read is kept as an anchor for later lookups.
"""

from bisect import bisect_right

from hp2.rpc import Endpoint


class NonMonotonic(Exception):
    """Two headers whose timestamps decrease as block numbers increase."""


class BlockIndex:
    def __init__(self, public: Endpoint, *, batch: int = 12, final_batch: int = 40, window_fraction: float = 0.006):
        self.public = public
        self.batch = batch
        self.final_batch = final_batch
        self.window_fraction = window_fraction
        self._known: dict[int, int] = {}
        self._blocks: list[int] = []
        self._ts: list[int] = []
        self._dirty = False
        self.exact: dict[int, int] = {}
        self.lookup_requests = 0
        for params, header in public.cache.by_method(public.name, "eth_getBlockByNumber"):
            self._remember(int(params[0], 16), int(header["timestamp"], 16))

    # Headers

    def _remember(self, block: int, ts: int) -> None:
        if self._known.get(block, ts) != ts:
            raise NonMonotonic(f"block {block} has two timestamps")
        if block not in self._known:
            self._known[block] = ts
            self._dirty = True

    def _sorted(self) -> tuple[list[int], list[int]]:
        if self._dirty:
            self._blocks = sorted(self._known)
            self._ts = [self._known[b] for b in self._blocks]
            for i in range(1, len(self._ts)):
                if self._ts[i] < self._ts[i - 1]:
                    raise NonMonotonic(
                        f"block {self._blocks[i]} at {self._ts[i]} is before block {self._blocks[i - 1]} at "
                        f"{self._ts[i - 1]}"
                    )
            self._dirty = False
        return self._blocks, self._ts

    def timestamps(self, blocks, *, batch: int | None = None) -> dict[int, int]:
        size = batch or self.batch
        wanted = sorted({b for b in blocks if b not in self._known})
        for i in range(0, len(wanted), size):
            chunk = wanted[i : i + size]
            headers = self.public.batch([("eth_getBlockByNumber", [hex(b), False]) for b in chunk])
            for block, header in zip(chunk, headers, strict=True):
                if int(header["number"], 16) != block:
                    raise ValueError(f"asked for block {block}, got {header['number']}")
                self._remember(block, int(header["timestamp"], 16))
        return {b: self._known[b] for b in blocks}

    def timestamp(self, block: int) -> int:
        return self.timestamps([block])[block]

    def header(self, block: int) -> dict:
        return self.public.call("eth_getBlockByNumber", [hex(block), False])

    def build_coarse(self, first: int, last: int, spacing: int, *, batch: int = 50) -> list[int]:
        """Headers at every multiple of spacing from first, rounded down, up to last, and at last itself."""
        blocks = list(range(first - first % spacing, last + 1, spacing))
        if blocks[-1] != last:
            blocks.append(last)
        self.timestamps(blocks, batch=batch)
        return blocks

    # Lookup

    def bracket(self, instant: int) -> tuple[int, int]:
        """Known blocks lo and hi with header(lo) at or before the instant and header(hi) after it, closest known."""
        blocks, ts = self._sorted()
        i = bisect_right(ts, instant) - 1
        if i < 0 or i + 1 >= len(blocks):
            raise ValueError(f"instant {instant} is outside the known headers; build the coarse index first")
        return blocks[i], blocks[i + 1]

    def at_or_before(self, instant: int) -> int:
        """The last block with timestamp <= instant. Exact."""
        instant = int(instant)
        if instant in self.exact:
            return self.exact[instant]
        fraction = self.window_fraction
        while True:
            lo, hi = self.bracket(instant)
            if hi == lo + 1:
                self.exact[instant] = lo
                return lo
            interior = hi - lo - 1
            if interior <= self.final_batch:
                points = list(range(lo + 1, hi))
            else:
                ts_lo, ts_hi = self._known[lo], self._known[hi]
                guess = lo + (instant + 1 - ts_lo) / (ts_hi - ts_lo) * (hi - lo)
                half = max(self.batch, int((hi - lo) * fraction))
                first, last = max(lo + 1, int(guess) - half), min(hi - 1, int(guess) + half)
                step = max(1, (last - first) // (self.batch - 1))
                points = sorted({min(last, first + k * step) for k in range(self.batch)})
            self.lookup_requests += 1
            self.timestamps(points, batch=max(self.batch, self.final_batch))
            new_lo, new_hi = self.bracket(instant)
            if new_lo < points[0] or new_hi > points[-1]:
                fraction = min(0.5, fraction * 8)

    def proof(self, instant: int) -> tuple[int, int, int]:
        """(block, its timestamp, the next block's timestamp) for an instant already looked up."""
        block = self.at_or_before(instant)
        known = self.timestamps([block, block + 1])
        if not known[block] <= instant < known[block + 1]:
            raise AssertionError(f"lookup for {instant} gave {block} with timestamps {known}")
        return block, known[block], known[block + 1]

    def anchors(self) -> list[tuple[int, int]]:
        blocks, ts = self._sorted()
        return list(zip(blocks, ts, strict=True))
