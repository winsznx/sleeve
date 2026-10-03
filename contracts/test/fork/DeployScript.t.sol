// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {DeployChecks, Deployment} from "../../script/DeployChecks.sol";
import {DeployConfig} from "../../script/DeployConfig.sol";
import {ReadBack} from "../../script/ReadBack.s.sol";
import {DeployForkBase} from "./DeployForkBase.t.sol";

/// @notice Deploy.s.sol and ReadBack.s.sol on chain 4663 forked at the pinned blocks of D-008: the script's own deploy
/// function, then every read-back check, then the smoke split. At block 78,312,136 (Friday 2 October 2026 10:44 EDT)
/// the split fills on the real SPY pool; at block 73,280,794 (Saturday 26 September 2026 14:00 EDT) it queues SESSION.
/// The read-back is shown to fail, with its named error, on each kind of mismatch it exists to catch. The CLI path,
/// forge script against an anvil fork of the latest block with a test sender, is in docs/DEPLOY_PLAN.md.
contract DeployScriptForkTest is DeployForkBase {
    string internal constant ARCHIVE_RPC = "https://robinhood.drpc.org";

    Deploy internal deployScript;
    ReadBack internal readBack;
    address internal admin = makeAddr("deploy-admin");

    function _forkPinned(uint256 blockNumber) internal {
        _forkChain(vm.envOr("FORK_RPC", string(ARCHIVE_RPC)), blockNumber);
        deployScript = new Deploy();
        readBack = new ReadBack();
    }

    /// @notice The script's deploy, every read-back check on it, and the role history from the deploy's own logs.
    function _deployAndCheck() internal returns (Deployment memory d) {
        readBack.checkConstants();
        vm.recordLogs();
        d = deployScript.deploy(admin);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        readBack.checkDeployment(d);
        (DeployChecks.RoleEvent[] memory events, bytes[] memory delays) =
            readBack.roleEventsIn(logs, address(d.timelock));
        readBack.checkRoleEvents(d, events, delays);
        assertEq(d.module.nextReceiptId(), 1, "a fresh module");
    }

    // The deploy, the read-back and the smoke split

    function test_deployScript_inSession_passesEveryCheck_andTheKeeperSplitFills() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = _deployAndCheck();
        _etchArbSys();

        Smoke memory s = _smoke(d, keccak256("deploy smoke, in session"));

        assertTrue(s.sessionOpen, "Friday 10:44 EDT is in session");
        assertEq(uint8(s.receipt.status), uint8(Status.FILLED));
        assertEq(s.receipt.id, 1, "the deployment's first receipt");
    }

    function test_deployScript_weekend_passesEveryCheck_andTheKeeperSplitQueuesSession() public {
        _forkPinned(WEEKEND_BLOCK);
        Deployment memory d = _deployAndCheck();
        _etchArbSys();

        Smoke memory s = _smoke(d, keccak256("deploy smoke, weekend"));

        assertFalse(s.sessionOpen, "Saturday 14:00 EDT is closed");
        assertEq(uint8(s.receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(s.receipt.reason), uint8(Reason.SESSION));
    }

    /// deploy() returns the libraries forge linked, each with code, and wires the calendar and TokenSource to the
    /// timelock it created.
    function test_deployScript_recordsTheLinkedLibraries() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        assertGt(d.sleeveTrade.code.length, 0, "SleeveTrade");
        assertGt(d.sleeveBuy.code.length, 0, "SleeveBuy");
        assertGt(d.sleeveSell.code.length, 0, "SleeveSell");
        assertEq(d.deployer, admin);
        assertEq(address(d.calendar.timelock()), address(d.timelock));
        assertEq(d.tokenSource.timelock(), address(d.timelock));
    }

    // run(): the guards before anything is broadcast

    /// One test, because it sets process environment variables the other tests do not read. The nonce guard reads
    /// the broadcaster's nonce at the RPC's latest block, as the mainnet run does.
    function test_run_guards_thenDeploysAndChecksEverything() public {
        _forkPinned(IN_SESSION_BLOCK);
        address broadcaster = tx.origin;

        vm.setEnv("SLEEVE_DEPLOYMENT_FILE", "foundry.toml");
        vm.setEnv("SLEEVE_DEPLOYER", vm.toString(broadcaster));
        vm.expectRevert(abi.encodeWithSelector(Deploy.AlreadyDeployed.selector, "foundry.toml"));
        deployScript.run();

        vm.setEnv("SLEEVE_DEPLOYMENT_FILE", "deployments/dry-run/does-not-exist.json");
        vm.setEnv("SLEEVE_DEPLOYER", vm.toString(DeployConfig.DEPLOYER));
        vm.expectRevert(
            abi.encodeWithSelector(Deploy.BroadcasterNotDeployer.selector, broadcaster, DeployConfig.DEPLOYER)
        );
        deployScript.run();

        vm.setEnv("SLEEVE_DEPLOYER", vm.toString(broadcaster));
        uint256 nonce = deployScript.chainNonce(broadcaster);
        vm.setEnv("SLEEVE_DEPLOYER_NONCE", vm.toString(nonce + 1));
        vm.expectRevert(abi.encodeWithSelector(Deploy.DeployerNonceMismatch.selector, broadcaster, nonce, nonce + 1));
        deployScript.run();

        vm.setEnv("SLEEVE_DEPLOYER_NONCE", vm.toString(nonce));
        Deployment memory d = deployScript.run();
        assertEq(d.deployer, broadcaster, "the broadcaster holds the roles");
        assertTrue(d.timelock.hasRole(d.timelock.PROPOSER_ROLE(), broadcaster));

        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Deploy.WrongChain.selector, 1, DeployConfig.CHAIN_ID));
        deployScript.run();
    }

    // The read-back catches what it exists to catch

    function test_readBack_catchesAMissingPool() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        TokenSource.TickerInit[] memory inits = DeployConfig.tickerInits();
        address[] memory aaplOnly500 = new address[](1);
        aaplOnly500[0] = DeployConfig.AAPL_POOL_500;
        inits[3].pools = aaplOnly500;
        d.tokenSource = new TokenSource(address(d.timelock), DeployConfig.USDG, DeployConfig.V3_FACTORY, inits);
        d.module = new SleeveModule(DeployConfig.moduleConfig(d.tokenSource, d.calendar));

        vm.expectRevert(abi.encodeWithSelector(DeployChecks.UnexpectedUint.selector, "AAPL pool count", 1, 2));
        readBack.checkDeployment(d);
    }

    function test_readBack_catchesAnotherKeeper() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        ISleeveModule.ModuleConfig memory config = DeployConfig.moduleConfig(d.tokenSource, d.calendar);
        config.defaultKeeper = makeAddr("another keeper");
        d.module = new SleeveModule(config);

        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChecks.UnexpectedAddress.selector,
                "module defaultKeeper",
                config.defaultKeeper,
                DeployConfig.KEEPER
            )
        );
        readBack.checkDeployment(d);
    }

    function test_readBack_catchesAModuleOfAnotherTokenSource() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        TokenSource other = new TokenSource(
            address(d.timelock), DeployConfig.USDG, DeployConfig.V3_FACTORY, DeployConfig.tickerInits()
        );
        d.module = new SleeveModule(DeployConfig.moduleConfig(other, d.calendar));

        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChecks.UnexpectedAddress.selector, "module tokenSource", address(other), address(d.tokenSource)
            )
        );
        readBack.checkDeployment(d);
    }

    /// A copy of SleeveTrade at another address passes as SleeveTrade, so the check reaches SleeveSell, whose link
    /// still holds the real one.
    function test_readBack_catchesALibraryLinkToAnotherAddress() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        address copy = makeAddr("SleeveTrade copy");
        bytes memory code = d.sleeveTrade.code;
        bytes20 copyAddress = bytes20(copy);
        for (uint256 i; i < 20; ++i) {
            code[1 + i] = copyAddress[i];
        }
        vm.etch(copy, code);
        address linked = d.sleeveTrade;
        d.sleeveTrade = copy;

        vm.expectRevert(
            abi.encodeWithSelector(DeployChecks.LinkMismatch.selector, "SleeveSell", "SleeveTrade", 4275, linked, copy)
        );
        readBack.checkDeployment(d);
    }

    function test_readBack_catchesChangedCode() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        bytes memory code = address(d.module).code;
        code[100] = bytes1(uint8(code[100]) ^ 0x01);
        vm.etch(address(d.module), code);

        vm.expectRevert(
            abi.encodeWithSelector(DeployChecks.BytecodeMismatch.selector, "SleeveModule", address(d.module), 100)
        );
        readBack.checkDeployment(d);
    }

    /// A proposer added through the timelock's own 48-hour operation is still a holder the launch configuration
    /// does not have: the role check and the event history both refuse it.
    function test_readBack_catchesARoleGrantedAfterTheDeploy() public {
        _forkPinned(IN_SESSION_BLOCK);
        vm.recordLogs();
        Deployment memory d = deployScript.deploy(admin);
        bytes memory grant = abi.encodeCall(IAccessControl.grantRole, (keccak256("PROPOSER_ROLE"), DeployConfig.KEEPER));
        vm.prank(admin);
        d.timelock.schedule(address(d.timelock), 0, grant, bytes32(0), bytes32(0), DeployConfig.TIMELOCK_MIN_DELAY);
        vm.warp(block.timestamp + DeployConfig.TIMELOCK_MIN_DELAY);
        vm.prank(admin);
        d.timelock.execute(address(d.timelock), 0, grant, bytes32(0), bytes32(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        vm.expectRevert(
            abi.encodeWithSelector(DeployChecks.UnexpectedFlag.selector, "an outsider holds a timelock role", true)
        );
        readBack.checkDeployment(d);
        (DeployChecks.RoleEvent[] memory events, bytes[] memory delays) =
            readBack.roleEventsIn(logs, address(d.timelock));
        vm.expectRevert(abi.encodeWithSelector(DeployChecks.RoleEventCount.selector, 5, 4));
        readBack.checkRoleEvents(d, events, delays);
    }

    /// The pre-deploy check and its printout of what it read, as docs/DEPLOY_PLAN.md runs it against the chain.
    function test_readBack_constantsPassAndReportAtThePinnedBlock() public {
        _forkPinned(IN_SESSION_BLOCK);
        readBack.constants();
    }

    function test_readBack_catchesASwappedFeed() public {
        _forkPinned(IN_SESSION_BLOCK);
        vm.mockCall(
            DeployConfig.SPY_FEED, abi.encodeCall(IAggregatorV3.description, ()), abi.encode("Robinhood QQQ / USD")
        );
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChecks.UnexpectedString.selector, "SPY feed description", "Robinhood QQQ / USD", "RHSPY / USD"
            )
        );
        readBack.checkConstants();
    }

    function test_readBack_catchesOtherCodeAtAConstantAddress() public {
        _forkPinned(IN_SESSION_BLOCK);
        bytes memory before = DeployConfig.SWAP_ROUTER_02.code;
        vm.etch(DeployConfig.SWAP_ROUTER_02, hex"00");
        vm.expectRevert(
            abi.encodeWithSelector(
                DeployChecks.WrongCode.selector,
                "SwapRouter02",
                DeployConfig.SWAP_ROUTER_02,
                keccak256(hex"00"),
                keccak256(before)
            )
        );
        readBack.checkConstants();
    }

    /// The record loader reads what script/record_deployment.py writes.
    function test_readBack_loadsTheDryRunRecordShape() public {
        _forkPinned(IN_SESSION_BLOCK);
        Deployment memory d = deployScript.deploy(admin);
        string memory json = _record(d);
        Deployment memory loaded = readBack.load(json);
        assertEq(abi.encode(loaded), abi.encode(d));
    }

    function _record(Deployment memory d) internal returns (string memory json) {
        string memory c = "contracts";
        vm.serializeString(c, "SleeveTrade", _entry("t", d.sleeveTrade));
        vm.serializeString(c, "SleeveBuy", _entry("b", d.sleeveBuy));
        vm.serializeString(c, "SleeveSell", _entry("s", d.sleeveSell));
        vm.serializeString(c, "SleeveTimelock", _entry("l", address(d.timelock)));
        vm.serializeString(c, "SessionCalendarExtension", _entry("c", address(d.calendar)));
        vm.serializeString(c, "TokenSource", _entry("o", address(d.tokenSource)));
        string memory contracts = vm.serializeString(c, "SleeveModule", _entry("m", address(d.module)));
        vm.serializeUint("record", "chainId", DeployConfig.CHAIN_ID);
        vm.serializeAddress("record", "deployer", d.deployer);
        json = vm.serializeString("record", "contracts", contracts);
    }

    function _entry(string memory key, address at) internal returns (string memory) {
        return vm.serializeAddress(key, "address", at);
    }
}
