// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    Execution,
    IERC7579Module,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {Kernel} from "kernel/Kernel.sol";
import {IEntryPoint} from "kernel/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkBase} from "../harness/SleeveModuleForkBase.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {TamperingAccount} from "../mocks/TamperingAccount.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice A contract that installs SleeveModule on itself (D-015). When the module hands it control through
/// executeFromExecutor it first makes one armed call, a nested EntryPoint.handleOps or a stand-in for it, then runs the
/// module's batch faithfully so its own buy passes.
contract AuditLockHolder {
    mapping(address module => bool) public isExecutor;
    address public armedTarget;
    bytes public armedCall;

    function install(address module, bytes calldata data) external {
        isExecutor[module] = true;
        IERC7579Module(module).onInstall(data);
    }

    function arm(address target, bytes calldata data) external {
        armedTarget = target;
        armedCall = data;
    }

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR && isExecutor[module];
    }

    function callModule(address module, bytes calldata data) external returns (bytes memory) {
        return Address.functionCall(module, data);
    }

    function executeFromExecutor(bytes32, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory results)
    {
        require(isExecutor[msg.sender], "not executor");
        address target = armedTarget;
        if (target != address(0)) {
            bytes memory data = armedCall;
            delete armedTarget;
            delete armedCall;
            Address.functionCall(target, data);
        }
        Execution[] calldata calls = ERC7579Utils.decodeBatch(executionCalldata);
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            results[i] = Address.functionCallWithValue(calls[i].target, calls[i].callData, calls[i].value);
        }
    }
}

/// @notice Stands in for EntryPoint.handleOps: runs an honest account's owner op and records a failed execution
/// instead of reverting.
contract AuditStandInBundler {
    MockAccount public victim;
    bytes public victimCall;
    bool public victimFailed;

    function deployVictim() external returns (MockAccount) {
        victim = new MockAccount();
        return victim;
    }

    function install(address module, bytes calldata data) external {
        victim.installModule(MODULE_TYPE_EXECUTOR, module, data);
    }

    function setCall(bytes calldata data) external {
        victimCall = data;
    }

    function run() external {
        (bool ok,) = address(victim).call(victimCall);
        victimFailed = !ok;
    }
}

/// @notice A contract that installs SleeveModule on itself and answers the buy batch without a swap: exactly amountIn
/// of USDG goes to a sink of its choosing and stock tokens come from a stash it controls, by mint or transferFrom.
contract AuditFakeFillAccount {
    IERC20 public immutable usdg;
    address public immutable token;
    address public immutable sink;
    address public immutable stash;
    uint256 public immutable fakeOut;

    constructor(IERC20 usdg_, address token_, address sink_, address stash_, uint256 fakeOut_) {
        usdg = usdg_;
        token = token_;
        sink = sink_;
        stash = stash_;
        fakeOut = fakeOut_;
    }

    function install(address module, bytes calldata data) external {
        IERC7579Module(module).onInstall(data);
    }

    function callModule(address module, bytes calldata data) external returns (bytes memory) {
        return Address.functionCall(module, data);
    }

    function isModuleInstalled(uint256 moduleTypeId, address, bytes calldata) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function executeFromExecutor(bytes32, bytes calldata executionCalldata) external payable returns (bytes[] memory) {
        Execution[] calldata calls = ERC7579Utils.decodeBatch(executionCalldata);
        (, uint256 amountIn) = abi.decode(calls[0].callData[4:], (address, uint256));
        require(usdg.transfer(sink, amountIn), "usdg");
        if (stash == address(0)) MockERC20(token).mint(address(this), fakeOut);
        else require(IERC20(token).transferFrom(stash, address(this), fakeOut), "token");
        return new bytes[](calls.length);
    }
}

/// @notice An account that buys honestly, so it holds a real lot, and then, once armed, answers the sell batch without
/// a swap: the tokens go to a sink and USDG is minted to itself at a price of its choosing.
contract AuditFakeSellAccount {
    mapping(address module => bool) public isExecutor;
    MockERC20 public immutable usdg;
    address public immutable sink;
    uint256 public fakeUsdg;

    constructor(MockERC20 usdg_, address sink_) {
        usdg = usdg_;
        sink = sink_;
    }

    function install(address module, bytes calldata data) external {
        isExecutor[module] = true;
        IERC7579Module(module).onInstall(data);
    }

    function armSale(uint256 fakeUsdg_) external {
        fakeUsdg = fakeUsdg_;
    }

    function callModule(address module, bytes calldata data) external returns (bytes memory) {
        return Address.functionCall(module, data);
    }

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR && isExecutor[module];
    }

    function executeFromExecutor(bytes32, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory results)
    {
        require(isExecutor[msg.sender], "not executor");
        Execution[] calldata calls = ERC7579Utils.decodeBatch(executionCalldata);
        results = new bytes[](calls.length);
        if (fakeUsdg != 0 && calls[0].target != address(usdg)) {
            (, uint256 amountIn) = abi.decode(calls[0].callData[4:], (address, uint256));
            require(IERC20(calls[0].target).transfer(sink, amountIn), "tokens");
            usdg.mint(address(this), fakeUsdg);
            return results;
        }
        for (uint256 i; i < calls.length; ++i) {
            results[i] = Address.functionCallWithValue(calls[i].target, calls[i].callData, calls[i].value);
        }
    }
}

/// @notice Audit round 1, account trust, after the fixes, without a fork: A1-21 (the reentrancy lock is per account, so
/// code another account runs inside its own buy no longer fails other accounts' calls, while every same-account
/// reentry still reverts), A1-23 (a buy or a sell must show the same fill on the allowlisted pool's balances) and A1-24
/// (onUninstall refuses while the account still lists the module).
contract AuditAccountTrustTest is SleeveModuleSellUnitBase {
    function setUp() public {
        _setUpSell();
    }

    // A1-21

    /// A self-registered contract's buy runs an honest account's bracketed owner op through a stand-in bundler while
    /// its lock is held: the op now goes through, where the module-wide lock made it revert.
    function test_A1_21_anotherAccountsOwnerOpRunsInsideABuy() public {
        AuditStandInBundler bundler = new AuditStandInBundler();
        MockAccount victim = bundler.deployVictim();
        usdg.mint(address(victim), INSTALLED);
        bundler.install(address(module), _installData(address(0), _defaultRule()));
        bundler.setCall(OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 10e6));
        AuditLockHolder attacker = new AuditLockHolder();
        usdg.mint(address(attacker), INSTALLED);
        attacker.install(address(module), _installData(address(0), _defaultRule()));
        _pay(address(attacker), PAYMENT);
        attacker.arm(address(bundler), abi.encodeCall(AuditStandInBundler.run, ()));

        (address pool, uint256 quote) = _splitInputs(address(attacker));
        vm.recordLogs();
        attacker.callModule(address(module), abi.encodeCall(ISleeveModule.split, (address(attacker), pool, quote)));
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.FILLED), "the outer buy filled");

        assertFalse(bundler.victimFailed(), "the victim's op is no longer blocked");
        assertEq(usdg.balanceOf(sink), 10e6, "and its transfer went out");
        (uint256 balance, uint256 spend,,) = module.ledger(address(victim));
        assertEq(spend, balance, "booked to the victim's spend by its own bracket");
    }

    /// The account itself still cannot reenter any writer of its own state from inside its buy: each call reverts
    /// AccountLocked(account), and so does the whole split.
    function test_A1_21_sameAccountReentryStillReverts() public {
        TamperingAccount account = new TamperingAccount();
        usdg.mint(address(account), INSTALLED);
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));
        _pay(address(account), PAYMENT);
        bytes memory locked = abi.encodeWithSelector(ISleeveModule.AccountLocked.selector, address(account));
        address pool = _pool(SPY);
        bytes[11] memory calls = [
            abi.encodeCall(ISleeveModule.beginOwnerOp, ()),
            abi.encodeCall(ISleeveModule.endOwnerOp, ()),
            abi.encodeCall(ISleeveModule.release, (0)),
            abi.encodeCall(ISleeveModule.setRule, (_defaultRule())),
            abi.encodeCall(ISleeveModule.pauseRule, ()),
            abi.encodeCall(ISleeveModule.setKeeper, (address(0))),
            abi.encodeCall(ISleeveModule.onUninstall, ("")),
            abi.encodeCall(ISleeveModule.observe, (address(account))),
            abi.encodeCall(ISleeveModule.split, (address(account), pool, 1)),
            abi.encodeCall(ISleeveModule.sell, (SPY, 1, 0, pool, 1, false, 0)),
            abi.encodeCall(ISleeveModule.reconcileLots, (SPY))
        ];
        for (uint256 i; i < calls.length; ++i) {
            account.setExtraCall(address(module), calls[i]);
            (address splitPool, uint256 quote) = _splitInputs(address(account));
            vm.prank(keeper);
            vm.expectRevert(locked);
            module.split(address(account), splitPool, quote);
        }
    }

    // A1-23

    /// A self-registered contract answers the buy batch with USDG to its own sink and minted tokens: the pool's
    /// balances never moved, so the split reverts FillNotFromPool and writes no FILLED receipt and no lot.
    function test_A1_23_fabricatedFillReverts() public {
        AuditFakeFillAccount fake =
            new AuditFakeFillAccount(IERC20(address(usdg)), address(tokens[SPY]), sink, address(0), 1e30);
        usdg.mint(address(fake), INSTALLED);
        fake.install(address(module), _installData(address(0), _defaultRule()));
        _pay(address(fake), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(fake));
        uint256 next = module.nextReceiptId();

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.FillNotFromPool.selector, pool, int256(0), int256(0)));
        fake.callModule(address(module), abi.encodeCall(ISleeveModule.split, (address(fake), pool, quote)));
        assertEq(module.nextReceiptId(), next, "no receipt");
    }

    /// The same binding for sells: an account with a real lot answers the sell batch by sending its tokens to a sink
    /// and minting itself USDG at twice the feed price. The pool's balances never moved, so the sell reverts
    /// FillNotFromPool and writes no SOLD receipt at a price no pool paid.
    function test_A1_23_fabricatedSaleReverts() public {
        AuditFakeSellAccount fake = new AuditFakeSellAccount(usdg, sink);
        usdg.mint(address(fake), INSTALLED);
        fake.install(address(module), _installData(address(0), _defaultRule()));
        _pay(address(fake), PAYMENT);
        uint256 lotId = _keeperSplit(address(fake));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.FILLED), "a real lot");

        fake.armSale(2 * LOT_USDG);
        address pool = _pool(SPY);
        uint256 quote = _sellQuote(LOT_TOKENS);
        uint256 next = module.nextReceiptId();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.FillNotFromPool.selector, pool, int256(0), int256(0)));
        fake.callModule(
            address(module), abi.encodeCall(ISleeveModule.sell, (SPY, LOT_TOKENS, 0, pool, quote, false, 0))
        );
        assertEq(module.nextReceiptId(), next, "no receipt");
        assertEq(module.lot(lotId).tokensRemaining, LOT_TOKENS, "the lot is untouched");
    }

    // A1-24

    /// A direct onUninstall from an account that still lists the module reverts ModuleStillListed and keeps the state.
    function test_A1_24_directOnUninstallRevertsWhileListed() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.ModuleStillListed.selector, address(account)));
        module.onUninstall("");
        assertTrue(module.isInitialized(address(account)), "state kept");
    }

    /// The executor uninstall still releases and deletes, because the account delists the module before it calls
    /// onUninstall.
    function test_A1_24_executorUninstallStillReleases() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        module.seedBucket(address(account), SPY, 30e6, Reason.SESSION);
        uint256 next = module.nextReceiptId();
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));
        assertFalse(module.isInitialized(address(account)));
        assertEq(module.nextReceiptId(), next + 1, "one RELEASED receipt");
    }
}

/// @notice A1-21 and A1-23 on chain 4663 forked at block 78,312,136, with the deployed EntryPoint v0.7 and Kernel
/// v3.1, real USDG, the real SPY token and its fee-500 pool, after the fixes.
contract AuditAccountTrustForkTest is SleeveModuleForkTradeBase {
    bytes32 private constant USER_OPERATION_EVENT =
        keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");

    function setUp() public {
        _setUpTrade();
    }

    /// A1-21: a self-registered contract calls EntryPoint.handleOps with an honest account's signed bracketed op from
    /// inside its own buy on the real SPY pool. The op now succeeds and its 10 USDG transfer happens, where the
    /// module-wide lock made it fail in execution and charged the victim for it.
    function test_fork_A1_21_nestedOwnerOpSucceedsInsideAnotherAccountsBuy() public {
        address victim =
            _installedAccount(address(module), bytes32(uint256(7)), 100e6, _installData(address(0), _defaultRule()));
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _rootUserOp(victim, "", OwnerOps.transferUsdg(address(module), USDG, recipient, 10e6), ownerKey);
        bytes32 opHash = ENTRY_POINT.getUserOpHash(ops[0]);
        AuditLockHolder attacker = new AuditLockHolder();
        attacker.install(address(module), _installData(address(0), _defaultRule()));
        _pay(address(attacker), PAYMENT);
        attacker.arm(address(ENTRY_POINT), abi.encodeCall(IEntryPoint.handleOps, (ops, payable(makeAddr("b")))));

        vm.recordLogs();
        attacker.callModule(
            address(module),
            abi.encodeCall(
                ISleeveModule.split,
                (address(attacker), LaunchConfig.SPY_POOL_500, _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY))
            )
        );
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(uint8(_onlyReceipt(logs).status), uint8(Status.FILLED), "the outer buy filled");
        (bool seen, bool success) = _opOutcome(logs, opHash);
        assertTrue(seen && success, "the victim's op ran and succeeded");
        assertEq(USDG.balanceOf(recipient), 10e6, "its transfer happened");
    }

    /// A1-23: the contract sends the equity USDG to its own sink and pulls real SPY from its own stash. The real
    /// pool's balances never move, so the split reverts FillNotFromPool where it used to write FILLED with a
    /// fabricated discount of more than half.
    function test_fork_A1_23_fabricatedFillOnTheRealSpyTokenReverts() public {
        address stash = makeAddr("whale");
        _pushPool(SPY, LaunchConfig.SPY_POOL_500, 1_000e6);
        uint256 stashed = IERC20(Chain4663.SPY).balanceOf(stash);
        assertGt(stashed, 0, "the stash holds real SPY");
        AuditFakeFillAccount fake =
            new AuditFakeFillAccount(USDG, Chain4663.SPY, makeAddr("attacker sink"), stash, stashed);
        vm.prank(stash);
        IERC20(Chain4663.SPY).approve(address(fake), stashed);
        fake.install(address(module), _installData(address(0), _defaultRule()));
        _pay(address(fake), PAYMENT);
        address pool = LaunchConfig.SPY_POOL_500;

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.FillNotFromPool.selector, pool, int256(0), int256(0)));
        fake.callModule(address(module), abi.encodeCall(ISleeveModule.split, (address(fake), pool, 1)));
    }

    function _opOutcome(Vm.Log[] memory logs, bytes32 opHash) private pure returns (bool seen, bool success) {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.emitter != address(ENTRY_POINT) || log.topics.length < 2 || log.topics[1] != opHash) continue;
            if (log.topics[0] == USER_OPERATION_EVENT) {
                (, success,,) = abi.decode(log.data, (uint256, bool, uint256, uint256));
                seen = true;
            }
        }
    }
}

/// @notice A1-24 on a Kernel v3.1 account at block 78,312,136: an uninstallModule of the hook type no longer wipes the
/// state while Kernel keeps the executor, so the next paycheck is split as usual.
contract AuditWrongTypeUninstallForkTest is SleeveModuleForkBase {
    function test_fork_A1_24_hookTypeUninstallKeepsTheStateAndSplitsStillRun() public {
        _setUpFork();
        SleeveModuleHarness module = _deployHarness();
        address account =
            _installedAccount(address(module), bytes32(0), 100e6, _installData(address(0), _defaultRule()));
        module.seedBucket(account, NVDA, 20e6, Reason.STALE);
        _pay(account, 20e6);

        OpResult memory result = _ownerOp(
            account,
            OwnerOps.single(
                address(module), account, abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (4, address(module), ""))
            )
        );
        assertTrue(result.success, "Kernel ignores the refused onUninstall");
        (bool found, bool ok) = _uninstallResult(result, account, address(module));
        assertTrue(found && !ok, "ModuleUninstallResult(module, false)");
        assertTrue(module.isInitialized(account), "state kept");
        assertTrue(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));

        _pay(account, 1_000e6);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, 100e6);
        vm.recordLogs();
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, quote);
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(vm.getRecordedLogs(), address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.FILLED), "the paycheck is split and bought");
    }
}
