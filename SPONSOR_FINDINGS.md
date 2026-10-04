# Findings for Robinhood Chain and its integrations

Building Sleeve meant checking Robinhood Chain, the Stock Token contracts, Chainlink's feeds, the Uniswap pools, ZeroDev's Kernel stack, USDG and the RPC providers against what the chain actually returns. This file lists what we found, for the teams that run those systems and for anyone reviewing Sleeve. Each finding says what we found, how we checked it, what it meant for Sleeve, and what we did about it.

Where a finding is a documentation or code issue another team can fix, it links to the issue drafted in [CONTRIBUTIONS.md](CONTRIBUTIONS.md) by its id. Those drafts carry the full commands, outputs and suggested fixes. None has been filed yet.

The checks ran between 2 and 4 October 2026: the research notes in [docs/research/](docs/research/README.md), the gate checks in [docs/GATES.md](docs/GATES.md), and the deploy and live services in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md). None of these checks sent a transaction, apart from the deploy itself. Block numbers are Robinhood Chain L2 blocks. A rerun reads later blocks, so counts and ages can move.

Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Limited. Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc., and nothing here implies that any team named below works with Sleeve or endorses it.

## Summary

| # | Finding | Upstream draft |
| --- | --- | --- |
| 1 | Stock Token feeds hold their last price off-hours, so feed age cannot detect a closed market | [R9], [C3] |
| 2 | Chainlink publishes no sequencer uptime feed for Robinhood Chain | [R2] |
| 3 | Only 36 of 194 Stock Tokens have a Chainlink feed | [R3] |
| 4 | The launch feeds' first rounds are about 1e8 times too large | [C1] |
| 5 | block.number is an L1 estimate, and ArbSys gives the L2 block | none needed |
| 6 | The public RPC keeps minutes of state, caps log ranges and challenges bursts | [R10] |
| 7 | QuickNode and dRPC have their own log limits | none |
| 8 | The L1 data component moved from 0 to 514,701 gas within 21 minutes | none |
| 9 | The explorer named for verification challenges scripts, and Sourcify works | none |
| 10 | Stock Tokens are beacon proxies with one pause and one blocklist for all of them | none |
| 11 | oraclePaused() has never fired, and multiplier changes come about ten minutes ahead | [R8], [E1], [R7] |
| 12 | The issuer's API and the docs disagree in three places | [R1], [R4], [R5] |
| 13 | Each Stock Token has many pools, with extreme fee tiers and fees hidden in v4 hooks | none |
| 14 | SPY's main USDG pool first quoted at about twice the reference | none |
| 15 | Kernel v3.1 runs validation hooks on the root validator, while Kernel's newer source exempts it | none |
| 16 | Kernel v3.1 ignores a reverting onUninstall | none |
| 17 | An ECDSA root can act on the account directly, skipping the EntryPoint | none |
| 18 | The Kernel factories are not staked in the EntryPoint on chain 4663 | [Z2] |
| 19 | The P-256 precompile is live, and ZeroDev's SDK does not use it on chain 4663 | [Z1], [Z3] |
| 20 | ZeroDev sponsors on chain 4663 through its relayer, with a zero gas price and no paymaster | none |
| 21 | The build behind each deployed Kernel contract, and the addresses per chain, are not documented | [Z5] |
| 22 | Without initConfig, a Kernel address commits only to the owner and the salt | none |
| 23 | USDG's permit is served by a facet with unverified bytecode | [P1] |
| 24 | Two Morpho Blue market oracles apply the multiplier the feed already includes | [M1] |
| 25 | systemd 259 hands LoadCredential secrets to the service as 0440 root:root | none |

## Market data

### 1. Stock Token feeds hold their last price off-hours, so feed age cannot detect a closed market

| Field | Detail |
| --- | --- |
| What we found | Chainlink's directory lists the SPY, QQQ, NVDA and AAPL feeds with 8 decimals, an 86,400-second heartbeat, a 0.5 percent deviation threshold and "us_equities_24/5" hours. The feeds post nothing between the Friday 20:00 close and the Sunday 20:00 New York reopen and keep returning Friday's last round, a gap of 52.07 to 55.96 hours over the weekend of 25 to 28 September 2026. At 14:00 New York time on Saturday 26 September (block 73,280,794), NVDA's round was 22.07 hours old and AAPL's 22.18 hours, so both passed a 24-hour heartbeat check while pools traded. SPY and QQQ failed it only because their last Friday rounds came earlier in the day. After each reopen the first new round lands 18 to 69 seconds later, so for that minute the feed still holds the pre-close price. |
| How we checked | latestRoundData at block 78,660,590 against the directory file, sha256 714038ab...f776 ([docs/GATES.md](docs/GATES.md) G4). AnswerUpdated logs over the weekend ([docs/research/chain-constants.md](docs/research/chain-constants.md) section 4). All 2,414 rounds of the four feeds up to 2 October against the 24/5 rule ([docs/research/session-calendar.md](docs/research/session-calendar.md) section 8). Fork test `test_fork_weekend_nvdaAndAaplFeedsUnder25Hours_ageCannotDetectTheClosure` at block 73,280,794 ([contracts/test/fork/PriceGuard.t.sol](contracts/test/fork/PriceGuard.t.sol)). |
| Impact on Sleeve | A guard that trusts feed age, as the oracles page in Robinhood Chain's docs advises, would let a Saturday buy of NVDA or AAPL price against Friday's close. |
| What we did | Market state comes from SessionCalendar, an onchain 24/5 calendar with precomputed daylight-saving switches and the NYSE holidays and early closes for 2026 and 2027, extended only through the 48-hour timelock (D-017 in [docs/DECISIONS.md](docs/DECISIONS.md)). PriceGuard also refuses a round whose startedAt or updatedAt is before the session's opening (D-026). On the fork, a weekend split queues SESSION on every allowlisted pool, and a split 30 seconds after the Sunday reopen queues STALE ([contracts/test/fork/SleeveModuleWeekend.t.sol](contracts/test/fork/SleeveModuleWeekend.t.sol)). The calendar matched an independent calendar at 13,224 boundary and 5,000 random instants ([SECURITY.md](SECURITY.md)). The gap we kept: a closure announced too late for the 48-hour timelock is not in the calendar, so buys can fill on the held round, inside the cap, for up to about 25 hours (audit A1-02, kept as built by D-028). |

### 2. Chainlink publishes no sequencer uptime feed for Robinhood Chain

| Field | Detail |
| --- | --- |
| What we found | The oracles page in Robinhood Chain's docs tells integrators to check Chainlink's L2 Sequencer Uptime Feed before reading a price, with a snippet and no address. Chainlink's directory for Robinhood Chain mainnet has 58 rows and none for uptime or the sequencer, and Chainlink's L2 sequencer page says Chainlink "is no longer expanding L2 Sequencer Uptime Feeds to additional networks". |
| How we checked | The directory and Chainlink's docs source fetched on 3 October 2026 and searched with jq and grep ([R2], [docs/research/chain-constants.md](docs/research/chain-constants.md) section 4). |
| Impact on Sleeve | Sleeve has no onchain signal that the sequencer was down, so prices right after an outage get no special treatment. |
| What we did | Sleeve does not fake one. Every buy still has to pass the calendar, the feed age and fresh-round rule, and the premium cap, and [SECURITY.md](SECURITY.md) lists the gap. |

### 3. Only 36 of 194 Stock Tokens have a Chainlink feed

| Field | Detail |
| --- | --- |
| What we found | Robinhood Chain's docs say every Stock Token has a live Chainlink price feed. The issuer's assets API lists 194 Stock Tokens, and Chainlink's directory has feeds for 36 of them: 35 on 24/5 equity hours and GLD / USD, a DEX-state price on crypto hours. |
| How we checked | The assets API response (sha256 3e378f9c...e78c, saved as [docs/research/assets-api/all-assets.json](docs/research/assets-api/all-assets.json)) matched against the directory on 3 October 2026 ([R3]). |
| Impact on Sleeve | The guard needs an independent reference. A token with no feed has none, and a DEX-state feed may move with the same pools Sleeve would buy from. |
| What we did | A rule can target only a ticker TokenSource lists, and it lists four, SPY, QQQ, NVDA and AAPL, each with a 24/5 Chainlink feed. A ticker without a feed cannot be a rule target (D-017), and TokenSource's constructor reverts on a feed that does not report 8 decimals ([contracts/src/TokenSource.sol](contracts/src/TokenSource.sol)). |

### 4. The launch feeds' first rounds are about 1e8 times too large

| Field | Detail |
| --- | --- |
| What we found | Rounds 1 to 7 of SPY, 1 to 13 of QQQ, 1 to 24 of NVDA and 1 to 17 of AAPL carry answers about 1e8 times the normal scale. SPY's round 1 reads as 74,244,000,000 USD at 8 decimals. The last of them landed by 13:48 UTC on 23 June 2026. |
| How we checked | getRoundData on the public RPC on 3 October 2026 ([C1]), and the HP2 replay's data notes ([docs/HP2_RESULTS.md](docs/HP2_RESULTS.md)). |
| Impact on Sleeve | Anything that walks a feed's history from round 1, such as a backtest or the HP2 replay, sees absurd prices. |
| What we did | The HP2 protocol drops rounds above 10 times the feed's median, which removed 7, 13, 24 and 17 rounds, all before every replay window ([docs/HP2_PROTOCOL.md](docs/HP2_PROTOCOL.md)). Each receipt names the round it used, so the verifier never reads these. |

## Robinhood Chain node, RPC and tooling

### 5. block.number is an L1 estimate, and ArbSys gives the L2 block

| Field | Detail |
| --- | --- |
| What we found | Inside a contract, block.number returns an estimate of the Ethereum L1 block. At L2 block 78,327,113, Multicall3's getBlockNumber(), which returns block.number, gave 26,105,440, the header's l1BlockNumber, while ArbSys arbBlockNumber() at 0x0000000000000000000000000000000000000064 returned 78,327,113. Robinhood Chain's "Differences from Ethereum" page says the same, so nothing needs fixing upstream. |
| How we checked | cast calls at the pinned block ([docs/research/chain-constants.md](docs/research/chain-constants.md) section 2). |
| Impact on Sleeve | A receipt that stored block.number would point at the wrong block. |
| What we did | Every receipt records ArbSys arbBlockNumber() as its L2 block ([contracts/src/libraries/SleeveReceipts.sol](contracts/src/libraries/SleeveReceipts.sol)). The calendar and the grace clock run on block.timestamp, and no Sleeve contract reads block.number. |

### 6. The public RPC keeps minutes of state, caps log ranges and challenges bursts

| Field | Detail |
| --- | --- |
| What we found | https://rpc.mainnet.chain.robinhood.com served state 1,000 blocks back and refused it 10,000 blocks back ("historical state ... is not available"). At about 9.9 blocks a second, the window was between about 2 and 17 minutes. eth_getLogs allows 10,000,000 blocks per call with one address and one topic, and 100,000 with a list in one position. After about 10 to 15 quick calls the endpoint answered HTTP 403 with a Cloudflare "Just a moment..." page, which cleared about 13 minutes later. Robinhood Chain's Terms say the public RPC is rate limited and not meant for production traffic, and the connecting page gives no numbers. |
| How we checked | cast calls on 2 and 3 October 2026 ([R10], [docs/research/chain-constants.md](docs/research/chain-constants.md) sections 0 and 8, D-008 and D-012). |
| Impact on Sleeve | A fork pinned to a block stops working within minutes. A client that bursts gets an HTML page instead of a JSON-RPC error. The verifier still has to use this endpoint, because it must never share a provider with the keeper. |
| What we did | Fork tests read the dRPC archive endpoint (D-008), and the keeper reads and sends through its own QuickNode endpoint (D-032). The verifier and the app's public-RPC transport send one request at a time and retry HTTP 429, Cloudflare challenge pages and gateway errors after growing pauses ([packages/verifier/src/transport.ts](packages/verifier/src/transport.ts), [app/src/lib/chain/transport.ts](app/src/lib/chain/transport.ts)). |

### 7. QuickNode and dRPC have their own log limits

| Field | Detail |
| --- | --- |
| What we found | QuickNode caps the blocks per eth_getLogs call, so reading the module's logs from its deploy block takes hundreds of calls as the chain grows, where the public RPC answers the same range in one call. dRPC's free tier answers eth_getLogs for at most 101 blocks on this chain, refused the deploy read-back's event-history query, and refuses eth_getProof, while it serves the archive state the fork tests need. |
| How we checked | D-035 in [docs/DECISIONS.md](docs/DECISIONS.md), the keeper's fork test notes in [keeper/README.md](keeper/README.md), the read-back record in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md), and [docs/research/chain-constants.md](docs/research/chain-constants.md) section 8. |
| Impact on Sleeve | Which provider serves logs decides how fast the app's history loads and where the read-back can run. |
| What we did | The app sends eth_getLogs to the public RPC and every other read to a QuickNode endpoint locked to trysleeve.xyz, whose 14-method allowlist leaves eth_getLogs out (D-035, [app/src/lib/chain/transport.ts](app/src/lib/chain/transport.ts)). The keeper starts at 10,000-block log ranges and narrows them when a provider refuses ([keeper/deploy/keeper.env.example](keeper/deploy/keeper.env.example)). The read-back has passed only on the public RPC, and no rerun on a second provider is recorded yet. |

### 8. The L1 data component moved from 0 to 514,701 gas within 21 minutes

| Field | Detail |
| --- | --- |
| What we found | On 2 October 2026 the chain charged nothing for L1 data: ArbGasInfo reported an L1 calldata price of 0, and NodeInterface's gasEstimateL1Component returned 0 gas for 20 KB of calldata. On 3 October, three deploy dry runs read the L1 component for the seven deploy transactions together at 0 gas (18:21 UTC, block 79,291,580), 102,362 gas (18:29, block 79,296,234) and 514,701 gas (18:42, block 79,304,056). |
| How we checked | [docs/FUNDING.md](docs/FUNDING.md), and [docs/DEPLOY_PLAN.md](docs/DEPLOY_PLAN.md) section 6, priced by [contracts/script/gas_report.py](contracts/script/gas_report.py). |
| Impact on Sleeve | Gas measured on a fork leaves this component out. At 514,701 gas it was 2.6 to 3.1 percent of each deploy transaction's execution gas. |
| What we did | The deploy plan reads it again in its pre-flight step and relies on forge's 30 percent gas margin, which covered the peak reading. [docs/GAS.md](docs/GAS.md) states that its fork figures leave it out, and mainnet gas per split will come from HP1 receipts. |

### 9. The explorer named for verification challenges scripts, and Sourcify works

| Field | Detail |
| --- | --- |
| What we found | Robinhood Chain's deploy guide gives a Blockscout verify command for https://robinhoodchain.blockscout.com/api/. From scripts, the explorer answered HTTP 403 with `cf-mitigated: challenge` to curl and a Cloudflare challenge page to `forge verify-check`. Blockscout's PRO API answered HTTP 402 and asked for an API key or a payment. Sourcify answered without a key and lists chain 4663. |
| How we checked | Requests on 3 October 2026 between 18:01 and 18:12 UTC ([docs/DEPLOY_PLAN.md](docs/DEPLOY_PLAN.md) section 11). |
| Impact on Sleeve | The documented command cannot run from a deploy script without a key. |
| What we did | All seven Sleeve contracts are verified on Sourcify with an exact match for runtime and creation code, and the Blockscout explorer reads Sourcify. Direct Blockscout verification waits on a free API key ([docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)). |

## Stock Token contracts and issuer data

### 10. Stock Tokens are beacon proxies with one pause and one blocklist for all of them

| Field | Detail |
| --- | --- |
| What we found | Each launch Stock Token is an OpenZeppelin BeaconProxy. Its beacon, 0xe10b6f6B275de231345c20D14Ab812db62151b00, is also the AccessControlsRegistry: one contract that holds the implementation, a global pause and one address blocklist for every Stock Token behind it. token.paused() already includes the global pause, and tokenPaused() alone would miss it. Transfers check the sender, the recipient and the caller, so a blocked pool or router makes a swap revert. By block 78,335,689 the registry had emitted 246 Blocked events for 177 accounts and two Upgraded events. |
| How we checked | The EIP-1967 beacon slot of all four tokens and the verified sources on Sourcify ([docs/research/chain-constants.md](docs/research/chain-constants.md) section 3). Fork test `test_fork_inSession_blockedAccount_signalsRefusedAccount`, with an address the registry blocks at block 78,312,136 ([contracts/test/fork/PriceGuard.t.sol](contracts/test/fork/PriceGuard.t.sol)). |
| Impact on Sleeve | A buy for a blocked account, or through a blocked pool, cannot complete, and one pause stops every Stock Token at once. |
| What we did | PriceGuard reads the registry through token.ACCESS_CONTROLLED_REGISTRY() on every call, so it follows the issuer's live state (D-011). A blocked account gets REFUSED_ACCOUNT and its equity share goes to spend. A blocked pool reverts PoolBlocked, so the trigger can pick another allowlisted pool (D-018). A paused token queues PAUSED. Sells check the account, the pool and the router (D-027). The issuer can still freeze or block, and [SECURITY.md](SECURITY.md) says Sleeve cannot prevent that. |

### 11. oraclePaused() has never fired, and multiplier changes come about ten minutes ahead

| Field | Detail |
| --- | --- |
| What we found | The oracles page in Robinhood Chain's docs describes oraclePaused() as the signal for corporate-action processing. None of the four launch tokens has ever emitted OraclePaused, including around their four multiplier changes, and on 3 October NVDA's oraclePaused() read false while the issuer's corporate-actions API listed an NVDA action in progress. Each of the four multiplier changes was scheduled 580 to 588 seconds ahead, and the token's updateMultiplier(uint256) can also make a change effective in the same block. The tokens emit TransferWithScaledUI where the ERC-8056 draft names the event TransferWithUIAmount (119,648 against 0 logs on SPY between blocks 77,660,000 and 78,660,000), and they have no UIMultiplierUpdateCancelled event. |
| How we checked | Event scans from block 0 ([docs/research/chain-constants.md](docs/research/chain-constants.md) section 3, [R8]) and the verified Stock source on Sourcify ([E1], [R7]). |
| Impact on Sleeve | oraclePaused() cannot be Sleeve's corporate-action guard, the warning before a multiplier change is about ten minutes, and a change made effective at once never looks pending. |
| What we did | The guard queues MULTIPLIER while a different multiplier is scheduled within 24 hours, treats oraclePaused() as one more reason to queue, and keeps feed age as the main check. Sleeve never applies uiMultiplier() to the feed price, which already includes it, and FILLED and SETTLED receipts record uiMultiplier at the fill ([docs/SPEC.md](docs/SPEC.md) section 13). |

### 12. The issuer's API and the docs disagree in three places

| Field | Detail |
| --- | --- |
| What we found | The Stock Token APIs page documents tradingCapabilities.allDayTradability, which none of the 194 assets in the live API carries. The live shape is market, extended and overnight, each with whole and fractional. The Token Contracts page says its table is "generated live from the on-chain asset registry", but its code fetches https://api.robinhood.com/rhj/assets, and no registry contract address is published. The price deviations page drops the sign and the direction of each deviation, because it looks up PREMIUM and DISCOUNT while the API returns DEVIATION_DIRECTION_PREMIUM and DEVIATION_DIRECTION_DISCOUNT. |
| How we checked | curl and jq on the API and on the docs' JavaScript chunks, 3 October 2026 ([R1], [R4], [R5], [docs/GATES.md](docs/GATES.md) G3). |
| Impact on Sleeve | The field Sleeve planned to read each ticker's session type from does not exist, and there is no onchain list of canonical Stock Tokens to read. |
| What we did | Each launch ticker's session type was read from tradingCapabilities.overnight.whole, TRADING_STATUS_TRADABLE for all four, and set to ALL_DAY in TokenSource's constructor ([docs/research/session-calendar.md](docs/research/session-calendar.md) Q1, D-014). TokenSource mirrors the canonical list behind the 48-hour timelock and can only shrink, and each launch token's uid() equals its id in the API, which gives an onchain cross-check. Gate G3 stays PARTIAL. |

## Uniswap pools

### 13. Each Stock Token has many pools, with extreme fee tiers and fees hidden in v4 hooks

| Field | Detail |
| --- | --- |
| What we found | The Uniswap v3 factory enables only the 100, 500, 3,000 and 10,000 fee tiers, and v3 holds 13 USDG pools across the four launch tokens. PoolCreated logs show 891 v3 pools that include one of the four tokens, nearly all paired with unrelated tokens. On v4, 614 USDG pools were initialized for the four tokens: 273 use a dynamic fee, static fees reach 999,999, which is 99.9999 percent, 76 static fees are 10 percent or more, and only 96 held liquidity at block 78,329,921. On three hooked dynamic-fee pools with tens of thousands of USDG near the price, StateView reported an LP fee of 0 while a 100 USDG quote paid 5.18 (AAPL), 8.02 (SPY) and 34.66 (NVDA) bps over mid. A v3 pool can also fill only part of an exact-input swap when it runs out of the token. |
| How we checked | Factory reads, PoolCreated and Initialize logs, StateView, QuoterV2 and the v4 Quoter at pinned blocks on 2 October 2026 ([docs/research/pools.md](docs/research/pools.md)). |
| Impact on Sleeve | Picking a pool by its fee field or a quote alone can pay a hidden fee, a lookalike pool's price or a partial fill. |
| What we did | Each ticker has an allowlist picked by depth: the USDG fee-500 pool for each, plus AAPL's fee-3000 pool (D-010). TokenSource accepts a pool only if the v3 factory lists it for USDG and that token at fee 100, 500 or 3,000. The price on every receipt is measured from the balances that left and entered the account, a fill must also show on the pool's own balances (FillNotFromPool), a partial fill reverts, and the premium cap applies to that all-in price. v4 pools stay out of M0. |

### 14. SPY's main USDG pool first quoted at about twice the reference

| Field | Detail |
| --- | --- |
| What we found | SPY's USDG fee-500 pool, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, returned no working quote at any of the 323 blocks the HP2 replay quoted from 14 August 2026 to 03:30 UTC on 19 August. Its first working quote, at 03:45 UTC on 19 August, priced 100 USDG at 9,904.79 bps over the Chainlink round in force, and 1,000 USDG at 99,190.01 bps. |
| How we checked | The replay's committed chain data and outputs ([docs/HP2_RESULTS.md](docs/HP2_RESULTS.md) Data notes, `results/hp2/`), rerunnable offline with `scripts/hp2/.venv/bin/python scripts/hp2/run.py`. |
| Impact on Sleeve | A buy at that quote would have paid about twice the reference. In the provisional HP2 result, buying at arrival paid on average 309.11 bps more over the reference than Sleeve's guarded policy (95 percent bootstrap interval 209.24 to 419.12), and SPY accounts for 307.97 bps of that, almost all of it from this launch. On the other 934 payments, whose arrival fill was within the 100 bps cap, waiting cost 1.66 bps per payment on average, counting the payments that did not wait. |
| What we did | In the replay the premium cap refused that price, and the guarded policy bought at 04:30 UTC and paid -20.47 bps. A third policy that keeps the calendar and drops the Chainlink check paid on average 309.13 bps more than the guarded policy (95 percent interval 209.58 to 418.70), again almost all of it this one event, so the figure is never presented as a typical saving. The result stays provisional until the protocol's rerun on a second provider (D-020). |

## Account stack: Kernel and ZeroDev

### 15. Kernel v3.1 runs validation hooks on the root validator, while Kernel's newer source exempts it

| Field | Detail |
| --- | --- |
| What we found | In the Kernel v3.1 that ZeroDev deploys on chain 4663, a hook on the root validator wraps every root UserOp: the UserOp has to go through executeUserOp, and plain execute fails validation. Kernel's newer source on its default branch, v4, exempts the root validator from validation hooks by design. The v3.2 and v3.3 tags behave like v3.1. Our planning had assumed the v4 behavior. |
| How we checked | `test_recipe_rootHookIsEnforcedOnUserOps` on the deployed implementation, forked at block 78,312,136 ([contracts/test/spike/G6Spike.t.sol](contracts/test/spike/G6Spike.t.sol), [docs/research/g6-notes.md](docs/research/g6-notes.md) section 11). The implementation, the factory and the meta factory match tag v3.1 outside their immutables ([contracts/test/spike/kernel-bytecode-check.sh](contracts/test/spike/kernel-bytecode-check.sh)). |
| Impact on Sleeve | Income accounting built on a hook would behave differently depending on the Kernel version. |
| What we did | Sleeve relies on no hook. Every owner UserOp the app builds starts with beginOwnerOp and ends with endOwnerOp, which behave the same on either version, and the module is installed with Kernel's no-hook setting (`test_fork_installedAccountListsTheModuleWithTheNoHookSentinel`). |

### 16. Kernel v3.1 ignores a reverting onUninstall

| Field | Detail |
| --- | --- |
| What we found | Kernel v3.1 calls a module's onUninstall with the gas left and ignores the result, so a reverting onUninstall cannot block the uninstall and its cleanup can be skipped silently. An onUninstall that runs out of gas changes the outcome with the call gas limit: at 100,000 the whole uninstall failed, and at 1,000,000 it completed with ModuleUninstallResult false. |
| How we checked | `test_recipe_uninstallIgnoresRevertingOnUninstall` and `test_recipe_outOfGasOnUninstallDependsOnCallGasLimit` ([docs/research/g6-notes.md](docs/research/g6-notes.md) section 7). |
| Impact on Sleeve | Sleeve's onUninstall releases every waiting bucket to spend. A skipped release would leave ledgers behind. |
| What we did | The module refuses onUninstall with ModuleStillListed while the account still lists it (audit A1-24, D-026), and onInstall releases any buckets a failed onUninstall left behind (D-019). The app's uninstall op carries a fixed 450,000 call gas and refuses to send below 400,000 ([app/src/lib/chain/owner-ops.ts](app/src/lib/chain/owner-ops.ts)). Settings sends it through Remove Sleeve, and the app accepts a removal only when the transaction carries ModuleUninstallResult(module, true) and the account then reads back without the module (D-040). |

### 17. An ECDSA root can act on the account directly, skipping the EntryPoint

| Field | Detail |
| --- | --- |
| What we found | The ECDSA validator is also a hook-type module, and Kernel v3.1 lets through any caller the root validator's preCheck accepts. With an ECDSA root, the owner's key can call execute, installModule and the rest directly, with no UserOp and no brackets. A passkey root cannot. |
| How we checked | `test_recipe_rootOwnerCanCallAccountDirectly` ([docs/research/g6-notes.md](docs/research/g6-notes.md) section 11). |
| Impact on Sleeve | An account owned by a connected wallet can move USDG outside Sleeve, so the owner's own USDG can look like income. |
| What we did | The app tells a person who picks a wallet as owner that the wallet can sign outside Sleeve (WALLET_OWNER_LINE in [app/src/lib/signer.ts](app/src/lib/signer.ts), D-022). Every receipt records the accounting mode, WRAPPED, and Sleeve claims exact sorting only for actions taken through Sleeve. |

### 18. The Kernel factories are not staked in the EntryPoint on chain 4663

| Field | Detail |
| --- | --- |
| What we found | ZeroDev's meta factory, 0xd703aaE79538628d27099B8c4f621bE4CCd142d5, and the Kernel v3.1 factory have no stake and no deposit in EntryPoint v0.7 on chain 4663, while on Arbitrum One the meta factory has 0.1 ETH staked with a one-day unstake delay. ERC-7562 lets a deploying UserOp touch storage outside the account only through a staked factory. Bundlers on chain 4663 accept these UserOps today: at least 5,486 accounts were deployed through the unstaked meta factory. |
| How we checked | getDepositInfo on both chains on 3 October 2026 ([Z2]), and account deployments counted from logs ([docs/research/zerodev-passkey.md](docs/research/zerodev-passkey.md) section 3.4). |
| Impact on Sleeve | A strict bundler could refuse a new account's first UserOp, and a module whose onInstall reads outside storage, as Sleeve's reads USDG and TokenSource, cannot run in the deploying UserOp's validation. |
| What we did | The app deploys the account with its first UserOp, with no initConfig, and installs the module in that UserOp's callData, so onInstall runs in the execution phase. It shows the payment address only after the module reports the account initialized and Kernel reports the module installed (D-019). In a prepare-only check on 4 October, ZeroDev's bundler estimated and agreed to sponsor a first UserOp with initCode. The first real sign-up will confirm inclusion ([SECURITY.md](SECURITY.md)). |

### 19. The P-256 precompile is live, and ZeroDev's SDK does not use it on chain 4663

| Field | Detail |
| --- | --- |
| What we found | P256VERIFY answers at 0x0000000000000000000000000000000000000100 and returns 1 for go-ethereum's test vector. It costs about 6,900 gas, the EIP-7951 price, where ZeroDev's docs quote 3,450. The SDK's RIP7212_SUPPORTED_NETWORKS list leaves out 4663, so a default passkey signature sets usePrecompiled to false and the validator runs the Solidity verifier. On live state, validateUserOp cost 66,033 gas on the precompile path and 414,058 on the Solidity path, and a first UserOp 497,093 against 838,964. The latest passkey account deployment by another app on chain 4663 took the Solidity path and used 773,418 gas. |
| How we checked | Live eth_call and eth_estimateGas on 3 October 2026 ([Z1], [Z3]), gas measured on live state with overrides ([docs/research/zerodev-passkey.md](docs/research/zerodev-passkey.md) sections 4 and 5), and G6 item i in [docs/GATES.md](docs/GATES.md). Forge's EVM has no precompile at 0x100, so a fork test cannot cover this path. |
| Impact on Sleeve | With the SDK's defaults, every passkey UserOp on chain 4663 pays about 325,000 to 348,000 more gas than it needs to. |
| What we did | Sleeve encodes passkey signatures with usePrecompiled set to true, and its gas estimates use a stub signature on the same path ([app/src/lib/chain/webauthn.ts](app/src/lib/chain/webauthn.ts), D-030). |

### 20. ZeroDev sponsors on chain 4663 through its relayer, with a zero gas price and no paymaster

| Field | Detail |
| --- | --- |
| What we found | ZeroDev sponsored a throwaway Kernel account's first UserOp under Sleeve's chain gas policy, and the sponsored op came back with a zero gas price and no paymaster. On chain 4663, ZeroDev's relayer pays the gas. |
| How we checked | A prepare-only probe on 4 October 2026, built like the app's zeroDevRoute ([app/src/data/chain/user-ops.ts](app/src/data/chain/user-ops.ts)), with nothing sent, under a policy of 0.00075 ETH a day, 0.0002 ETH a UserOp and 50 requests a day below a 0.5 gwei gas price. The result is recorded in [docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md). The probe script itself is not in the repo. |
| Impact on Sleeve | A sponsored Sleeve UserOp will show no paymaster onchain, and its gas falls on ZeroDev's relayer within Sleeve's policy instead of on the account ([docs/GAS.md](docs/GAS.md)). |
| What we did | The app counts an op as sponsored when ZeroDev's sponsorUserOperation accepts it, and falls back to the account's own ETH when it refuses. No owner UserOp has run on mainnet yet, so a sponsored owner action is still unconfirmed, and claim 6.9 in [docs/CLAIM_LEDGER.md](docs/CLAIM_LEDGER.md) stays pending. |

### 21. The build behind each deployed Kernel contract, and the addresses per chain, are not documented

| Field | Detail |
| --- | --- |
| What we found | The ECDSA validator the SDK uses for Kernel v3.1, 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57, does not match tag v3.1 (1,762 bytes compiled against 1,819 deployed). It matches commit e18c700, "v3.1 rc1", whose onInstall refuses an account that already has an owner. Kernel's foundry.toml at v3.1 does not reproduce the deployed build. The SDK maps passkey validators 0.0.1 and 0.0.2 and its ONLY_ENTRYPOINT_HOOK_ADDRESS for Kernel v3.x, and none of the three has code on chain 4663. Passkey validator 0.0.3 does. |
| How we checked | [contracts/test/spike/kernel-bytecode-check.sh](contracts/test/spike/kernel-bytecode-check.sh) and `cast codesize` ([Z5], [docs/GATES.md](docs/GATES.md) G6). |
| Impact on Sleeve | An auditor rebuilding from the tag gets a mismatch. Because of the one-line difference, a wallet-owned account cannot add a second ECDSA validator as a recovery signer ([docs/research/wallet-connect.md](docs/research/wallet-connect.md)). |
| What we did | Sleeve vendors Kernel at the v3.1 tag commit, keeps the script that rechecks the deployed bytecode against it, and uses passkey validator 0.0.3. |

### 22. Without initConfig, a Kernel address commits only to the owner and the salt

| Field | Detail |
| --- | --- |
| What we found | When an account is created without initConfig, its address depends only on the owner and the salt, so the SDK's default salt of 0 gives a wallet the same address as any other ZeroDev Kernel v3.1 app that uses the default salt and no initConfig. |
| How we checked | On chain 4663 the SDK's address equals KernelFactory.getAddress(initData, salt), by eth_call for salt 0 and for the Sleeve salt on three random keys ([docs/research/wallet-connect.md](docs/research/wallet-connect.md) sections 0 and 8). |
| Impact on Sleeve | With the default salt, a wallet owner's Sleeve account could be an account another app already gave that wallet, possibly deployed, funded and carrying other modules. |
| What we did | Wallet-owned Sleeve accounts use a Sleeve salt, fixed before the first real user ([app/src/lib/chain/kernel.ts](app/src/lib/chain/kernel.ts)). |

## USDG

### 23. USDG's permit is served by a facet with unverified bytecode

| Field | Detail |
| --- | --- |
| What we found | USDG sends permit and EIP-3009 transferWithAuthorization to the facet 0x780d30b6a89BC9Eef953a543aA288c3B05b01309. Sourcify has no record of it (HTTP 404) and Blockscout's bytecode database has no match, while the USDG implementation is verified. All 238 FacetUpdate events came in one transaction at block 57, across five facets. A permit signed by a fresh EOA key works in eth_call, and the same signature with a changed value reverts InvalidSignature(). Only an EOA signature was tested. USDG also has its own pause and address freeze. |
| How we checked | getFacet, the Sourcify API and an eth_call replay at block 78,327,113 ([docs/GATES.md](docs/GATES.md) G7, [docs/research/chain-constants.md](docs/research/chain-constants.md) section 5, [P1]). |
| Impact on Sleeve | Sleeve's planned owner top-up runs a USDG permit inside a bracketed owner op (D-014). It would rest on bytecode nobody can read on an explorer, and a smart-account signature to it is untested. |
| What we did | The app does not have the permit top-up yet. Gate G7's next step is a fork test at a pinned block that runs the real facet's permit and transferFrom inside a bracket before the app ships it, and whether to rely on an unverified facet stays an open question ([docs/research/chain-constants.md](docs/research/chain-constants.md) section 10). |

## Lending markets

### 24. Two Morpho Blue market oracles apply the multiplier the feed already includes

| Field | Detail |
| --- | --- |
| What we found | 47 Morpho Blue markets lend USDG against a launch Stock Token, 19 have supply and 4 hold more than 1,000 USDG. The two deepest, an NVDA market with 623,355.49 USDG supplied and 613,930.49 borrowed and an AAPL market with 197,198.74 supplied and 197,174.57 borrowed at block 78,653,690, use oracles that multiply the Chainlink answer by the token's uiMultiplier(). The oracles page in Robinhood Chain's docs says the feed already includes the multiplier, so these oracles value collateral 7.75 bps (NVDA) and 5.66 bps (AAPL) above the feed price, and the gap grows with every multiplier increase. |
| How we checked | CreateMarket logs from Morpho Blue's deploy block, market state through two providers, and an exact integer replay of each oracle's price() ([docs/GATES.md](docs/GATES.md) G1, [docs/research/gates-checks.md](docs/research/gates-checks.md) section 1.7, [M1]). No public contact for the market creator was found. |
| Impact on Sleeve | A borrow feature built on these markets would sit on collateral priced above the feed, and further above it after any split applied through the multiplier. |
| What we did | Borrow stays gated, and gate G1 stays PARTIAL. Before any borrow work, candidate markets get vetted on the oracle formula, the USDG not yet borrowed, liquidation while the market is closed, and who supplies the USDG. |

## Operations

### 25. systemd 259 hands LoadCredential secrets to the service as 0440 root:root

| Field | Detail |
| --- | --- |
| What we found | systemd 259 gives a LoadCredential= secret to the service as mode 0440, owned by root:root, inside the unit's 0550 root:root credentials directory, and the service's user reads it through an ACL. |
| How we checked | On the keeper's first real install on the VPS on 4 October 2026, the key-file check read the group bit as "other users can read it" and refused to start (commit b7bbc48, [docs/PROGRESS.md](docs/PROGRESS.md)). |
| Impact on Sleeve | The keeper would not start under its hardened systemd unit. |
| What we did | keyFileModeProblem keeps the owner-only rule and accepts exactly that case: group-readable, owned by root:root, no world bits, inside $CREDENTIALS_DIRECTORY ([keeper/src/keyfile.ts](keeper/src/keyfile.ts), tests in [keeper/test/keyfile.test.ts](keeper/test/keyfile.test.ts)). The key file on disk stays mode 600 root:root ([keeper/deploy/README.md](keeper/deploy/README.md)). |

## Smaller notes

- The Account Abstraction page imports robinhoodMainnet from viem/chains, which viem does not export. viem names the chain robinhood, so the ZeroDev example fails at its import line ([R6]). viem's robinhood also lists a third-party RPC among its defaults, which Sleeve's app replaces with the public RPC ([docs/research/wallet-connect.md](docs/research/wallet-connect.md) section 4).
- @zerodev/sdk 5.5.10's CommonJS build requires tslib without declaring it, which breaks Node scripts and tests that import the passkey plugin ([Z4]).
- Feed descriptions use two formats, "RHSPY / USD" and "Robinhood QQQ / USD". Sleeve pins each feed per ticker and never parses the description ([C2]).
- Chainlink Data Streams has a verifier proxy on chain 4663, but access needs Chainlink credentials, which Sleeve does not have, so the onchain calendar stays the session source ([docs/GATES.md](docs/GATES.md) G8).

## Where the docs and the chain agree

These matched, so there is nothing to file ([CONTRIBUTIONS.md](CONTRIBUTIONS.md), "Checked and found consistent", and [docs/GATES.md](docs/GATES.md)):

- Uniswap's SDK addresses for chain 4663. SwapRouter02's factory() is the v3 factory, QuoterV2 quotes work, and the Universal Router's creation block matches Sourcify.
- Chainlink's directory addresses for the SPY, QQQ, NVDA, AAPL and USDG/USD feeds. Each proxy's aggregator() equals the directory's contractAddress.
- The four launch token addresses, which agree across the issuer's assets API, the issuer's Final Terms and the chain.
- EntryPoint v0.7, whose runtime code hash equals Ethereum mainnet's.
- USDG's 6 decimals, read again at the deploy.
- The Kernel v3.1 implementation, factory and meta factory, which match tag v3.1 outside their immutables.
- block.number as an L1 estimate, as the "Differences from Ethereum" page says.
- TSTORE and TLOAD on the live chain, which the owner brackets rely on (G6 item h).
- Relay's quotes for Arbitrum One USDC and USDT to USDG with a destination call (G2). These are quotes only, and nothing was sent.

[R1]: CONTRIBUTIONS.md#r1-stock-token-apis-page-documents-a-tradingcapabilities-shape-the-assets-api-does-not-return-and-alldaytradability-is-never-present
[R2]: CONTRIBUTIONS.md#r2-oracles-page-tells-integrators-to-check-a-chainlink-sequencer-uptime-feed-that-does-not-exist-for-robinhood-chain
[R3]: CONTRIBUTIONS.md#r3-every-stock-token-has-a-live-chainlink-price-feed-but-chainlink-lists-feeds-for-36-of-the-194-stock-tokens
[R4]: CONTRIBUTIONS.md#r4-token-contracts-page-says-its-table-is-generated-live-from-the-on-chain-asset-registry-but-the-table-is-fetched-from-apirobinhoodcom
[R5]: CONTRIBUTIONS.md#r5-price-deviations-page-drops-the-sign-and-the-direction-it-looks-up-premium-and-discount-while-the-api-returns-deviation_direction_premium-and-deviation_direction_discount
[R6]: CONTRIBUTIONS.md#r6-account-abstraction-page-imports-robinhoodmainnet-from-viemchains-which-viem-does-not-export-the-export-is-robinhood
[R7]: CONTRIBUTIONS.md#r7-building-with-stock-tokens-shows-transferwithscaledui-as-part-of-the-core-erc-8056-interface-while-the-erc-8056-draft-names-that-event-transferwithuiamount
[R8]: CONTRIBUTIONS.md#r8-oracles-page-says-oraclepaused-marks-corporate-action-processing-but-the-flag-has-never-been-set-on-spy-qqq-nvda-or-aapl
[R9]: CONTRIBUTIONS.md#r9-oracles-page-a-heartbeat-staleness-check-accepts-fridays-price-on-saturday-and-the-page-has-no-market-session-check
[R10]: CONTRIBUTIONS.md#r10-connecting-page-state-the-public-rpcs-limits-state-window-getlogs-ranges-burst-challenge
[E1]: CONTRIBUTIONS.md#e1-deployed-stock-tokens-on-robinhood-chain-differ-from-the-erc-8056-draft-transfer-event-name-no-uimultiplierupdatecancelled-when-a-schedule-is-replaced-and-same-block-multiplier-updates
[C1]: CONTRIBUTIONS.md#c1-robinhood-chain-equity-feeds-the-first-rounds-before-23-june-2026-1353-utc-carry-answers-about-1e8-times-too-large
[C2]: CONTRIBUTIONS.md#c2-robinhood-chain-feed-descriptions-use-two-formats-rhspy--usd-and-robinhood-qqq--usd
[C3]: CONTRIBUTIONS.md#c3-equity-feed-docs-an-eastern-standard-time-label-and-no-stated-behavior-on-nyse-early-close-days
[Z1]: CONTRIBUTIONS.md#z1-passkey-validator-isrip7212supportednetwork4663-is-false-so-robinhood-chain-userops-use-the-solidity-p-256-verifier-about-340000-extra-gas-although-p256verify-is-live
[Z2]: CONTRIBUTIONS.md#z2-kernel-meta-factory-factorystaker-0xd703aae79538628d27099b8c4f621be4ccd142d5-has-no-entrypoint-v07-stake-on-robinhood-chain
[Z3]: CONTRIBUTIONS.md#z3-passkeys-docs-only-3450-gas-for-the-p-256-precompile-automatically-switching-to-it-and-robinhood-chain-missing-from-the-precompile-list
[Z4]: CONTRIBUTIONS.md#z4-zerodevsdk-5510-the-commonjs-build-requires-tslib-but-tslib-is-not-a-dependency
[Z5]: CONTRIBUTIONS.md#z5-kernel-v31-on-robinhood-chain-document-the-build-behind-each-deployed-contract-the-ecdsa-validator-matches-v31-rc1-not-tag-v31-and-which-sdk-addresses-exist-per-chain
[P1]: CONTRIBUTIONS.md#p1-usdg-on-robinhood-chain-the-permit-and-eip-3009-facet-0x780d30b6a89bc9eef953a543aa288c3b05b01309-has-no-verified-source
[M1]: CONTRIBUTIONS.md#m1-two-morpho-blue-market-oracles-on-robinhood-chain-multiply-the-chainlink-price-by-the-stock-tokens-uimultiplier-which-the-price-already-includes
