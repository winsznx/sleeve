// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {
    Execution,
    IERC7579Execution,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModePayload,
    ModeSelector
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Kernel} from "kernel/Kernel.sol";
import {FactoryStaker} from "kernel/factory/FactoryStaker.sol";
import {KernelFactory} from "kernel/factory/KernelFactory.sol";
import {IEntryPoint} from "kernel/interfaces/IEntryPoint.sol";
import {IHook, IValidator} from "kernel/interfaces/IERC7579Modules.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {VALIDATION_MODE_DEFAULT, VALIDATION_TYPE_ROOT} from "kernel/types/Constants.sol";
import {ValidationId, ValidationMode, ValidationType} from "kernel/types/Types.sol";
import {ValidatorLib} from "kernel/utils/ValidationTypeLib.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {KernelV31} from "../spike/KernelV31.sol";
import {Chain4663} from "./Chain4663.sol";
import {ForkBase} from "./ForkBase.sol";

/// @notice The deployed Kernel v3.1 stack on chain 4663 for module fork tests: accounts from the deployed factory
/// with the deployed ECDSA validator as root (standing in for the passkey validator), root UserOps signed and sent
/// through the deployed EntryPoint v0.7 handleOps exactly as the G6 spike does (docs/research/g6-notes.md sections 3
/// to 7), both executor install paths, and the uninstall.
/// @dev Install paths. (a) initConfig: the account address commits to the install, and onInstall runs inside
/// Kernel.initialize; when the first UserOp carries the initCode, that is the validation phase, where ERC-7562 bars a
/// deploying UserOp of an unstaked factory from touching storage outside the account, and onInstall reads the USDG
/// proxy. (b) first UserOp: initCode without initConfig, callData installModule, so onInstall runs in the execution
/// phase. The app uses (b).
abstract contract KernelHelpers is ForkBase {
    IEntryPoint internal constant ENTRY_POINT = IEntryPoint(Chain4663.ENTRY_POINT_V07);
    KernelFactory internal constant KERNEL_FACTORY = KernelFactory(KernelV31.FACTORY);
    FactoryStaker internal constant META_FACTORY = FactoryStaker(KernelV31.META_FACTORY);

    uint128 internal constant VERIFICATION_GAS_LIMIT = 1_000_000;
    uint128 internal constant CALL_GAS_LIMIT = 1_000_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 100_000;
    /// @dev The account pays its own prefund: there is no paymaster in these tests.
    uint256 internal constant GAS_FUNDING = 0.01 ether;

    /// @dev Kernel's ModuleLib event: whether onUninstall succeeded. Kernel uninstalls either way.
    bytes32 internal constant MODULE_UNINSTALL_RESULT = keccak256("ModuleUninstallResult(address,bool)");
    bytes32 private constant USER_OPERATION_EVENT =
        keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");
    bytes32 private constant USER_OPERATION_REVERT_REASON =
        keccak256("UserOperationRevertReason(bytes32,address,uint256,bytes)");

    address internal bundler = makeAddr("bundler");

    /// @notice A UserOp's outcome, read from the EntryPoint's events, with every log of the handleOps call.
    struct OpResult {
        bytes32 userOpHash;
        bool success;
        bytes revertReason;
        uint256 actualGasUsed;
        uint256 actualGasCost;
        Vm.Log[] logs;
    }

    // Accounts

    /// @notice Kernel.initialize calldata: the ECDSA validator as root for `owner`, no root hook, and initConfig.
    function _initData(address owner, bytes[] memory initConfig) internal pure returns (bytes memory) {
        ValidationId root = ValidatorLib.validatorToIdentifier(IValidator(KernelV31.ECDSA_VALIDATOR));
        return abi.encodeCall(Kernel.initialize, (root, IHook(address(0)), abi.encodePacked(owner), "", initConfig));
    }

    /// @notice The counterfactual address, which commits to the owner, the salt and the initConfig.
    function _accountAddress(address owner, bytes32 salt, bytes[] memory initConfig) internal view returns (address) {
        return KERNEL_FACTORY.getAddress(_initData(owner, initConfig), salt);
    }

    /// @notice UserOp initCode in the SDK's default form, through the meta factory.
    function _initCode(address owner, bytes32 salt, bytes[] memory initConfig) internal pure returns (bytes memory) {
        return abi.encodePacked(
            address(META_FACTORY),
            abi.encodeCall(FactoryStaker.deployWithFactory, (KERNEL_FACTORY, _initData(owner, initConfig), salt))
        );
    }

    /// @notice An account without the module, deployed through the factory by a plain transaction.
    function _createAccount(address owner, bytes32 salt) internal returns (address account) {
        account = address(KERNEL_FACTORY.createAccount(_initData(owner, new bytes[](0)), salt));
        vm.deal(account, GAS_FUNDING);
    }

    // Executor install data

    /// @notice Kernel v3.1 executor initData: hook address(0), stored as the no-hook sentinel address(1), then
    /// abi.encode(executorData, hookData) with empty hookData.
    function _executorInitData(bytes memory moduleData) internal pure returns (bytes memory) {
        return abi.encodePacked(address(0), abi.encode(moduleData, bytes("")));
    }

    function _installCall(address module, bytes memory moduleData) internal pure returns (bytes memory) {
        return abi.encodeCall(Kernel.installModule, (MODULE_TYPE_EXECUTOR, module, _executorInitData(moduleData)));
    }

    function _uninstallCall(address module) internal pure returns (bytes memory) {
        return abi.encodeCall(Kernel.uninstallModule, (MODULE_TYPE_EXECUTOR, module, ""));
    }

    function _installConfig(address module, bytes memory moduleData) internal pure returns (bytes[] memory config) {
        config = new bytes[](1);
        config[0] = _installCall(module, moduleData);
    }

    // Install paths

    /// @notice Path (a) through a UserOp: the first UserOp's initCode deploys the account with the module in
    /// initConfig, so onInstall runs in the validation phase. The op's callData is empty.
    function _deployWithInitConfig(
        address owner,
        uint256 ownerKey,
        bytes32 salt,
        address module,
        bytes memory moduleData
    ) internal returns (address account, OpResult memory result) {
        bytes[] memory config = _installConfig(module, moduleData);
        account = _accountAddress(owner, salt, config);
        vm.deal(account, GAS_FUNDING);
        result = _handleOp(_rootUserOp(account, _initCode(owner, salt, config), "", ownerKey));
    }

    /// @notice Path (a) by a plain transaction: KernelFactory.createAccount is permissionless, so anyone can deploy
    /// the account with its initConfig outside a bundler (g6-notes gotcha 4).
    function _createAccountWithModule(address owner, bytes32 salt, address module, bytes memory moduleData)
        internal
        returns (address account)
    {
        account = address(KERNEL_FACTORY.createAccount(_initData(owner, _installConfig(module, moduleData)), salt));
        vm.deal(account, GAS_FUNDING);
    }

    /// @notice Path (b): the first UserOp's initCode deploys the account without initConfig and its callData installs
    /// the module, so onInstall runs in the execution phase. If the install reverts, the account stays deployed
    /// without the module.
    function _deployThenInstall(address owner, uint256 ownerKey, bytes32 salt, address module, bytes memory moduleData)
        internal
        returns (address account, OpResult memory result)
    {
        bytes[] memory noConfig = new bytes[](0);
        account = _accountAddress(owner, salt, noConfig);
        vm.deal(account, GAS_FUNDING);
        result = _handleOp(
            _rootUserOp(account, _initCode(owner, salt, noConfig), _installCall(module, moduleData), ownerKey)
        );
    }

    /// @notice Installs the module on a deployed account through a root UserOp.
    function _installThroughOp(address account, uint256 ownerKey, address module, bytes memory moduleData)
        internal
        returns (OpResult memory)
    {
        return _sendOp(account, ownerKey, _installCall(module, moduleData));
    }

    /// @notice Uninstalls through a root UserOp without a bracket, as any ERC-4337 client can (I11).
    function _uninstallThroughOp(address account, uint256 ownerKey, address module) internal returns (OpResult memory) {
        return _sendOp(account, ownerKey, _uninstallCall(module));
    }

    /// @notice A batch built without OwnerOps: the shape the app never sends (PRD 7.2, G6 item f).
    function _unbracketedBatch(Execution[] memory calls) internal pure returns (bytes memory) {
        bytes32 mode = Mode.unwrap(
            ERC7579Utils.encodeMode(
                ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
            )
        );
        return abi.encodeCall(IERC7579Execution.execute, (mode, ERC7579Utils.encodeBatch(calls)));
    }

    // UserOps

    /// @notice The SDK's nonce key for a root validator on EntryPoint v0.7: mode 0x00, type 0x00, the validator
    /// address, and a 2-byte parallel key.
    function _rootNonceKey(uint16 parallelKey) internal pure returns (uint192) {
        return ValidatorLib.encodeAsNonceKey(
            ValidationMode.unwrap(VALIDATION_MODE_DEFAULT),
            ValidationType.unwrap(VALIDATION_TYPE_ROOT),
            bytes20(KernelV31.ECDSA_VALIDATOR),
            parallelKey
        );
    }

    function _userOp(address sender, uint192 nonceKey, bytes memory initCode, bytes memory callData)
        internal
        view
        returns (PackedUserOperation memory)
    {
        return PackedUserOperation({
            sender: sender,
            nonce: ENTRY_POINT.getNonce(sender, nonceKey),
            initCode: initCode,
            callData: callData,
            accountGasLimits: bytes32(abi.encodePacked(VERIFICATION_GAS_LIMIT, CALL_GAS_LIMIT)),
            preVerificationGas: PRE_VERIFICATION_GAS,
            // First come first served ordering: no tip, and a fee cap of twice the base fee.
            gasFees: bytes32(abi.encodePacked(uint128(0), uint128(block.basefee * 2))),
            paymasterAndData: "",
            signature: ""
        });
    }

    /// @notice EIP-191 personal signature over the userOpHash, packed r, s, v: what the SDK sends for an ECDSA root.
    function _signUserOp(PackedUserOperation memory op, uint256 signerKey) internal view returns (bytes memory) {
        bytes32 userOpHash = ENTRY_POINT.getUserOpHash(op);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ECDSA.toEthSignedMessageHash(userOpHash));
        return abi.encodePacked(r, s, v);
    }

    function _rootUserOp(address sender, bytes memory initCode, bytes memory callData, uint256 ownerKey)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _userOp(sender, _rootNonceKey(0), initCode, callData);
        op.signature = _signUserOp(op, ownerKey);
    }

    /// @notice One root UserOp from a deployed account, sent alone.
    function _sendOp(address account, uint256 ownerKey, bytes memory callData) internal returns (OpResult memory) {
        return _handleOp(_rootUserOp(account, "", callData, ownerKey));
    }

    function _handleOp(PackedUserOperation memory op) internal returns (OpResult memory) {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        return _handleOps(ops)[0];
    }

    /// @notice One handleOps call from a bundler EOA, so one transaction for the whole bundle. The account is never
    /// pranked.
    function _handleOps(PackedUserOperation[] memory ops) internal returns (OpResult[] memory results) {
        results = new OpResult[](ops.length);
        for (uint256 i; i < ops.length; ++i) {
            results[i].userOpHash = ENTRY_POINT.getUserOpHash(ops[i]);
        }
        vm.recordLogs();
        vm.prank(bundler, bundler);
        ENTRY_POINT.handleOps(ops, payable(bundler));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < results.length; ++i) {
            results[i].logs = logs;
            bool seen;
            for (uint256 j; j < logs.length; ++j) {
                Vm.Log memory log = logs[j];
                if (log.emitter != address(ENTRY_POINT) || log.topics.length < 2) continue;
                if (log.topics[1] != results[i].userOpHash) continue;
                if (log.topics[0] == USER_OPERATION_EVENT) {
                    (, results[i].success, results[i].actualGasCost, results[i].actualGasUsed) =
                        abi.decode(log.data, (uint256, bool, uint256, uint256));
                    seen = true;
                } else if (log.topics[0] == USER_OPERATION_REVERT_REASON) {
                    (, results[i].revertReason) = abi.decode(log.data, (uint256, bytes));
                }
            }
            assertTrue(seen, "no UserOperationEvent");
        }
    }

    // Logs

    /// @notice Kernel's ModuleUninstallResult for the module in an op's logs.
    function _uninstallResult(OpResult memory result, address account, address module)
        internal
        pure
        returns (bool found, bool succeeded)
    {
        for (uint256 i; i < result.logs.length; ++i) {
            Vm.Log memory log = result.logs[i];
            if (log.emitter != account || log.topics.length == 0 || log.topics[0] != MODULE_UNINSTALL_RESULT) continue;
            (address uninstalled, bool ok) = abi.decode(log.data, (address, bool));
            if (uninstalled == module) return (true, ok);
        }
    }

    /// @notice Every log in an op's logs from `emitter` with topic 0 equal to `topic0`, in order.
    function _logsOf(OpResult memory result, address emitter, bytes32 topic0)
        internal
        pure
        returns (Vm.Log[] memory found)
    {
        uint256 count;
        for (uint256 i; i < result.logs.length; ++i) {
            if (_matches(result.logs[i], emitter, topic0)) ++count;
        }
        found = new Vm.Log[](count);
        count = 0;
        for (uint256 i; i < result.logs.length; ++i) {
            if (_matches(result.logs[i], emitter, topic0)) found[count++] = result.logs[i];
        }
    }

    function _matches(Vm.Log memory log, address emitter, bytes32 topic0) private pure returns (bool) {
        return log.emitter == emitter && log.topics.length > 0 && log.topics[0] == topic0;
    }
}
