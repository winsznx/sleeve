// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {Status} from "../../src/types/SleeveTypes.sol";
import {Deployment} from "../../script/DeployChecks.sol";
import {ReadBack} from "../../script/ReadBack.s.sol";
import {DeployForkBase} from "./DeployForkBase.t.sol";

/// @notice The smoke test of a deployment that Deploy.s.sol broadcast to a node and record_deployment.py recorded:
/// the fork dry run of docs/DEPLOY_PLAN.md, where an anvil fork of chain 4663 holds the deployment. It forks that node
/// at its latest block, which pins the block the node was forked at plus the deploy's blocks, reads the record, runs
/// every read-back check on it, then the smoke split: FILLED if the session is open at that block, QUEUED with reason
/// SESSION otherwise.
/// @dev Needs SLEEVE_SMOKE_RPC (the node) and SLEEVE_DEPLOYMENT_FILE (the record, under contracts/). Without them the
/// test reports itself skipped, never passed: script/dry-run.sh sets both.
contract DeploySmokeTest is DeployForkBase {
    function test_smoke_recordedDeployment() public {
        string memory rpc = vm.envOr("SLEEVE_SMOKE_RPC", string(""));
        string memory record = vm.envOr("SLEEVE_DEPLOYMENT_FILE", string(""));
        if (bytes(rpc).length == 0 || bytes(record).length == 0) {
            vm.skip(true, "set SLEEVE_SMOKE_RPC and SLEEVE_DEPLOYMENT_FILE, as script/dry-run.sh does");
            return;
        }
        _forkChain(rpc, 0);
        ReadBack readBack = new ReadBack();
        Deployment memory d = readBack.load(vm.readFile(record));
        assertEq(vm.parseJsonUint(vm.readFile(record), ".chainId"), block.chainid, "the record's chain");
        readBack.checkConstants();
        readBack.checkDeployment(d);
        _etchArbSys();

        Smoke memory s = _smoke(d, keccak256(abi.encode("deploy smoke", block.number)));

        console.log("Smoke block:", block.number, "timestamp:", block.timestamp);
        console.log("Session open:", s.sessionOpen);
        console.log("Account:", s.account);
        console.log(
            "Receipt id %s, status %s, reason %s",
            s.receipt.id,
            _statusName(s.receipt.status),
            _reasonName(s.receipt.reason)
        );
        console.log(
            "usdgIn %s, usdgToSpend %s, usdgSpent %s", s.receipt.usdgIn, s.receipt.usdgToSpend, s.receipt.usdgSpent
        );
        console.log("usdgQueued %s, tokensOut %s", s.receipt.usdgQueued, s.receipt.tokensOut);
        console.log("Receipt hash:", vm.toString(d.module.receiptHash(s.receipt.id)));
        assertEq(uint8(s.receipt.status), uint8(s.sessionOpen ? Status.FILLED : Status.QUEUED));
    }
}
