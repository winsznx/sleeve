// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Kernel} from "kernel/Kernel.sol";
import {IExecutor} from "kernel/interfaces/IERC7579Modules.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {SleeveModuleForkBase} from "../harness/SleeveModuleForkBase.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice The install snapshot (I5) on a forked Kernel v3.1 account at block 78,312,136, for both install paths:
/// (a) the module in Kernel's initConfig, through the first UserOp's initCode or a plain factory call, and (b) the
/// first UserOp deploying without initConfig and installing in its callData. USDG paid to the counterfactual address
/// before deployment is never unsorted; a payment after the install is exactly unsorted. Also: the uninstall and a
/// reinstall's fresh snapshot, and what a failed path (b) install leaves.
contract SleeveModuleInstallForkTest is SleeveModuleForkBase {
    bytes32 private constant SALT = bytes32(uint256(4663));
    /// @dev EntryPoint v0.7 emits it between the validation loop and the execution loop of handleOps.
    bytes32 private constant BEFORE_EXECUTION = keccak256("BeforeExecution()");
    uint256 private constant PREFUNDED = 250e6;
    uint256 private constant PAYMENT = 40e6;

    SleeveModule private module;

    function setUp() public {
        _setUpFork();
        module = _deployModule();
    }

    function test_fork_constructorChecksPassOnTheRealUsdgAndFeed() public view {
        assertEq(IERC20Metadata(Chain4663.USDG).decimals(), 6);
        assertEq(IAggregatorV3(Chain4663.USDG_USD_FEED).decimals(), 8);
        assertEq(tokenSource.usdg(), Chain4663.USDG);
        assertEq(address(module.usdg()), Chain4663.USDG);
        assertEq(address(module.swapRouter()), Chain4663.SWAP_ROUTER_02);
        assertEq(module.disclosureHash(), DISCLOSURE_HASH);
        assertEq(module.grace(), 3_600);
    }

    // Path (a): initConfig

    /// The address commits to the install. onInstall runs inside Kernel.initialize while the initCode deploys the
    /// account, which is the validation phase: the module's Installed event comes before BeforeExecution.
    function test_I5_fork_initConfigInTheFirstUserOp_snapshotsUsdgPaidBeforeDeployment() public {
        bytes[] memory config = _installConfig(address(module), "");
        address predicted = _accountAddress(owner, SALT, config);
        assertTrue(predicted != _accountAddress(owner, SALT, new bytes[](0)), "the address commits to initConfig");
        _pay(predicted, PREFUNDED);

        (address account, OpResult memory result) = _deployWithInitConfig(owner, ownerKey, SALT, address(module), "");

        assertTrue(result.success, "deploying UserOp");
        assertEq(account, predicted);
        assertTrue(_logIndex(result, address(module), ISleeveModule.Installed.selector) < _beforeExecution(result));
        _assertInstalledWithSnapshot(account, PREFUNDED);
        _pay(account, PAYMENT);
        _assertLedger(account, PREFUNDED + PAYMENT, PREFUNDED, 0, PAYMENT);
        _assertHoldsNothing(address(module));
    }

    /// The same initConfig through KernelFactory.createAccount in a plain transaction, outside any bundler.
    function test_I5_fork_initConfigThroughTheFactory_snapshotsUsdgPaidBeforeDeployment() public {
        address predicted = _accountAddress(owner, SALT, _installConfig(address(module), ""));
        _pay(predicted, PREFUNDED);

        address account = _createAccountWithModule(owner, SALT, address(module), "");

        assertEq(account, predicted);
        _assertInstalledWithSnapshot(account, PREFUNDED);
        _pay(account, PAYMENT);
        _assertLedger(account, PREFUNDED + PAYMENT, PREFUNDED, 0, PAYMENT);
    }

    // Path (b): the first UserOp installs in its execution phase

    /// The path the app uses: the address commits to the owner only, and onInstall runs after BeforeExecution, so
    /// ERC-7562's validation-phase storage rules never see its USDG read.
    function test_I5_fork_firstUserOpInstall_snapshotsUsdgPaidBeforeDeployment() public {
        address predicted = _accountAddress(owner, SALT, new bytes[](0));
        _pay(predicted, PREFUNDED);
        address ownKeeper = makeAddr("own keeper");

        (address account, OpResult memory result) =
            _deployThenInstall(owner, ownerKey, SALT, address(module), _installData(ownKeeper, _defaultRule()));

        assertTrue(result.success, "deploying UserOp");
        assertEq(account, predicted);
        assertTrue(_logIndex(result, address(module), ISleeveModule.Installed.selector) > _beforeExecution(result));
        _assertInstalledWithSnapshot(account, PREFUNDED);
        assertEq(module.keeperOf(account), ownKeeper);
        ISleeveModule.Rule memory rule = module.ruleOf(account);
        assertEq(rule.version, 1);
        assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.ACTIVE));
        assertEq(rule.equityBps, 1_000);
        _pay(account, PAYMENT);
        _assertLedger(account, PREFUNDED + PAYMENT, PREFUNDED, 0, PAYMENT);
        _assertHoldsNothing(address(module));
    }

    /// A path (b) install that reverts still deploys the account, since the deployment is part of validation. The
    /// app must read isInitialized before it shows the payment address.
    function test_fork_firstUserOpInstall_thatRevertsLeavesTheAccountWithoutTheModule() public {
        ISleeveModule.RuleInput memory invalid = _defaultRule();
        invalid.spendBps = 9_500;

        (address account, OpResult memory result) =
            _deployThenInstall(owner, ownerKey, SALT, address(module), _installData(address(0), invalid));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, 9_500, 1_000));
        assertGt(account.code.length, 0, "deployed");
        assertEq(Kernel(payable(account)).accountId(), "kernel.advanced.v0.3.1");
        assertFalse(module.isInitialized(account));
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
    }

    // Uninstall and reinstall

    function test_I5_fork_reinstallAfterABracketedUninstallTakesAFreshSnapshot() public {
        address account = _installedAccount(address(module), SALT, 100e6, _installData(address(0), _defaultRule()));
        _pay(account, 20e6);
        _assertLedger(account, 120e6, 100e6, 0, 20e6);

        OpResult memory uninstalled = _ownerOp(account, OwnerOps.uninstall(address(module), account));
        assertTrue(uninstalled.success, "bracketed uninstall");
        (bool found, bool succeeded) = _uninstallResult(uninstalled, account, address(module));
        assertTrue(found && succeeded, "ModuleUninstallResult(module, true)");
        assertFalse(module.isInitialized(account));
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        _pay(account, 30e6);

        assertTrue(_installThroughOp(account, ownerKey, address(module), "").success, "reinstall");

        _assertLedger(account, 150e6, 150e6, 0, 0);
        assertEq(module.ruleOf(account).version, 0, "the old rule is gone");
        assertEq(module.keeperOf(account), keeper);
        _pay(account, PAYMENT);
        _assertLedger(account, 150e6 + PAYMENT, 150e6, 0, PAYMENT);
    }

    function test_fork_installedAccountListsTheModuleWithTheNoHookSentinel() public {
        address account = _installedAccount(address(module), SALT, 0, "");
        assertTrue(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        assertEq(address(Kernel(payable(account)).executorConfig(IExecutor(address(module))).hook), address(1));
        assertTrue(module.isModuleType(MODULE_TYPE_EXECUTOR));
        assertTrue(module.isInitialized(account));
    }

    // Helpers

    function _assertInstalledWithSnapshot(address account, uint256 balance) private view {
        assertTrue(module.isInitialized(account), "module initialized");
        assertTrue(
            Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""), "account lists it"
        );
        _assertLedger(account, balance, balance, 0, 0);
    }

    function _assertLedger(address account, uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
        private
        view
    {
        (uint256 actualBalance, uint256 actualSpend, uint256 actualPending, uint256 actualUnsorted) =
            module.ledger(account);
        assertEq(actualBalance, balance, "balance");
        assertEq(actualSpend, spend, "spend");
        assertEq(actualPending, pendingTotal, "pendingTotal");
        assertEq(actualUnsorted, unsorted, "I5: unsorted");
    }

    function _beforeExecution(OpResult memory result) private pure returns (uint256) {
        return _logIndex(result, address(ENTRY_POINT), BEFORE_EXECUTION);
    }

    function _logIndex(OpResult memory result, address emitter, bytes32 topic0) private pure returns (uint256) {
        for (uint256 i; i < result.logs.length; ++i) {
            Vm.Log memory log = result.logs[i];
            if (log.emitter == emitter && log.topics.length > 0 && log.topics[0] == topic0) return i;
        }
        revert("log not found");
    }
}
