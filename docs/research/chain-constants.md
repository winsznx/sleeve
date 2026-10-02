# Chain constants fork check

Research notes for the PriceGuard component and gates G4 and G7. PRD sections 7.4, 7.11, 13 and 22. Written 2 October 2026. Read only: no transaction was sent and nothing in contracts/ was touched.

Short version: all 18 addresses in `contracts/test/utils/Chain4663.sol` have code and behave as the contract the table names. No address or value differs from the constants table. The stock token blocklist lives on the beacon, which is also the access-controls registry for every stock token. USDG has 6 decimals and a working EIP-2612 permit, served from a facet whose bytecode is not verified anywhere I could reach.

## 0. How the reads were made

| Item | Value |
| --- | --- |
| Chain | `cast chain-id` returned `4663`. ArbSys `arbChainID()` returned `4663`. |
| Main pinned block | 78,327,113. Hash `0xfe7180f17c4ff46cba8240959a67aa3e976a117190f3683b005b24a6e68a81de`. Timestamp 1790953770 = 2026-10-02T15:09:30Z, Friday 11:09 EDT, regular session. Header `l1BlockNumber` 0x18e5660 = 26,105,440. |
| Main pass RPC | `$FORK_RPC` = https://robinhood.drpc.org (the archive endpoint in `.env.example`). 244 calls, all with `--block 78327113`, so they can be rerun later. Exact commands and outputs in Appendix B.1. |
| Cross-check RPC | `$ROBINHOOD_RPC` = https://rpc.mainnet.chain.robinhood.com at block 78,345,922 (timestamp 1790955662 = 15:41:02Z, hash `0x15f33801155cd9084bf992f75962d2c957d528e3f2a3f020a84e94cba8ce471d`). 76 calls, one at a time. Every value matched the main pass except values expected to move: `arbBlockNumber()` and new rounds on the NVDA, AAPL and USDG/USD feeds. Appendix B.2. |
| D-008 fork blocks | Guard views read at 78,312,136 and 73,280,794 through `$FORK_RPC`. Appendix B.3 and B.4. |
| Event history | `eth_getLogs` through `$ROBINHOOD_RPC`, block 0 to 78,335,689 (0x4ab4ec9, read 15:23:54Z), one address and one topic per request, 10,000,000-block windows. Appendix A.8. |
| Verified source | Sourcify v2 API, because Blockscout was not reachable from scripts (section 8). |

Why the main pass did not use the public RPC: at 15:08:07Z, right after I sent 10 cast requests in parallel, `rpc.mainnet.chain.robinhood.com` started answering cast with HTTP 403 Cloudflare challenge pages (`<title>Just a moment...</title>`, `cZone: 'rpc.mainnet.chain.robinhood.com'`). A plain curl `eth_blockNumber` sent at the same minute still got HTTP 200. Cast worked again about 13 minutes later. I moved the pinned pass to the archive endpoint and ran the public cross-check one call at a time, rather than work around the challenge.

## 1. Verdict per address

Code sizes are from `cast codesize --rpc-url $FORK_RPC --block 78327113 <address>`. The public cross-check at block 78,345,922 returned the same size for all 18.

| Chain4663 name | Address | Code size (bytes) | What is there | Verdict |
| --- | --- | --- | --- | --- |
| USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | 170 | OpenZeppelin ERC1967Proxy, implementation `USDG` at 0x68184C449E1a8f34fA18d289737129FD27B66f8F. name "Global Dollar", symbol "USDG", decimals 6 | CONFIRMED |
| ENTRY_POINT_V07 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | 16035 | EntryPoint v0.7. Runtime code hash equals Ethereum mainnet's. `getNonce(0x...dEaD, 0)` = 0 | CONFIRMED |
| PERMIT2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 | 9152 | Permit2 (Sourcify match). `DOMAIN_SEPARATOR()` equals the value computed for chain 4663 | CONFIRMED |
| ARB_SYS | 0x0000000000000000000000000000000000000064 | 1 | Precompile. `eth_getCode` returns the placeholder `0xfe`. `arbChainID()` = 4663, `arbBlockNumber()` = the queried block | CONFIRMED |
| SWAP_ROUTER_02 | 0xCaf681a66D020601342297493863E78C959E5cb2 | 24497 | `factory()` = V3_FACTORY, `WETH9()` = Robinhood's WETH 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 | CONFIRMED |
| V3_FACTORY | 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA | 24535 | UniswapV3Factory (Sourcify match, deployed at block 8,930) | CONFIRMED |
| QUOTER_V2 | 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 | 8273 | QuoterV2 (Sourcify match). The struct quote works and the Quoter V1 call shape reverts | CONFIRMED |
| UNIVERSAL_ROUTER | 0x204FAca1764B154221e35c0d20aBb3c525710498 | 24380 | UniversalRouter (Sourcify match), deployed at block 65,727,895, the same `creationBlock` the Uniswap SDK lists for v2.1.2 | CONFIRMED |
| MORPHO_BLUE | 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 | 15582 | `Morpho` (Sourcify match, solc 0.8.19, deployed at block 286). `owner()` = 0x060595638692de6CCd47ca04094F1772D3D39728. `DOMAIN_SEPARATOR()` equals the value computed for chain 4663 | CONFIRMED |
| SPY | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | 283 | BeaconProxy. symbol "SPY", decimals 18, `uid()` equals the issuer API id | CONFIRMED |
| SPY_FEED | 0x319724394D3A0e3669269846abE664Cd621f9f6A | 9571 | EACAggregatorProxy (Sourcify exact match). description "RHSPY / USD", decimals 8 | CONFIRMED |
| QQQ | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 | 283 | BeaconProxy. symbol "QQQ", decimals 18, `uid()` equals the issuer API id | CONFIRMED |
| QQQ_FEED | 0x80901d846d5D7B030F26B480776EE3b29374C2ae | 9571 | Same runtime code hash as the SPY proxy. description "Robinhood QQQ / USD", decimals 8 | CONFIRMED |
| NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC | 283 | BeaconProxy. symbol "NVDA", decimals 18, `uid()` equals the issuer API id | CONFIRMED |
| NVDA_FEED | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | 9571 | EACAggregatorProxy (Sourcify exact match). description "RHNVDA / USD", decimals 8 | CONFIRMED |
| AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 | 283 | BeaconProxy. symbol "AAPL", decimals 18, `uid()` equals the issuer API id | CONFIRMED |
| AAPL_FEED | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 | 9571 | Same runtime code hash as the SPY proxy. description "Robinhood AAPL / USD", decimals 8 | CONFIRMED |
| USDG_USD_FEED | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | 9571 | EACAggregatorProxy (Sourcify exact match). description "USDG / USD", decimals 8 | CONFIRMED |

### Basis after this check

The table in internal/CLAUDE.md marks the token and feed rows "verify". They can now cite official sources. I did not edit that file.

| Rows | Official source that lists the same address | Retrieved |
| --- | --- | --- |
| SPY, QQQ, NVDA, AAPL tokens | Robinhood's assets API `https://api.robinhood.com/rhj/assets`. The docs Token Contracts page builds its stock token table from this API (its `AssetsTable` component fetches that URL, file `index-C7gDoMED.js`). | 14:55:08Z |
| All five feeds | Chainlink reference data directory `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`, the `rddUrl` Chainlink's docs repo lists for "Robinhood Chain Mainnet" | 14:55:33Z |
| EntryPoint v0.7 | docs.robinhood.com/chain/account-abstraction, row "ERC-4337 Entrypoint v0.7.0" with 0x0000000071727De22E5E9d8BAf0edAc6f37da032. Exact line in A.10. | 14:54:29Z |
| Permit2, ArbSys, WETH | docs.robinhood.com/chain/protocol-contracts rows "Permit2", "ArbSys" and "L2 Weth". Exact lines in A.10. | 14:54:29Z |
| SwapRouter02, v3 factory, QuoterV2, Universal Router v2.1.2, v4 rows | Uniswap/sdks commit 17d70b1 (2026-09-30), `sdk-core/src/addresses.ts` `ROBINHOOD_ADDRESSES` and `universal-router-sdk/src/utils/constants.ts` entry `[4663]` | 15:05:02Z |
| Morpho Blue | No official Morpho list checked. Sourcify holds verified `Morpho` source at the address, and the PRD's IRM 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 is a verified `AdaptiveCurveIrm` whose `MORPHO()` returns this address. | between 15:31Z and 15:41Z |

The Robinhood docs pages are client-rendered. Their text comes from the MDX embedded in `https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index--FXM3_nW.js` (sha256 `3af7bd5503c31a67c744cccbf552845555e0576855476ae04838f323ea7da22c`), which I fetched with curl and URL-decoded.

### Addresses found along the way

| Item | Address | How found |
| --- | --- | --- |
| Stock token beacon and access-controls registry (one contract) | 0xe10b6f6B275de231345c20D14Ab812db62151b00 | EIP-1967 beacon slot of all four tokens, and `ACCESS_CONTROLLED_REGISTRY()` on all four tokens |
| Stock token implementation `Stock` | 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2 | registry `implementation()` |
| USDG implementation `USDG` | 0x68184C449E1a8f34fA18d289737129FD27B66f8F | EIP-1967 implementation slot of USDG |
| USDG permit and EIP-3009 facet | 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 | USDG `getFacet(0xd505accf)` |
| USDG pause and freeze facet | 0x58cab81e3d8468A0e90df8cBfacb34535e1DE942 | USDG `getFacet(0x5c975abb)` and `getFacet(0xe5839836)` |
| USDG admin (`defaultAdmin()`) | 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F | a `TimelockController` (Sourcify exact match), `getMinDelay()` = 86400 |
| WETH | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 | SwapRouter02 `WETH9()`, QuoterV2 `WETH9()`, Robinhood docs |
| Uniswap v2 factory | 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f | SwapRouter02 `factoryV2()`, equals the SDK |
| Uniswap v3 NonfungiblePositionManager | 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3 | SwapRouter02 `positionManager()`, equals the SDK |
| Feed aggregators (DualAggregator 1.0.0) | SPY 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc, QQQ 0x25e996ce8b3529885D429241156e83e7b7744049, NVDA 0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2, AAPL 0xBb11A21267cFDb63d4935d99a499133DD1744ACb, USDG/USD 0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e | proxy `aggregator()`, equals the Chainlink directory `contractAddress` |
| Feed SVR secondary proxies | SPY 0xa68CA83408bE3f78d1c58a82081c619e9d21486d, QQQ 0x41ed2c58611790af0760e31e80Bb427e4e83D603, NVDA 0xCF169363636D73dbBf77733629CB38919d14232d, AAPL 0x4bDbb3150014c6Ab2C6D9347B0779c49015a2f3f, USDG/USD 0x901f56689360B89D7767a8acE28B7801e6348fa2 | Chainlink directory `secondaryProxyAddress`, `svrDisplayLabel` "Shared SVR". Not read onchain. |
| PRD-only rows | v4 PoolManager 0x8366a39cc670b4001a1121b8f6a443a643e40951 (24009 bytes), v4 Quoter 0x8dc178efb8111bb0973dd9d722ebeff267c98f94 (6118), v4 StateView 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b (3531), IRM 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 (2282) | code sizes at 78,327,113. The three v4 addresses equal the Uniswap SDK. |

## 2. Per-address detail

All values are at block 78,327,113 unless marked. The exact command for every row is in Appendix B.1.

### USDG

| Call | Result |
| --- | --- |
| `name()(string)` | "Global Dollar" |
| `symbol()(string)` | "USDG" |
| `decimals()(uint8)` | 6 |
| `totalSupply()(uint256)` | 700131297813141 (700,131,297.813141 USDG) |
| storage slot `0x3608...2bbc` (EIP-1967 implementation) | 0x...68184c449e1a8f34fa18d289737129fd27b66f8f |
| storage slot `0xb531...6103` (EIP-1967 admin) | 0x0 |
| storage slot `0xa3f0...3d50` (EIP-1967 beacon) | 0x0 |
| `DOMAIN_SEPARATOR()(bytes32)` | 0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036, equal to keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("Global Dollar"), keccak256("1"), 4663, USDG)) |
| `PERMIT_TYPEHASH()(bytes32)` | 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9, equal to keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)") |
| `nonces(address)(uint256)` 0x...dEaD | 0 |
| `paused()(bool)` | false |
| `isFrozen(address)(bool)` for 0x...dEaD and the three Sleeve EOAs | false, false, false, false |
| `globalTransferSettings()(uint40,uint32,bool,bytes10,bool)` | 1771891200, 86400, false, 0x00000000000000000000, false (the last field is the pause flag) |
| `defaultAdmin()(address)` and `owner()(address)` | 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F |
| `defaultAdminDelay()(uint48)` | 10800 |
| `supplyControl()(address)` | 0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4 |
| `getFacet(bytes4)(address)` for 0xd505accf, 0x9fd5a6cf, 0x7ecebe00, 0x30adf81f, 0xe3ee160e, 0xef55bec6 | 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 for all six |
| `getFacet(bytes4)(address)` for 0x5c975abb, 0xe5839836, 0x8d1fdf2f, 0x45c8b1a6, 0x8456cb59 | 0x58cab81e3d8468A0e90df8cBfacb34535e1DE942 for all five |

### EntryPoint v0.7, Permit2, ArbSys

| Call | Result |
| --- | --- |
| EntryPoint `getNonce(address,uint192)(uint256)` 0x...dEaD, 0 | 0 |
| EntryPoint runtime code hash, `cast keccak $(cast code ...)` | 0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58 |
| Same address on Ethereum mainnet, `cast codehash --rpc-url https://ethereum-rpc.publicnode.com` (Ethereum block about 26,105,428) | 0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58, code size 16035. Identical bytecode. |
| Permit2 `DOMAIN_SEPARATOR()(bytes32)` | 0x448684463b1f7965c1ec7c249cee11520df24c07242efc2b20f6e54c85614fad, equal to keccak256(abi.encode(keccak256("EIP712Domain(string name,uint256 chainId,address verifyingContract)"), keccak256("Permit2"), 4663, PERMIT2)) |
| Permit2 runtime code hash | 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca. Ethereum's is 0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131 with the same size 9152. Permit2 caches the chain id and domain separator as immutables, so the hash is expected to differ per chain. |
| ArbSys `cast code` | 0xfe |
| ArbSys `arbChainID()(uint256)` | 4663 |
| ArbSys `arbBlockNumber()(uint256)` | 78327113, the pinned block |
| ArbSys `arbOSVersion()(uint256)` | 116 (raw value, not interpreted) |
| Multicall3 0xcA11bde05977b3631167028862bE2a173976CA11 `getBlockNumber()(uint256)`, which returns `block.number` | 26105440, the header's `l1BlockNumber`. This confirms the build contract fact that `block.number` is an L1 estimate. |

### Uniswap

| Call | Result |
| --- | --- |
| SwapRouter02 `factory()(address)` | 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, equal to V3_FACTORY |
| SwapRouter02 `WETH9()(address)` | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |
| SwapRouter02 `factoryV2()(address)` | 0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f |
| SwapRouter02 `positionManager()(address)` | 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3 |
| QuoterV2 `factory()(address)` | 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA |
| QuoterV2 `WETH9()(address)` | 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |
| QuoterV2 `quoteExactInputSingle((address,address,uint256,uint24,uint160))`, 100 USDG to NVDA, fee 500 | 424582767425073121 (0.4246 NVDA), sqrtPriceX96After 5163796060375928441819517094493351, 1 tick crossed, gas estimate 109274 |
| Same quote in the Quoter V1 shape `quoteExactInputSingle(address,address,uint24,uint256,uint160)` | reverts with empty data |
| v3 factory `owner()(address)` | 0x05C420bC4823e039AA4dA645eDde743486dAAA25 |
| v3 factory `feeAmountTickSpacing(uint24)(int24)` for 100, 200, 300, 400, 500, 2500, 3000, 10000 | 1, 0, 0, 0, 10, 0, 60, 200 |

Only the four standard fee tiers are enabled on the v3 factory. A zero tick spacing means the tier is not enabled. The pools with fees up to 95 percent that the PRD mentions cannot be v3 pools on this factory, so they must be v4 pools.

v3 pools that exist for USDG paired with each launch token, from `getPool(address,address,uint24)(address)` with USDG first. Depth was not checked. That is G5.

| Token | 100 | 500 | 3000 | 10000 |
| --- | --- | --- | --- | --- |
| SPY | 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5 | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 0xA43b424Bc609495AED4BCD88d654934b510B0aD9 | none |
| QQQ | 0x4539019B527211998642fEC342C85dcB44c7e5E4 | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79 | none |
| NVDA | 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333 | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B | 0xc277560DF3689A401bA7deDd7626168b234Ceb5e |
| AAPL | none | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | 0x3714aa8105DE1f384481B425788Af413748C1837 |

### Morpho Blue (M1)

| Call | Result |
| --- | --- |
| `owner()(address)` | 0x060595638692de6CCd47ca04094F1772D3D39728 |
| `feeRecipient()(address)` | 0x0000000000000000000000000000000000000000 |
| `DOMAIN_SEPARATOR()(bytes32)` | 0xdec2c0a13cb9b2c7a749851d2692c8fd3a7941bf77148fced920e78c99a5fba0, equal to keccak256(abi.encode(keccak256("EIP712Domain(uint256 chainId,address verifyingContract)"), 4663, MORPHO_BLUE)) |
| PRD IRM 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 `MORPHO()(address)` | 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 |

The Ethereum mainnet Morpho Blue (0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb) is 15623 bytes, against 15582 here. Sourcify says this one was compiled with solc 0.8.19 for the paris EVM. So it is not byte-identical to Ethereum's deployment. Morpho is M1 and gate G1 is open, so I stopped there.

## 3. Stock token interface map

### Structure

Each stock token is an OpenZeppelin `BeaconProxy` (283 bytes, all four share runtime code hash 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630). The EIP-1967 beacon slot `0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` holds 0xe10b6f6B275de231345c20D14Ab812db62151b00 on all four. The implementation and admin slots are zero.

The beacon is `src/AccessControlsRegistry.sol:AccessControlsRegistry`, one contract that serves as the `IBeacon`, the role registry, the global pause and the blocklist:

```solidity
contract AccessControlsRegistry is IBeacon, IAccessControlsRegistry, AccessControl {
    address public override implementation;
    bool public override paused;
    ...
    mapping(address => bool) public override isBlocked;
```

Its `implementation()` returns 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2, which is `src/Stock.sol:Stock` (solc 0.8.33, cancun, optimizer 200 runs). The `Stock` implementation stores the registry as an immutable, `ACCESS_CONTROLLED_REGISTRY`, and returns 0xe10b6f6B275de231345c20D14Ab812db62151b00 from all four tokens and from the bare implementation.

Source: Sourcify exact match for both contracts. Registry: match id 47290828, verified 2026-09-08T09:40:13Z, deployed at block 7,662. Implementation: match id 47290976, verified 2026-09-08T09:42:53Z, deployed at block 7,784. Both deployed by 0x074377a78A9710A1D47244f89797718b4f491279. SPY proxy: match id 47290704, runtime match. Retrieved 14:57:34Z with `curl https://sourcify.dev/server/v2/contract/4663/<address>?fields=all`.

### Views the PriceGuard needs

Selectors come from `cast sig` on the exact signature and agree with the verified ABI.

| Function | Selector | Contract to call | Returns | Notes from the verified source |
| --- | --- | --- | --- | --- |
| `paused()` | 0x5c975abb | token | bool | `return $.paused \|\| IAccessControlsRegistry(ACCESS_CONTROLLED_REGISTRY).paused();` It already includes the registry's global pause. |
| `tokenPaused()` | 0x86c75e74 | token | bool | Token flag only. |
| `oraclePaused()` | 0x7706ba52 | token | bool | Set by `pauseOracle()` under `ORACLE_PAUSER_ROLE`. Nothing onchain reads it. |
| `uiMultiplier()` | 0xa60bf13d | token | uint256, 1e18 = 1.0 | Returns `_newMultiplier` once `block.timestamp >= _effectiveAt` and `_newMultiplier != 0`, otherwise `_multiplier`, or 1e18 if never set. It switches at `effectiveAt` with no transaction. |
| `newUIMultiplier()` | 0xdc767007 | token | uint256 | The scheduled value, or 1e18 if never set. After `effectiveAt` it equals `uiMultiplier()`. |
| `effectiveAt()` | 0x97a4064f | token | uint256, unix seconds | 0 if never set. A change is pending only while `effectiveAt() > block.timestamp`. |
| `uid()` | 0xf514ce36 | token | bytes32 | Equals the `id` in the issuer assets API for all four. |
| `ACCESS_CONTROLLED_REGISTRY()` | 0x50c09be3 | token | address | The registry the token consults for roles, blocks and the global pause. |
| `isBlocked(address account)` | 0xfbac3951 | registry 0xe10b6f6B275de231345c20D14Ab812db62151b00 | bool | Public mapping getter. One list for every stock token behind this beacon. The token has no blocklist getter of its own. |
| `paused()` | 0x5c975abb | registry | bool | Global pause for every stock token. |
| `implementation()` | 0x5c60da1b | registry | address | `IBeacon`. |
| `balanceOfUI(address)` | 0x437a9958 | token | uint256 | `mulDiv(balanceOf, uiMultiplier, 1e18)` |
| `totalSupplyUI()` | 0x9bea6429 | token | uint256 | |
| `terms()` | 0xd5025625 | token | string | "https://robinhood.com/stocktoken/rhj" |
| `decimals()` | 0x313ce567 | token | uint8 | 18 |
| `permit(address,address,uint256,uint256,uint8,bytes32,bytes32)` | 0xd505accf | token | | OpenZeppelin ERC20Permit. EIP-712 name is `name()`, version "1". |

Write functions, for completeness. Token: `updateMultiplier(uint256)` 0x5ffe6146 (takes effect now), `updateMultiplier(uint256,uint256)` 0xbad60f18 (scheduled), both under `MULTIPLIER_UPDATER_ROLE` and `onlyNotPaused`. `pause()` 0x8456cb59 and `unpause()` 0x3f4ba83a under `TOKEN_PAUSER_ROLE`. `pauseOracle()` 0x253ea980 and `unpauseOracle()` 0x0fab6865 under `ORACLE_PAUSER_ROLE`. Registry: `blockAccounts(address[])` 0x6abf7081 and `unblockAccounts(address[])` 0xfaed47fd under `BLOCKER_ROLE`, `pause()` 0x8456cb59 and `unpause()` 0x3f4ba83a under `PAUSER_ROLE`, `upgradeTo(address)` 0x3659cfe6 under `BEACON_UPGRADER_ROLE`.

### Events

Topics come from `cast sig-event`.

| Event | topic0 | Emitted by |
| --- | --- | --- |
| `UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)`, nothing indexed | 0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055 | token |
| `TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue)` | 0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802 | token, on every balance change |
| `Paused()` | 0x9e87fac88ff661f02d44f95383c817fece4bce600a3dab7a54406878b965e752 | token (token pause) and registry (global pause). Same topic, so filter by address. |
| `Unpaused()` | 0xa45f47fdea8a1efdd9029a5691c7f759c32b7c698632b563573e155625d16933 | token and registry |
| `OraclePaused()` | 0xe28b7053f432ae5400c6168140cbe15638399715519a0a39b16b505fb9fc9d9a | token |
| `OracleUnpaused()` | 0xa274116fec684497d55e11cc9516edaa8d206c8b5f84c4603e32572c37f8e6dd | token |
| `Blocked(address indexed account)` | 0x75e91ce73c1d3352d8dd3610443539cd33dfe13b1de8f8caae54ec26dd0dc9cb | registry |
| `Unblocked(address indexed account)` | 0x5c272fb29e21b46870af1850afe89126704c55a7781cc100da3f733e15446c7d | registry |
| `Upgraded(address indexed implementation)` | 0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b | registry, when the beacon changes implementation |
| `MetaDataUpdated(string name, string symbol)` | 0x0030cda629fbac2efa8c01c1732f1dd9cbec41aae6ceae83906fe6c003b3a03c | token, from `setMetadata` |

Custom errors a buy or sell can hit: `IsPaused()` 0x1309a563 from the token, and `Blocked(address)` 0x75e91ce7 from the token's `onlyNotBlocked` modifier. The error selector is the first 4 bytes of the `Blocked` event topic because both use the string `Blocked(address)`.

### Who must not be blocked

From `Stock.sol`. `transfer` checks `onlyNotPaused`, `onlyNotBlocked(to)` and `onlyNotBlocked(_msgSender())`. `transferFrom` checks `from`, `to` and `_msgSender()`. `approve` checks `spender` and `_msgSender()`. `permit` checks `owner`, `spender` and `_msgSender()`.

On a buy through SwapRouter02 with the account as recipient, the v3 pool calls `transfer(account, amount)`, so both the pool and the account must be unblocked. On a sell-back, the account's `approve(router)` checks the router and the account, and the pool callback's `transferFrom(account, pool, amount)` checks the account, the pool and the router. A blocked pool or router makes the whole swap revert, so the guard's queue path never runs.

### Values on all four tokens, block 78,327,113

| Call | SPY | QQQ | NVDA | AAPL |
| --- | --- | --- | --- | --- |
| `name()` | "SPDR S&P 500 ETF Trust • Robinhood Token" | "Invesco QQQ • Robinhood Token" | "NVIDIA • Robinhood Token" | "Apple • Robinhood Token" |
| `symbol()` | SPY | QQQ | NVDA | AAPL |
| `decimals()` | 18 | 18 | 18 | 18 |
| `totalSupply()` | 30555281925040000000000 | 6334407202940000000000 | 74618653287110000000000 | 16309446327630000000000 |
| `totalSupplyUI()` | 30607775630117941299356 | 6338846300027315788488 | 74676494620057896189245 | 16318678780003528596366 |
| `uid()` | 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1 | 0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed | 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5 | 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649 |
| assets API `id` | same | same | same | same |
| `paused()` | false | false | false | false |
| `tokenPaused()` | false | false | false | false |
| `oraclePaused()` | false | false | false | false |
| `uiMultiplier()` | 1001717991187472003 | 1000700791241405425 | 1000775159164630595 | 1000566080061092436 |
| assets API `currentMultiplier` | "1.001717991187472003" | "1.000700791241405425" | "1.000775159164630595" | "1.000566080061092436" |
| `newUIMultiplier()` | 1001717991187472003 | 1000700791241405425 | 1000775159164630595 | 1000566080061092436 |
| `effectiveAt()` | 1789690233 (2026-09-18T00:10:33Z) | 1790035834 (2026-09-22T00:10:34Z) | 1788998430 (2026-09-10T00:00:30Z) | 1786720366 (2026-08-14T15:12:46Z) |
| `ACCESS_CONTROLLED_REGISTRY()` | 0xe10b...1b00 | 0xe10b...1b00 | 0xe10b...1b00 | 0xe10b...1b00 |
| `DOMAIN_SEPARATOR()` | 0x9664225da5421089c71fcde532a8a45100a788b0adc7c45dbb4fe72320cfb527 | 0x0d742aa0bc660a58e10d0b613abeb775e4c6ce80c31919e718f74190a6eed95e | 0x9561b23bbb0b6a2c7eecb765b6ae196568c31251e7086d435234d3017abcf6f7 | 0xddc20599e9f8b3f5f24eea08e26e58b564138e2a2a0dbd21bf8374048ebf4424 |
| `supportsInterface` 0xa60bf13d, 0x4bd27648, 0xd890fd71, 0x57854fc3, 0x01ffc9a7 | true, true, true, false, true | same | same | same |

No change is pending on any token: `effectiveAt()` is in the past and `newUIMultiplier()` equals `uiMultiplier()` on all four. The SPY `DOMAIN_SEPARATOR()` equals the value computed from its `name()`, version "1", chain 4663 and its address, and `eip712Domain()` returned `0x0f, "SPDR S&P 500 ETF Trust • Robinhood Token", "1", 4663, 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C`. Registry at the same block: `implementation()` 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2, `paused()` false, `isBlocked` false for 0x...dEaD, DEPLOYER, KEEPER, TEST_PAYER and SwapRouter02.

### Event history, block 0 to 78,335,689

| Contract | Event | Count | Detail |
| --- | --- | --- | --- |
| each of the 4 tokens | `UIMultiplierUpdated` | 1 each | table below |
| each of the 4 tokens | `Paused`, `Unpaused`, `OraclePaused`, `OracleUnpaused`, `MetaDataUpdated` | 0 | The oracle pause has never been used on these four tokens. |
| registry | `Blocked` | 246 events, 177 distinct accounts | blocks 43,543 to 495,713 |
| registry | `Unblocked` | 4 | 0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead at blocks 53,336 and 80,752, 0x...dead at 495,553 and 495,841 |
| registry | `Paused` | 1 | block 611,101 |
| registry | `Unpaused` | 2 | blocks 610,644 and 611,243 |
| registry | `Upgraded` | 2 | blocks 7,796 and 657,134, both to 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2 |

| Token | Block | Tx | old, new, effectiveAt | Block time | Lead |
| --- | --- | --- | --- | --- | --- |
| AAPL | 36,345,344 | 0x6d72ca599d812b9eb483fa82ba204e6d079e981b675669c9b659b7fac8adff35 | 1e18, 1000566080061092436, 1786720366 | 2026-08-14T15:03:06Z | 580 s |
| NVDA | 58,952,659 | 0x4ac23f2e58e2c4962dcd701c2beff581e87f3995152a29d527c07a3afd67d956 | 1e18, 1000775159164630595, 1788998430 | 2026-09-09T23:50:42Z | 588 s |
| SPY | 65,779,981 | 0x2fe45ab24d1b3fa87883f8b08daf29dae969c5b43d0afe9ccca299c11a641025 | 1e18, 1001717991187472003, 1789690233 | 2026-09-18T00:00:49Z | 584 s |
| QQQ | 69,210,998 | 0x6331915e6ddac124b1ea59b0db720892615fbd8ffbbea59cc9772147e326bba6 | 1e18, 1000700791241405425, 1790035834 | 2026-09-22T00:00:50Z | 584 s |

The SPY and AAPL transactions call `updateMultiplier(uint256,uint256)` (selector 0xbad60f18) from 0x92905e8d0e2301BA143215B8D86D63fFD4188143. So far every change was scheduled about 10 minutes ahead and was a dividend-size step of under 0.2 percent. Block times come from `cast block <n> -f timestamp` on `$FORK_RPC`.

## 4. G4 feed findings

Status: the PRD finding holds. Each feed has 8 decimals, a 24-hour heartbeat and a 0.5 percent deviation trigger, and the addresses are now official.

Chainlink reference data directory rows (`feeds-robinhood-mainnet.json`, 58 rows, retrieved 14:55:33Z, sha256 `714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776`):

| name | proxyAddress | contractAddress | decimals | heartbeat | threshold | marketHours | path |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Robinhood SPY / USD | 0x319724394D3A0e3669269846abE664Cd621f9f6A | 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc | 8 | 86400 | 0.5 | us_equities_24/5 | robinhood-spy-usd-shared-svr |
| Robinhood QQQ / USD | 0x80901d846d5D7B030F26B480776EE3b29374C2ae | 0x25e996ce8b3529885D429241156e83e7b7744049 | 8 | 86400 | 0.5 | us_equities_24/5 | robinhood-qqq-usd-shared-svr |
| Robinhood NVDA / USD | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | 0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2 | 8 | 86400 | 0.5 | us_equities_24/5 | robinhood-nvda-usd-shared-svr |
| Robinhood AAPL / USD | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 | 0xBb11A21267cFDb63d4935d99a499133DD1744ACb | 8 | 86400 | 0.5 | us_equities_24/5 | robinhood-aapl-usd-shared-svr |
| USDG / USD | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | 0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e | 8 | 86400 | 0.5 | Crypto | usdg-usd-shared-svr |

Onchain, block 78,327,113. Every proxy returned `version()` 6, `phaseId()` 1, and an `aggregator()` equal to the directory's `contractAddress`.

| Feed | `description()` | `decimals()` | roundId (phase, round) | answer | startedAt | updatedAt | answeredInRound | Age at the block |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SPY | "RHSPY / USD" | 8 | 18446744073709551770 (1, 154) | 77071210575 ($770.71210575) | 1790944226 | 1790944238 (12:30:38Z) | same as roundId | 9,532 s (2.65 h) |
| QQQ | "Robinhood QQQ / USD" | 8 | 18446744073709552017 (1, 401) | 75199912534 ($751.99912534) | 1790945820 | 1790945832 (12:57:12Z) | same | 7,938 s (2.21 h) |
| NVDA | "RHNVDA / USD" | 8 | 18446744073709552775 (1, 1159) | 23625799569 ($236.25799569) | 1790953397 | 1790953409 (15:03:29Z) | same | 361 s |
| AAPL | "Robinhood AAPL / USD" | 8 | 18446744073709552314 (1, 698) | 33388329774 ($333.88329774) | 1790950135 | 1790950147 (14:09:07Z) | same | 3,623 s (1.01 h) |
| USDG/USD | "USDG / USD" | 8 | 18446744073709551735 (1, 119) | 100001038 ($1.00001038) | 1790869136 | 1790869148 (2026-10-01T15:39:08Z) | same | 84,622 s (23.51 h) |

Each description names its ticker, but in two formats: "RHSPY / USD" and "RHNVDA / USD", against "Robinhood QQQ / USD" and "Robinhood AAPL / USD". Code should not parse descriptions. Pin the feed per ticker in TokenSource instead.

`startedAt` is 12 seconds before `updatedAt` on all five rounds above. The aggregator is OCR2-based, so `startedAt` is the observation time and `updatedAt` is the transmit time. The age check in PRD 7.4 should use `updatedAt`.

Feed state at the D-008 fork blocks (Appendix B.3 and B.4):

| Feed | 78,312,136 (Fri 10:44 EDT): updatedAt, age | 73,280,794 (Sat 14:00 EDT): updatedAt, age |
| --- | --- | --- |
| SPY | 1790944238, 2.23 h, answer 77071210575 | 1790352180 (Fri 16:03:00Z), 25.95 h, answer 77232802713 |
| QQQ | 1790945832, 1.79 h, answer 75199912534 | 1790352215 (Fri 16:03:35Z), 25.94 h, answer 74535972577 |
| NVDA | 1790948711, 0.99 h, answer 23755399953 | 1790366165 (Fri 19:56:05Z), 22.07 h, answer 22566018707 |
| AAPL | 1790950147, 0.59 h, answer 33388329774 | 1790365765 (Fri 19:49:25Z), 22.18 h, answer 34145318048 |
| USDG/USD | 1790869148, 23.09 h, answer 100001038 | 1790437071 (Sat 15:37:51Z), 2.37 h, answer 99992581 |

At both blocks all four tokens had `paused()` false and `oraclePaused()` false, the same multipliers and `effectiveAt` values as section 3, registry `paused()` false and USDG `paused()` false.

Weekend behavior, from `AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)` (topic 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f) on the five aggregators, blocks 72,200,000 to 74,600,000 (Appendix A.8):

| Feed | Last update before the weekend | First update after | Gap |
| --- | --- | --- | --- |
| SPY | round 146, Fri 2026-09-25T16:03:00Z | round 147, Mon 2026-09-28T00:00:40Z | 55.96 h |
| QQQ | round 376, Fri 16:03:35Z | round 377, Mon 00:00:45Z | 55.95 h |
| NVDA | round 1106, Fri 19:56:05Z | round 1107, Mon 00:00:23Z | 52.07 h |
| AAPL | round 671, Fri 19:49:25Z | round 672, Mon 00:00:48Z | 52.19 h |
| USDG/USD | rounds 113, 114, 115 at Fri 15:37:24Z, Sat 15:37:51Z, Sun 15:38:16Z | | 24.01 h each |

What this means for the guard:

- The stock feeds stop between the Friday close and the Sunday 20:00 EDT reopen. The 24-hour heartbeat does not run in that window. At the Saturday fork block, SPY and QQQ were already past a 25-hour age limit while NVDA and AAPL were not. Feed age alone cannot tell the market is closed, as the build contract says. The session calendar has to.
- Every stock feed posted a round 23 to 48 seconds after 00:00:00Z on Monday 28 September, which is Sunday 20:00 EDT. None of those first rounds moved 0.5 percent from the Friday answer (SPY -0.144, QQQ -0.172, NVDA -0.171, AAPL -0.299 percent), so the deviation trigger did not fire them. The likely trigger is the heartbeat, which had run out over the weekend and fired as soon as the session opened. This supports a Sunday 20:00 ET open in the 24/5 calendar.
- The USDG/USD feed runs on crypto hours with a 24-hour heartbeat. Observed gaps were 86,426 s between the 1 and 2 October rounds and about 24.01 h over the weekend. Its age is often 23 to 24 hours, so the depeg check needs a max age above 24 hours.
- No sequencer uptime feed exists for this chain. The directory has no uptime row. Chainlink's docs source `src/content/data-feeds/l2-sequencer-feeds.mdx` (main, read 15:50:35Z) says "Chainlink is no longer expanding L2 Sequencer Uptime Feeds to additional networks." and has no Robinhood entry. Robinhood's own oracle page still says "Chainlink provides an L2 Sequencer Uptime Feed for this; check it before reading any price". The build contract is right not to fake one.
- Read through the proxy only. All five proxies have `accessController()` = 0x0, so any contract can read them. All five aggregators have `checkEnabled()` = true. On the SPY aggregator, `hasAccess(address,bytes)` is true for its proxy and false for SwapRouter02, so a direct aggregator read from a contract would be refused.
- The aggregators report `minAnswer()` = 1 and `maxAnswer()` = 95780971304118053647396689196894323976171195136475135, so there is no practical answer clamp beyond positive.
- The feeds are "Shared SVR" DualAggregator feeds. Each has a secondary SVR proxy, listed in section 1. The constants table uses the primary `proxyAddress` for all five, which is the standard feed. I did not check whether the DualAggregator delays the primary answer relative to the SVR one.
- All five proxies share runtime code hash 0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2 and owner 0xeE27D5Ae494300902D90454e8630A3F1C68c9C52.

## 5. G7 USDG decimals and permit

Status: resolved for decimals and permit. Details below.

- Decimals: `decimals()` returns 6 on both RPCs. The verified implementation hardcodes it: `function decimals() public view virtual override returns (uint8) { return 6; }`.
- Proxy: USDG is an OpenZeppelin `ERC1967Proxy` (Sourcify exact match, match id 46998804, solc 0.8.29). The implementation slot holds 0x68184C449E1a8f34fA18d289737129FD27B66f8F (`contracts/stablecoins/USDG.sol:USDG`, solc 0.8.28, paris, Sourcify match id 46997907, deployed at block 56). The admin and beacon slots are zero because this is UUPS: `_authorizeUpgrade(...) internal override onlyRole(DEFAULT_ADMIN_ROLE)`. `defaultAdmin()` is 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F, a `TimelockController` (Sourcify exact match) with `getMinDelay()` 86400. `defaultAdminDelay()` is 10800 s, the wait before a new admin can take over the role. Upgrades and facet changes wait on the timelock's 86400 s. The proxy emitted one `Upgraded` event, at block 57, to the current implementation.
- Facets: USDG is a Paxos `PaxosTokenClaimableRewards` token with a diamond-style fallback. Selectors the main contract does not define are forwarded by `delegatecall` to `facets[msg.sig]`. All 238 `FacetUpdate(bytes4 indexed selector, address indexed facet)` events came in one transaction at block 57 (0xc51b4ac115d158a50eb9cb902a9d1359d25200e3582192f75c0ad80beba54930), across five facets. `setFacet` needs `DEFAULT_ADMIN_ROLE`, which sits behind that 24-hour timelock.
- Permit: supported.
  - `getFacet(0xd505accf)` returns facet 0x780d30b6a89BC9Eef953a543aA288c3B05b01309 (16149 bytes). The same facet serves `permit(address,address,uint256,uint256,bytes)` 0x9fd5a6cf, `nonces(address)` 0x7ecebe00, `PERMIT_TYPEHASH()` 0x30adf81f, `cancelPermits(uint256)` 0x5659abed, and EIP-3009 `transferWithAuthorization` 0xe3ee160e, `receiveWithAuthorization` 0xef55bec6 and `cancelAuthorization` 0x5a049a70. The runtime bytecode contains PUSH4 for each of these selectors.
  - `DOMAIN_SEPARATOR()` lives in the verified main contract (`EIP712._makeDomainSeparator(name(), "1")`, rebuilt on every call) and equals the value computed for name "Global Dollar", version "1", chain 4663 and the USDG address.
  - A permit signed by a fresh key works in `eth_call` at block 78,327,113, through both the v, r, s form and the bytes form. The same signature with value 1000001 reverts with 0x8baa579f, `InvalidSignature()`. Appendix A.2.
  - The facet bytecode is not verified on Sourcify, and Blockscout's bytecode database has no match for it. The matching source is in Paxos's public repo, paxosglobal/paxos-token-contracts commit 674ac10, `contracts/facets/TokenExtensionsFacet.sol`. Its `_permit` checks pause, zero addresses, `deadline < block.timestamp`, frozen owner or spender, then `SignatureChecker.isValidSignatureNow(owner, digest, signature)`, so ERC-1271 smart-account signatures should also work. I tested only an EOA signature.
- Pause: yes. `paused()` is served by facet 0x58cab81e3d8468A0e90df8cBfacb34535e1DE942 and returns `globalTransferSettings.paused`, currently false. `transfer`, `transferFrom` and `approve` in the verified main contract carry `whenNotPaused`, which reverts with `ContractPaused()` 0xab35696f. No `Pause()` (topic 0x6985a022...f625) or `Unpause()` event has ever been emitted.
- Blocklist: yes, called freeze. `isFrozen(address)` 0xe5839836 is on the same admin facet. Blockscout's bytecode database has a PARTIAL match for that facet as `contracts/facets/TokenAdminFacet.sol:TokenAdminFacet`, solc 0.8.28, where `isFrozen` returns `_isFrozen(addr)`. In the verified main contract, `_transfer` does `if (_isFrozen(to) || _isFrozen(from)) revert AddressFrozen();` (0x1fd1cc44), `transferFrom` also checks `msg.sender`, and `approve` checks the spender and `msg.sender`. 27 `FreezeAddress` events to date. The same facet has `wipeFrozenAddress(address)`, which burns a frozen account's whole balance under `ASSET_PROTECTION_ROLE`.
- Rewards: the implementation's NatSpec says "ERC20 token with auto-compounding yield", but `balanceOf` is "base balance only, excludes unclaimed rewards". Rewards move only through claim functions that transfer from a claim source, and only for accounts registered in a payout group. A Sleeve account's USDG balance therefore does not drift without a `Transfer` event.

## 6. ERC-8056

Robinhood's docs reference it. "Stock tokens also implement ERC-8056 (Scaled UI Amount Extension), which defines the corporate-action multiplier (`uiMultiplier()`)." (docs.robinhood.com/chain/building-with-stock-tokens). And from the Stock Tokens page: "You can access this value via the token's `uiMultiplier()` function, defined by [ERC-8056](https://eips.ethereum.org/EIPS/eip-8056)".

The spec is a Draft. ethereum/ERCs `ERCS/erc-8056.md` was last changed in commit 554d3467b297 on 2026-09-01, "add optional UIMultiplierUpdateCancelled event". I read it at 15:05:35Z, sha256 `fa64d2cb20e2f15828cb8b5d7c5c83cc6fd07c2a84b07f804d216a89bd1e5848`. It lists interface ids "`IScaledUIAmount`: `0xa60bf13d`", "`IScaledUIAmountNewUIMultiplier`: `0x4bd27648`", "`IScaledUIAmountConversion`: `0x57854fc3`" and "`IScaledUIAmountBalances`: `0xd890fd71`", and says compliant contracts "MUST implement the `IScaledUIAmountNewUIMultiplier` extension".

How the deployed tokens compare:

- `supportsInterface` is true for 0xa60bf13d, 0x4bd27648 and 0xd890fd71 and false for 0x57854fc3, so there are no `toUIAmount` or `fromUIAmount` helpers. The ids match `cast sig`: 0xdc767007 xor 0x97a4064f = 0x4bd27648, and 0x437a9958 xor 0x9bea6429 = 0xd890fd71.
- The transfer event differs. The tokens emit `TransferWithScaledUI(address,address,uint256,uint256)`, topic 0x37e7f0db...3802. The draft's optional event is `TransferWithUIAmount(address,address,uint256,uint256)`, topic 0x0226a2f5c1ae0e071aeec3d4ebafcefdc5c549be11f40ed27e76e802acccf374. An indexer written to the draft will see nothing.
- The tokens have no `UIMultiplierUpdateCancelled` event and no cancel function. Rescheduling before `effectiveAt` overwrites the pending value and emits only `UIMultiplierUpdated`, with `oldMultiplier` set to the value current at that moment.
- `updateMultiplier(uint256)` takes effect in the same block (`effectiveAt = block.timestamp`). The draft's reference code requires a future time. Every observed update used the scheduled form.

## 7. What changes for the PriceGuard

These are facts the PriceGuard design has to take in. None of them is a decision.

1. Blocklist check: `IAccessControlsRegistry(registry).isBlocked(account)` with registry 0xe10b6f6B275de231345c20D14Ab812db62151b00. That is what the build contract calls "the beacon's isBlocked(account)". Every stock token shares this one list. PRD 7.4 item 2 calls it "the token's blocklist".
2. Pause check: `token.paused()` already ORs the token flag and the registry's global pause. Reading `tokenPaused()` would miss the global pause.
3. Pending multiplier: a change is pending while `effectiveAt() > block.timestamp`, and `newUIMultiplier()` holds the value. `uiMultiplier()` flips at `effectiveAt` with no event at that moment. Observed lead time is 580 to 588 seconds.
4. The oracle pause flag has never been set on these tokens, including around the four multiplier changes. The PriceGuard cannot count on it to cover a corporate action.
5. Feeds: read through the proxy, read `decimals()` at runtime (8 everywhere today), and use `updatedAt` for age.
6. Fork tests at block 78,312,136 will see a USDG/USD feed 23.09 hours old. A depeg check with a max age under that fails at the pinned block.
7. Decimal scales in play: USDG 6, stock tokens 18, feeds 8, multiplier 1e18.

## 8. RPC and explorer behavior

- Public RPC log limits, exact error text. With one address and one topic: "query spans 78321485 blocks (0 to 78321484), but only 10000000 are allowed for this request; narrow the block range". With an address list or a topic OR-list: "query spans 10000000 blocks (0 to 9999999), but only 100000 are allowed for this request; narrow the block range, or send one value per position". The keeper and indexer should send one address and one topic per request.
- The public RPC challenges bursts of parallel cast requests with Cloudflare HTTP 403 pages. The challenge was over about 13 minutes later. The verifier runs on this endpoint, so it needs backoff and low concurrency.
- dRPC refuses `eth_getProof`, so `cast codehash` fails there with HTTP 400 `{"message":"Unknown state. First available state is 1","code":27}`. `cast keccak $(cast code ...)` gives the same hash and works.
- Blockscout `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/<address>` and the Etherscan-style `/api?module=contract&action=getsourcecode` both returned HTTP 403 with `cf-mitigated: challenge` to curl at 14:56Z, and WebFetch got 403 too. `https://api.blockscout.com/4663/api/v2/...` returned HTTP 402. I did not pay. Sourcify and Blockscout's eth-bytecode-db (`https://eth-bytecode-db.services.blockscout.com/api/v2/bytecodes/sources:search`) both answer without a key.

## 9. Mismatches against the constants table

None. All 18 addresses match the table and Chain4663.sol, have code and behave as named. The values the table states or implies also hold: USDG 6 decimals, stock tokens 18, feeds 8, beacon proxies, SwapRouter02 factory equal to the v3 factory, and the PRD's 24-hour heartbeat with a 0.5 percent trigger.

## 10. Open questions

1. Guard window for a pending multiplier (PRD 7.4 item 5). Changes are scheduled only about 10 minutes ahead, and the oracle pause has never been used. Should the guard also queue for a period after `effectiveAt` until a feed round with `updatedAt >= effectiveAt` arrives? The PRD does not say. The observed changes were under 0.2 percent, which is below the feed's 0.5 percent trigger, so the feed is not forced to update at the switch.
2. Where the PriceGuard gets the registry: call `token.ACCESS_CONTROLLED_REGISTRY()` each time, which follows an implementation upgrade, or pin 0xe10b6f6B275de231345c20D14Ab812db62151b00 in TokenSource behind the timelock. Both return the same address today.
3. The max age for the USDG/USD feed in PRD 7.4 item 7. The PRD sets 25 hours only for the stock feed in item 6. The USDG/USD feed is routinely 23 to 24 hours old.
4. Should the guard also check `isBlocked` for the allowlisted pool on a buy, and for the router and pool on a sell-back? A blocked pool or router reverts the swap instead of queueing it.
5. Primary proxy or SVR proxy. The table uses the primary proxies. Does the DualAggregator hold back the primary answer relative to the SVR one? Not checked.
6. USDG permit runs on an unverified facet. Before the same-chain pay link (M1) depends on it, should the team accept the eth_call proof and Paxos's public source, or wait for verified bytecode? A facet swap needs the 24-hour USDG admin timelock.
7. The Basis column for the token and feed rows can move from "verify" to official (section 1). The build contract is not mine to edit.

## Appendix A. Other checks

### A.1 Discovery reads on the public RPC

At about 14:56Z, latest block 78,319,649. `cast storage --rpc-url $ROBINHOOD_RPC -b 78319649 <token> 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` returned `0x000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b00` for all four tokens, and `cast call --rpc-url $ROBINHOOD_RPC 0xe10b6f6b275de231345c20d14ab812db62151b00 'implementation()(address)'` returned `0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2`. The pinned values are in Appendix B.1.

### A.2 USDG permit simulation

The owner key came from `cast wallet new`, was used once to sign and was thrown away. The owner address was 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3. Typed data signed with `cast wallet sign --private-key <throwaway key> --data --from-file permit_usdg.json`:

```json
{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],"Permit":[{"name":"owner","type":"address"},{"name":"spender","type":"address"},{"name":"value","type":"uint256"},{"name":"nonce","type":"uint256"},{"name":"deadline","type":"uint256"}]},"primaryType":"Permit","domain":{"name":"Global Dollar","version":"1","chainId":4663,"verifyingContract":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"},"message":{"owner":"0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3","spender":"0x000000000000000000000000000000000000dEaD","value":"1000000","nonce":"0","deadline":"1790957370"}}
```

```
signature v=28 r=0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e s=0x63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d2
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'nonces(address)(uint256)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3 0x000000000000000000000000000000000000dEaD 1000000 1790957370 28 0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e 0x63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d2
0x
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'permit(address,address,uint256,uint256,bytes)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3 0x000000000000000000000000000000000000dEaD 1000000 1790957370 0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d21c
0x
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3 0x000000000000000000000000000000000000dEaD 1000001 1790957370 28 0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e 0x63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d2
Error: server returned an error response: error code 3: execution reverted, data: "0x8baa579f"
$ cast sig 'InvalidSignature()'
0x8baa579f
```

### A.3 QuoterV2

```
$ cast call --rpc-url $FORK_RPC --block 78327113 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' "(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC,100000000,500,0)"
424582767425073121 [4.245e17]
5163796060375928441819517094493351 [5.163e33]
1
109274 [1.092e5]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInputSingle(address,address,uint24,uint256,uint160)(uint256)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 500 100000000 0
Error: server returned an error response: error code 3: execution reverted, data: "0x"
```

### A.4 Block number and code comparisons

```
$ cast call --rpc-url $FORK_RPC --block 78327113 0xcA11bde05977b3631167028862bE2a173976CA11 'getBlockNumber()(uint256)'
26105440 [2.61e7]
$ cast block 78327113 --rpc-url $FORK_RPC --json | jq -c '{number, timestamp, hash, l1BlockNumber}'
{"number":"0x4ab2d49","timestamp":"0x6abfc92a","hash":"0xfe7180f17c4ff46cba8240959a67aa3e976a117190f3683b005b24a6e68a81de","l1BlockNumber":"0x18e5660"}
$ cast codehash --rpc-url https://ethereum-rpc.publicnode.com 0x0000000071727De22E5E9d8BAf0edAc6f37da032
0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58
$ cast codesize --rpc-url https://ethereum-rpc.publicnode.com 0x0000000071727De22E5E9d8BAf0edAc6f37da032
16035
$ cast codehash --rpc-url https://ethereum-rpc.publicnode.com 0x000000000022D473030F116dDEE9F6B43aC78BA3
0xc67d1657868aa5146eaf24fb879fb1fdec3d2d493b3683a61c9c2f4fb2851131
$ cast codesize --rpc-url https://ethereum-rpc.publicnode.com 0x000000000022D473030F116dDEE9F6B43aC78BA3
9152
$ cast codesize --rpc-url https://ethereum-rpc.publicnode.com 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb
15623
```

Runtime code hashes at block 78,327,113, `cast keccak $(cast code --rpc-url $FORK_RPC --block 78327113 <address>)`: all five feed proxies 0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2, all four token proxies 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630.

### A.5 Feed access control and bounds, block 78,327,113, `$FORK_RPC`

| Call | SPY | QQQ | NVDA | AAPL | USDG/USD |
| --- | --- | --- | --- | --- | --- |
| proxy `accessController()(address)` | 0x0 | 0x0 | 0x0 | 0x0 | 0x0 |
| proxy `owner()(address)` | 0xeE27D5Ae494300902D90454e8630A3F1C68c9C52 | same | same | same | same |
| aggregator `checkEnabled()(bool)` | true | true | true | true | true |
| aggregator `minAnswer()(int256)` | 1 | 1 | 1 | 1 | 1 |
| aggregator `maxAnswer()(int256)` | 95780971304118053647396689196894323976171195136475135 | same | same | same | same |
| aggregator `typeAndVersion()(string)` | "DualAggregator 1.0.0" | same | same | same | same |

```
$ cast call --rpc-url $FORK_RPC --block 78327113 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc 'hasAccess(address,bytes)(bool)' 0x319724394D3A0e3669269846abE664Cd621f9f6A 0x
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc 'hasAccess(address,bytes)(bool)' 0xCaf681a66D020601342297493863E78C959E5cb2 0x
false
```

### A.6 USDG admin, IRM, multiplier transactions

```
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F
6754
$ cast call --rpc-url $FORK_RPC --block 78327113 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F 'getMinDelay()(uint256)'
86400 [8.64e4]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'pendingDefaultAdmin()(address,uint48)'
0x0000000000000000000000000000000000000000
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 'MORPHO()(address)'
0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
$ cast tx --rpc-url $FORK_RPC 0x2fe45ab24d1b3fa87883f8b08daf29dae969c5b43d0afe9ccca299c11a641025 from
0x92905e8d0e2301BA143215B8D86D63fFD4188143
$ cast tx --rpc-url $FORK_RPC 0x2fe45ab24d1b3fa87883f8b08daf29dae969c5b43d0afe9ccca299c11a641025 to
0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
$ cast tx --rpc-url $FORK_RPC 0x2fe45ab24d1b3fa87883f8b08daf29dae969c5b43d0afe9ccca299c11a641025 input
0xbad60f180000000000000000000000000000000000000000000000000de6d134a5d8de83000000000000000000000000000000000000000000000000000000006aac8179
$ cast calldata-decode 'updateMultiplier(uint256,uint256)' 0xbad60f180000000000000000000000000000000000000000000000000de6d134a5d8de83000000000000000000000000000000000000000000000000000000006aac8179
1001717991187472003 [1.001e18]
1789690233 [1.789e9]
$ cast tx --rpc-url $FORK_RPC 0x6d72ca599d812b9eb483fa82ba204e6d079e981b675669c9b659b7fac8adff35 from
0x92905e8d0e2301BA143215B8D86D63fFD4188143
$ cast tx --rpc-url $FORK_RPC 0x6d72ca599d812b9eb483fa82ba204e6d079e981b675669c9b659b7fac8adff35 to
0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
$ cast tx --rpc-url $FORK_RPC 0x6d72ca599d812b9eb483fa82ba204e6d079e981b675669c9b659b7fac8adff35 input
0xbad60f180000000000000000000000000000000000000000000000000de2b98c7058b254000000000000000000000000000000000000000000000000000000006a7f306e
$ cast calldata-decode 'updateMultiplier(uint256,uint256)' 0xbad60f180000000000000000000000000000000000000000000000000de2b98c7058b254000000000000000000000000000000000000000000000000000000006a7f306e
1000566080061092436 [1e18]
1786720366 [1.786e9]
$ cast block 65779981 --rpc-url $FORK_RPC -f timestamp    # SPY update
1789689649
$ cast block 69210998 --rpc-url $FORK_RPC -f timestamp    # QQQ update
1790035250
$ cast block 58952659 --rpc-url $FORK_RPC -f timestamp    # NVDA update
1788997842
$ cast block 36345344 --rpc-url $FORK_RPC -f timestamp    # AAPL update
1786719786
```

### A.7 Sourcify records

`curl https://sourcify.dev/server/v2/contract/4663/<address>?fields=compilation,deployment`, read between 14:57Z and 15:40Z.

| Address | match | Contract | solc | Deploy block |
| --- | --- | --- | --- | --- |
| 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2 | exact_match | src/Stock.sol:Stock | 0.8.33 | 7,784 |
| 0xe10b6f6B275de231345c20D14Ab812db62151b00 | exact_match | src/AccessControlsRegistry.sol:AccessControlsRegistry | 0.8.33 | 7,662 |
| 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | match (runtime) | OpenZeppelin BeaconProxy | 0.8.33 | |
| 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | exact_match | OpenZeppelin ERC1967Proxy | 0.8.29 | |
| 0x68184C449E1a8f34fA18d289737129FD27B66f8F | match | contracts/stablecoins/USDG.sol:USDG | 0.8.28 | 56 |
| 0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F | exact_match | TimelockController | | |
| 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | exact_match | contracts/core/EntryPoint.sol:EntryPoint | 0.8.23 | |
| 0x000000000022D473030F116dDEE9F6B43aC78BA3 | match | src/Permit2.sol:Permit2 | 0.8.17 | |
| 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA | match | contracts/UniswapV3Factory.sol:UniswapV3Factory | 0.7.6 | 8,930 |
| 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 | match | contracts/v3/periphery/lens/QuoterV2.sol:QuoterV2 | 0.7.6 | |
| 0x204FAca1764B154221e35c0d20aBb3c525710498 | match | contracts/UniversalRouter.sol:UniversalRouter | 0.8.26 | 65,727,895 |
| 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 | match | Morpho | 0.8.19 | 286 |
| 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1 | match | AdaptiveCurveIrm | 0.8.19 | 286 |
| 0x319724394D3A0e3669269846abE664Cd621f9f6A, 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | exact_match | EACAggregatorProxy | 0.6.6 | 112,288, 112,678, 33,322 |
| 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc | match | src/DualAggregator.sol:DualAggregator | 0.8.24 | 112,281 |
| SwapRouter02, QQQ and AAPL feed proxies, the five USDG facets | not verified | | | |

### A.8 Event queries

Template, public RPC, one address and one topic per request:

```
$ cast rpc --rpc-url $ROBINHOOD_RPC eth_getLogs '{"address":"<address>","fromBlock":"<start>","toBlock":"<end>","topics":["<topic0>"]}'
```

Windows: 0x0 to 0x98967f, then each following 10,000,000 blocks, the last ending at 0x4ab4ec9 (78,335,689). 200 queries for the tokens and registry, 160 for the corrected token pause, oracle pause and metadata rerun, and 32 for USDG. Every query returned a JSON array. The USDG `FacetUpdate` scan used `cast logs --rpc-url $ROBINHOOD_RPC --address 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 --from-block <start> --to-block <start + 9999999> 0x59277b34e7bfaca5e93a39d132e8eccf6712605952797722701ea2ae717a914a` for start = 0, 10,000,000 and so on to 70,000,000, run at about 15:00Z. The weekend feed scan used one window, 0x44daf40 (72,200,000) to 0x4724e40 (74,600,000), with topic 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f on each aggregator.

| Address | Topic | Total |
| --- | --- | --- |
| SPY, QQQ, NVDA, AAPL | `UIMultiplierUpdated` 0x2205...b055 | 1 each |
| SPY, QQQ, NVDA, AAPL | `OraclePaused`, `OracleUnpaused`, `Paused`, `Unpaused`, `MetaDataUpdated` | 0 each |
| registry 0xe10b...1b00 | `Blocked`, `Unblocked`, `Paused`, `Unpaused`, `Upgraded` | 246, 4, 1, 2, 2 |
| USDG | `Upgraded`, `Pause()`, `Unpause()`, `FreezeAddress(address)` 0x1aa660498c83ea285bc55e4cfc00afcaa7120798db87b74f3c0d7c6e001bc392 | 1, 0, 0, 27 |
| USDG | `FacetUpdate(bytes4,address)` | 238, all in block 57 |

### A.9 Blockscout bytecode database

The request body is `{"bytecode":"<output of cast code --rpc-url $FORK_RPC --block 78327113 <facet>>","bytecodeType":"DEPLOYED_BYTECODE"}`, saved as `ebd_<facet>.json`.

```
$ curl -sS -X POST -H 'content-type: application/json' --data @ebd_0x58cab81e3d8468A0e90df8cBfacb34535e1DE942.json https://eth-bytecode-db.services.blockscout.com/api/v2/bytecodes/sources:search | jq -c '[.sources[]? | {fileName, contractName, compilerVersion, matchType, sourceType}]'
[{"fileName":"contracts/facets/TokenAdminFacet.sol","contractName":"TokenAdminFacet","compilerVersion":"v0.8.28+commit.7893614a","matchType":"PARTIAL","sourceType":"SOLIDITY"},{"fileName":"contracts/facets/TokenAdminFacet.sol","contractName":"TokenAdminFacet","compilerVersion":"v0.8.28+commit.7893614a","matchType":"PARTIAL","sourceType":"SOLIDITY"}]
$ curl -sS -X POST -H 'content-type: application/json' --data @ebd_0x780d30b6a89BC9Eef953a543aA288c3B05b01309.json https://eth-bytecode-db.services.blockscout.com/api/v2/bytecodes/sources:search | jq -c '[.sources[]? | {fileName, contractName, compilerVersion, matchType, sourceType}]'
[]
```

Read at 15:47:10Z. The matched bundle also carries `contracts/facets/TokenExtensionsFacet.sol`. Its `_permit` is the same as the one in Paxos's repo. Its `cancelPermits` lacks the repo's frozen-caller check.

### A.10 Sources

| Source | Retrieved (UTC) | Quote or use |
| --- | --- | --- |
| docs.robinhood.com/chain/contracts, from the MDX in `index--FXM3_nW.js` | 14:54:29Z | "Use the addresses on this page to identify the **canonical** Robinhood Stock Token for each underlying" and "The table below is generated live from the on-chain asset registry." The component that draws that table fetches `https://api.robinhood.com/rhj/assets` (`index-C7gDoMED.js`, 14:55:01Z). |
| https://api.robinhood.com/rhj/assets | 14:55:08Z | 194 assets, sha256 `3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c`. SPY, QQQ, NVDA and AAPL entries give the contract addresses in Chain4663.sol, `tokenDecimals` 18, the `id` values that equal `uid()`, and `pendingMultiplier` "" for all four. |
| docs.robinhood.com/chain/oracles-and-price-feeds | 14:54:29Z | "The flag is advisory and not enforced on-chain, so a paused oracle may still return a value" and "Stock feeds update 24/5, following market hours." |
| docs.robinhood.com/chain/differences-from-ethereum | 14:54:29Z | "`block.number` returns an estimate of the L1 (Ethereum) block number, not the Robinhood Chain block number" |
| https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json | 14:55:33Z | feed rows in section 4 |
| smartcontractkit/documentation main, `src/features/data/chains.ts` | 14:55:24Z | `rddUrl: "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"` for "Robinhood Chain Mainnet" |
| smartcontractkit/documentation main, `src/content/data-feeds/l2-sequencer-feeds.mdx` | 15:50:35Z | "Chainlink is no longer expanding L2 Sequencer Uptime Feeds to additional networks." |
| Uniswap/sdks commit 17d70b1b1068fc1b5ce79a89fb5901e562a22e79 | 15:05:02Z | `ROBINHOOD_ADDRESSES` with `v3CoreFactoryAddress: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'`, `quoterAddress: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'`, `swapRouter02Address: '0xcaf681a66d020601342297493863e78c959e5cb2'`, and the UR entry `[UniversalRouterVersion.V2_1_2]: { address: '0x204FAca1764B154221e35c0d20aBb3c525710498', creationBlock: 65727895 }` |
| ethereum/ERCs master `ERCS/erc-8056.md` | 15:05:35Z | section 6 |
| paxosglobal/paxos-token-contracts commit 674ac1046a0a40bfd2b6b892192998af9ac3b171 | 15:02:45Z | `contracts/facets/TokenExtensionsFacet.sol`. Its `PaxosTokenClaimableRewards.sol`, `BaseStorageV3.sol` and `stablecoins/USDG.sol` are identical to the Sourcify source of the USDG implementation. `ClaimableRewardsBase.sol` differs only by `virtual` on `DOMAIN_SEPARATOR()`. |

Exact MDX lines from the docs bundle `index--FXM3_nW.js`, retrieved 14:54:29Z. Line numbers are within each decoded page.

```
chain/account-abstraction/index.mdx:29:| ERC-4337 Entrypoint v0.7.0 | **`0x0000000071727De22E5E9d8BAf0edAc6f37da032`** |
chain/protocol-contracts/index.mdx:49:| L2 Weth | [**`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`**](https://robinhoodchain.blockscout.com/address/0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73) | [**`0x7943e237c7F95DA44E0301572D358911207852Fa`**](https://explorer.testnet.chain.robinhood.com/address/0x7943e237c7F95DA44E0301572D358911207852Fa) |
chain/protocol-contracts/index.mdx:67:| ArbSys | [**`0x0000000000000000000000000000000000000064`**](https://robinhoodchain.blockscout.com/address/0x0000000000000000000000000000000000000064) | [**`0x0000000000000000000000000000000000000064`**](https://explorer.testnet.chain.robinhood.com/address/0x0000000000000000000000000000000000000064) |
chain/protocol-contracts/index.mdx:79:| Permit2 | [**`0x000000000022D473030F116dDEE9F6B43aC78BA3`**](https://robinhoodchain.blockscout.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) | [**`0x000000000022D473030F116dDEE9F6B43aC78BA3`**](https://explorer.testnet.chain.robinhood.com/address/0x000000000022D473030F116dDEE9F6B43aC78BA3) |
chain/contracts/index.mdx:12:| USDG | [**`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`**](https://robinhoodchain.blockscout.com/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) |
```

## Appendix B. Pinned-block command logs

`$FORK_RPC` is https://robinhood.drpc.org and `$ROBINHOOD_RPC` is https://rpc.mainnet.chain.robinhood.com, as in `.env.example`. Output is exactly what cast printed. Multi-value returns are one value per line.

### B.1 Full pass, $FORK_RPC at block 78327113

```
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
170
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x0000000071727De22E5E9d8BAf0edAc6f37da032
16035
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x000000000022D473030F116dDEE9F6B43aC78BA3
9152
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064
1
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xCaf681a66D020601342297493863E78C959E5cb2
24497
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
24535
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7
8273
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x204FAca1764B154221e35c0d20aBb3c525710498
24380
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
15582
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
283
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A
9571
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
283
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae
9571
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
283
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15
9571
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
283
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0
9571
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2
9571
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00
2332
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2
11614
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x68184C449E1a8f34fA18d289737129FD27B66f8F
18644
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
2202
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
12266
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x780d30b6a89BC9Eef953a543aA288c3B05b01309
16149
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xA295A2661c02Aea11a2b34D412faDD3507660DaB
13177
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xC5DC7Ec334414900632275B92858860C4c4688D7
11702
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xDc3ef8Ab3eb30D62e04dbe8A804d232573AA1fe5
19444
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc
23186
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x25e996ce8b3529885D429241156e83e7b7744049
23186
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2
23186
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xBb11A21267cFDb63d4935d99a499133DD1744ACb
23186
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e
23186
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x8366a39cc670b4001a1121b8f6a443a643e40951
24009
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x8dc178efb8111bb0973dd9d722ebeff267c98f94
6118
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b
3531
$ cast codesize --rpc-url $FORK_RPC --block 78327113 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1
2282
$ cast keccak $(cast code --rpc-url $FORK_RPC --block 78327113 0x0000000071727De22E5E9d8BAf0edAc6f37da032)
0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58
$ cast keccak $(cast code --rpc-url $FORK_RPC --block 78327113 0x000000000022D473030F116dDEE9F6B43aC78BA3)
0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca
$ cast keccak $(cast code --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064)
0xbcc90f2d6dada5b18e155c17a1c0a55920aae94f39857d39d0d8ed07ae8f228b
$ cast code --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064
0xfe
$ cast call --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064 'arbChainID()(uint256)'
4663
$ cast call --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064 'arbBlockNumber()(uint256)'
78327113 [7.832e7]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x0000000000000000000000000000000000000064 'arbOSVersion()(uint256)'
116
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'name()(string)'
"Global Dollar"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'symbol()(string)'
"USDG"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'decimals()(uint8)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'totalSupply()(uint256)'
700131297813141 [7.001e14]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'DOMAIN_SEPARATOR()(bytes32)'
0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'PERMIT_TYPEHASH()(bytes32)'
0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'defaultAdmin()(address)'
0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'defaultAdminDelay()(uint48)'
10800 [1.08e4]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'owner()(address)'
0xcFA0388f5ddf905FdC08c45c716C15Dc10A14C6F
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'supplyControl()(address)'
0xdf5FfF9cb88B3cAb50572FAE73E2EB08599D25D4
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'globalTransferSettings()(uint40,uint32,bool,bytes10,bool)'
1771891200 [1.771e9]
86400 [8.64e4]
false
0x00000000000000000000
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'EIP712_VERSION_PREFIX()(bytes2)'
0x1901
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'nonces(address)(uint256)' 0x000000000000000000000000000000000000dEaD
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'isFrozen(address)(bool)' 0x000000000000000000000000000000000000dEaD
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'isFrozen(address)(bool)' 0xe23e8C58371468A98206f07b571cF7E6194abBc1
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'isFrozen(address)(bool)' 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'isFrozen(address)(bool)' 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xd505accf
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x9fd5a6cf
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x7ecebe00
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x30adf81f
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x5c975abb
0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xe5839836
0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x8d1fdf2f
0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x45c8b1a6
0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xe3ee160e
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xef55bec6
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0x8456cb59
0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x00000000000000000000000068184c449e1a8f34fa18d289737129fd27b66f8f
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'name()(string)'
"SPDR S&P 500 ETF Trust • Robinhood Token"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'symbol()(string)'
"SPY"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'decimals()(uint8)'
18
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'totalSupply()(uint256)'
30555281925040000000000 [3.055e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uid()(bytes32)'
0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'tokenPaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uiMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'newUIMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'effectiveAt()(uint256)'
1789690233 [1.789e9]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'ACCESS_CONTROLLED_REGISTRY()(address)'
0xe10b6f6B275de231345c20D14Ab812db62151b00
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'DOMAIN_SEPARATOR()(bytes32)'
0x9664225da5421089c71fcde532a8a45100a788b0adc7c45dbb4fe72320cfb527
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'terms()(string)'
"https://robinhood.com/stocktoken/rhj"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'totalSupplyUI()(uint256)'
30607775630117941299356 [3.06e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'supportsInterface(bytes4)(bool)' 0xa60bf13d
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'supportsInterface(bytes4)(bool)' 0x4bd27648
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'supportsInterface(bytes4)(bool)' 0xd890fd71
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'supportsInterface(bytes4)(bool)' 0x57854fc3
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'supportsInterface(bytes4)(bool)' 0x01ffc9a7
true
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
0x000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b00
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast storage --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'name()(string)'
"Invesco QQQ • Robinhood Token"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'symbol()(string)'
"QQQ"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'decimals()(uint8)'
18
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'totalSupply()(uint256)'
6334407202940000000000 [6.334e21]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uid()(bytes32)'
0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'tokenPaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uiMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'newUIMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'effectiveAt()(uint256)'
1790035834 [1.79e9]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'ACCESS_CONTROLLED_REGISTRY()(address)'
0xe10b6f6B275de231345c20D14Ab812db62151b00
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'DOMAIN_SEPARATOR()(bytes32)'
0x0d742aa0bc660a58e10d0b613abeb775e4c6ce80c31919e718f74190a6eed95e
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'terms()(string)'
"https://robinhood.com/stocktoken/rhj"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'totalSupplyUI()(uint256)'
6338846300027315788488 [6.338e21]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'supportsInterface(bytes4)(bool)' 0xa60bf13d
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'supportsInterface(bytes4)(bool)' 0x4bd27648
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'supportsInterface(bytes4)(bool)' 0xd890fd71
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'supportsInterface(bytes4)(bool)' 0x57854fc3
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'supportsInterface(bytes4)(bool)' 0x01ffc9a7
true
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
0x000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b00
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'name()(string)'
"NVIDIA • Robinhood Token"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'symbol()(string)'
"NVDA"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'decimals()(uint8)'
18
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'totalSupply()(uint256)'
74618653287110000000000 [7.461e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uid()(bytes32)'
0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'tokenPaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uiMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'newUIMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'effectiveAt()(uint256)'
1788998430 [1.788e9]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'ACCESS_CONTROLLED_REGISTRY()(address)'
0xe10b6f6B275de231345c20D14Ab812db62151b00
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'DOMAIN_SEPARATOR()(bytes32)'
0x9561b23bbb0b6a2c7eecb765b6ae196568c31251e7086d435234d3017abcf6f7
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'terms()(string)'
"https://robinhood.com/stocktoken/rhj"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'totalSupplyUI()(uint256)'
74676494620057896189245 [7.467e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'supportsInterface(bytes4)(bool)' 0xa60bf13d
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'supportsInterface(bytes4)(bool)' 0x4bd27648
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'supportsInterface(bytes4)(bool)' 0xd890fd71
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'supportsInterface(bytes4)(bool)' 0x57854fc3
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'supportsInterface(bytes4)(bool)' 0x01ffc9a7
true
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
0x000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b00
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'name()(string)'
"Apple • Robinhood Token"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'symbol()(string)'
"AAPL"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'decimals()(uint8)'
18
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'totalSupply()(uint256)'
16309446327630000000000 [1.63e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uid()(bytes32)'
0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'tokenPaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'newUIMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'effectiveAt()(uint256)'
1786720366 [1.786e9]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'ACCESS_CONTROLLED_REGISTRY()(address)'
0xe10b6f6B275de231345c20D14Ab812db62151b00
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'DOMAIN_SEPARATOR()(bytes32)'
0xddc20599e9f8b3f5f24eea08e26e58b564138e2a2a0dbd21bf8374048ebf4424
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'terms()(string)'
"https://robinhood.com/stocktoken/rhj"
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'totalSupplyUI()(uint256)'
16318678780003528596366 [1.631e22]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'supportsInterface(bytes4)(bool)' 0xa60bf13d
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'supportsInterface(bytes4)(bool)' 0x4bd27648
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'supportsInterface(bytes4)(bool)' 0xd890fd71
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'supportsInterface(bytes4)(bool)' 0x57854fc3
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'supportsInterface(bytes4)(bool)' 0x01ffc9a7
true
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50
0x000000000000000000000000e10b6f6b275de231345c20d14ab812db62151b00
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast storage --rpc-url $FORK_RPC --block 78327113 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])'
0x0f
"SPDR S&P 500 ETF Trust • Robinhood Token"
"1"
4663
0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
0x0000000000000000000000000000000000000000000000000000000000000000
[]
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'implementation()(address)'
0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0x000000000000000000000000000000000000dEaD
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0xe23e8C58371468A98206f07b571cF7E6194abBc1
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0xCaf681a66D020601342297493863E78C959E5cb2
false
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'DEFAULT_ADMIN_ROLE()(bytes32)'
0x0000000000000000000000000000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0xe10b6f6B275de231345c20D14Ab812db62151b00 'supportsInterface(bytes4)(bool)' 0x7965db0b
true
$ cast call --rpc-url $FORK_RPC --block 78327113 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2 'ACCESS_CONTROLLED_REGISTRY()(address)'
0xe10b6f6B275de231345c20D14Ab812db62151b00
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'decimals()(uint8)'
8
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'description()(string)'
"RHSPY / USD"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'version()(uint256)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551770 [1.844e19]
77071210575 [7.707e10]
1790944226 [1.79e9]
1790944238 [1.79e9]
18446744073709551770 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'aggregator()(address)'
0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc
$ cast call --rpc-url $FORK_RPC --block 78327113 0x319724394D3A0e3669269846abE664Cd621f9f6A 'phaseId()(uint16)'
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'decimals()(uint8)'
8
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'description()(string)'
"Robinhood QQQ / USD"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'version()(uint256)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552017 [1.844e19]
75199912534 [7.519e10]
1790945820 [1.79e9]
1790945832 [1.79e9]
18446744073709552017 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'aggregator()(address)'
0x25e996ce8b3529885D429241156e83e7b7744049
$ cast call --rpc-url $FORK_RPC --block 78327113 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'phaseId()(uint16)'
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'decimals()(uint8)'
8
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'description()(string)'
"RHNVDA / USD"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'version()(uint256)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552775 [1.844e19]
23625799569 [2.362e10]
1790953397 [1.79e9]
1790953409 [1.79e9]
18446744073709552775 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'aggregator()(address)'
0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2
$ cast call --rpc-url $FORK_RPC --block 78327113 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'phaseId()(uint16)'
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'decimals()(uint8)'
8
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'description()(string)'
"Robinhood AAPL / USD"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'version()(uint256)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552314 [1.844e19]
33388329774 [3.338e10]
1790950135 [1.79e9]
1790950147 [1.79e9]
18446744073709552314 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'aggregator()(address)'
0xBb11A21267cFDb63d4935d99a499133DD1744ACb
$ cast call --rpc-url $FORK_RPC --block 78327113 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'phaseId()(uint16)'
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'decimals()(uint8)'
8
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'description()(string)'
"USDG / USD"
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'version()(uint256)'
6
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551735 [1.844e19]
100001038 [1e8]
1790869136 [1.79e9]
1790869148 [1.79e9]
18446744073709551735 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'aggregator()(address)'
0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e
$ cast call --rpc-url $FORK_RPC --block 78327113 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'phaseId()(uint16)'
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0xCaf681a66D020601342297493863E78C959E5cb2 'factory()(address)'
0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
$ cast call --rpc-url $FORK_RPC --block 78327113 0xCaf681a66D020601342297493863E78C959E5cb2 'WETH9()(address)'
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
$ cast call --rpc-url $FORK_RPC --block 78327113 0xCaf681a66D020601342297493863E78C959E5cb2 'factoryV2()(address)'
0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f
$ cast call --rpc-url $FORK_RPC --block 78327113 0xCaf681a66D020601342297493863E78C959E5cb2 'positionManager()(address)'
0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3
$ cast call --rpc-url $FORK_RPC --block 78327113 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'factory()(address)'
0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
$ cast call --rpc-url $FORK_RPC --block 78327113 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'WETH9()(address)'
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'owner()(address)'
0x05C420bC4823e039AA4dA645eDde743486dAAA25
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 100
1
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 200
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 300
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 400
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 500
10
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 2500
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 3000
60
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' 10000
200
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 100
0x62FDE201C424d6d07730B77450Dd73928EBAc5f5
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 500
0xa7Bb1AC63BBaB0C44316E6c8C455213441689167
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 3000
0xA43b424Bc609495AED4BCD88d654934b510B0aD9
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 10000
0x0000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 100
0x4539019B527211998642fEC342C85dcB44c7e5E4
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 500
0xD60A5d14dB690B7Afad71F76B108071D7175597d
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 3000
0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 10000
0x0000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 100
0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 500
0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 3000
0xB944cec30Bd4175855215D767ADC81F39e5f7E2B
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 10000
0xc277560DF3689A401bA7deDd7626168b234Ceb5e
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 100
0x0000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 500
0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 3000
0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed
$ cast call --rpc-url $FORK_RPC --block 78327113 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 10000
0x3714aa8105DE1f384481B425788Af413748C1837
$ cast call --rpc-url $FORK_RPC --block 78327113 0x000000000022D473030F116dDEE9F6B43aC78BA3 'DOMAIN_SEPARATOR()(bytes32)'
0x448684463b1f7965c1ec7c249cee11520df24c07242efc2b20f6e54c85614fad
$ cast call --rpc-url $FORK_RPC --block 78327113 0x0000000071727De22E5E9d8BAf0edAc6f37da032 'getNonce(address,uint192)(uint256)' 0x000000000000000000000000000000000000dEaD 0
0
$ cast call --rpc-url $FORK_RPC --block 78327113 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 'owner()(address)'
0x060595638692de6CCd47ca04094F1772D3D39728
$ cast call --rpc-url $FORK_RPC --block 78327113 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 'feeRecipient()(address)'
0x0000000000000000000000000000000000000000
$ cast call --rpc-url $FORK_RPC --block 78327113 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 'DOMAIN_SEPARATOR()(bytes32)'
0xdec2c0a13cb9b2c7a749851d2692c8fd3a7941bf77148fced920e78c99a5fba0
```

### B.2 Cross-check, $ROBINHOOD_RPC at block 78345922

```
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
170
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x0000000071727De22E5E9d8BAf0edAc6f37da032
16035
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x000000000022D473030F116dDEE9F6B43aC78BA3
9152
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x0000000000000000000000000000000000000064
1
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0xCaf681a66D020601342297493863E78C959E5cb2
24497
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
24535
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7
8273
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x204FAca1764B154221e35c0d20aBb3c525710498
24380
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
15582
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C
283
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x319724394D3A0e3669269846abE664Cd621f9f6A
9571
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68
283
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x80901d846d5D7B030F26B480776EE3b29374C2ae
9571
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC
283
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15
9571
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9
283
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0
9571
$ cast codesize --rpc-url $ROBINHOOD_RPC --block 78345922 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2
9571
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x0000000000000000000000000000000000000064 'arbChainID()(uint256)'
4663
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x0000000000000000000000000000000000000064 'arbBlockNumber()(uint256)'
78345922 [7.834e7]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'name()(string)'
"Global Dollar"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'symbol()(string)'
"USDG"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'decimals()(uint8)'
6
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'decimals()(uint8)'
18
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uid()(bytes32)'
0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'oraclePaused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uiMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'newUIMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'effectiveAt()(uint256)'
1789690233 [1.789e9]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'decimals()(uint8)'
18
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uid()(bytes32)'
0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'oraclePaused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uiMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'newUIMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'effectiveAt()(uint256)'
1790035834 [1.79e9]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'decimals()(uint8)'
18
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uid()(bytes32)'
0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'oraclePaused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uiMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'newUIMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'effectiveAt()(uint256)'
1788998430 [1.788e9]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'decimals()(uint8)'
18
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uid()(bytes32)'
0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'oraclePaused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'newUIMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'effectiveAt()(uint256)'
1786720366 [1.786e9]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xe10b6f6B275de231345c20D14Ab812db62151b00 'implementation()(address)'
0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xe10b6f6B275de231345c20D14Ab812db62151b00 'paused()(bool)'
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xe10b6f6B275de231345c20D14Ab812db62151b00 'isBlocked(address)(bool)' 0x000000000000000000000000000000000000dEaD
false
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x319724394D3A0e3669269846abE664Cd621f9f6A 'decimals()(uint8)'
8
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x319724394D3A0e3669269846abE664Cd621f9f6A 'description()(string)'
"RHSPY / USD"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x319724394D3A0e3669269846abE664Cd621f9f6A 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551770 [1.844e19]
77071210575 [7.707e10]
1790944226 [1.79e9]
1790944238 [1.79e9]
18446744073709551770 [1.844e19]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'decimals()(uint8)'
8
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'description()(string)'
"Robinhood QQQ / USD"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552017 [1.844e19]
75199912534 [7.519e10]
1790945820 [1.79e9]
1790945832 [1.79e9]
18446744073709552017 [1.844e19]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'decimals()(uint8)'
8
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'description()(string)'
"RHNVDA / USD"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552776 [1.844e19]
23507207713 [2.35e10]
1790954207 [1.79e9]
1790954220 [1.79e9]
18446744073709552776 [1.844e19]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'decimals()(uint8)'
8
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'description()(string)'
"Robinhood AAPL / USD"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552315 [1.844e19]
33210088933 [3.321e10]
1790953796 [1.79e9]
1790953808 [1.79e9]
18446744073709552315 [1.844e19]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'decimals()(uint8)'
8
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'description()(string)'
"USDG / USD"
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551736 [1.844e19]
100005000 [1e8]
1790955562 [1.79e9]
1790955574 [1.79e9]
18446744073709551736 [1.844e19]
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xCaf681a66D020601342297493863E78C959E5cb2 'factory()(address)'
0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0xCaf681a66D020601342297493863E78C959E5cb2 'WETH9()(address)'
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'factory()(address)'
0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'owner()(address)'
0x05C420bC4823e039AA4dA645eDde743486dAAA25
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x0000000071727De22E5E9d8BAf0edAc6f37da032 'getNonce(address,uint192)(uint256)' 0x000000000000000000000000000000000000dEaD 0
0
$ cast call --rpc-url $ROBINHOOD_RPC --block 78345922 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 'owner()(address)'
0x060595638692de6CCd47ca04094F1772D3D39728
```

### B.3 D-008 fork block 78312136 (Friday 2 Oct 2026 10:44 EDT)

```
$ cast block 78312136 --rpc-url $FORK_RPC -f timestamp
1790952266
$ cast call --rpc-url $FORK_RPC --block 78312136 0x319724394D3A0e3669269846abE664Cd621f9f6A 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551770 [1.844e19]
77071210575 [7.707e10]
1790944226 [1.79e9]
1790944238 [1.79e9]
18446744073709551770 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552017 [1.844e19]
75199912534 [7.519e10]
1790945820 [1.79e9]
1790945832 [1.79e9]
18446744073709552017 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552774 [1.844e19]
23755399953 [2.375e10]
1790948699 [1.79e9]
1790948711 [1.79e9]
18446744073709552774 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552314 [1.844e19]
33388329774 [3.338e10]
1790950135 [1.79e9]
1790950147 [1.79e9]
18446744073709552314 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551735 [1.844e19]
100001038 [1e8]
1790869136 [1.79e9]
1790869148 [1.79e9]
18446744073709551735 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uiMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'newUIMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'effectiveAt()(uint256)'
1789690233 [1.789e9]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uiMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'newUIMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'effectiveAt()(uint256)'
1790035834 [1.79e9]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uiMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'newUIMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'effectiveAt()(uint256)'
1788998430 [1.788e9]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'newUIMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'effectiveAt()(uint256)'
1786720366 [1.786e9]
$ cast call --rpc-url $FORK_RPC --block 78312136 0xe10b6f6B275de231345c20D14Ab812db62151b00 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 78312136 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'paused()(bool)'
false
```

### B.4 D-008 fork block 73280794 (Saturday 26 Sep 2026 14:00 EDT)

```
$ cast block 73280794 --rpc-url $FORK_RPC -f timestamp
1790445600
$ cast call --rpc-url $FORK_RPC --block 73280794 0x319724394D3A0e3669269846abE664Cd621f9f6A 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551762 [1.844e19]
77232802713 [7.723e10]
1790352168 [1.79e9]
1790352180 [1.79e9]
18446744073709551762 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551992 [1.844e19]
74535972577 [7.453e10]
1790352203 [1.79e9]
1790352215 [1.79e9]
18446744073709551992 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552722 [1.844e19]
22566018707 [2.256e10]
1790366153 [1.79e9]
1790366165 [1.79e9]
18446744073709552722 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709552287 [1.844e19]
34145318048 [3.414e10]
1790365752 [1.79e9]
1790365765 [1.79e9]
18446744073709552287 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
18446744073709551730 [1.844e19]
99992581 [9.999e7]
1790437058 [1.79e9]
1790437071 [1.79e9]
18446744073709551730 [1.844e19]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'uiMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'newUIMultiplier()(uint256)'
1001717991187472003 [1.001e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'effectiveAt()(uint256)'
1789690233 [1.789e9]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'uiMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'newUIMultiplier()(uint256)'
1000700791241405425 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 'effectiveAt()(uint256)'
1790035834 [1.79e9]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'uiMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'newUIMultiplier()(uint256)'
1000775159164630595 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'effectiveAt()(uint256)'
1788998430 [1.788e9]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'oraclePaused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'newUIMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'effectiveAt()(uint256)'
1786720366 [1.786e9]
$ cast call --rpc-url $FORK_RPC --block 73280794 0xe10b6f6B275de231345c20D14Ab812db62151b00 'paused()(bool)'
false
$ cast call --rpc-url $FORK_RPC --block 73280794 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'paused()(bool)'
false
```
