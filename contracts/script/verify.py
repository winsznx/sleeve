#!/usr/bin/env python3
"""Verification commands for a recorded Sleeve deployment, and a local check of their arguments.

Run from contracts/, with the FOUNDRY_OUT and FOUNDRY_CACHE_PATH the deploy's build used:

    python3 script/verify.py commands --record deployments/4663.json
    python3 script/verify.py check --record deployments/4663.json --rpc <RPC> --report <report.json>

`commands` prints a forge verify-contract command per contract and library in the record, for each verifier:
- sourcify: https://sourcify.dev/server, chain 4663 supported, no key. Sourcify reads the constructor arguments from the
  creation transaction, so the command passes its hash.
- blockscout: the explorer robinhoodchain.blockscout.com through Blockscout's PRO API, which needs a free key from
  dev.blockscout.com in BLOCKSCOUT_API_KEY. The explorer's own API, robinhoodchain.blockscout.com/api/, answered
  scripts and forge with a Cloudflare challenge on 3 October 2026, so it is printed as a fallback only.
- etherscan: robin.etherscan.io through Etherscan's v2 API for chain 4663, which needs ETHERSCAN_API_KEY.
No command passes --libraries: the standard JSON input then matches forge's own build, which links libraries after
compiling, so a verifier that fills the link placeholders from the chain gets every byte, the metadata hash included.
`commands --libraries` prints the fallback that has solc link them, for a verifier that refuses placeholders. That
build writes the libraries into the metadata, so it can only match without the metadata hash.

`check` does locally what a verifier does with those arguments, against the chain at --rpc. For each contract it runs
every printed command with --show-standard-json-input, which makes forge parse the command and print the input it
would send without sending it, requires the four verifiers' inputs to be equal, compiles the input with the same solc,
and compares the result with the code at the recorded address and with the input of the recorded creation transaction,
constructor arguments included. It expects an exact match without --libraries and a match outside the metadata hash
with them. Exits non-zero on any mismatch. Reads only public data and never contacts a verifier.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shlex
import subprocess
import sys
import tempfile

CHAIN_ID = 4663
CREATE2_DEPLOYER = "0x4e59b44847b379578588920ca78fbf26c0b4956c"
BLOCKSCOUT_PRO_URL = "https://api.blockscout.com/v2/api?chain_id=4663"
BLOCKSCOUT_INSTANCE_URL = "https://robinhoodchain.blockscout.com/api/"
ETHERSCAN_V2_URL = "https://api.etherscan.io/v2/api?chainid=4663"
VERIFIERS = ["sourcify", "blockscout", "blockscout-instance", "etherscan"]
ORDER = [
    "SleeveTrade",
    "SleeveBuy",
    "SleeveSell",
    "SleeveTimelock",
    "SessionCalendarExtension",
    "TokenSource",
    "SleeveModule",
]
OUTPUTS = [
    "evm.bytecode.object",
    "evm.bytecode.linkReferences",
    "evm.deployedBytecode.object",
    "evm.deployedBytecode.linkReferences",
    "evm.deployedBytecode.immutableReferences",
]
# CBOR "ipfs" key, byte string of 34, multihash sha2-256 of 32 bytes: what precedes the metadata hash.
IPFS_PREFIX = bytes.fromhex("6970667358221220")
PUSH20 = 0x73


class CheckError(Exception):
    pass


def fail(message: str) -> None:
    raise CheckError(message)


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        fail(f"{' '.join(cmd[:3])} failed: {result.stderr.strip()[-800:]}")
    return result.stdout


def load_record(path: str) -> dict:
    record = json.load(open(path))
    if record.get("chainId") != CHAIN_ID:
        fail(f"{path} is for chain {record.get('chainId')}, not {CHAIN_ID}")
    missing = [name for name in ORDER if name not in record["contracts"]]
    if missing:
        fail(f"{path} lacks {missing}")
    return record


def library_flags(record: dict, name: str) -> list[str]:
    """--libraries flags for the libraries a contract links, from the record's library map."""
    flags = []
    links = record["contracts"][name]["links"]
    for key, address in sorted(record["libraries"].items()):
        library = key.split(":")[1]
        if library in links:
            if links[library].lower() != address.lower():
                fail(f"{name}: the record links {library} at {links[library]} and lists it at {address}")
            flags += ["--libraries", f"{key}:{address}"]
    if len(flags) // 2 != len(links):
        fail(f"{name}: the record links {sorted(links)}, of which the library map lists {len(flags) // 2}")
    return flags


def base_command(record: dict, name: str) -> list[str]:
    c = record["contracts"][name]
    version = record["compiler"]["solc"].split("+")[0]
    return ["forge", "verify-contract", c["address"], c["artifact"], "--chain", str(CHAIN_ID), "--compiler-version", version]


def verifier_commands(record: dict, name: str, libraries: bool) -> dict[str, list[str]]:
    c = record["contracts"][name]
    args = [] if c["constructorArgsEncoded"] == "0x" else ["--constructor-args", c["constructorArgsEncoded"]]
    links = library_flags(record, name) if libraries else []
    base = base_command(record, name)
    return {
        "sourcify": base + ["--verifier", "sourcify", "--creation-transaction-hash", c["txHash"]] + links + ["--watch"],
        "blockscout": base
        + ["--verifier", "blockscout", "--verifier-url", BLOCKSCOUT_PRO_URL, "--etherscan-api-key", "$BLOCKSCOUT_API_KEY"]
        + args
        + links
        + ["--watch"],
        "blockscout-instance": base
        + ["--verifier", "blockscout", "--verifier-url", BLOCKSCOUT_INSTANCE_URL]
        + args
        + links
        + ["--watch"],
        "etherscan": base
        + ["--verifier", "etherscan", "--verifier-url", ETHERSCAN_V2_URL, "--etherscan-api-key", "$ETHERSCAN_API_KEY"]
        + args
        + links
        + ["--watch"],
    }


def shell(cmd: list[str]) -> str:
    """The command as a shell line; the API key variables stay unexpanded for the shell to fill."""
    parts = []
    for part in cmd:
        parts.append(f'"{part}"' if part.startswith("$") else shlex.quote(part))
    return " ".join(parts)


def commands(args: argparse.Namespace) -> int:
    record = load_record(args.record)
    env = f"FOUNDRY_OUT={shlex.quote(args.out_dir)} FOUNDRY_CACHE_PATH={shlex.quote(args.cache_dir)} "
    verifiers = args.verifier or VERIFIERS
    for verifier in verifiers:
        print(f"# {verifier}{' with --libraries' if args.libraries else ''}")
        for name in ORDER:
            print(env + shell(verifier_commands(record, name, args.libraries)[verifier]))
        print()
    return 0


# check


def find_solc(version: str, override: str | None) -> str:
    candidates = [override] if override else []
    home = os.path.expanduser("~")
    candidates += [
        os.path.join(home, "Library", "Application Support", "svm", version, f"solc-{version}"),
        os.path.join(home, ".svm", version, f"solc-{version}"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    fail(f"no solc {version} found; pass --solc")
    return ""


def standard_json(record: dict, name: str, libraries: bool) -> dict:
    """The standard JSON input each printed command sends, from the command itself with --show-standard-json-input
    in place of --watch and a stand-in for the API key. Every verifier's command must give the same input."""
    inputs = {}
    for verifier, cmd in verifier_commands(record, name, libraries).items():
        cmd = [part for part in cmd if part != "--watch"]
        cmd = ["unused" if part.startswith("$") else part for part in cmd]
        inputs[verifier] = json.loads(run(cmd + ["--show-standard-json-input"]))
    first = inputs[VERIFIERS[0]]
    for verifier in VERIFIERS[1:]:
        if inputs[verifier] != first:
            fail(f"{name}: the {verifier} command sends another standard JSON input than the sourcify command")
    return first


def compile_input(solc: str, input_json: dict, source: str, contract: str) -> dict:
    selected = dict(input_json)
    selected["settings"] = dict(input_json["settings"], outputSelection={source: {contract: OUTPUTS}})
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
        json.dump(selected, handle)
        path = handle.name
    try:
        with open(path) as stdin:
            result = subprocess.run([solc, "--standard-json"], stdin=stdin, capture_output=True, text=True)
    finally:
        os.unlink(path)
    if result.returncode != 0:
        fail(f"solc failed on {source}:{contract}: {result.stderr.strip()[-500:]}")
    output = json.loads(result.stdout)
    errors = [e["formattedMessage"] for e in output.get("errors", []) if e["severity"] == "error"]
    if errors:
        fail(f"solc errors on {source}:{contract}: {errors[0][:500]}")
    return output["contracts"][source][contract]["evm"]


def link(hex_code: str, link_references: dict, record: dict) -> bytes:
    """Fills every library placeholder with the record's address for that library."""
    chars = list(hex_code)
    for file, names in link_references.items():
        for library, refs in names.items():
            key = f"{file}:{library}"
            if key not in record["libraries"]:
                fail(f"the build links {key}, which the record does not list")
            address = record["libraries"][key][2:].lower()
            for ref in refs:
                chars[ref["start"] * 2 : ref["start"] * 2 + 40] = list(address)
    linked = "".join(chars)
    try:
        return bytes.fromhex(linked)
    except ValueError:
        fail("a library placeholder is left after linking")
    return b""


def masked(code: bytes, immutable_references: dict) -> bytearray:
    out = bytearray(code)
    for refs in immutable_references.values():
        for ref in refs:
            out[ref["start"] : ref["start"] + ref["length"]] = bytes(ref["length"])
    return out


def metadata_hash(code: bytes) -> bytes:
    cbor_length = int.from_bytes(code[-2:], "big")
    cbor = code[-2 - cbor_length : -2]
    at = cbor.find(IPFS_PREFIX)
    if at < 0:
        fail("no ipfs metadata hash in the code")
    return cbor[at + len(IPFS_PREFIX) : at + len(IPFS_PREFIX) + 32]


def first_difference(a: bytes, b: bytes) -> int:
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def chain_reads(rpc: str, address: str, tx_hash: str) -> tuple[bytes, str, bytes]:
    code = bytes.fromhex(run(["cast", "code", address, "--rpc-url", rpc]).strip()[2:])
    to = run(["cast", "tx", tx_hash, "to", "--rpc-url", rpc]).strip().lower()
    data = bytes.fromhex(run(["cast", "tx", tx_hash, "input", "--rpc-url", rpc]).strip()[2:])
    return code, to, data


def compare(record: dict, name: str, evm: dict, onchain: bytes, to: str, tx_input: bytes, exact: bool) -> dict:
    c = record["contracts"][name]
    address = bytes.fromhex(c["address"][2:])
    runtime = link(evm["deployedBytecode"]["object"], evm["deployedBytecode"].get("linkReferences", {}), record)
    creation = link(evm["bytecode"]["object"], evm["bytecode"].get("linkReferences", {}), record)
    if c["kind"] == "library":
        if runtime[0] != PUSH20 or onchain[1:21] != address:
            fail(f"{name}: the library's call guard does not hold its own address")
        runtime = runtime[:1] + address + runtime[21:]
    expected_runtime = masked(runtime, evm["deployedBytecode"].get("immutableReferences", {}))
    actual_runtime = masked(onchain, evm["deployedBytecode"].get("immutableReferences", {}))

    if c["deployMethod"] == "CREATE2":
        if to != CREATE2_DEPLOYER:
            fail(f"{name}: the creation transaction went to {to}, not the CREATE2 deployer")
        if tx_input[:32] != bytes.fromhex(c["salt"][2:]):
            fail(f"{name}: the creation transaction's salt is not the record's")
        expected_creation, actual_creation = creation, tx_input[32:]
    else:
        args = bytes.fromhex(c["constructorArgsEncoded"][2:])
        expected_creation, actual_creation = creation + args, tx_input

    metadata = "same"
    if not exact:
        compiled_hash, chain_hash = metadata_hash(runtime), metadata_hash(onchain)
        if compiled_hash != chain_hash:
            metadata = "differs"
            expected_runtime = bytearray(bytes(expected_runtime).replace(compiled_hash, chain_hash))
            expected_creation = expected_creation.replace(compiled_hash, chain_hash)

    if len(expected_runtime) != len(actual_runtime) or expected_runtime != actual_runtime:
        fail(
            f"{name}: runtime code differs at byte {first_difference(expected_runtime, actual_runtime)} "
            f"({len(expected_runtime)} compiled, {len(actual_runtime)} on chain)"
        )
    if expected_creation != actual_creation:
        fail(
            f"{name}: creation input differs at byte {first_difference(expected_creation, actual_creation)} "
            f"({len(expected_creation)} compiled, {len(actual_creation)} sent)"
        )
    return {
        "runtimeBytes": len(onchain),
        "creationBytes": len(actual_creation),
        "match": "exact" if metadata == "same" else "outside the metadata hash",
        "metadataHash": metadata,
    }


def settings_match(record: dict, input_json: dict, name: str) -> None:
    s = input_json["settings"]
    compiler = record["compiler"]
    seen = {
        "optimizer": s["optimizer"]["enabled"],
        "optimizerRuns": s["optimizer"]["runs"],
        "evmVersion": s["evmVersion"],
        "viaIR": s.get("viaIR", False),
        "bytecodeHash": s.get("metadata", {}).get("bytecodeHash", "ipfs"),
        "appendCBOR": s.get("metadata", {}).get("appendCBOR", True),
    }
    for key, value in seen.items():
        if compiler[key] != value:
            fail(f"{name}: the standard JSON input sets {key} {value}, the deploy's build {compiler[key]}")


def check(args: argparse.Namespace) -> int:
    record = load_record(args.record)
    version = record["compiler"]["solc"].split("+")[0]
    solc = find_solc(version, args.solc)
    full = run([solc, "--version"]).strip().splitlines()[-1]
    if record["compiler"]["solc"] not in full:
        fail(f"{solc} reports {full}, the deploy used {record['compiler']['solc']}")
    chain = int(run(["cast", "chain-id", "--rpc-url", args.rpc]).strip())
    if chain != CHAIN_ID:
        fail(f"--rpc is chain {chain}, not {CHAIN_ID}")

    rows = []
    for name in ORDER:
        c = record["contracts"][name]
        source, contract = c["artifact"].split(":")
        onchain, to, tx_input = chain_reads(args.rpc, c["address"], c["txHash"])
        variants = [False] + ([True] if c["links"] else [])
        for libraries in variants:
            input_json = standard_json(record, name, libraries)
            settings_match(record, input_json, name)
            listed = input_json["settings"].get("libraries") or {}
            if bool(listed) != libraries:
                fail(f"{name}: the standard JSON input lists libraries {listed}")
            evm = compile_input(solc, input_json, source, contract)
            result = compare(record, name, evm, onchain, to, tx_input, exact=not libraries)
            row = {
                "contract": name,
                "address": c["address"],
                "variant": "--libraries" if libraries else "no --libraries",
                "commandsChecked": VERIFIERS,
                "sources": len(input_json["sources"]),
                **result,
            }
            if not libraries and result["match"] != "exact":
                fail(f"{name}: expected an exact match without --libraries")
            rows.append(row)
            print(
                f"{name:26} {c['address']}  {row['variant']:15} runtime {row['runtimeBytes']:>6} bytes  "
                f"creation {row['creationBytes']:>6} bytes  {row['match']}"
            )

    if args.report:
        if os.path.exists(args.report):
            fail(f"{args.report} exists. A report is never overwritten.")
        report = {
            "schema": "sleeve-verify-check/1",
            "checkedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "record": args.record,
            "rpc": args.rpc,
            "solc": full,
            "rows": rows,
        }
        with open(args.report, "x") as handle:
            json.dump(report, handle, indent=2)
            handle.write("\n")
    print(f"Every verification input compiles to the recorded code ({len(rows)} checks).")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    p = sub.add_parser("commands", help="print the forge verify-contract commands")
    p.add_argument("--record", required=True)
    p.add_argument("--verifier", action="append", choices=VERIFIERS)
    p.add_argument("--libraries", action="store_true", help="the fallback that has solc link the libraries")
    p.add_argument("--out-dir", default=os.environ.get("FOUNDRY_OUT", "out-deploy"))
    p.add_argument("--cache-dir", default=os.environ.get("FOUNDRY_CACHE_PATH", "cache-deploy"))
    p.set_defaults(func=commands)
    p = sub.add_parser("check", help="compile each verification input and compare it with the chain")
    p.add_argument("--record", required=True)
    p.add_argument("--rpc", required=True, help="the chain or fork node that holds the deployment")
    p.add_argument("--report", help="JSON report to write; must not exist")
    p.add_argument("--solc", help="path to the solc binary of the record's version")
    p.set_defaults(func=check)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CheckError as error:
        print(f"verify: {error}", file=sys.stderr)
        sys.exit(1)
