# Gates

## G6 AA stack

Date: 2 October 2026.

Pinned block: 78,312,136 on chain 4663 (Friday 2 October 2026 10:44 EDT, hash 0x7b1a9be84ea7e2aff4ff8dba07ec2b833838e2f5e84f9ab2f4e2b11342884938), forked from the archive RPC https://robinhood.drpc.org.

Kernel version: v3.1 (SDK constant `KERNEL_V3_1`, `accountId()` = `kernel.advanced.v0.3.1`) with EntryPoint v0.7, as in Robinhood's account abstraction docs. Vendored at `contracts/lib/kernel`, tag `v3.1`, commit 03f7f5cf5871cda0070e4223f196f5b577f6cde2. Addresses come from `@zerodev/sdk` 5.5.10 and `@zerodev/ecdsa-validator` 5.4.9. Versions checked on 4663: 0.3.0, 0.3.1, 0.3.2 and 0.3.3, all deployed.

Bytecode against the tag, runtime code with immutable slots masked (method and settings in docs/research/g6-notes.md section 2, rerun with `contracts/test/spike/kernel-bytecode-check.sh`):

| Contract | Result |
| --- | --- |
| Kernel implementation | MATCH. 22,784 bytes on both sides, 0 differing bytes outside the immutables, no CBOR metadata on either side. The immutables hold the EntryPoint, the implementation's own address, chain id 4663 and the EIP-712 name, version and domain separator. |
| KernelFactory | MATCH, 989 bytes, immutable = the v3.1 implementation. |
| Meta factory (FactoryStaker) | MATCH, 1,871 bytes. |
| ECDSA validator | MISMATCH against tag v3.1 (1,762 against 1,819 bytes). MATCH against commit e18c700 ("v3.1 rc1"), which differs from the tag by one line: its `onInstall` rejects an account that already has an owner. |

### Addresses checked

Code size from `cast code` at block 78,312,136 through the archive RPC. The public RPC returned the same sizes at block 78,316,943.

| Contract | Address | Code size (bytes) |
| --- | --- | --- |
| EntryPoint v0.7 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | 16,035 |
| Kernel v3.1 implementation | 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D | 22,784 |
| Kernel v3.1 factory | 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419 | 989 |
| Meta factory (FactoryStaker), v3.x | 0xd703aaE79538628d27099B8c4f621bE4CCd142d5 | 1,871 |
| ECDSA validator, v3.1 and later | 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57 | 1,819 |
| Kernel v3.0 implementation | 0x94F097E1ebEB4ecA3AAE54cabb08905B239A7D27 | 20,427 |
| Kernel v3.0 factory | 0x6723b44Abeec4E71eBE3232BD5B455805baDD22f | 989 |
| ECDSA validator, v3.0 | 0x8104e3Ad430EA6d354d013A6789fDFc71E671c43 | 1,856 |
| Kernel v3.2 implementation | 0xD830D15D3dc0C269F3dBAa0F3e8626d33CFdaBe1 | 23,563 |
| Kernel v3.2 factory | 0x7a1dBAB750f12a90EB1B60D2Ae3aD17D4D81EfFe | 950 |
| Kernel v3.3 implementation | 0xd6CEDDe84be40893d153Be9d467CD6aD37875b28 | 24,469 |
| Kernel v3.3 factory | 0x2577507b78c2008Ff367261CB6285d44ba5eF2E9 | 950 |
| Passkey validator 0.0.1 | 0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06 | 0 |
| Passkey validator 0.0.2 | 0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd | 0 |
| Passkey validator 0.0.3 | 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 | 4,739 |
| SDK ONLY_ENTRYPOINT_HOOK_ADDRESS | 0xb230f0A1C7C95fa11001647383c8C7a8F316b900 | 0 |
| USDG (proxy) | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | 170 |
| P256 precompile | 0x0000000000000000000000000000000000000100 | precompile, live check below |

### Results

All item tests fork block 78,312,136 and drive the deployed EntryPoint, factory, implementation and ECDSA validator. UserOps in d and e go through `EntryPoint.handleOps`, signed by the root ECDSA validator's key and sent from a bundler address. The account is never pranked. The same validator rejects a UserOp signed by another key, and one whose callData changed after signing, with `FailedOp(0, "AA24 signature error")` (test_recipe_wrongSignatureIsRejected).

| Item | Test | Result |
| --- | --- | --- |
| a. Account through the deployed factory, ECDSA root validator | test_G6_a_createAccountThroughDeployedFactory | PASS |
| b. Fund with USDG, decimals() == 6 | test_G6_b_fundWithUsdg | PASS (deal found the balance slot) |
| c. SpikeModule installed as executor, type 2 | test_G6_c_installSpikeExecutor | PASS |
| d. Bracketed outflow through handleOps, ledger falls by exactly 10e6 | test_G6_d_bracketedOutflowThroughHandleOps | PASS |
| e. Bracketed inflow from a helper contract, ledger rises by exactly 7,250,000 | test_G6_e_bracketedInflowThroughHandleOps | PASS |
| f. Unbracketed batch moves USDG and the ledger does not move | test_G6_f_unbracketedBatchIsTheDocumentedLimit | PASS, recorded as the documented limit |
| g. executeFromExecutor moves 1 USDG by balance delta. beginOwnerOp and endOwnerOp revert NotInstalled for an EOA, a plain contract and a second Kernel account without the module. A contract that calls onInstall for itself is accepted but reaches only its own ledger and bracket (test_recipe_selfRegisteredCallerOnlyReachesItsOwnState). | test_G6_g_executeFromExecutorAndCallerChecks | PASS |
| h. TSTORE and TLOAD | test_G6_h_transientStorage | PASS on the fork and live |
| i. P256 precompile, information only | test_G6_i_p256PrecompileLiveInfoOnly | Returns 1 live. The fork has no precompile at 0x100. |
| j. Optional: non-root validator with a hook | test_G6_j_nonRootValidatorHookFiresOnlyThroughExecuteUserOp | PASS. The hook fires through executeUserOp, and execute() sent directly through that validator fails validation with FailedOpWithRevert(0, "AA23 reverted", InvalidValidator()). |

Live checks against https://rpc.mainnet.chain.robinhood.com, blocks 78,342,629 to 78,342,790, 2 October 2026 15:35 UTC:

- h: `cast call --create 0x602a60005d60005c60005260206000f3` (TSTORE 42, TLOAD, return) returned `0x000000000000000000000000000000000000000000000000000000000000002a`.
- i: `cast call 0x0000000000000000000000000000000000000100 <vector>` returned `0x0000000000000000000000000000000000000000000000000000000000000001` for vector "CallP256Verify" from go-ethereum `core/vm/testdata/precompiles/p256Verify.json`, and for Wycheproof P1363 SHA-256 #1 from the RIP-7212 reference implementation's copy of that file. The same vector with one bit of the hash flipped returned empty output.

Command:

```
cd contracts
FOUNDRY_OUT=out-g6 FOUNDRY_CACHE_PATH=cache-g6 forge test --match-path test/spike/G6Spike.t.sol -vv
```

Result: 23 passed, 0 failed. That is the 10 item tests plus 13 recipe tests behind docs/research/g6-notes.md. Rerun on the final files on 2 October 2026, 19:20 UTC and again by the orchestrator at 20:55 UTC: 23 passed, 0 failed. `forge build test/spike` compiles the spike and its imports (73 files) without errors.

Recommendation: a, b, c, d, e, g and h pass, so G6 passes and the accounting mode is WRAPPED.

Adversarial review, 2 October 2026: ACCEPT. Every item CONFIRMED by an independent reviewer who reran the suite, checked the handleOps path for pranks and shortcuts, and reran the live checks for h and i and the bytecode comparison. G6 status: PASSED. Accounting mode: WRAPPED.

Findings for the owner, details in docs/research/g6-notes.md section 11:

- In the deployed v3.1 a hook on the root validator wraps every root UserOp. PRD decision 27 assumes a hook on the owner's key would never fire. That holds for Kernel's current source, v4 on the dev branch, which PRD 7.1 cites as S36, but not for v3.1.
- An ECDSA root lets its owner call the account directly, skipping the EntryPoint and the brackets.
- Kernel v3.1 ignores a reverting onUninstall, so a release inside it can be skipped silently, and an out-of-gas onUninstall can make the whole uninstall fail when callGasLimit is small.
