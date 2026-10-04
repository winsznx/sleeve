# Sleeve thesis

Sleeve is a payment address on Robinhood Chain that invests part of every payment. USDG arrives, a rule the owner set once splits it, the spend share stays USDG, and the equity share buys a Stock Token into the owner's own smart account, or waits there as USDG while the market is closed or the pool price sits further above the Chainlink reference than the owner's cap allows.

The contracts are live and verified on mainnet, and the app runs at https://trysleeve.xyz ([docs/DEPLOYMENTS.md](DEPLOYMENTS.md)). No payment has gone through Sleeve on mainnet yet, so this page describes the design and what the tests show.

## Who it is for

Sleeve is for people outside the United States who are paid in stablecoins for work, invoices or remittances and want a fixed share of each payment in US equity exposure. The launch market is Nigeria, starting with freelancers in Lagos, where the founder is based. Nigeria is on neither of the issuer's lists of restricted and prohibited jurisdictions ([source](https://docs.robinhood.com/rhj/restricted-jurisdictions)), and onboarding blocks US persons and residents of the jurisdictions the issuer restricts or prohibits ([docs/CLAIM_LEDGER.md](CLAIM_LEDGER.md) row 6.8). Payers need no Sleeve account, only a wallet that sends USDG on Robinhood Chain.

## The problem

Access is close to solved. A news report on the launch says Stock Tokens are offered to eligible users in about 120 countries ([securitybrief.co.uk](https://securitybrief.co.uk/story/robinhood-launches-chain-stock-tokens-in-120-countries)).

The payday habit is not. Buying by hand is a fresh decision every payday, and it keeps getting put off. A study of automatic enrollment in a 401(k) plan found that employees enrolled by default often kept the default contribution rate and fund ([Madrian and Shea, NBER w7682](https://www.nber.org/papers/w7682)). Sleeve borrows the mechanism, a rule set once, and takes no participation rate from the study, because an employer's default acts before the worker sees the money, while Sleeve needs the earner to set it up.

## The mechanism

The payment address does the investing, so the decision moves to setup. The owner signs up with a passkey, gets a ZeroDev Kernel smart account with the Sleeve module installed, and sets the rule once: the share that buys, one ticker (SPY, QQQ, NVDA or AAPL) and a premium cap over the Chainlink reference. The suggested start is 10 percent to SPY with a 100 bps cap.

When USDG arrives, the keeper calls `split`. If the keeper stops, the owner can trigger a split at any time, and anyone can trigger one 60 minutes after the waiting USDG was observed onchain. The spend share stays USDG, ready for rent. The equity share buys through an allowlisted Uniswap v3 pool only if Sleeve's onchain calendar says the market is open, the Chainlink round is fresh and the all-in price, measured from balances, is within the cap. Otherwise it waits as USDG until `settle` buys it, and the owner can release it at any time. The calendar is there because Stock Token feeds hold their last price while the market is closed.

No call changes the module's own USDG or Stock Token balance. USDG the owner moves through Sleeve is never split. An action signed outside Sleeve can make the owner's own USDG look like income, and receipts record the accounting mode. Every action writes a receipt that a verifier recomputes from public chain data, through a different RPC provider from the keeper's. The split is the product. The receipt is how anyone can check it.

## Why Robinhood Chain, and why now

Every piece the flow needs is on one chain, and Sleeve checked each one onchain before building on it ([docs/GATES.md](GATES.md)): USDG, the four launch Stock Tokens with a Chainlink feed each, a USDG pool on Uniswap v3 for each with 177,114 to 724,558 USDG of depth within 2 percent of mid on 2 October 2026 ([D-010](DECISIONS.md)), and Kernel v3.1 on EntryPoint v0.7.

Each Stock Token is a debt security issued by Robinhood Assets (Jersey) Limited. It gives economic exposure to the underlying security and no legal or beneficial rights in, or against, the issuer of that security ([issuer FAQ](https://docs.robinhood.com/rhj/faq)).

The open question is the payer side: income has to arrive as USDG on Robinhood Chain, and the cross-chain pay link is gated.

## What we measure

- HP1, live payments, is pending: at least 10 real payments from at least 3 distinct payers, one or more off-hours, each receipt verified on a separate RPC (plan in [docs/EVAL_CAMPAIGN.md](EVAL_CAMPAIGN.md), demo in [docs/DEMO_SCRIPT.md](DEMO_SCRIPT.md)).
- HP3, security: 852 Foundry and 1,681 TypeScript tests passed on 4 October 2026, and an internal review, not an external audit, found 43 issues, and no open finding lets anyone take funds out of an account ([SECURITY.md](../SECURITY.md)).
- HP2, a price replay under a protocol committed before its harness and results ([docs/HP2_PROTOCOL.md](HP2_PROTOCOL.md)), is a provisional pass.

On 1,000 replayed payments of 100 USDG, 250 per ticker, buying at arrival paid on average 309.11 bps more over the reference than the guarded policy (95 percent bootstrap interval 209.24 to 419.12). The guarded median delay was 0 hours, its 90th percentile 38.46 hours, and 353 payments (35.3 percent) waited. SPY accounts for 307.97 bps of the 309.11. Its fee-500 pool returned no working quote at any instant the replay asked from 14 to 19 August 2026, and its first working quote, at 03:45 UTC on 19 August, was 9,904.79 bps over the reference. 31 payments bought at that price under the arrival rule, 30 of them because the pool had no quote when they arrived, while the guarded policy bought at 04:30 UTC that day and paid -20.47 bps. So the guard refused a real extreme mispricing that buying at arrival would have paid, and in ordinary conditions it cost about 1.7 bps per payment to wait for the reference. It stays provisional until the protocol's rerun on a second provider is compared row by row ([docs/HP2_RESULTS.md](HP2_RESULTS.md)).

## Distribution and milestones, as plans

None has started. The first surface is the payday card an earner shares after a real payment, with amounts and the address hidden by default. Then three wedges:

- Lagos freelancers paid in stablecoins, through the founder's network.
- Payroll and invoicing platforms that could offer a Sleeve address as a payout destination to many earners at once.
- Programs that pay grants or prizes in USDG.

Sleeve has no token, points or referral rewards to buy distribution with.

Targets, not forecasts, each to be counted from published receipts:

| Milestone | Development | Target |
| --- | --- | --- |
| M0, now | Mainnet module, verifier and app | HP1 published, HP2 rerun |
| M1 | Same-chain pay link, cross-chain pay link once a route has run, baskets, borrow if G1 clears, email login | 25 earners with a split payday |
| M2 | First payroll or invoicing integration | 100 earners with two or more split paydays |
| M3 | Fee decision, crews public | 1,000 earners, retention from receipts |

## Out of scope or gated

None of these is live: borrow (gate G1), the cross-chain pay link (gate G2), an onchain registry read (gate G3, so the ticker list mirrors the issuer's canonical list), the same-chain pay link, baskets, crews and email login (M1), and EIP-7702 accounts (after M0).

Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.
