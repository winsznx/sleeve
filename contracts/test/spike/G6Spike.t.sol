// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

import {Kernel} from "kernel/Kernel.sol";
import {ValidationManager} from "kernel/core/ValidationManager.sol";
import {ECDSAValidator} from "kernel/validator/ECDSAValidator.sol";
import {MockExecutor} from "kernel/mock/MockExecutor.sol";
import {MockHook} from "kernel/mock/MockHook.sol";
import {IEntryPoint} from "kernel/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {IERC7579Account} from "kernel/interfaces/IERC7579Account.sol";
import {IExecutor, IHook, IValidator} from "kernel/interfaces/IERC7579Modules.sol";
import {ExecLib} from "kernel/utils/ExecLib.sol";
import {ValidatorLib} from "kernel/utils/ValidationTypeLib.sol";
import {
    ValidationId,
    ValidationMode,
    ValidationType,
    ExecMode,
    ExecModeSelector,
    ExecModePayload
} from "kernel/types/Types.sol";
import {Execution} from "kernel/types/Structs.sol";
import {
    CALLTYPE_SINGLE,
    CALLTYPE_BATCH,
    CALLTYPE_STATIC,
    EXECTYPE_DEFAULT,
    EXECTYPE_TRY,
    VALIDATION_MODE_DEFAULT,
    VALIDATION_TYPE_VALIDATOR,
    MODULE_TYPE_VALIDATOR,
    MODULE_TYPE_EXECUTOR,
    ERC1967_IMPLEMENTATION_SLOT
} from "kernel/types/Constants.sol";

import {Chain4663} from "../utils/Chain4663.sol";
import {KernelForkBase} from "./KernelForkBase.sol";
import {KernelV31} from "./KernelV31.sol";
import {SpikeModule} from "./SpikeModule.sol";
import {
    InflowHelper,
    ForeignCaller,
    TransientProbe,
    StubbornExecutor,
    GasBurningExecutor,
    InstallOrderProbe,
    SelfRegisteredCaller
} from "./SpikeHelpers.sol";

/// @title G6 spike
/// @notice Proves a Sleeve-style ERC-7579 executor with owner-batch brackets on the Kernel v3.1 stack that ZeroDev
/// deploys on chain 4663. Each test forks IN_SESSION_BLOCK and drives the deployed EntryPoint v0.7, Kernel factory,
/// implementation and ECDSA validator. test_G6_a to test_G6_j map to internal/PROMPT_00_G6_SPIKE.md. The
/// test_recipe tests back the recipe in docs/research/g6-notes.md.
contract G6SpikeTest is KernelForkBase {
    IERC20 internal constant USDG = IERC20(Chain4663.USDG);
    uint256 internal constant FUNDING = 100e6;
    uint256 internal constant GAS_FUNDING = 0.01 ether;

    address internal constant P256_VERIFY = 0x0000000000000000000000000000000000000100;
    string internal constant DEFAULT_LIVE_RPC = "https://rpc.mainnet.chain.robinhood.com";
    /// go-ethereum core/vm/testdata/precompiles/p256Verify.json, vector "CallP256Verify", expected output 1.
    /// Layout: hash, r, s, x, y, 32 bytes each.
    string internal constant P256_VALID =
        "0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4da73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d604aebd3099c618202fcfe16ae7770b0c49ab5eadf74b754204a3bb6060e44eff37618b065f9832de4ca6ca971a7a1adc826d0f7c00181a5fb2ddf79ae00b4e10e";
    /// The same vector with the low bit of the hash flipped.
    string internal constant P256_TAMPERED =
        "0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4ca73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d604aebd3099c618202fcfe16ae7770b0c49ab5eadf74b754204a3bb6060e44eff37618b065f9832de4ca6ca971a7a1adc826d0f7c00181a5fb2ddf79ae00b4e10e";
    /// Init code: PUSH1 0x2a PUSH1 0 TSTORE PUSH1 0 TLOAD PUSH1 0 MSTORE PUSH1 0x20 PUSH1 0 RETURN.
    string internal constant TSTORE_TLOAD_INIT_CODE = "0x602a60005d60005c60005260206000f3";

    bytes32 internal constant MODULE_UNINSTALL_RESULT = keccak256("ModuleUninstallResult(address,bool)");
    /// USDG's custom error for a transfer above the balance, InsufficientFunds().
    bytes4 internal constant USDG_INSUFFICIENT_FUNDS = 0x356680b7;

    address internal owner;
    uint256 internal ownerKey;
    address internal operator = makeAddr("operator");
    address internal recipient = makeAddr("recipient");
    address internal stranger = makeAddr("stranger");

    SpikeModule internal module;

    function setUp() public {
        _fork(IN_SESSION_BLOCK);
        (owner, ownerKey) = makeAddrAndKey("owner");
        module = new SpikeModule(USDG);

        vm.label(address(ENTRY_POINT), "EntryPointV07");
        vm.label(KernelV31.FACTORY, "KernelFactoryV31");
        vm.label(KernelV31.META_FACTORY, "FactoryStaker");
        vm.label(KernelV31.IMPLEMENTATION, "KernelV31");
        vm.label(KernelV31.ECDSA_VALIDATOR, "ECDSAValidator");
        vm.label(address(USDG), "USDG");
    }

    // ---------------------------------------------------------------- items

    function test_G6_a_createAccountThroughDeployedFactory() public {
        bytes32 salt = bytes32(0);
        address predicted = FACTORY.getAddress(_initData(owner), salt);
        assertEq(predicted.code.length, 0, "address already in use");
        assertEq(_senderAddress(_metaFactoryInitCode(owner, salt)), predicted, "SDK derivation disagrees");
        bytes32 create2Salt = keccak256(abi.encodePacked(_initData(owner), salt));
        assertEq(
            vm.computeCreate2Address(create2Salt, KernelV31.PROXY_INIT_CODE_HASH, address(FACTORY)),
            predicted,
            "offline CREATE2 derivation disagrees"
        );

        Kernel account = _createAccount(owner, salt);

        assertEq(address(account), predicted, "factory deployed elsewhere");
        bytes32 implementation = vm.load(address(account), ERC1967_IMPLEMENTATION_SLOT);
        assertEq(address(uint160(uint256(implementation))), KernelV31.IMPLEMENTATION, "proxy implementation");
        assertEq(account.accountId(), KernelV31.ACCOUNT_ID);
        assertEq(address(account.entrypoint()), address(ENTRY_POINT));
        assertEq(ValidationId.unwrap(account.rootValidator()), ValidationId.unwrap(_rootValidation()), "root");
        assertEq(account.currentNonce(), 1);
        assertTrue(account.isModuleInstalled(MODULE_TYPE_VALIDATOR, KernelV31.ECDSA_VALIDATOR, ""));
        assertEq(ECDSAValidator(KernelV31.ECDSA_VALIDATOR).ecdsaValidatorStorage(address(account)), owner);
        console.log("a: account proxy runtime size", address(account).code.length);
    }

    function test_G6_b_fundWithUsdg() public {
        Kernel account = _createAccount(owner, bytes32(0));
        assertEq(IERC20Metadata(address(USDG)).decimals(), 6, "USDG decimals");
        uint256 supplyBefore = USDG.totalSupply();

        deal(address(USDG), address(account), FUNDING);

        assertEq(USDG.balanceOf(address(account)), FUNDING);
        assertEq(USDG.totalSupply(), supplyBefore, "deal wrote only the balance");
    }

    function test_G6_c_installSpikeExecutor() public {
        Kernel account = _fundedAccount(bytes32(0));

        OpResult memory installed =
            _execute(account, ownerKey, _installExecutorCall(address(module), abi.encode(operator)));

        assertTrue(installed.success, "install UserOp failed");
        assertTrue(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        assertEq(address(account.executorConfig(IExecutor(address(module))).hook), address(1), "no-hook sentinel");
        assertTrue(module.isModuleType(MODULE_TYPE_EXECUTOR));
        assertFalse(module.isModuleType(MODULE_TYPE_VALIDATOR));
        assertTrue(module.isInitialized(address(account)));
        assertEq(module.operatorOf(address(account)), operator);
        assertEq(module.spendLedger(address(account)), int256(FUNDING), "install snapshot");

        OpResult memory orphanEnd = _execute(account, ownerKey, _singleCall(address(module), _endCalldata()));

        assertFalse(orphanEnd.success, "end without begin must revert");
        assertEq(orphanEnd.revertReason, abi.encodeWithSelector(SpikeModule.NoOpenBracket.selector, address(account)));
        assertEq(module.spendLedger(address(account)), int256(FUNDING));
    }

    function test_G6_d_bracketedOutflowThroughHandleOps() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        uint256 amount = 10e6;
        int256 ledgerBefore = module.spendLedger(address(account));
        uint256 accountBefore = USDG.balanceOf(address(account));
        uint256 recipientBefore = USDG.balanceOf(recipient);

        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(address(module), 0, _beginCalldata());
        calls[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, amount)));
        calls[2] = Execution(address(module), 0, _endCalldata());
        OpResult memory result = _execute(account, ownerKey, _batchCall(calls));

        assertTrue(result.success, "bracketed batch failed");
        assertEq(accountBefore - USDG.balanceOf(address(account)), amount, "account outflow");
        assertEq(USDG.balanceOf(recipient) - recipientBefore, amount, "recipient inflow");
        assertEq(ledgerBefore - module.spendLedger(address(account)), int256(amount), "ledger must fall by 10e6");
        assertFalse(module.bracketOpen(address(account)), "bracket slot not cleared");
        console.log("d: bracketed outflow UserOp actualGasUsed", result.actualGasUsed);
    }

    function test_G6_e_bracketedInflowThroughHandleOps() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        InflowHelper payer = new InflowHelper(USDG);
        uint256 amount = 7_250_000;
        deal(address(USDG), address(payer), amount);
        int256 ledgerBefore = module.spendLedger(address(account));
        uint256 accountBefore = USDG.balanceOf(address(account));

        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(address(module), 0, _beginCalldata());
        calls[1] = Execution(address(payer), 0, abi.encodeCall(InflowHelper.payCaller, (amount)));
        calls[2] = Execution(address(module), 0, _endCalldata());
        OpResult memory result = _execute(account, ownerKey, _batchCall(calls));

        assertTrue(result.success, "bracketed batch failed");
        assertEq(USDG.balanceOf(address(account)) - accountBefore, amount, "account inflow");
        assertEq(USDG.balanceOf(address(payer)), 0, "payer outflow");
        assertEq(module.spendLedger(address(account)) - ledgerBefore, int256(amount), "ledger must rise by the inflow");
        assertFalse(module.bracketOpen(address(account)), "bracket slot not cleared");
        console.log("e: bracketed inflow UserOp actualGasUsed", result.actualGasUsed);
    }

    /// Documented limit (PRD 7.2): a batch without brackets moves USDG and the ledger does not see it.
    function test_G6_f_unbracketedBatchIsTheDocumentedLimit() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        int256 ledgerBefore = module.spendLedger(address(account));
        uint256 accountBefore = USDG.balanceOf(address(account));

        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 3e6)));
        calls[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (stranger, 2e6)));
        OpResult memory result = _execute(account, ownerKey, _batchCall(calls));

        assertTrue(result.success, "unbracketed batch must succeed");
        assertEq(accountBefore - USDG.balanceOf(address(account)), 5e6, "USDG moved");
        assertEq(module.spendLedger(address(account)), ledgerBefore, "documented limit: ledger does not move");
        console.log("f: unbracketed batch UserOp actualGasUsed", result.actualGasUsed);
    }

    function test_G6_g_executeFromExecutorAndCallerChecks() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        uint256 accountBefore = USDG.balanceOf(address(account));
        uint256 recipientBefore = USDG.balanceOf(recipient);

        vm.prank(operator);
        bytes[] memory returnData = module.pushUsdg(address(account), recipient, 1e6);

        assertEq(accountBefore - USDG.balanceOf(address(account)), 1e6, "account outflow");
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 1e6, "recipient inflow");
        assertEq(returnData.length, 1);
        assertTrue(abi.decode(returnData[0], (bool)), "transfer returned false");

        vm.expectRevert(abi.encodeWithSelector(SpikeModule.NotOperator.selector, stranger));
        vm.prank(stranger);
        module.pushUsdg(address(account), stranger, 1e6);

        // An EOA.
        vm.expectRevert(abi.encodeWithSelector(SpikeModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.beginOwnerOp();
        vm.expectRevert(abi.encodeWithSelector(SpikeModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.endOwnerOp();

        // A plain contract.
        ForeignCaller foreign = new ForeignCaller();
        vm.expectRevert(abi.encodeWithSelector(SpikeModule.NotInstalled.selector, address(foreign)));
        foreign.forward(address(module), _beginCalldata());
        vm.expectRevert(abi.encodeWithSelector(SpikeModule.NotInstalled.selector, address(foreign)));
        foreign.forward(address(module), _endCalldata());

        // Another Kernel account without the module, through its own UserOps.
        (address otherOwner, uint256 otherKey) = makeAddrAndKey("otherOwner");
        Kernel other = _createAccount(otherOwner, bytes32(0));
        vm.deal(address(other), GAS_FUNDING);
        bytes memory notInstalled = abi.encodeWithSelector(SpikeModule.NotInstalled.selector, address(other));
        OpResult memory begun = _execute(other, otherKey, _singleCall(address(module), _beginCalldata()));
        assertFalse(begun.success);
        assertEq(begun.revertReason, notInstalled);
        OpResult memory ended = _execute(other, otherKey, _singleCall(address(module), _endCalldata()));
        assertFalse(ended.success);
        assertEq(ended.revertReason, notInstalled);

        assertFalse(module.bracketOpen(address(account)));
        assertEq(module.spendLedger(address(account)), int256(FUNDING), "ledger untouched by rejected callers");
    }

    function test_G6_h_transientStorage() public {
        TransientProbe probe = new TransientProbe();
        bytes32 slot = keccak256("g6.h");

        assertEq(probe.roundTrip(slot, 42), 42, "TLOAD after TSTORE in one call frame");
        assertEq(probe.storeThenLoadAcrossCalls(slot, 7), 7, "TLOAD in a later call frame of the same transaction");
        assertEq(probe.load(keccak256("g6.h.unused")), 0);
        assertEq(vm.load(address(probe), slot), bytes32(0), "persistent storage untouched");

        // The fork runs forge's EVM, so also ask the chain itself.
        bytes memory live =
            vm.rpc(_liveRpc(), "eth_call", string.concat('[{"data":"', TSTORE_TLOAD_INIT_CODE, '"},"latest"]'));
        assertEq(live, abi.encode(uint256(0x2a)), "live TSTORE then TLOAD");

        // Brackets need the cross-frame case, so run the probe's own code on the chain through a code override.
        bytes memory acrossFrames = _liveCallWithCode(
            address(probe), address(probe).code, abi.encodeCall(TransientProbe.storeThenLoadAcrossCalls, (slot, 7))
        );
        assertEq(acrossFrames, abi.encode(uint256(7)), "live TLOAD in a later call frame of the same transaction");
        bytes memory nextTransaction =
            _liveCallWithCode(address(probe), address(probe).code, abi.encodeCall(TransientProbe.load, (slot)));
        assertEq(nextTransaction, abi.encode(uint256(0)), "live: a new transaction starts with nothing stored");
    }

    /// Information only. The fork cannot answer this: forge's EVM at evm_version cancun has no 0x100 precompile.
    function test_G6_i_p256PrecompileLiveInfoOnly() public {
        assertEq(_liveCall(P256_VERIFY, P256_VALID), abi.encode(uint256(1)), "live: valid vector");
        assertEq(_liveCall(P256_VERIFY, P256_TAMPERED).length, 0, "live: tampered vector");

        (bool ok, bytes memory forked) = P256_VERIFY.staticcall(vm.parseBytes(P256_VALID));
        assertTrue(ok);
        assertEq(forked.length, 0, "fork has no P256 precompile");
    }

    function test_G6_j_nonRootValidatorHookFiresOnlyThroughExecuteUserOp() public {
        Kernel account = _fundedAccount(bytes32(0));
        (address sessionOwner, uint256 sessionKey) = makeAddrAndKey("sessionOwner");
        // A fresh validator from the vendored source: the deployed one already holds this account's root owner.
        ECDSAValidator sessionValidator = new ECDSAValidator();
        MockHook hook = new MockHook();

        // Kernel v3.1 validator initData: hook address, then abi.encode(validatorData, hookData, selectorData).
        // hookData starts with a flag byte. selectorData allows execute() as the call wrapped by executeUserOp.
        bytes memory initData = abi.encodePacked(
            address(hook),
            abi.encode(
                abi.encodePacked(sessionOwner),
                abi.encodePacked(bytes1(0xff), "hookData"),
                abi.encodePacked(Kernel.execute.selector)
            )
        );
        OpResult memory installed = _execute(
            account,
            ownerKey,
            abi.encodeCall(Kernel.installModule, (MODULE_TYPE_VALIDATOR, address(sessionValidator), initData))
        );
        assertTrue(installed.success, "validator install failed");
        ValidationId vId = ValidatorLib.validatorToIdentifier(IValidator(address(sessionValidator)));
        assertEq(address(account.validationConfig(vId).hook), address(hook));
        assertTrue(account.isAllowedSelector(vId, Kernel.execute.selector));

        uint192 nonceKey = ValidatorLib.encodeAsNonceKey(
            ValidationMode.unwrap(VALIDATION_MODE_DEFAULT),
            ValidationType.unwrap(VALIDATION_TYPE_VALIDATOR),
            bytes20(address(sessionValidator)),
            0
        );
        bytes memory executeCall = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (recipient, 1e6)));
        uint256 recipientBefore = USDG.balanceOf(recipient);

        PackedUserOperation memory wrapped =
            _userOp(address(account), nonceKey, "", abi.encodePacked(Kernel.executeUserOp.selector, executeCall));
        wrapped.signature = _signUserOp(wrapped, sessionKey);
        OpResult memory result = _handleOp(wrapped);

        assertTrue(result.success, "executeUserOp through the session validator failed");
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 1e6);
        assertEq(hook.preHookData(address(account)), abi.encodePacked(address(ENTRY_POINT), executeCall), "preCheck");
        assertEq(hook.postHookData(address(account)), bytes("hookData"), "postCheck");

        PackedUserOperation memory direct = _userOp(address(account), nonceKey, "", executeCall);
        direct.signature = _signUserOp(direct, sessionKey);
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = direct;
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(ValidationManager.InvalidValidator.selector)
            )
        );
        vm.prank(bundler, bundler);
        ENTRY_POINT.handleOps(ops, payable(bundler));
    }

    // ---------------------------------------------------------------- recipe

    /// The SDK's default path: the first UserOp carries initCode through the meta factory.
    function test_recipe_firstUserOpDeploysThroughMetaFactory() public {
        bytes32 salt = bytes32(uint256(7));
        address predicted = FACTORY.getAddress(_initData(owner), salt);
        vm.deal(predicted, GAS_FUNDING);
        deal(address(USDG), predicted, FUNDING);
        uint256 recipientBefore = USDG.balanceOf(recipient);

        bytes memory callData = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (recipient, 1e6)));
        OpResult memory result =
            _handleOp(_rootUserOp(predicted, _metaFactoryInitCode(owner, salt), callData, ownerKey));

        assertTrue(result.success, "deploying UserOp failed");
        assertEq(Kernel(payable(predicted)).accountId(), KernelV31.ACCOUNT_ID);
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 1e6);
        console.log("recipe: deploy plus transfer UserOp actualGasUsed", result.actualGasUsed);
    }

    /// Root validation ignores the validator bytes of the nonce key, so the SDK key and key 0 are two lanes.
    function test_recipe_rootNonceLanes() public {
        Kernel account = _fundedAccount(bytes32(0));
        uint192 sdkKey = _rootNonceKey(0);
        bytes memory callData = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (recipient, 1e6)));

        assertTrue(_execute(account, ownerKey, callData).success, "SDK lane");
        PackedUserOperation memory onKeyZero = _userOp(address(account), 0, "", callData);
        onKeyZero.signature = _signUserOp(onKeyZero, ownerKey);
        assertTrue(_handleOp(onKeyZero).success, "key 0 lane");

        assertEq(ENTRY_POINT.getNonce(address(account), sdkKey), (uint256(sdkKey) << 64) | 1);
        assertEq(ENTRY_POINT.getNonce(address(account), 0), 1);
        console.log("recipe: SDK root nonce key");
        console.logBytes32(bytes32(uint256(sdkKey)));
    }

    /// Negative controls for the signing recipe. The deployed ECDSA validator rejects a UserOp signed by another key
    /// and one whose callData changed after signing. handleOps reverts in validation, so the op's callData never runs.
    function test_recipe_wrongSignatureIsRejected() public {
        Kernel account = _fundedAccount(bytes32(0));
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        bytes memory callData = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (recipient, 1e6)));
        uint256 accountBefore = USDG.balanceOf(address(account));

        _assertSignatureRejected(_rootUserOp(address(account), "", callData, strangerKey));

        PackedUserOperation memory altered = _rootUserOp(address(account), "", callData, ownerKey);
        altered.callData = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (stranger, 1e6)));
        _assertSignatureRejected(altered);

        assertEq(USDG.balanceOf(address(account)), accountBefore, "rejected ops moved USDG");
        assertTrue(_execute(account, ownerKey, callData).success, "control: the owner's signature");
        assertEq(accountBefore - USDG.balanceOf(address(account)), 1e6, "control: account outflow");
    }

    /// executeFromExecutor in each call type and exec type, through Kernel's own MockExecutor at the v3.1 tag.
    function test_recipe_executorModes() public {
        Kernel account = _fundedAccount(bytes32(0));
        MockExecutor executor = new MockExecutor();
        assertTrue(_execute(account, ownerKey, _installExecutorCall(address(executor), "executorData")).success);
        IERC7579Account target = IERC7579Account(address(account));
        uint256 recipientBefore = USDG.balanceOf(recipient);

        executor.sudoDoExec(target, ExecLib.encodeSimpleSingle(), _usdgSingle(recipient, 1e6));
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 1e6, "single, default");

        Execution[] memory pair = new Execution[](2);
        pair[0] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 1e6)));
        pair[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 2e6)));
        executor.sudoDoExec(target, ExecLib.encodeSimpleBatch(), ExecLib.encodeBatch(pair));
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 4e6, "batch, default");

        uint256 tooMuch = USDG.balanceOf(address(account)) + 1;
        ExecMode singleTry =
            ExecLib.encode(CALLTYPE_SINGLE, EXECTYPE_TRY, ExecModeSelector.wrap(0), ExecModePayload.wrap(0));
        vm.expectEmit(address(account));
        emit ExecLib.TryExecuteUnsuccessful(0, abi.encodeWithSelector(USDG_INSUFFICIENT_FUNDS));
        executor.sudoDoExec(target, singleTry, _usdgSingle(recipient, tooMuch));
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 4e6, "single, try: failure swallowed");

        pair[0] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, tooMuch)));
        pair[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 5e6)));
        ExecMode batchTry =
            ExecLib.encode(CALLTYPE_BATCH, EXECTYPE_TRY, ExecModeSelector.wrap(0), ExecModePayload.wrap(0));
        vm.expectEmit(address(account));
        emit ExecLib.TryExecuteUnsuccessful(0, abi.encodeWithSelector(USDG_INSUFFICIENT_FUNDS));
        executor.sudoDoExec(target, batchTry, ExecLib.encodeBatch(pair));
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 9e6, "batch, try: later call still runs");

        // Default exec type bubbles the failing call's exact revert data.
        vm.expectRevert(USDG_INSUFFICIENT_FUNDS);
        executor.sudoDoExec(target, ExecLib.encodeSimpleSingle(), _usdgSingle(recipient, tooMuch));

        // Call type 0xfe is advertised by supportsExecutionMode but ExecLib has no branch for it.
        ExecMode staticMode =
            ExecLib.encode(CALLTYPE_STATIC, EXECTYPE_DEFAULT, ExecModeSelector.wrap(0), ExecModePayload.wrap(0));
        assertTrue(account.supportsExecutionMode(staticMode));
        vm.expectRevert(bytes("Unsupported"));
        executor.sudoDoExec(target, staticMode, _usdgSingle(recipient, 1e6));
    }

    /// Kernel v3.1 writes executorConfig before it calls onInstall, so during onInstall the account already lists the
    /// module. Any contract can answer isModuleInstalled, so asking it does not prove the caller is a real account.
    function test_recipe_accountListsExecutorBeforeOnInstall() public {
        Kernel account = _fundedAccount(bytes32(0));
        InstallOrderProbe probe = new InstallOrderProbe();

        assertTrue(_execute(account, ownerKey, _installExecutorCall(address(probe), "")).success, "install failed");

        assertTrue(probe.listedDuringOnInstall(address(account)), "not listed during onInstall");
    }

    function test_recipe_uninstallExecutorThroughUserOp() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));

        OpResult memory result = _execute(
            account, ownerKey, abi.encodeCall(Kernel.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
        );

        assertTrue(result.success, "uninstall UserOp failed");
        assertFalse(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        assertEq(address(account.executorConfig(IExecutor(address(module))).hook), address(0));
        assertFalse(module.isInitialized(address(account)), "onUninstall ran");
        assertEq(module.spendLedger(address(account)), 0);
        assertTrue(_emitted(result.logs, address(account), MODULE_UNINSTALL_RESULT, abi.encode(address(module), true)));

        vm.expectRevert(Kernel.InvalidExecutor.selector);
        vm.prank(address(module));
        account.executeFromExecutor(ExecLib.encodeSimpleSingle(), _usdgSingle(recipient, 1e6));
    }

    /// A module cannot veto its own uninstall in Kernel v3.1, and a reverting onUninstall leaves its state behind.
    function test_recipe_uninstallIgnoresRevertingOnUninstall() public {
        Kernel account = _fundedAccount(bytes32(0));
        StubbornExecutor stubborn = new StubbornExecutor();
        assertTrue(_execute(account, ownerKey, _installExecutorCall(address(stubborn), "")).success);

        OpResult memory result = _execute(
            account, ownerKey, abi.encodeCall(Kernel.uninstallModule, (MODULE_TYPE_EXECUTOR, address(stubborn), ""))
        );

        assertTrue(result.success, "uninstall must not depend on onUninstall");
        assertFalse(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(stubborn), ""));
        assertTrue(
            _emitted(result.logs, address(account), MODULE_UNINSTALL_RESULT, abi.encode(address(stubborn), false))
        );
        assertTrue(stubborn.installed(address(account)), "module state left behind");
    }

    /// An onUninstall that runs out of gas gets at most 63/64 of the gas left (EIP-150), and Kernel finishes the
    /// uninstall on the last 1/64. Whether that is enough depends on the UserOp's callGasLimit.
    function test_recipe_outOfGasOnUninstallDependsOnCallGasLimit() public {
        Kernel account = _fundedAccount(bytes32(0));
        GasBurningExecutor burner = new GasBurningExecutor();
        StubbornExecutor stubborn = new StubbornExecutor();
        assertTrue(_execute(account, ownerKey, _installExecutorCall(address(burner), "")).success);
        assertTrue(_execute(account, ownerKey, _installExecutorCall(address(stubborn), "")).success);

        OpResult memory control = _handleOp(_uninstallExecutorOp(account, address(stubborn), 100_000));
        assertTrue(control.success, "control: 100,000 call gas uninstalls a module whose onUninstall fails fast");
        assertFalse(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(stubborn), ""));

        OpResult memory starved = _handleOp(_uninstallExecutorOp(account, address(burner), 100_000));
        assertFalse(starved.success, "100,000 call gas cannot uninstall the gas-burning module");
        assertEq(starved.revertReason.length, 0, "out of gas leaves no revert data");
        assertTrue(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(burner), ""), "still installed");

        OpResult memory result = _handleOp(_uninstallExecutorOp(account, address(burner), CALL_GAS_LIMIT));
        assertTrue(result.success, "1,000,000 call gas uninstalls the gas-burning module");
        assertFalse(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(burner), ""));
        assertTrue(_emitted(result.logs, address(account), MODULE_UNINSTALL_RESULT, abi.encode(address(burner), false)));
        assertEq(burner.work(address(account)), 1, "module state left behind");
    }

    /// Brackets live in transient storage, so they are scoped to the transaction, not to the UserOp. An op that
    /// opens a bracket without closing it hands the open bracket to the account's next op in the same bundle.
    function test_recipe_openBracketCarriesIntoNextUserOpOfTheBundle() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        int256 ledgerBefore = module.spendLedger(address(account));
        uint256 accountBefore = USDG.balanceOf(address(account));

        Execution[] memory openOnly = new Execution[](2);
        openOnly[0] = Execution(address(module), 0, _beginCalldata());
        openOnly[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 4e6)));
        Execution[] memory bracketed = new Execution[](3);
        bracketed[0] = Execution(address(module), 0, _beginCalldata());
        bracketed[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 1e6)));
        bracketed[2] = Execution(address(module), 0, _endCalldata());

        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _userOp(address(account), _rootNonceKey(0), "", _batchCall(openOnly));
        ops[0].signature = _signUserOp(ops[0], ownerKey);
        ops[1] = _userOp(address(account), _rootNonceKey(0), "", _batchCall(bracketed));
        ops[1].nonce += 1;
        ops[1].signature = _signUserOp(ops[1], ownerKey);
        OpResult[] memory results = _handleOps(ops);

        assertTrue(results[0].success, "op that leaves its bracket open");
        assertFalse(results[1].success, "next op of the bundle");
        assertEq(
            results[1].revertReason, abi.encodeWithSelector(SpikeModule.BracketAlreadyOpen.selector, address(account))
        );
        assertEq(accountBefore - USDG.balanceOf(address(account)), 4e6, "only the first op moved USDG");
        assertEq(module.spendLedger(address(account)), ledgerBefore, "the unclosed bracket recorded nothing");
    }

    /// Brackets are keyed by account, so an open bracket does not reach another account's op in the same bundle.
    function test_recipe_openBracketStaysWithItsAccountInTheBundle() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        (address otherOwner, uint256 otherKey) = makeAddrAndKey("otherOwner");
        Kernel other = _createAccount(otherOwner, bytes32(0));
        vm.deal(address(other), GAS_FUNDING);
        deal(address(USDG), address(other), FUNDING);
        assertTrue(_execute(other, otherKey, _installExecutorCall(address(module), abi.encode(operator))).success);
        int256 ledgerBefore = module.spendLedger(address(account));
        int256 otherLedgerBefore = module.spendLedger(address(other));

        Execution[] memory bracketed = new Execution[](3);
        bracketed[0] = Execution(address(module), 0, _beginCalldata());
        bracketed[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 2e6)));
        bracketed[2] = Execution(address(module), 0, _endCalldata());
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _rootUserOp(address(other), "", _singleCall(address(module), _beginCalldata()), otherKey);
        ops[1] = _rootUserOp(address(account), "", _batchCall(bracketed), ownerKey);
        OpResult[] memory results = _handleOps(ops);

        assertTrue(results[0].success, "other account leaves its bracket open");
        assertTrue(results[1].success, "bracketed op of the account in the same bundle");
        assertEq(ledgerBefore - module.spendLedger(address(account)), int256(2e6), "ledger must fall by 2e6");
        assertEq(module.spendLedger(address(other)), otherLedgerBefore, "the open bracket recorded nothing");
    }

    /// The NotInstalled gate admits any address that called onInstall for itself, not only accounts. What it
    /// guarantees is isolation: SpikeModule keys every write by msg.sender, so such a caller reaches only its own state.
    function test_recipe_selfRegisteredCallerOnlyReachesItsOwnState() public {
        Kernel account = _accountWithSpikeModule(bytes32(0));
        int256 ledgerBefore = module.spendLedger(address(account));
        SelfRegisteredCaller impostor = new SelfRegisteredCaller();
        InflowHelper payer = new InflowHelper(USDG);
        deal(address(USDG), address(payer), 3e6);

        impostor.registerAndBracketInflow(module, payer, 3e6);

        assertTrue(module.isInitialized(address(impostor)), "self-registration accepted");
        assertEq(module.spendLedger(address(impostor)), int256(3e6), "its own bracket recorded its own inflow");
        assertEq(module.spendLedger(address(account)), ledgerBefore, "the account's ledger is untouched");
        assertFalse(module.bracketOpen(address(account)), "the account's bracket is untouched");
    }

    /// In v3.1 the root validator can carry a hook, set at initialize, and that hook then wraps every root UserOp:
    /// plain execute() fails validation and executeUserOp runs the hook. The v3.2 and v3.3 tags behave the same.
    /// Kernel's current source (v4 on the dev branch, the S36 that PRD 7.1 cites) exempts the root by design.
    function test_recipe_rootHookIsEnforcedOnUserOps() public {
        MockHook hook = new MockHook();
        bytes memory initData = abi.encodeCall(
            Kernel.initialize,
            (
                _rootValidation(),
                IHook(address(hook)),
                abi.encodePacked(owner),
                abi.encodePacked(bytes1(0xff), "rootHook"),
                new bytes[](0)
            )
        );
        Kernel account = Kernel(payable(FACTORY.createAccount(initData, bytes32(0))));
        vm.deal(address(account), GAS_FUNDING);
        deal(address(USDG), address(account), FUNDING);
        assertEq(address(account.validationConfig(_rootValidation()).hook), address(hook));
        bytes memory executeCall = _singleCall(address(USDG), abi.encodeCall(IERC20.transfer, (recipient, 1e6)));

        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = _rootUserOp(address(account), "", executeCall, ownerKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEntryPoint.FailedOpWithRevert.selector,
                0,
                "AA23 reverted",
                abi.encodeWithSelector(Kernel.OnlyExecuteUserOp.selector)
            )
        );
        vm.prank(bundler, bundler);
        ENTRY_POINT.handleOps(ops, payable(bundler));

        OpResult memory result = _handleOp(
            _rootUserOp(address(account), "", abi.encodePacked(Kernel.executeUserOp.selector, executeCall), ownerKey)
        );
        assertTrue(result.success, "executeUserOp through the hooked root failed");
        assertEq(hook.preHookData(address(account)), abi.encodePacked(address(ENTRY_POINT), executeCall), "preCheck");
        assertEq(hook.postHookData(address(account)), bytes("rootHook"), "postCheck");
    }

    /// With an ECDSA root, Kernel v3.1 lets the owner EOA call the account directly: the root validator doubles as
    /// a hook in onlyEntryPointOrSelfOrRoot. Such calls skip the EntryPoint and any brackets.
    function test_recipe_rootOwnerCanCallAccountDirectly() public {
        Kernel account = _fundedAccount(bytes32(0));
        uint256 recipientBefore = USDG.balanceOf(recipient);

        vm.prank(owner);
        account.execute(ExecLib.encodeSimpleSingle(), _usdgSingle(recipient, 1e6));
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 1e6);

        vm.expectRevert("ECDSAValidator: sender is not owner");
        vm.prank(stranger);
        account.execute(ExecLib.encodeSimpleSingle(), _usdgSingle(recipient, 1e6));
    }

    // ---------------------------------------------------------------- helpers

    function _fundedAccount(bytes32 salt) internal returns (Kernel account) {
        account = _createAccount(owner, salt);
        vm.deal(address(account), GAS_FUNDING);
        deal(address(USDG), address(account), FUNDING);
    }

    function _accountWithSpikeModule(bytes32 salt) internal returns (Kernel account) {
        account = _fundedAccount(salt);
        OpResult memory installed =
            _execute(account, ownerKey, _installExecutorCall(address(module), abi.encode(operator)));
        assertTrue(installed.success, "install UserOp failed");
    }

    /// Kernel v3.1 executor initData: hook address (20 bytes), then abi.encode(executorData, hookData).
    /// Hook address(0) stores the no-hook sentinel address(1), and hookData is then unused.
    function _installExecutorCall(address executor, bytes memory executorData) internal pure returns (bytes memory) {
        return abi.encodeCall(
            Kernel.installModule,
            (MODULE_TYPE_EXECUTOR, executor, abi.encodePacked(address(0), abi.encode(executorData, bytes(""))))
        );
    }

    function _beginCalldata() internal pure returns (bytes memory) {
        return abi.encodeCall(SpikeModule.beginOwnerOp, ());
    }

    function _endCalldata() internal pure returns (bytes memory) {
        return abi.encodeCall(SpikeModule.endOwnerOp, ());
    }

    function _usdgSingle(address to, uint256 amount) internal pure returns (bytes memory) {
        return ExecLib.encodeSingle(address(USDG), 0, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    /// EntryPoint v0.7 turns SIG_VALIDATION_FAILED into a revert of the whole handleOps call, not a failed UserOp.
    function _assertSignatureRejected(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.expectRevert(abi.encodeWithSelector(IEntryPoint.FailedOp.selector, 0, "AA24 signature error"));
        vm.prank(bundler, bundler);
        ENTRY_POINT.handleOps(ops, payable(bundler));
    }

    function _uninstallExecutorOp(Kernel account, address executor, uint128 callGasLimit)
        internal
        view
        returns (PackedUserOperation memory op)
    {
        op = _userOp(
            address(account),
            _rootNonceKey(0),
            "",
            abi.encodeCall(Kernel.uninstallModule, (MODULE_TYPE_EXECUTOR, executor, ""))
        );
        op.accountGasLimits = bytes32(abi.encodePacked(VERIFICATION_GAS_LIMIT, callGasLimit));
        op.signature = _signUserOp(op, ownerKey);
    }

    function _liveRpc() internal view returns (string memory) {
        return vm.envOr("ROBINHOOD_RPC", string(DEFAULT_LIVE_RPC));
    }

    function _liveCall(address to, string memory data) internal returns (bytes memory) {
        return
            vm.rpc(
                _liveRpc(), "eth_call", string.concat('[{"to":"', vm.toString(to), '","data":"', data, '"},"latest"]')
            );
    }

    /// eth_call on the live chain with `code` placed at `to` by a state override.
    function _liveCallWithCode(address to, bytes memory code, bytes memory data) internal returns (bytes memory) {
        string memory target = vm.toString(to);
        return vm.rpc(
            _liveRpc(),
            "eth_call",
            string.concat(
                '[{"to":"',
                target,
                '","data":"',
                vm.toString(data),
                '"},"latest",{"',
                target,
                '":{"code":"',
                vm.toString(code),
                '"}}]'
            )
        );
    }
}
