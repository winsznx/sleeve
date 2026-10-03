// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {SessionCalendarExtension} from "../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../src/SleeveModule.sol";
import {SleeveTimelock} from "../src/SleeveTimelock.sol";
import {TokenSource} from "../src/TokenSource.sol";
import {SleeveBuy} from "../src/libraries/SleeveBuy.sol";
import {SleeveSell} from "../src/libraries/SleeveSell.sol";
import {SleeveTrade} from "../src/libraries/SleeveTrade.sol";
import {DeployChecks, Deployment} from "./DeployChecks.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @title Deploy
/// @notice The M0 deploy of Sleeve to Robinhood Chain, chain id 4663: SleeveTimelock, SessionCalendarExtension and
/// TokenSource under it, the external libraries SleeveTrade, SleeveBuy and SleeveSell, and SleeveModule linked to them,
/// with the values of DeployConfig. The account that broadcasts becomes the timelock's only proposer, canceller and
/// executor. Before anything is broadcast, the script checks the chain's outside addresses, then runs the whole
/// read-back on the simulated deployment, so a deployment that would fail a check is never sent. docs/DEPLOY_PLAN.md
/// has the commands; script/record_deployment.py writes deployments/4663.json from the broadcast receipts.
/// @dev forge deploys the linked libraries before the script body runs, as the broadcaster's first three transactions:
/// calls to the CREATE2 deployer with salt zero, since chain 4663 has it, so their addresses depend only on their code
/// (SleeveSell's code holds SleeveTrade's address, so SleeveTrade goes before it). A library already at its address is
/// skipped. The script reads no key and no secret: the key goes to forge on the command line.
contract Deploy is DeployChecks {
    /// @notice The script ran against another chain.
    error WrongChain(uint256 chainId, uint256 expected);
    /// @notice The broadcasting key is not the account the run expects (SLEEVE_DEPLOYER, by default DEPLOYER).
    error BroadcasterNotDeployer(address broadcaster, address expected);
    /// @notice A deploy record already exists, so this deployment exists or is being recorded. Nothing was sent.
    error AlreadyDeployed(string record);
    /// @notice A fresh module already holds a receipt, so the simulation did not deploy a fresh module.
    error NotFresh(uint256 nextReceiptId);
    /// @notice The broadcaster's nonce on chain is not the one the run expects, so part of a deploy may already be on
    /// chain. A broadcast that stopped part way is finished with forge's --resume, which does not run this check.
    error DeployerNonceMismatch(address broadcaster, uint256 nonce, uint256 expected);
    /// @notice The RPC answered eth_getTransactionCount with more than a word.
    error NonceTooLong(uint256 length);

    /// @notice Deploys and checks everything. Environment: SLEEVE_DEPLOYER, the address the broadcasting key must
    /// have (default DeployConfig.DEPLOYER); SLEEVE_DEPLOYER_NONCE, its nonce on chain before the deploy (default 0);
    /// and SLEEVE_DEPLOYMENT_FILE, the record that must not exist yet (default deployments/4663.json).
    /// @dev Caller: forge script, with the deployer's key passed to forge. Run without --broadcast it only simulates.
    /// The nonce is read from the RPC's latest block through vm.rpc, because forge has already advanced the simulated
    /// nonce by the library deployments when this function starts.
    /// @return d The simulated deployment, which forge also writes into the broadcast file's returns.
    function run() external returns (Deployment memory d) {
        if (block.chainid != DeployConfig.CHAIN_ID) revert WrongChain(block.chainid, DeployConfig.CHAIN_ID);
        string memory record = vm.envOr("SLEEVE_DEPLOYMENT_FILE", string(DeployConfig.RECORD_FILE));
        if (vm.exists(record)) revert AlreadyDeployed(record);
        address expected = vm.envOr("SLEEVE_DEPLOYER", DeployConfig.DEPLOYER);
        uint256 expectedNonce = vm.envOr("SLEEVE_DEPLOYER_NONCE", uint256(0));
        checkConstants();

        vm.recordLogs();
        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        // A revert leaves forge's broadcast open, so each guard closes it first: nothing has been queued yet.
        if (broadcaster != expected) {
            vm.stopBroadcast();
            revert BroadcasterNotDeployer(broadcaster, expected);
        }
        uint256 nonce = chainNonce(broadcaster);
        if (nonce != expectedNonce) {
            vm.stopBroadcast();
            revert DeployerNonceMismatch(broadcaster, nonce, expectedNonce);
        }
        d = deploy(broadcaster);
        vm.stopBroadcast();

        checkDeployment(d);
        (RoleEvent[] memory events, bytes[] memory delayChanges) =
            roleEventsIn(vm.getRecordedLogs(), address(d.timelock));
        checkRoleEvents(d, events, delayChanges);
        if (d.module.nextReceiptId() != 1) revert NotFresh(d.module.nextReceiptId());
        _log(d);
    }

    /// @notice Deploys the timelock, the calendar, TokenSource and the module in that order, and returns them with
    /// the linked libraries. The timelock's delay is 172,800 seconds with `admin` as its only proposer, canceller and
    /// executor and no admin role holder (D-009 Q33).
    /// @dev Caller: run, inside its broadcast, and the deploy tests.
    /// @param admin The account that will hold the timelock's roles: the broadcaster in run.
    function deploy(address admin) public returns (Deployment memory d) {
        address[] memory roles = new address[](1);
        roles[0] = admin;
        d.deployer = admin;
        d.sleeveTrade = address(SleeveTrade);
        d.sleeveBuy = address(SleeveBuy);
        d.sleeveSell = address(SleeveSell);
        d.timelock = new SleeveTimelock(DeployConfig.TIMELOCK_MIN_DELAY, roles, roles, address(0));
        d.calendar = new SessionCalendarExtension(address(d.timelock));
        d.tokenSource = new TokenSource(
            address(d.timelock), DeployConfig.USDG, DeployConfig.V3_FACTORY, DeployConfig.tickerInits()
        );
        d.module = new SleeveModule(DeployConfig.moduleConfig(d.tokenSource, d.calendar));
    }

    /// @notice An account's nonce at the RPC's latest block, outside the script's simulated state.
    /// @dev Caller: run and the deploy tests. eth_getTransactionCount returns a quantity, which vm.rpc hands back as
    /// its big-endian bytes.
    function chainNonce(address account) public returns (uint256 nonce) {
        bytes memory raw =
            vm.rpc("eth_getTransactionCount", string.concat("[\"", vm.toString(account), "\",\"latest\"]"));
        if (raw.length > 32) revert NonceTooLong(raw.length);
        for (uint256 i; i < raw.length; ++i) {
            nonce = (nonce << 8) | uint8(raw[i]);
        }
    }

    /// @dev Addresses only. The record with transaction hashes and constructor arguments comes from the receipts.
    function _log(Deployment memory d) private pure {
        console.log("Sleeve deploy on chain 4663, every check passed on the simulated deployment");
        console.log("deployer (timelock proposer, canceller, executor):", d.deployer);
        console.log("SleeveTrade:", d.sleeveTrade);
        console.log("SleeveBuy:", d.sleeveBuy);
        console.log("SleeveSell:", d.sleeveSell);
        console.log("SleeveTimelock:", address(d.timelock));
        console.log("SessionCalendarExtension:", address(d.calendar));
        console.log("TokenSource:", address(d.tokenSource));
        console.log("SleeveModule:", address(d.module));
    }
}
