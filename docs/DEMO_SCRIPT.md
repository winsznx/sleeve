# Demo video script

A shot-by-shot script for the submission video, about 3 minutes long. Written on 4 October 2026. Nothing has been filmed. HP1 started on 4 October with ten off-hours payments and their QUEUED receipts (results/hp1/RECEIPTS.md), so the sign-up, the payment and the waiting shots can be filmed now, and the buy shots after the market opens. Each shot names the step of [EVAL_CAMPAIGN.md](EVAL_CAMPAIGN.md) it waits for, as "film after HP1 step N".

[CLAIM_LEDGER.md](CLAIM_LEDGER.md) decides every line. Where this script and the ledger disagree, the ledger wins. A voice-over line goes into the cut only when the ledger row behind it is MEASURED, or PROVISIONAL and spoken with that word and its reason. [Claims behind the lines](#claims-behind-the-lines) maps each line to its row.

## Contents

- [Rules for this video](#rules-for-this-video)
- [What each HP1 step makes filmable](#what-each-hp1-step-makes-filmable)
- [Script](#script)
- [Optional shot: a sell-back](#optional-shot-a-sell-back)
- [Claims behind the lines](#claims-behind-the-lines)
- [Required lines on screen](#required-lines-on-screen)
- [Description for the upload](#description-for-the-upload)
- [Checks before publishing](#checks-before-publishing)

## Rules for this video

- Lead with the payday split. The receipt and the verifier come after it, as the proof (D-024).
- Show only paths that have run on mainnet (ledger rule 6, row 9.15). Film the live app at https://trysleeve.xyz, which reads Robinhood Chain mainnet. Never film the sample data source, which local runs use by default, and never present a fork run as the product.
- A shot whose HP1 step has not run stays in this script, marked, and stays out of the cut. Nothing stands in for it.
- Every number on screen or in the voice-over comes from a mainnet receipt shown with its id, or from a repo file named on screen (ledger rule 5). The rule editor's "On a 500 USDG payday" card is an example, so it carries the word "Illustrative" whenever it is in frame (row 9.28).
- Write "Stock Token" and "Robinhood Chain" in full and capitalized, with one style for both words of the network's name. Never call a Stock Token a share, stock or stock ownership (row 9.1). Never claim borrowing, a pay link, exact sorting for actions signed outside Sleeve, best execution, yield or returns, or a participation rate from retirement-plan research (rows 9.4 to 9.10). Never give a speed or cost figure that no script in the repo measured (row 9.27), or a count of users or payments other than published receipts (row 9.11).
- Sleeve's own name and mark lead. No Robinhood logo or feather, no Robinhood Chain marks in generated or edited imagery, and nothing that suggests a partnership (row 9.12, docs/research/issuer-docs.md section 4). A post that tags anyone tags @RobinhoodCrypto, never @RobinhoodApp.
- Never film .env.local, ~/.sleeve-keys, the keeper's RPC URL, the VPS or the Supabase dashboard. Show a payer's address only with their consent.
- Captions use no em dash and no en dash.

## What each HP1 step makes filmable

Two screens exist only once, so they are recorded live while the step runs.

| HP1 step | Makes filmable | Record live |
| --- | --- | --- |
| 3. Sign up and set the campaign rule | The address card in shot 2, and shots 3 and 4 | Yes. A sign-up happens once per account |
| 4. The first payment, off-hours | The wait in shot 6 | Yes, before the open. The waiting card on Home is gone once the keeper settles |
| 5. The settle after the open | The settle in shot 6 | No, the receipt stays |
| 6. Payments in session | Shots 1, 5, 7 and 10 | One payment from the send to its split |
| 7. A sell-back (optional) | The optional sell-back shot | Yes, the sell flow |
| 8. Verify every receipt | Shot 8. Any receipt a shot shows must have exit code 0 first | Yes, the terminal |
| 10. Update the docs | The voice-over. Each line waits until its ledger row is MEASURED | No |

## Script

Times are approximate. The voice-over runs at about 150 words a minute. Bracketed values come from the named receipt at filming time.

| Shot and time | On screen | Voice-over | Needs on mainnet first |
| --- | --- | --- | --- |
| 1. The payday split, 0:00 to 0:10 | The owner's Payments screen at https://trysleeve.xyz. One payment from HP1 step 6 opens into its two parts: the USDG that stays spendable and the SPY it bought, with "debt security, not a share" directly under the SPY amount. Caption: "Receipt [id], Robinhood Chain mainnet, [date UTC]." | "When you get paid, part of it becomes a US Stock Token you own and the rest stays spendable. You set it once." | Film after HP1 step 6: a FILLED receipt started by the keeper, verified in step 8. Record the voice-over after step 10 moves rows 2.1 and 6.10 to MEASURED |
| 2. The address, 0:10 to 0:21 | The landing page at https://trysleeve.xyz, its hero and footer, then the payment address card with its QR code on Home. | "Sleeve is a payment address on Robinhood Chain. Give payers your address. USDG that arrives while your rule is active is split without you signing anything." | The address card: film after HP1 step 3. The landing's headline is the opening line, so film the landing only once row 6.10 is MEASURED, as for shot 1, and after NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID names a FILLED receipt, so the hero shows that real payday ([EVAL_CAMPAIGN.md, After the campaign](EVAL_CAMPAIGN.md#after-the-campaign)). Record the voice-over after step 10 moves row 1.1 |
| 3. Sign up with a passkey, 0:21 to 0:37 | The recording from HP1 step 3: /onboard, the eligibility questions, "Use a passkey" with its accounting limit line legible, the device's passkey prompt, "One approval with your passkey", then the Done screen with the address and its QR code. | "Sign-up takes a passkey. One approval creates your own smart account, with the Sleeve module and your rule installed in the same step. Its address is your payment address." Add "Owner actions are gas-sponsored up to a cap." only after row 6.9 is MEASURED. | Film during HP1 step 3. A sign-up cannot be filmed after it happens |
| 4. Set the rule, 0:37 to 0:53 | The rule step from the same recording, or https://trysleeve.xyz/rule on the campaign account: SPY, the slider at 50 percent, the premium cap, the slippage cap, a minimum buy of 1 USDG. Caption: "Campaign rule: 50 percent to SPY, 1 USDG minimum buy. Suggested start: 10 percent, 25 USDG minimum buy." | "Pick the Stock Token, how much of each payment buys it, and the price guard. This campaign uses 50 percent to SPY with a 1 USDG minimum buy. The suggested start is 10 percent with a 25 USDG minimum." | Film during or after HP1 step 3 |
| 5. A payment splits, 0:53 to 1:13 | The payer's wallet sending 10 USDG to the address, or the transfer on robinhoodchain.blockscout.com. Then Payments with the new payment and its money trail: the spend part, the USDG that bought SPY, the SPY received, "debt security, not a share" under it. Caption: "From [payer label]. Receipt [id]: FILLED, started by the keeper. Premium against the Chainlink reference: [premiumBps] bps, cap 100 bps." | "A payer sends USDG from their own wallet. The keeper splits it, with no signature from you. Half stays spendable USDG. Half buys SPY on an allowlisted Uniswap v3 pool, at a premium inside your cap over the Chainlink reference, and the Stock Token lands in your own account." | Film during HP1 step 6. Record the voice-over after step 10 moves rows 1.1, 2.1 and 2.4 |
| 6. Closed market, 1:13 to 1:35 | The Home recording from HP1 step 4: "waiting to buy SPY", the reason tag, "The market is closed, so it waits as USDG and buys SPY after the open.", the countdown and "Release to spend", not pressed. Then the SETTLED receipt from step 5 and the SPY now held. Caption: "Receipt [queued id]: QUEUED, market closed. Receipt [settled id]: SETTLED after the open." | "When the market is closed, the equity share does not buy. It waits as USDG in your own account, with the reason on screen, and you can release it to spend at any time. When the market opens, the keeper triggers the buy, and the waiting USDG becomes SPY in your account." | The wait: film during HP1 step 4, before the open. The settle: film after HP1 step 5. Record the voice-over after step 10 moves rows 2.2 and 2.1 |
| 7. The receipt, 1:35 to 1:53 | https://trysleeve.xyz/receipts/[id] for the shot 5 receipt. Highlight in turn: USDG in, the spend part, the USDG spent, the SPY received with "debt security, not a share", the execution price and premium, the Chainlink round, the pool, the disclosure hash with "Matches the issuer disclosure below", the L2 block, and the accounting mode with "Sorting is exact for actions taken through Sleeve, not for actions signed outside it." | "Each action writes a receipt on chain and stores its hash. This one records the USDG that arrived, the part that stayed spendable, the USDG that left for the pool, the SPY that arrived, and the premium over the Chainlink round it used." | Film after HP1 step 6, once step 8 verified this receipt |
| 8. Anyone can check it, 1:53 to 2:08 | A terminal at the repo root runs `node packages/verifier/bin/sleeve.js verify [id]`. The field table scrolls with the host rpc.mainnet.chain.robinhood.com in view, every row matches, and `echo $?` prints 0. Then https://trysleeve.xyz/verify/[id] with the same result. Caption while the token fields are in view: "SPY Stock Token: debt security, not a share." | "Anyone can recompute any receipt from public chain data. The verifier reads through Robinhood Chain's public RPC, a different provider from the keeper's, and checks every field and the stored hash." | Film after HP1 step 8. Record the voice-over after step 10 moves row 2.6 |
| 9. The replay, 2:08 to 2:35 | A title card with the claim 1.3 text, the word "Provisional" and its reason, and the source: docs/HP2_RESULTS.md, written by scripts/hp2/run.py under docs/HP2_PROTOCOL.md. The 309.11 bps figure appears only with the SPY sentences of row 1.4 beside it (row 9.21, D-020), or not at all. | "A replay of 1,000 payments of 100 USDG, under a protocol committed before the replay harness and its results, gives a provisional result. The guard refused a real extreme mispricing that buying at arrival would have paid, and in ordinary conditions it cost about 1.7 basis points per payment to wait for the reference. It stays provisional until the protocol's rerun on a second provider runs." | Nothing on mainnet: a replay of recorded chain data. Recheck row 1.3 before the cut, and use the ledger's wording if the rerun has run |
| 10. Your money stays yours, 2:35 to 2:49 | The campaign account's page on https://robinhoodchain.blockscout.com with its USDG and SPY balances. Caption under the SPY balance: "debt security, not a share". Caption: "Your USDG and Stock Tokens stay in your own smart account." | "Your USDG and Stock Tokens stay in your own smart account. If the keeper stops, you can trigger a split yourself, and you can release waiting USDG to spend at any time." | Film after HP1 step 6, when the account holds SPY. The voice-over's rows are MEASURED now |
| 11. End card, 2:49 to 2:57 | Sleeve's logo and trysleeve.xyz, then the end card lines in [Required lines on screen](#required-lines-on-screen). | "Sleeve. Get your payment address at trysleeve.xyz." | Nothing |

Why shot 10 does not say the owner can leave without Sleeve. Row 4.6 makes that claim only for an owner who set a recovery signer, and it stays PENDING until a fork test runs that exit through a recovery signer. For a passkey account without a recovery wallet, the passkey signs only on Sleeve's site, so the line would be false for it. Shot 10 therefore uses rows 3.7, 4.2 and 3.6, all MEASURED. Once row 4.6 is MEASURED, and only if the filmed account set a recovery wallet in HP1 step 3, the voice-over can add the row's own wording: "If Sleeve's keeper and app go offline, an owner who set a recovery signer can still withdraw spendable USDG, release waiting USDG, move Stock Tokens and remove the module from any ERC-4337 client."

## Optional shot: a sell-back

Film after HP1 step 7, once step 8 verified its receipt. It runs about 12 seconds, taken from shot 7 or added to the end of the cut.

| On screen | Voice-over |
| --- | --- |
| https://trysleeve.xyz/sell on the campaign account: the preview, the guard's verdict, the exit line beside the sell, the passkey approval, then the SOLD receipt with "debt security, not a share" under the SPY amount, and the USDG in spend. | "Sell-back turns a lot back into USDG with one approval. The USDG from the sale is booked to spend and never split." |

## Claims behind the lines

Status as of 4 October 2026, from [CLAIM_LEDGER.md](CLAIM_LEDGER.md). Recheck every row before the cut.

| Shot | Line | Ledger row | Status | Usable when |
| --- | --- | --- | --- | --- |
| 1 | The opening line | 6.10, as 2.1 | PENDING | A FILLED or SETTLED receipt started by the keeper or the public, verified (HP1 steps 5 or 6, then 8). "You own" means the Stock Token in the owner's account. Shot 6 says the equity share waits as USDG while the market is closed, which row 6.10 asks of any longer version |
| 1, 5 to 8, 10 | "debt security, not a share" under each Stock Token amount, from the app or as a caption | 6.1 | MEASURED | Now |
| 2 | The landing's headline, which is the opening line | 6.10 | PENDING | As for shot 1 |
| 2 | USDG that arrives while your rule is active is split without you signing anything | 1.1 | PENDING | A split receipt started by the keeper or the public, verified (HP1 step 4 or 6, then 8) |
| 3 | The accounting limit on the passkey step | 3.3 | MEASURED | Now. The step shows PASSKEY_RECORDS_LINE from app/src/lib/signer.ts |
| 3 | Owner actions are gas-sponsored up to a cap | 6.9 | PENDING | After the sponsored sign-up of HP1 step 3 moves the row |
| 4 | The campaign rule and the suggested start | 5.3 condition, D-014, packages/core/src/rule.ts | A disclosure, not a claim | Now. Row 5.3 requires the campaign rule to be disclosed |
| 5 | The keeper splits the payment, inside the cap, on an allowlisted pool | 1.1, 2.1, 2.4, 4.4 | 4.4 MEASURED, the rest PENDING | HP1 steps 6 and 8 |
| 6 | The equity share waits as USDG while the market is closed, can be released at any time, and buys after the open | 2.2, 3.6, 2.1 | 3.6 MEASURED, 2.2 and 2.1 PENDING | HP1 steps 4, 5 and 8 |
| 7 | What this receipt records, and that each action stores its receipt's hash | I7 in the invariant map | MEASURED | Now for the stored hash. The line speaks of the receipt on screen. A line about the all-in price of every buy and sell receipt waits for row 2.7 |
| 8 | Anyone can recompute any receipt from public chain data | 2.6 | PENDING | HP1 step 8, with the output committed |
| 9 | The replay | 1.3, the first sentence of 1.4, 1.7 | 1.3 and 1.4 PROVISIONAL, 1.7 MEASURED | Now, with "provisional" and its reason (ledger rule 3) |
| 10 | Your USDG and Stock Tokens stay in your own smart account. If the keeper stops, you can trigger a split yourself, and release waiting USDG at any time | 3.7, 4.2, 3.6 | MEASURED | Now |
| 10 | The exit through a recovery signer, as an added line | 4.6 | MEASURED | Now, and only for an account with a recovery wallet |
| 11 | The end card | Required lines, 6.2, 6.4, 6.8 | MEASURED | Now |
| Sell-back | The USDG from a sale is booked to spend and never split | 3.2 | MEASURED | With a mainnet sell receipt from HP1 step 7 |

## Required lines on screen

From the ledger's "Required lines":

- Under every holding and every receipt shown: "debt security, not a share". The app prints it under each Stock Token amount, so keep it legible in frame or repeat it in a caption.
- In the footer and on the end card, word for word: "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc."
- The network line on the end card: "Built on Robinhood Chain".
- At setup: the accounting limit, which the passkey step shows (shot 3).
- Beside any sell action shown: "Sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and pays cash, not shares. Sleeve offers no redemption."
- The issuer's disclosure with its source, retrieval date and hash: on the end card, and on the receipt page in shot 7.
- No screen built from sample data appears. If one ever did, it would carry the label that nothing shown happened on chain.

The end card, in this order, below Sleeve's logo and trysleeve.xyz:

1. "Sleeve is for people outside the United States who are paid in digital dollars." (row 6.8)
2. "Built on Robinhood Chain"
3. "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc."
4. "Each Stock Token is a debt security issued by Robinhood Assets (Jersey) Limited. It gives economic exposure to the underlying security and no legal or beneficial rights in, or against, the issuer of that security." (row 6.2)
5. "The issuer's own disclosure, word for word, retrieved on 2 October 2026 from docs.robinhood.com/rhj/product and docs.robinhood.com/rhj, keccak256 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89. Read it at trysleeve.xyz." (row 6.4)

## Description for the upload

Fill the brackets from the [EVAL_CAMPAIGN.md](EVAL_CAMPAIGN.md) results once the campaign has run. Like the voice-over, each sentence waits for its row: the first paragraph for 6.10 and 2.2, the second for 2.6 and 5.3.

> Sleeve is a payment address on Robinhood Chain that invests part of every payment. When you get paid, part of it becomes a US Stock Token you own and the rest stays spendable. You set it once. When the market is closed, that part waits as USDG in your account.
>
> Receipts in this video: [ids], on Robinhood Chain mainnet from [date] to [date], each matched by the verifier through the public RPC. Check any of them at https://trysleeve.xyz/verify. The campaign account's rule sends 50 percent of each payment to SPY with a 1 USDG minimum buy. The suggested start is 10 percent with a 25 USDG minimum.
>
> The replay result is provisional until the protocol's rerun on a second provider runs.
>
> Built on Robinhood Chain. Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc. Each Stock Token is a debt security issued by Robinhood Assets (Jersey) Limited. It gives economic exposure to the underlying security and no legal or beneficial rights in, or against, the issuer of that security.

## Checks before publishing

- Every row in [Claims behind the lines](#claims-behind-the-lines) has the status its line needs in the ledger as it stands at the cut. A line whose row is still PENDING comes out, with its shot if nothing else holds it up.
- Every number on screen traces to a receipt id shown in the same shot, or to a repo file named on screen.
- Every receipt shown has verifier exit code 0, with its JSON committed under results/hp1/verify/.
- The not-affiliated line and "Built on Robinhood Chain" are on the end card, and "debt security, not a share" is legible under every Stock Token amount.
- The voice-over and the captions contain none of: share, shares or shareholder (outside "spend share", "equity share" and the two required lines), stock ownership, dividend, yield, APY, returns, profit, best price, best execution, partner, official or endorsed (outside the not-affiliated line), tokenized stocks, Hood Chain, borrow or pay link (outside "not available yet").
- No frame shows a key, .env.local, the keeper's RPC URL, the VPS, the Supabase dashboard, or a payer's address without consent.
- The captions contain no em dash and no en dash.
