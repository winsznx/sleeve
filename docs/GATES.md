# Gates

Status words follow PRD section 22, which uses OPEN, PARTIAL and RESOLVED and defines RESOLVED: an official source, or two independent sources, agree. PASSED, used for G6, means the gate's own test ran and passed. PARTIAL means part of the question is answered and the rest is the next action. OPEN means the question has no answer yet. Times are UTC. The raw commands and outputs behind G1 to G5, G7 and G8 are in docs/research/gates-checks.md. Every check was read only. No transaction was signed or sent and nothing was spent. An accuracy review between 08:20 and 08:45 UTC on 3 October 2026 read a sample of the G1 to G5, G7 and G8 values again and every one matched (docs/research/gates-checks.md section 8).

| Gate | Status | Checked | Block or retrieval | Finding |
| --- | --- | --- | --- | --- |
| G1 Morpho market lending USDG against a launch ticker | PARTIAL | 3 October 2026 | 78,653,690 | 47 Morpho Blue markets lend USDG against the SPY, QQQ, NVDA or AAPL Stock Token. 19 have supply, and 4 hold more than 1,000 USDG. None has been vetted. Borrow stays gated. |
| G2 Arbitrum One USDC or USDT to USDG on Robinhood Chain with a destination call | PARTIAL | 3 October 2026 | Relay API, 00:26:29Z to 00:28:37Z | Relay quotes both routes and accepts a destination call on Robinhood Chain. Nothing was sent. The cross-chain pay link stays gated. |
| G3 Onchain asset registry | PARTIAL | 3 October 2026 | 78,660,590 | Each token's uid() equals its id in the issuer's assets API. No registry contract address is published. |
| G4 Feeds and heartbeats | RESOLVED, verify at deploy | 3 October 2026 | 78,660,590 | Five feeds with 8 decimals, an 86,400-second heartbeat and a 0.5 percent threshold. Chainlink's directory is unchanged since 2 October. |
| G5 Router and pools | RESOLVED, verify at deploy | 3 October 2026 | 78,660,590 | The five v3 pools in D-010 are still the factory's pools and all hold liquidity. |
| G6 AA stack | PASSED | 2 October 2026 | 78,312,136 | Kernel v3.1 with EntryPoint v0.7. Accounting mode WRAPPED. |
| G7 USDG decimals and permit | RESOLVED, verify at deploy | 3 October 2026 | 78,660,590 | 6 decimals. The EIP-2612 permit works, served by a facet with unverified bytecode. |
| G8 Data Streams on Robinhood Chain | OPEN, optional | 3 October 2026 | Docs read 00:38Z to 00:40:10Z | Access needs Chainlink credentials, and Sleeve has none. |

## G1 Morpho market lending USDG against a launch ticker

Date: 3 October 2026.

Blocks: CreateMarket logs from block 286, the Morpho Blue deploy block, to block 78,652,671, the public RPC's latest block at 00:15:53Z. Market state at block 78,653,690 (2026-10-03T00:17:33Z, hash 0x93da8440b1e9a7b1d7a0dfd699a5a06865479e9bed563319c1f8cd65e01277a7).

Status: PARTIAL. 47 markets lend USDG against a launch Stock Token, at least one for each ticker. 19 of them have supply, and 4 hold more than 1,000 USDG. No market has been vetted or chosen. Borrow stays gated. It is not built in M0 and is never described as live.

Deploy block. Morpho Blue 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 has no code at block 285 and 15,582 bytes at block 286 (`cast codesize --rpc-url https://robinhood.drpc.org --block 285` and `--block 286`). Its constructor event and first configuration events are in transaction 0xe1927e1ab342ba2ce16b2e2796745741fac71fc7db70011f9710a45b64f74d20, the block's only transaction outside the system address 0x00000000000000000000000000000000000a4b05, and Sourcify records the same deploy block (docs/research/chain-constants.md Appendix A.7).

Scan, on https://rpc.mainnet.chain.robinhood.com with one address and one topic per request:

```
RPC=https://rpc.mainnet.chain.robinhood.com
MORPHO=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
TOPIC=$(cast sig-event 'CreateMarket(bytes32 indexed id, (address,address,address,address,uint256) marketParams)')
END=78652671
for from in 286 10000286 20000286 30000286 40000286 50000286 60000286 70000286; do
  to=$((from + 9999999)); [ $to -gt $END ] && to=$END
  cast logs --rpc-url $RPC --address $MORPHO --from-block $from --to-block $to $TOPIC --json > createmarket_$from.json
  sleep 2
done
```

Result: 305 CreateMarket events between blocks 287 and 78,294,333, with 305 distinct ids. For every event, keccak256 of the decoded (loanToken, collateralToken, oracle, irm, lltv) equals the indexed id. 47 markets have USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 as loan token and the SPY, QQQ, NVDA or AAPL Stock Token as collateral: 11 for SPY, 6 for QQQ, 15 for NVDA and 15 for AAPL. All 47 use the IRM at 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1, a verified AdaptiveCurveIrm (chain-constants.md Appendix A.7).

Supply. `market(id)` and `idToMarketParams(id)` for the 47 markets, read through Multicall3 at block 78,653,690 on the public RPC and again on https://robinhood.drpc.org. Both providers returned the same value in every field, and every `idToMarketParams` equals the decoded event. The PRD's command for the deepest market, at the pinned block:

```
cast call --rpc-url https://robinhood.drpc.org --block 78653690 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 \
  'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' \
  0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e | awk '{print $1}' | tr '\n' ' '
623355491337 621571719005195024 613930491337 611978497939891963 1790963757 0
```

The six values are totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate and fee. Morpho stores the totals at lastUpdate, so interest accrued after that is not in them.

| # | Collateral | Market id | LLTV | Supply, USDG | Borrow, USDG |
| --- | --- | --- | --- | ---: | ---: |
| 1 | SPY | 0xc000f9a159a0701664cbebb99dc746f8c456e92fc720e797bd445124704c009d | 77% | 0.000000 | 0.000000 |
| 2 | SPY | 0x50bc39b5722fb5634c436d74c6787f3c125b879e7b73cf9e9ecc01bbb57b8e55 | 62.5% | 11,228.949922 | 4,742.724727 |
| 3 | SPY | 0xe4f745e6620e169ee2664111e61e448d2e0d58ea0129fd5fb0db940f5e0f801b | 86% | 0.001000 | 0.000000 |
| 4 | SPY | 0xc78a7b86f102a8a5ead69355beecaa20f726de9530c6fe193429bd4ee29300f6 | 86% | 0.000001 | 0.000000 |
| 5 | SPY | 0xc40e93b78f25c887d184c4f5c8797db157752f79948a6a51d747147a22531e9b | 62.5% | 0.000000 | 0.000000 |
| 6 | SPY | 0x90b439eeec826e243629556331f016ad85cb3addf558c0bff76f3a52b3266545 | 77% | 0.000000 | 0.000000 |
| 7 | SPY | 0x077088f9ae5f5c1d35439ee68f4bdbb176368a1a73fd4c8cb8e004143d0c5c30 | 77% | 33.334276 | 0.000942 |
| 8 | SPY | 0x34e22aabcc39112dafb870cd7626a3d7f6ebdfbb3436eba34c23e4f26604b783 | 62.5% | 0.000000 | 0.000000 |
| 9 | SPY | 0xf95832e36d9d8baf35eb78ce80cbed92d20198ba639659b3f9a2ab00ced0a0c1 | 62.5% | 0.000000 | 0.000000 |
| 10 | SPY | 0x1c20e013bc6bf7e356a3b7fe0ed8a92deecce8e56680900d32e466a86f356b15 | 62.5% | 0.000000 | 0.000000 |
| 11 | SPY | 0x9c54e02182f7d53d062675674bdab30aa01bf8e4616838ee8fc2f6acccb05401 | 62.5% | 0.000000 | 0.000000 |
| 12 | QQQ | 0x3d487a03ed905fd38ccd80ada05730f3ea7745e7dd51c08fdeb4bb0f45c3c0cb | 77% | 0.000000 | 0.000000 |
| 13 | QQQ | 0x315b99abb698487891243a84afd28a5ff56fe02143f203c03edd3f103936bf60 | 62.5% | 10.000950 | 0.000000 |
| 14 | QQQ | 0xb6befab1632196d5c55ccf320cca0e56f6331548ace2bd8ae11b5130d7db52c5 | 62.5% | 0.000000 | 0.000000 |
| 15 | QQQ | 0xdcb03716ad496e58390fb5c5d8b1f0a196f0b923482f17a3c231390a39e9fb67 | 62.5% | 0.000000 | 0.000000 |
| 16 | QQQ | 0x1b8b34fd794924dcbd8c92f5efc54ccb1e977ad4ff2386f7be6d4d26a2fbdecb | 62.5% | 0.000000 | 0.000000 |
| 17 | QQQ | 0xad21de31ad13b7c221565206b10490864f2be1fd0514523ae56bd6575a616d23 | 62.5% | 0.000000 | 0.000000 |
| 18 | NVDA | 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc | 62.5% | 6,578.772161 | 31.313085 |
| 19 | NVDA | 0x3ce44383b860237d3a78a88caf9edcbec36b040d7be2998ef8222eec8719bd48 | 86% | 0.001000 | 0.000000 |
| 20 | NVDA | 0xba2956531697f0c0b0b9db7b2d3148581ae69610c136287ba84bf519621a22dd | 86% | 0.000000 | 0.000000 |
| 21 | NVDA | 0xb74600c27a3424eac0a9288f539d5165a125a5102d08b5313c303e29c0eaf8bf | 62.5% | 0.000000 | 0.000000 |
| 22 | NVDA | 0xd780a699a2022b90fd14e89b61523e6b6b6fdd3833158fcb701b878a5902255f | 77% | 0.000000 | 0.000000 |
| 23 | NVDA | 0x21539fb91cac5c218508f89d6bd946eabaeed3b4ff185e802bbb73c2f77c25de | 77% | 0.000000 | 0.000000 |
| 24 | NVDA | 0xbe3a53552a5600381ca1d858cc425a2601becbd77c43c753698890a22adbbb0d | 38.5% | 100.000000 | 0.000000 |
| 25 | NVDA | 0xf54d700dd3fe889872bfc868788de849e8a5b1adfd73bb3d983c8e264e970604 | 38.5% | 0.000000 | 0.000000 |
| 26 | NVDA | 0x639f19732ce4cd54b9f3509f3acee6e8d5d20ff5e75b7c94c20808f48196d826 | 62.5% | 0.500004 | 0.040002 |
| 27 | NVDA | 0x3ac6e757d6d8ac808dc7f00a389b07b18645d3cbd198a353e6b877194ddda6dc | 62.5% | 0.000000 | 0.000000 |
| 28 | NVDA | 0x95312f02c1dae8407b2c80468a5657a9bd19c45ac277f1a61aa52c11444c5314 | 62.5% | 2.002371 | 0.911371 |
| 29 | NVDA | 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e | 62.5% | 623,355.491337 | 613,930.491337 |
| 30 | NVDA | 0xdb33e1291a096be5b9c52aeefec7c8b46cd349d3b8294fcac80bb02b7e2bf5fe | 62.5% | 0.000000 | 0.000000 |
| 31 | NVDA | 0xf5ff7d546af5e72f3912d2aa723088fd0bf66fddc158714995637714d9db6e4c | 62.5% | 0.001100 | 0.001000 |
| 32 | NVDA | 0x1484485e9ebcd3c5b70c18ab30369ace2a2807e36962fd46f6c19be79a84a2c4 | 77% | 0.000000 | 0.000000 |
| 33 | AAPL | 0x0d6e009807341aae5d0ccc3fbdc506fce77012603e96aec3fc44785942e7cf65 | 62.5% | 0.000002 | 0.000000 |
| 34 | AAPL | 0xd621b5373890ce0be9b20ca17a75c57944e8dbb997172fd61e1ea48af63fad96 | 86% | 0.001001 | 0.000000 |
| 35 | AAPL | 0x01ab931866f6753d9246d451284c03d2b9cdf7f351120bc2e79045941777e7aa | 86% | 0.085386 | 0.076847 |
| 36 | AAPL | 0x63c71d3a1afd71c674be55f07a27ad783edf20d63372111ae5b2e7162963b7ac | 62.5% | 0.000000 | 0.000000 |
| 37 | AAPL | 0x30a2a5f1a098b23ed91eadc4529a8d1c967f2cdc2e40a709f3a5992004b01ac0 | 62.5% | 25.000771 | 0.000000 |
| 38 | AAPL | 0xe3813a231ef3c073d21615ab0a8788ebfae23e95e7e5571880c7619d5b05f404 | 77% | 0.000000 | 0.000000 |
| 39 | AAPL | 0x6641d1333a00edf42f79b931554f1c81971656f18d881245f9547b471d5a49fb | 77% | 0.000000 | 0.000000 |
| 40 | AAPL | 0x3b788195cc0f5eb987e14d91d9b8875cf742c55faf9822ae25701f71a3ed7133 | 38.5% | 0.000000 | 0.000000 |
| 41 | AAPL | 0x349f46c4c49ff76074e27a21fe49fd86511b06c764a6d46589ced02a40dc40d2 | 62.5% | 0.000000 | 0.000000 |
| 42 | AAPL | 0x947ae981cc823024ea00b602f6ea72d049cac05d66ef096198ceeb998651c175 | 62.5% | 1.001000 | 0.910000 |
| 43 | AAPL | 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45 | 62.5% | 197,198.740295 | 197,174.571120 |
| 44 | AAPL | 0x47baa250d10b6969d3177dfac9b1235f1fb32e35a0d52609d438c800bf3f09da | 62.5% | 0.000000 | 0.000000 |
| 45 | AAPL | 0xcaa167af7ba0422c76424fae56167b7db25bf19f4f435215e6dd7d06a943bdac | 62.5% | 0.001100 | 0.001000 |
| 46 | AAPL | 0x516829adb04c8351c09747755eed21f4514370e2df11a73c89054fef7de316bc | 62.5% | 0.000000 | 0.000000 |
| 47 | AAPL | 0x3d9b0c04e374f7b50fa7a635393d2ecae23f45289e4e23f83793a6a611010918 | 62.5% | 0.000000 | 0.000000 |

Four markets hold more than 1,000 USDG:

| # | Collateral | Supplied, USDG | Borrowed, USDG | Not borrowed, USDG | Oracle | What `price()` computes |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 29 | NVDA | 623,355.491337 | 613,930.491337 | 9,425.000000 | 0xED29D310cfa91778A5850538DA28ed42234Cb78c | NVDA feed times `uiMultiplier()`, over USDG/USD |
| 43 | AAPL | 197,198.740295 | 197,174.571120 | 24.169175 | 0xD625d488D552775D2867194C618B945E5dDfE097 | AAPL feed times `uiMultiplier()`, over USDG/USD |
| 2 | SPY | 11,228.949922 | 4,742.724727 | 6,486.225195 | 0xe8dAb19184f72b5a5a9d51A6C50A1b04b0669ce7 | SPY feed's SVR proxy, over USDG/USD |
| 18 | NVDA | 6,578.772161 | 31.313085 | 6,547.459076 | 0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a | NVDA feed, over USDG/USD |

QQQ's only market with supply, number 13, holds 10.000950 USDG.

Oracles. The oracles of markets 2 and 18 expose BASE_FEED_1 and QUOTE_FEED_1, and their `price()` equals 10^24 times the feed answer over the USDG/USD answer, exactly. The oracles of markets 29 and 43 have no feed getters and no Sourcify record. Their runtime code holds the ticker's feed, the USDG/USD feed and the `uiMultiplier()` selector, and their `price()` equals the feed answer times `uiMultiplier()` over the USDG/USD answer by exact integer replay at block 78,653,690 (docs/research/gates-checks.md section 1.7). Robinhood's oracle page (https://docs.robinhood.com/chain/oracles-and-price-feeds/, retrieved 2026-10-03T00:23:18Z) says: "The feed returns the price of one token, which is the underlying share price times the multiplier." and "latestRoundData() returns this directly, so you don't apply the multiplier yourself." By that page, the two deepest markets value collateral above the feed by the multiplier, a factor of 1.000775159164630595 for NVDA and 1.000566080061092436 for AAPL at this block.

Reverse direction. 8 markets lend a launch Stock Token against USDG collateral (6 NVDA, 1 SPY, 1 AAPL), and none has supply at block 78,653,690. PRD section 22 recorded a live market lending NVDA against USDG and found no source showing a market that lends USDG against a Stock Token. At this block the chain shows the opposite on both counts.

Next action, for M1 and the owner's decision: vet the candidate markets before any borrow work. The checks are the oracle formula (markets 29 and 43 apply the multiplier to a feed that already includes it), the USDG not yet borrowed (24.169175 in market 43), liquidation while the session is closed and the feed holds its last price, and who supplies the USDG. If no market passes, the PRD's fallback stands: a disclosed team-seeded market, or no borrow. PRD section 22's G1 row needs the owner's update to match these findings.

## G2 Arbitrum One USDC or USDT to USDG on Robinhood Chain with a destination call

Date: 3 October 2026.

Retrieval: Relay's chain list at 00:26:29Z, quotes at 00:26:52Z, 00:27:31Z and 00:28:37Z. Relay's contracts checked on Robinhood Chain at block 78,660,590.

Status: PARTIAL. Relay offers the route and accepts a destination call on Robinhood Chain, in quotes only. Nothing was signed or sent, so no route has run. The cross-chain pay link stays gated, and the M0 path stays a bridge to the Sleeve address followed by the keeper's split.

Endpoint. Relay documents `POST https://api.relay.link/quote/v2` (https://docs.relay.link/references/api/get-quote-v2.md, retrieved 00:25:37Z). Its call guide says: "This works by specifying the transaction data you wish to execute on the destination chain as part of the initial quoting process." (https://docs.relay.link/references/api/api_guides/calling-integration-guide.md). `GET https://api.relay.link/chains` lists chain 4663 as "Robinhood Chain" with deposits enabled and USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 as a bridgeable currency.

Request, 10 USDC (10000000 base units) of Arbitrum One USDC 0xaf88d065e77c8cC2239327C5EDb3A432268e5831, exact input, with a dummy address as user and recipient:

```
curl -sS -X POST https://api.relay.link/quote/v2 -H 'content-type: application/json' --data '{"user":"0x000000000000000000000000000000000000dEaD","recipient":"0x000000000000000000000000000000000000dEaD","originChainId":42161,"destinationChainId":4663,"originCurrency":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","destinationCurrency":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","amount":"10000000","tradeType":"EXACT_INPUT"}'
```

The destination-call request adds `"txs":[{"to":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","value":"0","data":"0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000895440"}]`, a transfer of 9 USDG to the dummy address. A third request uses Arbitrum One USDT 0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9 instead of USDC.

| Response field | USDC | USDC with the call | USDT |
| --- | --- | --- | --- |
| HTTP status | 200 | 200 | 200 |
| Steps, all on Arbitrum One | approve, then deposit to Relay's depository 0x4cd00e387622c35bddb9b4c962c136462338bc31 | same | same, approving USDT |
| USDG out on Robinhood Chain, base units | 9968832 | 9933422 | 9957869 |
| Minimum USDG out | 9769455 | 9734753 | 9758712 |
| Slippage tolerance, bps | 200 | 200 | 200 |
| Relayer fee in origin-token base units (gas plus service) | 29721 (7723 plus 21998) | 65129 (43132 plus 21997) | 29702 (7735 plus 21967) |
| Origin gas, wei | 1680272000000 | 1680608054400 | 1757489861600 |
| Time estimate, seconds | 1 | 1 | 1 |
| Order output pays | the recipient | Relay's erc20Router 0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f | the recipient |
| Order output calls | none | one: target USDG, value 0, the transfer calldata | none |

Relay's erc20Router has 4,720 bytes of code on Robinhood Chain at block 78,660,590.

Next action: with the owner's approval, since it spends, send one small USDC route with a destination call to a test address on Robinhood Chain, confirm the USDG by balance delta through the verifier's RPC, and record the transaction hashes here. Then repeat with a call into a deployed Sleeve account. Until a route has run, Sleeve claims no cross-chain pay link (PRD section 16).

## G3 Onchain asset registry

Date: 3 October 2026.

Block: 78,660,590 (2026-10-03T00:29:09Z, hash 0xbb4b4e0b8c52c5f9268eb0af5b5e386b0b4c9a776ed87e1a3642c337fa929bd4). Retrieval: the issuer's assets API at 00:32:04Z, the contracts page at 00:32:20Z and its code chunk at 00:33:23Z.

Status: PARTIAL, unchanged. Each launch Stock Token's `uid()` equals its id in the issuer's assets API, and the API lists one canonical deployment per asset. No registry contract address is published.

Evidence. The research is docs/research/issuer-docs.md section 3 and docs/research/chain-constants.md section 3. Re-checked:

| Token | Address | `uid()` at block 78,660,590 | Issuer API `id` |
| --- | --- | --- | --- |
| SPY | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1 | same |
| QQQ | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 | 0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed | same |
| NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC | 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5 | same |
| AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 | 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649 | same |

- `cast call --rpc-url https://robinhood.drpc.org --block 78660590 <token> 'uid()(bytes32)'` for each token.
- `curl -sS -H 'accept: application/json' https://api.robinhood.com/rhj/assets` returned 194 assets, all ASSET_STATUS_ACTIVE, each with one deployment. Its sha256, 3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c, equals the copy read on 2 October (chain-constants.md Appendix A.10). The four launch entries list the token addresses above, the same as contracts/test/utils/Chain4663.sol.
- https://docs.robinhood.com/chain/contracts/ says: "The table below is generated live from the on-chain asset registry." The page's code chunk, index-DhgXFtCP.js (sha256 2fd17f26cf6bbc72daa945415b90e51d141893a89ddfba0c30f8aa6beaf3a986), builds that table from https://api.robinhood.com/rhj/assets. The page and the chunk name no contract other than WETH and USDG.

Next action: M0 reads its tickers from the TokenSource mirror (contracts/src/TokenSource.sol), whose admin changes go through the 48-hour SleeveTimelock (D-004, D-018). The owner asks Robinhood's developer channel for the registry contract address.

## G4 Feeds and heartbeats

Date: 3 October 2026.

Block: 78,660,590 on https://rpc.mainnet.chain.robinhood.com, read between 00:29Z and 00:31Z. Chainlink's directory retrieved at 00:31:12Z.

Status: RESOLVED, verify at deploy, unchanged. Chainlink's directory and the chain agree.

Evidence. The research is docs/research/chain-constants.md section 4, at block 78,327,113. Re-checked with the PRD's commands at the pinned block:

```
cast call --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78660590 <feed> 'decimals()(uint8)'
cast call --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78660590 <feed> 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
```

| Feed | Proxy | `decimals()` | Round (phase 1) | Answer | updatedAt | Age at the block, seconds |
| --- | --- | --- | --- | --- | --- | ---: |
| SPY | 0x319724394D3A0e3669269846abE664Cd621f9f6A | 8 | 154 | 77071210575 | 1790944238 (2026-10-02T12:30:38Z) | 43,111 |
| QQQ | 0x80901d846d5D7B030F26B480776EE3b29374C2ae | 8 | 401 | 75199912534 | 1790945832 (2026-10-02T12:57:12Z) | 41,517 |
| NVDA | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | 8 | 1162 | 23499711907 | 1790960852 (2026-10-02T17:07:32Z) | 26,497 |
| AAPL | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 | 8 | 700 | 33382386412 | 1790959180 (2026-10-02T16:39:40Z) | 28,169 |
| USDG/USD | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | 8 | 120 | 100005000 | 1790955574 (2026-10-02T15:39:34Z) | 31,775 |

Chainlink's directory, https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json, has sha256 714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776, the same file read on 2 October. It lists all five proxies with decimals 8, heartbeat 86400 and threshold 0.5, with marketHours "us_equities_24/5" for the four stock feeds and "Crypto" for USDG/USD. Each proxy's `aggregator()` at block 78,660,590 equals the directory's contractAddress. The block falls after the Friday 20:00 New York close, and the SPY and QQQ rounds are the same rounds the 2 October research read.

Next action: verify at deploy. TokenSource's constructor reverts UnexpectedDecimals unless each feed reports 8 decimals (contracts/src/TokenSource.sol), and D-009 Q33 has the deploy script read every deployed value back. Feed age cannot show a closed market, so SessionCalendar stays the session source (D-017).

## G5 Router and pools

Date: 3 October 2026.

Block: 78,660,590, read through https://robinhood.drpc.org.

Status: RESOLVED, verify at deploy. The pools were picked by depth through the v3 factory, with v4 StateView read for comparison (docs/research/pools.md), and recorded in D-010. They join the allowlist when TokenSource is deployed.

Evidence. Depth within 2 percent comes from the research tick walk at block 78,323,256 and was not walked again: SPY 217,986, QQQ 652,371, NVDA 724,558, AAPL 177,114 (fee 500) and AAPL 36,615 (fee 3000) USDG (pools.md "Recommended allowlist"). Also from the research and not re-checked: the pool PRD section 22 cites for G5, 0xae1685599288831eb0844cb59058116ee3184b9a, is a memecoin pool, not NVDA (D-010, pools.md "Mismatches with the PRD"). Re-checked at block 78,660,590 with `getPool(USDG, token, fee)` on the v3 factory 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, `liquidity()`, USDG `balanceOf(pool)` and a 100 USDG `quoteExactInputSingle` on QuoterV2 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7:

| Ticker | Fee | Pool | `getPool` returns the pool | `liquidity()` | USDG held | 100 USDG buys | Premium over the feed, bps |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| SPY | 500 | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | yes | 492723019407771402 | 231,109.002269 | 0.129662084478969058 | +6.79 |
| QQQ | 500 | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | yes | 1200653771262130638 | 714,969.803955 | 0.133292575027853574 | -23.53 |
| NVDA | 500 | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | yes | 19356687274306262182 | 2,247,588.915663 | 0.426073802090257126 | -12.60 |
| AAPL | 500 | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | yes | 521568212096508523 | 152,250.360930 | 0.299738093341331616 | -5.97 |
| AAPL | 3000 | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | yes | 100551201152888351 | 91,206.858311 | 0.299241238389098265 | +10.62 |

The premium uses the feed rounds in the G4 table and the method in pools.md "Method". The session was closed at this block, so the module would have queued instead of buying.

Next action: at deploy these five pools go into TokenSource's constructor, which reverts PoolNotCanonical unless `getPool(USDG, token, fee)` returns the pool, and FeeNotAllowed for a fee other than 100, 500 or 3,000. Run the depth walk again (the reads in pools.md Appendix A and the walk in Appendix C) on the day of the mainnet deploy. v4 pools stay out of M0.

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

## G7 USDG decimals and permit

Date: 3 October 2026.

Block: 78,660,590, read through https://robinhood.drpc.org. The permit replay ran at block 78,327,113, the block of the 2 October research.

Status: RESOLVED, verify at deploy. The chain and the verified implementation agree on 6 decimals. The permit works in simulation, and the facet that serves it has no verified bytecode.

Evidence. The research is docs/research/chain-constants.md section 5 and Appendix A.2. Re-checked on USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168:

| Call | Result |
| --- | --- |
| `decimals()(uint8)` | 6 |
| `getFacet(bytes4)(address)` for the permit selector 0xd505accf | 0x780d30b6a89BC9Eef953a543aA288c3B05b01309, as on 2 October |
| `PERMIT_TYPEHASH()(bytes32)` | 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9, equal to keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)") |
| `DOMAIN_SEPARATOR()(bytes32)` | 0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036, equal to the EIP-712 domain for name "Global Dollar", version "1", chain 4663 and the USDG address |
| EIP-1967 implementation slot | 0x68184C449E1a8f34fA18d289737129FD27B66f8F, still verified on Sourcify as contracts/stablecoins/USDG.sol:USDG. Its `decimals()` returns the constant 6 (source quoted in chain-constants.md section 5). |
| The permit signature committed in chain-constants.md Appendix A.2, replayed with `cast call` at block 78,327,113 | succeeds, empty return data |
| The same signature with value 1000001 | reverts 0x8baa579f, `InvalidSignature()` |

No new signature was made. Sourcify has no record of the permit facet (checked 00:36:37Z), and Blockscout's bytecode database had no match on 2 October (chain-constants.md Appendix A.9). Only an EOA signature has been tested.

Next action: TokenSource's constructor reverts UnexpectedDecimals unless USDG reports 6 decimals at deploy. The M0 top-up runs a USDG permit inside a bracketed owner op (D-014), and no test in contracts/test calls USDG's permit yet. Before the app ships top-up, add a fork test at a pinned block that runs the real facet's permit and transferFrom inside a bracket. Whether to rely on an unverified facet is open question 6 in chain-constants.md section 10.

## G8 Data Streams on Robinhood Chain

Date: 3 October 2026.

Retrieval: Chainlink's docs between 00:38Z and 00:39Z, Robinhood's Data Streams page at 00:40:10Z. The verifier proxy was read at block 78,660,590.

Status: OPEN, optional, unchanged.

Evidence:

- Chainlink's 24/5 US Equities user guide (PRD source S38, https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide): "Market status 5 indicates the market is closed, which includes weekends, public holidays, and unexpected market closures." That is the market status flag PRD section 22 refers to.
- Chainlink's Go SDK tutorial (https://docs.chain.link/data-streams/tutorials/go-sdk-fetch): "Access to Data Streams requires API credentials. If you haven't already, contact us to request mainnet or testnet access." D-003 lists Sleeve's outside accounts, and Chainlink is not one of them.
- Robinhood's Data Streams page (https://docs.robinhood.com/chain/data-streams/) gives the verifier proxy for chain 4663 as 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7. At block 78,660,590 it has 7,009 bytes of code, and `typeAndVersion()` returns "VerifierProxy 2.0.0". The research is docs/research/session-calendar.md section 11.

Next action: the owner asks Chainlink for credentials if Data Streams is wanted. Until then SessionCalendar (contracts/src/libraries/SessionCalendar.sol, D-017) is the session source, and PriceGuard's feed age, fresh-round and `oraclePaused()` checks cover what the calendar cannot see, such as a single symbol stopped for a corporate action (session-calendar.md section 11).

## Mainnet deploy

Date: 3 October 2026, blocks 79,338,287 to 79,338,373 (20:37:55 to 20:38:04 Lagos). Status: PASSED.

Seven transactions from DEPLOYER succeeded (status 1 read from each receipt). The read-back script checked the deployed state through the public RPC and every check passed: code at all seven addresses against commit ca795ff's build with library links, the timelock's delay, roles and event history, the calendar, TokenSource tickers, feeds, session types and pools, and the module's immutables and guard limits. All seven contracts are verified on Sourcify with exact_match for runtime and creation code. Addresses and transactions: docs/DEPLOYMENTS.md and contracts/deployments/4663.json.
