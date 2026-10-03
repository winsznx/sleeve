#!/usr/bin/env python3
"""Price a Sleeve deploy at today's gas price on chain 4663.

A fork dry run measures each transaction's execution gas, but an anvil fork knows nothing of Arbitrum's L1 data
component, which Robinhood Chain adds to a transaction's gas when L1 data has a price. This script asks the live
chain's NodeInterface (0xC8, gasEstimateL1Component) for that component of each transaction's exact calldata, adds it
to the fork's gas, reads the live gas price and base fee, and prices the deploy. Run from contracts/:

    python3 script/gas_report.py \
        --broadcast <dry run's run-latest.json> \
        --record deployments/dry-run/4663-anvil-<block>.json \
        --report deployments/dry-run/4663-anvil-<block>.gas.json \
        --rpc https://rpc.mainnet.chain.robinhood.com

Two amounts come out. The cost: each transaction's gas times the live gas price, which is what the chain takes. The
reservation: each gas limit forge set in the dry run (its own estimate times 1.3) times the fee cap forge sends, twice
the base fee plus 1 wei; forge prints the sum as "Estimated amount required" and the account needs the cap of the
transaction in flight on hand. The funding line is the larger of the cost times --margin and the reservation.

Every live read is one call at a time with a pause between them, because the public RPC challenges bursts. Never
overwrites a report.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time

NODE_INTERFACE = "0x00000000000000000000000000000000000000C8"
ZERO = "0x0000000000000000000000000000000000000000"
PAUSE_SECONDS = 1.5


class ReportError(Exception):
    pass


def cast(*args: str) -> str:
    error = ""
    for attempt in range(4):
        result = subprocess.run(["cast", *args], capture_output=True, text=True)
        if result.returncode == 0:
            time.sleep(PAUSE_SECONDS)
            return result.stdout.strip()
        error = result.stderr.strip()
        time.sleep(PAUSE_SECONDS * (attempt + 2))
    raise ReportError(f"cast {args[0]} failed: {error}")


def first_number(text: str) -> int:
    return int(text.split()[0])


def hex_int(value) -> int:
    return value if isinstance(value, int) else int(value, 16)


def eth(wei: int) -> str:
    return f"{wei / 10**18:.9f}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--broadcast", required=True, help="the dry run's run-latest.json")
    parser.add_argument("--record", required=True, help="the dry run's record from record_deployment.py")
    parser.add_argument("--report", required=True, help="the report to write; must not exist")
    parser.add_argument("--rpc", required=True, help="the live chain's RPC")
    parser.add_argument("--margin", type=float, default=3.0, help="funding margin over the priced cost")
    args = parser.parse_args()

    if os.path.exists(args.report):
        raise ReportError(f"{args.report} exists. A report is never overwritten.")
    broadcast = json.load(open(args.broadcast))
    record = json.load(open(args.record))
    chain_id = first_number(cast("chain-id", "--rpc-url", args.rpc))
    if chain_id != 4663:
        raise ReportError(f"--rpc is chain {chain_id}, not 4663")

    rows = []
    for entry in broadcast["transactions"]:
        name = entry["contractName"]
        tx = entry["transaction"]
        contract = record["contracts"][name]
        if contract["txHash"] != entry["hash"]:
            raise ReportError(f"{name}: the record and the broadcast name different transactions")
        to = tx.get("to") or ZERO
        creation = "true" if entry["transactionType"] == "CREATE" else "false"
        out = cast(
            "call",
            NODE_INTERFACE,
            "gasEstimateL1Component(address,bool,bytes)(uint64,uint256,uint256)",
            to,
            creation,
            tx["input"],
            "--rpc-url",
            args.rpc,
        ).splitlines()
        l1_gas = first_number(out[0])
        rows.append(
            {
                "contract": name,
                "calldataBytes": (len(tx["input"]) - 2) // 2,
                "executionGas": contract["gasUsed"],
                "l1Gas": l1_gas,
                "totalGas": contract["gasUsed"] + l1_gas,
                "gasLimit": hex_int(tx["gas"]),
                "nodeInterfaceBaseFee": first_number(out[1]),
                "l1BaseFeeEstimate": first_number(out[2]),
            }
        )

    gas_price = first_number(cast("gas-price", "--rpc-url", args.rpc))
    base_fee = first_number(cast("base-fee", "--rpc-url", args.rpc))
    block = first_number(cast("block-number", "--rpc-url", args.rpc))
    fee_cap = 2 * base_fee + 1
    for r in rows:
        r["costWeiAtGasPrice"] = r["totalGas"] * gas_price
        r["reservedWeiAtFeeCap"] = r["gasLimit"] * fee_cap
    total_gas = sum(r["totalGas"] for r in rows)
    cost = total_gas * gas_price
    reserved = sum(r["reservedWeiAtFeeCap"] for r in rows)
    funding = max(int(cost * args.margin), reserved)
    largest = max(rows, key=lambda r: r["gasLimit"])
    report = {
        "schema": "sleeve-deploy-gas/2",
        "readAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rpc": args.rpc,
        "liveBlock": block,
        "gasPriceWei": gas_price,
        "baseFeeWei": base_fee,
        "feeCapWei": fee_cap,
        "forkBlock": record.get("fork", {}).get("block"),
        "transactions": rows,
        "totals": {
            "executionGas": sum(r["executionGas"] for r in rows),
            "l1Gas": sum(r["l1Gas"] for r in rows),
            "totalGas": total_gas,
            "costWei": cost,
            "costEth": eth(cost),
            "gasLimits": sum(r["gasLimit"] for r in rows),
            "reservedWei": reserved,
            "reservedEth": eth(reserved),
            "largestGasLimit": {"contract": largest["contract"], "gasLimit": largest["gasLimit"]},
            "largestReservationEth": eth(largest["reservedWeiAtFeeCap"]),
            "margin": args.margin,
            "fundingWei": funding,
            "fundingEth": eth(funding),
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, "x") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")

    print(f"Live block {block}, gas price {gas_price} wei, base fee {base_fee} wei, forge's fee cap {fee_cap} wei")
    print("| Contract | Calldata bytes | Execution gas (fork) | L1 gas | Total gas | Gas limit | ETH at gas price |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    for r in rows:
        print(
            f"| {r['contract']} | {r['calldataBytes']:,} | {r['executionGas']:,} | {r['l1Gas']:,} | "
            f"{r['totalGas']:,} | {r['gasLimit']:,} | {eth(r['costWeiAtGasPrice'])} |"
        )
    t = report["totals"]
    print(
        f"| Total | | {t['executionGas']:,} | {t['l1Gas']:,} | {t['totalGas']:,} | {t['gasLimits']:,} | "
        f"{t['costEth']} |"
    )
    print(f"Reserved at the fee cap: {t['reservedEth']} ETH. Funding: {t['fundingEth']} ETH. Report: {args.report}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ReportError as error:
        print(f"gas_report: {error}", file=sys.stderr)
        sys.exit(1)
