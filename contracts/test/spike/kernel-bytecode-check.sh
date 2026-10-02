#!/usr/bin/env bash
# Rebuilds the Kernel v3.1 contracts that ZeroDev deploys on chain 4663 and compares their runtime bytecode with
# `cast code`. Immutable slots are masked using the compiler's immutableReferences and their on-chain values are
# printed. Kernel's foundry.toml leaves solc, optimizer and evm_version to Foundry's 2024 defaults, so those are
# pinned here to the values Sourcify records for the same addresses on chain 1: solc 0.8.25 (0.8.24 for the
# FactoryStaker), optimizer on with 200 runs, evm_version paris.
#
# Usage: contracts/test/spike/kernel-bytecode-check.sh [rpc-url]
set -euo pipefail

RPC="${1:-${ROBINHOOD_RPC:-https://rpc.mainnet.chain.robinhood.com}}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

git clone --quiet https://github.com/zerodevapp/kernel "$WORK/kernel"
cd "$WORK/kernel"

# check <label> <git ref> <foundry profile> <solc> <source path> <contract name> <address>
check() {
  local label=$1 ref=$2 profile=$3 solc=$4 src=$5 name=$6 address=$7
  local out="$WORK/out-$label"
  git checkout --quiet "$ref"
  git submodule update --quiet --init --recursive
  FOUNDRY_PROFILE=$profile FOUNDRY_SOLC_VERSION=$solc FOUNDRY_OPTIMIZER=true FOUNDRY_OPTIMIZER_RUNS=200 \
    FOUNDRY_EVM_VERSION=paris forge build "$src" --out "$out" --cache-path "$out-cache" >/dev/null 2>&1
  # Run cast outside the clone so it does not parse Kernel's foundry.toml and warn about its unknown keys.
  (cd "$WORK" && cast code --rpc-url "$RPC" "$address") >"$out/onchain.hex"
  python3 - "$label" "$ref" "$address" "$out/$(basename "$src")/$name.json" "$out/onchain.hex" <<'PY'
import json, sys
label, ref, address, artifact, onchain_path = sys.argv[1:]
deployed = json.load(open(artifact))["deployedBytecode"]
compiled = bytes.fromhex(deployed["object"].removeprefix("0x"))
onchain = bytes.fromhex(open(onchain_path).read().strip().removeprefix("0x"))
masked, immutables = set(), {}
for locations in deployed.get("immutableReferences", {}).values():
    for loc in locations:
        start, length = loc["start"], loc["length"]
        masked.update(range(start, start + length))
        immutables.setdefault(onchain[start:start + length].hex(), None)
diff = sum(1 for i in range(min(len(compiled), len(onchain))) if i not in masked and compiled[i] != onchain[i])
verdict = "MATCH" if len(compiled) == len(onchain) and diff == 0 else "MISMATCH"
print(f"{label} @ {ref} vs {address}: {verdict} compiled={len(compiled)}B onchain={len(onchain)}B "
      f"masked={len(masked)}B differing={diff}B")
for value in immutables:
    print(f"    immutable 0x{value}")
PY
}

check kernel v3.1 deploy 0.8.25 src/Kernel.sol Kernel 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D
check factory v3.1 deploy 0.8.25 src/factory/KernelFactory.sol KernelFactory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419
check meta-factory v3.1 default 0.8.24 src/factory/FactoryStaker.sol FactoryStaker 0xd703aaE79538628d27099B8c4f621bE4CCd142d5
check ecdsa-at-tag v3.1 deploy 0.8.25 src/validator/ECDSAValidator.sol ECDSAValidator 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57
check ecdsa-rc1 e18c700 deploy 0.8.25 src/validator/ECDSAValidator.sol ECDSAValidator 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57
