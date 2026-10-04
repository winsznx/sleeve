# Supabase

Sleeve's database holds four things:

1. An index of the one SleeveModule in `packages/core` `DEPLOYMENT_4663`, rebuilt by the keeper from chain logs: `accounts`, `rule_versions`, `receipts`, `reconciliations`, `lots` and `payments`. The app reads it for the inbox, history, holdings and cards. The chain is the authority (PRD 13). When the index and the chain disagree, the chain wins, and the verifier never reads from here (PRD 10).
2. The keeper's own bookkeeping: `chain_cursor`, `keeper_runs` and `bucket_waits`.
3. Two records the app writes through its server routes: `passkey_credentials` and `cards`.
4. The waitlist the site's form fills through its server route: `waitlist` (D-038).

This file is the table contract for the keeper and the app. The migration is the source of truth for every rule named here.

| File | What it is |
| --- | --- |
| `config.toml` | `supabase init` output for the local stack, with sign-up turned off: Sleeve does not use Supabase Auth (D-003, D-014). |
| `migrations/20261003203436_sleeve.sql` | The schema: types, tables, rules, access. |
| `migrations/20261004120000_waitlist.sql` | The waitlist table and its access. |
| `seed.sql` | Local development data. `supabase db reset` loads it after the migrations. It never goes to the hosted project. |

## Tests, without Docker

The tests load the migration into PGlite, Postgres compiled to WebAssembly, in the test process. No Docker and no local Supabase stack (owner's directive). They live in `keeper/test/schema/`, next to the keeper that writes these tables:

```
pnpm --filter @sleeve/keeper exec vitest run test/schema
```

Before the migration they recreate what a hosted project already has: the `anon`, `authenticated` and `service_role` roles (the last with BYPASSRLS), usage on `public`, and Supabase's default grants of every new object in `public` to all three. Then they check every access rule by switching roles, each named rule in this file with a write it refuses, the SQL receipt encoder against viem on type edges and 300 random receipts, and the seed. PGlite 0.5 is Postgres 18 and the hosted project runs 17 (`config.toml`). The schema uses nothing that differs between them.

## Applying it to the hosted project

The owner does this once the project exists and `.env.local` holds its keys:

```
supabase link --project-ref <ref>
supabase db push
```

`db push` applies the migrations and not the seed. Agents never connect to the hosted project.

## Access

Row level security is on for every table. Only `receipts` and `lots` have a policy, a read for `anon` and `authenticated`, because they are public chain data. A table without a policy gives those roles nothing. The grants say the same thing, so a wrong grant alone or a wrong policy alone cannot open a table. The tests show each layer holding with the other one broken.

| Table | anon and authenticated | service_role |
| --- | --- | --- |
| `receipts` | select | select, insert, update |
| `lots` | select | select |
| `accounts`, `rule_versions`, `reconciliations`, `payments`, `chain_cursor` | nothing | select, insert, update |
| `keeper_runs`, `bucket_waits`, `passkey_credentials`, `cards` | nothing | select, insert, update, delete |
| `waitlist` | nothing | select, insert |

- The service role bypasses row level security, so its grants are its only limit. It never deletes chain history, and it never writes `lots`: the receipts trigger keeps them.
- Receipts, rule versions and reconciliations never change. They grant update only so an upsert can replay a row, and their `*_append_only` rule refuses an update that changes a value.
- The keeper and the app's server routes use the service role. Browser code uses the anon key and reads `receipts` and `lots` only. Everything else, including a passkey lookup at sign-in and a shared card, goes through a server route.
- The `private` schema holds the check, encoding and trigger functions. It is not exposed through the API, and `anon` and `authenticated` have no usage on it. The service role executes every function there, including ones later migrations add, because the checks run inside its writes.
- Later migrations start from nothing for `anon` and `authenticated`. The migration revokes Supabase's default grants in `public` from those roles, and revokes the Postgres default that lets every role execute a new function. A later migration that adds a table, sequence or function grants what it needs on purpose.

## Values

- Addresses are lowercase `0x` hex (`evm_address`). Lowercase a checksummed address before writing it or filtering on it. A write with a mixed-case address fails `evm_address_format`, but a filter compares as plain text and silently matches nothing, so keep one lowercasing step in each data layer.
- Hashes, `uid()` and the disclosure hash are lowercase 32-byte hex (`bytes32`). Raw log data is `hex_data`.
- Integers use the Solidity type as a domain: `uint8`, `uint16`, `uint32`, `uint64`, `uint80`, `uint128`, `uint256`, `int256`. Each refuses values the type cannot hold, fractions, and a stored scale such as `1.0`.
- Write every integer wider than 32 bits as a decimal string. JSON numbers cannot carry them and `JSON.stringify` throws on a bigint.
- Read every `uint64`, `uint80`, `uint128`, `uint256` and `int256` column with a `::text` cast in the select, then parse with `BigInt`. PostgREST returns numeric columns as JSON numbers, and JavaScript rounds any integer above 2^53. Token amounts, multipliers, quotes and feed round ids go past it. The key keeps the column name:

  ```ts
  supabase.from('lots').select('lot_id::text, account, ticker_id, status, tokens_bought::text, tokens_remaining::text, last_receipt_id::text')
  ```

- Enums are written and read by name.
- Leave `indexed_at`, `created_at` and `updated_at` to the database. A replayed upsert that sends a new time trips the rule that keeps the row fixed.
- Chain times are unix seconds: `bigint` in `payments`, `bucket_waits` and `cards`, `uint256` in `receipts` as the struct has them. Times the database, the keeper or the app records (`indexed_at`, `created_at`, `updated_at`, `last_seen_at`, `last_used_at` and the `keeper_runs` times) are `timestamptz`.
- Block numbers are L2 block numbers, as logs and `ArbSys.arbBlockNumber()` give them.

## Errors

Every rule has a name. A refused write carries it as the error's constraint, and the message PostgREST returns starts with it or quotes it.

| Code | Meaning |
| --- | --- |
| 23514 | A check constraint, a domain, or a rule a trigger enforces. |
| 23503 | A foreign key: the row names something the index does not hold, or another account's. |
| 23505 | A unique key, such as a plain insert of a receipt already indexed. |
| 42501 | The role may not do this. |

## Tables

### chain_cursor

Per log stream, the last L2 block the keeper indexed in full, so a restart resumes at `last_block + 1`. `last_block_hash` lets the keeper tell a reorg below the cursor. Stream names are lowercase snake case (`chain_cursor_stream_format`), for example `sleeve_module` and `usdg_transfers`. `updated_at` is stamped on every move.

Order matters across streams, because payments name accounts and receipts. Index module logs up to a block before USDG transfers up to the same block.

### accounts

One row per account that ever installed the module.

| Event | Write |
| --- | --- |
| `Installed(account, keeper, spend)` | Upsert: `installed_at_block` and `installed_at_log_index` from the log, `uninstalled_at_block` null, `keeper`, and the empty rule, since `onInstall` deletes the rule. |
| `RuleSet(account, version, rule)` | `rule` to the event's rule (the insert into `rule_versions` is below). |
| `RulePaused`, `RuleResumed` | `rule.status` to `PAUSED` or `ACTIVE`. |
| `KeeperSet(account, keeper)` | `keeper`. The zero address means none. |
| `Uninstalled(account, released)` | `uninstalled_at_block`, `keeper` to the zero address, `rule` to the empty rule. |

`rule` is `ruleOf(account)` with `packages/core` `Rule` keys, and `minClip` as a decimal string. The empty rule is the column default, `{"version": 0, "status": "NONE", "equityBps": 0, "tickerId": 0, "premiumCapBps": 0, "slippageBps": 0, "minClip": "0"}`. `accounts_rule_shape` refuses any other shape. USDG that arrived at or before the `Installed` log is in the install snapshot and is never a payment (I5). `last_seen_block` and `last_seen_at` record the keeper's last read of the account's state.

Rules: `accounts_identity_fixed` (the address and `created_at` never change), `accounts_uninstall_after_install`.

### rule_versions

The terms of every rule version, one row per `RuleSet` log. A receipt's rule is `(account, rule_version)`, and versions go up by one per account across reinstalls (D-019).

Rules: `rule_versions_in_sequence` (a version that skips one means a `RuleSet` log was missed), `rule_versions_append_only`.

### receipts

One row per `ReceiptWritten` log, with every field of SPEC 13's `Receipt` as a typed column, plus the stored hash, the raw log data and where the log sits. Anyone may read it.

Columns are the struct's fields in snake case, in SPEC order, except three that would clash with SQL: `id` is `receipt_id`, `updatedAt` (the stock feed round's) is `round_updated_at`, and `timestamp` is `block_timestamp`. `keeper/test/schema/fixtures.ts` spells the map out as `RECEIPT_COLUMNS`. After them come:

| Column | Value |
| --- | --- |
| `receipt_hash` | `receiptHash(id)` as the module stores it. It equals `keccak256(event_data)`. Read it from the module and check the two agree before writing. |
| `event_data` | The log's data field, `abi.encode(receipt)`: 39 words, 2,498 characters with the `0x`. |
| `tx_hash`, `block_number`, `log_index` | Derived from the log. Label them derived wherever they are shown (PRD 10). |

`receipts_extend_the_log` checks every new receipt:

- `receipts_in_sequence`: its id is the next one. Ids are global and start at 1 (D-009 Q25), so the index holds every receipt from 1 with no gaps, and a missed log fails the next insert. The keeper indexes from the deploy block, `DEPLOYMENT_4663.firstBlock`.
- `receipts_in_log_order`: its log comes after the previous receipt's.
- `receipts_rule_known`: its `rule_version` is 0 (no rule) or a version `rule_versions` holds for the account.
- `receipts_match_event_data`: its typed columns encode to exactly its `event_data`, with enums as their contract position. A decoding slip or a swapped column fails here.

A receipt already indexed skips these checks and goes on to the primary key and `receipts_append_only`. Write receipts as an upsert that merges duplicates, never one that ignores them, and leave `indexed_at` to its default. Replaying a block range is then a no-op, and a different row under an indexed id fails loudly. Insert in id order. A batch in one statement is fine. The same goes for `rule_versions` and `reconciliations`.

Indexes: by account and id (history, newest first), by account and `block_timestamp` (weeks and time ranges), by lot (a lot's history), and by `(tx_hash, log_index)`.

Reading by status follows SPEC 13. A split writes FILLED, QUEUED, REFUSED_TICKER or REFUSED_ACCOUNT with `usdg_in` above zero. A settle's refusals carry no USDG in. QUEUED with `usdg_queued` 0 sorted everything to spend. `usdg_spent` means investment only on FILLED and SETTLED.

### reconciliations

One row per `Reconciled` log: how a ledger RECONCILED receipt cut the ledgers. `balance` is what the ledgers were brought down to, `from_spend` the cut off spend, `from_buckets` the cut off each bucket indexed by ticker id. The receipt's `usdg_in` is the shortfall. Read `from_buckets::text[]`.

Rules: the foreign key to `receipts`, `reconciliations_append_only`.

### lots

Kept by the receipts trigger, never written directly. Inserting a receipt does what the module did in the same transaction:

- FILLED or SETTLED makes the lot under the receipt's id, holding `tokens_out`.
- PART_SOLD or SOLD takes `tokens_in` off the lot it names and sets the status. SOLD exactly when the last token goes.
- RECONCILED from `reconcileLots` names a lot and takes `tokens_in` off it, with the status unchanged.
- Every other receipt names no lot.

A receipt that breaks this is refused with its lot change: `lots_buy_takes_receipt_id`, `lots_changed_by_lot_receipts`, `lots_known`, `lots_same_account_and_ticker`, `lots_take_what_they_hold` and `lots_sold_when_empty`. Any other write to a lot, even by the table owner, must follow SPEC 14 (`lots_move_forward`): one change per receipt, in receipt order, tokens that only go down, and FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD, with SOLD final.

A lot's `tokens_remaining` can reach 0 without SOLD after a lot reconcile, so readers key on `tokens_remaining`, not on status (SPEC 14). `last_receipt_id` is the latest receipt that changed the lot. Anyone may read it.

### payments

The inbox (PRD 7.2, PRD 9): one row per inbound USDG `Transfer` log the module will treat as income. That means a transfer to an installed account, after its `Installed` log, and outside its bracketed owner ops and module actions. USDG that moves inside a bracket is the owner's own money (`OwnerOpEnded` reports it), and so are sale proceeds, so neither gets a row.

Write a payment once with its log's columns. Its key is the log, so an upsert that ignores duplicates is the right replay here. Then move its status with updates.

| Status | Meaning | Columns |
| --- | --- | --- |
| `RECEIVED` | Not sorted, and no observation covers it. The default. | |
| `WAITING_GRACE` | An `Observed` log covers it, so anyone may split it once the grace ends. | `grace_ends_at` = `observedAt + 3,600` (SPEC 8) |
| `SORTED` | A split sorted it. Final. | `sorted_by_receipt_id`, the split's receipt |

A split sorts every payment of the account that arrived before it and is not yet sorted. The lot it made, if any, is that receipt's `lot_id`.

Rules: `payments_chain_id_robinhood` (4663 only, the default), `payments_amount_range`, `payments_not_to_self`, the foreign key to `accounts`, `payments_waiting_has_grace`, `payments_sorted_has_receipt`, `payments_sorted_by_receipt_fkey` (the account's own receipt), `payments_sorted_by_a_split` (FILLED, QUEUED or a refusal with USDG in), `payments_sorted_after_arrival`, `payments_sorted_is_final` and `payments_identity_fixed` (only the status columns change).

Indexes: by account, newest first (the inbox), the account's unsorted payments oldest first (the keeper's 24-hour override of the gas ceiling, D-009 Q35), and by sorting receipt (a receipt's inbound transfers).

### keeper_runs

One row per keeper action, inserted when it starts and finished once. `outcome` is SUCCEEDED only when the postcondition was read back from chain state. `error` holds the decoded revert or the RPC error of a REVERTED or FAILED run. `detail` holds structured extras such as the base fee against the ceiling, a simulation's reason, receipt ids, gas used and block ranges.

Rules: `keeper_runs_outcome_when_finished`, `keeper_runs_error_when_failed`, `keeper_runs_revert_has_tx`, `keeper_runs_index_sends_nothing`, `keeper_runs_finish_after_start`, `keeper_runs_detail_object`, `keeper_runs_identity_fixed` (what the run is never changes) and `keeper_runs_finish_once`. The service role may delete old runs.

### bucket_waits

Per non-empty bucket, the reason the keeper's settle simulations keep returning and since when (SPEC 10). After five days on one reason the app asks the owner to raise the cap, switch ticker or release (PRD 7.4). `bucket_since` is the bucket's `since`, and a different value is a new bucket. Reset `first_seen_at` when the reason or the bucket changes, and delete the row when the bucket empties.

Rules: `bucket_waits_reason_set` (never NONE), `bucket_waits_seen_in_order`, the foreign key to `accounts`.

### passkey_credentials

Sleeve's own WebAuthn records (D-003, D-014, docs/research/zerodev-passkey.md option B). A synced passkey hands back its credential id at sign-in and never its public key, so a new device looks up the key and the account here.

| Column | Value |
| --- | --- |
| `credential_id` | The credential's `rawId`, base64url without padding, 16 to 1,023 bytes. |
| `public_key` | P-256, SEC1 uncompressed: `0x04`, then x and y as 32 bytes each, the passkey validator's `pubKeyX` and `pubKeyY`. The last 65 bytes of `getPublicKey()`'s SPKI are this key. |
| `rp_id` | The relying party id: the production domain, or `localhost` while developing. |
| `account_address` | The Kernel account the passkey owns. Written at registration, before the account deploys, so there is no foreign key to `accounts`. |
| `counter` | The last signature counter seen. Synced passkeys report 0. It means something only when a server route verifies assertions and writes it back. |

Rules: the formats above, `passkey_credentials_public_key_key` (one credential per key), `passkey_credentials_counter_rises` and `passkey_credentials_identity_fixed` (only `counter` and `last_used_at` change).

### cards

Shared payday and week cards (PRD 7.10). The opaque id is the only key and encodes neither the receipt nor the account. A card has one subject: a receipt card names one of the account's own FILLED or SETTLED receipts, and a week card names its Monday 00:00 in New York as unix seconds. `options` holds `showAmounts` and `showProof`, both false unless the owner turned them on. Other keys are free for the look.

Rules: `cards_card_id_format` (12 to 64 base64url characters, never `sample`, which names the app's sample route), `cards_one_subject`, `cards_receipt_of_account_fkey`, `cards_receipt_is_a_buy`, `cards_week_starts_monday` (Monday 00:00 in New York, whatever the clocks did), `cards_options_shape` and `cards_identity_fixed` (only `options` change).

### waitlist

People who asked to hear from Sleeve (D-038), written by the app's `/api/waitlist` route with the service role.

| Column | Meaning |
| --- | --- |
| `email` | The key, lowercased and trimmed, 6 to 254 characters, so joining twice changes nothing. |
| `paid_with` | The optional answer to how the person is paid today: `stablecoins`, `bank`, `both`, or `payer` for someone who pays others. |
| `country` | The country Cloudflare resolved from the request, ISO 3166 alpha-2, or null when unknown. |
| `source` | Where the form was opened from, for example `footer`; `site` when it does not say. |
| `created_at` | When the person joined. |

Rules: `waitlist_email_format`, `waitlist_paid_with_value`, `waitlist_country_format`, `waitlist_source_format`. The route inserts with `on_conflict=email` and ignores a duplicate, so it answers the same whether the email was new.

## Limits

- One module instance. Receipt and lot ids restart at 1 in a new module, so indexing a second module needs a migration that adds the module address to their keys.
- Some income never meets a split: the owner spends unsorted USDG before a split runs, or uninstalls first, and a reinstall puts it in the snapshot. PRD 9's inbound states have no name for that, so such a payment stays RECEIVED or WAITING_GRACE.
- The notification bell's read state (D-029) is not in this schema yet.
- `rule_versions` and `reconciliations` are public chain data, but only `receipts` and `lots` are open to `anon`. The public receipt page reads a receipt's rule terms and reconcile detail through a server route.
