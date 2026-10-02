#!/usr/bin/env python3
"""HP2 replay: the arrival, guarded and calendar-only policies of docs/HP2_PROTOCOL.md on results/hp2/data, offline.

Usage, from the repo root, with PY the virtualenv's python (scripts/hp2/.venv/bin/python):
    PY scripts/hp2/run.py
        evaluate both payment sizes and write results/hp2/rows_<size>.csv, results/hp2/evaluations_<size>.csv,
        results/hp2/summary.json and docs/HP2_RESULTS.md
    PY scripts/hp2/run.py --report-only
        render docs/HP2_RESULTS.md again from results/hp2/summary.json
    PY scripts/hp2/run.py --data-dir DIR --out-dir DIR --report PATH
        the same on another data set, such as the rerun on the keeper's provider
    PY scripts/hp2/run.py --provider-rerun DIR
        also compare every row with the rows of the provider rerun in DIR and report each difference

No network. The session test is the compiled SessionCalendar through forge, from answers cached by source hash, and
the Python port must agree on every instant; without forge, or on any disagreement, the port answers and the report
stays provisional. The report also stays provisional until a provider rerun is compared.
"""

import argparse
import csv
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from hp2 import data  # noqa: E402
from hp2.constants import (  # noqa: E402
    CHAIN_ID,
    DATA_DIR,
    END_BLOCK,
    FEED_MAX_AGE,
    GRID_SECONDS,
    MULTIPLIER_WINDOW,
    PREMIUM_CAP_BPS,
    REPO,
    RESULTS,
    SEED,
    SIZES_USDG,
    TICKERS,
    USDG_DECIMALS,
    USDG_MAX_AGE,
    USDG_TOLERANCE_BPS,
)
from hp2.engine import report  # noqa: E402
from hp2.engine.calendar import ModuleCalendar, module_calendar  # noqa: E402
from hp2.engine.market import Feed, TokenState, at_price_limit  # noqa: E402
from hp2.engine.policies import POLICIES, Evaluation, Payment, TickerReplay, open_grid  # noqa: E402
from hp2.engine.premium import premium_exact  # noqa: E402
from hp2.engine.readings import READINGS  # noqa: E402
from hp2.engine.results import (  # noqa: E402
    EVALUATION_COLUMNS,
    OUTCOME_COLUMNS,
    Outcome,
    Table,
    evaluation_row,
    figures,
    number,
    outcome_row,
    price,
)
from hp2.timefmt import iso  # noqa: E402

RESAMPLES = 10_000
BOOTSTRAP_SEED = SEED + 100
PROTOCOL = REPO / "docs" / "HP2_PROTOCOL.md"
REPORT = REPO / "docs" / "HP2_RESULTS.md"
COMPARED_FIELDS = (
    "fill_unix",
    "block",
    "pool",
    "amount_out",
    "primary_round_id",
    "primary_premium_bps",
    "secondary_round_id",
    "secondary_premium_bps",
)
STARTED = time.time()


def say(message: str) -> None:
    print(f"[{time.time() - STARTED:7.1f}s] {message}", file=sys.stderr, flush=True)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR, help="the fetched data (default results/hp2/data)")
    parser.add_argument("--out-dir", type=Path, default=RESULTS, help="where the CSV files and summary.json go")
    parser.add_argument("--report", type=Path, default=REPORT, help="the markdown report to write")
    parser.add_argument("--report-only", action="store_true", help="render the report from summary.json only")
    parser.add_argument("--provider-rerun", type=Path, help="out-dir of the same replay on the other provider's data")
    parser.add_argument("--resamples", type=int, default=RESAMPLES, help=argparse.SUPPRESS)
    return parser.parse_args()


@dataclass
class Inputs:
    root: Path
    windows: dict
    arrivals: dict[str, list[dict]]
    stock: dict[str, dict]
    usdg: dict
    events: list[dict]
    sessions: dict
    checks: dict
    fetch_log: dict
    blocks: data.BlockMap
    quotes: dict[str, data.Quotes]
    end_ts: int


def read_json(root: Path, name: str):
    return json.loads((root / name).read_text())


def load(root: Path) -> Inputs:
    blocks = data.BlockMap(root)
    end = read_json(root, "blocks.json")
    if end["end_block"] != END_BLOCK:
        raise ValueError(f"{root} ends at block {end['end_block']}, the protocol pins {END_BLOCK}")
    return Inputs(
        root=root,
        windows=data.windows(root),
        arrivals={t.symbol: data.arrivals(t.symbol, root) for t in TICKERS},
        stock={t.symbol: data.rounds(t.symbol, root) for t in TICKERS},
        usdg=data.usdg_rounds(root),
        events=data.events(root),
        sessions=data.sessions(root),
        checks=read_json(root, "checks.json"),
        fetch_log=read_json(root, "fetch_log.json"),
        blocks=blocks,
        quotes={t.symbol: data.Quotes(t.symbol, root, blocks) for t in TICKERS},
        end_ts=end["end_ts"],
    )


def input_files(root: Path) -> list[Path]:
    names = ["pools.json", "windows.json", "arrivals.json", "usdg_rounds.json", "events.json", "blocks.json"]
    names += ["sessions.json", "checks.json", "fetch_log.json"]
    names += [f"rounds/{t.symbol}.json" for t in TICKERS] + [f"quotes/{t.symbol}.jsonl" for t in TICKERS]
    return [root / name for name in names]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def session_instants(inputs: Inputs, first: int) -> set[int]:
    """Every instant the replay asks the session test about up front: the grid, every round and every arrival."""
    instants = set(range(first, inputs.end_ts + 1, GRID_SECONDS))
    for doc in [*inputs.stock.values(), inputs.usdg]:
        instants |= {r["updated_at"] for r in doc["rounds"] if first <= r["updated_at"] <= inputs.end_ts}
    for arrivals in inputs.arrivals.values():
        instants |= {a["unix"] for a in arrivals}
    return instants


@dataclass
class Replay:
    calendar: ModuleCalendar
    feeds: dict[str, Feed]
    usdg: Feed
    tokens: dict[str, TokenState]
    payments: dict[str, list[Payment]]
    outcomes: dict[int, list[Outcome]]
    trails: dict[int, list[tuple[Payment, list[Evaluation], dict]]]
    arrival_open: dict[tuple[str, int], bool]
    first: int


def replay(inputs: Inputs) -> Replay:
    first = min(w["start"] for w in inputs.windows.values())
    first -= first % GRID_SECONDS
    instants = session_instants(inputs, first)
    say(f"session test on {len(instants)} instants")
    calendar = module_calendar(instants)
    say(f"session test: {calendar.oracle}")
    grid = open_grid(calendar, first, inputs.end_ts)
    feeds = {t.symbol: Feed.from_document(t.symbol, inputs.stock[t.symbol]) for t in TICKERS}
    usdg = Feed.from_document("USDG/USD", inputs.usdg)
    tokens = {t.symbol: TokenState(t.symbol, inputs.events) for t in TICKERS}
    payments = {t.symbol: [Payment.from_arrival(t.symbol, a) for a in inputs.arrivals[t.symbol]] for t in TICKERS}
    arrival_open = {(p.ticker, p.i): calendar.session_state(p.unix)[0] for ps in payments.values() for p in ps}
    replays = {
        t.symbol: TickerReplay(
            t.symbol,
            calendar=calendar,
            feed=feeds[t.symbol],
            usdg=usdg,
            token=tokens[t.symbol],
            quotes=inputs.quotes[t.symbol],
            grid=grid,
            last_instant=inputs.end_ts,
        )
        for t in TICKERS
    }
    outcomes: dict[int, list[Outcome]] = {}
    trails: dict = {}
    for size in SIZES_USDG:
        outcomes[size], trails[size] = [], []
        for t in TICKERS:
            for p in payments[t.symbol]:
                try:
                    fills, trail = replays[t.symbol].replay(p, size)
                except data.MissingQuote as exc:
                    exc.add_note(f"while replaying {t.symbol} payment {p.i} at {size} USDG; add instants with --extend")
                    raise
                outcomes[size] += [price(p, size, fills[policy], calendar, feeds[t.symbol]) for policy in POLICIES]
                trails[size].append((p, trail, fills))
            say(f"{size} USDG, {t.symbol}: {len(payments[t.symbol])} payments replayed")
    return Replay(calendar, feeds, usdg, tokens, payments, outcomes, trails, arrival_open, first)


def check_replay(inputs: Inputs, r: Replay) -> dict:
    """Cross-checks that must hold for the replay to mean what it says. Any failure stops the run."""
    arrivals = {(t, a["i"]): a for t, listed in inputs.arrivals.items() for a in listed}
    evaluated = 0
    for trails in r.trails.values():
        for payment, trail, _ in trails:
            if trail[0].block != arrivals[(payment.ticker, payment.i)]["block"]:
                raise AssertionError(f"{payment.ticker} payment {payment.i}: arrival block differs from arrivals.json")
            for e in trail:
                for feed in (r.feeds[payment.ticker], r.usdg):
                    if feed.in_force(e.instant) != feed.in_force_at_block(e.block):
                        raise AssertionError(f"{feed.name} at {e.instant}: round in force by time and by block differ")
                evaluated += 1
    opening_rounds = []
    for symbol, feed in r.feeds.items():
        for rd in feed.rounds:
            if not r.first <= rd.updated_at <= inputs.end_ts:
                continue
            is_open, opened_at = r.calendar.session_state(rd.updated_at)
            if is_open and rd.updated_at == opened_at:
                opening_rounds.append({"ticker": symbol, "round_id": rd.round_id, "updated_at": rd.updated_at})
    for opens, closes, *_ in inputs.sessions["open_intervals"]:
        if not (r.first <= opens and closes is not None and closes <= inputs.end_ts):
            continue
        if r.calendar.session_state(opens) != (True, opens) or r.calendar.session_state(closes)[0]:
            raise AssertionError(f"the session test disagrees with the fetch's open interval {opens} to {closes}")
    first_evaluated = min(e.instant for trails in r.trails.values() for _, trail, _ in trails for e in trail)
    last_flags = [s.last_flag_event() for s in r.tokens.values() if s.last_flag_event() is not None]
    last_flag = max(last_flags) if last_flags else None
    if last_flag is not None and last_flag >= first_evaluated:
        raise AssertionError("a pause event falls inside the evaluated span; check the pause reading in market.py")
    calendar = r.calendar.describe()
    return {
        "evaluations_checked_round_in_force_by_block": evaluated,
        "open_intervals_match_the_fetch": True,
        "same_calendar_build_as_the_fetch": calendar.get("forge_sources_sha256")
        == inputs.sessions["forge_sources_sha256"],
        "rounds_updated_at_an_opening_instant": opening_rounds,
        "first_evaluated_instant_iso": iso(first_evaluated),
        "last_pause_event_iso": iso(last_flag) if last_flag is not None else None,
    }


def data_notes(inputs: Inputs, r: Replay) -> dict:
    outages, partial = [], []
    for t in TICKERS:
        rows = sorted(inputs.quotes[t.symbol].by_block.values(), key=lambda row: row["block"])
        for pool in t.pools:
            outcomes = [
                (row["block_ts"], all(q["ok"] for q in row["quotes"] if q["pool"] == pool.address)) for row in rows
            ]
            failed = [ts for ts, ok in outcomes if not ok]
            if failed:
                first, last = failed[0], failed[-1]
                worked_inside = [ts for ts, ok in outcomes if ok and first < ts < last]
                before = [ts for ts, ok in outcomes if ok and ts < first]
                after = next((row for row in rows if row["block_ts"] > last and _pool_ok(row, pool.address)), None)
                outages.append(
                    {
                        "ticker": t.symbol,
                        "pool": pool.address,
                        "fee": pool.fee,
                        "quoted_blocks_reverted": len(failed),
                        "first_revert_iso": iso(first),
                        "last_revert_iso": iso(last),
                        "working_quotes_between": len(worked_inside),
                        "last_working_before_iso": iso(before[-1]) if before else None,
                        "first_working_after_iso": iso(after["block_ts"]) if after else None,
                        "first_working_after_premium_bps": _pool_premiums(after, pool.address, r.feeds[t.symbol]),
                    }
                )
            for size in SIZES_USDG:
                hits = [
                    row["block_ts"]
                    for row in rows
                    for q in row["quotes"]
                    if q["pool"] == pool.address and q["usdg_in"] == size and at_price_limit(q)
                ]
                if hits:
                    partial.append(
                        {
                            "ticker": t.symbol,
                            "pool": pool.address,
                            "fee": pool.fee,
                            "usdg_in": size,
                            "quotes_at_price_limit": len(hits),
                            "first_iso": iso(hits[0]),
                            "last_iso": iso(hits[-1]),
                        }
                    )
    reverts: dict[str, int] = {}
    for revert in inputs.checks["quote_reverts"]["reverts"]:
        reverts[revert["ticker"]] = reverts.get(revert["ticker"], 0) + 1
    multiplier_changes = [
        {
            "ticker": symbol,
            "scheduled_iso": iso(change.scheduled_at),
            "effective_iso": iso(change.effective_at),
            "old": str(change.old),
            "new": str(change.new),
        }
        for symbol, state in r.tokens.items()
        for change in state.changes
    ]
    dropped = {
        name: {
            "dropped": doc["dropped_count"],
            "last_dropped_iso": iso(doc["dropped_last_updated_at"]) if doc["dropped_last_updated_at"] else None,
        }
        for name, doc in [*inputs.stock.items(), ("USDG/USD", inputs.usdg)]
    }
    return {
        "pool_outages": outages,
        "quotes_at_price_limit": partial,
        "reverted_quote_calls_in_data": {"total": inputs.checks["quote_reverts"]["count"], "by_ticker": reverts},
        "multiplier_changes": multiplier_changes,
        "dropped_rounds": dropped,
        "dropped_rounds_all_before_the_windows": all(
            r["updated_at"] < min(w["start"] for w in inputs.windows.values())
            for doc in [*inputs.stock.values(), inputs.usdg]
            for r in doc["rounds"]
            if r["dropped"]
        ),
    }


def _pool_ok(row: dict, pool: str) -> bool:
    return all(q["ok"] for q in row["quotes"] if q["pool"] == pool)


def _pool_premiums(row: dict | None, pool: str, feed: Feed) -> dict | None:
    """The pool's premium over the round in force at the row's block per payment size, or None for a quote that ran
    to the price limit and so prices only part of the payment."""
    if row is None:
        return None
    answer = feed.in_force(row["block_ts"]).answer
    return {
        str(q["usdg_in"]): None
        if at_price_limit(q)
        else number(premium_exact(q["usdg_in"] * 10**USDG_DECIMALS, int(q["amount_out"]), answer), 2)
        for q in row["quotes"]
        if q["pool"] == pool
    }


def providers(fetch_log: dict) -> dict:
    ok = [run for run in fetch_log["runs"] if run.get("outcome") == "ok"]
    last = ok[-1]
    return {
        "profile": last["profile"],
        "archive_rpc": last["archive_rpc"],
        "public_rpc": last["public_rpc"],
        "quotes_from": "archive_rpc (QuoterV2 eth_call at each instant's block)",
        "logs_rounds_and_headers_from": "public_rpc",
        "fetch_runs": len(fetch_log["runs"]),
    }


def compare(out_rows: dict[int, list[dict]], rerun_dir: Path) -> dict:
    """Every row of this run against the provider rerun's, field by field. Differences are listed, not smoothed."""
    differences, compared = [], 0
    for size, rows in out_rows.items():
        path = rerun_dir / f"rows_{size}.csv"
        with open(path, newline="") as fh:
            theirs = {(r["ticker"], r["i"], r["policy"]): r for r in csv.DictReader(fh)}
        for row in rows:
            key = (row["ticker"], str(row["i"]), row["policy"])
            other = theirs.pop(key, None)
            if other is None:
                differences.append({"size_usdg": size, "key": list(key), "field": "row", "ours": "present"})
                continue
            compared += 1
            for field in COMPARED_FIELDS:
                if str(row[field]) != other[field]:
                    differences.append(
                        {
                            "size_usdg": size,
                            "key": list(key),
                            "field": field,
                            "ours": str(row[field]),
                            "theirs": other[field],
                        }
                    )
        for key in theirs:
            differences.append({"size_usdg": size, "key": list(key), "field": "row", "theirs": "present"})
    return {"rerun_dir": str(rerun_dir), "rows_compared": compared, "differences": differences}


def write_csv(path: Path, columns, rows) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    with open(tmp, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=columns, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text)
    tmp.replace(path)


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO))
    except ValueError:
        return str(path)


def evaluation_rows_of(r: Replay) -> dict[int, list[dict]]:
    rows: dict[int, list[dict]] = {}
    for size, trails in r.trails.items():
        rows[size] = []
        for payment, trail, fills in trails:
            for step, e in enumerate(trail):
                filled = [policy for policy in POLICIES if fills[policy].evaluation is e]
                rows[size].append(evaluation_row(size, payment, step, e, filled))
    return rows


def status_of(calendar: dict, provider: dict, comparison: dict | None) -> dict:
    """Provisional until the forge calendar answered every instant and a provider rerun was compared."""
    reasons = []
    if calendar["provisional_reason"]:
        reasons.append(calendar["provisional_reason"])
    if comparison is None:
        reasons.append(
            "The protocol repeats the run on the keeper's provider (Alchemy) once that app exists and reports any "
            f"difference. This run's quotes came from {provider['archive_rpc']} and its logs, rounds and headers "
            f"from {provider['public_rpc']}. No rerun has been compared yet."
        )
    return {"provisional": bool(reasons), "reasons": reasons}


def inputs_block(args, inputs: Inputs, r: Replay) -> dict:
    return {
        "chain_id": CHAIN_ID,
        "end_block": END_BLOCK,
        "end_block_iso": iso(inputs.end_ts),
        "seed": SEED,
        "bootstrap_seed": BOOTSTRAP_SEED,
        "resamples": args.resamples,
        "sizes_usdg": list(SIZES_USDG),
        "payments_per_ticker": {t: len(ps) for t, ps in r.payments.items()},
        "guard": {
            "premium_cap_bps": PREMIUM_CAP_BPS,
            "feed_max_age_seconds": FEED_MAX_AGE,
            "multiplier_window_seconds": MULTIPLIER_WINDOW,
            "usdg_tolerance_bps": USDG_TOLERANCE_BPS,
            "usdg_max_age_seconds": USDG_MAX_AGE,
        },
        "windows": {
            t: {"start_iso": w["start_iso"], "end_iso": w["end_iso"], "anchor_pool": w["anchor_pool"]}
            for t, w in inputs.windows.items()
        },
        "data_dir": relative(args.data_dir),
        "files_sha256": {relative(p): sha256(p) for p in input_files(args.data_dir)},
    }


def main() -> int:
    args = parse_args()
    summary_path = args.out_dir / "summary.json"
    if args.report_only:
        write_text(args.report, report.render(json.loads(summary_path.read_text())))
        say(f"wrote {args.report}")
        return 0

    inputs = load(args.data_dir)
    r = replay(inputs)
    checks = check_replay(inputs, r)
    say(f"checks passed on {checks['evaluations_checked_round_in_force_by_block']} evaluations")
    tables = {size: Table(outcomes, [t.symbol for t in TICKERS]) for size, outcomes in r.outcomes.items()}
    plain_trails = {size: [(p, trail) for p, trail, _ in trails] for size, trails in r.trails.items()}
    results = figures(tables, plain_trails, r.arrival_open, resamples=args.resamples, seed=BOOTSTRAP_SEED, progress=say)
    out_rows = {size: [outcome_row(o, r.arrival_open[o.key]) for o in os] for size, os in r.outcomes.items()}
    evaluation_rows = evaluation_rows_of(r)

    calendar = r.calendar.describe()
    provider = providers(inputs.fetch_log)
    comparison = compare(out_rows, args.provider_rerun) if args.provider_rerun else None
    outputs = {}
    for size in SIZES_USDG:
        outputs[f"rows_{size}.csv"] = len(out_rows[size])
        outputs[f"evaluations_{size}.csv"] = len(evaluation_rows[size])
    summary = {
        "title": "HP2 replay",
        "status": status_of(calendar, provider, comparison),
        "protocol": {"path": relative(PROTOCOL), "sha256": sha256(PROTOCOL)},
        **results,
        "inputs": inputs_block(args, inputs, r),
        "calendar": calendar,
        "providers": provider,
        "provider_rerun": comparison,
        "checks": checks,
        "data_notes": data_notes(inputs, r),
        "readings": [{"topic": topic, "reading": text} for topic, text in READINGS],
        "outputs": outputs,
    }

    for size in SIZES_USDG:
        write_csv(args.out_dir / f"rows_{size}.csv", OUTCOME_COLUMNS, out_rows[size])
        write_csv(args.out_dir / f"evaluations_{size}.csv", EVALUATION_COLUMNS, evaluation_rows[size])
    write_text(summary_path, json.dumps(summary, indent=1) + "\n")
    write_text(args.report, report.render(summary))
    v = summary["verdict"]
    say(
        f"verdict {v['outcome']}: mean arrival minus guarded {v['mean_difference_bps']} bps, "
        f"95% interval {v['ci95_bps']}, guarded median delay {v['guarded_median_delay_hours']} h"
    )
    say(f"wrote {summary_path}, the CSV files and {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
