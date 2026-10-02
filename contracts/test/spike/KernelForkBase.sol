// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ForkBase} from "../utils/ForkBase.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {KernelV31} from "./KernelV31.sol";

import {Kernel} from "kernel/Kernel.sol";
import {KernelFactory} from "kernel/factory/KernelFactory.sol";
import {FactoryStaker} from "kernel/factory/FactoryStaker.sol";
import {IEntryPoint} from "kernel/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {IHook, IValidator} from "kernel/interfaces/IERC7579Modules.sol";
import {ExecLib} from "kernel/utils/ExecLib.sol";
import {ValidatorLib} from "kernel/utils/ValidationTypeLib.sol";
import {ValidationId, ValidationMode, ValidationType} from "kernel/types/Types.sol";
import {Execution} from "kernel/types/Structs.sol";
import {VALIDATION_MODE_DEFAULT, VALIDATION_TYPE_ROOT} from "kernel/types/Constants.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";

/// @notice Fork helpers for the deployed Kernel v3.1 stack on chain 4663: accounts created through the deployed
/// factory, and root-validator UserOps sent through the deployed EntryPoint v0.7 handleOps.
/// @dev The UserOp builder and signer reimplement Kernel's own helpers at the v3.1 tag, KernelTestBase._prepareUserOp
/// and ECDSAValidatorTest._rootSignUserOp. KernelTestBase cannot be inherited for this: its setUp is not virtual and
/// deploys its own Kernel implementation and factories, and it carries 17 of Kernel's own tests. See g6-notes.md.
abstract contract KernelForkBase is ForkBase {
    IEntryPoint internal constant ENTRY_POINT = IEntryPoint(Chain4663.ENTRY_POINT_V07);
    KernelFactory internal constant FACTORY = KernelFactory(KernelV31.FACTORY);
    FactoryStaker internal constant META_FACTORY = FactoryStaker(KernelV31.META_FACTORY);

    uint128 internal constant VERIFICATION_GAS_LIMIT = 1_000_000;
    uint128 internal constant CALL_GAS_LIMIT = 1_000_000;
    uint256 internal constant PRE_VERIFICATION_GAS = 100_000;

    bytes32 private constant USER_OPERATION_EVENT =
        keccak256("UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)");
    bytes32 private constant USER_OPERATION_REVERT_REASON =
        keccak256("UserOperationRevertReason(bytes32,address,uint256,bytes)");

    address internal bundler = makeAddr("bundler");

    struct OpResult {
        bytes32 userOpHash;
        bool success;
        bytes revertReason;
        uint256 actualGasUsed;
        uint256 actualGasCost;
        Vm.Log[] logs;
    }

    function _rootValidation() internal pure returns (ValidationId) {
        return ValidatorLib.validatorToIdentifier(IValidator(KernelV31.ECDSA_VALIDATOR));
    }

    /// Kernel.initialize calldata with the ECDSA validator as root, no root hook and no init config.
    function _initData(address owner) internal pure returns (bytes memory) {
        return abi.encodeCall(
            Kernel.initialize, (_rootValidation(), IHook(address(0)), abi.encodePacked(owner), "", new bytes[](0))
        );
    }

    /// UserOp initCode in the SDK's default form: meta factory, then deployWithFactory(factory, initData, salt).
    function _metaFactoryInitCode(address owner, bytes32 salt) internal pure returns (bytes memory) {
        return abi.encodePacked(
            address(META_FACTORY), abi.encodeCall(FactoryStaker.deployWithFactory, (FACTORY, _initData(owner), salt))
        );
    }

    function _createAccount(address owner, bytes32 salt) internal returns (Kernel) {
        return Kernel(payable(FACTORY.createAccount(_initData(owner), salt)));
    }

    /// EntryPoint v0.7 getSenderAddress always reverts with SenderAddressResult(sender). The SDK derives the
    /// counterfactual address this way.
    function _senderAddress(bytes memory initCode) internal returns (address sender) {
        try ENTRY_POINT.getSenderAddress(initCode) {
            revert("getSenderAddress returned");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), IEntryPoint.SenderAddressResult.selector, "unexpected getSenderAddress revert");
            assembly ("memory-safe") {
                sender := mload(add(reason, 36))
            }
        }
    }

    /// Nonce key in the layout the ZeroDev SDK builds for a root (sudo) validator on EntryPoint v0.7:
    /// 1 byte mode 0x00, 1 byte type 0x00, 20 bytes validator address, 2 bytes parallel key. Kernel ignores the
    /// address bytes for type 0x00, so key 0 also validates, on its own nonce sequence.
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
            // Arbitrum ordering has no priority auction, so the tip is zero and the cap is twice the base fee.
            gasFees: bytes32(abi.encodePacked(uint128(0), uint128(block.basefee * 2))),
            paymasterAndData: "",
            signature: ""
        });
    }

    /// As ECDSAValidatorTest._rootSignUserOp at the v3.1 tag, and as the SDK signs: an EIP-191 personal
    /// signature over the userOpHash, packed r, s, v, with no prefix. Root mode lives in the nonce key in v3.
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

    /// Sends one UserOp through handleOps from a bundler EOA and reads its outcome from the EntryPoint's events.
    function _handleOp(PackedUserOperation memory op) internal returns (OpResult memory) {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        return _handleOps(ops)[0];
    }

    /// One handleOps call, so one transaction, for the whole bundle.
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

    function _execute(Kernel account, uint256 ownerKey, bytes memory callData) internal returns (OpResult memory) {
        return _handleOp(_rootUserOp(address(account), "", callData, ownerKey));
    }

    function _emitted(Vm.Log[] memory logs, address emitter, bytes32 topic0, bytes memory data)
        internal
        pure
        returns (bool)
    {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == emitter && logs[i].topics.length > 0 && logs[i].topics[0] == topic0
                    && keccak256(logs[i].data) == keccak256(data)
            ) return true;
        }
        return false;
    }

    function _singleCall(address target, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(Kernel.execute, (ExecLib.encodeSimpleSingle(), ExecLib.encodeSingle(target, 0, data)));
    }

    function _batchCall(Execution[] memory calls) internal pure returns (bytes memory) {
        return abi.encodeCall(Kernel.execute, (ExecLib.encodeSimpleBatch(), ExecLib.encodeBatch(calls)));
    }
}
