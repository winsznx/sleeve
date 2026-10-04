#!/usr/bin/env python3
"""HP1 live campaign tooling (docs/EVAL_CAMPAIGN.md), standard library only, around cast and the verifier CLI.

Usage, from the repo root:
    python3 scripts/hp1/campaign.py pay <account> <usdg> [--wait]
        one USDG payment from TEST_PAYER to a Sleeve account, logged to results/hp1/payments.jsonl with the payer's
        and the account's balance deltas read at the payment's block, and whether the market was open then; --wait
        also waits for the receipt the keeper writes when it splits the payment
    python3 scripts/hp1/campaign.py log <tx hash>
        log a payment someone else sent (any payer), read back the same way
    python3 scripts/hp1/campaign.py collect [account ...]
        every Sleeve receipt of the logged accounts and any named here, each run through `sleeve verify --json` on the
        public RPC into results/hp1/verify/receipt-<id>.json, then results/hp1/summary.json and results/hp1/RECEIPTS.md

TEST_PAYER's key stays in ~/.sleeve-keys/test_payer.key and reaches cast only as its --private-key argument. Success is read
back from chain state: a payment counts only when the balances moved by its amount (build contract rule 4).
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results" / "hp1"
PAYMENTS = RESULTS / "payments.jsonl"
VERIFY_DIR = RESULTS / "verify"
KEYS = Path.home() / ".sleeve-keys"

RPC = os.environ.get("HP1_RPC", "https://rpc.mainnet.chain.robinhood.com")
EXPLORER = "https://robinhoodchain.blockscout.com"
SITE = "https://trysleeve.xyz"
USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
MODULE = "0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9"
CALENDAR = "0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D"
# The first block of the deploy (docs/DEPLOYMENTS.md); no receipt can be older.
DEPLOY_BLOCK = 79_338_287
# keccak256("ReceiptWritten(uint256,address,uint8,(...))"), from `forge inspect SleeveModule events`.
RECEIPT_WRITTEN = "0x92c06202a7c8fdbc4910f06a901a42b58190a5da0e13d33dd48a0c7c375535a4"
TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
# Session type of the four launch tickers in TokenSource (ALL_DAY, docs/DEPLOYMENTS.md).
SESSION_TYPE = 1

STATUS = ["FILLED", "QUEUED", "SETTLED", "REFUSED_TICKER", "REFUSED_ACCOUNT", "RELEASED", "PART_SOLD", "SOLD", "RECONCILED"]
REASON = ["NONE", "PAUSED", "ORACLE_PAUSED", "SESSION", "MULTIPLIER", "STALE", "DEPEG", "CLIP", "PREMIUM"]
TRIGGER = ["KEEPER", "OWNER", "PAYLINK", "PUBLIC"]


class CampaignError(Exception):
    pass


def cast(*args: str, secret: str | None = None, attempts: int = 4) -> str:
    """One cast call on the campaign RPC, retried with backoff: the public RPC challenges bursts. A secret goes to cast
    as its --private-key argument, cast 1.7 reading no environment variable for it, and never into an error."""
    command = ["cast", *args, "--rpc-url", RPC, *(["--private-key", secret] if secret is not None else [])]
    for attempt in range(attempts):
        done = subprocess.run(command, capture_output=True, text=True)
        if done.returncode == 0:
            return done.stdout.strip()
        if attempt == attempts - 1:
            detail = done.stderr.strip()[:300]
            if secret is not None:
                detail = detail.replace(secret, "[key]")
            raise CampaignError(f"cast {args[0]} failed: {detail}")
        time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def checksum(address: str) -> str:
    done = subprocess.run(["cast", "to-check-sum-address", address], capture_output=True, text=True)
    if done.returncode != 0:
        raise CampaignError(f"{address} is not an address")
    return done.stdout.strip()


def first_word(text: str) -> str:
    return text.split()[0]


def usdg_balance(address: str, block: int | str = "latest") -> int:
    return int(first_word(cast("call", USDG, "balanceOf(address)(uint256)", address, "--block", str(block))))


def is_sleeve_account(address: str) -> bool:
    return cast("call", MODULE, "isInitialized(address)(bool)", address) == "true"


def market_open_at(timestamp: int) -> tuple[bool, int]:
    out = cast("call", CALENDAR, "isOpenAt(uint256,uint8)(bool,uint8)", str(timestamp), str(SESSION_TYPE)).split()
    return out[0] == "true", int(out[1])


def block_time(block: int) -> int:
    return int(cast("block", str(block), "--field", "timestamp"))


def to_units(usdg: str) -> int:
    units = Decimal(usdg) * 10**6
    if units != units.to_integral_value() or units <= 0:
        raise CampaignError(f"{usdg} is not a positive USDG amount with at most 6 decimals")
    return int(units)


def usdg_text(units: int) -> str:
    return f"{Decimal(units) / 10**6:f}"


def append_payment(record: dict) -> None:
    RESULTS.mkdir(parents=True, exist_ok=True)
    with PAYMENTS.open("a") as out:
        out.write(json.dumps(record) + "\n")


def read_payments() -> list[dict]:
    if not PAYMENTS.exists():
        return []
    return [json.loads(line) for line in PAYMENTS.read_text().splitlines() if line.strip()]


def payment_record(tx_hash: str) -> dict:
    """A USDG payment read back from its transaction: one Transfer into a Sleeve account, with both balance deltas."""
    receipt = json.loads(cast("receipt", tx_hash, "--json"))
    if int(receipt["status"], 16) != 1:
        raise CampaignError(f"{tx_hash} reverted")
    block = int(receipt["blockNumber"], 16)
    transfers = [
        entry
        for entry in receipt["logs"]
        if entry["address"].lower() == USDG.lower() and entry["topics"][0].lower() == TRANSFER
    ]
    if len(transfers) != 1:
        raise CampaignError(f"{tx_hash} has {len(transfers)} USDG transfers, expected one")
    transfer = transfers[0]
    payer = "0x" + transfer["topics"][1][-40:]
    account = "0x" + transfer["topics"][2][-40:]
    amount = int(transfer["data"], 16)
    payer = checksum(payer)
    account = checksum(account)
    if not is_sleeve_account(account):
        raise CampaignError(f"{account} is not a Sleeve account")
    payer_delta = usdg_balance(payer, block) - usdg_balance(payer, block - 1)
    account_before = usdg_balance(account, block - 1)
    account_after = usdg_balance(account, block)
    if payer_delta != -amount:
        raise CampaignError(f"the payer's balance moved {payer_delta}, not -{amount}")
    timestamp = block_time(block)
    open_now, session_reason = market_open_at(timestamp)
    return {
        "txHash": tx_hash,
        "block": block,
        "timestamp": timestamp,
        "time": datetime.fromtimestamp(timestamp, timezone.utc).isoformat().replace("+00:00", "Z"),
        "payer": payer,
        "account": account,
        "amount": str(amount),
        "payerDelta": str(payer_delta),
        "accountDelta": str(account_after - account_before),
        "marketOpen": open_now,
        "sessionReason": session_reason,
    }


def pay(account: str, usdg: str, wait: bool = False) -> None:
    amount = to_units(usdg)
    payer = (KEYS / "test_payer.addr").read_text().strip()
    account = checksum(account)
    if not is_sleeve_account(account):
        raise CampaignError(f"{account} is not a Sleeve account, so nothing is sent")
    if usdg_balance(payer) < amount:
        raise CampaignError(f"TEST_PAYER holds less than {usdg} USDG")
    key = (KEYS / "test_payer.key").read_text().strip()
    # One attempt: a retried send could pay twice.
    sent = json.loads(cast("send", USDG, "transfer(address,uint256)(bool)", account, str(amount), "--json", secret=key, attempts=1))
    tx_hash = sent["transactionHash"]
    record = payment_record(tx_hash)
    if record["account"] != account or int(record["amount"]) != amount:
        raise CampaignError(f"{tx_hash} did not move {usdg} USDG to {account}")
    append_payment(record)
    print(f"paid {usdg} USDG to {account} in {tx_hash} at block {record['block']}, market open: {record['marketOpen']}")
    if wait:
        for entry in wait_for_receipts(account, record["block"]):
            status = STATUS[int(entry["topics"][3], 16)]
            print(f"  receipt {int(entry['topics'][1], 16)} {status} in {entry['transactionHash']} at block {int(entry['blockNumber'], 16)}")


def log_payment(tx_hash: str) -> None:
    if any(entry["txHash"].lower() == tx_hash.lower() for entry in read_payments()):
        print(f"{tx_hash} is already logged")
        return
    record = payment_record(tx_hash)
    append_payment(record)
    print(f"logged {usdg_text(int(record['amount']))} USDG from {record['payer']} to {record['account']}")


def receipt_logs(account: str, from_block: int = DEPLOY_BLOCK) -> list[dict]:
    topic = "0x" + account.lower().removeprefix("0x").rjust(64, "0")
    params = [{"address": MODULE, "fromBlock": hex(from_block), "toBlock": "latest", "topics": [RECEIPT_WRITTEN, None, topic]}]
    return json.loads(cast("rpc", "eth_getLogs", json.dumps(params), "--raw"))


def wait_for_receipts(account: str, from_block: int, timeout: int = 300) -> list[dict]:
    """The receipts the account gets at or after a block, polled every 5 seconds: the keeper's split of a payment."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = receipt_logs(account, from_block)
        if found:
            return found
        time.sleep(5)
    raise CampaignError(f"no receipt for {account} within {timeout} seconds of block {from_block}")


def verify(receipt_id: int) -> dict:
    VERIFY_DIR.mkdir(parents=True, exist_ok=True)
    out = VERIFY_DIR / f"receipt-{receipt_id}.json"
    done = subprocess.run(
        ["node", str(ROOT / "packages/verifier/bin/sleeve.js"), "verify", str(receipt_id), "--json", "--from-block", str(DEPLOY_BLOCK)],
        capture_output=True,
        text=True,
    )
    if done.returncode not in (0, 1):
        raise CampaignError(f"the verifier could not check receipt {receipt_id} (exit {done.returncode}): {done.stderr.strip()[:200]}")
    out.write_text(done.stdout)
    report = json.loads(done.stdout)
    return {"exit": done.returncode, "verdict": report.get("verdict"), "mismatches": report.get("mismatches"), "report": report}


def collect(extra: list[str]) -> None:
    payments = read_payments()
    accounts = sorted({entry["account"] for entry in payments} | {checksum(a) for a in extra})
    receipts = []
    for account in accounts:
        for entry in receipt_logs(account):
            receipt_id = int(entry["topics"][1], 16)
            status = STATUS[int(entry["topics"][3], 16)]
            checked = verify(receipt_id)
            body = checked["report"].get("receipt") or {}
            receipts.append(
                {
                    "id": receipt_id,
                    "account": account,
                    "status": status,
                    "reason": REASON[int(body["reason"])] if str(body.get("reason", "")).isdigit() else body.get("reason"),
                    "trigger": TRIGGER[int(body["trigger"])] if str(body.get("trigger", "")).isdigit() else body.get("trigger"),
                    "usdgIn": body.get("usdgIn"),
                    "txHash": entry["transactionHash"],
                    "block": int(entry["blockNumber"], 16),
                    "verifierExit": checked["exit"],
                    "verdict": checked["verdict"],
                    "mismatches": checked["mismatches"],
                }
            )
            print(f"receipt {receipt_id} {status} for {account}: verifier exit {checked['exit']}")
    receipts.sort(key=lambda r: r["id"])
    split_seconds = match_splits(payments, receipts)
    by_status: dict[str, int] = {}
    for receipt in receipts:
        by_status[receipt["status"]] = by_status.get(receipt["status"], 0) + 1
    summary = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "rpc": RPC,
        "payments": len(payments),
        "paymentUsdg": usdg_text(sum(int(p["amount"]) for p in payments)),
        "distinctPayerAddresses": len({p["payer"] for p in payments}),
        "offHoursPayments": sum(1 for p in payments if not p["marketOpen"]),
        "accounts": accounts,
        "receipts": len(receipts),
        "receiptsByStatus": by_status,
        "receiptsVerified": sum(1 for r in receipts if r["verifierExit"] == 0),
        "splitSeconds": summarize(split_seconds),
        "receiptList": receipts,
    }
    RESULTS.mkdir(parents=True, exist_ok=True)
    (RESULTS / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    write_markdown(summary, payments)
    print(json.dumps({k: v for k, v in summary.items() if k not in ("receiptList", "accounts")}, indent=2))


def match_splits(payments: list[dict], receipts: list[dict]) -> list[int]:
    """Seconds from each payment to the first split receipt of its account at or after its block, each receipt used
    once. Sets splitReceipt and splitSeconds on the payment."""
    taken: set[int] = set()
    seconds = []
    times: dict[int, int] = {}
    for payment in sorted(payments, key=lambda p: p["block"]):
        candidates = [
            r for r in receipts
            if r["account"] == payment["account"] and r["block"] >= payment["block"] and r["id"] not in taken
            and r["status"] in ("FILLED", "QUEUED", "REFUSED_TICKER", "REFUSED_ACCOUNT")
        ]
        if not candidates:
            payment["splitReceipt"] = None
            continue
        split = min(candidates, key=lambda r: r["id"])
        taken.add(split["id"])
        if split["block"] not in times:
            times[split["block"]] = block_time(split["block"])
        payment["splitReceipt"] = split["id"]
        payment["splitSeconds"] = times[split["block"]] - payment["timestamp"]
        seconds.append(payment["splitSeconds"])
    return seconds


def summarize(values: list[int]) -> dict | None:
    if not values:
        return None
    ordered = sorted(values)
    return {"count": len(ordered), "min": ordered[0], "median": ordered[len(ordered) // 2], "max": ordered[-1]}


def write_markdown(summary: dict, payments: list[dict]) -> None:
    lines = [
        "# HP1 live payments",
        "",
        f"Generated by `python3 scripts/hp1/campaign.py collect` at {summary['generatedAt']}, reading {summary['rpc']}.",
        "",
        f"- Payments: {summary['payments']}, {summary['paymentUsdg']} USDG in all, from {summary['distinctPayerAddresses']} payer "
        f"address{'' if summary['distinctPayerAddresses'] == 1 else 'es'}.",
        f"- Off-hours payments: {summary['offHoursPayments']}.",
        *(
            [f"- Seconds from a payment to its split: median {summary['splitSeconds']['median']}, "
             f"from {summary['splitSeconds']['min']} to {summary['splitSeconds']['max']} over {summary['splitSeconds']['count']} payments."]
            if summary["splitSeconds"] else []
        ),
        f"- Sleeve accounts: {len(summary['accounts'])}.",
        f"- Receipts: {summary['receipts']} ({', '.join(f'{k} {v}' for k, v in sorted(summary['receiptsByStatus'].items()))}), "
        f"{summary['receiptsVerified']} verified with no mismatch on the public RPC.",
        "",
        "## Payments",
        "",
        "| Time (UTC) | Payer | Account | USDG | Market | Transaction | Split |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for p in payments:
        market = "open" if p["marketOpen"] else f"closed (reason {p['sessionReason']})"
        split = "none yet" if p.get("splitReceipt") is None else f"receipt {p['splitReceipt']}, {p['splitSeconds']} s"
        lines.append(
            f"| {p['time']} | `{p['payer']}` | `{p['account']}` | {usdg_text(int(p['amount']))} | {market} | "
            f"[{p['txHash'][:10]}]({EXPLORER}/tx/{p['txHash']}) | {split} |"
        )
    lines += [
        "",
        "## Receipts",
        "",
        "| Id | Status | Reason | Trigger | Account | Verifier | Transaction |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for r in summary["receiptList"]:
        verified = "match" if r["verifierExit"] == 0 else f"{r['mismatches']} mismatches"
        lines.append(
            f"| [{r['id']}]({SITE}/receipts/{r['id']}) | {r['status']} | {r['reason']} | {r['trigger']} | `{r['account']}` | "
            f"[{verified}]({SITE}/verify/{r['id']}) | [{r['txHash'][:10]}]({EXPLORER}/tx/{r['txHash']}) |"
        )
    (RESULTS / "RECEIPTS.md").write_text("\n".join(lines) + "\n")


def main(argv: list[str]) -> int:
    try:
        if len(argv) in (3, 4) and argv[0] == "pay" and argv[3:] in ([], ["--wait"]):
            pay(argv[1], argv[2], wait=argv[3:] == ["--wait"])
        elif len(argv) == 2 and argv[0] == "log":
            log_payment(argv[1])
        elif argv and argv[0] == "collect":
            collect(argv[1:])
        else:
            print(__doc__)
            return 64
    except CampaignError as error:
        print(f"campaign: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
