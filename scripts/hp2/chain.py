"""Reads that do not depend on the replay's instants: decimals, pool creation, feed rounds, token and registry events.

Logs come from the public endpoint, one address and one topic per request (other positions hold single values), in
10,000,000-block chunks. Feed rounds come from getRoundData at a recent block, the latest state, batched through
Multicall3 on the public endpoint; the public endpoint keeps minutes of state, so each feed is read at its own fresh
pin and re-read at a new pin if the old one is gone. Pool and contract checks at the end block use the archive.
"""

from fractions import Fraction
from itertools import pairwise

from hp2 import abi
from hp2.constants import (
    DROP_EXPECTED_BEFORE,
    DROP_FACTOR,
    END_BLOCK,
    FEED_DECIMALS,
    LOG_CHUNK_BLOCKS,
    MULTICALL3,
    REGISTRY,
    SELECTOR,
    STATE_EVENTS,
    TICKERS,
    TOKEN_DECIMALS,
    TOPIC,
    USDG,
    USDG_DECIMALS,
    USDG_USD_FEED,
    V3_FACTORY,
)
from hp2.rpc import Endpoint, StateUnavailable
from hp2.timefmt import iso

ROUND_BATCH = 100
PHASE_SHIFT = 64


def eth_call(endpoint: Endpoint, to: str, data: str, block: int) -> bytes:
    return abi.strip(endpoint.call("eth_call", [{"to": to, "data": data}, hex(block)]))


def chunks(first: int, last: int, size: int = LOG_CHUNK_BLOCKS):
    """Aligned ranges [a, b] with b - a + 1 <= size covering [first, last]."""
    a = first
    while a <= last:
        b = min(last, a - a % size + size - 1)
        yield a, b
        a = b + 1


def get_logs(public: Endpoint, address: str, topics: list, first: int, last: int) -> list[dict]:
    logs = []
    for a, b in chunks(first, last):
        logs += public.call(
            "eth_getLogs", [{"address": address, "fromBlock": hex(a), "toBlock": hex(b), "topics": topics}]
        )
    for log in logs:
        if log.get("removed"):
            raise ValueError(f"removed log in a finalized range: {log}")
    return sorted(logs, key=lambda log: (int(log["blockNumber"], 16), int(log["logIndex"], 16)))


def topic_word(value: int | str) -> str:
    if isinstance(value, str):
        return "0x" + abi.address_word(value)
    return "0x" + abi.word(value)


# Decimals and contract checks


def assert_decimals(archive: Endpoint, block: int) -> dict:
    expected = {USDG: USDG_DECIMALS, USDG_USD_FEED: FEED_DECIMALS}
    for t in TICKERS:
        expected[t.token] = TOKEN_DECIMALS
        expected[t.feed] = FEED_DECIMALS
    seen = {}
    for address, want in expected.items():
        got = abi.words(eth_call(archive, address, SELECTOR["decimals"], block))[0]
        if got != want:
            raise AssertionError(f"decimals() of {address} at block {block} is {got}, expected {want}")
        seen[address] = got
    return {"block": block, "decimals": seen}


def pool_checks(archive: Endpoint, block: int) -> dict:
    """token0, token1, fee and the factory's getPool answer for every allowlisted pool."""
    out = {}
    for t in TICKERS:
        for pool in t.pools:
            token0 = abi.to_address(abi.words(eth_call(archive, pool.address, SELECTOR["token0"], block))[0])
            token1 = abi.to_address(abi.words(eth_call(archive, pool.address, SELECTOR["token1"], block))[0])
            fee = abi.words(eth_call(archive, pool.address, SELECTOR["fee"], block))[0]
            got = abi.words(
                eth_call(
                    archive,
                    V3_FACTORY,
                    abi.call_data(
                        SELECTOR["getPool"], abi.address_word(USDG), abi.address_word(t.token), abi.word(pool.fee)
                    ),
                    block,
                )
            )[0]
            if {token0, token1} != {USDG.lower(), t.token.lower()} or fee != pool.fee:
                raise AssertionError(f"{t.symbol} pool {pool.address} holds {token0}, {token1}, fee {fee}")
            if abi.to_address(got) != pool.address.lower():
                raise AssertionError(f"factory getPool for {t.symbol} fee {pool.fee} is {abi.to_address(got)}")
            out[pool.address.lower()] = {"token0": token0, "token1": token1, "fee": fee, "factory_get_pool": True}
    return {"block": block, "pools": out}


# Pools


def pool_creations(public: Endpoint, timestamps) -> list[dict]:
    rows = []
    for t in TICKERS:
        for pool in t.pools:
            token0, token1 = sorted([USDG, t.token], key=lambda a: int(a, 16))
            topics = [TOPIC["PoolCreated"], topic_word(token0), topic_word(token1), topic_word(pool.fee)]
            logs = get_logs(public, V3_FACTORY, topics, 0, END_BLOCK)
            if len(logs) != 1:
                raise AssertionError(f"{len(logs)} PoolCreated logs for {t.symbol} fee {pool.fee}")
            log = logs[0]
            spacing, created = abi.words(abi.strip(log["data"]))
            if abi.to_address(created) != pool.address.lower():
                raise AssertionError(f"PoolCreated names {abi.to_address(created)}, allowlist has {pool.address}")
            block = int(log["blockNumber"], 16)
            ts = timestamps([block])[block]
            rows.append(
                {
                    "ticker": t.symbol,
                    "pool": pool.address,
                    "fee": pool.fee,
                    "anchor": pool.fee == 500,
                    "token0": token0,
                    "token1": token1,
                    "tick_spacing": abi.signed(spacing),
                    "creation_block": block,
                    "creation_ts": ts,
                    "creation_iso": iso(ts),
                    "tx": log["transactionHash"],
                    "log_index": int(log["logIndex"], 16),
                }
            )
    return rows


# Feed rounds


def _round(data: bytes) -> dict:
    round_id, answer, started_at, updated_at, answered_in_round = abi.words(data)
    return {
        "round_id": str(round_id),
        "phase": round_id >> PHASE_SHIFT,
        "aggregator_round": round_id & ((1 << PHASE_SHIFT) - 1),
        "answer": str(abi.signed(answer)),
        "started_at": started_at,
        "updated_at": updated_at,
        "answered_in_round": str(answered_in_round),
    }


def _read_feed(public: Endpoint, feed: str, block: int) -> dict:
    decimals = abi.words(eth_call(public, feed, SELECTOR["decimals"], block))[0]
    if decimals != FEED_DECIMALS:
        raise AssertionError(f"feed {feed} has {decimals} decimals")
    description = abi.decode_string(eth_call(public, feed, SELECTOR["description"], block))
    phase = abi.words(eth_call(public, feed, SELECTOR["phaseId"], block))[0]
    aggregator = abi.to_address(abi.words(eth_call(public, feed, SELECTOR["aggregator"], block))[0])
    latest = _round(eth_call(public, feed, SELECTOR["latestRoundData"], block))
    if phase != 1 or latest["phase"] != 1:
        raise AssertionError(f"feed {feed} is in phase {phase}; only phase 1 is handled")
    rounds, missing = [], []
    for start in range(1, latest["aggregator_round"] + 1, ROUND_BATCH):
        ids = range(start, min(start + ROUND_BATCH, latest["aggregator_round"] + 1))
        calls = [
            (feed, True, abi.strip(abi.call_data(SELECTOR["getRoundData"], abi.word((phase << PHASE_SHIFT) | n))))
            for n in ids
        ]
        results = abi.decode_aggregate3(
            eth_call(public, MULTICALL3, abi.encode_aggregate3(SELECTOR["aggregate3"], calls), block)
        )
        for n, (ok, data) in zip(ids, results, strict=True):
            if ok:
                rounds.append(_round(data))
            else:
                missing.append({"aggregator_round": n, "revert": "0x" + data.hex()})
    return {
        "feed": feed,
        "decimals": decimals,
        "description": description,
        "phase_id": phase,
        "aggregator": aggregator,
        "read_block": block,
        "latest_at_read_block": latest,
        "rounds_read": rounds,
        "missing_rounds": missing,
    }


def read_feed(public: Endpoint, feed: str) -> dict:
    """All rounds of a feed at a fresh pin, which the cache remembers so a rerun reads the same pin."""
    name = f"latest_pin:{feed.lower()}"
    for _ in range(3):
        pin = public.cache.meta(name)
        if pin is None:
            pin = int(public.call_uncached("eth_blockNumber", []), 16)
            public.cache.set_meta(name, pin)
        try:
            return _read_feed(public, feed, pin)
        except StateUnavailable:
            public.cache.delete_meta(name)
    raise StateUnavailable(f"could not read {feed} at a fresh pin three times")


def exact_median(values: list[int]) -> Fraction:
    """The median as a Fraction, so a half between two answers is never rounded."""
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return Fraction(ordered[middle])
    return Fraction(ordered[middle - 1] + ordered[middle], 2)


def finish_rounds(raw: dict, end_ts: int) -> dict:
    """Keep rounds up to the end block and flag the ones the protocol drops: answer above 10 times the median."""
    rounds = sorted((r for r in raw["rounds_read"] if r["updated_at"] <= end_ts), key=lambda r: r["aggregator_round"])
    mid = exact_median([int(r["answer"]) for r in rounds])
    for r in rounds:
        r["iso"] = iso(r["updated_at"])
        r["dropped"] = int(r["answer"]) > DROP_FACTOR * mid
        r["nonpositive"] = int(r["answer"]) <= 0
    dropped = [r for r in rounds if r["dropped"]]
    for prev, cur in pairwise(rounds):
        if cur["updated_at"] < prev["updated_at"]:
            raise AssertionError(f"feed {raw['feed']} round {cur['aggregator_round']} is older than the one before")
    out = {k: v for k, v in raw.items() if k != "rounds_read"}
    out.update(
        {
            "end_ts": end_ts,
            "median_answer": str(mid),
            "drop_rule": f"answer > {DROP_FACTOR} * median_answer over rounds with updated_at <= end_ts",
            "dropped_count": len(dropped),
            "dropped_last_updated_at": max((r["updated_at"] for r in dropped), default=None),
            "dropped_all_before_2026_06_23_1353Z": all(r["updated_at"] < DROP_EXPECTED_BEFORE for r in dropped),
            "rounds_after_end_ts": sum(1 for r in raw["rounds_read"] if r["updated_at"] > end_ts),
            "rounds": rounds,
        }
    )
    return out


def answer_updated(public: Endpoint, aggregator: str) -> list[dict]:
    logs = get_logs(public, aggregator, [TOPIC["AnswerUpdated"]], 0, END_BLOCK)
    return [
        {
            "aggregator_round": int(log["topics"][2], 16),
            "answer": str(abi.signed(int(log["topics"][1], 16))),
            "updated_at": abi.words(abi.strip(log["data"]))[0],
            "block": int(log["blockNumber"], 16),
            "tx": log["transactionHash"],
        }
        for log in logs
    ]


def cross_check_rounds(rounds: dict, logs: list[dict]) -> dict:
    """Every kept round against the aggregator's AnswerUpdated log for it."""
    by_round = {}
    for log in logs:
        by_round.setdefault(log["aggregator_round"], []).append(log)
    mismatches, blocks = [], {}
    for r in rounds["rounds"]:
        found = by_round.get(r["aggregator_round"], [])
        same = [log for log in found if log["answer"] == r["answer"] and log["updated_at"] == r["updated_at"]]
        if len(same) != 1:
            mismatches.append({"aggregator_round": r["aggregator_round"], "logs": found})
            continue
        blocks[r["aggregator_round"]] = same[0]["block"]
    extra = sorted(set(by_round) - {r["aggregator_round"] for r in rounds["rounds"]})
    return {
        "logs": len(logs),
        "matched": len(blocks),
        "mismatches": mismatches,
        "log_rounds_not_read": extra,
        "blocks": blocks,
    }


# Events


def state_events(public: Endpoint, timestamps) -> dict:
    contracts = {t.symbol: t.token for t in TICKERS}
    contracts["registry"] = REGISTRY
    scans, events = [], []
    for name, address in contracts.items():
        for event in STATE_EVENTS:
            logs = get_logs(public, address, [TOPIC[event]], 0, END_BLOCK)
            scans.append(
                {
                    "contract": name,
                    "address": address,
                    "event": event,
                    "from_block": 0,
                    "to_block": END_BLOCK,
                    "count": len(logs),
                }
            )
            for log in logs:
                args = {}
                if event == "UIMultiplierUpdated":
                    old, new, effective_at = abi.words(abi.strip(log["data"]))
                    args = {
                        "old_multiplier": str(old),
                        "new_multiplier": str(new),
                        "effective_at": effective_at,
                        "effective_iso": iso(effective_at),
                    }
                events.append(
                    {
                        "contract": name,
                        "address": address,
                        "event": event,
                        "block": int(log["blockNumber"], 16),
                        "log_index": int(log["logIndex"], 16),
                        "tx": log["transactionHash"],
                        "args": args,
                    }
                )
    stamps = timestamps(sorted({e["block"] for e in events}))
    for e in events:
        e["block_ts"] = stamps[e["block"]]
        e["block_iso"] = iso(e["block_ts"])
    events.sort(key=lambda e: (e["block"], e["log_index"]))
    return {"scans": scans, "events": events}
