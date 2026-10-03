# Gas

Measured on 3 October 2026 against chain 4663 forked from the archive RPC https://robinhood.drpc.org, with SleeveModule as built in component 5, the deployed Kernel v3.1 stack, real USDG, the real SPY, QQQ, NVDA and AAPL tokens and feeds, and the D-010 pools through SwapRouter02. These numbers replace the gas estimates in docs/FUNDING.md.

## Method

Rerun:

```
cd contracts
FOUNDRY_OUT=out-c5 FOUNDRY_CACHE_PATH=cache-c5 forge test --match-path test/fork/SleeveModuleGas.t.sol --isolate -vv
```

`--isolate` runs every call the test makes as its own transaction, so every contract and storage slot the call touches starts cold, as it does on chain. Each test logs `vm.lastCallGas().gasTotalUsed` right after the measured call. Under `--isolate` that figure is the whole transaction's gas used: the 21,000 intrinsic gas, the calldata, and execution. A check with a contract whose function does nothing reports 21,183 for it, 21,000 plus 64 for four calldata bytes plus 119 of execution. The chain charges no L1 data component today (docs/FUNDING.md), so this is the gas a keeper transaction pays for.

Without `--isolate` the same tests run inside one transaction whose setup has already warmed the module, the account and the tokens, and the figures come out 40,000 to 130,000 lower. They are only a floor.

Setup of every measured call: an account deployed through the Kernel v3.1 factory with the module installed by a signed root UserOp through EntryPoint v0.7, the product default rule (10 percent to the ticker, 100 bps premium cap, 50 bps slippage, 25 USDG clip), and a 1,000 USDG payment, so a split sorts 1,000 USDG and buys with 100. Fork block 78,312,136 (Friday 2 October 2026 10:44 EDT) unless the row says otherwise.

## Keeper transactions

| Call | Outcome | Gas used |
| --- | --- | --- |
| observe | the first observation, two fresh storage slots | 70,973 |
| split | FILLED on SPY, fee 500 | 529,278 |
| split | FILLED on QQQ, fee 500 | 513,602 |
| split | FILLED on NVDA, fee 500 | 513,965 |
| split | FILLED on AAPL, fee 500 | 513,644 |
| split | FILLED on AAPL, fee 3000 | 522,321 |
| split | QUEUED PREMIUM: the swap runs and is undone | 495,656 |
| split | QUEUED CLIP: the whole guard runs, no swap | 303,926 |
| split | QUEUED SESSION at block 73,280,794, Saturday 26 September 2026: the guard stops at the calendar | 238,235 |
| settle | SETTLED, a 200 USDG bucket on SPY | 505,381 |

The costliest keeper call is a fill, about 530,000 gas, against the 700,000 that docs/FUNDING.md assumed. At the 31,610,000 wei gas price recorded there, that is 0.0000167 ETH per fill.

Where a SPY fill's gas goes, from the `-vvvv` trace of the same run. The figures are the gas each part spent inside the call, before refunds:

| Part | Gas |
| --- | --- |
| SleeveTrade.split, the whole library call | 521,874 |
| of which the buy through executeBuy: the Kernel batch with the exact approvals, the swap, then the balance, allowance and decimals checks | 190,911 |
| of which SwapRouter02 and the pool, inside the buy | 102,070 |
| of which the calendar's sessionState | 37,620 |
| of which the other reads: Kernel's isModuleInstalled, the USDG balance, TokenSource, the token and its registry, both feeds | 80,380 |
| of which uid, uiMultiplier, the calendar version and the L2 block for the receipt | 7,734 |
| of which the module's own work: spend, the receipt hash, the lot in two slots, the lot's place in the account's queue, the ReceiptWritten event with every field, and encoding | 205,229 |

The transaction's 529,278 adds the 21,000 intrinsic gas, about 1,000 for the calldata and the module's own wrapper, and subtracts the storage refunds the transaction earns, such as the account's USDG allowance going back to zero within the call.

## Owner calls

| Call | Gas |
| --- | --- |
| release, the module call alone as one transaction | 100,865 |
| release in a bracketed owner UserOp, actualGasUsed | 374,639 |
| split FILLED on SPY in a bracketed owner UserOp, actualGasUsed | 753,779 |

`actualGasUsed` is what the account or a paymaster pays for the UserOp. With the test limits (verificationGasLimit 1,000,000, callGasLimit 1,000,000, preVerificationGas 100,000) it includes the 100,000 preVerificationGas and EntryPoint v0.7's penalty of 10 percent of unused call gas (docs/research/g6-notes.md section 6), so a bundler's tighter limits give lower figures.
