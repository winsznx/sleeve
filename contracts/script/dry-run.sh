#!/usr/bin/env bash
# Fork dry run of the mainnet deploy, docs/DEPLOY_PLAN.md step 2. Every transaction goes to a local anvil node that
# forks chain 4663 from an archive RPC. The live chain is only read: its gas price, base fee and NodeInterface.
#
#   cd contracts && script/dry-run.sh
#
# Environment, all optional:
#   FORK_RPC            archive RPC the node forks (default https://robinhood.drpc.org)
#   FORK_BLOCK          block to fork at (default: the archive RPC's latest block)
#   LIVE_RPC            live RPC read for the gas price and the L1 component (default the public RPC)
#   ANVIL_PORT          port of the local node (default 8546)
#   FOUNDRY_OUT, FOUNDRY_CACHE_PATH   build folders (default out-deploy and cache-deploy)
#
# Steps, each stopping the run on failure: start the node; make an ephemeral test sender and fund it on the node;
# check the constants table on the node; broadcast Deploy.s.sol to the node from the test sender, its key passed by
# shell substitution from a mode 600 file the way the mainnet command passes the deployer's; write the record with
# record_deployment.py; read everything back with ReadBack.s.sol; run the smoke test on a fork of the node; price the
# deploy at the live gas price with gas_report.py; check every verification input against the node with verify.py.
# Outputs go to deployments/dry-run/4663-anvil-<block>.{json,gas.json,verify.json}, logs to a temporary folder. The
# key file is deleted and the node stopped on exit.
set -euo pipefail

cd "$(dirname "$0")/.."
FORK_RPC="${FORK_RPC:-https://robinhood.drpc.org}"
LIVE_RPC="${LIVE_RPC:-https://rpc.mainnet.chain.robinhood.com}"
ANVIL_PORT="${ANVIL_PORT:-8546}"
export FOUNDRY_OUT="${FOUNDRY_OUT:-out-deploy}"
export FOUNDRY_CACHE_PATH="${FOUNDRY_CACHE_PATH:-cache-deploy}"
NODE="http://127.0.0.1:${ANVIL_PORT}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/sleeve-dry-run.XXXXXX")"
# The dry run's broadcast files stay out of contracts/broadcast, which keeps only mainnet runs.
export FOUNDRY_BROADCAST="$WORK/broadcast"
KEY_FILE="$WORK/test-sender.key"
ANVIL_PID=""

cleanup() {
  rm -f "$KEY_FILE"
  if [[ -n "$ANVIL_PID" ]]; then
    kill "$ANVIL_PID" 2>/dev/null || true
    wait "$ANVIL_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
die() {
  printf 'dry-run: %s\n' "$*" >&2
  printf 'logs: %s\n' "$WORK" >&2
  exit 1
}

if cast chain-id --rpc-url "$NODE" >/dev/null 2>&1; then
  die "something already answers on $NODE; set ANVIL_PORT"
fi
if [[ -z "${FORK_BLOCK:-}" ]]; then
  FORK_BLOCK="$(cast block-number --rpc-url "$FORK_RPC")"
fi
RECORD="deployments/dry-run/4663-anvil-${FORK_BLOCK}.json"
GAS_REPORT="deployments/dry-run/4663-anvil-${FORK_BLOCK}.gas.json"
VERIFY_REPORT="deployments/dry-run/4663-anvil-${FORK_BLOCK}.verify.json"
for f in "$RECORD" "$GAS_REPORT" "$VERIFY_REPORT"; do
  [[ -e "$f" ]] && die "$f exists; a dry run at this block already ran"
done
echo "logs: $WORK"

step "build ($FOUNDRY_OUT)"
forge build >"$WORK/build.log" 2>&1 || die "forge build failed"

step "fork node: $FORK_RPC at block $FORK_BLOCK on $NODE"
anvil --fork-url "$FORK_RPC" --fork-block-number "$FORK_BLOCK" --port "$ANVIL_PORT" \
  --retries 10 --fork-retry-backoff 3000 --compute-units-per-second 50 --timeout 60000 \
  >"$WORK/anvil.log" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 60); do
  cast chain-id --rpc-url "$NODE" >/dev/null 2>&1 && break
  kill -0 "$ANVIL_PID" 2>/dev/null || die "anvil exited, see anvil.log"
  sleep 1
done
[[ "$(cast chain-id --rpc-url "$NODE")" == "4663" ]] || die "the node is not chain 4663"
FORK_TIME="$(cast block "$FORK_BLOCK" --field timestamp --rpc-url "$NODE")"
echo "fork block $FORK_BLOCK, timestamp $FORK_TIME ($(date -u -r "$FORK_TIME" '+%Y-%m-%d %H:%M:%S UTC' 2>/dev/null || date -u -d "@$FORK_TIME" '+%Y-%m-%d %H:%M:%S UTC'))"

step "test sender"
(
  umask 077
  cast wallet new --json >"$WORK/wallet.json"
  python3 - "$WORK/wallet.json" "$KEY_FILE" <<'EOF'
import json, sys
wallet = json.load(open(sys.argv[1]))[0]
open(sys.argv[2], "w").write(wallet["private_key"])
print(wallet["address"])
EOF
) >"$WORK/sender.addr"
rm -f "$WORK/wallet.json"
SENDER="$(cat "$WORK/sender.addr")"
cast rpc --rpc-url "$NODE" anvil_setBalance "$SENDER" 0x56BC75E2D63100000 >/dev/null
echo "test sender $SENDER, nonce $(cast nonce "$SENDER" --rpc-url "$NODE"), funded 100 ETH on the node"
[[ "$(cast wallet address --private-key "$(cat "$KEY_FILE")")" == "$SENDER" ]] || die "the key file does not match the sender"

step "constants table on the node"
forge script script/ReadBack.s.sol --sig "constants()" --rpc-url "$NODE" >"$WORK/constants.log" 2>&1 \
  || die "the constants check failed, see constants.log"
grep -q "Constants: every check passed" "$WORK/constants.log" || die "the constants check did not report a pass"

step "deploy: Deploy.s.sol broadcast to the node"
# The same form as the mainnet command in docs/DEPLOY_PLAN.md 8.2, with the test key file in place of
# ~/.sleeve-keys/deployer.key: a shell variable loaded by substitution, local to a subshell, never printed.
(
  set +x
  DEPLOYER_KEY="$(cat "$KEY_FILE")"
  SLEEVE_DEPLOYER="$SENDER" SLEEVE_DEPLOYMENT_FILE="$RECORD" \
    forge script script/Deploy.s.sol --rpc-url "$NODE" --broadcast --slow \
    --private-key "$DEPLOYER_KEY"
) >"$WORK/deploy.log" 2>&1 || die "the deploy failed, see deploy.log"
grep -q "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" "$WORK/deploy.log" || die "the broadcast did not complete"
grep -A 12 "== Logs ==" "$WORK/deploy.log" | sed -n '2,12p'

step "record"
python3 script/record_deployment.py --broadcast "$FOUNDRY_BROADCAST/Deploy.s.sol/4663/run-latest.json" \
  --out-dir "$FOUNDRY_OUT" --record "$RECORD" --network anvil-fork --fork-rpc "$FORK_RPC" --fork-block "$FORK_BLOCK" \
  | tee "$WORK/record.log"

step "read-back on the node"
SLEEVE_DEPLOYER="$SENDER" SLEEVE_DEPLOYMENT_FILE="$RECORD" \
  forge script script/ReadBack.s.sol --rpc-url "$NODE" >"$WORK/readback.log" 2>&1 || die "the read-back failed, see readback.log"
grep -A 12 "== Logs ==" "$WORK/readback.log" | sed -n '2,12p'

step "smoke test on a fork of the node"
SLEEVE_SMOKE_RPC="$NODE" SLEEVE_DEPLOYMENT_FILE="$RECORD" \
  forge test --match-path test/fork/DeploySmoke.t.sol -vv >"$WORK/smoke.log" 2>&1 || die "the smoke test failed, see smoke.log"
grep -q "\[PASS\] test_smoke_recordedDeployment" "$WORK/smoke.log" || die "the smoke test did not pass (skipped?)"
sed -n '/Logs:/,/Suite result/p' "$WORK/smoke.log"

step "gas at the live gas price ($LIVE_RPC)"
python3 script/gas_report.py --broadcast "$FOUNDRY_BROADCAST/Deploy.s.sol/4663/run-latest.json" --record "$RECORD" \
  --report "$GAS_REPORT" --rpc "$LIVE_RPC" | tee "$WORK/gas.log"

step "verification inputs against the node"
python3 script/verify.py check --record "$RECORD" --rpc "$NODE" --report "$VERIFY_REPORT" | tee "$WORK/verify.log"

step "done"
echo "record $RECORD"
echo "gas    $GAS_REPORT"
echo "verify $VERIFY_REPORT"
echo "logs   $WORK"
