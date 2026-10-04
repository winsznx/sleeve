// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    IERC7579Execution,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR,
    MODULE_TYPE_VALIDATOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {P256} from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import {Kernel} from "kernel/Kernel.sol";
import {IHook, IValidator} from "kernel/interfaces/IERC7579Modules.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {VALIDATION_MODE_DEFAULT, VALIDATION_TYPE_VALIDATOR} from "kernel/types/Constants.sol";
import {ValidationId, ValidationMode, ValidationType} from "kernel/types/Types.sol";
import {ValidatorLib} from "kernel/utils/ValidationTypeLib.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {KernelV31} from "../spike/KernelV31.sol";
import {Chain4663} from "../utils/Chain4663.sol";

/// @dev The deployed ECDSA validator's per-account owner.
interface IEcdsaValidatorOwner {
    function ecdsaValidatorStorage(address account) external view returns (address owner);
}

/// @notice I11 through a recovery signer (docs/CLAIM_LEDGER.md 4.6), on chain 4663 forked at block 78,312,136. The
/// account is the one the app builds for a passkey owner who adds a recovery wallet: the deployed passkey validator
/// as root, and the deployed ECDSA validator as a secondary validator owned by the recovery wallet, allowed to call
/// Kernel's execute, installed with exactly the calldata of the app's installRecoverySignerCall
/// (app/src/lib/chain/kernel.ts, docs/research/zerodev-passkey.md section 9.3). The passkey never signs here: every
/// UserOp, the setup's and the exit's, goes through the recovery validator's own nonce key, signed by the recovery key,
/// through EntryPoint v0.7 handleOps, with no keeper, no app and no Sleeve helper, as a lost passkey and an offline
/// Sleeve leave it.
/// @dev The app installs the recovery validator by a passkey-signed owner op after the account exists. A fork cannot
/// produce a passkey signature, so initConfig installs it, and the Sleeve module, when the factory deploys the account;
/// the install calldata is the app's byte for byte.
contract SleeveI11RecoveryForkTest is SleeveModuleForkTradeBase {
    /// @dev ERC-7579 single call, default exec type.
    bytes32 private constant SINGLE = bytes32(0);
    uint128 private constant HIGH_CLIP = 500e6;
    /// @dev The passkey validator Sleeve uses on chain 4663 (WEBAUTHN_VALIDATOR in app/src/lib/chain/kernel.ts).
    address private constant WEBAUTHN_VALIDATOR = 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69;

    address private account;
    address private recovery;
    uint256 private recoveryKey;
    address private exit = makeAddr("recovery wallet's destination");

    function setUp() public {
        _setUpTrade();
        (recovery, recoveryKey) = makeAddrAndKey("recovery wallet");
        account = _passkeyAccountWithRecovery(keccak256("I11 recovery"));
        _pay(account, PAYMENT);

        _recoveryOp(_single(address(module), abi.encodeCall(ISleeveModule.setKeeper, (address(0)))), "keeper to zero");
        assertEq(module.keeperOf(account), address(0), "no keeper");

        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        OpResult memory filled = _recoveryOp(
            _single(address(module), abi.encodeCall(ISleeveModule.split, (account, LaunchConfig.SPY_POOL_500, quote))),
            "split by the recovery signer"
        );
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(filled.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.FILLED), "a lot to take away");
        assertEq(uint8(receipts[0].trigger), uint8(Trigger.OWNER), "the account itself called");

        ISleeveModule.RuleInput memory clipped = _defaultRule();
        clipped.minClip = HIGH_CLIP;
        _recoveryOp(_single(address(module), abi.encodeCall(ISleeveModule.setRule, (clipped))), "clip above the part");
        _pay(account, PAYMENT);
        OpResult memory queued = _recoveryOp(
            _single(address(module), abi.encodeCall(ISleeveModule.split, (account, LaunchConfig.SPY_POOL_500, quote))),
            "split into the bucket"
        );
        receipts = _receiptsIn(queued.logs, address(module));
        assertEq(uint8(receipts[0].status), uint8(Status.QUEUED));
        assertEq(uint8(receipts[0].reason), uint8(Reason.CLIP));
        assertEq(module.bucketOf(account, SPY).amount, EQUITY, "a bucket to release");

        _recoveryOp(_single(address(module), abi.encodeCall(ISleeveModule.pauseRule, ())), "pause the rule");
        vm.warp(block.timestamp + 36 hours);
    }

    /// The account is what the app builds: a passkey root, and the recovery wallet as the ECDSA validator's owner with
    /// Kernel's execute and nothing else.
    function test_I11_fork_recoverySignerIsASecondaryValidatorLimitedToExecute() public view {
        ValidationId passkeyRoot = ValidatorLib.validatorToIdentifier(IValidator(WEBAUTHN_VALIDATOR));
        ValidationId recoveryId = ValidatorLib.validatorToIdentifier(IValidator(KernelV31.ECDSA_VALIDATOR));
        assertEq(ValidationId.unwrap(Kernel(payable(account)).rootValidator()), ValidationId.unwrap(passkeyRoot));
        assertEq(IEcdsaValidatorOwner(KernelV31.ECDSA_VALIDATOR).ecdsaValidatorStorage(account), recovery);
        assertTrue(Kernel(payable(account)).isAllowedSelector(recoveryId, IERC7579Execution.execute.selector));
        assertFalse(Kernel(payable(account)).isAllowedSelector(recoveryId, IERC7579ModuleConfig.installModule.selector));
        assertFalse(
            Kernel(payable(account)).isAllowedSelector(recoveryId, IERC7579ModuleConfig.uninstallModule.selector)
        );
    }

    /// I11 by the recovery signer alone, with stale feeds, a paused rule and no keeper: release the bucket, take every
    /// USDG and every Stock Token out in plain transfers, as a wallet outside Sleeve sends them, and remove the module.
    /// The account ends with no USDG, no SPY and no module state.
    function test_I11_fork_recoverySignerExitsWithoutSleeveOrThePasskey() public {
        uint256 lotTokens = IERC20(Chain4663.SPY).balanceOf(account);
        assertGt(lotTokens, 0);

        OpResult memory released =
            _recoveryOp(_single(address(module), abi.encodeCall(ISleeveModule.release, (SPY))), "release");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(released.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.RELEASED));
        assertEq(uint8(receipts[0].trigger), uint8(Trigger.OWNER));
        assertEq(receipts[0].usdgToSpend, EQUITY);

        uint256 balance = USDG.balanceOf(account);
        assertEq(balance, 2 * PAYMENT - EQUITY, "two payments less the fill");
        _recoveryOp(_single(Chain4663.USDG, abi.encodeCall(IERC20.transfer, (exit, balance))), "withdraw every USDG");
        _recoveryOp(_single(Chain4663.SPY, abi.encodeCall(IERC20.transfer, (exit, lotTokens))), "tokens out");
        OpResult memory uninstalled = _recoveryOp(
            _single(
                account,
                abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
            ),
            "uninstall"
        );
        (bool found, bool succeeded) = _uninstallResult(uninstalled, account, address(module));
        assertTrue(found && succeeded, "onUninstall succeeded");

        assertEq(USDG.balanceOf(account), 0, "no USDG left in the account");
        assertEq(IERC20(Chain4663.SPY).balanceOf(account), 0, "no SPY left in the account");
        assertEq(USDG.balanceOf(exit), balance, "every USDG reached the recovery wallet's destination");
        assertEq(IERC20(Chain4663.SPY).balanceOf(exit), lotTokens, "every token reached it");
        assertFalse(module.isInitialized(account), "module state deleted");
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        (uint256 ledgerBalance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(ledgerBalance + spend + pendingTotal + unsorted, 0);
        assertEq(module.bucketOf(account, SPY).amount, 0);
        _assertHoldsNothingAtAll(address(module));
    }

    // Helpers

    /// @notice The factory deploys the account with the passkey root, the recovery validator and the module.
    function _passkeyAccountWithRecovery(bytes32 salt) private returns (address deployed) {
        bytes[] memory config = new bytes[](2);
        config[0] = _installRecoverySignerCall(recovery);
        config[1] = _installCall(address(module), _installData(address(0), _defaultRule()));
        bytes memory initData = abi.encodeCall(
            Kernel.initialize,
            (
                ValidatorLib.validatorToIdentifier(IValidator(WEBAUTHN_VALIDATOR)),
                IHook(address(0)),
                // The P-256 generator as the passkey's key: a valid point the validator stores and never checks here.
                abi.encode(P256.GX, P256.GY, keccak256("a credential id")),
                "",
                config
            )
        );
        deployed = address(KERNEL_FACTORY.createAccount(initData, salt));
        vm.deal(deployed, GAS_FUNDING);
    }

    /// @notice installRecoverySignerCall: Kernel's installModule for the ECDSA validator as a validator, hook address(0),
    /// then abi.encode(validatorData = the recovery address, hookData = empty, selectorData = execute's selector).
    function _installRecoverySignerCall(address recoveryOwner) private pure returns (bytes memory) {
        return abi.encodeCall(
            Kernel.installModule,
            (
                MODULE_TYPE_VALIDATOR,
                KernelV31.ECDSA_VALIDATOR,
                abi.encodePacked(
                    address(0),
                    abi.encode(
                        abi.encodePacked(recoveryOwner), bytes(""), abi.encodePacked(IERC7579Execution.execute.selector)
                    )
                )
            )
        );
    }

    /// @notice The recovery validator's nonce key: mode 0x00, type 0x01 (a validator, not the root), the ECDSA
    /// validator's address and parallel key 0, `0x00 01 845a...ce57 0000` in zerodev-passkey.md 9.3.
    function _recoveryNonceKey() private pure returns (uint192) {
        return ValidatorLib.encodeAsNonceKey(
            ValidationMode.unwrap(VALIDATION_MODE_DEFAULT),
            ValidationType.unwrap(VALIDATION_TYPE_VALIDATOR),
            bytes20(KernelV31.ECDSA_VALIDATOR),
            0
        );
    }

    /// @dev One UserOp signed by the recovery key through the secondary validator, which must succeed.
    function _recoveryOp(bytes memory callData, string memory what) private returns (OpResult memory result) {
        PackedUserOperation memory op = _userOp(account, _recoveryNonceKey(), "", callData);
        op.signature = _signUserOp(op, recoveryKey);
        result = _handleOp(op);
        if (!result.success) emit log_named_bytes(what, result.revertReason);
        assertTrue(result.success, what);
    }

    function _single(address target, bytes memory data) private pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (SINGLE, abi.encodePacked(target, uint256(0), data)));
    }
}
