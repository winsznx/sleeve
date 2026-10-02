# G6 notes: Kernel v3.1 on Robinhood Chain

The technical recipe that SleeveModule (components 4 to 6), the keeper and the app need from the G6 spike. Everything below ran on 2 October 2026 against chain 4663 forked at block 78,312,136 (Friday 2 October 2026 10:44 EDT, block hash 0x7b1a9be84ea7e2aff4ff8dba07ec2b833838e2f5e84f9ab2f4e2b11342884938, base fee 31,674,000 wei in the block header), unless a line says live. The gate result is in docs/GATES.md.

Rerun the tests:

```
cd contracts
FOUNDRY_OUT=out-g6 FOUNDRY_CACHE_PATH=cache-g6 forge test --match-path test/spike/G6Spike.t.sol -vv
```

If the archive RPC returns HTTP 429, add `--rpc-url https://robinhood.drpc.org --fork-retries 10 --fork-retry-backoff 3000 --compute-units-per-second 50`. Forge accepts the retry flags only together with `--rpc-url`. Tests `test_G6_h` and `test_G6_i` also make live `eth_call`s to `ROBINHOOD_RPC` (default https://rpc.mainnet.chain.robinhood.com). `forge test` compiles the whole project before it filters by path, so a file elsewhere in the repo that does not compile stops this command. `--skip <file name>` leaves it out.

Rerun the bytecode check: `contracts/test/spike/kernel-bytecode-check.sh`. It needs git, forge, cast and python3, and takes about a minute.

Files: `contracts/test/spike/` holds `SpikeModule.sol` (the executor), `KernelForkBase.sol` (account creation and UserOp helpers), `KernelV31.sol` (addresses), `SpikeHelpers.sol` (inflow helper, foreign caller, transient probe, executors whose `onUninstall` reverts or runs out of gas, an install-order probe and a contract that registers itself with SpikeModule) and `G6Spike.t.sol`. Kernel is vendored at `contracts/lib/kernel`, tag v3.1, commit 03f7f5cf5871cda0070e4223f196f5b577f6cde2. Imports use `kernel/=lib/kernel/src/`.

## 1. Which Kernel ZeroDev deploys on 4663

Robinhood's account abstraction page (https://docs.robinhood.com/chain/account-abstraction) builds its ZeroDev example with `KERNEL_V3_1` and `getEntryPoint("0.7")`. Addresses come from the npm packages, read from the packed tarballs: `@zerodev/sdk` 5.5.10 (`constants.ts`, `KernelVersionToAddressesMap`), `@zerodev/ecdsa-validator` 5.4.9 (`constants.ts`, range `>=0.3.1`) and `@zerodev/passkey-validator` 5.6.0 (`index.ts`). The Kernel README at tag v3.1 lists the same v3.1 addresses.

Every v3 version the SDK lists is deployed on 4663. Code sizes are identical at block 78,312,136 (archive RPC) and at the live head (block 78,316,943, public RPC).

| Version | Contract | Address | Code size (bytes) |
| --- | --- | --- | --- |
| all | EntryPoint v0.7 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | 16,035 |
| 0.3.0 | Kernel implementation | 0x94F097E1ebEB4ecA3AAE54cabb08905B239A7D27 | 20,427 |
| 0.3.0 | KernelFactory | 0x6723b44Abeec4E71eBE3232BD5B455805baDD22f | 989 |
| 0.3.0 | ECDSA validator | 0x8104e3Ad430EA6d354d013A6789fDFc71E671c43 | 1,856 |
| 0.3.1 | Kernel implementation | 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D | 22,784 |
| 0.3.1 | KernelFactory | 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419 | 989 |
| 0.3.1 and later | ECDSA validator | 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57 | 1,819 |
| 0.3.0 to 0.3.3 | Meta factory (FactoryStaker) | 0xd703aaE79538628d27099B8c4f621bE4CCd142d5 | 1,871 |
| 0.3.2 | Kernel implementation | 0xD830D15D3dc0C269F3dBAa0F3e8626d33CFdaBe1 | 23,563 |
| 0.3.2 | KernelFactory | 0x7a1dBAB750f12a90EB1B60D2Ae3aD17D4D81EfFe | 950 |
| 0.3.3 | Kernel implementation | 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28 | 24,469 |
| 0.3.3 | KernelFactory | 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9 | 950 |
| 0.3.x | Passkey validator 0.0.1 | 0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06 | 0 |
| 0.3.x | Passkey validator 0.0.2 | 0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd | 0 |
| 0.3.x | Passkey validator 0.0.3 | 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 | 4,739 |
| SDK constant | ONLY_ENTRYPOINT_HOOK_ADDRESS | 0xb230f0A1C7C95fa11001647383c8C7a8F316b900 | 0 |
| | USDG (proxy) | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | 170 |

Only passkey validator 0.0.3 exists on 4663, so the app must ask the SDK for that contract version. The EntryPoint's codehash, 0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58, equals Ethereum mainnet's. The v3.1 factory, meta factory and ECDSA validator also have the same codehash as on Ethereum mainnet. The implementation differs only in its chain-specific immutables (section 2).

The meta factory's owner is 0x9775137314fE595c943712B0b336327dfa80aE8A and `approved(factory)` is true for all four v3 factories. Neither the meta factory nor the v3.1 factory has a stake or deposit in the EntryPoint on 4663 (`getDepositInfo` returns zeros).

## 2. Bytecode check against the v3.1 tag

Method: clone zerodevapp/kernel, build the contract at the given ref, then compare the artifact's `deployedBytecode` with `cast code`, masking the byte ranges listed in `immutableReferences` and printing the on-chain values found there.

Settings: Kernel's foundry.toml at v3.1 sets `bytecode_hash = "none"` and `cbor_metadata = false`, and its `deploy` profile sets `via-ir = true`. It does not pin solc, and its `optimize = true` and `runs = 1000` keys are not Foundry keys, so Foundry ignores them. The build therefore depended on Foundry's 2024 defaults. Sourcify's verified metadata for the same addresses on chain 1 records them: solc 0.8.25, optimizer on with 200 runs, evm_version paris, via IR (solc 0.8.24 without via IR for FactoryStaker). The script pins exactly those.

| Contract | Ref | Result | Detail |
| --- | --- | --- | --- |
| Kernel implementation 0xBAC8...4b4D | v3.1 | MATCH | 22,784 bytes both sides, 0 differing bytes outside 544 immutable bytes. No CBOR tail on either side. Immutables: EntryPoint 0x0000000071727De22E5E9d8BAf0edAc6f37da032, the implementation's own address, chain id 0x1237 (4663), keccak256("Kernel"), keccak256("0.3.1") and the EIP-712 domain separator 0x46883995419b7ad2307c3fe8f26ad53b1b4f88c3600ad094d0ad988702fcc38b, which `cast` recomputes from those values. |
| KernelFactory 0xaac5...E419 | v3.1 | MATCH | 989 bytes, 0 differing outside 96 immutable bytes, immutable = the v3.1 implementation. |
| FactoryStaker 0xd703...42d5 | v3.1 | MATCH | 1,871 bytes, no immutables. |
| ECDSA validator 0x845A...cE57 | v3.1 | MISMATCH | 1,762 bytes compiled against 1,819 deployed. |
| ECDSA validator 0x845A...cE57 | e18c700 ("v3.1 rc1 (#112)", 3 May 2024) | MATCH | 1,819 bytes, 0 differing. |

So the implementation and factory are exactly the v3.1 tag. The ECDSA validator that ZeroDev ships for v3.1 was built from the release candidate one commit before PR #113. The only source difference is one line in `onInstall`: the deployed validator reverts `AlreadyInitialized(account)` if the account already has an owner, and the tag's version overwrites the owner. Sourcify's copy of the deployed source shows the same line.

Building with Kernel's foundry.toml as-is under forge 1.7.1 gives MISMATCH (44,517 bytes) because forge 1.x defaults to optimizer off, evm_version osaka and the newest installed solc (0.8.36 here).

The fork tests never use the locally compiled Kernel. They call the deployed factory, implementation, validator and EntryPoint. The vendored source supplies interfaces, libraries, mocks and one fresh ECDSAValidator for item j.

## 3. Account creation and address derivation

`Kernel.initialize` (selector 0x3c3b752b):

```solidity
function initialize(
    ValidationId rootValidator, // bytes21: 0x01 ++ validator address
    IHook hook,                 // address(0) for no root hook
    bytes calldata validatorData, // ECDSA validator: the 20-byte owner address
    bytes calldata hookData,    // "" when hook is address(0)
    bytes[] calldata initConfig // calls the account makes to itself during initialize
) external;
```

The SDK builds the same bytes for an ECDSA or passkey root: identifier `0x01 ++ validator`, enable data = the validator's own data, hook = zero address, hookData `0x`, initConfig `[]`. The root's type byte must be 0x01 (validator) or 0x02 (permission): `initialize` reverts `InvalidValidationType` for 0x00, and the factory surfaces any initialize failure as `InitializeError()`.

```solidity
bytes memory initData = abi.encodeCall(
    Kernel.initialize,
    (ValidatorLib.validatorToIdentifier(IValidator(ECDSA_VALIDATOR)), IHook(address(0)), abi.encodePacked(owner), "", new bytes[](0))
);
bytes32 salt = bytes32(index); // the SDK's `index`, as 32 bytes
```

Three ways to the same address, all asserted in `test_G6_a`:

1. `KernelFactory(0xaac5...E419).getAddress(initData, salt)`, a view on the deployed factory.
2. Offline: `CREATE2(factory, keccak256(abi.encodePacked(initData, salt)), 0x85d96aa1c9a65886d094915d76ccae85f14027a02c1647dde659f869460f03e6)`. The hash is the SDK's `initCodeHash` for 0.3.1: the keccak of solady's ERC-1967 proxy creation code with the v3.1 implementation baked in.
3. What the SDK does: `EntryPoint.getSenderAddress(initCode)` with `initCode = metaFactory ++ deployWithFactory(factory, initData, salt)`. It always reverts with `SenderAddressResult(address)` (0x6ca7b806).

The address commits to the whole initData, so a different owner key, root hook or initConfig gives a different address. The account is a 61-byte ERC-1967 proxy whose implementation slot (0x360894a1...382bbc) holds 0xBAC8...4b4D.

Creating it: call `factory.createAccount(initData, salt)` (0xea6d13ac) directly, or let the first UserOp carry `initCode`. The SDK's default initCode goes through the meta factory: `abi.encodePacked(META_FACTORY, abi.encodeCall(FactoryStaker.deployWithFactory, (FACTORY, initData, salt)))` (0xc5265d5d). `test_recipe_firstUserOpDeploysThroughMetaFactory` sends that first UserOp through handleOps, with the counterfactual address prefunded with ETH and USDG, and moves 1 USDG in the same op. The meta factory is a pass-through: going through it or calling the factory directly yields the same address. The SDK flag `useMetaFactory: false` switches to the factory.

After creation: `accountId()` is `kernel.advanced.v0.3.1`, `rootValidator()` is `0x01845adb...ce57`, `currentNonce()` is 1, and `ECDSAValidator.ecdsaValidatorStorage(account)` returns the owner.

## 4. Installing an executor

`installModule(uint256 moduleType, address module, bytes initData)` (0x9517e29f), callable by the EntryPoint, by the account itself, and by any caller the root validator's `preCheck` accepts when the root validator is also a hook (section 11, finding 2). For an executor, module type 2, Kernel v3.1 reads:

```
initData = abi.encodePacked(address hook, abi.encode(bytes executorData, bytes hookData))
```

- Bytes 0 to 19: the hook address. Bytes 20 onward: a standard ABI encoding of two `bytes`, whose offsets count from byte 20.
- Kernel writes `executorConfig` first and then calls `module.onInstall(executorData)` with the account as `msg.sender` and no value, so the account already lists the module while `onInstall` runs (`test_recipe_accountListsExecutorBeforeOnInstall`).
- Hook field sentinels in `executorConfig(module).hook`: `address(0)` means not installed, `address(1)` means installed with no hook. Passing hook `address(0)` stores `address(1)`.
- For a real hook, `hookData[0]` is a flag byte and `hook.onInstall(hookData[1:])` runs when the hook is not yet initialized for the account, or when the flag is 0xff. `hookData` must then be at least one byte or the `[1:]` slice reverts.
- With no hook, `hookData` is ignored and can be empty.

Worked example, SpikeModule with `executorData = abi.encode(operator)`, operator 0xbc32b0fcdb9b55f5ece07ba7f8059ba42d331f4c:

```
0000000000000000000000000000000000000000                           hook: address(0), stored as address(1)
0000000000000000000000000000000000000000000000000000000000000040   offset of executorData (from byte 20)
0000000000000000000000000000000000000000000000000000000000000080   offset of hookData
0000000000000000000000000000000000000000000000000000000000000020   executorData length
000000000000000000000000bc32b0fcdb9b55f5ece07ba7f8059ba42d331f4c   executorData = abi.encode(operator)
0000000000000000000000000000000000000000000000000000000000000000   hookData length 0
```

Other module types in v3.1, for reference:

- Validator, type 1: `abi.encodePacked(address hook, abi.encode(bytes validatorData, bytes hookData, bytes selectorData))`. A 4-byte `selectorData` allows that selector for the validator. Used in `test_G6_j`.
- Fallback, type 3: `abi.encodePacked(bytes4 selector, address hook, abi.encode(bytes selectorData, bytes hookData))`. Hook `type(address).max` means only the EntryPoint may call that selector. Read from source, not tested.

Gas, measured with `--isolate`: `installModule` cost 106,213 gas inside the implementation, 77,962 of it in SpikeModule's `onInstall` (three fresh storage writes and a cold USDG read).

## 5. executeFromExecutor

`executeFromExecutor(bytes32 mode, bytes executionCalldata) returns (bytes[] returnData)`, selector 0xd691c964. `msg.sender` must be an installed executor (`executorConfig(msg.sender).hook != address(0)`), otherwise Kernel reverts `InvalidExecutor()` (0x710c9497). If the executor was installed with a hook, the hook's `preCheck(executor, msg.value, msg.data)` and `postCheck` wrap the call.

Mode, 32 bytes:

```
byte 0       call type    0x00 single, 0x01 batch, 0xff delegatecall
byte 1       exec type    0x00 default (revert on failure), 0x01 try
bytes 2-5    unused       zero
bytes 6-9    mode selector, zero
bytes 10-31  mode payload, zero
```

| Mode | Bytes |
| --- | --- |
| single, default | 0x0000000000000000000000000000000000000000000000000000000000000000 |
| batch, default | 0x0100000000000000000000000000000000000000000000000000000000000000 |
| single, try | 0x0001000000000000000000000000000000000000000000000000000000000000 |
| batch, try | 0x0101000000000000000000000000000000000000000000000000000000000000 |

OpenZeppelin's `ERC7579Utils.encodeMode` produces the same bytes. SpikeModule builds its mode with it and the deployed Kernel accepts it (`test_G6_g`). Kernel's `ExecLib.encodeSimpleSingle()`, `encodeSimpleBatch()` and `encode(...)` give the same values.

Execution calldata:

- Single: `abi.encodePacked(address target, uint256 value, bytes callData)`, with no offset or length word. Moving 1 USDG to 0x0062...42c5 is `5fc5360d0400a0fd4f2af552add042d716f1d168` + 32 zero bytes of value + `a9059cbb000000000000000000000000006217c47ffa5eb3f3c92247fffe22ad998242c500000000000000000000000000000000000000000000000000000000000f4240`.
- Batch: `abi.encode(Execution[])` with `Execution(address target, uint256 value, bytes callData)`. Element offsets count from the word after the array length. The bracketed outflow of item d (begin, transfer 10 USDG, end) encodes as:

```
0000  ...0020   offset of the array
0020  ...0003   3 executions
0040  ...0060   offset of execution 0 (from 0x40)
0060  ...0100   offset of execution 1
0080  ...01e0   offset of execution 2
00a0  module    target
00c0  0         value
00e0  ...0060   offset of callData within the tuple
0100  ...0004   callData length
0120  48985fbf  beginOwnerOp()
0140  USDG      target
...             transfer(0x0062...42c5, 10e6), 0x44 bytes
0220  module    target
...             bc6424a1 endOwnerOp()
```

- Delegatecall: `abi.encodePacked(address delegate, bytes callData)`. Kernel supports it from executors. Sleeve has no reason to use it.

Results, all shown in `test_recipe_executorModes` with Kernel's own `MockExecutor`:

- Default exec type reverts with the failing call's exact revert data. USDG reverts a transfer above the balance with `InsufficientFunds()` (0x356680b7).
- Try exec type swallows the failure. The account emits `TryExecuteUnsuccessful(uint256 index, bytes result)` (topic 0xe723f28f...) and a batch keeps running the later calls. `returnData[i]` holds the revert data.
- `returnData` has one entry per call. For a USDG transfer it is `abi.encode(true)`.
- `supportsExecutionMode` returns true for call type 0xfe (static), but `ExecLib.execute` has no branch for it and reverts `"Unsupported"`.

The owner's UserOps use `execute(bytes32 mode, bytes executionCalldata)` (0xe9ae5c53) with the same mode and calldata layouts. The SDK encodes one call as single and two or more as batch.

## 6. Owner UserOps in a forge test

### Kernel's own helpers

Kernel v3.1 ships its test helpers in `src/sdk/KernelTestBase.sol` (`_prepareUserOp`, `encodeNonce`, `encodeExecute`, `_installExecutor`) and the ECDSA signing override in `test/ECDSAValidator.t.sol` (`_rootSignUserOp`). Both compile with this repo's settings (solc 0.8.28, cancun, forge-std 1.11.0). They cannot be used as they are for G6:

- `KernelTestBase.setUp()` is not virtual. It builds its own stack: the EntryPoint at the canonical address through the CREATE2 proxy (on a fork that resolves to the deployed one), plus a freshly deployed `Kernel` implementation, `KernelFactory`, `FactoryStaker` and mocks. Its helpers read those state variables, so they would create and drive accounts on local bytecode, not on the deployed implementation and factory.
- `KernelTestBase` declares 17 test functions of its own. Any contract that inherits it, in any file under `test/`, runs those tests inside our suite.

So `KernelForkBase.sol` reimplements the two routines with the same encoding and signing, and uses Kernel's own code for the rest: `ExecLib` for modes and execution calldata, `ValidatorLib` for identifiers and nonce keys, Kernel's `PackedUserOperation`, `IEntryPoint`, `MockExecutor` and `MockHook`.

### Building and signing

```solidity
// 1. Nonce key, the SDK's layout for a root (sudo) validator on EntryPoint v0.7:
//    1 byte mode 0x00 | 1 byte type 0x00 | 20 bytes root validator address | 2 bytes parallel key
uint192 key = ValidatorLib.encodeAsNonceKey(bytes1(0x00), bytes1(0x00), bytes20(ECDSA_VALIDATOR), 0);
// = 0x0000 845adb2c711129d4f3966735ed98a9f09fc4ce57 0000
uint256 nonce = ENTRY_POINT.getNonce(account, key); // key << 64 | sequence

// 2. The op. Root UserOps may call any account function, for example execute, installModule or uninstallModule.
PackedUserOperation memory op = PackedUserOperation({
    sender: account,
    nonce: nonce,
    initCode: "",                    // or meta factory initCode for the first op
    callData: abi.encodeCall(Kernel.execute, (ExecLib.encodeSimpleBatch(), ExecLib.encodeBatch(calls))),
    accountGasLimits: bytes32(abi.encodePacked(uint128(verificationGasLimit), uint128(callGasLimit))),
    preVerificationGas: preVerificationGas,
    gasFees: bytes32(abi.encodePacked(uint128(maxPriorityFeePerGas), uint128(maxFeePerGas))),
    paymasterAndData: "",
    signature: ""
});

// 3. Signature: EIP-191 personal sign over the userOpHash, packed r, s, v. No prefix byte.
bytes32 userOpHash = ENTRY_POINT.getUserOpHash(op); // covers the EntryPoint address and chain id 4663
(uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerKey, ECDSA.toEthSignedMessageHash(userOpHash));
op.signature = abi.encodePacked(r, s, v);

// 4. Submit from a bundler EOA. Never prank the account.
vm.prank(bundler, bundler);
ENTRY_POINT.handleOps(ops, payable(bundler));
```

Notes on each step:

- Nonce: Kernel v3 reads the validation mode and validator from the nonce key, not from the signature. For root type 0x00 it ignores the 20 address bytes and uses the stored root. Key 0 also validates, on its own sequence (`test_recipe_rootNonceLanes`). Use the SDK's key in tests and scripts so they share the app's sequence.
- Non-root validators use type 0x01 and their own address in the key: `encodeAsNonceKey(bytes1(0x00), bytes1(0x01), bytes20(validator), 0)` (`test_G6_j`).
- Signature: the ECDSA validator first tries `recover(userOpHash, sig)` and then the EIP-191 hash. The SDK signs EIP-191 (`signMessage({ message: { raw: hash } })`), which costs a second ecrecover (3,000 gas). Signing with the wrong key, or changing callData after signing, makes the whole handleOps call revert `FailedOp(0, "AA24 signature error")`, and the same op signed by the owner then goes through (`test_recipe_wrongSignatureIsRejected`).
- Gas fields in the tests: verificationGasLimit 1,000,000, callGasLimit 1,000,000, preVerificationGas 100,000, maxPriorityFeePerGas 0 (Arbitrum orders first come first served) and maxFeePerGas twice the block's base fee. With no paymaster the account pays the prefund from its ETH balance (`vm.deal(account, 0.01 ether)`). Bundlers will want maxFeePerGas at or above the base fee and their own estimates for the limits.
- Outcome: handleOps does not revert when the account's call reverts. Read `UserOperationEvent(userOpHash, sender, paymaster, nonce, success, actualGasCost, actualGasUsed)` and `UserOperationRevertReason(userOpHash, sender, nonce, revertReason)`, which carries the exact inner revert data, for example `NoOpenBracket(account)` in `test_G6_c`. Validation failures do revert handleOps: `FailedOp(i, "AA24 signature error")`, or `FailedOpWithRevert(i, "AA23 reverted", inner)` when the account's validateUserOp reverts. `KernelForkBase._handleOps` returns both per op.
- `actualGasUsed` includes preVerificationGas and EntryPoint v0.7's penalty of 10 percent of unused `callGasLimit + paymasterPostOpGasLimit` (EntryPoint.sol v0.7.0, `_postExecution`). Measured: the item d op with callGasLimit 200,000 instead of 1,000,000 used exactly 80,000 less (252,209 against 332,209 under `--isolate`). Overestimating callGasLimit costs real gas.

### Gas measured with `--isolate`

`forge test --isolate` runs each top-level call as its own transaction, so cold access costs are real. Numbers are gas, from the traces:

| UserOp | handleOps | validateUserOp | Execution detail | actualGasUsed |
| --- | --- | --- | --- | --- |
| Bracketed outflow, item d | 179,272 | 51,902 | beginOwnerOp 14,751, USDG transfer 37,270, endOwnerOp 9,609 | 332,209 |
| Unbracketed batch of two transfers, item f | 190,005 | 51,578 | transfers 43,770 and 30,470 | 342,358 |
| First op: deploy through meta factory plus one transfer | 354,231 | 67,278 | deployWithFactory 154,245, transfer 43,770 | 506,536 |

The brackets cost about 18,000 gas net per owner batch: 24,360 for the two calls, less about 6,500 that the transfer saves because beginOwnerOp already warmed USDG and the account's balance slot.

## 7. Uninstalling an executor

`uninstallModule(2, module, deInitData)` (0xa71763a8), with the same callers as install. Kernel v3.1:

1. sets `executorConfig(module).hook` to `address(0)`,
2. calls `module.onUninstall(deInitData)` through `ExcessivelySafeCall`, passing `gasleft()`, and ignores the result,
3. emits `ModuleUninstallResult(module, bool success)` (topic 0x2b82f87b...) and `ModuleUninstalled(2, module)`.

After that, `executeFromExecutor` from the module reverts `InvalidExecutor()` (`test_recipe_uninstallExecutorThroughUserOp`). The executor's hook, if it had one, is not uninstalled or notified by this call.

A reverting `onUninstall` cannot block the uninstall. Kernel completes it, emits `ModuleUninstallResult(module, false)` and leaves the module state behind (`test_recipe_uninstallIgnoresRevertingOnUninstall`). An `onUninstall` that runs out of gas keeps 63/64 of the gas (EIP-150), and Kernel has to finish on the last 1/64. With callGasLimit 100,000 the uninstall UserOp fails with empty revert data and the module stays installed. With 1,000,000 it completes with `ModuleUninstallResult(module, false)` (`test_recipe_outOfGasOnUninstallDependsOnCallGasLimit`). In the 100,000 trace, `onUninstall` burned 91,911 gas, and Kernel emitted `ModuleUninstallResult` and ran out of gas before `ModuleUninstalled`, which reverted the whole call, including the cleared `executorConfig`. In the 1,000,000 trace, `onUninstall` burned 964,071 gas and the UserOp's actualGasUsed was 1,126,182, all paid by the account.

SPEC section 6 has SleeveModule's `onUninstall` release every pending bucket. If that release reverts, Kernel removes the module and the release silently does not happen. If it runs out of gas, the whole uninstall fails, or, when the UserOp's callGasLimit leaves enough for Kernel's last 1/64, the module is removed without the release. Options for the module component: keep onUninstall bounded in gas, have the app give the uninstall UserOp enough callGasLimit and check `ModuleUninstallResult`, or release pending buckets in a separate call before uninstalling.

## 8. Brackets and transient storage

- SpikeModule keys a transient slot per account, `keccak256(abi.encode(account, keccak256("sleeve.spike.bracket")))`, and stores `balance + 1` so zero means no open bracket. `endOwnerOp` adds `balanceNow - balanceAtBegin` to the ledger and zeroes the slot.
- The install gate is keyed by `msg.sender`. Any contract can call `onInstall` for itself and then bracket its own ledger (`test_recipe_selfRegisteredCallerOnlyReachesItsOwnState`). Kernel writes `executorConfig` before it calls `onInstall`, and any contract can answer `isModuleInstalled`, so a module cannot prove its caller is a real account (`test_recipe_accountListsExecutorBeforeOnInstall`). Isolation comes from keying every slot by `msg.sender`: a self-registered contract never reaches an account's ledger or bracket.
- Transient storage lasts for the whole transaction, so a bracket is scoped to the transaction, not to the UserOp. If one UserOp opens a bracket and does not close it, the account's next UserOp in the same bundle finds it open (`test_recipe_openBracketCarriesIntoNextUserOpOfTheBundle`). SpikeModule reverts `BracketAlreadyOpen`, which is what SPEC section 7 asks of `beginOwnerOp` (`OwnerOpAlreadyOpen`), so the failure is loud. The open bracket stays with its account: another account's bracketed op later in the same bundle records its outflow normally (`test_recipe_openBracketStaysWithItsAccountInTheBundle`).
- A batch that reverts rolls back its TSTOREs with everything else. Use the default exec type for bracketed batches: with try mode a failed `endOwnerOp` would be swallowed and leave the bracket open for the rest of the transaction.
- Forked tests run forge's EVM at the repo's evm_version (cancun), not ArbOS, so `test_G6_h` also asks the chain through live `eth_call`s. Init code `0x602a60005d60005c60005260206000f3` (TSTORE 42, TLOAD, return) returns 42. `TransientProbe`'s runtime, placed at its address by a state override, returns 7 when one call stores and loads the value in separate call frames, and 0 when a fresh call loads the same slot. Manual checks with `cast`, not test assertions: init code made of the undefined opcode 0x0c returns `invalid opcode: opcode 0xc not defined`, so the node really executes init code, an MCOPY probe also works, and `ArbSys.arbOSVersion()` returns 116, which is ArbOS 61 (Nitro reports 55 plus the ArbOS version).
- Under `forge test --isolate`, transient values do not survive between top-level calls of a test, since each is a separate transaction. The bracket tests still pass because begin and end run inside one handleOps call. The `bracketOpen` checks that d and e make after handleOps then read a fresh transaction, so they carry weight only in the default run, which is the gate command.

## 9. P256 and the passkey path

Live `eth_call` to 0x0000000000000000000000000000000000000100 returns 1 for two known-valid vectors and empty output for a tampered one:

- go-ethereum `core/vm/testdata/precompiles/p256Verify.json` (master), vector "CallP256Verify".
- The RIP-7212 reference implementation's copy of the same file (github.com/ulerdogan/go-ethereum, branch ulerdogan-secp256r1), vector "wycheproof/ecdsa_secp256r1_sha256_p1363_test.json EcdsaP1363Verify SHA-256 #1: signature malleability".

Both vectors also verify offline with python-ecdsa. Input layout: hash, r, s, x, y, 32 bytes each. Forge's EVM at cancun has no precompile at 0x100, so a forked test sees empty output for the same valid vector. A forked forge test at this evm_version cannot exercise passkey verification that relies on the precompile. Live `eth_call`s can. Other workarounds were not tried here.

The deployed passkey validator 0.0.3 reports `isModuleType(1)` true and `isModuleType(4)` false.

## 10. Gotchas

1. The vendored submodule is pinned at the wrong commit. `forge install` added `contracts/lib/kernel` to the index at f2a84a33, the head of the default dev branch with v4 sources, and then checked out v3.1 (03f7f5cf) in the working tree. Commit 9acdf7d recorded f2a84a33, so HEAD pins it too, while foundry.lock records v3.1. Stage the submodule at 03f7f5cf (`git add contracts/lib/kernel`) in the G6 commit, or a fresh clone checks out v4 and the spike imports no longer match it.
2. Kernel's foundry.toml does not reproduce the deployed bytecode under forge 1.x (section 2). Do not use Kernel's toml defaults to argue a match.
3. The deployed ECDSA validator differs from the tag's source by one line: `onInstall` reverts `AlreadyInitialized(account)` for an account that already has an owner. Installing the same validator twice on one account fails. Item j deploys a fresh validator for that reason.
4. Neither the meta factory nor the v3.1 factory has an EntryPoint stake on 4663. Under ERC-7562's storage rules (STO-022, STO-031) a deploying UserOp may touch storage outside the account only through a staked factory, and both paths do: the meta factory reads its own `approved` mapping, and `initialize` writes the validator's per-account storage. A bundler that enforces ERC-7562 may therefore reject the first UserOp of a new account. This was not checked against a live bundler. Fallback: `KernelFactory.createAccount(initData, salt)` is permissionless, so a plain transaction can deploy the account at the same address (174,107 gas with `--isolate`), and later UserOps carry no initCode.
5. `test_G6_i` and `test_G6_h` depend on the public RPC being up, because their live parts use `vm.rpc`.
6. Gas numbers from a normal `forge test` run are too low: setup calls in the same test warm USDG and the account. Use `--isolate` for gas.
7. `actualGasUsed` is inflated by preVerificationGas and the unused call gas penalty (section 6).
8. With an ECDSA root, the owner EOA can call the account directly, skipping the EntryPoint (section 11).

## 11. Findings that touch the PRD or SPEC

These came out of the spike and need an owner decision before anyone acts on them. Nothing in the spike depends on them.

1. The root validator is not exempt from hooks in the deployed v3.1. PRD 7.1 cites Kernel's current source (S36, `src/Kernel.sol` on the default dev branch, at f2a84a33 on 2 October, which is v4 with `accountId` `kernel.v0.4`), and that source does exempt the root from validation hooks by design. The precise finding is narrower: PRD decision 27 assumes a hook on the owner's key would never fire, which holds for v4 but not for v3.1, the version ZeroDev deploys on 4663 and G6 tested. In v3.1, and in the v3.2 and v3.3 tags and the main branch (last commit April 2024), `validateUserOp` treats the root like any validator for hooks: if the root's ValidationConfig carries a hook, a root UserOp must call `executeUserOp` (plain `execute` fails validation with `OnlyExecuteUserOp`) and the hook's preCheck and postCheck wrap it. The root is exempt only from the per-validator selector allowlist and from nonce revocation. `test_recipe_rootHookIsEnforcedOnUserOps` shows this on the deployed implementation, with the hook set through `initialize`. A Sleeve hook on the root could bracket every root UserOp, removing the item f limit for UserOps. Direct calls and executors would still bypass it, and adding a hook to an existing root was not tested (the deployed ECDSA validator refuses a second install).
2. An ECDSA root can act without the EntryPoint. The ECDSA validator is also a hook-type module (`isModuleType(4)` is true), and Kernel v3.1's `onlyEntryPointOrSelfOrRoot` lets any caller through if the root validator's `preCheck` accepts it. The ECDSA validator accepts its owner, so the owner EOA can call `execute`, `installModule` and the rest directly, with no UserOp and no brackets (`test_recipe_rootOwnerCanCallAccountDirectly`). A stranger gets `"ECDSAValidator: sender is not owner"`. The passkey validator is not a hook type, so a passkey root cannot do this. This matters if the recovery key is an ECDSA root.
3. SPEC section 6 says `onUninstall` never reverts for an installed account. Kernel v3.1 ignores a reverting `onUninstall`, so the release can be skipped silently. An out-of-gas `onUninstall` can also make the whole uninstall fail when callGasLimit is small. Keep `onUninstall` bounded and check `ModuleUninstallResult` (section 7).
