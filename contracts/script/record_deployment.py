#!/usr/bin/env python3
"""Write the Sleeve deploy record from forge's broadcast file.

Run from contracts/ after `forge script script/Deploy.s.sol --broadcast`:

    python3 script/record_deployment.py \
        --broadcast broadcast/Deploy.s.sol/4663/run-latest.json \
        --out-dir out-deploy \
        --record deployments/4663.json \
        --network robinhood-mainnet

What it checks before it writes anything, exiting non-zero on the first failure:
- the broadcast is for chain 4663 and holds exactly the seven Sleeve deployments, each with a receipt of status 1;
- every transaction's input is this checkout's creation code, libraries linked as the broadcast lists them: for the
  libraries, the CREATE2 deployer's salt followed by the creation code; for the rest, the creation code followed by
  the constructor arguments, which the record keeps encoded and decoded;
- the record file does not exist yet. A record is never overwritten.

Reads only public data: the broadcast file, the build artifacts, `git rev-parse` and `git status` for the commit the
build came from, and, through `cast`, nothing but local ABI work.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys

CHAIN_ID = 4663
CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"
# Every contract the deploy creates, with its kind, in the order the record lists them.
EXPECTED = [
    ("SleeveTrade", "library"),
    ("SleeveBuy", "library"),
    ("SleeveSell", "library"),
    ("SleeveTimelock", "contract"),
    ("SessionCalendarExtension", "contract"),
    ("TokenSource", "contract"),
    ("SleeveModule", "contract"),
]


class RecordError(Exception):
    pass


def fail(message: str) -> None:
    raise RecordError(message)


def hex_int(value) -> int:
    if isinstance(value, int):
        return value
    return int(value, 16) if str(value).startswith("0x") else int(value)


def cast(*args: str) -> str:
    result = subprocess.run(["cast", *args], capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"cast {' '.join(args[:2])} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def checksum(address: str) -> str:
    return cast("to-check-sum-address", address)


def abi_type(param: dict) -> str:
    """Canonical ABI type string of one ABI parameter, tuples spelled out."""
    kind = param["type"]
    if kind.startswith("tuple"):
        inner = ",".join(abi_type(c) for c in param["components"])
        return f"({inner}){kind[len('tuple'):]}"
    return kind


def label(param: dict, value):
    """Decoded value with tuple fields named after the ABI components."""
    kind = param["type"]
    if kind.endswith("[]"):
        element = dict(param, type=kind[:-2])
        return [label(element, v) for v in value]
    if kind == "tuple":
        return {c["name"]: label(c, v) for c, v in zip(param["components"], value)}
    if kind == "address":
        return checksum(value)
    return value


def linked_code(artifact: dict, section: str, libraries: dict[str, str]) -> str:
    """The artifact's bytecode hex (no 0x) with every library placeholder filled from `libraries`."""
    code = artifact[section]["object"]
    if not code.startswith("0x"):
        fail("artifact bytecode without 0x prefix")
    chars = list(code[2:])
    for file, names in artifact[section].get("linkReferences", {}).items():
        for name, refs in names.items():
            key = f"{file}:{name}"
            if key not in libraries:
                fail(f"artifact links {key}, which the broadcast does not list")
            address = libraries[key][2:].lower()
            for ref in refs:
                start = ref["start"] * 2
                chars[start : start + 40] = list(address)
    linked = "".join(chars)
    if any(c not in "0123456789abcdefABCDEF" for c in linked):
        fail("a library placeholder was left unfilled")
    return linked.lower()


def compiler_settings(artifact: dict) -> dict:
    metadata = artifact["metadata"]
    settings = metadata["settings"]
    return {
        "solc": metadata["compiler"]["version"],
        "optimizer": settings["optimizer"]["enabled"],
        "optimizerRuns": settings["optimizer"]["runs"],
        "evmVersion": settings["evmVersion"],
        "viaIR": settings.get("viaIR", False),
        "bytecodeHash": settings.get("metadata", {}).get("bytecodeHash", "ipfs"),
        "appendCBOR": settings.get("metadata", {}).get("appendCBOR", True),
        "libraries": settings.get("libraries", {}),
        "remappings": settings.get("remappings", []),
    }


def source_state() -> dict:
    """The commit the build came from and whether the files that go into the bytecode differ from it."""
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True)
    if head.returncode != 0:
        fail(f"git rev-parse failed: {head.stderr.strip()}")
    paths = ["src", "script", "foundry.toml", "remappings.txt", "lib"]
    status = subprocess.run(["git", "status", "--porcelain", "--", *paths], capture_output=True, text=True)
    if status.returncode != 0:
        fail(f"git status failed: {status.stderr.strip()}")
    changed = [line[3:] for line in status.stdout.splitlines() if line.strip()]
    return {"commit": head.stdout.strip(), "clean": not changed, "changed": changed}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--broadcast", required=True, help="forge's run-latest.json of Deploy.s.sol")
    parser.add_argument("--out-dir", required=True, help="the FOUNDRY_OUT the deploy's build used")
    parser.add_argument("--record", required=True, help="the record to write; must not exist")
    parser.add_argument("--network", required=True, help="robinhood-mainnet, or a label such as anvil-fork")
    parser.add_argument("--fork-rpc", help="for a fork: the upstream RPC the fork was taken from")
    parser.add_argument("--fork-block", type=int, help="for a fork: the block it was taken at")
    args = parser.parse_args()

    if os.path.exists(args.record):
        fail(f"{args.record} exists. A record is never overwritten.")
    broadcast = json.load(open(args.broadcast))
    if broadcast.get("chain") != CHAIN_ID:
        fail(f"broadcast is for chain {broadcast.get('chain')}, not {CHAIN_ID}")
    if broadcast.get("pending"):
        fail("the broadcast still lists pending transactions; finish it with --resume first")

    libraries = {}
    for entry in broadcast.get("libraries", []):
        path, name, address = entry.split(":")
        libraries[f"{path}:{name}"] = address
    receipts = {r["transactionHash"]: r for r in broadcast.get("receipts", [])}
    transactions = broadcast["transactions"]
    names = [t.get("contractName") for t in transactions]
    expected_names = [name for name, _ in EXPECTED]
    if sorted(names) != sorted(expected_names):
        fail(f"broadcast holds {names}, expected exactly {expected_names}")

    deployer = None
    contracts = {}
    settings = None
    total_gas = 0
    total_cost = 0
    by_name = {t["contractName"]: t for t in transactions}
    for name, kind in EXPECTED:
        entry = by_name[name]
        tx = entry["transaction"]
        tx_hash = entry.get("hash")
        if not tx_hash or tx_hash not in receipts:
            fail(f"{name}: no receipt for transaction {tx_hash}")
        receipt = receipts[tx_hash]
        if hex_int(receipt["status"]) != 1:
            fail(f"{name}: transaction {tx_hash} failed")
        sender = checksum(tx["from"])
        if deployer is None:
            deployer = sender
        elif sender != deployer:
            fail(f"{name}: sent by {sender}, the others by {deployer}")

        artifact_path = os.path.join(args.out_dir, f"{name}.sol", f"{name}.json")
        artifact = json.load(open(artifact_path))
        settings = settings or compiler_settings(artifact)
        if compiler_settings(artifact) != settings:
            fail(f"{name}: built with other compiler settings than the rest")
        creation = linked_code(artifact, "bytecode", libraries)
        data = tx["input"][2:].lower()
        address = checksum(entry["contractAddress"])
        source, contract = next(iter(artifact["metadata"]["settings"]["compilationTarget"].items()))
        record = {"address": address, "kind": kind, "artifact": f"{source}:{contract}"}

        if entry["transactionType"] == "CREATE2":
            if tx["to"].lower() != CREATE2_DEPLOYER:
                fail(f"{name}: CREATE2 through {tx['to']}, not the CREATE2 deployer")
            salt, init = data[:64], data[64:]
            if init != creation:
                fail(f"{name}: deployed init code differs from this checkout's build")
            expected_address = cast(
                "compute-address", CREATE2_DEPLOYER, "--salt", "0x" + salt, "--init-code", "0x" + init
            ).split()[-1]
            if checksum(expected_address) != address:
                fail(f"{name}: CREATE2 address {expected_address} differs from the broadcast's {address}")
            record.update(
                {
                    "deployMethod": "CREATE2",
                    "factory": checksum(CREATE2_DEPLOYER),
                    "salt": "0x" + salt,
                    "constructorArgs": None,
                    "constructorArgsEncoded": "0x",
                }
            )
        elif entry["transactionType"] == "CREATE":
            if not data.startswith(creation):
                fail(f"{name}: deployed creation code differs from this checkout's build")
            encoded = data[len(creation):]
            constructor = next(item for item in artifact["abi"] if item["type"] == "constructor")
            signature = "constructor(" + ",".join(abi_type(p) for p in constructor["inputs"]) + ")"
            decoded = json.loads(cast("abi-decode", "--input", "--json", signature, "0x" + encoded))
            labeled = {p["name"]: label(p, v) for p, v in zip(constructor["inputs"], decoded)}
            nonce = hex_int(tx["nonce"])
            if checksum(cast("compute-address", sender, "--nonce", str(nonce)).split()[-1]) != address:
                fail(f"{name}: CREATE address does not follow from {sender} at nonce {nonce}")
            record.update(
                {
                    "deployMethod": "CREATE",
                    "nonce": nonce,
                    "constructorSignature": signature,
                    "constructorArgs": labeled,
                    "constructorArgsEncoded": "0x" + encoded,
                }
            )
        else:
            fail(f"{name}: unexpected transaction type {entry['transactionType']}")

        links = {}
        for file, linked_names in artifact["bytecode"].get("linkReferences", {}).items():
            for linked_name in linked_names:
                links[linked_name] = checksum(libraries[f"{file}:{linked_name}"])
        gas_used = hex_int(receipt["gasUsed"])
        price = hex_int(receipt["effectiveGasPrice"])
        record.update(
            {
                "links": links,
                "txHash": tx_hash,
                "blockNumber": hex_int(receipt["blockNumber"]),
                "blockHash": receipt.get("blockHash"),
                "gasLimit": hex_int(tx["gas"]),
                "gasUsed": gas_used,
                "effectiveGasPrice": price,
                "costWei": gas_used * price,
                "runtimeBytes": (len(artifact["deployedBytecode"]["object"]) - 2) // 2,
                "initBytes": len(creation) // 2,
            }
        )
        # Arbitrum receipts carry the L1 block and the L1 share of gasUsed; an anvil fork's do not.
        for field in ("gasUsedForL1", "l1BlockNumber"):
            if receipt.get(field) is not None:
                record[field] = hex_int(receipt[field])
        total_gas += gas_used
        total_cost += gas_used * price
        contracts[name] = record

    stamp = broadcast.get("timestamp")
    # A mainnet broadcast stays in the repo under broadcast/; a dry run's lives in a temporary folder, so its record
    # names only the file's path below that folder.
    broadcast_file = os.path.abspath(args.broadcast)
    if broadcast_file.startswith(os.getcwd() + os.sep):
        broadcast_file = os.path.relpath(broadcast_file)
    else:
        broadcast_file = "(temporary) " + "/".join(broadcast_file.split(os.sep)[-4:])
    out = {
        "schema": "sleeve-deployment/1",
        "chainId": CHAIN_ID,
        "network": args.network,
        "deployer": deployer,
        "recordedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": source_state(),
        "broadcast": {
            "file": broadcast_file,
            "commit": broadcast.get("commit"),
            "writtenAt": dt.datetime.fromtimestamp(stamp / 1000, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            if stamp
            else None,
        },
        "compiler": settings,
        "libraries": {key: checksum(value) for key, value in libraries.items()},
        "contracts": contracts,
        "gas": {"totalGasUsed": total_gas, "totalCostWei": total_cost, "transactions": len(contracts)},
    }
    if args.fork_rpc or args.fork_block is not None:
        out["fork"] = {"rpc": args.fork_rpc, "block": args.fork_block}
    os.makedirs(os.path.dirname(os.path.abspath(args.record)), exist_ok=True)
    with open(args.record, "x") as handle:
        json.dump(out, handle, indent=2)
        handle.write("\n")

    print(f"Wrote {args.record}: {len(contracts)} contracts from {deployer}, {total_gas} gas, {total_cost} wei")
    if not out["source"]["clean"]:
        print(f"Note: the build's files differ from commit {out['source']['commit']}: {out['source']['changed']}")
    for name, _ in EXPECTED:
        c = contracts[name]
        print(f"  {name:26} {c['address']}  block {c['blockNumber']}  gas {c['gasUsed']}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RecordError as error:
        print(f"record_deployment: {error}", file=sys.stderr)
        sys.exit(1)
