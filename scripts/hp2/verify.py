#!/usr/bin/env python3
"""Checks on results/hp2/data, offline by default.

    scripts/hp2/.venv/bin/python scripts/hp2/verify.py
        consistency of the data files
    scripts/hp2/.venv/bin/python scripts/hp2/verify.py --spot
        also re-quote one random row per ticker with cast on the archive RPC, and reproduce the QuoterV2 readings in
        docs/research/pools.md at blocks 78,312,136 and 73,280,794: 15 archive calls, one at a time, nothing cached.
        Do not run it while fetch.py is running, which already uses both archive slots.

Exits 1 on the first failed check.
"""

import argparse
import random
import subprocess
import sys
import tempfile
import time
from decimal import ROUND_DOWN, ROUND_HALF_EVEN, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hp2 import data  # noqa: E402
from hp2.constants import (  # noqa: E402
    ARCHIVE_RPC,
    DROP_EXPECTED_BEFORE,
    QUOTER_V2,
    SIGNATURE,
    SIZES_USDG,
    TICKERS,
    USDG,
)

# docs/research/pools.md, "Recommended pools at the pinned fork blocks": tokens bought by 100 USDG, 18 decimals.
RESEARCH_QUOTES = {
    78_312_136: {
        "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167": "0.129288627355",
        "0xD60A5d14dB690B7Afad71F76B108071D7175597d": "0.132568384750",
        "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3": "0.421675347099",
        "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D": "0.299104803597",
        "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed": "0.298932952993",
    },
    73_280_794: {
        "0xa7Bb1AC63BBaB0C44316E6c8C455213441689167": "0.129538580347",
        "0xD60A5d14dB690B7Afad71F76B108071D7175597d": "0.134235446301",
        "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3": "0.444457842218",
        "0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D": "0.293499729887",
        "0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed": "0.292633938428",
    },
}


def check(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL {message}")
        sys.exit(1)


def consistency() -> None:
    windows = data.windows()
    blocks = data.BlockMap()
    doc = data._load("blocks.json")
    for instant, _block, ts, next_ts in doc["exact"]:
        check(ts <= instant < next_ts, f"block proof for {instant}")
    coverage = data.coverage()
    for t in TICKERS:
        quotes = data.Quotes(t.symbol, block_map=blocks)
        window = windows[t.symbol]
        arrivals = data.arrivals(t.symbol)
        check(len(arrivals) == 250, f"{t.symbol} has {len(arrivals)} arrivals")
        for a in arrivals:
            check(window["start"] <= a["t"] <= window["end"], f"{t.symbol} arrival {a['i']} outside the window")
            check(a["block"] == blocks.block(a["unix"]), f"{t.symbol} arrival {a['i']} block")
            row = quotes.at(a["unix"])
            check(a["unix"] in row["instants"], f"{t.symbol} arrival {a['i']} not listed on its quote row")
        for payment in coverage[t.symbol]:
            for instant in payment["instants"]:
                quotes.at(instant)
        for row in quotes.by_block.values():
            check(len(row["quotes"]) == len(t.pools) * len(SIZES_USDG), f"{t.symbol} block {row['block']} quotes")
        rounds = data.rounds(t.symbol)
        check(rounds["dropped_all_before_2026_06_23_1353Z"], f"{t.symbol} has a dropped round after the cutoff")
        check(
            all(r["updated_at"] < DROP_EXPECTED_BEFORE for r in rounds["rounds"] if r["dropped"]), f"{t.symbol} drops"
        )
        stamps = [r["updated_at"] for r in rounds["rounds"]]
        check(stamps == sorted(stamps), f"{t.symbol} rounds out of order")
        counts = f"{len(arrivals)} arrivals, {len(quotes.by_block)} quote blocks, {len(rounds['rounds'])} rounds"
        print(f"ok {t.symbol}: {counts}")
    print(f"ok {len(doc['exact'])} block proofs")


def cast_quote(token: str, fee: int, amount: int, block: int) -> int:
    out = subprocess.run(
        [
            "cast",
            "call",
            "--rpc-url",
            ARCHIVE_RPC,
            "--block",
            str(block),
            QUOTER_V2,
            SIGNATURE["quoteExactInputSingle"] + "(uint256,uint160,uint32,uint256)",
            f"({USDG},{token},{amount},{fee},0)",
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.split()
    time.sleep(0.35)
    return int(out[0])


def spot() -> None:
    from hp2.cache import ResponseCache
    from hp2.quotes import decode_quote, quote_call_data
    from hp2.rpc import Endpoint

    blocks = data.BlockMap()
    rng = random.Random(4663)
    for t in TICKERS:
        rows = [row for row in data.Quotes(t.symbol, block_map=blocks).by_block.values() if row["quotes"][0]["ok"]]
        row = rng.choice(rows)
        for q in row["quotes"]:
            if not q["ok"] or q["usdg_in"] != 100:
                continue
            got = cast_quote(t.token, q["fee"], 100_000_000, row["block"])
            check(got == int(q["amount_out"]), f"{t.symbol} block {row['block']} pool {q['pool']}: cast {got}")
            print(f"ok cast agrees for {t.symbol} fee {q['fee']} at block {row['block']}")
    archive = Endpoint(
        "archive", ARCHIVE_RPC, ResponseCache(Path(tempfile.mkdtemp()) / "verify.sqlite"), slots=1, pause=(0.2, 0.5)
    )
    pool_ticker = {p.address: t for t in TICKERS for p in t.pools}
    for block, expected in RESEARCH_QUOTES.items():
        for pool, tokens in expected.items():
            t = pool_ticker[pool]
            fee = next(p.fee for p in t.pools if p.address == pool)
            call = {"to": QUOTER_V2, "data": quote_call_data(t.token, 100_000_000, fee)}
            quote = decode_quote(archive.call_revertible("eth_call", [call, hex(block)]))
            check(quote["ok"], f"research quote at {block} for {pool} reverted")
            got = int(quote["amount_out"])
            shown = {
                str((Decimal(got) / 10**18).quantize(Decimal("1e-12"), rounding=r))
                for r in (ROUND_DOWN, ROUND_HALF_EVEN)
            }
            check(tokens in shown, f"research reading at {block} for {pool}: {got}")
            print(f"ok research reading at block {block} for {t.symbol} fee {fee}: {tokens}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--spot", action="store_true")
    args = parser.parse_args()
    consistency()
    if args.spot:
        spot()
    return 0


if __name__ == "__main__":
    sys.exit(main())
