# Sleeve verifier

Recomputes a Sleeve receipt from public Robinhood Chain data and prints every field beside its recomputed value. It reads through the public RPC, https://rpc.mainnet.chain.robinhood.com, on purpose: a different provider from the one the keeper uses, so a receipt is never checked by the infrastructure that wrote it. The same code runs in the browser at [trysleeve.xyz/verify](https://trysleeve.xyz/verify).

## What it checks

For a receipt id it reads the module's `ReceiptWritten` log, the transaction's logs, the pool's and the account's balance changes, the Chainlink rounds and the session calendar, then checks among others:

- The stored hash: `keccak256(abi.encode(receipt))` equals the module's `receiptHash(id)`, and the module logged the id once.
- I2 conservation: USDG in equals spend plus spent plus queued.
- The fill, measured from the transaction's logs: the pool's USDG and Stock Token changes, a Swap that paid the account, the whole equity amount spent, and the tokens received at or above the trigger's minimum.
- I8: the premium within the rule's cap, a fresh Chainlink round with a positive answer observed after the session opened, and an unpaused oracle.
- The session, the pending multiplier, the pool allowlist and USDG within its band of 1 on the USDG/USD feed.
- The lot record and its transitions (I7), sell runs, releases and reconciles.
- The disclosure hash is the issuer text Sleeve ships ([../../docs/disclosure](../../docs/disclosure/README.md)).

## Use

```bash
pnpm install
pnpm --filter @sleeve/verifier build
node packages/verifier/bin/sleeve.js verify <receiptId>
```

```
Usage: sleeve verify <receiptId> [--rpc <url>] [--json] [--from-block <n>]

  --rpc <url>         RPC to read through. Default https://rpc.mainnet.chain.robinhood.com.
  --json              Print the result as JSON.
  --from-block <n>    Start the module's log scans at block n, at or before the receipt's block.

Exit codes: 0 every row matches, 1 a row differs, 2 no receipt with this id, 3 the chain could not be read,
64 a usage error.
```

Receipts on mainnet start with Sleeve's first live payment; until then there is no receipt id to verify.

## Tests

```bash
pnpm --filter @sleeve/verifier test        # 158 tests
pnpm --filter @sleeve/verifier test:fork   # verifies receipts written on an anvil fork
```

The fork suite runs the deployed module on an anvil fork of chain 4663 and verifies every receipt it writes: a split that queued over the weekend, the settle after the reopen, a fill in session, a sell across two lots, a release, and reconciles after an outside pull.
