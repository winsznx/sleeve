# Gas

Measured on 3 October 2026 against chain 4663 forked from the archive RPC https://robinhood.drpc.org, with SleeveModule as built in component 6 (sell-back), the deployed Kernel v3.1 stack, real USDG, the real SPY, QQQ, NVDA and AAPL tokens and feeds, and the D-010 pools through SwapRouter02. These numbers replace the gas estimates in docs/FUNDING.md.

## Method

Rerun:

```
cd contracts
FOUNDRY_OUT=out-c6 FOUNDRY_CACHE_PATH=cache-c6 forge test --match-path test/fork/SleeveModuleGas.t.sol --isolate -vv
```

`--isolate` runs every call the test makes as its own transaction, so every contract and storage slot the call touches starts cold, as it does on chain. Each test logs `vm.lastCallGas().gasTotalUsed` right after the measured call. Under `--isolate` that figure is the whole transaction's gas used: the 21,000 intrinsic gas, the calldata, and execution. A check with a contract whose function does nothing reports 21,183 for it, 21,000 plus 64 for four calldata bytes plus 119 of execution. The chain charges no L1 data component today (docs/FUNDING.md), so this is the gas a keeper transaction pays for.

Without `--isolate` the same tests run inside one transaction whose setup has already warmed the module, the account and the tokens, and the figures come out 40,000 to 130,000 lower. They are only a floor.

Setup of every measured call: an account deployed through the Kernel v3.1 factory with the module installed by a signed root UserOp through EntryPoint v0.7, the product default rule (10 percent to the ticker, 100 bps premium cap, 50 bps slippage, 25 USDG clip), and a 1,000 USDG payment, so a split sorts 1,000 USDG and buys with 100. Fork block 78,312,136 (Friday 2 October 2026 10:44 EDT) unless the row says otherwise.

## Keeper transactions

| Call | Outcome | Gas used |
| --- | --- | --- |
| observe | the first observation, two fresh storage slots | 70,973 |
| split | FILLED on SPY, fee 500 | 532,996 |
| split | FILLED on QQQ, fee 500 | 517,320 |
| split | FILLED on NVDA, fee 500 | 517,683 |
| split | FILLED on AAPL, fee 500 | 517,362 |
| split | FILLED on AAPL, fee 3000 | 526,039 |
| split | QUEUED PREMIUM: the swap runs and is undone | 499,368 |
| split | QUEUED CLIP: the whole guard runs, no swap | 303,926 |
| split | QUEUED SESSION at block 73,280,794, Saturday 26 September 2026: the guard stops at the calendar | 238,235 |
| settle | SETTLED, a 200 USDG bucket on SPY | 509,099 |

Every row with a swap is about 3,700 gas above the component 5 measurement (529,278 for the SPY fill). The difference is the audit A1 fix: executeBuy reads the module's own USDG and token balances before the swap, so its I1 check is a delta and a balance sent to the module cannot block buys. The rows without a swap did not move, and the sell-back added in component 6 changes none of them: the same command on the frozen snapshot of commit 6535108 gives the same figures.

The costliest keeper call is a fill, about 533,000 gas, against the 700,000 that docs/FUNDING.md assumed. At the 31,610,000 wei gas price recorded there, that is 0.0000168 ETH per fill.

Where a SPY fill's gas goes, from the `-vvvv` trace of the same run. The figures are the gas each part spent inside the call, before refunds:

| Part | Gas |
| --- | --- |
| SleeveTrade.split, the whole library call | 525,592 |
| of which the buy through executeBuy: the module's own balances, the Kernel batch with the exact approvals, the swap, then the balance, allowance and decimals checks | 194,629 |
| of which SwapRouter02 and the pool, inside the buy | 102,070 |
| of which the calendar's sessionState | 37,620 |
| of which the other reads: Kernel's isModuleInstalled, the USDG balance, TokenSource, the token and its registry, both feeds | 80,380 |
| of which uid, uiMultiplier, the calendar version and the L2 block for the receipt | 7,734 |
| of which the module's own work: spend, the receipt hash, the lot in two slots, the lot's place in the account's queue, the ReceiptWritten event with every field, and encoding | 205,229 |

The transaction's 532,996 adds the 21,000 intrinsic gas, about 1,000 for the calldata and the module's own wrapper, and subtracts the storage refunds the transaction earns, such as the account's USDG allowance going back to zero within the call.

## Owner calls

| Call | Gas |
| --- | --- |
| release, the module call alone as one transaction | 100,865 |
| release in a bracketed owner UserOp, actualGasUsed | 374,719 |
| split FILLED on SPY in a bracketed owner UserOp, actualGasUsed | 757,205 |

`actualGasUsed` is what the account or a paymaster pays for the UserOp. With the test limits (verificationGasLimit 1,000,000, callGasLimit 1,000,000, preVerificationGas 100,000) it includes the 100,000 preVerificationGas and EntryPoint v0.7's penalty of 10 percent of unused call gas (docs/research/g6-notes.md section 6), so a bundler's tighter limits give lower figures.

## Sell-back and the lot reconcile

Component 6, same method and fork block. Each account holds lots bought by keeper splits of 1,000 USDG under the product default rule, so one SPY lot is the 100 USDG buy, about 0.1293 SPY. Each owner call is measured as the account's call to the module on its own, and the one-lot sell also as a whole bracketed owner UserOp through handleOps.

| Call | Outcome | Gas used |
| --- | --- | --- |
| sell | SOLD, one lot, the module call | 442,361 |
| sell | SOLD, one lot, in a bracketed owner UserOp, actualGasUsed | 683,566 |
| sell | PART_SOLD, half of one lot | 426,021 |
| sell | SOLD with the off-hours override, which skips the calendar and the feed's age | 404,081 |
| sell | SOLD by amount across three lots: one swap, three receipts | 552,917 |
| reconcileLots | one lot trimmed after the owner moved half its tokens out | 125,845 |

Each extra lot a sell takes from adds about 55,000 gas: its two storage slots, a receipt hash and a ReceiptWritten event. A sell by lot id touches one lot whatever the queue holds, so an owner with many lots can keep a sell to one receipt.

Where the one-lot SOLD sell's gas goes, from the `-vvvv` trace of `test_gas_sell_SOLD_byOwner`:

| Part | Gas |
| --- | --- |
| SleeveSell.sell, the whole library call | 438,921 |
| of which the batch on the account: the token's exact approval, the swap, the approval reset | 137,060 |
| of which SwapRouter02 and the pool, inside the batch | 92,214 |
| of which the calendar's sessionState, which the override skips | 37,620 |
| of which the other reads: Kernel's isModuleInstalled, TokenSource, the account's token balance, the token and its registry for the account, the pool and the router, the pauses, the multiplier, both feeds, the module's and the account's balances around the swap, the allowance, the three decimals, uid, uiMultiplier, the calendar version and the L2 block | 115,821 |
| of which the module's own work: the lot and the queue's head, spend, the receipt hash, the ReceiptWritten event with every field, and encoding | 148,420 |

At the 31,610,000 wei gas price in docs/FUNDING.md, the sell UserOp costs 0.0000216 ETH, which the owner's paymaster or the account pays. The keeper never pays for a sell.

