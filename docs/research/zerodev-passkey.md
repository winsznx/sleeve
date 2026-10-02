# ZeroDev passkey login on Robinhood Chain (4663)

Research note for owner decision D-003 (passkey is the only M0 login, through ZeroDev's passkey validator, relying-party id set to Sleeve's production domain). Covers PRD 7.1, 7.2, 7.13 and 13. Written 2 October 2026. All times are UTC. Block numbers are Robinhood Chain L2 blocks unless marked otherwise.

Nothing here was deployed or sent. Every onchain result comes from `cast` reads or `eth_call`, the full account flow ran inside `eth_call` against live chain state with state overrides, and no account was created anywhere. Scripts and logs sit in the session scratchpad (section 12) and can move into `app/test` when the app component starts.

## 0. Short answers

1. Use `KERNEL_V3_1` with `PasskeyValidatorContractVersion.V0_0_3_PATCHED`. On 4663 the passkey validator 0.0.3 at 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 exists and its bytecode equals the Sourcify-verified copy on Arbitrum One. Versions 0.0.1 and 0.0.2 do not exist on 4663. Kernel v3.0, v3.1, v3.2 and v3.3 implementations and factories, the meta factory and both v3 ECDSA validators all exist. This matches the G6 spike, which uses v3.1 (docs/research/g6-notes.md).
2. The RIP-7212 P-256 precompile at 0x...0100 is live on 4663: two known-valid vectors return 1, an invalid and a tampered vector return empty output. It costs about 6,900 gas (EIP-7951 pricing), not the 3,450 gas ZeroDev's docs quote.
3. The passkey validator calls either the precompile or Daimo's Solidity verifier at 0xc2b7...4De4, chosen per signature by a `usePrecompiled` flag the client sets. There is no automatic fallback onchain. The SDK sets the flag from a hardcoded chain list that does not include 4663, so the SDK default on 4663 is the Solidity path. Measured on live state: `validateUserOp` costs 66,033 gas with the precompile and 404,490 to 414,058 gas with the Solidity verifier. The recipe sets the flag to true.
4. `toWebAuthnKey` needs a passkey server URL for both register and login unless the app hands it a finished `WebAuthnKey`. ZeroDev's hosted server takes the rpID from the project's dashboard domain and ignores the `rpID` the client sends (live probe, section 6). Recommendation: skip the passkey server, run the WebAuthn ceremony in the app with `rp.id` pinned to the production domain, and keep credential id to public key records in Supabase. This still uses ZeroDev's passkey validator contract and SDK, which is what D-003 names.
5. Bundler and paymaster share one URL: `https://rpc.zerodev.app/api/v3/<projectId>/chain/4663`. ZeroDev lists Robinhood 4663 as a supported network, its network API shows it live and not self-funded only, and Robinhood's own AA page shows the same URL with `KERNEL_V3_1`.
6. The full flow works on live 4663 state through EntryPoint v0.7 `handleOps`: deploy with a passkey root, install an ERC-7579 executor through `initConfig`, run a `[beginOwnerOp, ..., endOwnerOp]` batch, uninstall the executor in a later bracketed batch, install a recovery signer, and let that recovery signer act with raw ERC-4337 encoding (no SDK, no Sleeve domain). A signature from a wrong key is refused with `AA24 signature error`.
7. Two risks need a live test with the real ZeroDev project: ZeroDev's meta factory has no EntryPoint stake on 4663 (it has 0.1 ETH staked on Arbitrum One and Base), and the Sleeve module's `onInstall` reads USDG during deployment validation. A strict ERC-7562 bundler could reject the first UserOp. At least 5,486 Kernel accounts have been deployed on 4663 through that same unstaked meta factory, among them passkey accounts (the latest passkey deployment, decoded in 3.4, went through it), so the bundlers in use there accept it today. Fallback: deploy the account with a plain transaction to the factory, which gives the same address.
8. A passkey cannot be exported, and it only signs on Sleeve's rpID domain. If Sleeve's domain is gone, the passkey cannot act anywhere. PRD 7.13 and I11 therefore depend on the recovery signer, not on the passkey. Section 9 gives a tested design.

## 1. Package versions

Command: `npm view <pkg> version dist-tags time --json`, run 2026-10-02 14:53Z.

| Package | Latest | Published (npm `time`) | Notes |
| --- | --- | --- | --- |
| @zerodev/sdk | 5.5.10 | 2026-04-01T15:09:59Z | dependencies: `semver` only, peer `viem ^2.28.0` |
| @zerodev/passkey-validator | 5.6.0 | 2025-09-18T16:52:50Z | deps `@noble/curves ^1.3.0`, `@simplewebauthn/browser ^8.3.4`; peers sdk ^5.4.0, webauthn-key ^5.4.2, viem ^2.28.0 |
| @zerodev/webauthn-key | 5.5.0 | 2025-12-05T14:17:57Z | deps `@noble/curves`, `@simplewebauthn/browser ^8.3.4`, `@simplewebauthn/types ^12.0.0` |
| @zerodev/ecdsa-validator | 5.4.9 | 2025-05-06T18:23:14Z | not needed for passkey login; its validator contract is the recovery signer (section 9) |
| permissionless | 0.4.1 | 2026-09-09T11:08:50Z | not a dependency of @zerodev/sdk v5; not needed |
| viem | 2.57.2 | 2026-10-01T00:44:54Z | exports chain 4663 as `robinhood` |

Tarballs: `npm pack @zerodev/sdk@5.5.10 @zerodev/passkey-validator@5.6.0 @zerodev/webauthn-key@5.5.0 @zerodev/ecdsa-validator@5.4.9` into the scratchpad. Packaging quirks found while running them in Node 24:

- `@zerodev/sdk`'s CommonJS build calls `require("tslib")` (`_cjs/index.js` line 4) but `tslib` is not in its dependencies. `@zerodev/passkey-validator` has no `exports` map, so Node's ESM loader takes its CommonJS `main`, which then requires the SDK's CommonJS build. Result: `Error: Cannot find module 'tslib'` in Node scripts and tests. Fix: add `tslib` as a dev dependency for Node tests. Next.js bundles use the `module` (ESM) builds and are not affected.
- viem 2.57.2 has no `robinhoodMainnet` export. `import { robinhoodMainnet } from "viem/chains"` fails with `SyntaxError: The requested module 'viem/chains' does not provide an export named 'robinhoodMainnet'`. The export is `robinhood` (id 4663). Its default RPC list is `https://rpc.mainnet.chain.robinhood.com` and a third-party `https://rpc.ordofi.network`, so always pass an explicit transport URL.

## 2. SDK constants

From the packed sources, `@zerodev/sdk/constants.ts` (`KernelVersionToAddressesMap`), `@zerodev/ecdsa-validator/constants.ts` and `@zerodev/passkey-validator/index.ts`.

Kernel (EntryPoint v0.7 for all v3 versions):

| Constant | Version string | Implementation | Factory | Meta factory (FactoryStaker) |
| --- | --- | --- | --- | --- |
| KERNEL_V3_0 | 0.3.0 | 0x94F097E1ebEB4ecA3AAE54cabb08905B239A7D27 | 0x6723b44Abeec4E71eBE3232BD5B455805baDD22f | 0xd703aaE79538628d27099B8c4f621bE4CCd142d5 |
| KERNEL_V3_1 | 0.3.1 | 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D | 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419 | same |
| KERNEL_V3_2 | 0.3.2 | 0xD830D15D3dc0C269F3dBAa0F3e8626d33CFdaBe1 | 0x7a1dBAB750f12a90EB1B60D2Ae3aD17D4D81EfFe | same |
| KERNEL_V3_3 (also KERNEL_V3_3_BETA) | 0.3.3 | 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28 | 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9 | same |

`KERNEL_7702_DELEGATION_ADDRESS` is the v3.3 implementation. Kernel v2 entries (0.2.2 to 0.2.4) use EntryPoint v0.6 and factory 0x5de4839a76cf55d0c90e2061ef4386d962E15ae3; they are out of scope.

ECDSA validator (`kernelVersionRangeToValidator`):

| Kernel range | Address |
| --- | --- |
| 0.0.2 - 0.2.4 | 0xd9AB5096a832b9ce79914329DAEE236f8Eea0390 |
| 0.3.0 | 0x8104e3Ad430EA6d354d013A6789fDFc71E671c43 |
| >=0.3.1 | 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57 |

Passkey (WebAuthn) validator (`kernelVersionRangeToContractVersionToValidator`):

| Kernel range | Validator contract version | Address |
| --- | --- | --- |
| 0.0.2 - 0.2.4 | 0.0.1 | 0x1e02Ff20b604C2B2809193917Ea22D8602126837 |
| 0.3.0, 0.3.1, 0.3.2, 0.3.3 | 0.0.1 (`V0_0_1_UNPATCHED`) | 0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06 |
| same | 0.0.2 (`V0_0_2_UNPATCHED`) | 0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd |
| same | 0.0.3 (`V0_0_3_PATCHED`) | 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 |

`toPasskeyValidator.ts` says of 0.0.2: "this version is only supported by kernel versions "0.3.0 || 0.3.1"", while the map lists it for all four v3 versions. It does not matter on 4663, where only 0.0.3 exists.

## 3. Onchain checks on 4663

### 3.1 Code presence

Command per address: `cast code --rpc-url https://rpc.mainnet.chain.robinhood.com <addr>`, size = bytes of the result, then the same against Arbitrum One (`https://arb1.arbitrum.io/rpc`) and a keccak comparison. Robinhood blocks 78,319,765 to 78,320,035 (14:57:13Z to 14:57:40Z). Arbitrum One block 511,018,586.

| Item | Address | Code on 4663 (bytes) | Same as Arbitrum One |
| --- | --- | --- | --- |
| EntryPoint v0.7 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | 16,035 | same codehash |
| Kernel v3.0 implementation | 0x94F0...7D27 | 20,427 | yes except immutables (see below) |
| Kernel v3.0 factory | 0x6723...D22f | 989 | same |
| Kernel v3.1 implementation | 0xBAC8...4b4D | 22,784 | yes except immutables |
| Kernel v3.1 factory | 0xaac5...E419 | 989 | same |
| Kernel v3.2 implementation | 0xD830...aBe1 | 23,563 | yes except immutables |
| Kernel v3.2 factory | 0x7a1d...EfFe | 950 | same |
| Kernel v3.3 implementation | 0xd6CE...5b28 | 24,469 | yes except immutables |
| Kernel v3.3 factory | 0x2577...F2E9 | 950 | same |
| Meta factory (FactoryStaker) | 0xd703...42d5 | 1,871 | same |
| ECDSA validator for 0.3.0 | 0x8104...1c43 | 1,856 | same |
| ECDSA validator for >=0.3.1 | 0x845A...cE57 | 1,819 | same |
| Passkey validator 0.0.1 (v3) | 0xD990...Aa06 | 0, absent | Arbitrum has 3,494 |
| Passkey validator 0.0.2 (v3) | 0xbA45...90Fd | 0, absent | Arbitrum has 3,472 |
| Passkey validator 0.0.3 (v3) | 0x7ab1...9e69 | 4,739 | same |
| Passkey validator 0.0.1 (v2) | 0x1e02...6837 | 0, absent | |
| Daimo P256Verifier (validator's Solidity fallback) | 0xc2b78104907F722DABAc4C69f826a522B2754De4 | 3,537 | same |
| ZeroDev recovery action (`doRecovery(address,bytes)`, selector 0xac39fd0f) | 0xe884C2868CC82c16177eC73a93f7D9E6F3A5DC6E | 513 | identical bytecode |
| SDK `TOKEN_ACTION` | 0x2087C7FfD0d0DAE80a00EE74325aBF3449e0eaf1 | 0, absent | absent there too |
| SDK `ONLY_ENTRYPOINT_HOOK_ADDRESS` | 0xb230f0A1C7C95fa11001647383c8C7a8F316b900 | 0, absent | Arbitrum has 1,107 |
| SDK `MULTISEND_ADDRESS` (Kernel v2 only) | 0x8ae01fcf7c655655ff2c6ef907b8b4718ab4e17c | 0, absent | |
| P-256 precompile | 0x0000000000000000000000000000000000000100 | 0 (precompiles have no code; live test in section 4) | |

The four Kernel implementations differ from Arbitrum One in exactly 34 bytes each, in two runs: one 32-byte word and the chain id word, `0x...1237` (4663) against `0x...a4b1` (42161). The 32-byte word is the cached EIP-712 domain separator. For v3.1 the 4663 value is 0x46883995419b7ad2307c3fe8f26ad53b1b4f88c3600ad094d0ad988702fcc38b, which g6-notes.md section 2 recomputes from the immutables. So these are the same builds with chain-specific immutables.

`ONLY_ENTRYPOINT_HOOK_ADDRESS` is missing on 4663. The SDK only uses it when an app sets a custom action with a hook, which this recipe does not.

### 3.2 Passkey validator source

Sourcify has verified source for 0x7ab1...9e69 on Arbitrum One: `https://sourcify.dev/server/v2/contract/42161/0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69` returned `"match":"match"` with `creationMatch` and `runtimeMatch` both `"match"` (Sourcify's v2 status for a bytecode match; `"exact_match"` would also require the metadata hash), contract `src/WebAuthnValidator.sol:WebAuthnValidator`, solc 0.8.30, via IR, 20,000 runs, deployer 0x9775137314fE595c943712B0b336327dfa80aE8A (retrieved 15:00:58Z). Sourcify's `runtimeBytecode.onchainBytecode` equals `cast code` on 4663 byte for byte, so this is the source of the 4663 contract. 0x9775...aE8A is also the meta factory's `owner()` on 4663 and the address ZeroDev's network API links for chain 4663 (section 7).

What the source does, quoted from that verified copy:

- `onInstall` decodes `(WebAuthnValidatorData, bytes32)`, that is (x, y, authenticatorIdHash), reverts `InvalidPublicKey` on a zero coordinate, stores x and y under `webAuthnValidatorStorage[msg.sender]` and emits `WebAuthnRegistered(address indexed kernel, uint256 pubKeyX, uint256 pubKeyY)`. The authenticator id hash is decoded and dropped.
- `validateUserOp` and `isValidSignatureWithSender` decode the signature as `(bytes authenticatorData, string clientDataJSON, uint256 responseTypeLocation, uint256 r, uint256 s, bool usePrecompiled)`.
- `WebAuthn.verifySignature` requires the UP and UV flags (`requireUserVerification` is passed as `true`), checks `"type":"webauthn.get"` at `responseTypeLocation` and the base64url challenge at fixed offset 23, and verifies `sha256(authenticatorData || sha256(clientDataJSON))`. It does not check the origin or the rpIdHash: "It is considered the authenticator's responsibility to ensure that the user is interacting with the correct RP."
- `P256.verifySignature` rejects `s > n/2`, then:

```solidity
if (usePrecompiled) {
    (bool success, bytes memory ret) = PRECOMPILED_VERIFIER.staticcall(args);
    if (success == false || ret.length == 0) {
        return false;
    }
    return abi.decode(ret, (uint256)) == 1;
} else {
    (, bytes memory ret) = DAIMO_VERIFIER.staticcall(args);
    return abi.decode(ret, (uint256)) == 1;
}
```

So the validator uses either path, never both, and the client picks it per signature.

### 3.3 Meta factory approvals and stake

Commands against `https://robinhood.drpc.org` (the public RPC returned a Cloudflare 403 challenge at that moment), block 78,326,441, 15:08:23Z:

- `cast call 0xd703...42d5 'approved(address)(bool)' <factory>` returned `true` for all four v3 factories.
- `cast call 0xd703...42d5 'owner()(address)'` returned 0x9775137314fE595c943712B0b336327dfa80aE8A.
- `cast call 0xaac5...E419 'implementation()(address)'` returned 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D; the v3.3 factory returned 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28.
- `cast call 0x0000000071727De22E5E9d8BAf0edAc6f37da032 'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' 0xd703...42d5` returned `(0, false, 0, 0, 0)`. The same zeros for the v3.1 and v3.3 factories and the passkey validator (block 78,327,959, 15:10:57Z).
- The same call on Arbitrum One and Base returned `(0, true, 100000000000000000 [1e17], 86400, 0)` (15:10:16Z).

So the meta factory is staked (0.1 ETH, one-day unstake delay) on Arbitrum One and Base but not on 4663. Only its owner can stake it (`stake(IEntryPoint, uint32) external payable onlyOwner` in Kernel's `src/factory/FactoryStaker.sol` at tag v3.1). g6-notes.md finding 4 reaches the same result. Section 7.3 explains why it matters and section 7.4 shows what is happening on chain.

### 3.4 Usage on 4663

`eth_getLogs` on the public RPC (it allows 10,000,000-block ranges), latest block 78,334,220 at 15:21:26Z, EntryPoint v0.7 `AccountDeployed(bytes32,address,address,address)` (topic 0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d), factory read from the event data. Six of eight 10M-block windows returned; two failed (`log query timed out`, `logs matched by query exceeds limit of 10000`), so these counts are lower bounds:

| Factory in `AccountDeployed` | Deployments counted |
| --- | --- |
| 0xd703...42d5 (ZeroDev meta factory) | 5,486 |
| 0xaac5...E419 (Kernel v3.1 factory, direct) | 588 |
| 0x2577...F2E9 (Kernel v3.3 factory, direct) | 2 |

Of the 5,486 meta factory deployments, 4,768 had no paymaster, 637 used paymaster 0x00000000000667F27D4DB42334ec11a25db7EBb4, 15 used six other paymasters and 66 used 0x777777777777AeC03fd955926DbF81597e66834C (Sourcify exact match on Arbitrum and Base as `SingletonPaymasterV7`, deployer 0x4337001Fff419768e088Ce247456c1B892888084). The latest of those 66, tx 0xfc5bc1f6ee8394203c4ec035b7ed2297404a4c08b89c69ddf670977d54a4a911 at block 77,689,730, has status success and was sent to the EntryPoint by 0x43370108f30Ee5Ed54A9565F37af3BE8502903f5.

Passkey accounts: `eth_getLogs` on 0x7ab1...9e69 for `WebAuthnRegistered(address,uint256,uint256)` (topic 0xac9eef70e30b05ba935b5092b39f4fe85762ee3a8853386ea1e9a224986976ef) over all eight windows, latest block 78,335,764 at 15:24:02Z: 51 events, first at block 8,690,835, latest at block 77,645,384.

Decoding that latest one, tx 0x8b6be63d7defb896e84e35769ff68ac4fc66da6ceb02220105d5ee2665c45afd (`cast tx ... input`, decoded with viem's `entryPoint07Abi`): `handleOps` from 0xb2f52CB5A2094A00101D91EEb65b85CB1d86431E, sender 0x5e644bEc35BEcE1A3A42Dd2d43A121c6609d8BE5, initCode through the meta factory, no paymaster, signature flag `usePrecompiled false`, authenticator flags 0x1d (UP, UV, BE, BS: a synced passkey), receipt status 1, gasUsed 773,418. So a third-party app on 4663 already pays for the Solidity verifier, which is what the SDK default produces there.

## 4. P-256 verification on 4663

### 4.1 The precompile

Test vectors: `https://raw.githubusercontent.com/ethereum/go-ethereum/master/core/vm/testdata/precompiles/p256Verify.json`, retrieved 14:58:52Z, 782 vectors. Input layout is hash, r, s, x, y, 32 bytes each. Used: entry 0 `"CallP256Verify"` (expected `...01`), entry 1 `"wycheproof/ecdsa_secp256r1_sha256_p1363_test.json EcdsaP1363Verify SHA-256 #1: signature malleability"` (expected `...01`), entry 2 `"... #3: Modified r or s, e.g. by adding or subtracting the order of the group"` (expected empty), and entry 0 with one bit of the hash flipped.

`curl` JSON-RPC `eth_call` to 0x0000000000000000000000000000000000000100 on the public RPC, block 78,320,891, 14:59:06Z:

| Vector | Result |
| --- | --- |
| CallP256Verify (valid) | `0x0000000000000000000000000000000000000000000000000000000000000001` |
| Wycheproof #1 (valid) | `0x...0001` |
| Wycheproof #3 (invalid) | `0x` |
| CallP256Verify with hash bit flipped | `0x` |

Cost: `eth_estimateGas` for the valid call returned 0x7837 (30,775) and the same calldata to an empty address returned 0x5d35 (23,861), a difference of 6,914. A staticcall measured inside a contract (section 4.3) took 7,308 gas including call overhead. Both fit EIP-7951's 6,900 gas price. ZeroDev's passkeys page says "only 3450 gas for verifying a P256 signature", which is the older RIP-7212 price and does not hold on 4663.

`cast call 0x0000000000000000000000000000000000000064 'arbOSVersion()(uint256)'` returned 116. Nitro's `precompiles/ArbSys.go` computes it as `55 + c.State.ArbOSVersion() // Nitro starts at version 56`, so 4663 runs ArbOS 61.

g6-notes.md section 9 notes that Forge's EVM at cancun has no precompile at 0x100. Forked forge tests cannot exercise the precompile path; `eth_call` against the live node can, which is how section 5 tests it.

### 4.2 What the SDK sends on 4663

`@zerodev/passkey-validator/toPasskeyValidator.ts` builds the signature with `isRIP7212SupportedNetwork(chainId)` as the `usePrecompiled` value. `@zerodev/webauthn-key/utils.ts` defines that as membership in a hardcoded `RIP7212_SUPPORTED_NETWORKS` list. Run in the installed package: `isRIP7212SupportedNetwork(4663)` is `false`, `isRIP7212SupportedNetwork(42161)` is `true`. ZeroDev's "Chains with Native Passkey Precompiles" list on https://docs.zerodev.app/onboarding/passkeys/overview also omits Robinhood (retrieved 15:02:22Z).

The same docs page says: "ZeroDev implements passkey supports through a progressive passkey validator, which uses native passkeys if ERC-7212 is available, and falls back to smart contract passkeys otherwise. Notably, this means that if you use passkeys on a network where ERC-7212 isn't available, and the network later adds support for ERC-7212, you don't need to upgrade your validator -- it will automatically start taking advantage of the ERC-7212 precompile." The contract does not detect anything; the switch is the SDK's chain list. On 4663 the precompile is live but the SDK default still takes the Solidity path. The validator's stub signature (`getStubSignature`, used for gas estimation) also sets `usePrecompiled` to false, so bundler estimates assume the expensive path. That makes the verification gas limit high. EntryPoint v0.7 does not charge for unused verification gas (its 10 percent penalty applies to unused execution gas), but the higher limit does raise the prefund the paymaster, or the account on the owner-paid path, must cover up front.

The fix needs no contract change: the app passes a `signMessageCallback` in the `WebAuthnKey` (`toPasskeyValidator` uses it when present) and sets the flag to true. The recipe does this.

### 4.3 Measured gas

Method: a probe contract placed with an `eth_call` state override calls the validator's `onInstall` with a software P-256 key, then `validateUserOp` with WebAuthn-format signatures, and measures `gasleft()` around each call (section 12). Deterministic key, block 78,346,591 (15:42:09Z) to 78,347,185:

| Measurement | Gas |
| --- | --- |
| `validateUserOp`, `usePrecompiled = true` | 66,033 |
| `validateUserOp`, `usePrecompiled = false` (Daimo verifier) | 414,058 (404,490 with a random key at block 78,331,914) |
| raw staticcall to 0x...0100 | 7,308 |
| raw staticcall to Daimo verifier 0xc2b7...4De4 | 352,924 (343,356 with the random key) |
| `validateUserOp` with a signature from a different message | returns 1 (SIG_VALIDATION_FAILED) |

ZeroDev's docs put smart contract passkeys at "300-400k gas for verifying a P256 signature". The measured Solidity path is in that range. At the 0.0317 gwei base fee read at block 78,345,057 (`cast base-fee`), the Solidity path adds about 340,000 gas per owner UserOp, about 0.0000108 ETH, before any L1 data charge.

## 5. Full flow simulated on live 4663 state

Method: `@zerodev/sdk` 5.5.10 and `@zerodev/passkey-validator` 5.6.0 build the account and sign real UserOps with a software P-256 key that emits WebAuthn assertions (authenticatorData with flags 0x1d, a browser-shaped clientDataJSON, low-s signature). A probe contract calls EntryPoint v0.7 `handleOps` inside one `eth_call` and reads postconditions in the same call. State overrides place a stand-in executor (ERC-7579 type 2 with `beginOwnerOp` and `endOwnerOp` on transient storage), the probe, and 1 ETH on the counterfactual account. The real EntryPoint, factories, meta factory, Kernel implementations, passkey validator, ECDSA validator and precompile are the deployed ones. RPC: `https://robinhood.drpc.org`.

### 5.1 Account creation, executor install, brackets, uninstall

Same passkey for all rows. Op 1 carries initCode, installs the executor through `initConfig` and runs `[beginOwnerOp, call, endOwnerOp]`. Op 2 runs `[beginOwnerOp, uninstallModule(2, executor), endOwnerOp]` in the same bundle. "handleOps gas" is the gas used by the `handleOps` call itself; it excludes the bundle transaction's intrinsic and calldata gas and Arbitrum's L1 data charge.

| Block | Kernel | Factory in initCode | Signature path | Account | Op 1 result | Op 1 handleOps gas | Op 2 added gas | After op 2 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 78,346,591 | v3.1 | meta factory (`deployWithFactory`, 0xc5265d5d), initCode 900 bytes | precompile | 0xF2DED53982baa3074576edb3603c7A9E3cB99E45 | deployed, `accountId()` "kernel.advanced.v0.3.1", executor installed, 1 bracket closed | 497,093 | 153,308 | executor uninstalled, 2 brackets closed |
| 78,346,898 | v3.1 | Kernel factory (`createAccount`, 0xea6d13ac), initCode 868 bytes | precompile | 0xF2DE...9E45 (same) | same | 491,216 | 153,307 | same |
| 78,347,056 | v3.1 | meta factory | Daimo verifier | 0xF2DE...9E45 | same | 838,964 | 478,330 | same |
| 78,347,185 | v3.3 | meta factory | precompile | 0xE76d43ac4617ED19C609d4F0C0C2ccd55C0De05A | deployed, "kernel.advanced.v0.3.3", executor installed | 494,958 | 149,923 | same |

Negative control in every run: op 1 signed by a different P-256 key, `handleOps` reverted with `FailedOp(0, "AA24 signature error")` and nothing was deployed.

Findings from these runs:

- `initConfig` works on the deployed v3.1 and v3.3. The SDK types `initConfig` as v3.1-only (`initConfig?: KernelVerion extends "0.3.1" ? Hex[] : never`), but at runtime it uses the v3.1 `initialize(rootValidator, hook, validatorData, hookData, initConfig)` encoding for every version except 0.3.0 (`createKernelAccount.ts`, `getKernelInitData`).
- `useMetaFactory: false` yields the same account address, because the meta factory only forwards to the Kernel factory. The direct factory path is 5,877 gas cheaper.
- The account address depends on the whole `initialize` calldata, including `initConfig`: Kernel v3.1 `KernelFactory.createAccount` uses `bytes32 actualSalt = keccak256(abi.encodePacked(data, salt));`. The Sleeve module address and its install data are therefore part of every user's address, like the rpID.

### 5.2 The recipe module itself

The recipe in section 8 was type-checked with `tsc` 5.9.3 (strict, DOM lib) against the exact package versions, then run in Node with `navigator.credentials` replaced by a software authenticator that returns real ES256 attestations (SPKI public key) and assertions (DER signatures, high-s left in place). Block 78,345,318, 15:40:00Z:

- `registerPasskey`, then `buildSleeveAccount` gave account 0xd9f252488FAd87DbEfa8faf32e0676b54D86C686. `discoverPasskey` with a store lookup and a second `buildSleeveAccount` with the stored address gave the same address.
- `assertBracketed` accepted the bracketed callData and rejected an unbracketed one.
- Op 1 (deploy, executor through `initConfig` with empty init data on v3.1, bracketed install of the recovery signer) and op 2 (bracketed executor uninstall), both signed through the recipe's own `signWithPasskey`: both succeeded. Gas 578,750 and 166,030. After op 2: executor uninstalled, recovery signer installed, 2 brackets closed, and `webAuthnValidatorStorage(account)` equals the registered public key.
- `readAccountState` against a real passkey account on 4663 (0x5e64...8BE5) returned `deployed: true`, its stored public key, and `false` for both module checks.

## 6. Passkey server and rpID

### 6.1 What `toWebAuthnKey` needs

From `@zerodev/webauthn-key/toWebAuthnKey.ts` 5.5.0:

- `if (webAuthnKey) { return webAuthnKey }`: when the app passes a finished key, no server is called.
- Otherwise `passkeyServerUrl` is required (`ParamsWithoutKey` types it as required). Register posts to `${passkeyServerUrl}/register/options` with `{ username: passkeyName, rpID }`, runs `startRegistration`, then posts to `/register/verify`. Login posts to `/login/options` with `{ rpID }`, runs `startAuthentication`, posts to `/login/verify`, and takes the public key from the server's answer: `pubKey = loginVerifyResult.pubkey`. The public key has to come from somewhere because a WebAuthn assertion never contains it.
- It returns `rpID: ""` with the comment "unused because we don't need it for the signMessageCallback".

Signing goes through `signMessageUsingWebAuthn` in `toPasskeyValidator.ts`, whose options are `{ challenge, allowCredentials, userVerification: "required" }` with no `rpId`. The browser then uses the page's own hostname as the rpID. If the passkey was registered with rpID `sleeve.example` and the app runs on `app.sleeve.example`, the default signer cannot find the credential. Either serve the app on the exact rpID hostname or pass `rpId` explicitly, as the recipe's callback does. Passkeys registered on the production rpID also cannot be used from Vercel preview hostnames.

### 6.2 How ZeroDev's hosted server picks the rpID

Hosted URL format, from ZeroDev's own tutorial (`zerodevapp/passkey-tutorial`, branch `completed`, `app/page.tsx` line 22): ``const PASSKEY_SERVER_URL = `https://passkeys.zerodev.app/api/v3/${ZERODEV_PROJECT_ID}` ``.

ZeroDev docs (https://docs.zerodev.app/onboarding/passkeys/overview, 15:02:22Z): "Head to the ZeroDev dashboard, select a project, and copy the passkey server URL ... If you are testing on `localhost`, just leave the domain empty. If you are deploying to a domain, enter and save the domain."

Open-source server, `github.com/zerodevapp/passkey-server`, branch `main`, head commit 1c1fc0f6a92f244aa56222ce147f531afc38a567 (2026-03-24): the `/api/v3/:projectId/*` routes call `passkeyRepo.getPasskeyDomainByProjectId(projectId)`, which selects `passkey_domain FROM project_passkey WHERE project_id = ...` and returns `"localhost"` when there is no row ("if no passkey domain is found, return localhost"). They never read the body's `rpID`. Only the project-less `/api/v4/*` routes use `body.rpID` and then the Origin hostname. All routes verify with `expectedOrigin: c.req.header("origin")! //! Allow from any origin`.

Live probe, 15:30:35Z, `POST https://passkeys.zerodev.app/api/v3/<project>/login/options` with body `{"rpID":"sleeve.example"}` and header `Origin: https://sleeve.example`:

- Unknown project 00000000-0000-0000-0000-000000000000: `{"challenge":"...","timeout":60000,"userVerification":"required","rpId":"localhost"}`.
- ZeroDev's public demo project from the tutorial: `"rpId":"passkey-demo.zerodev.app"`.

So with the hosted server, the rpID is whatever domain is saved in the ZeroDev dashboard for the project, and the client cannot override it. Pinning it to Sleeve's domain means saving the production domain there. One domain per project, so local, preview and production need separate projects or a self-run server.

### 6.3 What ZeroDev stores

From the same open-source server: table `passkey_users (passkey_user_id, username, project_id)` and table `passkey_credentials (credential_id, passkey_user_id, public_key, counter, pub_key)`, where `public_key` holds the COSE key and `pub_key` the SPKI key from the registration response, plus registration and login challenges in a key-value store with a TTL. `username` is the `passkeyName` the app sends. ZeroDev's docs: "The passkeys server only stores the public authentication data. Even if it's compromised, your users's keys are stored on their devices only." and "If the passkey server is lost, only users who have not yet deployed their accounts (i.e. users who have been using accounts counterfactually) will be unable to recover their accounts." The hosted service's code cannot be checked; the open-source repo is the only evidence of what it stores.

### 6.4 Recommendation: no passkey server

Option A, ZeroDev's hosted server: least code. Requires the production domain saved in the dashboard, adds ZeroDev's passkey server to every login on a new device, stores the user name and public key at ZeroDev, and `toWebAuthnKey`'s server path uses `Buffer`, which a browser bundle may not provide.

Option B, recommended: the app calls `navigator.credentials.create` and `get` itself with `rp.id` and `rpId` set to the production domain, writes `credential_id -> (pubKeyX, pubKeyY, account address)` to Supabase at registration, and hands `toPasskeyValidator` a finished `WebAuthnKey`. The rpID is fixed in Sleeve's code, nothing extra runs at ZeroDev, and Supabase is already one of the agreed outside accounts. The data is public anyway: the validator emits the public key and account address when the account deploys.

Fallback if the Supabase row is lost: an ECDSA P-256 signature has two candidate public keys, so two assertions over different challenges pin down the key. Tested with `@noble/curves` 1.9.7: two candidates per signature, intersection of two signatures is exactly one key, and it equals the real key (`{ candidatesFromOne: 2, intersection: 1, recovered: true }`). The app can then rebuild the address (it needs the module address and install data, section 5.1) and confirm it with `webAuthnValidatorStorage(account)` once the account is deployed.

## 7. Bundler, paymaster and supported network

### 7.1 URL format

- ZeroDev docs, "Bundler & Paymaster RPCs" (https://docs.zerodev.app/api-and-toolings/infrastructure/rpcs, via https://docs.zerodev.app/llms-full.txt at 15:02:22Z): "Our RPCs support all standard methods defined in the ERC-4337 spec" and the `provider` query parameter with values `ULTRA_RELAY`, `ALCHEMY`, `GELATO`, `PIMLICO`; example `https://rpc.zerodev.app/api/v3/xxxxxf2d-xxxx-xxxx-90cc-xxxxxxxxx007/chain/42161?provider=ULTRA_RELAY`.
- Robinhood's AA page (https://docs.robinhood.com/chain/account-abstraction, 15:00:08Z): "Account abstraction on Robinhood Chain is powered by Alchemy, with ZeroDev available as an alternative." Its ZeroDev example: `const ZERODEV_RPC = 'https://rpc.zerodev.app/api/v3/YOUR_PROJECT_ID/chain/4663'`, `const kernelVersion = KERNEL_V3_1`, one URL used for both `bundlerTransport` and `createZeroDevPaymasterClient`.
- chains.zerodev.app's own bundle builds `"https://rpc.zerodev.app/api/v3/".concat(d,"/chain/").concat(s)` for both bundler and paymaster, adding `?provider=` to the bundler and `?selfFunded=true` to the paymaster (minified JS from https://chains.zerodev.app, 15:03Z).

So for Sleeve: `https://rpc.zerodev.app/api/v3/<projectId>/chain/4663` for both, from the ZeroDev dashboard.

### 7.2 Is 4663 supported

- ZeroDev Supported Networks (https://docs.zerodev.app/api-and-toolings/faqs/chains, 15:02:22Z) has the row `| Robinhood | 4663 |` and `| Robinhood Testnet | 46630 |`.
- `curl https://chains.zerodev.app/api/networks` (15:03:40Z) returns `{"chainId":4663,"name":"Robinhood",...,"publicRpcUrl":"https://rpc.mainnet.chain.robinhood.com","explorerUrl":"https://8crv4vmq6tiu1yqr.blockscout.com/address/0x9775137314fE595c943712B0b336327dfa80aE8A","testnet":false,"onlySelfFunded":false,...,"deprecated":false,"isVisible":true,"providers":[]}`. `onlySelfFunded: false` means ZeroDev-billed sponsorship is offered on 4663, not only self-funded paymasters.
- Probe with a dummy project id, 15:36:29Z: `POST https://rpc.zerodev.app/api/v3/00000000-0000-0000-0000-000000000000/chain/4663` answered HTTP 402 `{"error":"Could not retrieve user plan."}`, the same answer as chain 42161, while chain 999999999 answered HTTP 400 `{"error":"No API provider supports the requested chainId."}`. The router has a provider for 4663.
- UltraRelay is not listed for 4663. ZeroDev's sponsor-gas page lists its networks as "Base, Arbitrum, Optimism, HyperEVM, Polynomial, Abstract, ZkSync, Base Sepolia, Holesky" and says to contact them for others. Use the default provider and do not append `?provider=ULTRA_RELAY`.
- Sponsorship needs a policy: "Note that you MUST set up a gas policy to begin sponsoring. Without setting up a gas policy, there won't be any gas sponsored." (https://docs.zerodev.app/smart-accounts/sponsor-gas/evm).

### 7.3 ERC-7562 and the unstaked meta factory

ERC-7562 (https://eips.ethereum.org/EIPS/eip-7562, 15:10:57Z): "Access to associated storage of the account in an external contract that is not an entity is allowed if either: [STO-021] The account already exists. [STO-022] There is an initCode and the factory contract is staked. If the paymaster or factory entity is staked, then it is also allowed: [STO-031] Access the entity's own storage. ... [STO-033] Read-only access to any storage in a non-entity contract." It also allows "The P256VERIFY secp256r1 precompile defined in EIP-7951" (OP-062).

A first UserOp with initCode on 4663 does three things a strict bundler would flag while the factory is unstaked:

1. The meta factory reads its own `approved[factory]` (STO-031). `useMetaFactory: false` removes this one.
2. The passkey validator's `onInstall` writes `webAuthnValidatorStorage[account]`, associated storage of an account that the same UserOp deploys, so STO-022 applies.
3. The Sleeve module's `onInstall`, per docs/SPEC.md section 4, sets `spend = USDG.balanceOf(account)`. USDG is an EIP-1967 proxy (`cast storage 0x5fc5...d168 0x3608...2bbc` returned implementation 0x68184c449e1a8f34fa18d289737129fd27b66f8f at block 78,344,028), so that read touches non-associated storage in a non-entity contract (STO-033), and the module's own per-account writes are STO-022.

### 7.4 What actually happens on 4663

The bundlers serving 4663 accept item 1 and item 2 today: at least 5,486 deployments went through the unstaked meta factory, and the latest passkey deployment (block 77,645,384, section 3.4) is one of them, so a validator wrote associated storage of an account deployed in the same UserOp, under an unstaked factory, and the bundle landed. Item 3 has not been seen on chain because no account has installed the Sleeve module yet. Which provider ZeroDev routes 4663 traffic to is not visible from outside (`"providers":[]`).

Plan:

- Default path: the first owner UserOp carries initCode (SDK default) and installs the module through `initConfig`.
- Test it once with the real ZeroDev project and the real module before onboarding anyone, and record the result in docs/GATES.md.
- If the bundler rejects it, deploy the account with a plain transaction: anyone may call `KernelFactory(0xaac5...E419).createAccount(initData, salt)` (0xea6d13ac) with the same init data, which gives the same address (section 5.1) and installs the same passkey and module. Then every UserOp goes without initCode. A front-run of that call is harmless because the init data fixes the owner; the app should treat `AA10 sender already constructed` as "deployed" and resend without initCode.
- Separately, ask ZeroDev to stake the meta factory on 4663 (owner-only call on their side).

## 8. Recipe

Install, pinned to the versions tested:

```bash
npm i viem@2.57.2 @zerodev/sdk@5.5.10 @zerodev/passkey-validator@5.6.0 @zerodev/webauthn-key@5.5.0
# Node tests and scripts only: @zerodev/sdk's CommonJS build needs it
npm i -D tslib@2.8.1
```

Configuration the app needs: the production domain as rpID (final before the first real passkey), the ZeroDev project id with a gas policy for chain 4663, the Alchemy RPC URL for reads, the deployed Sleeve module address, and its install data. The module address and install data must also be final before the first real user, because they are part of every account address.

Assumptions taken from docs/SPEC.md draft 1: the module exposes `beginOwnerOp()` and `endOwnerOp()` with no arguments, `onInstall(bytes)` accepts empty data, and the rule is set with a separate call. If the module ABI changes, only `sleeveBracketAbi` and the install data change.

`app/lib/sleevePasskey.ts` (proposed path), exactly as type-checked and run in section 5.2:

```ts
import { PasskeyValidatorContractVersion, toPasskeyValidator } from "@zerodev/passkey-validator"
import {
    createKernelAccount,
    createKernelAccountClient,
    createZeroDevPaymasterClient
} from "@zerodev/sdk"
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants"
import {
    type WebAuthnKey,
    findQuoteIndices,
    parseAndNormalizeSig,
    uint8ArrayToHexString
} from "@zerodev/webauthn-key"
import {
    type Address,
    type Hex,
    type SignableMessage,
    concatHex,
    createPublicClient,
    decodeAbiParameters,
    decodeFunctionData,
    encodeAbiParameters,
    encodeFunctionData,
    hexToBytes,
    http,
    keccak256,
    parseAbi,
    parseAbiParameters,
    toFunctionSelector,
    zeroAddress
} from "viem"
import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts"
import { robinhood } from "viem/chains"

// ---------- configuration ----------

export type SleeveConfig = {
    rpId: string // production domain, final before the first real passkey
    zeroDevProjectId: string
    readRpcUrl: string // Alchemy app URL; never the viem default list
    sleeveModule: Address
    sleeveModuleInitData: Hex // constant for every user, "0x" on Kernel v3.1
}

const ENTRY_POINT = getEntryPoint("0.7")
const KERNEL_VERSION = KERNEL_V3_1
const ECDSA_VALIDATOR: Address = "0x845ADb2C711129d4f3966735eD98a9F09fC4cE57"
const WEBAUTHN_VALIDATOR: Address = "0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69"
const KERNEL_EXECUTE_SELECTOR: Hex = "0xe9ae5c53"
const KERNEL_BATCH_MODE: Hex = "0x0100000000000000000000000000000000000000000000000000000000000000"
const ES256 = -7

const kernelAbi = parseAbi([
    "function installModule(uint256 moduleType, address module, bytes initData)",
    "function uninstallModule(uint256 moduleType, address module, bytes deInitData)",
    "function execute(bytes32 mode, bytes executionCalldata)",
    "function isModuleInstalled(uint256 moduleType, address module, bytes additionalContext) view returns (bool)"
])
const sleeveBracketAbi = parseAbi(["function beginOwnerOp()", "function endOwnerOp()"])
const webAuthnValidatorAbi = parseAbi([
    "function webAuthnValidatorStorage(address kernel) view returns (uint256 pubKeyX, uint256 pubKeyY)"
])

export const zeroDevRpc = (cfg: SleeveConfig) =>
    `https://rpc.zerodev.app/api/v3/${cfg.zeroDevProjectId}/chain/${robinhood.id}`

export const publicClientFor = (cfg: SleeveConfig) =>
    createPublicClient({ chain: robinhood, transport: http(cfg.readRpcUrl) })

// ---------- WebAuthn, no passkey server ----------

export type StoredPasskey = {
    credentialId: string // base64url, from the authenticator
    pubKeyX: string // decimal string, JSON safe
    pubKeyY: string
    accountAddress?: Address
}

const toBase64Url = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> => {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length))

export class PasskeyError extends Error {
    constructor(readonly code: "NOT_P256" | "CANCELLED" | "UNKNOWN_CREDENTIAL") {
        super(code)
    }
}

export async function registerPasskey(cfg: SleeveConfig, userName: string): Promise<StoredPasskey> {
    const credential = (await navigator.credentials.create({
        publicKey: {
            rp: { id: cfg.rpId, name: "Sleeve" },
            user: { id: randomBytes(16), name: userName, displayName: userName },
            challenge: randomBytes(32),
            pubKeyCredParams: [{ type: "public-key", alg: ES256 }],
            authenticatorSelection: { residentKey: "required", userVerification: "required" },
            attestation: "none",
            timeout: 120_000
        }
    })) as PublicKeyCredential | null
    if (!credential) throw new PasskeyError("CANCELLED")

    const response = credential.response as AuthenticatorAttestationResponse
    const spki = response.getPublicKey()
    if (!spki || response.getPublicKeyAlgorithm() !== ES256) throw new PasskeyError("NOT_P256")

    const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"])
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key))
    return {
        credentialId: toBase64Url(new Uint8Array(credential.rawId)),
        pubKeyX: BigInt(uint8ArrayToHexString(raw.slice(1, 33))).toString(),
        pubKeyY: BigInt(uint8ArrayToHexString(raw.slice(33, 65))).toString()
    }
}

// Login on any device where the passkey has synced. The browser returns the credential id but never
// the public key, so the caller looks it up in Sleeve's own store (Supabase), keyed by credential id.
export async function discoverPasskey(
    cfg: SleeveConfig,
    lookup: (credentialId: string) => Promise<StoredPasskey | null>
): Promise<StoredPasskey> {
    const credential = (await navigator.credentials.get({
        publicKey: { rpId: cfg.rpId, challenge: randomBytes(32), userVerification: "required" }
    })) as PublicKeyCredential | null
    if (!credential) throw new PasskeyError("CANCELLED")
    const stored = await lookup(toBase64Url(new Uint8Array(credential.rawId)))
    if (!stored) throw new PasskeyError("UNKNOWN_CREDENTIAL")
    return stored
}

// Signs exactly the way @zerodev/passkey-validator does, with two changes that matter on 4663:
// rpId is passed explicitly, and usePrecompiled is true because RIP-7212 is live on 4663 while
// the SDK's own chain list does not include 4663.
const signWithPasskey = async (cfg: SleeveConfig, stored: StoredPasskey, message: SignableMessage): Promise<Hex> => {
    if (typeof message === "string" || typeof message.raw !== "string") throw new Error("expected raw hex message")
    const credential = (await navigator.credentials.get({
        publicKey: {
            rpId: cfg.rpId,
            challenge: new Uint8Array(hexToBytes(message.raw)),
            allowCredentials: [{ type: "public-key", id: fromBase64Url(stored.credentialId) }],
            userVerification: "required"
        }
    })) as PublicKeyCredential | null
    if (!credential) throw new PasskeyError("CANCELLED")

    const response = credential.response as AuthenticatorAssertionResponse
    const clientDataJSON = new TextDecoder().decode(response.clientDataJSON)
    const { r, s } = parseAndNormalizeSig(uint8ArrayToHexString(new Uint8Array(response.signature)))
    return encodeAbiParameters(
        parseAbiParameters(
            "bytes authenticatorData, string clientDataJSON, uint256 responseTypeLocation, uint256 r, uint256 s, bool usePrecompiled"
        ),
        [
            uint8ArrayToHexString(new Uint8Array(response.authenticatorData)),
            clientDataJSON,
            findQuoteIndices(clientDataJSON).beforeType,
            r,
            s,
            true
        ]
    )
}

export const toSleeveWebAuthnKey = (cfg: SleeveConfig, stored: StoredPasskey): WebAuthnKey => ({
    pubX: BigInt(stored.pubKeyX),
    pubY: BigInt(stored.pubKeyY),
    authenticatorId: stored.credentialId,
    authenticatorIdHash: keccak256(fromBase64Url(stored.credentialId)),
    rpID: cfg.rpId,
    signMessageCallback: (message) => signWithPasskey(cfg, stored, message)
})

// ---------- account ----------

const executorInstallData = (executorData: Hex) =>
    concatHex([
        zeroAddress, // no hook on the executor
        encodeAbiParameters(parseAbiParameters("bytes executorData, bytes hookData"), [executorData, "0x"])
    ])

// Kernel v3.1 always calls onInstall and reverts the deployment if it fails. Kernel v3.2 and v3.3 skip a
// failing onInstall when the data is empty, so on those versions this data must be non-empty.
// Keep it constant across users: it is part of the CREATE2 salt, so it fixes the account address.
export const sleeveInitConfig = (cfg: SleeveConfig): Hex[] => [
    encodeFunctionData({
        abi: kernelAbi,
        functionName: "installModule",
        args: [2n, cfg.sleeveModule, executorInstallData(cfg.sleeveModuleInitData)]
    })
]

export async function buildSleeveAccount(
    cfg: SleeveConfig,
    stored: StoredPasskey,
    publicClient: ReturnType<typeof publicClientFor> = publicClientFor(cfg)
) {
    const passkeyValidator = await toPasskeyValidator(publicClient, {
        webAuthnKey: toSleeveWebAuthnKey(cfg, stored),
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
        validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED
    })
    const account = await createKernelAccount(publicClient, {
        plugins: { sudo: passkeyValidator },
        entryPoint: ENTRY_POINT,
        kernelVersion: KERNEL_VERSION,
        initConfig: sleeveInitConfig(cfg),
        // The address is a function of the passkey, the Kernel version, the module address and its
        // init data. Passing the stored address skips the getSenderAddress eth_call on later logins.
        address: stored.accountAddress
    })
    if (stored.accountAddress && stored.accountAddress.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error("stored account address does not match the passkey")
    }
    return { publicClient, passkeyValidator, account }
}

type SleeveAccount = Awaited<ReturnType<typeof buildSleeveAccount>>["account"]
type Call = { to: Address; value: bigint; data: Hex }

// ---------- sponsored owner batches with owner-paid fallback ----------

export class SponsorshipUnavailableError extends Error {
    constructor(readonly reason: unknown) {
        super("sponsorship unavailable")
    }
}

const hasCause = (error: unknown, type: new (...args: never[]) => Error): boolean => {
    let current: unknown = error
    for (let depth = 0; current && depth < 10; depth++) {
        if (current instanceof type) return true
        current = (current as { cause?: unknown }).cause
    }
    return false
}

export function makeSleeveClients(cfg: SleeveConfig, account: SleeveAccount) {
    const publicClient = publicClientFor(cfg)
    const rpc = zeroDevRpc(cfg)
    const paymasterClient = createZeroDevPaymasterClient({ chain: robinhood, transport: http(rpc) })
    const sponsored = createKernelAccountClient({
        account,
        chain: robinhood,
        client: publicClient,
        bundlerTransport: http(rpc),
        paymaster: {
            getPaymasterData: async (userOperation) => {
                try {
                    return await paymasterClient.sponsorUserOperation({ userOperation })
                } catch (reason) {
                    throw new SponsorshipUnavailableError(reason)
                }
            }
        }
    })
    const ownerPaid = createKernelAccountClient({
        account,
        chain: robinhood,
        client: publicClient,
        bundlerTransport: http(rpc)
    })
    return { publicClient, sponsored, ownerPaid }
}

export const bracket = (cfg: SleeveConfig, calls: Call[]): Call[] => [
    { to: cfg.sleeveModule, value: 0n, data: encodeFunctionData({ abi: sleeveBracketAbi, functionName: "beginOwnerOp" }) },
    ...calls,
    { to: cfg.sleeveModule, value: 0n, data: encodeFunctionData({ abi: sleeveBracketAbi, functionName: "endOwnerOp" }) }
]

// The only way the app builds an owner UserOp. I14 is enforced here and asserted in tests with
// assertBracketed below.
export async function sendOwnerOp(
    cfg: SleeveConfig,
    clients: ReturnType<typeof makeSleeveClients>,
    calls: Call[],
    confirmOwnerPaid: (maxCostWei: bigint, balanceWei: bigint) => Promise<boolean>
) {
    const { sponsored, ownerPaid, publicClient } = clients
    const account = sponsored.account
    const callData = await account.encodeCalls(bracket(cfg, calls))
    assertBracketed(cfg, callData)

    let hash: Hex
    try {
        hash = await sponsored.sendUserOperation({ callData })
    } catch (error) {
        if (!hasCause(error, SponsorshipUnavailableError)) throw error
        const prepared = await ownerPaid.prepareUserOperation({ callData })
        const maxCost =
            (prepared.callGasLimit + prepared.verificationGasLimit + prepared.preVerificationGas) *
            prepared.maxFeePerGas
        const balance = await publicClient.getBalance({ address: account.address })
        if (!(await confirmOwnerPaid(maxCost, balance))) throw error
        hash = await ownerPaid.sendUserOperation({ callData })
    }
    const receipt = await sponsored.waitForUserOperationReceipt({ hash })
    if (!receipt.success) throw new Error(`UserOp ${hash} reverted: ${receipt.reason ?? "no reason"}`)
    return receipt // callers still read the postcondition (ledger, balance delta) from chain state
}

export function assertBracketed(cfg: SleeveConfig, callData: Hex) {
    const { functionName, args } = decodeFunctionData({ abi: kernelAbi, data: callData })
    if (functionName !== "execute" || args[0] !== KERNEL_BATCH_MODE) throw new Error("owner op is not a Kernel batch")
    const [calls] = decodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes callData)[]"), args[1])
    const first = calls[0]
    const last = calls[calls.length - 1]
    const isCall = (c: typeof first | undefined, fn: "beginOwnerOp" | "endOwnerOp") =>
        !!c && c.target.toLowerCase() === cfg.sleeveModule.toLowerCase() && c.callData === toFunctionSelector(`function ${fn}()`)
    if (!isCall(first, "beginOwnerOp") || !isCall(last, "endOwnerOp")) throw new Error("owner op is not bracketed (I14)")
}

// ---------- module removal, recovery signer, chain checks ----------

export const uninstallModuleCall = (account: SleeveAccount, module: Address, deInitData: Hex): Call => ({
    to: account.address,
    value: 0n,
    data: encodeFunctionData({ abi: kernelAbi, functionName: "uninstallModule", args: [2n, module, deInitData] })
})

// A secondary ECDSA validator allowed to call execute(). It can act without Sleeve's domain, which is
// what I11 needs, and it can do anything the passkey can.
export const installRecoverySignerCall = (account: SleeveAccount, recoveryOwner: Address): Call => ({
    to: account.address,
    value: 0n,
    data: encodeFunctionData({
        abi: kernelAbi,
        functionName: "installModule",
        args: [
            1n,
            ECDSA_VALIDATOR,
            concatHex([
                zeroAddress,
                encodeAbiParameters(parseAbiParameters("bytes validatorData, bytes hookData, bytes selectorData"), [
                    recoveryOwner,
                    "0x",
                    KERNEL_EXECUTE_SELECTOR
                ])
            ])
        ]
    })
})

export const newRecoveryPhrase = () => {
    const mnemonic = generateMnemonic(english)
    return { mnemonic, address: mnemonicToAccount(mnemonic).address }
}

// Nonce key for UserOps signed by the recovery signer from any ERC-4337 client:
// mode 0x00 (default) | type 0x01 (secondary validator) | validator address | 2-byte key.
export const recoveryNonceKey = BigInt(concatHex(["0x00", "0x01", ECDSA_VALIDATOR, "0x0000"]))

export async function readAccountState(cfg: SleeveConfig, accountAddress: Address) {
    const publicClient = publicClientFor(cfg)
    const code = await publicClient.getCode({ address: accountAddress })
    if (!code || code === "0x") return { deployed: false as const }
    const [passkey, moduleInstalled, recoveryInstalled] = await Promise.all([
        publicClient.readContract({ address: WEBAUTHN_VALIDATOR, abi: webAuthnValidatorAbi, functionName: "webAuthnValidatorStorage", args: [accountAddress] }),
        publicClient.readContract({ address: accountAddress, abi: kernelAbi, functionName: "isModuleInstalled", args: [2n, cfg.sleeveModule, "0x"] }),
        publicClient.readContract({ address: accountAddress, abi: kernelAbi, functionName: "isModuleInstalled", args: [1n, ECDSA_VALIDATOR, "0x"] })
    ])
    return { deployed: true as const, passkey, moduleInstalled, recoveryInstalled }
}
```

### 8.1 Flows built on the module

Onboarding (Journey 8.1):

1. `registerPasskey(cfg, name)`, then `buildSleeveAccount(cfg, stored)`. Save `{ credentialId, pubKeyX, pubKeyY, accountAddress }` to Supabase, insert-only, keyed by credential id.
2. Send the first owner op before the address is shown to anyone: `sendOwnerOp(cfg, makeSleeveClients(cfg, account), [setRuleCall], confirm)`. Because the account is not deployed, viem adds the factory and factory data, so this one sponsored UserOp deploys the account, installs the module through `initConfig` (its `onInstall` snapshots the USDG balance, which is zero) and sets the rule inside `[beginOwnerOp, setRule, endOwnerOp]`. The module is installed during validation, before the batch runs, so the batch can start with `beginOwnerOp` as I14 requires.
3. Read back the postcondition (module installed, rule set) with `readAccountState` and the module's own views, then show the address.

Why deploy first: per PRD 7.1 and SPEC section 4, install snapshots the current USDG balance into spend and that money is never split. If a payer paid the counterfactual address before deployment, the snapshot would treat that payment as pre-Sleeve money and never split it.

Login: on a device that holds the record, rebuild directly. On a new device, `discoverPasskey(cfg, lookup)` gets the credential id from the synced passkey and the record from Supabase. Pass the stored address so the SDK does not need `getSenderAddress`. Login reads only public data; every action still needs a fresh passkey signature on a UserOp.

Owner actions: always `sendOwnerOp`, never `kernelClient.sendUserOperation` directly. A unit test decodes every callData the app builds with `assertBracketed` (SPEC I14 row: "app unit test on the UserOp builder").

Sponsorship failure: the paymaster middleware turns any paymaster error into `SponsorshipUnavailableError`. `sendOwnerOp` then prepares the same batch without a paymaster, computes the worst-case cost `(callGasLimit + verificationGasLimit + preVerificationGas) * maxFeePerGas`, reads the account's ETH balance, and continues only if the owner confirms. ZeroDev's docs show a silent version (`catch { return {} }`, which makes the user pay without asking); Sleeve should not use it. The owner-paid path needs ETH in the account itself.

## 9. Uninstall, recovery and export (PRD 7.1, 7.13, I11)

### 9.1 Uninstall

`uninstallModule(2, module, deInitData)` (0xa71763a8) as a self-call inside an owner batch. In Kernel v3.1 (`src/core/ExecutorManager.sol` and `src/utils/ModuleLib.sol` at tag v3.1) uninstall clears the executor config first and then calls `onUninstall` through `ExcessivelySafeCall`, emitting `ModuleUninstallResult(module, result)`. A reverting `onUninstall` does not block the uninstall, so nothing can strand the owner, but a failed release would be skipped silently. v3.3 behaves the same way. Simulated in sections 5.1 and 5.2: the executor is gone after the batch.

Open point for the module (component 4): the recipe's uninstall batch is `[beginOwnerOp, uninstallModule, endOwnerOp]` to keep I14 literal. SPEC section 4 deletes the account's state in `onUninstall`, and section 6 does not say whether `endOwnerOp` checks installation. The stand-in executor tolerated it. The real `endOwnerOp` needs to either clear its transient slots and return when the account is no longer installed, or the PRD has to allow `[beginOwnerOp, endOwnerOp, uninstallModule]`.

### 9.2 Why the passkey alone cannot satisfy I11

WebAuthn binds a passkey to its rpID. A browser only lets a page use it when the page's domain is the rpID or a subdomain of it (WebAuthn's related-origins option still needs a file served from the rpID domain), and the authenticator never reveals the private key. If Sleeve's frontend and domain disappear, the passkey cannot sign for any other client. PRD 7.2 already says "acting outside Sleeve takes the recovery key or an exported signer". So I11 holds only for accounts that have a recovery signer.

### 9.3 Recovery signer design (tested)

Install the ZeroDev ECDSA validator 0x845A...cE57 as a secondary validator whose owner is the recovery address, with access to Kernel's `execute` selector 0xe9ae5c53 (`installRecoverySignerCall`). Kernel v3.1 `installModule` for a validator reads `hook ++ abi.encode(validatorData, hookData, selectorData)` and grants the selector when `selectorData` is 4 bytes. `validateUserOp` lets a non-root validator through when `allowedSelectors[vId][callData[0:4]]` is set. The recovery address can be the owner's existing wallet, or a fresh phrase from `newRecoveryPhrase()` that the owner writes down; only the address goes on chain.

Simulation on live state, block 78,338,385 (raw encoding) and 78,341,038 (SDK encoding), four bundles in one `eth_call`:

| Bundle | Signed by | Calls | Result | handleOps gas |
| --- | --- | --- | --- | --- |
| 1 | passkey A | op 1 deploys with the executor; op 2 installs the recovery validator inside brackets | ok | 724,015 |
| 2 | recovery EOA through the secondary ECDSA validator, nonce key `0x00 01 845a...ce57 0000` | uninstall the executor, send 0.1 ETH to a fresh address, call the passkey validator's `onUninstall` then `onInstall` with passkey B | ok, recipient balance exactly 100000000000000000 wei, executor gone, validator storage now holds B | 181,563 |
| 3 | passkey B as root | no-op batch | ok | 126,626 |
| 4 | passkey A as root | no-op batch | `FailedOp(0, "AA24 signature error")` | 108,058 |

Bundle 2 was built twice: once with raw ERC-4337 encoding and no SDK (`execute(0x01 00..., abi.encode((address,uint256,bytes)[]))`, signature `personal_sign(userOpHash)` by the recovery key), and once through `signerToEcdsaValidator` and `createKernelAccount({ address, plugins: { regular } })`. Both produced the same nonce key and callData and both succeeded. The SDK route checks `isInitialized(account)` on the validator with an `eth_call` before choosing the nonce mode, which works on a deployed account.

So any ERC-4337 client can drive the account with the recovery key, and the recovery key can also rotate the passkey without any extra contract, because the account itself calls the validator's `onUninstall` and `onInstall`.

Caveats:

- The recovery key can do anything the passkey can. That is what I11 needs, and it is also the size of the risk if the recovery key leaks. A narrower option is ZeroDev's recovery action 0xe884...DC6E (deployed on 4663, `doRecovery(address,bytes)`), which can only re-key a validator. It does not satisfy I11 when Sleeve's domain is gone, because a re-keyed passkey is still bound to that domain.
- The recovery key acts outside Sleeve, so its batches are unbracketed (WRAPPED accounting limit, PRD 7.2). The app must say this when the owner sets it.
- Outside Sleeve there is no Sleeve paymaster, so the account needs ETH to pay its own UserOp, or the owner pays through a third-party paymaster.
- g6-notes.md finding 2: an ECDSA validator is also a hook module, and an ECDSA root can call the account directly without the EntryPoint. Here it is a secondary validator, not the root, so that path does not open. The passkey validator is not a hook module, so a passkey root cannot do it either.
- The recovery signer is installed by a later owner op, not by `initConfig`, so the account address does not depend on it.

### 9.4 Export

A passkey's private key cannot be exported: WebAuthn has no export operation and platform authenticators keep the key. ZeroDev's "Export Wallet" page (https://docs.zerodev.app/wallets/export) belongs to its separate Smart Wallet product (`@zerodev/wallet-react`, keys in a TEE, example config `mode: '7702'`), not to the passkey validator; using it would replace D-003's login and bring in EIP-7702, which the PRD puts after M0. What Sleeve can export is an account card: chain id 4663, EntryPoint v0.7 address, account address, Kernel v3.1, passkey validator address, credential id, public key, module address, and the recovery validator and its nonce key. With the recovery phrase that is enough to drive the account from any ERC-4337 client.

## 10. Mismatches found

1. ZeroDev docs quote 3,450 gas for a P-256 precompile call. On 4663 it costs about 6,900 (estimateGas difference 6,914, in-contract staticcall 7,308).
2. ZeroDev docs say the passkey validator "will automatically start taking advantage of the ERC-7212 precompile" once a network adds it. The switch is the SDK's hardcoded chain list (`RIP7212_SUPPORTED_NETWORKS`), which omits 4663 although the precompile is live there. The docs' "Chains with Native Passkey Precompiles" list omits Robinhood too. The contract never falls back on its own.
3. Robinhood's AA page imports `robinhoodMainnet` from `viem/chains`; viem 2.57.2 exports `robinhood`, and the import fails.
4. ZeroDev's meta factory is staked in EntryPoint v0.7 on Arbitrum One and Base (0.1 ETH, 86,400 s) but has no stake or deposit on 4663.
5. The SDK's `ONLY_ENTRYPOINT_HOOK_ADDRESS` (0xb230...b900) exists on Arbitrum One but not on 4663.
6. ZeroDev's passkey tutorial builds the validator with `KERNEL_V3_3` and the account with `KERNEL_V3_1`. It works only because both map to the same validator address. Use one constant.
7. `toWebAuthnKey` sends `rpID` to the hosted server, but the hosted `/api/v3/<project>` routes ignore it and use the dashboard domain (live probe: `"rpId":"localhost"` for an unknown project).
8. `@zerodev/sdk` 5.5.10's CommonJS build requires `tslib` without declaring it.
9. `toPasskeyValidator.ts` comments that validator 0.0.2 supports only Kernel 0.3.0 and 0.3.1, while its address map lists it for 0.3.0 to 0.3.3.
10. The SDK types `initConfig` as v3.1-only; the runtime accepts it for v3.1 to v3.3, and it works on the deployed v3.3.
11. PRD 7.13 asks for "signer export where the wallet provider supports it". The passkey validator does not support export (9.4).

## 11. Risks and open questions

1. Production domain. The rpID, and with Option A the ZeroDev dashboard domain, must be final before any real passkey (D-003). Decide whether the app runs on the apex domain or a subdomain. The recipe passes `rpId` explicitly, so either works, but the choice is permanent for every passkey created.
2. Passkey server. Option B (own WebAuthn ceremony, records in Supabase) is recommended over ZeroDev's hosted server. Owner to confirm, since D-003 names ZeroDev's validator but not its server.
3. First UserOp through ZeroDev on 4663. The meta factory is unstaked and the Sleeve module reads USDG during deployment validation (7.3). Test once with the real project and module, record it in docs/GATES.md, and keep the direct factory deployment as the fallback (7.4). The factory call is a public function, so the KEEPER key could send it without new authority, but it is a new duty with its own gas cost, so who sends it and from which key is an owner decision.
4. Module address and install data are part of every account address. They must be final before real users, and a later module version gives new users different addresses. Store the module version with each record.
5. Uninstall bracket order (9.1) needs a decision in the module spec.
6. Recovery is in PRD 7.13 and I11 but not in the build contract's M0 app scope list (internal/CLAUDE.md, Scope). Without a recovery signer, I11 fails as soon as Sleeve's domain is gone. Owner to decide whether setting a recovery signer is required at onboarding, offered, or deferred, and whether the recovery phrase option ships in M0.
7. ZeroDev staking. Ask ZeroDev whether they will stake the meta factory on 4663 and which bundler provider they route 4663 to.
8. Hardening after M0 (PRD 7.2) depends on hook behaviour that g6-notes.md finding 1 says differs from the PRD's wording; not in this note's scope.

Hosting: everything in this recipe runs in the browser, with passkey records in Supabase, read and written directly or through a Vercel API route. Nothing here needs the VPS.

## 12. Reproduce

Scratchpad: `/private/tmp/claude-501/-Users-mac-sleeve/9adf67e7-d89c-45dc-ac8c-dc0fac3d80ed/scratchpad/zdpasskey/`.

- `pkgs/`: the four packed tarballs and their extracted sources.
- `code_4663.tsv`, `code_compare_arb1.tsv`: section 3.1 output, made with `cast code` per address.
- `accdeployed_*.json`, `webauthn_*.json`: the `eth_getLogs` windows behind section 3.4. `sim/decode.ts` decodes a `handleOps` input.
- `src_passkey/`: the Sourcify sources of the passkey validator. `passkey-server/`: the open-source passkey server files cited in 6.2 and 6.3. `kernel/`: Kernel sources at tags v3.1, v3.2, v3.3.
- `sol/src/Probes.sol`: stand-in executor, `HandleOpsProbe`, `SequenceProbe`, `ValidatorGasProbe` (forge, solc 0.8.28, via IR).
- `sim/sim.ts` (section 5.1; env `SEED`, `META`, `PRECOMPILE`, `KERNEL`), `sim/sim_recovery.ts` (9.3; `RECOVERY_SDK=true` for the SDK route), `sim/recipe/sleevePasskey.ts` (section 8), `sim/recipe_e2e.ts` (5.2), `sim/recover_pub.ts` (6.4). Run with `npx tsx <file>` after `npm install` in `sim/`. Logs: `run_matrix3.log`, `recovery_run.log`, `recovery_run_sdk.log`, `recipe_e2e.log`.

Key one-liners:

```bash
RPC=https://rpc.mainnet.chain.robinhood.com
cast code --rpc-url $RPC 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 | wc -c        # 9481 = 2 + 2*4739 + newline
cast call --rpc-url $RPC 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
  'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' 0xd703aaE79538628d27099B8c4f621bE4CCd142d5
cast call --rpc-url $RPC 0x0000000000000000000000000000000000000064 'arbOSVersion()(uint256)'
curl -s -X POST -H 'content-type: application/json' $RPC --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000100","data":"0x<p256Verify.json entry 0 Input>"},"latest"]}'
```

The simulation scripts are worth moving into `app/test` when the app component starts, with the stand-in executor replaced by the real module. That would turn section 5 into a rerunnable fork-free check of the onboarding path, which forge cannot do because its EVM lacks the 0x100 precompile.
