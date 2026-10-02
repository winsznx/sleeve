#!/usr/bin/env python3
"""HP2 data fetch: everything docs/HP2_PROTOCOL.md needs from Robinhood Chain 4663, cached, written to results/hp2/data.

Usage, from the repo root, with the virtualenv in scripts/hp2/.venv (call it PY):
    PY scripts/hp2/fetch.py
        fetch what is missing, then write the data files
    PY scripts/hp2/fetch.py --offline
        the same from the cache only; a missing response stops the run
    PY scripts/hp2/fetch.py --rebuild [--data-dir DIR]
        rebuild the data files from the committed compact cache, results/hp2/cache/<profile>/responses.jsonl.gz,
        through a throwaway SQLite file, never touching the network; --data-dir writes them elsewhere to diff
    PY scripts/hp2/fetch.py --extend instants.json
        also quote {"SPY": [unix, ...], ...}; the instants are kept in the cache and quoted by every later run

The fetch resumes after an interruption: every response is in the cache before it is used, and the plan is a pure
function of the cached data, so a rerun repeats the same steps and only sends what is missing.
"""

import argparse
import json
import math
import random
import signal
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hp2 import chain  # noqa: E402
from hp2.blocks import BlockIndex  # noqa: E402
from hp2.cache import ResponseCache  # noqa: E402
from hp2.constants import (  # noqa: E402
    ARCHIVE_RPC,
    ARRIVALS_PER_TICKER,
    BOUNDARY_MARGIN,
    CACHE_DIR,
    CHAIN_ID,
    DATA_DIR,
    END_BLOCK,
    GRID_SECONDS,
    PUBLIC_RPC,
    SEED,
    SIZES_USDG,
    TICKERS,
    USDG_USD_FEED,
    WINDOW_AFTER_CREATION,
    WINDOW_BEFORE_END,
)
from hp2.planner import Planner, Rounds, TokenEvents  # noqa: E402
from hp2.quotes import QuoteBook, QuoteFetcher  # noqa: E402
from hp2.rpc import endpoints  # noqa: E402
from hp2.session import CheckedSession, ForgeSession, PortSession, open_intervals  # noqa: E402
from hp2.timefmt import iso  # noqa: E402

COARSE_SPACING = 5_000
UPPER_SENTINEL = 20_000
STARTED = time.time()


def say(message: str) -> None:
    print(f"[{time.time() - STARTED:8.1f}s] {message}", file=sys.stderr, flush=True)


def render(value, depth: int = 0) -> str:
    """JSON with one object key per line and one list item per line when the items are objects or lists, each item
    compact, so the data files stay small and diff by record."""
    pad = " " * depth
    if isinstance(value, dict) and value:
        body = ",\n".join(f"{pad} {json.dumps(k)}: {render(v, depth + 1)}" for k, v in value.items())
        return "{\n" + body + "\n" + pad + "}"
    if isinstance(value, list) and value and all(isinstance(v, (dict, list)) for v in value):
        body = ",\n".join(pad + " " + json.dumps(v, separators=(",", ":")) for v in value)
        return "[\n" + body + "\n" + pad + "]"
    return json.dumps(value, separators=(",", ":"))


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(render(value) + "\n")
    tmp.replace(path)


def write_jsonl(path: Path, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as fh:
        for row in rows:
            fh.write(json.dumps(row, separators=(",", ":")) + "\n")
    tmp.replace(path)


def draw_arrivals(index: int, start: int, end: int) -> list[dict]:
    """250 arrivals uniform over wall-clock time: random.Random(SEED + i).uniform(start, end), in draw order."""
    rng = random.Random(SEED + index)
    out = []
    for i in range(ARRIVALS_PER_TICKER):
        t = rng.uniform(start, end)
        out.append({"i": i, "t": t, "unix": math.floor(t), "iso": iso(t)})
    return out


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--profile", default="drpc", help="cache profile, one per provider set (default drpc)")
    parser.add_argument("--offline", action="store_true", help="never touch the network")
    parser.add_argument("--rebuild", action="store_true", help="import the compact cache, then run offline")
    parser.add_argument("--extend", type=Path, help="JSON {ticker: [unix instants]} to quote in addition")
    parser.add_argument("--archive-rpc", default=ARCHIVE_RPC)
    parser.add_argument("--public-rpc", default=PUBLIC_RPC)
    parser.add_argument("--limit-arrivals", type=int, help="testing only: plan the first N arrivals per ticker")
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR, help="where the data files go")
    parser.add_argument("--compact", type=Path, help="compact cache to rebuild from (default the profile's)")
    return parser.parse_args()


def main() -> int:
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    args = parse_args()
    profile_dir = CACHE_DIR / args.profile
    compact = args.compact or profile_dir / "responses.jsonl.gz"
    offline = args.offline or args.rebuild
    if args.rebuild:
        cache = ResponseCache(Path(tempfile.mkdtemp()) / "rebuild.sqlite")
        say(f"imported {cache.import_compact(compact)} responses from {compact}")
    else:
        cache = ResponseCache(profile_dir / "responses.sqlite")
    archive, public = endpoints(cache, args.archive_rpc, args.public_rpc, offline)
    run = {
        "started": iso(math.floor(STARTED)),
        "mode": "rebuild" if args.rebuild else "offline" if offline else "online",
        "profile": args.profile,
        "archive_rpc": args.archive_rpc,
        "public_rpc": args.public_rpc,
    }
    try:
        summary, keep_headers = fetch(args, archive, public)
        run["outcome"] = "ok"
        run["summary"] = summary
        if not offline:
            run["compact_responses"] = cache.export_compact(compact, keep_headers)
            say(f"wrote {run['compact_responses']} responses to {compact}")
        return 0
    except BaseException as exc:
        run["outcome"] = f"failed: {type(exc).__name__}: {exc}"
        raise
    finally:
        run["seconds"] = round(time.time() - STARTED, 1)
        run["endpoints"] = {"archive": archive.stats.as_dict(), "public": public.stats.as_dict()}
        if not offline:
            append_log(args.data_dir, run)
        archive.close()
        public.close()
        cache.close()
        say(f"run {run['outcome']} in {run['seconds']} s; archive {run['endpoints']['archive']}")
        say(f"public {run['endpoints']['public']}")


def load_extensions(cache: ResponseCache, path: Path | None) -> dict[str, list[int]]:
    """Instants added with --extend, kept in the cache so every later run, and a rebuild, quotes them again."""
    stored = cache.meta("extend_instants") or {}
    if path is not None:
        for symbol, instants in json.loads(path.read_text()).items():
            if symbol not in {t.symbol for t in TICKERS}:
                raise ValueError(f"--extend names an unknown ticker {symbol}")
            stored[symbol] = sorted(set(stored.get(symbol, [])) | {int(x) for x in instants})
        cache.set_meta("extend_instants", stored)
    return stored


def append_log(data_dir: Path, run: dict) -> None:
    path = data_dir / "fetch_log.json"
    log = json.loads(path.read_text()) if path.exists() else {"runs": []}
    log["runs"].append(run)
    totals: dict = {"runs": len(log["runs"]), "seconds": 0.0, "endpoints": {}}
    for r in log["runs"]:
        totals["seconds"] += r.get("seconds", 0.0)
        for name, stats in r.get("endpoints", {}).items():
            into = totals["endpoints"].setdefault(name, {})
            for key, value in stats.items():
                if isinstance(value, (int, float)):
                    into[key] = round(into.get(key, 0) + value, 1)
    log["totals"] = totals
    write_json(path, log)


def fetch(args, archive, public) -> tuple[dict, set[int]]:
    for endpoint in (archive, public):
        chain_id = int(endpoint.call("eth_chainId", []), 16)
        if chain_id != CHAIN_ID:
            raise AssertionError(f"{endpoint.name} RPC is on chain {chain_id}")
    index = BlockIndex(public)
    end_header = index.header(END_BLOCK)
    end_ts = int(end_header["timestamp"], 16)
    index.timestamps([END_BLOCK, END_BLOCK + UPPER_SENTINEL])
    say(f"end block {END_BLOCK} at {iso(end_ts)}")

    checks = {
        "chain_id": CHAIN_ID,
        "end_block": {"number": END_BLOCK, "timestamp": end_ts, "iso": iso(end_ts), "hash": end_header["hash"]},
    }
    checks["decimals_at_end_block"] = chain.assert_decimals(archive, END_BLOCK)
    checks["pools_at_end_block"] = chain.pool_checks(archive, END_BLOCK)

    pools = chain.pool_creations(public, index.timestamps)
    say(f"pool creation logs read for {len(pools)} pools")
    first_block = min(p["creation_block"] for p in pools)
    checks["decimals_at_first_pool_block"] = chain.assert_decimals(archive, first_block)

    windows, arrivals = {}, {}
    for t in TICKERS:
        anchor = next(p for p in pools if p["ticker"] == t.symbol and p["anchor"])
        start, end = anchor["creation_ts"] + WINDOW_AFTER_CREATION, end_ts - WINDOW_BEFORE_END
        windows[t.symbol] = {
            "ticker": t.symbol,
            "anchor_pool": anchor["pool"],
            "anchor_creation_block": anchor["creation_block"],
            "anchor_creation_ts": anchor["creation_ts"],
            "start": start,
            "start_iso": iso(start),
            "end": end,
            "end_iso": iso(end),
            "end_block": END_BLOCK,
            "end_block_ts": end_ts,
            "rule": "start = anchor_creation_ts + 86400; end = end_block_ts - 345600",
        }
        arrivals[t.symbol] = {
            "ticker": t.symbol,
            "seed": SEED + t.index,
            "method": "random.Random(seed).uniform(start, end), 250 draws, listed in draw order",
            "start": start,
            "end": end,
            "arrivals": draw_arrivals(t.index, start, end),
        }

    feeds = {t.symbol: chain.read_feed(public, t.feed) for t in TICKERS}
    feeds["USDG"] = chain.read_feed(public, USDG_USD_FEED)
    rounds = {name: chain.finish_rounds(raw, end_ts) for name, raw in feeds.items()}
    checks["rounds"] = {}
    for name, data in rounds.items():
        logs = chain.answer_updated(public, data["aggregator"])
        cross = chain.cross_check_rounds(data, logs)
        for r in data["rounds"]:
            r["block"] = cross["blocks"].get(r["aggregator_round"])
        checks["rounds"][name] = {
            "rounds_kept": len(data["rounds"]),
            "dropped": data["dropped_count"],
            "dropped_all_before_2026_06_23_1353Z": data["dropped_all_before_2026_06_23_1353Z"],
            "missing_rounds": data["missing_rounds"],
            "answer_updated_logs": cross["logs"],
            "matched_to_logs": cross["matched"],
            "mismatches": cross["mismatches"],
            "log_rounds_not_read": cross["log_rounds_not_read"],
        }
        say(
            f"{name}: {len(data['rounds'])} rounds, {data['dropped_count']} dropped, {cross['matched']} matched to logs"
        )

    events = chain.state_events(public, index.timestamps)
    say(f"{len(events['events'])} token and registry events")

    say("building the coarse block index")
    index.build_coarse(first_block, END_BLOCK + UPPER_SENTINEL, COARSE_SPACING)
    say(f"coarse index ready, {len(index.anchors())} anchors")

    forge = ForgeSession(CACHE_DIR / "session", offline_only=False)
    port = PortSession()
    session = CheckedSession(forge, port)
    period_start = min(w["start"] for w in windows.values()) - 2 * 86400
    period_end = end_ts + 86400
    grid = list(range(period_start - period_start % GRID_SECONDS, period_end + GRID_SECONDS, GRID_SECONDS))
    precompute = set(grid)
    for data in rounds.values():
        precompute |= {r["updated_at"] for r in data["rounds"] if period_start <= r["updated_at"] <= period_end}
    for a in arrivals.values():
        precompute |= {x["unix"] for x in a["arrivals"]}
    session.states(precompute)
    intervals = open_intervals(session, period_start, period_end)
    port_intervals = [iv for iv in port.open_intervals() if iv[1] > period_start and iv[0] <= period_end]
    if [tuple(iv) for iv in intervals] != port_intervals:
        raise AssertionError(f"forge intervals {intervals} differ from the port's {port_intervals}")
    grid_states = session.states(grid)
    agreed, runs = len(session.checked), forge.forge_runs
    say(f"session: {len(intervals)} open intervals, {agreed} instants agreed, {runs} forge runs")

    book = QuoteBook(archive)
    fetcher = QuoteFetcher(index, book, progress=say)
    try:
        planner = Planner(
            session=session,
            book=book,
            fetcher=fetcher,
            stock={t.symbol: Rounds(rounds[t.symbol]["rounds"]) for t in TICKERS},
            usdg=Rounds(rounds["USDG"]["rounds"]),
            events={t.symbol: TokenEvents(events["events"], t.symbol) for t in TICKERS},
            open_intervals=intervals,
            grid_open={g: s.open for g, s in grid_states.items()},
            end_ts=end_ts,
            progress=say,
        )
        payments = []
        for t in TICKERS:
            listed = arrivals[t.symbol]["arrivals"]
            if args.limit_arrivals:
                listed = listed[: args.limit_arrivals]
            payments += planner.payments(t.symbol, listed, windows[t.symbol]["start"])
        planner.walk(payments)
        planner.add_margins(payments)
        extensions = load_extensions(public.cache, args.extend)
        if extensions:
            need: dict[int, set[str]] = {}
            for symbol, instants in extensions.items():
                for instant in instants:
                    need.setdefault(instant, set()).add(symbol)
            say(f"extensions: {len(need)} instants")
            fetcher.ensure(need)
    finally:
        fetcher.close()

    for t in TICKERS:
        for a in arrivals[t.symbol]["arrivals"]:
            a["block"] = index.exact.get(a["unix"])

    write_outputs(
        args.data_dir,
        index,
        pools,
        windows,
        arrivals,
        rounds,
        events,
        intervals,
        session,
        forge,
        port,
        book,
        fetcher,
        payments,
        checks,
        end_ts,
    )
    unresolved = [{"ticker": p.symbol, "i": p.index, "reason": p.unresolved} for p in payments if p.unresolved]
    keep_headers = {b for b, _ in index.anchors() if b % COARSE_SPACING == 0}
    keep_headers |= {END_BLOCK, END_BLOCK + UPPER_SENTINEL}
    keep_headers |= {b for block in index.exact.values() for b in (block, block + 1)}
    keep_headers |= {p["creation_block"] for p in pools} | {e["block"] for e in events["events"]}
    summary = {
        "payments_planned": len(payments),
        "unresolved_payments": unresolved,
        "instants_mapped": len(index.exact),
        "quote_blocks": len(book.keys()),
        "quote_reverts": checks["quote_reverts"]["count"],
        "block_lookup_requests": index.lookup_requests,
        "forge_runs": forge.forge_runs,
        "session_instants_compared": len(session.checked),
    }
    return summary, keep_headers


def write_outputs(
    out,
    index,
    pools,
    windows,
    arrivals,
    rounds,
    events,
    intervals,
    session,
    forge,
    port,
    book,
    fetcher,
    payments,
    checks,
    end_ts,
) -> None:
    write_json(out / "pools.json", {"source": "UniswapV3Factory PoolCreated logs, public RPC", "pools": pools})
    write_json(out / "windows.json", {"windows": windows})
    write_json(out / "arrivals.json", {"tickers": arrivals})
    for t in TICKERS:
        write_json(out / "rounds" / f"{t.symbol}.json", {"ticker": t.symbol, **rounds[t.symbol]})
    write_json(out / "usdg_rounds.json", {"ticker": "USDG/USD", **rounds["USDG"]})
    write_json(out / "events.json", events)

    exact = []
    for instant in sorted(index.exact):
        block, block_ts, next_ts = index.proof(instant)
        exact.append([instant, block, block_ts, next_ts])
    edges = (END_BLOCK, END_BLOCK + UPPER_SENTINEL)
    coarse = [[b, ts] for b, ts in index.anchors() if b % COARSE_SPACING == 0 or b in edges]
    write_json(
        out / "blocks.json",
        {
            "rule": "block = the last block with timestamp <= instant; "
            "proven by timestamp(block) <= instant < timestamp(block + 1)",
            "end_block": END_BLOCK,
            "end_ts": end_ts,
            "coarse_spacing": COARSE_SPACING,
            "index_columns": ["block", "timestamp"],
            "index": coarse,
            "exact_columns": ["instant", "block", "block_timestamp", "next_block_timestamp"],
            "exact": exact,
        },
    )

    for t in TICKERS:
        rows = []
        for symbol, block in book.keys():
            if symbol != t.symbol:
                continue
            quotes = book.quotes(symbol, block)
            rows.append(
                {
                    "block": block,
                    "block_ts": index.timestamp(block),
                    "instants": sorted(fetcher.instants_by_key.get((symbol, block), ())),
                    "quotes": [
                        {"pool": pool.address, "fee": pool.fee, "usdg_in": size, **quotes[(pool.address, size)]}
                        for pool in t.pools
                        for size in SIZES_USDG
                    ],
                }
            )
        write_jsonl(out / "quotes" / f"{t.symbol}.jsonl", rows)

    write_json(
        out / "sessions.json",
        {
            "session_type": "ALL_DAY for SPY, QQQ, NVDA and AAPL",
            "answered_by": "forge: SessionCalendar via scripts/hp2/SessionOracle.s.sol",
            "checked_against": "python port: scripts/calendar_vectors.py",
            "forge_sources_sha256": forge.source_hashes,
            "port_sha256": port.source_sha256,
            "instants_compared": len(session.checked),
            "disagreements": 0,
            "open_intervals": [[o, c, iso(o), iso(c) if c else None] for o, c in intervals],
        },
    )
    coverage = {}
    for p in payments:
        coverage.setdefault(p.symbol, []).append(
            {"i": p.index, "arrival_unix": p.start, "instants": p.instants(), "unresolved": p.unresolved}
        )
    write_json(
        out / "coverage.json",
        {
            "rule": "per payment, the instants whose quotes were fetched: the walk to the stopping rule in "
            "scripts/hp2/planner.py plus every grid point and round instant within "
            f"{BOUNDARY_MARGIN} s of a session boundary the walk came near",
            "tickers": coverage,
        },
    )
    reverts = [
        {"ticker": symbol, "block": block, "pool": pool, "usdg_in": size, "error": q["error"]}
        for symbol, block in book.keys()
        for (pool, size), q in sorted(book.quotes(symbol, block).items())
        if not q["ok"]
    ]
    checks["quote_reverts"] = {"count": len(reverts), "reverts": reverts}
    write_json(out / "checks.json", checks)


if __name__ == "__main__":
    sys.exit(main())
