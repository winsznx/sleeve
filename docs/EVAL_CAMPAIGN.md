# HP1 live payment campaign

The plan for HP1: real USDG payments to a Sleeve account on Robinhood Chain mainnet (chain id 4663), split by the keeper and checked by the verifier. Written on 4 October 2026, before any step below ran. On that date no Sleeve account and no receipt existed on mainnet, the keeper tracked no account, and HP1 had not started ([DEPLOYMENTS.md](DEPLOYMENTS.md), [CLAIM_LEDGER.md](CLAIM_LEDGER.md) row 5.3). The results tables at the end stay empty until the campaign runs.

[CLAIM_LEDGER.md](CLAIM_LEDGER.md) decides what the results let Sleeve claim and with what wording. Where this plan and the ledger disagree, the ledger wins. [DEMO_SCRIPT.md](DEMO_SCRIPT.md) films the campaign and names the step each shot waits for.

## Contents

- [Target](#target)
- [Controls](#controls)
- [Starting state](#starting-state)
- [Market calendar](#market-calendar)
- [Steps](#steps)
- [How to read a result](#how-to-read-a-result)
- [Results](#results)
- [Stop conditions](#stop-conditions)
- [Costs](#costs)
- [After the campaign](#after-the-campaign)

## Target

PRD section 17 fixes HP1:

> HP1 Live: at least 10 real payments from at least 3 distinct payers on mainnet, at least one arriving off-hours, each receipt verified by the verifier on a separate RPC.

The terms, as D-014 adopted them from docs/research/prd-questions.md Q46:

| Term | Meaning |
| --- | --- |
| Distinct payer | A distinct sending address controlled by a distinct person, listed in the [payers table](#payers) with its relation to the team. TEST_PAYER counts as one team payer. |
| Real payment | A mainnet USDG transfer to a Sleeve account from an address that is not a Sleeve account. |
| Off-hours | Sleeve's deployed calendar says closed at the transfer's block timestamp. Any weekend payment meets it. |
| Verified | `sleeve verify <receiptId>` through the public RPC exits 0 with zero mismatches, and its output is committed. |
| Separate RPC | The keeper reads and sends through its own QuickNode endpoint (D-032). The verifier reads https://rpc.mainnet.chain.robinhood.com, so no receipt is checked through the provider that wrote it (D-012, D-035). |

The campaign rule. Campaign accounts use a 50 percent equity share and a 1 USDG minimum buy, while the product default stays 10 percent to SPY with a 25 USDG minimum buy (D-014, docs/research/prd-questions.md Q2). Under the default, a 10 USDG payment has a 1 USDG equity part, and the bucket would need 250 USDG of payments before its first buy. At 50 percent with a 1 USDG minimum, each 10 USDG payment buys with 5 USDG in session. This plan buys SPY, the default ticker, and keeps the default premium cap of 100 bps and slippage cap of 50 bps (packages/core/src/rule.ts). Every receipt carries the rule version, and `ruleOf(account)` reads the setting back. The README, the claim ledger and the video state this rule wherever they use campaign receipts.

## Controls

PRD section 17 lists controls beside the headline proof:

> Controls: an in-session fill, an owner top-up that does not split, a sell-back whose USDG does not split, an unbracketed owner transfer that shows the documented limit, a weekend payment that queues, a stale feed that queues, a non-canonical token that refuses, a minimum-out failure that reverts with nothing moved, and the feed-removed replay.

| Control | On mainnet in HP1 | Covered by |
| --- | --- | --- |
| An in-session fill | Yes, [step 6](#step-6-payments-in-session) | Fork: test_fork_FILLED_byKeeper_onEveryAllowlistedPool at block 78,312,136 |
| An owner top-up that does not split | No. The app offers no top-up yet ([SPEC.md](SPEC.md) section 16), and gate G7 asks for a fork test of the real USDG permit before it ships ([GATES.md](GATES.md)). This control runs only in tests | test_I6_fork_bracketedInflowCreditsSpendExactly, test_I6_aTopUpAfterADrainLandsWholeInSpend |
| A sell-back whose USDG does not split | Optional, [step 7](#step-7-a-sell-back-optional) | test_I6_fork_sell_proceedsAreNeverSplit, test_I6_sell_insideABracket_proceedsAreTheModulesDeltaAndNeverSplit |
| An unbracketed owner transfer that shows the documented limit | No. A passkey signs only on Sleeve's site, and the app brackets every owner operation it builds after the install (I14), so an unbracketed transfer from a passkey account needs a recovery wallet acting outside Sleeve | test_G6_f_unbracketedBatchIsTheDocumentedLimit, test_I14_fork_anOpBuiltWithoutTheBuilderIsTheDocumentedLimit |
| A weekend payment that queues | Yes, [step 4](#step-4-the-first-payment-off-hours) | Fork: test_fork_QUEUED_SESSION_onEveryAllowlistedPool at block 73,280,794 |
| A stale feed that queues | Not planned. If a split lands after an open and before the feed's first round of that session, it queues STALE: record it as this control | test_readStockFeed_ageJustAbove25Hours_isStale, test_checkBuy_roundHeldOverAMidweekClosure_isStale, test_fork_weekend_calendarClosed_spyAndQqqFeedsStale, test_fork_QUEUED_STALE_byAgeInsideTheSession, test_fork_QUEUED_STALE_atTheReopenBeforeTheFirstRound |
| A non-canonical token that refuses | No. A refusal on mainnet needs the timelock to remove a live ticker, and TokenSource has no function that adds one back | test_I10_fork_setPoolRejectsLookalikePools, test_fork_setRuleRejectsATickerTokenSourceNeverListed, test_fork_REFUSED_TICKER_afterATimelockedRemoval, test_fork_settle_REFUSED_TICKER_afterATimelockedRemoval |
| A minimum-out failure that reverts with nothing moved | No. The keeper simulates every call and sends only when the simulation succeeds ([keeper/README.md](../keeper/README.md)), so this failure never becomes a mainnet transaction | test_fork_minimumOutFailure_revertsWithNothingMoved, test_split_minimumOutFailure_revertsWithNothingMoved, test_A1_12_minimumOutAloneStillReverts |
| The feed-removed replay | No. It belongs to HP2 | Claim 1.6, provisional ([HP2_RESULTS.md](HP2_RESULTS.md)) |

Rerun the tests behind the controls. The fork tests read FORK_RPC, which defaults to the archive RPC https://robinhood.drpc.org (D-008). The spike test runs in its own output folder, as in the ledger's rerun commands.

```
cd contracts
forge test --no-match-path "test/spike/*" --match-test '^(test_fork_FILLED_byKeeper_onEveryAllowlistedPool|test_I6_fork_bracketedInflowCreditsSpendExactly|test_I6_aTopUpAfterADrainLandsWholeInSpend|test_I6_fork_sell_proceedsAreNeverSplit|test_I6_sell_insideABracket_proceedsAreTheModulesDeltaAndNeverSplit|test_I14_fork_anOpBuiltWithoutTheBuilderIsTheDocumentedLimit|test_fork_QUEUED_SESSION_onEveryAllowlistedPool|test_readStockFeed_ageJustAbove25Hours_isStale|test_checkBuy_roundHeldOverAMidweekClosure_isStale|test_fork_weekend_calendarClosed_spyAndQqqFeedsStale|test_fork_QUEUED_STALE_byAgeInsideTheSession|test_fork_QUEUED_STALE_atTheReopenBeforeTheFirstRound|test_I10_fork_setPoolRejectsLookalikePools|test_fork_setRuleRejectsATickerTokenSourceNeverListed|test_fork_REFUSED_TICKER_afterATimelockedRemoval|test_fork_settle_REFUSED_TICKER_afterATimelockedRemoval|test_fork_minimumOutFailure_revertsWithNothingMoved|test_split_minimumOutFailure_revertsWithNothingMoved|test_A1_12_minimumOutAloneStillReverts)$'
FOUNDRY_OUT=out-g6 FOUNDRY_CACHE_PATH=cache-g6 forge test --match-path test/spike/G6Spike.t.sol --match-test test_G6_f_unbracketedBatchIsTheDocumentedLimit -vv
```

## Starting state

As recorded on 4 October 2026. [Step 1](#step-1-read-the-starting-state) reads each line again before anything is sent.

| Item | State | Source |
| --- | --- | --- |
| Contracts | Deployed 3 October 2026 at blocks 79,338,287 to 79,338,373, read back from chain state, verified on Sourcify. SleeveModule 0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9, SessionCalendarExtension 0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D | [DEPLOYMENTS.md](DEPLOYMENTS.md) |
| Web app | https://trysleeve.xyz, passkey relying party trysleeve.xyz. Sign-up and chain reads work only on that origin: www redirects to it, and ZeroDev and the browser RPC refuse the workers.dev host | [DEPLOYMENTS.md](DEPLOYMENTS.md), D-034 |
| Keeper | Running on the owner's VPS since 09:52 UTC on 4 October, 0 accounts tracked | [DEPLOYMENTS.md](DEPLOYMENTS.md), [keeper/deploy/README.md](../keeper/deploy/README.md) |
| KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46 | 0.001 ETH, nonce 0. The keeper raises LOW_BALANCE below 0.0003 ETH (KEEPER_MIN_BALANCE_ETH on the VPS) | [DEPLOYMENTS.md](DEPLOYMENTS.md) |
| TEST_PAYER 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC | 0 ETH and 0 USDG. Needs funding: [FUNDING.md](FUNDING.md) planned 0.0003 ETH and 60 USDG | [PROGRESS.md](PROGRESS.md), open inputs |
| Other payers | At least two more distinct people are needed. None is lined up in the record | [PROGRESS.md](PROGRESS.md), open inputs |
| Gas sponsorship | ZeroDev's policy for chain 4663 sponsors up to 0.00075 ETH a day and 0.0002 ETH a UserOp, 50 requests a day, below a 0.5 gwei gas price. A prepare-only probe got a first UserOp sponsored. No UserOp has been sent | [DEPLOYMENTS.md](DEPLOYMENTS.md) |
| Sleeve accounts and receipts on mainnet | None | [DEPLOYMENTS.md](DEPLOYMENTS.md) |

## Market calendar

The module buys only while its calendar says the US market is open. The rule for the launch tickers, all ALL_DAY (claim 2.3, [research/session-calendar.md](research/session-calendar.md) section 1):

- Open from Sunday 20:00 to Friday 20:00 New York time, with no daily break.
- Closed for each NYSE holiday from 20:00 the evening before to 20:00 on the holiday. The 2026 holidays left are 26 November and 25 December.
- On an early-close day the session ends at 17:00: Friday 27 November 2026, Thursday 24 December 2026 and Friday 26 November 2027.
- New York is UTC-4 until 2026-11-01T06:00:00Z and UTC-5 after it. Every switch falls inside a weekend closure.

The next windows, from [research/session-calendar.md](research/session-calendar.md) section 10, which lists every open interval of 2026 and 2027:

| Window | UTC | New York |
| --- | --- | --- |
| Closed | until 2026-10-05T00:00:00Z | until Sunday 4 October, 20:00 EDT |
| Open | 2026-10-05T00:00:00Z to 2026-10-10T00:00:00Z | Sunday 4 October 20:00 to Friday 9 October 20:00 EDT |
| Closed | 2026-10-10T00:00:00Z to 2026-10-12T00:00:00Z | Friday 9 October 20:00 to Sunday 11 October 20:00 EDT |
| Open | 2026-10-12T00:00:00Z to 2026-10-17T00:00:00Z | Sunday 11 October 20:00 to Friday 16 October 20:00 EDT |
| Closed | 2026-10-17T00:00:00Z to 2026-10-19T00:00:00Z | Friday 16 October 20:00 to Sunday 18 October 20:00 EDT |
| Open | 2026-10-19T00:00:00Z to 2026-10-24T00:00:00Z | Sunday 18 October 20:00 to Friday 23 October 20:00 EDT |
| Closed | 2026-10-24T00:00:00Z to 2026-10-26T00:00:00Z | Friday 23 October 20:00 to Sunday 25 October 20:00 EDT |
| Open | 2026-10-26T00:00:00Z to 2026-10-31T00:00:00Z | Sunday 25 October 20:00 to Friday 30 October 20:00 EDT |
| Closed | 2026-10-31T00:00:00Z to 2026-11-02T01:00:00Z | Friday 30 October 20:00 EDT to Sunday 1 November 20:00 EST, 49 hours |

The deployed calendar is the authority for "off-hours". Ask it about any instant, with session type 1 for ALL_DAY. It answers `true 1` while open, and `false 2` for a weekend, `false 3` for a holiday or `false 4` after an early close:

```
cast call 0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D "isOpenAt(uint256,uint8)(bool,uint8)" <unix seconds> 1 --rpc-url https://rpc.mainnet.chain.robinhood.com
```

Two timing rules follow for the payments:

- The off-hours payment goes in well inside a closure, not in the last minutes before an open, so the keeper's split also runs while the market is closed and the receipt queues SESSION.
- The in-session payments go in after the feed's first round of the session, not in the first minutes after an open. Before that round a split queues STALE (test_fork_QUEUED_STALE_atTheReopenBeforeTheFirstRound). The rule page's "Right now" line in [step 6](#step-6-payments-in-session) shows when a payment would buy.

## Steps

Steps 4 and 5 need a closure and the open that ends it, and step 6 needs a session. Run them in the order the calendar gives. Whichever comes first, the campaign's first payment is the end-to-end check: stop after it, read and verify everything, and only then let the other payers send.

Every command below runs from the repo root with these values set. Only the payment in step 4 uses a key, and it never prints it.

```
RPC=https://rpc.mainnet.chain.robinhood.com
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
MODULE=0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9
CAL=0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D
KEEPER=0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46
TEST_PAYER=0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC
```

### Step 1. Read the starting state

Read only.

```
cast chain-id --rpc-url $RPC                                               # 4663
cast call $USDG "decimals()(uint8)" --rpc-url $RPC                          # 6
cast balance $KEEPER --ether --rpc-url $RPC                                 # 0.001 on 4 October
cast nonce $KEEPER --rpc-url $RPC                                           # 0 until the keeper's first send
cast balance $TEST_PAYER --ether --rpc-url $RPC                             # 0 on 4 October
cast call $USDG "balanceOf(address)(uint256)" $TEST_PAYER --rpc-url $RPC    # 0 on 4 October, in base units
cast call $MODULE "nextReceiptId()(uint256)" --rpc-url $RPC                 # 1 while no receipt exists
cast gas-price --rpc-url $RPC                                               # 31,610,000 wei on 2 October
curl -s "https://trysleeve.xyz/api/index?view=receipts&account=0x0000000000000000000000000000000000000001"
ssh root@nightbook-vps 'curl -s http://127.0.0.1:8787/health'
```

The index answer carries `indexedTo`, the keeper's cursor, which should be close to the chain head. The health report should say status ok, with no alerts and the keeper's balance.

### Step 2. Fund TEST_PAYER and line up the payers

The owner sends TEST_PAYER 0.0003 ETH and 60 USDG on Robinhood Chain, as [FUNDING.md](FUNDING.md) planned. That covers six payments of 10 USDG. Read both balances back with the step 1 commands.

Line up at least two more payers. Each one is a different person who sends from an address they control on Robinhood Chain: not an exchange withdrawal, whose sending address belongs to the exchange, and not another Sleeve account. Each needs USDG and a little ETH for gas on Robinhood Chain. Add each one to the [payers table](#payers) before they send, with their relation to the team, and ask whether their address may appear in the docs and the video.

Each payment is 10 USDG, as in [FUNDING.md](FUNDING.md). The floor is 2 USDG: below it the 50 percent equity part misses the 1 USDG minimum buy, so in session it queues CLIP, and the keeper holds an unsorted amount under 1 USDG for up to 24 hours ([keeper/README.md](../keeper/README.md)).

The message for a payer, sent only after step 3 passes:

> Please send 10 USDG on Robinhood Chain (chain id 4663) to `<payment address>`. The USDG contract there is 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168. Send it from a wallet you control, at the time we agree, and send me the transaction hash.

A payment bridged from another chain straight to the address arrives from a bridge or solver address, not from the payer's own, so it does not count as a distinct payer. Its split receipt is the evidence claim 8.3 waits for, so record it on its own row.

### Step 3. Sign up and set the campaign rule

The owner, at https://trysleeve.xyz. Screen-record this whole step for the video ([DEMO_SCRIPT.md](DEMO_SCRIPT.md) shots 2 to 4). A sign-up happens once per account.

1. Open https://trysleeve.xyz/onboard, or "Get your payment address" on the landing page.
2. Eligibility: where you live, and the US person and sanctions questions (claim 6.8).
3. Signer: "Use a passkey". The passkey binds to trysleeve.xyz for good (D-034). The step shows the accounting limit at setup, the line PASSKEY_RECORDS_LINE in app/src/lib/signer.ts (claim 3.3).
4. Recovery: optional. Claim 4.6, that the owner can still exit while Sleeve's keeper and app are offline, covers only accounts that set a recovery wallet, and it stays PENDING until its fork test exists. A recovery wallet acts outside Sleeve, so its actions are unbracketed (claim 3.3).
5. Rule: SPY, 50 percent of each payment, premium cap 100 bps, slippage cap 50 bps, minimum buy 1 USDG.
6. Create: one passkey approval deploys the account and installs the module with the rule in its first UserOp (D-019). A recovery wallet asks for one more approval. If the app answers "The account was not created", nothing moved: stop, and if the reason is sponsorship, check the ZeroDev policy.
7. Done: the app shows the payment address and its QR code only after it reads the module back as installed. Copy the address from there.

Read it back:

```
ACCOUNT=<the payment address>
cast call $MODULE "isInitialized(address)(bool)" $ACCOUNT --rpc-url $RPC     # true
cast call $MODULE "keeperOf(address)(address)" $ACCOUNT --rpc-url $RPC       # 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46
cast call $MODULE "ruleOf(address)((uint32,uint8,uint16,uint8,uint16,uint16,uint128))" $ACCOUNT --rpc-url $RPC
cast call $MODULE "ledger(address)(uint256,uint256,uint256,uint256)" $ACCOUNT --rpc-url $RPC
cast balance $ACCOUNT --ether --rpc-url $RPC
ssh root@nightbook-vps 'curl -s http://127.0.0.1:8787/health'
```

Expected: the rule reads status 1 (ACTIVE), equityBps 5000, tickerId 0 (SPY), premiumCapBps 100, slippageBps 50 and minClip 1000000. The ledger reads balance, spend, pendingTotal and unsorted, all 0 for a new account. The health report counts 1 account.

Record the account address, the sign-up transaction from the account's page on the explorer, its block, and the EntryPoint's UserOperationEvent for it, whose actualGasCost is what the account paid. On chain 4663 ZeroDev sponsors through its relayer with a zero gas price and no paymaster ([DEPLOYMENTS.md](DEPLOYMENTS.md)). Record this first live UserOp through ZeroDev on 4663 in [GATES.md](GATES.md), as docs/research/zerodev-passkey.md section 11 item 3 asks.

Give the address to no payer before this read-back passes. USDG that arrives before the module is installed joins the install snapshot and is never split (claim 3.1).

### Step 4. The first payment, off-hours

Inside a closure: a weekend, a holiday, or the evening after an early close.

1. Check that the calendar says closed now. Expect `false 2` on a weekend.

   ```
   cast call $CAL "isOpenAt(uint256,uint8)(bool,uint8)" $(date +%s) 1 --rpc-url $RPC
   ```

2. TEST_PAYER sends 10 USDG, 10,000,000 base units at the 6 decimals step 1 read. The key stays in a subshell variable and is never printed, as in [DEPLOY_PLAN.md](DEPLOY_PLAN.md) section 8.2, which also gives a keystore alternative.

   ```
   ( set +x
     PAYER_KEY="$(cat ~/.sleeve-keys/<TEST_PAYER key file>)"
     cast send $USDG "transfer(address,uint256)" $ACCOUNT 10000000 --private-key "$PAYER_KEY" --rpc-url $RPC )
   ```

3. Press nothing in the app. The keeper splits the payment with trigger KEEPER. Claims 1.1, 2.1 and 6.10 count only splits and settles started by the keeper or the public. "Sort now" on Payments or "Buy SPY now" on Home writes a receipt with trigger OWNER, and "Release to spend" empties the bucket that step 5 settles.
4. Expected: one split receipt with status QUEUED, reason SESSION, trigger KEEPER, usdgIn 10000000, usdgToSpend 5000000, usdgToEquity 5000000, usdgQueued 5000000 and usdgSpent 0. The SPY bucket holds the equity part, with reason 3 (SESSION):

   ```
   cast call $MODULE "bucketOf(address,uint8)((uint128,uint64,uint8))" $ACCOUNT 0 --rpc-url $RPC
   ```

5. Read the receipt ([How to read a result](#how-to-read-a-result)), verify it ([step 8](#step-8-verify-every-receipt-and-save-the-output)) and fill its row in the [results table](#receipts).
6. While the bucket waits, screen-record Home: the USDG waiting to buy SPY, the reason, the countdown to the open and "Release to spend" ([DEMO_SCRIPT.md](DEMO_SCRIPT.md) shot 6). This screen exists only until the settle.

A second off-hours payment from Payer B in the same closure is welcome. Its split queues SESSION too, and the bucket grows.

### Step 5. The settle after the open

Nobody acts. When the session opens, the keeper settles the bucket once the feed posts its first round observed and sent after the opening ([keeper/README.md](../keeper/README.md)). For the closure running on 4 October 2026, the open is 2026-10-05T00:00:00Z, Sunday 4 October at 20:00 New York time.

Expected: one SETTLED receipt with trigger KEEPER, usdgIn 0, usdgToEquity and usdgSpent equal to the bucket, tokensOut above zero, premiumBps at most 100, queuedSince equal to the bucket's since, and the bucket's reason SESSION kept on the receipt. A lot opens under the receipt's id, and `bucketOf` reads 0 again. Verify it and fill its row.

If the guard is not clear at the open, for example on PREMIUM, the keeper waits and looks again. A public settle opens one hour after the later of the bucket's since and the session's opening (D-025). The owner's "Buy SPY now" works at any time, but its receipt has trigger OWNER and does not count for claims 2.1 and 6.10.

### Step 6. Payments in session

During a session, after the feed's first round of it.

1. Before each payment, open https://trysleeve.xyz/rule and read the "Right now" line under the example payday. It says whether a payment arriving now would buy SPY or wait, and why. If it says the pool is more than the cap above the reference, a payment now queues PREMIUM. That is a valid receipt, and it is not the in-session fill. Wait for the pool to come back inside the cap. Do not raise the cap to force a fill: the cap is what the campaign measures.
2. One payment at a time. Each payer sends 10 USDG. The next payer sends only after the last payment shows its split in Payments, or after `nextReceiptId` moves, so each payment gets a split receipt of its own. Two payments that land before one split share a receipt, and the app's money trail then says "Split together with 1 other payment". The results count payments by transfers and receipts by receipts.
3. Expected for each payment: status FILLED, trigger KEEPER, usdgIn 10000000, usdgToSpend 5000000, usdgToEquity 5000000, usdgSpent 5000000, tokensOut above zero and at or above minOut, premiumBps at most 100, and a lot under the receipt's id. The SPY arrives in the account.
4. Verify each receipt and fill its row.
5. Screen-record one payment from the send to its split, and its receipt page ([DEMO_SCRIPT.md](DEMO_SCRIPT.md) shots 1, 5 and 7). Show a payer's address only with their consent.

The count: TEST_PAYER makes six payments in all, with step 4 and the 60 USDG of step 2, and Payer B and Payer C at least two each. That is at least 10 payments from at least 3 payers.

### Step 7. A sell-back (optional)

The control "a sell-back whose USDG does not split", on mainnet. In session, on https://trysleeve.xyz/sell, the owner sells one lot's SPY back to USDG. The exit line sits beside the sell (claim 6.3). The sell is an owner UserOp inside a bracket, under the same ZeroDev policy as the sign-up.

Expected: a SOLD receipt, or PART_SOLD for part of a lot, with trigger OWNER, its discount against the reference within the cap, and the USDG received booked to spend. Then `ledger(account)` reads unsorted 0, and no split receipt sorts the proceeds (I6). Verify it and fill its row. Without this step the control stays covered by its tests only, and claim 2.7 waits for a mainnet sell receipt.

### Step 8. Verify every receipt and save the output

Every receipt the campaign writes, the settle and any sell included, through the public RPC, a different provider from the keeper's QuickNode endpoint:

```
pnpm install
pnpm --filter @sleeve/verifier build
mkdir -p results/hp1/verify
node packages/verifier/bin/sleeve.js verify <id>
node packages/verifier/bin/sleeve.js verify <id> --json > results/hp1/verify/receipt-<id>.json; echo "exit $?"
```

| Exit code | Meaning | What to do |
| --- | --- | --- |
| 0 | Every row matches | Record 0 in the receipt's row |
| 1 | A row differs | Stop the campaign ([Stop conditions](#stop-conditions)) |
| 2 | No receipt with this id | Check the id |
| 3 | The chain could not be read | The public RPC is rate limited (D-012). Wait a minute and rerun. It is not a mismatch |
| 64 | A usage error | Fix the command |

The JSON records the RPC it read through, the chain id, the module, the block it read at, the transaction, every receipt field beside its recomputed value, every check, the derived rows (the inbound USDG transfers a split sorted, the session at the receipt, the transaction's sender) and the mismatch count. The same checks run in the browser at https://trysleeve.xyz/verify/<id>.

### Step 9. Check the target

- At least 10 USDG transfers from non-Sleeve addresses, each sorted by a split receipt in the [results table](#receipts).
- At least 3 distinct payers in the [payers table](#payers), TEST_PAYER counted once.
- At least 1 transfer whose block timestamp the deployed calendar reads as closed:

  ```
  BLOCK=$(cast receipt <transfer hash> blockNumber --rpc-url $RPC)
  TS=$(cast block $BLOCK --field timestamp --rpc-url $RPC)
  cast call $CAL "isOpenAt(uint256,uint8)(bool,uint8)" $TS 1 --rpc-url $RPC
  date -u -r $TS; TZ=America/New_York date -r $TS      # macOS. On Linux: date -u -d @$TS
  ```

- Every receipt's verifier exit code is 0, with its JSON in results/hp1/verify/.

### Step 10. Update the docs

See [After the campaign](#after-the-campaign).

## How to read a result

In the app, as the owner:

- Payments (https://trysleeve.xyz/payments) lists each USDG payment and what it became. Opening one shows its sender, its money trail and the receipt of its split.
- Home (https://trysleeve.xyz/home) shows both sleeves, what waits and why, and the payment address.
- A receipt page (https://trysleeve.xyz/receipts/<id>) shows the receipt id, the fields the verifier checks, the transaction, the payments the split sorted, the accounting mode with its line, and "debt security, not a share" under any Stock Token amount. Its "Check this split" card recomputes the receipt through the public RPC.

On the explorer, as anyone:

- The payment: https://robinhoodchain.blockscout.com/tx/<transfer hash>, a USDG transfer to the account.
- The keeper's transactions: https://robinhoodchain.blockscout.com/address/0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46. Each split or settle is a call to the module, and its logs hold `ReceiptWritten`, whose first indexed topic is the receipt id.
- The account: https://robinhoodchain.blockscout.com/address/<account>, with its USDG and SPY transfers and balances.

With the verifier, as in [step 8](#step-8-verify-every-receipt-and-save-the-output). With cast, through `ledger`, `bucketOf` and `nextReceiptId` as in steps 3 and 4.

The keeper's index lists an account's receipts and payments: https://trysleeve.xyz/api/index?view=receipts&account=<account> and `view=inbox`. It is the keeper's own data, so it helps find ids and never counts as a check.

An M0 receipt carries no payer: its payer field belongs to the pay link and stays zero. The payer of a split comes from the USDG Transfer log into the account, which the receipt page lists as the payments the split sorted and the verifier prints as derived rows.

## Results

Empty until the campaign runs.

### Payers

| Payer | Address | Name or label | Relation to the team | May be shown in docs and video | Payments |
| --- | --- | --- | --- | --- | --- |
| TEST_PAYER | 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC | TEST_PAYER | The team's own key (D-004) | yes |  |
| Payer B |  |  |  |  |  |
| Payer C |  |  |  |  |  |

### Receipts

| # | Receipt id | Payer | Payment transfer | Time UTC | Time New York | In or off session | Status and reason | usdgIn | Spend | Equity | Tokens out | Premium bps | Verifier exit | Transaction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

How to fill each column:

| Column | Source |
| --- | --- |
| Receipt id | The receipt page, or the verifier's output |
| Payer | The label from the payers table, from the USDG transfer's sender. "none" on a settle or a sell |
| Payment transfer | The explorer link of the USDG transfer the split sorted, or of each one when a split sorted several |
| Time UTC, Time New York | The transfer's block timestamp on a split row, the receipt's timestamp on any other row ([step 9](#step-9-check-the-target) commands) |
| In or off session | `isOpenAt(time, 1)` on the deployed calendar: "in", or "off" with its reason code |
| Status and reason | The receipt's status and reason, such as QUEUED SESSION, SETTLED SESSION or FILLED NONE |
| usdgIn, Spend, Equity, Tokens out | The receipt's usdgIn, usdgToSpend, usdgToEquity and tokensOut in base units, as the verifier prints them. USDG has 6 decimals and Stock Tokens 18. A settle has usdgIn 0 |
| Premium bps | The receipt's premiumBps. Blank when the receipt carries no price, as on a QUEUED SESSION receipt |
| Verifier exit | The exit code of `sleeve verify` through the public RPC |
| Transaction | The explorer link of the receipt's own transaction: the split, the settle or the sell |

### Keeper transactions

The mainnet gas the campaign paid, for [Costs](#costs) and as input to the script claim 5.2 waits for.

| Receipt id | Transaction | Call and outcome | gasUsed | effectiveGasPrice (wei) | ETH |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

```
cast receipt <transaction> gasUsed --rpc-url $RPC
cast receipt <transaction> effectiveGasPrice --rpc-url $RPC
```

ETH is gasUsed times effectiveGasPrice, divided by 10^18.

## Stop conditions

Stop the campaign, write down what happened in this file, and ask the owner before anything else is sent when:

- The sign-up fails, the app does not show the address, or a step 3 read-back differs. Nothing has moved and no payer has the address. ZeroDev's meta factory has no EntryPoint stake on 4663, so a strict bundler could reject the first UserOp. The fallback, a direct deployment through the factory, is an owner decision (docs/research/zerodev-passkey.md section 11 item 3).
- A payment gets no split receipt and the keeper's gas hold does not explain it. Check `ssh root@nightbook-vps 'curl -s http://127.0.0.1:8787/health'` and `ssh root@nightbook-vps 'journalctl -u sleeve-keeper -n 100 --no-pager'`.
- A receipt has a status or reason its step did not expect, such as REFUSED_TICKER or REFUSED_ACCOUNT.
- The verifier exits 1. Record the rows that differ exactly as printed. The verifier smooths no mismatch (claim 2.6), and neither does this file.
- The bucket from step 4 does not settle while the rule page's "Right now" line says a payment would buy.
- The keeper raises LOW_BALANCE, or a send would cost more ETH than [Costs](#costs) plans.

These are not failures:

- The keeper holding a payment while the base fee is above its 0.1 gwei ceiling, for up to 24 hours (PRD 7.2, [keeper/README.md](../keeper/README.md)).
- A verifier exit code 3, which is the public RPC's rate limit.
- A payment that queues PREMIUM or STALE. It is a valid receipt to record.

## Costs

In ETH. Gas per call is the fork measurement in [GAS.md](GAS.md) (block 78,312,136, `forge test --isolate`), priced at the 31,610,000 wei (0.0316 gwei) gas price [FUNDING.md](FUNDING.md) recorded on 2 October 2026. ETH is the gas times 31,610,000, divided by 10^18.

| Paid by | Call | Gas | ETH at 0.0316 gwei |
| --- | --- | --- | --- |
| KEEPER | split that queues SESSION | 238,510 | 0.0000075 |
| KEEPER | split that queues PREMIUM, swap undone | 510,096 | 0.0000161 |
| KEEPER | split that fills on SPY | 543,779 | 0.0000172 |
| KEEPER | settle | 522,261 | 0.0000165 |
| ZeroDev, under its policy | sell of one lot in a bracketed owner UserOp, actualGasUsed | 695,926 | 0.0000220 |
| Each payer | one USDG transfer, the planning estimate in [FUNDING.md](FUNDING.md), not measured | about 80,000 | about 0.0000025 |

An example campaign: two off-hours payments whose splits queue, one settle and eight in-session fills. That is 5,349,513 gas for KEEPER, 0.000169 ETH at 0.0316 gwei and 0.000535 ETH at the keeper's 0.1 gwei ceiling. KEEPER holds 0.001 ETH, and its LOW_BALANCE alert sits at 0.0003 ETH. TEST_PAYER's six transfers come to about 480,000 gas, about 0.0000152 ETH, against the 0.0003 ETH it is to receive.

Owner UserOps cost the owner nothing while ZeroDev sponsors them: the sign-up, and the sell if step 7 runs. [GAS.md](GAS.md) does not measure the sign-up's first UserOp, so its UserOperationEvent gives that figure. Each sponsored op must stay under the policy's 0.0002 ETH, and all of them under 0.00075 ETH and 50 requests a day.

What the table leaves out:

- The fork figures leave out the chain's L1 data component. It was 0 when [FUNDING.md](FUNDING.md) measured it on 2 October, and it moved during the 3 October deploy dry runs ([DEPLOY_PLAN.md](DEPLOY_PLAN.md) section 6).
- The gas price moves. Read `cast gas-price` on the day.
- Above the 0.1 gwei ceiling the keeper holds sorting until a payment has waited 24 hours, then sends at up to 1 gwei, the default cap in keeper/deploy/keeper.env.example. At 1 gwei the example campaign would cost 0.00535 ETH, more than KEEPER holds, so pause the campaign through a fee spike.

The mainnet cost is the sum of the [keeper transactions table](#keeper-transactions). The USDG is not spent: it moves from the payers into the campaign account and stays there, as USDG or as SPY.

## After the campaign

A claim row changes status in the same commit that adds its evidence, and that commit edits [CLAIM_LEDGER.md](CLAIM_LEDGER.md) (ledger rule 4). Commit results/hp1/verify/ with the filled tables of this file and the ledger edits.

| Ledger row | Status on 4 October 2026 | After the campaign | Evidence from the campaign |
| --- | --- | --- | --- |
| 5.3 | PENDING | MEASURED, with N, M and K filled in | The payers and receipts tables, the transfer links, and results/hp1/verify/ |
| 1.1 | PENDING | MEASURED | The split receipts with trigger KEEPER or PUBLIC, by id, each with exit code 0 |
| 1.11, and I2 in the invariant map | PENDING | MEASURED | The verifier's I2 conservation row on every split receipt |
| 2.1 and 6.10 | PENDING | MEASURED | A FILLED or SETTLED receipt with trigger KEEPER or PUBLIC, verified |
| 2.2 | PENDING | MEASURED | The QUEUED SESSION receipt from step 4, verified, with the `bucketOf` read while it waited |
| 2.4 | PENDING | MEASURED | The verifier's premium row (I8) on every FILLED and SETTLED receipt |
| 2.6 | PENDING | MEASURED | The committed verifier output for every campaign receipt, zero mismatches, through the public RPC |
| 2.7 | PENDING | MEASURED once a mainnet buy receipt and a mainnet sell receipt exist | The FILLED and SETTLED receipts, and the SOLD or PART_SOLD receipt from step 7 |
| 6.5 | PENDING | MEASURED | The verifier's disclosure row on every receipt |
| 6.6 | PENDING | MEASURED | Receipts that meet the 1.11 equality, and the keeper's transactions sent and paid by KEEPER |
| 6.9 | PENDING | MEASURED | The sponsored sign-up from step 3: its UserOp, its UserOperationEvent and the account's ETH balance |
| Controls: an in-session fill, a weekend payment that queues | Pending | Measured | The FILLED receipt from step 6 and the QUEUED SESSION receipt from step 4 |
| Control: a sell-back whose USDG does not split | Pending | Measured if step 7 runs | The SOLD receipt and the `ledger` read after it |
| 1.2 and 5.2 | PENDING | Still PENDING | Each needs a repo script, not written yet, that reads the campaign's transfers and split transactions. This file's tables are its input |
| 8.3 | PENDING | MEASURED only if a payment was bridged straight to the address | That delivery and its split receipt |

Row 4.6, the exit through a recovery signer, does not move with this campaign. It waits for its fork test.

The README:

- The Evidence section lists the campaign's receipt ids, each linked to https://trysleeve.xyz/verify/<id> and to its transaction on the explorer, in the form ledger row 9.11 gives: "N receipts, ids A to B, on Robinhood Chain mainnet from date to date, each matched by the verifier." It states the campaign rule, 50 percent to SPY with a 1 USDG minimum buy, beside the product default of 10 percent with a 25 USDG minimum.
- The Status table's HP1 row moves from Pending to that result, and the web app row drops "The first mainnet sign-up comes with HP1".
- The sentence "Mainnet receipts start with HP1" in the verifier section goes. The gas paragraph keeps its fork figures until the claim 5.2 script exists.

Other files: [packages/verifier/README.md](../packages/verifier/README.md), whose last paragraph says no mainnet receipt exists, [PROGRESS.md](PROGRESS.md), and [GATES.md](GATES.md) for the first live UserOp through ZeroDev. To show a real payday on the landing page, set NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID to a FILLED receipt's id and redeploy with `pnpm --filter @sleeve/app cf:deploy` (app/src/components/landing/example-receipt.ts).
