# Funding plan

Measured on 2 October 2026 at 15:35 Lagos time against https://rpc.mainnet.chain.robinhood.com.

| Reading | Value | Command |
| --- | --- | --- |
| Chain id | 4663 | `cast chain-id` |
| Gas price | 31,610,000 wei (0.0316 gwei) | `cast gas-price` |
| Base fee | 32,014,000 wei (0.0320 gwei) | `cast base-fee` |
| L1 calldata price | 0 wei per byte | ArbGasInfo `getPricesInWei()` at 0x...6C |
| L1 component for 20 KB calldata | 0 gas | NodeInterface `gasEstimateL1Component` at 0x...C8 |
| Plain ETH transfer | 21,000 gas | `cast estimate` |

The chain charges no L1 data component today, so cost is gas units times the L2 gas price. Gas units below are estimates until the contracts exist. They get replaced with measured numbers from fork runs and mainnet receipts.

## ETH per key, 3x margin

| Key | Work in the plan | Gas units | With 3x | ETH at 0.0316 gwei | Requested |
| --- | --- | --- | --- | --- | --- |
| DEPLOYER | Timelock, TokenSource with pool allowlist, calendar extension, SleeveModule, config, one test account created through EntryPoint handleOps, one full redeploy as contingency | 25,000,000 | 75,000,000 | 0.00237 | 0.0025 ETH |
| KEEPER | About 40 split and settle calls at about 700,000 gas each: the in-session test, the production end-to-end check, the campaign splits and Monday settles, retries | 28,000,000 | 84,000,000 | 0.00265 | 0.0030 ETH |
| TEST_PAYER | About 10 USDG transfers at about 80,000 gas | 800,000 | 2,400,000 | 0.00008 | 0.0003 ETH |

Total: 0.0058 ETH.

The early September congestion took median fees up roughly 40 times. The 3x margin does not cover a spike like that. During a spike the keeper holds sorting under its gas ceiling and the deploy waits.

## USDG for TEST_PAYER

| Use | Payments | USDG each | USDG |
| --- | --- | --- | --- |
| In-session live split, if the owner approves it | 1 | 10 | 10 |
| Production end-to-end check | 1 | 10 | 10 |
| Live campaign payments from TEST_PAYER | 4 | 10 | 40 |

Total: 60 USDG. The USDG is not consumed. It moves into Sleeve accounts, where the spend share stays USDG and the equity share becomes stock tokens in that account.
