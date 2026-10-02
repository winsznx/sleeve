# G5 pools: Uniswap v3 USDG pools for SPY, QQQ, NVDA and AAPL

Research notes for gate G5, PRD sections 7.4, 13, 14 and 22. Written 2 October 2026 on Robinhood Chain mainnet, chain id 4663. Read only: every number below comes from an eth_call, a log query or a public API. No transaction was sent.

Main snapshot: L2 block 78,323,256, block timestamp 2026-10-02 15:03:03 UTC (11:03 EDT on a Friday, regular US session). Every v3 reading in the per-ticker tables is pinned to that block unless a row says otherwise.

## Recommended allowlist

| Ticker | Role | Pool | Fee | Depth within 2%, USDG (+2% / -2%) | Value held, USDG | Premium at 100 USDG, bps, block 78,323,256 | Pool cost at 100 USDG, bps, block 78,323,256 | Premium, bps, block 78,329,921 | Premium, bps, block 78,312,136 | Premium, bps, block 73,280,794 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SPY | primary | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 500 (0.05%) | 217,986 (86,302 / 131,684) | 358,889 | +20.57 | +5.07 | -2.62 | +35.70 | -4.63 |
| QQQ | primary | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 500 (0.05%) | 652,371 (305,847 / 346,524) | 1,247,131 | +5.37 | +5.03 | -25.49 | +30.96 | -5.37 |
| NVDA | primary | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 500 (0.05%) | 724,558 (264,817 / 459,741) | 2,933,739 | -34.93 | +5.02 | -37.89 | -17.04 | -29.56 |
| AAPL | primary | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 500 (0.05%) | 177,114 (95,829 / 81,285) | 340,031 | -26.08 | +5.11 | -6.30 | +13.41 | -21.59 |
| AAPL | second | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | 3000 (0.30%) | 36,615 (18,152 / 18,463) | 128,467 | +19.16 | +30.63 | not read | +19.16 | +7.93 |

Allowlist entries, in the order token, fee, pool:

```
SPY   0x117cc2133c37B721F49dE2A7a74833232B3B4C0C   500   0xa7Bb1AC63BBaB0C44316E6c8C455213441689167
QQQ   0xD5f3879160bc7c32ebb4dC785F8a4F505888de68   500   0xD60A5d14dB690B7Afad71F76B108071D7175597d
NVDA  0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC   500   0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3
AAPL  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9   500   0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D
AAPL  0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9   3000  0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed
```

Every premium is a 100 USDG buy quoted through QuoterV2, in basis points against the Chainlink feed of the same block. Pool cost is the execution price against the pool's own mid price, which is the pool fee plus price impact. Blocks 78,312,136 and 73,280,794 are the pinned fork blocks from docs/DECISIONS.md D-008.

Why these pools:

- Each fee-500 pool is the deepest v3 USDG pool for its ticker by a wide margin: 177,114 to 724,558 USDG of depth within 2 percent of mid, against at most 36,615 USDG for any other tier.
- The fee is in the pool's fee() field and nothing else takes a cut, because v3 pools have no hooks. At 100 USDG the fee-500 pools cost 5.02 to 5.11 bps over their own mid, so almost all of the 100 bps default premium cap is left for the gap between pool and feed.
- No 1 percent tier. On a fee-10000 pool the fee alone uses the whole 100 bps default cap.
- Every recommended pool had liquidity at both pinned fork blocks, so the component 5 fork tests can use them.
- AAPL is the only ticker with a second pool worth listing. Its fee-3000 pool has more than 10,000 USDG on each side within 2 percent (18,152 up, 18,463 down) and costs about 31 bps at 100 USDG. The SPY fee-3000 pool clears 10,000 USDG only when both sides are added (11,994) and has 5,081 USDG on the buy side, so it stays off.

The premium against the feed moved by as much as 56 bps on the same pool within 30 minutes (QQQ fee-500 pool: +30.96 at 14:44 UTC, +5.37 at 15:03, -25.49 at 15:14). At the three blocks where the mid was also read (78,312,136, 78,323,256 and 73,280,794), the pool cost of every fee-500 pool stayed between 5.00 and 5.11 bps. The moving part is the feed. A stock feed only posts a new round on a 0.5 percent move or at its heartbeat, so between rounds it trails the market by up to about 50 bps (PRD 7.4). At block 78,323,256 the NVDA feed was 4,672 s old, and it posted 236.25799569 at 15:03:29 UTC, 26 s after the snapshot. That round is 54.6 bps below the one used here, so the -34.93 bps reading says more about a stale feed than about a cheap pool.

## Method

Chain and RPC. Reads went to the public RPC https://rpc.mainnet.chain.robinhood.com pinned to block 78,323,256 with `--block`. The public endpoint dropped some TLS connections, and those calls were retried against the archive RPC https://robinhood.drpc.org at the same block. Of 565 calls, 447 were served by the public RPC and 118 by the archive RPC. To replay any reading now, use the archive RPC, because the public one keeps only minutes of state (D-008).

Block check. `cast block 78323256 --json --rpc-url https://rpc.mainnet.chain.robinhood.com` returned number 0x4ab1e38, timestamp 0x6abfc7a7 (1790953383, 2026-10-02 15:03:03 UTC), l1BlockNumber 0x18e563f and hash 0x38a377f12b79a2a744181129c55c87bfc0fbe8a6960048d69481be75a3e5088b. ArbSys at 0x0000000000000000000000000000000000000064, `arbBlockNumber()(uint256)` at that block, returned 78323256, the same L2 number.

Decimals, asserted at runtime: USDG `decimals()` = 6, SPY, QQQ, NVDA and AAPL `decimals()` = 18, every feed `decimals()` = 8, WETH `decimals()` = 18. The analysis script stops if USDG is not 6 or a stock token is not 18.

Mid price. For a pool with token0 = SPY and token1 = USDG, USDG per SPY = (sqrtPriceX96 / 2^96)^2 * 10^(18 - 6). For token0 = USDG and token1 = the stock token, USDG per token = 10^(18 - 6) / (sqrtPriceX96 / 2^96)^2. SPY sorts below USDG, the other three sort above it.

Depth. Depth +2% is the USDG, before the pool fee, that moves the pool's USDG-per-token price from mid up 2 percent. Depth -2% is the USDG the pool pays out, before fee, when sellers push the price down 2 percent. "Depth within 2%" is the sum. Both come from walking initialized ticks: slot0 and liquidity() give the start, and the Uniswap TickLens contract at 0x7dfd4f31be6814d2906bde155c3e1b146eac1468 gives every initialized tick with its liquidityNet in the bitmap words that cover at least 1,000 ticks (about 10.5 percent of price) on each side. The same tick data run through a swap simulation that takes the fee from the input reproduces all 44 QuoterV2 buy quotes on pools with liquidity at the block to a relative error of at most 1.95e-8, with 38 of the 44 under 1e-9. A pool is called thin when its depth within 2 percent is under about 10,000 USDG.

Premium. Execution price = USDG in / tokens out, both from QuoterV2 `quoteExactInputSingle` at 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 with sqrtPriceLimitX96 = 0. Premium in bps = (execution price - feed price) / feed price * 10,000, with the feed price from `latestRoundData()` at the same block over 10^8. Sell-back: the token amount the 100 USDG buy returns is quoted back to USDG through the same pool at the same block, sell price = USDG out / tokens in, discount in bps = (feed price - sell price) / feed price * 10,000. A negative discount means the pool paid more than the feed.

USDG and USD. The USDG/USD feed 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 ("USDG / USD", 8 decimals) returned (18446744073709551735, 100001038, 1790869136, 1790869148, 18446744073709551735) at block 78,323,256: 1.00001038 USD, updated 2026-10-01 15:39:08 UTC, 84,235 s (23.40 h) earlier. Depth and value are reported in USDG and treated as USD.

Protocol fee. slot0 shows feeProtocol 68 on every fee-100 and fee-500 pool and 102 on every fee-3000 and fee-10000 pool. That splits the LP fee with the factory owner and does not change what a swapper pays.

The exact commands are in Appendix A and the raw outputs for every pool are in Appendix B.

## Fee tiers and pool discovery

Enabled tiers. `cast call --block 78323256 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' <fee>` returned:

| Fee | 100 | 200 | 300 | 400 | 500 | 2500 | 3000 | 10000 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tickSpacing | 1 | 0 | 0 | 0 | 10 | 0 | 60 | 200 |

A tickSpacing of 0 means the tier is not enabled. The factory's FeeAmountEnabled logs (topic 0xc66a3fdf07232cdd185febcc6579d408c241b47ae2f9907d84be655141eeaecc), read with `cast logs --address 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA <topic> --from-block <start> --to-block <end> --json` in 9,999,999-block chunks from block 0 to 78,318,107 and one more query from 78,318,107 to 78,338,553 (15:28 UTC), show four events and no others: fee 500 / spacing 10, fee 3000 / spacing 60 and fee 10000 / spacing 200 in tx 0x8add72fbcad4bf7732336de35dcd06b582c1501d0832c4710a30850a7cff8977 at block 8,930, and fee 100 / spacing 1 in tx 0xf1727cf966054123ff97b825d19bb9af769270c02bbe53a04e2ec4f051c6a370 at block 8,931. The highest v3 fee on this chain is therefore 1 percent. The fee tiers up to 95 percent that PRD 7.4 mentions exist only on v4 (see the v4 section).

getPool. `getPool(address,address,uint24)(address)` with USDG first and each stock token second, for all eight fees above, at block 78,323,256, returned 13 non-zero pools: SPY at 100, 500 and 3000, QQQ at 100, 500 and 3000, NVDA at 100, 500, 3000 and 10000, AAPL at 500, 3000 and 10000. Every other combination returned 0x0000000000000000000000000000000000000000.

Cross-check from logs. PoolCreated logs (topic 0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118) from block 0 to 78,318,107, filtered on token0 and then on token1 for USDG and each stock token with `cast rpc eth_getLogs` (Appendix A), return 7,025 pools that include USDG or one of the four tokens. 891 of them include SPY, QQQ, NVDA or AAPL, nearly all paired with unrelated tokens. The USDG pairs among them are the same 13 pools getPool returned, with the same fees. Each pool's factory() returns 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA.

Router and quoter wiring, read at the latest block around 14:55 UTC: SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2 `WETH9()(address)` = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 and `factory()(address)` = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA. QuoterV2 returns the same two addresses for WETH9() and factory().

Address sources. Uniswap's sdk-core, file sdks/sdk-core/src/addresses.ts on main at commit 17d70b1b1068fc1b5ce79a89fb5901e562a22e79, retrieved with curl at 2026-10-02 14:59:25 UTC from https://raw.githubusercontent.com/Uniswap/sdks/main/sdks/sdk-core/src/addresses.ts, lists for ROBINHOOD_ADDRESSES: "v3CoreFactoryAddress: '0x1f7d7550b1b028f7571e69a784071f0205fd2efa'", "quoterAddress: '0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7'", "tickLensAddress: '0x7dfd4f31be6814d2906bde155c3e1b146eac1468'", "swapRouter02Address: '0xcaf681a66d020601342297493863e78c959e5cb2'", "v4StateView: '0xf3334192d15450cdd385c8b70e03f9a6bd9e673b'" and "v4QuoterAddress: '0x8dc178efb8111bb0973dd9d722ebeff267c98f94'". The sibling file sdks/sdk-core/src/chains.ts has "ROBINHOOD = 4663".

## SPY

Token 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C (SPDR S&P 500 ETF Trust • Robinhood Token): decimals() = 18, paused() = false, oraclePaused() = false, uiMultiplier() = 1001717991187472003, newUIMultiplier() = 1001717991187472003, effectiveAt() = 1789690233 (2026-09-18 00:10:33 UTC).

Feed 0x319724394D3A0e3669269846abE664Cd621f9f6A ("RHSPY / USD"): decimals() = 8, latestRoundData() = (18446744073709551770, 77071210575, 1790944226, 1790944238, 18446744073709551770). Price 770.71210575 USD per token, updatedAt 2026-10-02 12:30:38 UTC, age 9,145 s (2.54 h) at block 78,323,256.

Every pool getPool(USDG, token, fee) returned, with its state at block 78,323,256:

| Fee | Pool | Created at block | token0 / token1 | tickSpacing | liquidity() | slot0 sqrtPriceX96 | slot0 tick | USDG held | SPY held | Mid, USDG per SPY | Mid vs feed, bps | Value held at mid, USDG |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5 | 67,801,025 | SPY / USDG | 1 | 0 | 2188368687178955204990906 | -209950 | 0.00 | 0.000002 | n/a, liquidity() = 0 | n/a | 0.00 |
| 500 | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 34,839,529 | SPY / USDG | 10 | 497042702308193619 | 2201210893525703610936775 | -209833 | 240,155.61 | 153.818978 | 771.9055 | +15.48 | 358,889.32 |
| 3000 | 0xA43b424Bc609495AED4BCD88d654934b510B0aD9 | 15,259,439 | SPY / USDG | 60 | 25193632080640499 | 2200010362641566333893046 | -209843 | 15,393.50 | 14.239418 | 771.0637 | +4.56 | 26,373.00 |

Depth from the tick walk and QuoterV2 results at block 78,323,256. Premium is against the feed price 770.71210575. Pool cost is the execution price against the pool's own mid, which is the fee plus price impact.

| Fee | Depth +1% / -1%, USDG | Depth +2% / -2%, USDG | Depth within 2%, USDG | Depth +5% / -5%, USDG | Premium at 10 / 100 / 1,000 / 10,000 USDG, bps | Pool cost at 100 USDG, bps | Sell-back of the 100 USDG fill: USDG out, discount bps | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0 (liquidity() = 0) | 0 (liquidity() = 0) | 0 (liquidity() = 0) | 0 (liquidity() = 0) | revert / revert / revert / revert | n/a | n/a | Exclude. liquidity() = 0 and every quote reverts. |
| 500 | 55,089 / 77,969 | 86,302 / 131,684 | 217,986 | 112,665 / 223,793 | +20.50 / +20.57 / +21.22 / +27.82 | +5.07 | 99.898579, -10.40 | Allowlist, primary. |
| 3000 | 3,083 / 3,507 | 5,081 / 6,913 | 11,994 | 9,956 / 13,146 | +34.81 / +36.10 / +49.01 / +247.03 | +31.52 | 99.372618, +26.87 | Exclude for now. Only 5,081 USDG of buy depth to +2%, and a 0.30% fee. |

Reading: the fee-500 pool is about 18 times deeper than the fee-3000 pool within 2 percent. Its 100 USDG buy cost 5.07 bps over its own mid, and the mid sat 15.48 bps above a feed round that was 2.54 h old.

## QQQ

Token 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 (Invesco QQQ • Robinhood Token): decimals() = 18, paused() = false, oraclePaused() = false, uiMultiplier() = 1000700791241405425, newUIMultiplier() = 1000700791241405425, effectiveAt() = 1790035834 (2026-09-22 00:10:34 UTC).

Feed 0x80901d846d5D7B030F26B480776EE3b29374C2ae ("Robinhood QQQ / USD"): decimals() = 8, latestRoundData() = (18446744073709552017, 75199912534, 1790945820, 1790945832, 18446744073709552017). Price 751.99912534 USD per token, updatedAt 2026-10-02 12:57:12 UTC, age 7,551 s (2.10 h) at block 78,323,256.

Every pool getPool(USDG, token, fee) returned, with its state at block 78,323,256:

| Fee | Pool | Created at block | token0 / token1 | tickSpacing | liquidity() | slot0 sqrtPriceX96 | slot0 tick | USDG held | QQQ held | Mid, USDG per QQQ | Mid vs feed, bps | Value held at mid, USDG |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0x4539019B527211998642fEC342C85dcB44c7e5E4 | 47,391,085 | USDG / QQQ | 1 | 0 | 79224540458590546956530321301 | -1 | 0.00 | 0.000000 | n/a, liquidity() = 0 | n/a | 0.00 |
| 500 | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 47,501,593 | USDG / QQQ | 10 | 1159968769911442837 | 2889107044972019383063839909085184 | 210093 | 759,864.57 | 647.940294 | 752.0243 | +0.34 | 1,247,131.45 |
| 3000 | 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79 | 1,672,833 | USDG / QQQ | 60 | 2042348429849465 | 2888530435895609833250729503166011 | 210089 | 12,598.47 | 2.309782 | 752.3246 | +4.33 | 14,336.18 |

Depth from the tick walk and QuoterV2 results at block 78,323,256. Premium is against the feed price 751.99912534. Pool cost is the execution price against the pool's own mid, which is the fee plus price impact.

| Fee | Depth +1% / -1%, USDG | Depth +2% / -2%, USDG | Depth within 2%, USDG | Depth +5% / -5%, USDG | Premium at 10 / 100 / 1,000 / 10,000 USDG, bps | Pool cost at 100 USDG, bps | Sell-back of the 100 USDG fill: USDG out, discount bps | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0 (liquidity() = 0) | 0 (liquidity() = 0) | 0 (liquidity() = 0) | 0 (liquidity() = 0) | revert / revert / revert / revert | n/a | n/a | Exclude. liquidity() = 0 and every quote reverts. |
| 500 | 154,548 / 167,531 | 305,847 / 346,524 | 652,371 | 422,136 / 515,171 | +5.34 / +5.37 / +5.65 / +8.49 | +5.03 | 99.899397, +4.70 | Allowlist, primary. |
| 3000 | 189 / 2,044 | 277 / 5,086 | 5,362 | 449 / 9,004 | +36.22 / +52.72 / +725.94 / +48,754.62 | +48.37 | 99.047078, +43.07 | Exclude. Thin: 277 USDG of buy depth to +2%. |

Reading: the fee-500 pool holds almost all QQQ liquidity. The fee-3000 pool has only 277 USDG of buy depth to +2%, so 1,000 USDG would pay +725.94 bps.

## NVDA

Token 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC (NVIDIA • Robinhood Token): decimals() = 18, paused() = false, oraclePaused() = false, uiMultiplier() = 1000775159164630595, newUIMultiplier() = 1000775159164630595, effectiveAt() = 1788998430 (2026-09-10 00:00:30 UTC).

Feed 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 ("RHNVDA / USD"): decimals() = 8, latestRoundData() = (18446744073709552774, 23755399953, 1790948699, 1790948711, 18446744073709552774). Price 237.55399953 USD per token, updatedAt 2026-10-02 13:45:11 UTC, age 4,672 s (1.30 h) at block 78,323,256.

Every pool getPool(USDG, token, fee) returned, with its state at block 78,323,256:

| Fee | Pool | Created at block | token0 / token1 | tickSpacing | liquidity() | slot0 sqrtPriceX96 | slot0 tick | USDG held | NVDA held | Mid, USDG per NVDA | Mid vs feed, bps | Value held at mid, USDG |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333 | 13,090,320 | USDG / NVDA | 1 | 14297015922504961 | 5504213223544515881124108767577244 | 222985 | 82.91 | 0.002970 | 207.1899 | -1,278.20 | 83.53 |
| 500 | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 15,511,376 | USDG / NVDA | 10 | 4367296467067169907 | 5150711094470980379053700528344668 | 221657 | 2,344,584.59 | 2,490.027244 | 236.6055 | -39.93 | 2,933,738.66 |
| 3000 | 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B | 7,923,871 | USDG / NVDA | 60 | 15637921430008091 | 5145207500484780352331183962823363 | 221635 | 18,556.91 | 19.576379 | 237.1119 | -18.61 | 23,198.71 |
| 10000 | 0xc277560DF3689A401bA7deDd7626168b234Ceb5e | 41,860,530 | USDG / NVDA | 200 | 18001700290564 | 5168352596650742933597644790953960 | 221725 | 14.65 | 0.019391 | 234.9930 | -107.81 | 19.21 |

Depth from the tick walk and QuoterV2 results at block 78,323,256. Premium is against the feed price 237.55399953. Pool cost is the execution price against the pool's own mid, which is the fee plus price impact.

| Fee | Depth +1% / -1%, USDG | Depth +2% / -2%, USDG | Depth within 2%, USDG | Depth +5% / -5%, USDG | Premium at 10 / 100 / 1,000 / 10,000 USDG, bps | Pool cost at 100 USDG, bps | Sell-back of the 100 USDG fill: USDG out, discount bps | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 0 / 82 | 0 / 82 | 82 | 0 / 82 | floor / floor / floor / floor | n/a | n/a | Exclude. Holds 0.00297 NVDA. Any buy returns 0.0000000108 NVDA and hits the price floor. |
| 500 | 160,828 / 256,076 | 264,817 / 459,741 | 724,558 | 462,221 / 1,072,861 | -34.94 / -34.93 / -34.80 / -33.46 | +5.02 | 99.899727, +44.92 | Allowlist, primary. |
| 3000 | 1,187 / 1,918 | 2,188 / 4,223 | 6,412 | 4,299 / 11,307 | +11.84 / +15.57 / +52.99 / +11,844.88 | +34.24 | 99.322055, +52.33 | Exclude. Thin: 6,412 USDG within 2%. |
| 10000 | 1 / 1 | 3 / 3 | 6 | 5 / 7 | floor / floor / floor / floor | n/a | n/a | Exclude. 1% fee and 19 USDG of value. Any buy returns at most 0.01897 NVDA and hits the price floor. |

Reading: floor means the quote's sqrtPriceX96After is 4295128740, which is MIN_SQRT_RATIO + 1. The pool ran out of NVDA and the swap stopped at the price floor, a partial fill. The fee-100 pool returns 10809261490 wei of NVDA for every size and the fee-10000 pool returns 18970284859849569 wei. The fee-500 pool reads -34.93 bps because the next feed round, posted 26 s later, was 54.6 bps lower than the round in use.

## AAPL

Token 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 (Apple • Robinhood Token): decimals() = 18, paused() = false, oraclePaused() = false, uiMultiplier() = 1000566080061092436, newUIMultiplier() = 1000566080061092436, effectiveAt() = 1786720366 (2026-08-14 15:12:46 UTC).

Feed 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 ("Robinhood AAPL / USD"): decimals() = 8, latestRoundData() = (18446744073709552314, 33388329774, 1790950135, 1790950147, 18446744073709552314). Price 333.88329774 USD per token, updatedAt 2026-10-02 14:09:07 UTC, age 3,236 s (0.90 h) at block 78,323,256.

Every pool getPool(USDG, token, fee) returned, with its state at block 78,323,256:

| Fee | Pool | Created at block | token0 / token1 | tickSpacing | liquidity() | slot0 sqrtPriceX96 | slot0 tick | USDG held | AAPL held | Mid, USDG per AAPL | Mid vs feed, bps | Value held at mid, USDG |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 20,889,404 | USDG / AAPL | 10 | 532291017977301940 | 4342703305147422205165381161312469 | 218244 | 141,595.87 | 596.182531 | 332.8426 | -31.17 | 340,030.78 |
| 3000 | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | 15,312,374 | USDG / AAPL | 60 | 100864137357531710 | 4338410612889607387092483180861791 | 218224 | 92,208.05 | 108.721247 | 333.5016 | -11.43 | 128,466.76 |
| 10000 | 0x3714aa8105DE1f384481B425788Af413748C1837 | 14,306,891 | USDG / AAPL | 200 | 1301150973309532 | 4348613473901744456414747861809210 | 218271 | 1,897.83 | 1.983050 | 331.9384 | -58.25 | 2,556.08 |

Depth from the tick walk and QuoterV2 results at block 78,323,256. Premium is against the feed price 333.88329774. Pool cost is the execution price against the pool's own mid, which is the fee plus price impact.

| Fee | Depth +1% / -1%, USDG | Depth +2% / -2%, USDG | Depth within 2%, USDG | Depth +5% / -5%, USDG | Premium at 10 / 100 / 1,000 / 10,000 USDG, bps | Pool cost at 100 USDG, bps | Sell-back of the 100 USDG fill: USDG out, discount bps | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 500 | 44,649 / 42,530 | 95,829 / 81,285 | 177,114 | 173,503 / 108,996 | -26.17 / -26.08 / -25.16 / -15.77 | +5.11 | 99.897969, +36.26 | Allowlist, primary. |
| 3000 | 9,177 / 9,234 | 18,152 / 18,463 | 36,615 | 31,147 / 38,821 | +18.68 / +19.16 / +24.05 / +72.88 | +30.63 | 99.390156, +41.94 | Allowlist, second. |
| 10000 | 108 / 119 | 189 / 221 | 410 | 308 / 513 | +46.37 / +84.49 / +5,934.86 / +144,303.77 | +143.58 | 97.198543, +198.02 | Exclude. 1% fee and thin: 410 USDG within 2%. |

Reading: the fee-500 and fee-3000 pools both have real depth. The fee-3000 pool costs about 25 bps more at 100 USDG but holds 128,467 USDG of value, which makes it a usable second pool. The fee-10000 pool pays +5,934.86 bps on a 1,000 USDG buy.

## Two-hop through WETH

Several direct pools are thin, so the WETH route was checked even though every ticker already has a deep direct fee-500 pool. WETH9 is 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 from SwapRouter02.WETH9(). getPool(WETH, token, fee) for fees 100, 500, 3000 and 10000 and getPool(USDG, WETH, fee) for the same fees, all at block 78,323,256, returned the pools below.

First leg, USDG to WETH (WETH is token0, USDG token1):

| USDG/WETH pool | Fee | liquidity() | USDG held | WETH held | Mid, USDG per WETH | Depth +2% / -2%, USDG | 1,000 USDG buys, WETH |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca | 100 | 6032060894225777713 | 15,179,075.72 | 4,079.2625 | 2,708.1730 | 3,110,318 / 2,822,315 | 0.369214528924082973 |
| 0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a | 500 | 1127596544251437409 | 3,698,140.89 | 681.4002 | 2,708.9674 | 609,085 / 576,294 | 0.368953491068365687 |
| 0xa9188730Fe85Be88ad499D7d52B099e800fB0334 | 3000 | 271988101804266241 | 1,044,883.31 | 122.9325 | 2,706.6983 | 136,653 / 142,877 | 0.368319504024668483 |
| 0x5f009E071F07e92B6C624e83F52F17bBDa34680D | 10000 | 61099494335029246 | 139,470.99 | 43.0015 | 2,726.2272 | 56,318 / 32,046 | 0.363026555871026665 |

The fee-100 pool gave the most WETH for 1,000 USDG, so every two-hop quote uses it as the first leg. Second legs and the two-hop QuoterV2 `quoteExactInput(bytes,uint256)` results, with path USDG, 100, WETH, second-leg fee, token:

| Second leg (WETH/token) | Fee | liquidity() | Value held, USDG | Implied mid vs feed, bps | Second-leg depth +2% / -2%, USDG | Two-hop premium at 10 / 100 / 1,000 USDG, bps | Direct fee-500 pool at 10 / 100 / 1,000 USDG, bps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SPY 0x038fC7811482cb34d1204DA89A285325Cd094a02 | 100 | 0 | 0 | n/a | 0 | revert / revert / revert | +20.50 / +20.57 / +21.22 |
| SPY 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e | 500 | 15449289788042830733911 | 1,776,547 | +9.43 | 223,561 / 193,610 | +15.44 / +15.48 / +15.91 | +20.50 / +20.57 / +21.22 |
| SPY 0xe30Ac12Dc35faC73D2266FB68fe49bA47745b2c5 | 3000 | 0 | 0 | n/a | 0 | revert / revert / revert | +20.50 / +20.57 / +21.22 |
| QQQ 0x8eC7Ef7B775B04ab1000A122Ce0ae1DcfF509A5C | 500 | 0 | 0 | n/a | 0 | revert / revert / revert | +5.34 / +5.37 / +5.65 |
| QQQ 0xA40D00a55d43bA2d188039DCF88bD68f4F133E78 | 3000 | 2891384642463848001420 | 331,979 | +5.58 | 31,609 / 68,783 | +36.72 / +36.94 / +39.15 | +5.34 / +5.37 / +5.65 |
| QQQ 0x13444127F263A5Ac1C545EFcEc022b467DF91658 | 10000 | 99128297958027149399 | 11,087 | -70.89 | 1,403 / 1,417 | +31.11 / +37.46 / +100.88 | +5.34 / +5.37 / +5.65 |
| NVDA 0x057A53e4b1b9a2fEBAE171A798E97c27300400c6 | 100 | 0 | 0 | n/a | 0 | revert / revert / revert | -34.94 / -34.93 / -34.80 |
| NVDA 0x62AB521f71431f78ac374CdbadC6cda3c8916b6C | 500 | 14123535129975130115658 | 1,232,291 | -39.08 | 76,300 / 128,582 | -33.09 / -33.01 / -32.19 | -34.94 / -34.93 / -34.80 |
| NVDA 0xC0Be1cb0f674D9737C72B2A63fC542361185b807 | 3000 | 5313675874831869669408 | 339,546 | -24.57 | 34,252 / 43,597 | +6.47 / +6.69 / +8.89 | -34.94 / -34.93 / -34.80 |
| NVDA 0x8b6a6416A5d1040EfCfa6234dA6AA1265DfE123e | 10000 | 68394428063916120873 | 5,303 | -96.94 | 543 / 549 | +5.90 / +22.23 / +185.52 | -34.94 / -34.93 / -34.80 |
| AAPL 0xe4D4BA605B042054Bd8815D515D98DdF46232622 | 100 | 0 | 0 | n/a | 0 | revert / revert / revert | -26.17 / -26.08 / -25.16 |
| AAPL 0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f | 500 | 2569060449174250372570 | 197,790 | -31.65 | 27,154 / 20,421 | -25.62 / -25.25 / -21.58 | -26.17 / -26.08 / -25.16 |

What this shows:

- The two-hop route is never needed for these tickers: each direct fee-500 pool is deeper than 10,000 USDG many times over.
- For SPY the route through the WETH/SPY fee-500 pool 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e was 5.09 bps cheaper than the direct pool at 100 USDG at this block, because that pool priced SPY lower. That pool held about 1.78 million USDG of value, about five times the direct SPY pool. It is a candidate for a later multi-hop path, not for M0, since a path adds a second pool to allowlist and to check.
- For QQQ, NVDA and AAPL the direct fee-500 pool was as good or better.
- WETH/SPY at 100 and 3000, WETH/QQQ at 500, WETH/NVDA at 100 and WETH/AAPL at 100 have liquidity() = 0, and two-hop quotes through them revert with "Unexpected error". WETH/QQQ at 100, WETH/SPY at 10000 and WETH/AAPL at 3000 and 10000 do not exist.

## Uniswap v4 context

Context only. M0 swaps on v3. Read at block 78,329,921, timestamp 2026-10-02 15:14:12 UTC (hash 0x74607f17a90684557a60ac8744279c93655af38f6dc32838a753b576e1746295).

Pools. Initialize logs on the PoolManager 0x8366a39cc670b4001a1121b8f6a443a643e40951 (topic 0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438), filtered on currency0 and currency1 for each USDG pair from block 0 to 78,323,256, list 614 pools. StateView 0xf3334192d15450cdd385c8b70e03f9a6bd9e673b `getLiquidity(bytes32)` and `getSlot0(bytes32)` were read for all of them through Multicall3 at 0xcA11bde05977b3631167028862bE2a173976CA11.

| Ticker | v4 USDG pools initialized | With hooks | Dynamic fee flag | liquidity() above 0 | Above 0 and mid within 10% of the feed |
| --- | --- | --- | --- | --- | --- |
| SPY | 143 | 93 | 67 | 17 | 11 |
| QQQ | 42 | 18 | 8 | 11 | 10 |
| NVDA | 331 | 270 | 163 | 44 | 31 |
| AAPL | 98 | 51 | 35 | 24 | 16 |

Across the 614 pools, 273 use the dynamic-fee flag and the 341 static fees reach 999,999, which is 99.9999 percent. 76 static fees are 10 percent or more. Only 96 pools had liquidity above 0 at this block.

The four pools per ticker with the most estimated depth near the feed, quoted through the v4 Quoter 0x8dc178efb8111bb0973dd9d722ebeff267c98f94 with `quoteExactInputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))(uint256,uint256)` and empty hookData. The depth estimate holds the current liquidity constant across the 2 percent band, so it is rough. The quotes are exact and all-in.

| Ticker | PoolId | Fee field | lpFee from StateView | tickSpacing | Hooks | liquidity | Mid | Depth within 2% (estimate), USDG | v4 Quoter premium at 100 / 10,000 USDG, bps | Execution vs mid at 100 USDG, bps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SPY | 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd | 3000 | 3000 | 60 | 0x0000000000000000000000000000000000000000 | 6929650515484108914 | 770.8654 | 3,848,153 | +37.11 / +37.63 | +35.12 |
| SPY | 0xe5923c8a8be481ec89a2ca784a2bbfa4235de6d88f92260fd66b660c4babf907 | 500 | 500 | 5 | 0x0000000000000000000000000000000000000000 | 3645362508251828804 | 770.1989 | 2,023,457 | -0.40 / +0.58 | +6.26 |
| SPY | 0x8674c1c5544f3c9563565b5d4bd5916701d90b3559b072acf7cef5b4fc5b8dcd | 0x800000 (dynamic) | 0 | 10 | 0xa0e8fbff13e24af2b5e61a72800e08a161bde080 | 3572952135178380611 | 770.3607 | 1,983,472 | +3.45 / +4.45 | +8.02 |
| SPY | 0x008f06cd38b13ddd7712ba63fb3caff0fc7c969aa32d0407f1868539f3f688c2 | 0x800000 (dynamic) | 0 | 60 | 0x64e9ae1066c47ac4a3cc0a5bd7b135908590e088 | 21864530733955722 | 770.4689 | 12,139 | +4.49 / +1,481.37 | +7.65 |
| SPY | v3 fee-500 pool, same block | 500 | n/a | 10 | none | | | see v3 table | -2.62 / +4.59 | |
| QQQ | 0xf9568ec0cba6e9ba30d9daabbf3e807813b8852e5737b7d83ea06529c73c9758 | 3000 | 3000 | 60 | 0x0000000000000000000000000000000000000000 | 225406173518911 | 752.7757 | 124 | +839.89 / revert | +828.71 |
| QQQ | 0xd3d49eaab15eb8f4d1d480a8518fc3ce4e60ca81d69904b3e7dc53b4fc0ce2d9 | 10000 | 10000 | 200 | 0x0000000000000000000000000000000000000000 | 11845596943468 | 740.7577 | 6 | +3,081.00 / revert | +3,279.52 |
| QQQ | 0xfdb851fa38ba3e83045b95433c86dba852601c5008e61d04a6c7d79baf60a9c9 | 880000 | 880000 | 17600 | 0x0000000000000000000000000000000000000000 | 11450430822099 | 687.1661 | 6 | +69,269.37 / +370,658.02 | +76,748.31 |
| QQQ | 0x01fd49f448eb121bfe5dcace35f92219df1d2e837ac79d0a7cc9377c4ba50009 | 770000 | 770000 | 1 | 0x0000000000000000000000000000000000000000 | 7533198563690 | 704.8428 | 4 | +35,479.13 / +499,443.43 | +38,521.84 |
| QQQ | v3 fee-500 pool, same block | 500 | n/a | 10 | none | | | see v3 table | -25.49 / -22.50 | |
| NVDA | 0x3bb34a44f1b2b5f32c034c38a53065a521a47b199700fa9bd19d60985ff24bf1 | 3000 | 3000 | 60 | 0x0000000000000000000000000000000000000000 | 430666862709795142 | 235.9234 | 132,306 | +21.05 / +36.00 | +35.26 |
| NVDA | 0x7990aad9e8fb048f49a155a7df5603db0366f0657035b78eb4196395cccb3dcd | 0x800000 (dynamic) | 0 | 10 | 0x66622f77b797d506e5376f7798b67ab288966080 | 263755963424292284 | 235.9718 | 81,037 | +22.51 / +50.63 | +34.66 |
| NVDA | 0x6444a8e0b267406a15db74ca00c4a24bdfa81ed3180f5b6d0851f8ed6f4f29c5 | 100 | 100 | 1 | 0x0000000000000000000000000000000000000000 | 115902999316747688 | 235.2923 | 35,559 | -39.07 / +40.69 | +1.81 |
| NVDA | 0x13de5ce7783d2e7fb60d57b9ab42856ff3bf1840fd235407977835a832795fd0 | 0x800000 (dynamic) | 0 | 3 | 0x5f3a7401452504668a317cee424f2ee1071e40c4 | 105343073015417010 | 222.3455 | 31,418 | revert / revert | n/a |
| NVDA | v3 fee-500 pool, same block | 500 | n/a | 10 | none | | | see v3 table | -37.89 / -36.63 | |
| AAPL | 0xc748f4671a867db48b552f6b7650bf3255e05f80f00e3f7aad1b17ccb7898fdb | 3000 | 3000 | 60 | 0x0000000000000000000000000000000000000000 | 650811760123264015 | 332.6752 | 237,420 | +52.55 / +60.91 | +35.20 |
| AAPL | 0xa2347ba69167e5602f74640ffbf737ee7cdd825e4726d3462564fc6533070147 | 0x800000 (dynamic) | 0 | 10 | 0x70a9a88402989226847ec122043ce5e7ff462080 | 311110075990568319 | 331.6778 | 113,325 | -7.57 / +9.88 | +5.18 |
| AAPL | 0x845b21902932be7f77f8ccbf793c17494f0ce7c6ffdcdb675d4dec701bc7601a | 0x800000 (dynamic) | 0 | 60 | 0x64e9ae1066c47ac4a3cc0a5bd7b135908590e088 | 9694558109607457 | 331.9076 | 3,533 | +2.84 / +3,593.48 | +8.66 |
| AAPL | 0x496d48b9c1256a5b4f3c85f85776aff8e75cf847397cc8174242f97ae99b6d71 | 1000 | 1000 | 1000 | 0xc52fc52698479e42f0da9a8a75296ec3871454c0 | 553637065538265 | 334.0552 | 202 | +168.32 / revert | +108.83 |
| AAPL | v3 fee-500 pool, same block | 500 | n/a | 10 | none | | | see v3 table | -6.30 / +3.87 | |

What this shows:

- SPY is the one ticker where v4 is much deeper. Three v4 pools each show an estimated 2 to 3.8 million USDG within 2 percent, against 217,986 for the v3 fee-500 pool, and at 10,000 USDG the v4 fee-500 pool (no hook) quoted +0.58 bps against +4.59 bps for the v3 pool at the same block.
- QQQ has no useful v4 USDG pool. The deepest one near the price has about 124 USDG within 2 percent.
- NVDA v4 is shallower than v3. The best v4 pool has an estimated 132,306 USDG within 2 percent against 724,558 for v3.
- AAPL is similar on both. The best v4 pool has an estimated 237,420 USDG within 2 percent against 177,114 for v3.
- On the three hooked dynamic-fee pools with tens of thousands of USDG or more near the price, StateView reports lpFee 0, yet a 100 USDG quote paid 5.18 (AAPL), 8.02 (SPY) and 34.66 (NVDA) bps over mid. That is the fee outside the fee field that PRD 7.4 and 14 warn about, and the reason the guard prices from balance deltas.

## Stability checks

The four fee-500 pools again at block 78,329,921 (2026-10-02 15:14:12 UTC), quoted with the same QuoterV2 call against each feed at that block:

| Ticker | Feed price at 78,329,921 | Feed updatedAt | 100 USDG buys (v3, fee 500) | Premium, bps | 10,000 USDG buys | Premium, bps |
| --- | --- | --- | --- | --- | --- | --- |
| SPY | 770.71210575 | 2026-10-02 12:30:38 UTC | 0.129784074051 | -2.62 | 12.969056711050 | +4.59 |
| QQQ | 751.99912534 | 2026-10-02 12:57:12 UTC | 0.133318738201 | -25.49 | 13.327876387168 | -22.50 |
| NVDA | 236.25799569 | 2026-10-02 15:03:29 UTC | 0.424875758830 | -37.89 | 42.482241101407 | -36.63 |
| AAPL | 332.10088933 | 2026-10-02 15:10:08 UTC | 0.301303087028 | -6.30 | 30.099693209590 | +3.87 |

The NVDA and AAPL feeds posted new rounds between the two snapshots, at 15:03:29 and 15:10:08 UTC.

Recommended pools at the pinned fork blocks from D-008, read through the archive RPC https://robinhood.drpc.org:

| Block | Time | Ticker | Pool (fee) | liquidity() | slot0 sqrtPriceX96 | USDG held | Token held | Mid | Feed price | Feed age, s | 100 USDG buys | Execution price | Premium, bps | Pool cost, bps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 78,312,136 | 2026-10-02 14:44:26 UTC | SPY | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 (500) | 480128116021906150 | 2202871655443822153166139 | 250,416.93 | 140.5283 | 773.0707 | 770.71210575 | 8,028 | 0.129288627355 | 773.4632 | +35.70 | +5.08 |
| 78,312,136 | 2026-10-02 14:44:26 UTC | QQQ | 0xD60A5d14dB690B7Afad71F76B108071D7175597d (500) | 1132570811226346224 | 2885418851030101393733440760720553 | 799,811.03 | 594.8609 | 753.9481 | 751.99912534 | 6,434 | 0.132568384750 | 754.3277 | +30.96 | +5.03 |
| 78,312,136 | 2026-10-02 14:44:26 UTC | NVDA | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 (500) | 3961400778166797748 | 5146093182792161338684331248575673 | 2,408,739.58 | 2,326.0129 | 237.0303 | 237.55399953 | 3,555 | 0.421675347099 | 237.1493 | -17.04 | +5.02 |
| 78,312,136 | 2026-10-02 14:44:26 UTC | AAPL | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D (500) | 520684205132525847 | 4334132246020884869862502552624072 | 159,076.61 | 543.7758 | 334.1603 | 333.88329774 | 2,119 | 0.299104803597 | 334.3310 | +13.41 | +5.11 |
| 78,312,136 | 2026-10-02 14:44:26 UTC | AAPL | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed (3000) | 100864137357531710 | 4338410612889607387092483180861791 | 92,208.05 | 108.7212 | 333.5016 | 333.88329774 | 2,119 | 0.298932952993 | 334.5232 | +19.16 | +30.63 |
| 73,280,794 | 2026-09-26 18:00:00 UTC | SPY | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 (500) | 726307371905833138 | 2200748125404556766127412 | 230,087.41 | 173.1177 | 771.5810 | 772.32802713 | 93,420 | 0.129538580347 | 771.9708 | -4.63 | +5.05 |
| 73,280,794 | 2026-09-26 18:00:00 UTC | QQQ | 0xD60A5d14dB690B7Afad71F76B108071D7175597d (500) | 1382704506736023880 | 2903503576237317780449182350385488 | 663,972.93 | 924.9777 | 744.5853 | 745.35972577 | 93,385 | 0.134235446301 | 744.9597 | -5.37 | +5.03 |
| 73,280,794 | 2026-09-26 18:00:00 UTC | NVDA | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 (500) | 29569744868071700623 | 5283278691524512521494246867664022 | 3,753,589.92 | 8,759.7280 | 224.8807 | 225.66018707 | 79,435 | 0.444457842218 | 224.9932 | -29.56 | +5.00 |
| 73,280,794 | 2026-09-26 18:00:00 UTC | AAPL | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D (500) | 1061075408181102343 | 4293318876174051474852089423751974 | 215,189.93 | 405.1521 | 340.5437 | 341.45318048 | 79,835 | 0.293499729887 | 340.7158 | -21.59 | +5.05 |
| 73,280,794 | 2026-09-26 18:00:00 UTC | AAPL | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed (3000) | 49348151744095893 | 4292577242485716730721671842441068 | 101,229.37 | 54.4891 | 340.6614 | 341.45318048 | 79,835 | 0.292633938428 | 341.7239 | +7.93 | +31.19 |

Liquidity was present at both blocks in every recommended pool. At 73,280,794, a Saturday, the SPY feed was 93,420 s (25.95 h) old and the QQQ feed 93,385 s (25.94 h) old, so a forked test at that block will see both the closed session and a feed older than the 25-hour limit for those two tickers.

## Notes for the build

- SwapRouter02 `exactInputSingle` picks the pool from (tokenIn, tokenOut, fee) through the factory. An allowlist entry can store the fee and check that getPool(USDG, token, fee) equals the allowlisted address.
- A pool can fill only part of an exact-input swap. With sqrtPriceLimitX96 = 0 the swap stops at the price floor when the pool runs out of the token, and the router charges only what was used. The NVDA fee-100 pool shows this: every buy size from 10 to 10,000 USDG returns 10809261490 wei of NVDA with sqrtPriceX96After = 4295128740, which is MIN_SQRT_RATIO + 1. The module must measure USDG spent by balance delta and must not assume the full amount left. The minimum-out check and the premium cap both reject such a fill, and the exact approval would be left partly unused, so the reset to zero in the same call matters.
- QuoterV2 reverts with the string "Unexpected error" on a pool with liquidity() = 0. The keeper should treat a revert as "pool unusable" for that round.
- Measured premiums swing with feed lag. A fixed 100 bps cap leaves about 95 bps of room on the fee-500 pools after their 5 bps cost. The AAPL fee-3000 pool leaves about 70.

## Mismatches with the PRD

- PRD source S24 links https://dexpaprika.com/robinhood/pool/0xae1685599288831eb0844cb59058116ee3184b9a for the "USDG/NVDA v3 pool with about $6.9M liquidity" in section 22. That pool is not an NVDA pool. On chain, `token1()(address)` on 0xae1685599288831eb0844cb59058116ee3184b9a returns 0xE1E5f00A9B0255ca4dF85B3130eE0F77d15acC2D, whose `symbol()(string)` is an emoji and whose `name()(string)` starts "Pushin'", with fee 10000 and liquidity() = 0 (latest block, about 14:57 UTC). DexPaprika's API at https://api.dexpaprika.com/networks/robinhood/pools/0xae1685599288831eb0844cb59058116ee3184b9a, retrieved with curl at 2026-10-02 14:58:43 UTC, agrees: "base_token_id":"0xe1e5f00a9b0255ca4df85b3130ee0f77d15acc2d". The canonical NVDA pool with millions of USDG is 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3. DexPaprika's API for that pool, retrieved at 2026-10-02 15:28:09 UTC, shows "liquidity_usd":2924845.920796866, in line with the 2,933,739 USDG measured here at block 78,323,256. At block 73,280,794 it held 3,753,589.92 USDG and 8,759.728 NVDA, about 5.73 million USDG at that block's feed price.
- Not a conflict, a clarification. PRD section 22 lists G5 commands for fees 100, 500, 3000 and 10000, and those are the only tiers the v3 factory has enabled, so the list is complete. PRD 7.4 says some pools carry fee tiers up to 95 percent. That is true only of v4, where static fees on USDG pairs of these four tokens reach 99.9999 percent. On v3 the highest tier is 1 percent.

## Appendix A: commands

All v3 snapshot calls ran as below with `--json`, RPC https://rpc.mainnet.chain.robinhood.com, retried at the same block on https://robinhood.drpc.org when the connection failed. Replace `$RPC` with the archive RPC to replay them now.

```
B=78323256
cast block $B --json --rpc-url $RPC
cast call --json --rpc-url $RPC --block $B 0x0000000000000000000000000000000000000064 'arbBlockNumber()(uint256)'
cast call --json --rpc-url $RPC --block $B <USDG|WETH|token> 'decimals()(uint8)'
cast call --json --rpc-url $RPC --block $B <token> 'paused()(bool)'            # also oraclePaused(), uiMultiplier(), newUIMultiplier(), effectiveAt()
cast call --json --rpc-url $RPC --block $B <feed> 'decimals()(uint8)'
cast call --json --rpc-url $RPC --block $B <feed> 'description()(string)'
cast call --json --rpc-url $RPC --block $B <feed> 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'
cast call --json --rpc-url $RPC --block $B 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'feeAmountTickSpacing(uint24)(int24)' <fee>
cast call --json --rpc-url $RPC --block $B 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 <token> <fee>
cast call --json --rpc-url $RPC --block $B <pool> 'token0()(address)'          # also token1(), factory()
cast call --json --rpc-url $RPC --block $B <pool> 'fee()(uint24)'
cast call --json --rpc-url $RPC --block $B <pool> 'tickSpacing()(int24)'
cast call --json --rpc-url $RPC --block $B <pool> 'liquidity()(uint128)'
cast call --json --rpc-url $RPC --block $B <pool> 'slot0()(uint160,int24,uint16,uint16,uint16,uint8,bool)'
cast call --json --rpc-url $RPC --block $B <USDG|token> 'balanceOf(address)(uint256)' <pool>
cast call --json --rpc-url $RPC --block $B 0x7dfd4f31be6814d2906bde155c3e1b146eac1468 'getPopulatedTicksInWord(address,int16)((int24,int128,uint128)[])' <pool> <word>
cast call --json --rpc-url $RPC --block $B 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' '(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,<token>,<USDG amount, 6 decimals>,<fee>,0)'
cast call --json --rpc-url $RPC --block $B 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' '(<token>,0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,<tokens out of the 100 USDG buy>,<fee>,0)'
cast call --json --rpc-url $RPC --block $B 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInput(bytes,uint256)(uint256,uint160[],uint32[],uint256)' <USDG . 000064 . WETH . fee2 . token> <amount>
```

One complete example, the SPY fee-500 buy of 100 USDG:

```
cast call --json --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78323256 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' '(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168,0x117cc2133c37B721F49dE2A7a74833232B3B4C0C,100000000,500,0)'
[129483823700188790, "2201226825466372947226697", 1, 117219]
```

TickLens words: the word for a tick is floor(tick / tickSpacing) >> 8. Words from floor((tick - 1000) / tickSpacing) >> 8 to floor((tick + 1000) / tickSpacing) >> 8 were read for each pool.

Log scans, block ranges of 9,999,999 from 0 to 78,318,107:

```
cast rpc --rpc-url $RPC eth_getLogs '{"address":"0x1f7d7550B1b028f7571E69A784071F0205FD2EfA","fromBlock":"<hex>","toBlock":"<hex>","topics":["0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118","<token as 32 bytes>"]}'
cast rpc --rpc-url $RPC eth_getLogs '{"address":"0x1f7d7550B1b028f7571E69A784071F0205FD2EfA","fromBlock":"<hex>","toBlock":"<hex>","topics":["0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",null,"<token as 32 bytes>"]}'
cast logs --rpc-url $RPC --address 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA 0xc66a3fdf07232cdd185febcc6579d408c241b47ae2f9907d84be655141eeaecc --from-block <start> --to-block <end> --json
```

The v4 Initialize scan used the same eth_getLogs form on 0x8366a39cc670b4001a1121b8f6a443a643e40951 with topics ["0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438", null, "<currency0>", "<currency1>"] up to block 78,323,256. The v4 reads at block 78,329,921 used `aggregate3((address,bool,bytes)[])((bool,bytes)[])` on Multicall3 with StateView calldata 0xfa6793d5 (getLiquidity) and 0xc815641c (getSlot0) followed by the PoolId.

The fork-block reads used the same pool, balance, feed and quote commands with `--rpc-url https://robinhood.drpc.org --block 78312136` and `--block 73280794`.

## Appendix B: raw outputs at block 78,323,256

Values exactly as `cast call --json` returned them. Amounts are raw integers.

```
USDG.AAPL.10000 0x3714aa8105DE1f384481B425788Af413748C1837
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"]
  fee: [10000]
  tickSpacing: [200]
  liquidity: [1301150973309532]
  slot0: ["4348613473901744456414747861809210", 218271, 844, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [1897833140]
  AAPL.balanceOf(pool): [1983050295525197111]
  quoteExactInputSingle USDG->AAPL 10 USDG: [29812356799112726, "4346798174756707085478334013743510", 1, 117652]
  quoteExactInputSingle USDG->AAPL 100 USDG: [296996517818318138, "4329366505422764506328346918428232", 2, 147645]
  quoteExactInputSingle USDG->AAPL 1000 USDG: [1879563258901046803, "884625474825589281405862564409669", 8, 320631]
  quoteExactInputSingle USDG->AAPL 10000 USDG: [1941014408742159675, "48938655678581382800200711780599", 8, 328008]
  quoteExactInputSingle AAPL->USDG 296996517818318138 wei: [97198543, "4366516994687521709742260034771012", 1, 109113]
  TickLens words 4 to 4: 15 populated ticks
USDG.AAPL.3000 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [100864137357531710]
  slot0: ["4338410612889607387092483180861791", 218224, 889, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [92208054699]
  AAPL.balanceOf(pool): ["108721247150072369454"]
  quoteExactInputSingle USDG->AAPL 10 USDG: [29894751507290174, "4338387130745281425888803963450490", 1, 109009]
  quoteExactInputSingle USDG->AAPL 100 USDG: [298932952993294512, "4338175802884772173392820734118020", 1, 117698]
  quoteExactInputSingle USDG->AAPL 1000 USDG: [2987873959782890091, "4336063304751326529113329528322947", 2, 147711]
  quoteExactInputSingle USDG->AAPL 10000 USDG: ["29733875045482568294", "4315027055694317509843057743625125", 3, 171444]
  quoteExactInputSingle AAPL->USDG 298932952993294512 wei: [99390156, "4338644718464428095150539373004475", 1, 110147]
  TickLens words 14 to 14: 50 populated ticks
USDG.AAPL.500 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [532291017977301940]
  slot0: ["4342703305147422205165381161312469", 218244, 2142, 3000, 3000, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [141595865704]
  AAPL.balanceOf(pool): ["596182530984997484748"]
  quoteExactInputSingle USDG->AAPL 10 USDG: [30029182024562125, "4342698835492978939910205584501748", 1, 108918]
  quoteExactInputSingle USDG->AAPL 100 USDG: [300289038638572938, "4342658609017014226770364455125476", 1, 108918]
  quoteExactInputSingle USDG->AAPL 1000 USDG: [3002612254020941497, "4342256385241591600071406091334604", 1, 117583]
  quoteExactInputSingle USDG->AAPL 10000 USDG: ["29997888047647274052", "4338155373192120507394016839322245", 2, 171763]
  quoteExactInputSingle AAPL->USDG 300289038638572938 wei: [99897969, "4342747978929764979571059484253206", 1, 101436]
  TickLens words 84 to 85: 173 populated ticks
USDG.NVDA.100 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [14297015922504961]
  slot0: ["5504213223544515881124108767577244", 222985, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [82914549]
  NVDA.balanceOf(pool): [2969979956529828]
  quoteExactInputSingle USDG->NVDA 10 USDG: [10809261490, 4295128740, 1, 32564181]
  quoteExactInputSingle USDG->NVDA 100 USDG: [10809261490, 4295128740, 1, 32564181]
  quoteExactInputSingle USDG->NVDA 1000 USDG: [10809261490, 4295128740, 1, 32564181]
  quoteExactInputSingle USDG->NVDA 10000 USDG: [10809261490, 4295128740, 1, 32564181]
  quoteExactInputSingle NVDA->USDG 10809261490 wei: [2, "5504213223604410357759680961563798", 1, 101418]
  TickLens words 867 to 874: 2 populated ticks
USDG.NVDA.10000 0xc277560DF3689A401bA7deDd7626168b234Ceb5e
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [10000]
  tickSpacing: [200]
  liquidity: [18001700290564]
  slot0: ["5168352596650742933597644790953960", 221725, 0, 1, 1, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [14652267]
  NVDA.balanceOf(pool): [19390531140720307]
  quoteExactInputSingle USDG->NVDA 10 USDG: [18970284859849569, 4295128740, 1, 315909]
  quoteExactInputSingle USDG->NVDA 100 USDG: [18970284859849569, 4295128740, 1, 315909]
  quoteExactInputSingle USDG->NVDA 1000 USDG: [18970284859849569, 4295128740, 1, 315909]
  quoteExactInputSingle USDG->NVDA 10000 USDG: [18970284859849569, 4295128740, 1, 315909]
  quoteExactInputSingle NVDA->USDG 18970284859849569 wei: [4343835, "5251008733553533872171920562550804", 0, 108135]
  TickLens words 4 to 4: 2 populated ticks
USDG.NVDA.3000 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [15637921430008091]
  slot0: ["5145207500484780352331183962823363", 221635, 920, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [18556913632]
  NVDA.balanceOf(pool): ["19576379361501477621"]
  quoteExactInputSingle USDG->NVDA 10 USDG: [42045914023637973, "5144994478535269006580073634954812", 1, 109003]
  quoteExactInputSingle USDG->NVDA 100 USDG: [420302527898622378, "5143078074452391663875810559538648", 1, 117702]
  quoteExactInputSingle USDG->NVDA 1000 USDG: [4187378514926665629, "5123804487305107990192993654640460", 2, 147703]
  quoteExactInputSingle USDG->NVDA 10000 USDG: ["19270279615355966244", "96168965787795985448910837207507", 11, 420522]
  quoteExactInputSingle NVDA->USDG 420302527898622378 wei: [99322055, "5146998634278462769404745553555661", 2, 140212]
  TickLens words 14 to 14: 45 populated ticks
USDG.NVDA.500 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [4367296467067169907]
  slot0: ["5150711094470980379053700528344668", 221657, 3185, 7200, 7200, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [2344584585192]
  NVDA.balanceOf(pool): ["2490027244330034147005"]
  quoteExactInputSingle USDG->NVDA 10 USDG: [42243310748938711, "5150710328125046597038618157727038", 1, 109315]
  quoteExactInputSingle USDG->NVDA 100 USDG: [422432541826686745, "5150703431021904380304580453038219", 1, 109315]
  quoteExactInputSingle USDG->NVDA 1000 USDG: [4224268852830020168, "5150634461006387416636646108656750", 1, 109315]
  quoteExactInputSingle USDG->NVDA 10000 USDG: ["42237032817681568679", "5149944862426640412390174987274467", 1, 117290]
  quoteExactInputSingle NVDA->USDG 422432541826686745 wei: [99899727, "5150718754088331839803426950257211", 1, 101478]
  TickLens words 86 to 86: 224 populated ticks
USDG.QQQ.100 0x4539019B527211998642fEC342C85dcB44c7e5E4
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [0]
  slot0: ["79224540458590546956530321301", -1, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [3]
  QQQ.balanceOf(pool): [1]
  quoteExactInputSingle USDG->QQQ 10 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->QQQ 100 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->QQQ 1000 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->QQQ 10000 USDG: reverted: Unexpected error
  TickLens words -4 to 3: 0 populated ticks
USDG.QQQ.3000 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [2042348429849465]
  slot0: ["2888530435895609833250729503166011", 210089, 1274, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [12598469996]
  QQQ.balanceOf(pool): [2309781803215006824]
  quoteExactInputSingle USDG->QQQ 10 USDG: [13249899965888521, "2888016436808846495756231286411496", 1, 117714]
  quoteExactInputSingle USDG->QQQ 100 USDG: [132281451669162409, "2882722877600095048271784480260307", 2, 147681]
  quoteExactInputSingle USDG->QQQ 1000 USDG: [1239787340770963205, "2648356395213621150133191784993093", 7, 289970]
  quoteExactInputSingle USDG->QQQ 10000 USDG: [2263292124178765955, "18289374752214643105514691579091", 15, 523770]
  quoteExactInputSingle QQQ->USDG 132281451669162409 wei: [99047078, "2893069712987239389859994382644604", 2, 140218]
  TickLens words 13 to 13: 42 populated ticks
USDG.QQQ.500 0xD60A5d14dB690B7Afad71F76B108071D7175597d
  token0: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [1159968769911442837]
  slot0: ["2889107044972019383063839909085184", 210093, 1544, 1801, 1801, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [759864571089]
  QQQ.balanceOf(pool): ["647940293740443783605"]
  quoteExactInputSingle USDG->QQQ 10 USDG: [13290788930715593, "2889106137184833503989172979010803", 1, 108977]
  quoteExactInputSingle USDG->QQQ 100 USDG: [132907513458971103, "2889097967125831767128628278652530", 1, 117658]
  quoteExactInputSingle USDG->QQQ 1000 USDG: [1329037550940336050, "2889016269077180852481289113177107", 1, 117664]
  quoteExactInputSingle USDG->QQQ 10000 USDG: [13286601007321453687, "2888192282007028643230319147642731", 2, 146917]
  quoteExactInputSingle QQQ->USDG 132907513458971103 wei: [99899397, "2889116118279283905191033203292628", 1, 101468]
  TickLens words 81 to 82: 115 populated ticks
USDG.SPY.100 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5
  token0: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [0]
  slot0: ["2188368687178955204990906", -209950, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [51]
  SPY.balanceOf(pool): [1637607990426]
  quoteExactInputSingle USDG->SPY 10 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->SPY 100 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->SPY 1000 USDG: reverted: Unexpected error
  quoteExactInputSingle USDG->SPY 10000 USDG: reverted: Unexpected error
  TickLens words -825 to -817: 0 populated ticks
USDG.SPY.3000 0xA43b424Bc609495AED4BCD88d654934b510B0aD9
  token0: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [25193632080640499]
  slot0: ["2200010362641566333893046", -209843, 472, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [15393498405]
  SPY.balanceOf(pool): [14239417777305989221]
  quoteExactInputSingle USDG->SPY 10 USDG: [12930004724557521, "2200041715992196321090036", 1, 108540]
  quoteExactInputSingle USDG->SPY 100 USDG: [129283465183487102, "2200323896147866205862948", 1, 117223]
  quoteExactInputSingle USDG->SPY 1000 USDG: [1291173025229986786, "2203196655758335772189087", 2, 147394]
  quoteExactInputSingle USDG->SPY 10000 USDG: [12662217692138976051, "2254437528213728375287056", 7, 265846]
  quoteExactInputSingle SPY->USDG 129283465183487102 wei: [99372618, "2199697858674906162330901", 1, 110355]
  TickLens words -14 to -14: 34 populated ticks
USDG.SPY.500 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167
  token0: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [497042702308193619]
  slot0: ["2201210893525703610936775", -209833, 3010, 7200, 7200, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [240155608795]
  SPY.balanceOf(pool): ["153818977946974211008"]
  quoteExactInputSingle USDG->SPY 10 USDG: [12948466716066720, "2201212486719770544565767", 1, 108558]
  quoteExactInputSingle USDG->SPY 100 USDG: [129483823700188790, "2201226825466372947226697", 1, 117219]
  quoteExactInputSingle USDG->SPY 1000 USDG: [1294753896997365267, "2201370212932396973836003", 1, 117217]
  quoteExactInputSingle USDG->SPY 10000 USDG: [12939017395195763535, "2202827672985943175192928", 3, 171294]
  quoteExactInputSingle SPY->USDG 129483823700188790 wei: [99898579, "2201194969781452973298513", 1, 101572]
  TickLens words -83 to -82: 98 populated ticks
USDG.WETH.100 0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [6032060894225777713]
  slot0: ["4123042248115359960721211", -197280, 7790, 10809, 10809, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [15179075721013]
  WETH.balanceOf(pool): ["4079262510231989371301"]
  TickLens words -775 to -767: 1219 populated ticks
USDG.WETH.10000 0x5f009E071F07e92B6C624e83F52F17bBDa34680D
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [10000]
  tickSpacing: [200]
  liquidity: [61099494335029246]
  slot0: ["4136762687906894880755879", -197214, 1528, 2500, 2500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [139470991489]
  WETH.balanceOf(pool): ["43001548847573676262"]
  TickLens words -4 to -4: 38 populated ticks
USDG.WETH.3000 0xa9188730Fe85Be88ad499D7d52B099e800fB0334
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [271988101804266241]
  slot0: ["4121919494457005500000000", -197286, 1567, 2500, 2500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [1044883313744]
  WETH.balanceOf(pool): ["122932465623950380560"]
  TickLens words -13 to -13: 63 populated ticks
USDG.WETH.500 0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [1127596544251437409]
  slot0: ["4123646923394652991343092", -197277, 2855, 3000, 3000, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  USDG.balanceOf(pool): [3698140888028]
  WETH.balanceOf(pool): ["681400158606001140445"]
  TickLens words -78 to -77: 320 populated ticks
WETH.AAPL.100 0xe4D4BA605B042054Bd8815D515D98DdF46232622
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [0]
  slot0: ["184728927860996576643269939779", 16932, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [2]
  AAPL.balanceOf(pool): [1]
  TickLens words 62 to 70: 0 populated ticks
WETH.AAPL.500 0x8bb3514e2204E1cDF3Ac149EFEe7Ff04D91B719f
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9"]
  fee: [500]
  tickSpacing: [10]
  liquidity: ["2569060449174250372570"]
  slot0: ["226000163595171371452347407194", 20965, 9723, 10371, 10371, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): ["18933509483909643723"]
  AAPL.balanceOf(pool): ["438820983226109296695"]
  TickLens words 7 to 8: 167 populated ticks
WETH.NVDA.100 0x057A53e4b1b9a2fEBAE171A798E97c27300400c6
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [0]
  slot0: ["45694006087924044089880112", -149170, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [24]
  NVDA.balanceOf(pool): [21]
  TickLens words -587 to -579: 0 populated ticks
WETH.NVDA.10000 0x8b6a6416A5d1040EfCfa6234dA6AA1265DfE123e
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [10000]
  tickSpacing: [200]
  liquidity: ["68394428063916120873"]
  slot0: ["268814076071405601879734831707", 24434, 0, 1, 1, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [803698599374198886]
  NVDA.balanceOf(pool): [13161122132122068690]
  TickLens words 0 to 0: 4 populated ticks
WETH.NVDA.3000 0xC0Be1cb0f674D9737C72B2A63fC542361185b807
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: ["5313675874831869669408"]
  slot0: ["267837094533953013132884057122", 24362, 940, 1500, 1500, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): ["67537956313392500576"]
  NVDA.balanceOf(pool): ["659395069025090992255"]
  TickLens words 1 to 1: 120 populated ticks
WETH.NVDA.500 0x62AB521f71431f78ac374CdbadC6cda3c8916b6C
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC"]
  fee: [500]
  tickSpacing: [10]
  liquidity: ["14123535129975130115658"]
  slot0: ["268032145385168945226904748392", 24376, 4313, 7871, 7871, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): ["266778310895844306070"]
  NVDA.balanceOf(pool): ["2146076921369228501962"]
  TickLens words 9 to 9: 185 populated ticks
WETH.QQQ.10000 0x13444127F263A5Ac1C545EFcEc022b467DF91658
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [10000]
  tickSpacing: [200]
  liquidity: ["99128297958027149399"]
  slot0: ["150887717332124373221405819608", 12884, 21, 300, 300, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [3332266253085752904]
  QQQ.balanceOf(pool): [2742461210420309628]
  TickLens words 0 to 0: 4 populated ticks
WETH.QQQ.3000 0xA40D00a55d43bA2d188039DCF88bD68f4F133E78
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: ["2891384642463848001420"]
  slot0: ["150310011972287280854986749015", 12808, 414, 1400, 1400, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): ["64277085639908893332"]
  QQQ.balanceOf(pool): ["209981069932359321129"]
  TickLens words 0 to 0: 62 populated ticks
WETH.QQQ.500 0x8eC7Ef7B775B04ab1000A122Ce0ae1DcfF509A5C
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0xD5f3879160bc7c32ebb4dC785F8a4F505888de68"]
  fee: [500]
  tickSpacing: [10]
  liquidity: [0]
  slot0: ["146109870843489921766072468167", 12241, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [20]
  QQQ.balanceOf(pool): [30]
  TickLens words 4 to 5: 0 populated ticks
WETH.SPY.100 0x038fC7811482cb34d1204DA89A285325Cd094a02
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  fee: [100]
  tickSpacing: [1]
  liquidity: [0]
  slot0: ["141084082174650029018403734782", 11541, 0, 1, 1, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [69]
  SPY.balanceOf(pool): [36]
  TickLens words 41 to 48: 0 populated ticks
WETH.SPY.3000 0xe30Ac12Dc35faC73D2266FB68fe49bA47745b2c5
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  fee: [3000]
  tickSpacing: [60]
  liquidity: [0]
  slot0: ["146608661849075975454428085891", 12309, 0, 1, 1, 102, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): [2]
  SPY.balanceOf(pool): [8]
  TickLens words 0 to 0: 0 populated ticks
WETH.SPY.500 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e
  token0: ["0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73"]
  token1: ["0x117cc2133c37B721F49dE2A7a74833232B3B4C0C"]
  fee: [500]
  tickSpacing: [10]
  liquidity: ["15449289788042830733911"]
  slot0: ["148445531309515114333908740937", 12558, 3417, 5331, 5331, 68, true]
  factory: ["0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"]
  WETH.balanceOf(pool): ["146567066096194363031"]
  SPY.balanceOf(pool): ["1790056320171234315063"]
  TickLens words 4 to 5: 237 populated ticks
quote.hop.AAPL.100.100.10: reverted: Unexpected error
quote.hop.AAPL.100.100.100: reverted: Unexpected error
quote.hop.AAPL.100.100.1000: reverted: Unexpected error
quote.hop.AAPL.100.500.10: [30027523159104481, ["4123042379447322762766040", "225999237565779764480092839372"], [1, 1], 202549]
quote.hop.AAPL.100.500.100: [300264072598879274, ["4123043561434987981169509", "225990903645391402175003320279"], [1, 1], 211236]
quote.hop.AAPL.100.500.1000: [3001534619277789792, ["4123055381311640165204196", "225909475758055911409844353587"], [1, 1], 240228]
quote.hop.NVDA.100.100.10: reverted: Unexpected error
quote.hop.NVDA.100.100.100: reverted: Unexpected error
quote.hop.NVDA.100.100.1000: reverted: Unexpected error
quote.hop.NVDA.100.10000.10: [42070865693669838, ["4123042379447322762766040", "268765341145496448653974973204"], [1, 0], 209326]
quote.hop.NVDA.100.10000.100: [420023199683807086, ["4123043561434987981169509", "268327520846567531055928456749"], [1, 0], 209322]
quote.hop.NVDA.100.10000.1000: [4132895067756079910, ["4123055381311640165204196", "264026526977836478771560579155"], [1, 1], 209296]
quote.hop.NVDA.100.3000.10: [42068456326713356, ["4123042379447322762766040", "267836467283331581027290266338"], [1, 1], 201643]
quote.hop.NVDA.100.3000.100: [420675576006169633, ["4123043561434987981169509", "267830822161740876060605517397"], [1, 1], 211338]
quote.hop.NVDA.100.3000.1000: [4205830863008626656, ["4123055381311640165204196", "267771266209630431876140515812"], [1, 2], 241648]
quote.hop.NVDA.100.500.10: [42235453747562421, ["4123042379447322762766040", "268031908458835518004946606548"], [1, 1], 202634]
quote.hop.NVDA.100.500.100: [422351056371475978, ["4123043561434987981169509", "268029776141362467050924773414"], [1, 1], 202634]
quote.hop.NVDA.100.500.1000: [4223162484858237163, ["4123055381311640165204196", "268008454899706536638091327146"], [1, 1], 211319]
quote.hop.QQQ.100.10000.10: [13256639884676085, ["4123042379447322762766040", "150877121980032068434327653831"], [1, 0], 211265]
quote.hop.QQQ.100.10000.100: [132482634363209979, ["4123043561434987981169509", "150781830759855265740377833720"], [1, 0], 211275]
quote.hop.QQQ.100.10000.1000: [1316507750626531711, ["4123055381311640165204196", "149835500234014890969235766450"], [1, 1], 211275]
quote.hop.QQQ.100.3000.10: [13249238342296421, ["4123042379447322762766040", "150309648923804157147575625145"], [1, 1], 211273]
quote.hop.QQQ.100.3000.100: [132489465387547206, ["4123043561434987981169509", "150306381567414476445190723661"], [1, 1], 211261]
quote.hop.QQQ.100.3000.1000: [1324602921012256455, ["4123055381311640165204196", "150273715917465809457797476024"], [1, 1], 211247]
quote.hop.QQQ.100.500.10: reverted: Unexpected error
quote.hop.QQQ.100.500.100: reverted: Unexpected error
quote.hop.QQQ.100.500.1000: reverted: Unexpected error
quote.hop.SPY.100.100.10: reverted: Unexpected error
quote.hop.SPY.100.100.100: reverted: Unexpected error
quote.hop.SPY.100.100.1000: reverted: Unexpected error
quote.hop.SPY.100.3000.10: reverted: Unexpected error
quote.hop.SPY.100.3000.100: reverted: Unexpected error
quote.hop.SPY.100.3000.1000: reverted: Unexpected error
quote.hop.SPY.100.500.10: [12955012776168503, ["4123042379447322762766040", "148445464872683927501912129787"], [1, 0], 202935]
quote.hop.SPY.100.500.100: [129549568803173778, ["4123043561434987981169509", "148444866944069737378685164317"], [1, 0], 202935]
quote.hop.SPY.100.500.1000: [1295439794833352036, ["4123055381311640165204196", "148438887941696877282026011511"], [1, 0], 211616]
quote.weth.100.1000: [369214528924082973, "4123055381311640165204196", 1, 91478]
quote.weth.10000.1000: [363026555871026665, "4138046428169277923765229", 1, 100176]
quote.weth.3000.1000: [368319504024668483, "4122209913330120642081840", 1, 100170]
quote.weth.500.1000: [368953491068365687, "4123717151127113431844703", 1, 91539]
```

## Appendix C: tick walk

The depth numbers come from this walk over the TickLens output. Q96 = 2^96, sqrt_at(t) = 1.0001^(t / 2) * Q96, ticks maps tick to liquidityNet, and the walk starts at slot0 sqrtPriceX96, slot0 tick and liquidity().

```
def walk(sqrtP, tick, L, ticks, target, up):
    cur, liq, a0, a1 = sqrtP, L, 0, 0
    if up:   # price rises: token1 in, token0 out
        for t in sorted(k for k in ticks if k > tick):
            st = sqrt_at(t)
            if st >= target: break
            a1 += liq * (st - cur) / Q96; a0 += liq * Q96 * (st - cur) / (cur * st)
            liq += ticks[t]; cur = st
        a1 += liq * (target - cur) / Q96; a0 += liq * Q96 * (target - cur) / (cur * target)
    else:    # price falls: token0 in, token1 out
        for t in sorted((k for k in ticks if k <= tick), reverse=True):
            st = sqrt_at(t)
            if st <= target: break
            a0 += liq * Q96 * (cur - st) / (cur * st); a1 += liq * (cur - st) / Q96
            liq -= ticks[t]; cur = st
        a0 += liq * Q96 * (cur - target) / (cur * target); a1 += liq * (cur - target) / Q96
    return a0, a1
```

For token0 = SPY, depth +x% is a1 from walk(target = sqrtP * sqrt(1 + x), up) and depth -x% is a1 from walk(target = sqrtP * sqrt(1 - x), down). For token0 = USDG, depth +x% is a0 from walk(target = sqrtP / sqrt(1 + x), down) and depth -x% is a0 from walk(target = sqrtP / sqrt(1 - x), up). Amounts are divided by 10^6 for USDG.
