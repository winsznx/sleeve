"""Read-only loaders for results/hp2/data, for the replay engine. No network.

Rebuild every file offline from the committed compact cache with:
    scripts/hp2/.venv/bin/python scripts/hp2/fetch.py --rebuild

Files and fields. Unix instants are integer seconds UTC unless named otherwise. Values that can pass 2^53 (answers,
round ids, multipliers, token amounts, sqrt prices) are decimal strings.

pools.json
    pools[]: ticker, pool, fee, anchor (true for the fee-500 pool that starts the window), token0, token1,
    tick_spacing, creation_block, creation_ts, creation_iso, tx, log_index. From the factory's PoolCreated log.

windows.json
    windows{ticker}: anchor_pool, anchor_creation_block, anchor_creation_ts, start = anchor_creation_ts + 86400,
    end = end_block_ts - 345600, start_iso, end_iso, end_block, end_block_ts.

arrivals.json
    tickers{ticker}: seed, method, start, end, arrivals[]: i (draw order, 0 to 249), t (the float draw),
    unix = floor(t), iso (of t), block (the last block at or before unix).

rounds/<ticker>.json and usdg_rounds.json
    feed, decimals (8), description, phase_id, aggregator, read_block (the pinned latest block the rounds were read
    at), latest_at_read_block, missing_rounds, end_ts, median_answer (a fraction string), drop_rule, dropped_count,
    dropped_last_updated_at, dropped_all_before_2026_06_23_1353Z, rounds_after_end_ts (read but left out),
    rounds[]: round_id, phase, aggregator_round, answer, started_at, updated_at, answered_in_round, iso,
    dropped (answer above 10 times the median), nonpositive, block (the transmit block from the aggregator's
    AnswerUpdated log, null if no log matched). Every round with updated_at <= end_ts is listed, in round order.

events.json
    scans[]: contract, address, event, from_block, to_block, count; one per scanned address and topic, so a zero is
    explicit. events[]: contract (ticker or "registry"), address, event (UIMultiplierUpdated, Paused, Unpaused,
    OraclePaused, OracleUnpaused), block, block_ts, block_iso, log_index, tx, args (UIMultiplierUpdated:
    old_multiplier, new_multiplier, effective_at, effective_iso). Sorted by block and log index.

blocks.json
    rule, end_block, end_ts, coarse_spacing, index (rows [block, timestamp] every coarse_spacing blocks), exact (rows
    [instant, block, block_timestamp, next_block_timestamp] with block_timestamp <= instant < next_block_timestamp,
    for every instant that has quotes). BlockMap.block(instant) answers exactly for those instants only.

quotes/<ticker>.jsonl
    One line per block with quotes, ascending: block, block_ts, instants (every instant mapped to that block),
    quotes[]: pool, fee, usdg_in (100 or 1000), ok, and either amount_out, sqrt_price_x96_after,
    initialized_ticks_crossed, gas_estimate, or error {code, message, data} for a revert. QuoterV2
    quoteExactInputSingle, USDG in, token out, sqrtPriceLimitX96 zero, eth_call at the block.

sessions.json
    The ALL_DAY open intervals [opens, closes, opens_iso, closes_iso] over the replay period from the forge library,
    the source hashes, and how many instants the Python port was checked on.

coverage.json
    tickers{ticker}[]: i, arrival_unix, instants (every instant quoted for that payment), unresolved.

checks.json
    Runtime assertions and cross-checks: decimals, pool wiring, rounds against AnswerUpdated logs, quote reverts.

fetch_log.json
    One record per online run: endpoints{archive, public}: http_requests, rpc_calls, cache_hits, http_429,
    rate_limited_json_errors, cloudflare_challenges, retries, reverts, seconds_waiting_on_network, errors; seconds;
    summary. totals sums them.

Using the data. Quotes(ticker).at(instant) gives the quote row of the last block at or before the instant; the best
quote for a size is the largest amount_out among its ok quotes, and execution price is usdg_in over that amount.
Quotes exist for each payment's arrival and, for a payment that may wait, for every evaluation instant until every
policy has certainly filled, plus every grid point and round instant within an hour of a session boundary the payment
came near. Evaluation instants, as fetched: the arrival; every updated_at of the ticker's feed; every multiple of
900 s at which the session is open (each 20:00 New York open is one); every USDG/USD updated_at while the session is
open. An instant outside that set raises MissingQuote; add it with fetch.py --extend. The session test is
hp2.session.CheckedSession(ForgeSession(CACHE_DIR / "session"), PortSession()).session_state(ts), which answers from
the forge library and stops on any disagreement with the Python port; call .states(many) first to batch forge.
"""

import json
from functools import cache
from pathlib import Path

from hp2.constants import DATA_DIR


class MissingQuote(LookupError):
    """No quotes were fetched for this ticker at this instant. Rerun fetch.py with --extend to add them."""


def _load(name: str, root: Path = DATA_DIR):
    return json.loads((root / name).read_text())


def pools(root: Path = DATA_DIR) -> list[dict]:
    return _load("pools.json", root)["pools"]


def windows(root: Path = DATA_DIR) -> dict[str, dict]:
    return _load("windows.json", root)["windows"]


def arrivals(symbol: str, root: Path = DATA_DIR) -> list[dict]:
    return _load("arrivals.json", root)["tickers"][symbol]["arrivals"]


def rounds(symbol: str, root: Path = DATA_DIR) -> dict:
    return _load(f"rounds/{symbol}.json", root)


def usdg_rounds(root: Path = DATA_DIR) -> dict:
    return _load("usdg_rounds.json", root)


def events(root: Path = DATA_DIR) -> list[dict]:
    return _load("events.json", root)["events"]


def sessions(root: Path = DATA_DIR) -> dict:
    return _load("sessions.json", root)


def coverage(root: Path = DATA_DIR) -> dict:
    return _load("coverage.json", root)["tickers"]


class BlockMap:
    def __init__(self, root: Path = DATA_DIR):
        doc = _load("blocks.json", root)
        self.exact = {row[0]: row[1] for row in doc["exact"]}
        self.index = doc["index"]

    def block(self, instant: float) -> int:
        """The last block at or before the instant, for instants the fetch looked up."""
        key = int(instant // 1)
        if key not in self.exact:
            raise MissingQuote(f"no exact block for instant {instant}")
        return self.exact[key]


class Quotes:
    """Quotes of one ticker by block, and by instant through the block map."""

    def __init__(self, symbol: str, root: Path = DATA_DIR, block_map: BlockMap | None = None):
        self.symbol = symbol
        self.blocks = block_map or BlockMap(root)
        self.by_block = {}
        with open(root / "quotes" / f"{symbol}.jsonl") as fh:
            for line in fh:
                row = json.loads(line)
                self.by_block[row["block"]] = row

    def at(self, instant: float) -> dict:
        block = self.blocks.block(instant)
        row = self.by_block.get(block)
        if row is None:
            raise MissingQuote(f"{self.symbol} has no quotes at block {block} (instant {instant})")
        return row


@cache
def quotes(symbol: str) -> Quotes:
    return Quotes(symbol)
