# Keeper

The Sleeve keeper is one long-running Node 22 process (D-002). Every `KEEPER_POLL_MS` it indexes the module's logs
into Supabase, then splits new income and settles waiting buckets for every installed account whose keeper is its
key. It calls nothing but `split` and `settle` on the deployed SleeveModule (`src/chain/calls.ts` admits no other
call), and has no power beyond what anyone has after the grace period (PRD 7.2, 14). It has run on the owner's
Hostinger VPS under systemd since 4 October 2026 (D-036): `deploy/README.md` is the runbook, and docs/DEPLOYMENTS.md
records the live release and its checks.

## A pass

1. Index. From `DEPLOYMENT_4663.firstBlock`, or the stored cursor, to the head minus `KEEPER_CONFIRMATIONS`: the
   module's logs, then USDG `Transfer` logs to installed accounts (an OR over the `to` topic, 100 accounts a query),
   in ranges the RPC accepts. A refused range is halved and the narrower span is remembered, so a provider with a
   small limit costs one refusal, not one per range. Rows go to Supabase through `src/store/supabase.ts` in the order
   the table contract asks (supabase/README.md): accounts, rule versions, receipts (each checked against the stored
   `receiptHash(id)`), reconciliations, payments, payment status moves, then the cursor. Blocks inside the
   confirmation window are read again every pass until they are deep enough. A cursor whose block hash changed is a
   reorg below the window: the index is append-only, so indexing stops (`REORG_BELOW_CURSOR`) while splits and settles
   go on from chain state.
2. Market. TokenSource tickers every ten minutes, with token and feed decimals asserted at 18 and 8; the five feeds
   (four tickers and USDG/USD) every pass.
3. Accounts. For each installed account whose keeper, as indexed, is this key: `keeperOf` read live, the account
   still listing the module in Kernel, a Kernel v3.1 account (the factory's ERC-1967 proxy code pointing at the v3.1
   implementation, audit A1-23), and no open owner bracket. Then the split decision, then the buckets.
4. Alerts and health: the keeper's ETH balance, the calendar's coverage end, the health state.

## When it splits

`src/policy/split.ts`, from `previewSplit`:

| Case | Decision |
| --- | --- |
| Rule paused or unset | Nothing: split would revert `RuleNotActive` |
| Shortfall above zero (an outside pull) | Split at once to reconcile, whatever the base fee (audit A1-29) |
| Unsorted under 1 USDG | Wait until it has waited 24 hours or more income arrives (audit A1-30) |
| Base fee above `KEEPER_GAS_CEILING_GWEI` | Hold until the oldest unsorted payment has waited 24 hours (PRD 7.2) |
| Otherwise | Split |

How long income has waited comes from the oldest unsorted payment of the account's current install in the index,
or from when the keeper first saw it unsorted, ignoring anything older than the last time the account had nothing
unsorted (that money was spent or sorted since). A hold writes one SKIPPED run when it starts or changes, then hourly.

The pool is the allowlisted pool, read from TokenSource just before the call (audit A1-17), with the best QuoterV2
quote for the equity part; the quote is token units per 1e6 USDG, rounded down, so the module's minimum never exceeds
what the quoter promised (D-009 Q21). `PoolBlocked` moves to the next pool, `PoolNotAllowed` reads the allowlist again,
`TooFewTokens` quotes again, at most three tries. A split that swaps nothing still passes an allowlisted pool and a
quote of 1, which nothing reads.

## When it settles

`src/policy/settle.ts`. A non-empty bucket is looked at when it is new or changed; at a session opening once the first
round observed and transmitted after the opening arrives (B2-2, audit A1-10), using the packages/core calendar; on
each new round of its feed while it waits on STALE or PREMIUM; every 30 seconds on PREMIUM (pool moves clear it too);
every minute on PAUSED, ORACLE_PAUSED, MULTIPLIER, DEPEG or a failed send; and at least every five minutes. A look is
a `previewSettle`: SETTLED with a buy, or a refusal, is simulated and sent; QUEUED with a reason is a wait. A
simulation that reverts `GuardNotClear(reason)` is a wait on that reason. Each wait goes to `bucket_waits` (reason,
the bucket's since, first and last seen, `first_seen_at` reset when the reason or the bucket changes), which the app
reads for the five-day prompt (PRD 7.4, audit A1-32); the row goes when the bucket empties.

## Transactions

One signer, from `KEEPER_PRIVATE_KEY_FILE`: one hex key, never logged, refused when anyone but its owner can read it.
The one exception is the copy systemd hands the service, 0440 root:root inside the unit's credentials directory
(`keyFileModeProblem` in src/keyfile.ts). The signer's own nonce counter starts from the pending nonce and resyncs
after any send error. EIP-1559 with a zero tip (first come first served ordering) and a fee cap of twice the base fee,
never above `KEEPER_MAX_FEE_GWEI`; the gas limit is the estimate plus a fifth and 10,000, never above `KEEPER_MAX_GAS`.
Every call is simulated first and sent only if the simulation succeeds. Success is read back from chain state
(`src/tx/postcondition.ts`): the transaction's own `ReceiptWritten` with the right status, trigger and I2 sums,
`receiptHash(id)` equal to the event's hash, the ledger at the transaction's block (nothing unsorted after a split, no
shortfall after a reconcile, an empty bucket after a settle), and a buy's lot holding its tokens. Each action is a
`keeper_runs` row: SUCCEEDED, SKIPPED, REVERTED (with its transaction and the decoded reason) or FAILED.

## Modes

```
node dist/main.js                   loop, with GET /health on 127.0.0.1:KEEPER_HEALTH_PORT
node dist/main.js --once            one pass, the health report as the last log line, exit 0 or 1
node dist/main.js --once --dry-run  decide and simulate, never sign or send
node dist/main.js --print-address   the key file's address
node dist/keygen.js <file>          a new key at mode 600, printing only its address
```

Exit code 2 means the configuration or the key file was refused. Configuration comes only from the environment
(`src/config.ts`). `deploy/keeper.env.example` lists every setting with its default, except `KEEPER_PRIVATE_KEY_FILE`,
which the systemd unit sets, and `KEEPER_ADDRESS`, which lets `--dry-run` simulate as the keeper without its key.

## Tests

```
pnpm --filter @sleeve/keeper test        unit and schema tests, no network
pnpm --filter @sleeve/keeper test:fork   the fork integration test: anvil and FORK_RPC (default https://robinhood.drpc.org)
pnpm --filter @sleeve/keeper typecheck
pnpm --filter @sleeve/keeper build       dist/main.js and dist/keygen.js, every dependency inlined
```

The store tests and the indexer tests run the production store, supabase-js included, against the migration on
PGlite through a stand-in for Supabase's REST API (`test/support/postgrest.ts`), as the service role, so every named
rule in the schema applies. No Docker.

The fork test (`test/fork/keeper.fork.test.ts`) starts anvil on the archive RPC's latest block, puts an ArbSys
stand-in at 0x64, creates a Kernel v3.1 account through the deployed factory with the module installed in its first
UserOp, sets a rule (50 percent to SPY, 1 USDG clip) in a bracketed owner op, and sends 10 USDG. With the market closed
(the test moves time to the next close when the fork lands in a session) a keeper with a zero ceiling holds, then the
built bundle runs `--once` and the split must queue SESSION, read back from the chain and the index. Labeled MOCKED:
time moves to the next opening and a stand-in feed posts fresh SPY and USDG/USD rounds priced at the pool; a dry run
must send nothing, then a 4 USDG payment must fill and the queued bucket settle, with `/health` answering 200. dRPC's
free tier answers `eth_getLogs` for at most 101 blocks on this chain, so the fork test starts its index at the fork
block, which it checks skips no receipt.
