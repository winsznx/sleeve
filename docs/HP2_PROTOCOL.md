# HP2 replay protocol

Pre-registered on 2 October 2026, before any replay result exists. The metric, inputs and pass rule below do not change after a result is seen (PRD 5, claim C2). Definitions follow docs/research/prd-questions.md Q44 and Q45 as adopted in D-014.

## Claim under test

C2: on real Robinhood Chain data, for payments arriving at sampled times, the guarded policy pays a lower average premium over the market reference than buying at arrival. Premium is reported in basis points per payment, with the delay next to it.

- Pass: the pooled mean of (arrival premium minus guarded premium) is above zero and its 95 percent bootstrap interval excludes zero, and the guarded median delay is at most 72 hours.
- Null: the interval includes zero.
- Fail: the guarded mean premium is equal to or worse than buying at arrival, or the guarded median delay is above 72 hours. On failure the claim is withdrawn and the queue rule is redesigned.

## Inputs, pinned

| Input | Value |
| --- | --- |
| Chain | Robinhood Chain mainnet, chain id 4663 |
| End block | 78,312,136 (Friday 2 October 2026 10:44 EDT) |
| Tickers and pools | SPY 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167, QQQ 0xD60A5d14dB690B7Afad71F76B108071D7175597d, NVDA 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, AAPL 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D and 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed (D-010) |
| Feeds | SPY 0x319724394D3A0e3669269846abE664Cd621f9f6A, QQQ 0x80901d846d5D7B030F26B480776EE3b29374C2ae, NVDA 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, AAPL 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, USDG/USD 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 |
| Quoter | Uniswap v3 QuoterV2 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7, quoteExactInputSingle, sqrtPriceLimitX96 zero |
| Window per ticker | From 24 hours after the creation block of the ticker's fee-500 pool to 96 hours before the end block. No USDG v3 pool existed for SPY, NVDA or AAPL on 1 July 2026, which is why the window does not start on 1 July |
| Arrivals | 250 per ticker, uniform over wall-clock time in the window |
| Seed | 4663202610. Ticker i (SPY 0, QQQ 1, NVDA 2, AAPL 3) draws from Python random.Random(4663202610 + i). Bootstrap draws from random.Random(4663202610 + 100) |
| Payment size | 100 USDG of equity per payment. Sensitivity run: 1,000 USDG, same arrivals |

## Policies

All three buy through the ticker's allowlisted pools at the best quote among them. The execution price is the quoted all-in price: USDG in divided by tokens out.

- Arrival (mechanical baseline): buys at the arrival instant. If every allowlisted pool's quote reverts at that block, it buys at the first later evaluation instant with a working quote, and the count of such payments is reported.
- Guarded (the module's rule): evaluated at the arrival instant, at each session open once the first fresh round lands, at each new feed round, and every 15 minutes while the session is open. It buys at the first instant where every check passes: session open by the module's SessionCalendar, a feed round newer than the session's opening instant, feed age at most 25 hours, no multiplier change scheduled within 24 hours, USDG/USD within 50 bps and at most 25 hours old, token and oracle not paused, and the all-in premium at most 100 bps above the round in force.
- Calendar only (sponsor ablation, the feed removed): the same evaluation instants, buying at the first instant the session is open. No premium, age or freshness check. It shows what the Chainlink feed adds on top of the calendar.

The session test uses the same SessionCalendar code the module uses: the compiled library evaluated through forge for every instant, cross-checked against the Python port in scripts/calendar_vectors.py.

## Market reference

- Primary: for every fill, the reference is the round in force if the session is open and that round is newer than the session's opening instant. Otherwise it is the first round at or after the next session open. This compares all policies against a live price.
- Secondary, reported beside it: the round in force at the fill instant, the literal reading that matches receipts. On a weekend this is Friday's held price.

Premium in basis points: (execution price minus reference price) divided by reference price, times 10,000. USDG is valued at 1 USD; the USDG/USD answer is reported per fill.

## Data

- Quotes: eth_call to QuoterV2 at the instant's block on an archive RPC. Every response is cached with its block number and committed in compact form so the results can be recomputed without an RPC.
- Feed rounds: AnswerUpdated logs or getRoundData over the window, chunked. Rounds whose answer is more than 10 times the feed's median are dropped; all such rounds predate 23 June 2026 13:53 UTC.
- Multiplier changes and pauses: UIMultiplierUpdated, Paused, Unpaused, OraclePaused and OracleUnpaused logs per token and the registry.
- Instants map to blocks by block timestamp, using the last block at or before the instant.
- Provider: the owner asked for the keeper's RPC provider for historical logs. Until the Alchemy app exists, the run uses dRPC's archive endpoint (https://robinhood.drpc.org). The run is repeated on Alchemy once it exists and both outputs are committed; any difference is reported, not smoothed.

## Reported

Per ticker and pooled, for both sizes and both references: mean and median premium for each policy, the paired mean difference (arrival minus guarded, and calendar only minus guarded) with a 95 percent bootstrap interval from 10,000 resamples, guarded delay median and 90th percentile, the share of payments that waited, the count of off-hours arrivals, quote failures and dropped rounds.

Outputs: scripts/hp2/ (code), results/hp2/ (inputs, cached responses, per-payment rows, summary JSON), docs/HP2_RESULTS.md (the report, written from the summary JSON by a script).
