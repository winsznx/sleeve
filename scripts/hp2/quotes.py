"""QuoterV2 quoteExactInputSingle at a block, for every allowlisted pool of a ticker and both payment sizes.

The call is the protocol's: USDG in, the ticker's token out, the pool's fee, sqrtPriceLimitX96 zero, eth_call at the
block on the archive endpoint. A revert is recorded with its error, not retried.
"""

import threading
from concurrent.futures import ThreadPoolExecutor, wait

from hp2 import abi
from hp2.constants import QUOTER_V2, SELECTOR, SIZES_USDG, TICKER_BY_SYMBOL, USDG, USDG_DECIMALS
from hp2.rpc import Endpoint, Revert

AMOUNT_IN = {size: size * 10**USDG_DECIMALS for size in SIZES_USDG}


def quote_call_data(token: str, amount_in: int, fee: int) -> str:
    return abi.call_data(
        SELECTOR["quoteExactInputSingle"],
        abi.address_word(USDG),
        abi.address_word(token),
        abi.word(amount_in),
        abi.word(fee),
        abi.word(0),
    )


def decode_quote(outcome) -> dict:
    if isinstance(outcome, Revert):
        return {"ok": False, "error": outcome.as_dict()}
    amount_out, sqrt_after, ticks_crossed, gas_estimate = abi.words(abi.strip(outcome))
    return {
        "ok": True,
        "amount_out": str(amount_out),
        "sqrt_price_x96_after": str(sqrt_after),
        "initialized_ticks_crossed": ticks_crossed,
        "gas_estimate": gas_estimate,
    }


class QuoteBook:
    def __init__(self, archive: Endpoint):
        self.archive = archive
        self._lock = threading.Lock()
        self._results: dict[tuple[str, int], dict[tuple[str, int], dict]] = {}

    def jobs(self, symbol: str) -> list[tuple[str, int, int]]:
        ticker = TICKER_BY_SYMBOL[symbol]
        return [(pool.address, pool.fee, size) for pool in ticker.pools for size in SIZES_USDG]

    def fetch_one(self, symbol: str, pool: str, fee: int, size: int, block: int) -> None:
        token = TICKER_BY_SYMBOL[symbol].token
        data = quote_call_data(token, AMOUNT_IN[size], fee)
        outcome = self.archive.call_revertible("eth_call", [{"to": QUOTER_V2, "data": data}, hex(block)])
        quote = decode_quote(outcome)
        with self._lock:
            self._results.setdefault((symbol, block), {})[(pool, size)] = quote

    def has(self, symbol: str, block: int) -> bool:
        with self._lock:
            return len(self._results.get((symbol, block), {})) == len(self.jobs(symbol))

    def quotes(self, symbol: str, block: int) -> dict[tuple[str, int], dict]:
        with self._lock:
            got = dict(self._results[(symbol, block)])
        if len(got) != len(self.jobs(symbol)):
            raise KeyError(f"quotes for {symbol} at block {block} are incomplete")
        return got

    def best_out(self, symbol: str, block: int, size: int) -> int | None:
        outs = [int(q["amount_out"]) for (pool, s), q in self.quotes(symbol, block).items() if s == size and q["ok"]]
        return max(outs) if outs else None

    def keys(self) -> list[tuple[str, int]]:
        with self._lock:
            return sorted(self._results)


class QuoteFetcher:
    """Maps instants to blocks one header request at a time while two workers quote the blocks already mapped."""

    def __init__(self, index, book: QuoteBook, workers: int = 2, progress=None):
        self.index = index
        self.book = book
        self.executor = ThreadPoolExecutor(max_workers=workers)
        self.progress = progress
        self.instants_by_key: dict[tuple[str, int], set[int]] = {}

    def ensure(self, need: dict[int, set[str]]) -> None:
        futures, queued = [], set()
        for n, instant in enumerate(sorted(need)):
            block = self.index.at_or_before(instant)
            for symbol in sorted(need[instant]):
                self.instants_by_key.setdefault((symbol, block), set()).add(instant)
                if (symbol, block) in queued or self.book.has(symbol, block):
                    continue
                queued.add((symbol, block))
                for pool, fee, size in self.book.jobs(symbol):
                    futures.append(self.executor.submit(self.book.fetch_one, symbol, pool, fee, size, block))
            if self.progress and (n + 1) % 50 == 0:
                self.progress(f"mapped {n + 1}/{len(need)} instants, {len(futures)} quote calls queued")
        done, _ = wait(futures)
        for future in done:
            future.result()

    def close(self) -> None:
        self.executor.shutdown(wait=True)
