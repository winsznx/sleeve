-- Sleeve schema for Robinhood Chain, chain id 4663.
--
-- Three kinds of data live here:
--   1. An index of the one SleeveModule instance in packages/core DEPLOYMENT_4663, rebuilt by the keeper from chain
--      logs: accounts, rule_versions, receipts, reconciliations, lots and payments. The chain is the authority
--      (PRD 13). When the index and the chain disagree the chain wins, and the verifier never reads from here.
--   2. The keeper's own bookkeeping: chain_cursor, keeper_runs and bucket_waits.
--   3. Offchain records the app writes through its server routes: passkey_credentials and cards.
--
-- Access (PRD 10 and 14): anon and authenticated may read receipts and lots, which are public chain data, and
-- nothing else, and they may write nothing. The keeper and the app's server routes use the service role for every
-- write and every other read. Row level security is on for every table and the table privileges say the same, so
-- each layer holds on its own.
--
-- Every rule below has a name. A refused write fails with that name as the constraint in the Postgres error, and
-- the message PostgREST returns starts with it or quotes it. supabase/README.md is the table contract.

-- ---------------------------------------------------------------------------------------------------------------
-- Chain value types
-- ---------------------------------------------------------------------------------------------------------------
-- A column typed as its Solidity type refuses a value the contract cannot produce, so a decoding slip fails at the
-- insert instead of landing in the index. The numeric domains also refuse fractions and a stored scale such as
-- '1.0', so every value prints back as the integer the chain holds.

create domain public.evm_address as text
  constraint evm_address_format check (value ~ '^0x[0-9a-f]{40}$');
comment on domain public.evm_address is
  '20-byte address as lowercase 0x hex. Lowercase a checksummed address before writing or filtering.';

create domain public.bytes32 as text
  constraint bytes32_format check (value ~ '^0x[0-9a-f]{64}$');
comment on domain public.bytes32 is '32 bytes as lowercase 0x hex: hashes, uid(), the disclosure hash.';

create domain public.hex_data as text
  constraint hex_data_format check (value ~ '^0x([0-9a-f]{2})*$');
comment on domain public.hex_data is 'Raw bytes as lowercase 0x hex.';

create domain public.uint8 as smallint
  constraint uint8_range check (value between 0 and 255);

create domain public.uint16 as integer
  constraint uint16_range check (value between 0 and 65535);

create domain public.uint32 as bigint
  constraint uint32_range check (value between 0 and 4294967295);

create domain public.uint64 as numeric
  constraint uint64_range check (scale(value) = 0 and value between 0 and 18446744073709551615);

create domain public.uint80 as numeric
  constraint uint80_range check (scale(value) = 0 and value between 0 and 1208925819614629174706175);

create domain public.uint128 as numeric
  constraint uint128_range check (
    scale(value) = 0 and value between 0 and 340282366920938463463374607431768211455
  );

create domain public.uint256 as numeric
  constraint uint256_range check (
    scale(value) = 0
    and value between 0 and 115792089237316195423570985008687907853269984665640564039457584007913129639935
  );

create domain public.int256 as numeric
  constraint int256_range check (
    scale(value) = 0
    and value between -57896044618658097711785492504343953926634992332820282019728792003956564819968
                  and 57896044618658097711785492504343953926634992332820282019728792003956564819967
  );

-- ---------------------------------------------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------------------------------------------
-- The four receipt enums keep the contract's member order (contracts/src/types/SleeveTypes.sol, packages/core
-- spec.ts), so a label's position is the uint8 a receipt carries, and private.abi_enum encodes it from that.

create type public.receipt_status as enum (
  'FILLED', 'QUEUED', 'SETTLED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT', 'RELEASED', 'PART_SOLD', 'SOLD', 'RECONCILED'
);
create type public.receipt_reason as enum (
  'NONE', 'PAUSED', 'ORACLE_PAUSED', 'SESSION', 'MULTIPLIER', 'STALE', 'DEPEG', 'CLIP', 'PREMIUM'
);
create type public.receipt_trigger as enum ('KEEPER', 'OWNER', 'PAYLINK', 'PUBLIC');
create type public.accounting_mode as enum ('WRAPPED');

-- packages/core LOT_STATUSES. The chain's lot(id) reports these as members of Status, so map them by name, never by
-- position.
create type public.lot_status as enum ('FILLED', 'SETTLED', 'PART_SOLD', 'SOLD');

-- PRD 9, the inbox's offchain view of an inbound transfer.
create type public.payment_status as enum ('RECEIVED', 'WAITING_GRACE', 'SORTED');

create type public.keeper_action as enum ('INDEX', 'OBSERVE', 'SPLIT', 'SETTLE');
create type public.keeper_outcome as enum ('SUCCEEDED', 'SKIPPED', 'REVERTED', 'FAILED');

-- ---------------------------------------------------------------------------------------------------------------
-- Functions behind the checks and triggers. They live outside the exposed schemas: the API cannot call them, and
-- anon and authenticated have no usage on the schema. Functions that read a table are created after it.
-- ---------------------------------------------------------------------------------------------------------------

create schema if not exists private;
comment on schema private is 'Check, encoding and trigger functions for the Sleeve tables. Not exposed through the API.';

create function private.is_json_uint(value jsonb, max_value numeric) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(value) = 'number' and (value #>> '{}') ~ '^(0|[1-9][0-9]*)$'
      then (value #>> '{}')::numeric <= max_value
    else false
  end;
$$;

-- The shape of SleeveModule.ruleOf(account), with packages/core Rule's keys: numbers for the uint8 to uint32
-- fields, a decimal string for the uint128 minClip, the RuleStatus name for status.
create function private.is_rule(rule jsonb) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(rule) <> 'object' then false
    when (select count(*) from jsonb_object_keys(rule)) <> 7 then false
    when not (rule ?& array['version', 'status', 'equityBps', 'tickerId', 'premiumCapBps', 'slippageBps', 'minClip'])
      then false
    when jsonb_typeof(rule -> 'minClip') <> 'string' or (rule ->> 'minClip') !~ '^(0|[1-9][0-9]{0,38})$' then false
    when jsonb_typeof(rule -> 'status') <> 'string' then false
    else (rule ->> 'status') in ('NONE', 'ACTIVE', 'PAUSED')
      and private.is_json_uint(rule -> 'version', 4294967295)
      and private.is_json_uint(rule -> 'equityBps', 10000)
      and private.is_json_uint(rule -> 'tickerId', 255)
      and private.is_json_uint(rule -> 'premiumCapBps', 65535)
      and private.is_json_uint(rule -> 'slippageBps', 65535)
      and (rule ->> 'minClip')::numeric <= 340282366920938463463374607431768211455
  end;
$$;

-- abi.encode of one value as a 32-byte word, 64 lowercase hex characters. A negative value takes the two's
-- complement, as int256 does. The column domains bound every value first, so a value that does not fit is a bug.
create function private.abi_word(value numeric) returns text
language plpgsql immutable strict parallel safe
set search_path = ''
as $$
declare
  rest numeric := case
    when value < 0 then value + 115792089237316195423570985008687907853269984665640564039457584007913129639936
    else value
  end;
  word text := '';
begin
  for chunk in 1..8 loop
    word := lpad(to_hex(mod(rest, 4294967296)::bigint), 8, '0') || word;
    rest := div(rest, 4294967296);
  end loop;
  if rest <> 0 or scale(value) <> 0 then
    raise exception using
      errcode = 'numeric_value_out_of_range',
      message = format('abi_word: %s is not a 256-bit integer', value);
  end if;
  return word;
end;
$$;

create function private.abi_address(value text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select lpad(substr(value, 3), 64, '0');
$$;

create function private.abi_bytes32(value text) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select substr(value, 3);
$$;

create function private.abi_bool(value boolean) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select lpad(value::integer::text, 64, '0');
$$;

-- A contract enum is its member's position, which the receipt enums above keep.
create function private.abi_enum(value anyenum) returns text
language sql immutable strict parallel safe
set search_path = ''
as $$
  select private.abi_word((array_position(enum_range(value), value) - 1)::numeric);
$$;

create function private.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Refuses an update that changes any column not named in the trigger's arguments. The trigger's name is the rule's
-- name. An update that changes nothing passes, so replaying an upsert of the same row is harmless.
create function private.keep_columns() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  free_columns text[] := coalesce(tg_argv, '{}'::text[]);
begin
  if (to_jsonb(new) - free_columns) is distinct from (to_jsonb(old) - free_columns) then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = case
        when cardinality(free_columns) = 0 then format('%s: rows of %s never change once written', tg_name, tg_table_name)
        else format('%s: only %s may change on %s', tg_name, array_to_string(free_columns, ', '), tg_table_name)
      end;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The keeper's log cursor
-- ---------------------------------------------------------------------------------------------------------------

create table public.chain_cursor (
  stream text primary key
    constraint chain_cursor_stream_format check (stream ~ '^[a-z][a-z0-9_]{0,62}$'),
  last_block bigint not null
    constraint chain_cursor_last_block_range check (last_block >= 0),
  last_block_hash public.bytes32,
  updated_at timestamptz not null default now()
);
comment on table public.chain_cursor is
  'Per log stream, the last L2 block the keeper indexed in full. It restarts from last_block + 1.';
comment on column public.chain_cursor.last_block_hash is
  'Hash of last_block when it was indexed, so a restart can tell a reorg below the cursor.';

create trigger chain_cursor_touch_updated_at
  before update on public.chain_cursor
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts and rule versions
-- ---------------------------------------------------------------------------------------------------------------

create table public.accounts (
  address public.evm_address primary key,
  installed_at_block bigint not null
    constraint accounts_installed_at_block_range check (installed_at_block >= 0),
  installed_at_log_index integer not null
    constraint accounts_installed_at_log_index_range check (installed_at_log_index >= 0),
  uninstalled_at_block bigint,
  keeper public.evm_address not null,
  rule jsonb not null default
    '{"version": 0, "status": "NONE", "equityBps": 0, "tickerId": 0, "premiumCapBps": 0, "slippageBps": 0, "minClip": "0"}'
    constraint accounts_rule_shape check (private.is_rule(rule)),
  last_seen_block bigint
    constraint accounts_last_seen_block_range check (last_seen_block >= 0),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_uninstall_after_install check (uninstalled_at_block >= installed_at_block)
);
comment on table public.accounts is
  'Every account that installed the module, from Installed, Uninstalled, KeeperSet, RuleSet, RulePaused and RuleResumed.';
comment on column public.accounts.installed_at_block is
  'L2 block of the latest Installed event. A reinstall moves it and clears uninstalled_at_block.';
comment on column public.accounts.installed_at_log_index is
  'Log index of that Installed event. USDG that arrived at or before it is in the install snapshot and never splits (I5).';
comment on column public.accounts.uninstalled_at_block is 'L2 block of the Uninstalled event that followed the latest install, else null.';
comment on column public.accounts.keeper is 'keeperOf(account): the account''s keeper, the zero address for none (B2-7) and after uninstall.';
comment on column public.accounts.rule is
  'ruleOf(account) with packages/core Rule keys; minClip is a decimal string. Status NONE after an install without a rule and after uninstall.';
comment on column public.accounts.last_seen_block is 'The last L2 block at which the keeper read this account''s state.';
comment on column public.accounts.last_seen_at is 'When the keeper last read this account''s state.';

create index accounts_installed_idx on public.accounts (address) where uninstalled_at_block is null;

create trigger accounts_identity_fixed
  before update on public.accounts
  for each row execute function private.keep_columns(
    'installed_at_block', 'installed_at_log_index', 'uninstalled_at_block', 'keeper', 'rule',
    'last_seen_block', 'last_seen_at', 'updated_at'
  );
create trigger accounts_touch_updated_at
  before update on public.accounts
  for each row execute function private.touch_updated_at();

create table public.rule_versions (
  account public.evm_address not null references public.accounts (address),
  version public.uint32 not null
    constraint rule_versions_version_range check (version >= 1),
  equity_bps public.uint16 not null
    constraint rule_versions_equity_bps_range check (equity_bps <= 10000),
  ticker_id public.uint8 not null,
  premium_cap_bps public.uint16 not null,
  slippage_bps public.uint16 not null,
  min_clip public.uint128 not null,
  tx_hash public.bytes32 not null,
  block_number bigint not null
    constraint rule_versions_block_number_range check (block_number >= 0),
  log_index integer not null
    constraint rule_versions_log_index_range check (log_index >= 0),
  primary key (account, version),
  constraint rule_versions_log_key unique (tx_hash, log_index)
);
comment on table public.rule_versions is
  'The terms of every rule version, from RuleSet. A receipt''s rule is (account, rule_version); versions go up by one per account, across reinstalls (D-019).';
comment on column public.rule_versions.min_clip is 'USDG base units, 6 decimals.';

-- setRule writes the account's next version, so a version that skips one means a RuleSet log was missed.
create function private.rule_version_is_next() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  latest bigint;
begin
  if exists (select 1 from public.rule_versions where account = new.account and version = new.version) then
    return new;
  end if;
  select max(version) into latest from public.rule_versions where account = new.account;
  if new.version <> coalesce(latest, 0) + 1 then
    raise exception using
      errcode = 'check_violation',
      constraint = 'rule_versions_in_sequence',
      message = format('rule_versions_in_sequence: account %s holds versions up to %s, so the next RuleSet is %s, not %s',
                       new.account, coalesce(latest, 0), coalesce(latest, 0) + 1, new.version);
  end if;
  return new;
end;
$$;

create trigger rule_versions_in_sequence
  before insert on public.rule_versions
  for each row execute function private.rule_version_is_next();
create trigger rule_versions_append_only
  before update on public.rule_versions
  for each row execute function private.keep_columns();

-- ---------------------------------------------------------------------------------------------------------------
-- Receipts (SPEC 13). Every field of the Receipt struct is a typed column, in SPEC order, named in snake_case.
-- Three names differ to stay clear of SQL meanings: id is receipt_id, updatedAt (the feed round's) is
-- round_updated_at, timestamp is block_timestamp. The typed columns must encode to event_data exactly.
-- ---------------------------------------------------------------------------------------------------------------

create table public.receipts (
  receipt_id public.uint256 primary key
    constraint receipts_receipt_id_range check (receipt_id >= 1),
  account public.evm_address not null references public.accounts (address),
  rule_version public.uint32 not null,
  trigger public.receipt_trigger not null,
  payer public.evm_address not null,
  status public.receipt_status not null,
  reason public.receipt_reason not null,
  mode public.accounting_mode not null,
  ticker_id public.uint8 not null,
  token public.evm_address not null,
  token_uid public.bytes32 not null,
  usdg_in public.uint256 not null,
  usdg_to_spend public.uint256 not null,
  usdg_to_equity public.uint256 not null,
  usdg_spent public.uint256 not null,
  usdg_queued public.uint256 not null,
  tokens_in public.uint256 not null,
  tokens_out public.uint256 not null,
  usdg_out public.uint256 not null,
  ui_multiplier public.uint256 not null,
  exec_price public.uint256 not null,
  premium_bps public.int256 not null,
  round_id public.uint80 not null,
  answer public.int256 not null,
  round_updated_at public.uint256 not null,
  usdg_round_id public.uint80 not null,
  usdg_answer public.int256 not null,
  quote public.uint256 not null,
  min_out public.uint256 not null,
  venue_id public.uint8 not null,
  pool public.evm_address not null,
  calendar_version public.uint32 not null,
  disclosure_hash public.bytes32 not null,
  l2_block public.uint256 not null,
  block_timestamp public.uint256 not null,
  lot_id public.uint256 not null,
  queued_since public.uint64 not null,
  override_closed boolean not null,
  override_cap_bps public.uint16 not null,
  receipt_hash public.bytes32 not null,
  event_data public.hex_data not null
    constraint receipts_event_data_length check (length(event_data) = 2498),
  tx_hash public.bytes32 not null,
  block_number bigint not null
    constraint receipts_block_number_range check (block_number >= 0),
  log_index integer not null
    constraint receipts_log_index_range check (log_index >= 0),
  indexed_at timestamptz not null default now(),
  constraint receipts_log_key unique (tx_hash, log_index),
  constraint receipts_id_account_key unique (receipt_id, account)
);
comment on table public.receipts is
  'ReceiptWritten events, one row per receipt, every id from 1 with no gaps. Public chain data: anon may read it. Append-only (I7).';
comment on column public.receipts.receipt_id is 'Receipt.id: global, sequential from 1 (D-009 Q25).';
comment on column public.receipts.round_updated_at is 'Receipt.updatedAt: the stock feed round''s updatedAt, unix seconds.';
comment on column public.receipts.block_timestamp is 'Receipt.timestamp: block.timestamp when the receipt was written, unix seconds.';
comment on column public.receipts.l2_block is 'Receipt.l2Block: ArbSys.arbBlockNumber(), the L2 block.';
comment on column public.receipts.lot_id is 'Receipt.lotId: the lot this receipt made or changed, 0 for none.';
comment on column public.receipts.usdg_in is 'USDG base units, 6 decimals, like every usdg_ column. tokens_ columns are 18-decimal Stock Token base units.';
comment on column public.receipts.exec_price is 'USDG base units per 1e18 Stock Token base units.';
comment on column public.receipts.premium_bps is 'Signed basis points, measured in USDG at par (D-026). On PART_SOLD and SOLD it is the discount below the feed.';
comment on column public.receipts.receipt_hash is 'receiptHash(id) as the module stores it: keccak256(abi.encode(receipt)), which is keccak256(event_data).';
comment on column public.receipts.event_data is 'The ReceiptWritten log''s data field: abi.encode(receipt), 39 words. Columns below it are derived from the log and labeled derived wherever shown (PRD 10).';
comment on column public.receipts.tx_hash is 'Derived from the log: the transaction that wrote the receipt.';
comment on column public.receipts.block_number is 'Derived from the log: its L2 block number.';
comment on column public.receipts.log_index is 'Derived from the log: its index in the block.';

create index receipts_account_id_idx on public.receipts (account, receipt_id desc);
create index receipts_account_time_idx on public.receipts (account, block_timestamp desc);
create index receipts_lot_idx on public.receipts (lot_id, receipt_id) where lot_id <> 0;

-- abi.encode(receipt) from the typed columns, in SPEC 13 order: the ReceiptWritten log's data field.
create function private.receipt_event_data(receipt public.receipts) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select '0x'
    || private.abi_word(receipt.receipt_id)
    || private.abi_address(receipt.account)
    || private.abi_word(receipt.rule_version)
    || private.abi_enum(receipt.trigger)
    || private.abi_address(receipt.payer)
    || private.abi_enum(receipt.status)
    || private.abi_enum(receipt.reason)
    || private.abi_enum(receipt.mode)
    || private.abi_word(receipt.ticker_id)
    || private.abi_address(receipt.token)
    || private.abi_bytes32(receipt.token_uid)
    || private.abi_word(receipt.usdg_in)
    || private.abi_word(receipt.usdg_to_spend)
    || private.abi_word(receipt.usdg_to_equity)
    || private.abi_word(receipt.usdg_spent)
    || private.abi_word(receipt.usdg_queued)
    || private.abi_word(receipt.tokens_in)
    || private.abi_word(receipt.tokens_out)
    || private.abi_word(receipt.usdg_out)
    || private.abi_word(receipt.ui_multiplier)
    || private.abi_word(receipt.exec_price)
    || private.abi_word(receipt.premium_bps)
    || private.abi_word(receipt.round_id)
    || private.abi_word(receipt.answer)
    || private.abi_word(receipt.round_updated_at)
    || private.abi_word(receipt.usdg_round_id)
    || private.abi_word(receipt.usdg_answer)
    || private.abi_word(receipt.quote)
    || private.abi_word(receipt.min_out)
    || private.abi_word(receipt.venue_id)
    || private.abi_address(receipt.pool)
    || private.abi_word(receipt.calendar_version)
    || private.abi_bytes32(receipt.disclosure_hash)
    || private.abi_word(receipt.l2_block)
    || private.abi_word(receipt.block_timestamp)
    || private.abi_word(receipt.lot_id)
    || private.abi_word(receipt.queued_since)
    || private.abi_bool(receipt.override_closed)
    || private.abi_word(receipt.override_cap_bps);
$$;

-- A new receipt extends the log: the next id after the last one indexed, from a later log, under a rule version the
-- index holds (or 0 for none), with typed columns that are exactly its event data. A receipt already indexed goes
-- on to the primary key and receipts_append_only, so replaying an indexed range changes nothing.
create function private.receipt_extends_the_log() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  previous record;
begin
  if exists (select 1 from public.receipts where receipt_id = new.receipt_id) then
    return new;
  end if;
  select receipt_id, block_number, log_index into previous
    from public.receipts order by receipt_id desc limit 1;
  if new.receipt_id <> coalesce(previous.receipt_id, 0) + 1 then
    raise exception using
      errcode = 'check_violation',
      constraint = 'receipts_in_sequence',
      message = format('receipts_in_sequence: the index holds receipts up to %s, so the next is %s, not %s',
                       coalesce(previous.receipt_id, 0), coalesce(previous.receipt_id, 0) + 1, new.receipt_id);
  end if;
  if previous.receipt_id is not null
     and (new.block_number, new.log_index) <= (previous.block_number, previous.log_index) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'receipts_in_log_order',
      message = format('receipts_in_log_order: receipt %s at block %s log %s comes before receipt %s at block %s log %s',
                       new.receipt_id, new.block_number, new.log_index,
                       previous.receipt_id, previous.block_number, previous.log_index);
  end if;
  if new.rule_version <> 0
     and not exists (select 1 from public.rule_versions where account = new.account and version = new.rule_version) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'receipts_rule_known',
      message = format('receipts_rule_known: receipt %s names rule version %s of %s, which rule_versions does not hold',
                       new.receipt_id, new.rule_version, new.account);
  end if;
  if new.event_data is distinct from private.receipt_event_data(new) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'receipts_match_event_data',
      message = format('receipts_match_event_data: the typed columns of receipt %s do not encode to its event_data',
                       new.receipt_id);
  end if;
  return new;
end;
$$;

create trigger receipts_extend_the_log
  before insert on public.receipts
  for each row execute function private.receipt_extends_the_log();
create trigger receipts_append_only
  before update on public.receipts
  for each row execute function private.keep_columns();

-- The Reconciled event that comes with a RECONCILED receipt from a ledger reconcile (split, endOwnerOp or sell).
create table public.reconciliations (
  receipt_id public.uint256 primary key references public.receipts (receipt_id),
  balance public.uint256 not null,
  from_spend public.uint256 not null,
  from_buckets public.uint256[] not null,
  tx_hash public.bytes32 not null,
  block_number bigint not null
    constraint reconciliations_block_number_range check (block_number >= 0),
  log_index integer not null
    constraint reconciliations_log_index_range check (log_index >= 0),
  constraint reconciliations_log_key unique (tx_hash, log_index)
);
comment on table public.reconciliations is
  'Reconciled events: how a RECONCILED receipt cut the ledgers. The receipt''s usdg_in is the shortfall.';
comment on column public.reconciliations.from_buckets is 'USDG base units taken off each bucket, indexed by ticker id.';

create trigger reconciliations_append_only
  before update on public.reconciliations
  for each row execute function private.keep_columns();

-- ---------------------------------------------------------------------------------------------------------------
-- Lots (SPEC 14). Derived from receipts by the trigger below, never written directly: a FILLED or SETTLED receipt
-- makes the lot, and a PART_SOLD, SOLD or lot RECONCILED receipt takes its tokens_in off it.
-- ---------------------------------------------------------------------------------------------------------------

create table public.lots (
  lot_id public.uint256 primary key,
  account public.evm_address not null,
  ticker_id public.uint8 not null,
  status public.lot_status not null,
  tokens_bought public.uint128 not null
    constraint lots_tokens_bought_range check (tokens_bought > 0),
  tokens_remaining public.uint128 not null,
  last_receipt_id public.uint256 not null references public.receipts (receipt_id),
  updated_at timestamptz not null default now(),
  constraint lots_remaining_within_bought check (tokens_remaining <= tokens_bought),
  constraint lots_sold_is_empty check (status <> 'SOLD' or tokens_remaining = 0),
  constraint lots_last_receipt_after_lot check (last_receipt_id >= lot_id),
  constraint lots_buy_receipt_fkey foreign key (lot_id, account) references public.receipts (receipt_id, account)
);
comment on table public.lots is
  'lot(id) per lot, kept by the receipts trigger. Public chain data: anon may read it. The lot id is the FILLED or SETTLED receipt id.';
comment on column public.lots.tokens_remaining is
  'Stock Token base units. reconcileLots can bring it to 0 without SOLD, so readers key on it, not on status (SPEC 14).';
comment on column public.lots.last_receipt_id is
  'The latest receipt that changed this lot: its buy, a PART_SOLD or SOLD, or a RECONCILED from reconcileLots.';

create index lots_account_ticker_idx on public.lots (account, ticker_id, lot_id);

-- SPEC 14's transitions, kept on any write to a lot: one change per receipt, in receipt order, tokens that only go
-- down, and FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD with SOLD final.
create function private.lot_moves_forward() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.last_receipt_id < old.last_receipt_id
     or (new.last_receipt_id = old.last_receipt_id
         and (new.status, new.tokens_remaining) is distinct from (old.status, old.tokens_remaining)) then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = format('%s: lot %s was last changed by receipt %s, so receipt %s cannot change it',
                       tg_name, old.lot_id, old.last_receipt_id, new.last_receipt_id);
  end if;
  if new.tokens_remaining > old.tokens_remaining then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = format('%s: tokens remaining on lot %s only go down, not from %s to %s',
                       tg_name, old.lot_id, old.tokens_remaining, new.tokens_remaining);
  end if;
  if new.status is distinct from old.status
     and not (old.status in ('FILLED', 'SETTLED', 'PART_SOLD') and new.status in ('PART_SOLD', 'SOLD')) then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = format('%s: lot %s cannot move from %s to %s', tg_name, old.lot_id, old.status, new.status);
  end if;
  return new;
end;
$$;

create trigger lots_identity_fixed
  before update on public.lots
  for each row execute function private.keep_columns('status', 'tokens_remaining', 'last_receipt_id', 'updated_at');
create trigger lots_move_forward
  before update on public.lots
  for each row execute function private.lot_moves_forward();
create trigger lots_touch_updated_at
  before update on public.lots
  for each row execute function private.touch_updated_at();

-- Applies a new receipt to its lot, as the module did in the same transaction (SleeveState.createLot,
-- SleeveSell). It runs as the table owner because the service role cannot write lots.
create function private.receipt_moves_its_lot() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lot public.lots;
  remaining numeric;
begin
  if new.status in ('FILLED', 'SETTLED') then
    if new.lot_id <> new.receipt_id then
      raise exception using
        errcode = 'check_violation',
        constraint = 'lots_buy_takes_receipt_id',
        message = format('lots_buy_takes_receipt_id: %s receipt %s names lot %s instead of its own id',
                         new.status, new.receipt_id, new.lot_id);
    end if;
    insert into public.lots (lot_id, account, ticker_id, status, tokens_bought, tokens_remaining, last_receipt_id)
    values (new.receipt_id, new.account, new.ticker_id, new.status::text::public.lot_status,
            new.tokens_out, new.tokens_out, new.receipt_id);
    return null;
  end if;

  if new.lot_id = 0 then
    return null;
  end if;
  if new.status not in ('PART_SOLD', 'SOLD', 'RECONCILED') then
    raise exception using
      errcode = 'check_violation',
      constraint = 'lots_changed_by_lot_receipts',
      message = format('lots_changed_by_lot_receipts: a %s receipt names no lot, but receipt %s names lot %s',
                       new.status, new.receipt_id, new.lot_id);
  end if;

  select * into lot from public.lots where lot_id = new.lot_id for update;
  if not found then
    raise exception using
      errcode = 'check_violation',
      constraint = 'lots_known',
      message = format('lots_known: receipt %s changes lot %s, which the index does not hold', new.receipt_id, new.lot_id);
  end if;
  if (lot.account, lot.ticker_id) is distinct from (new.account, new.ticker_id) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'lots_same_account_and_ticker',
      message = format('lots_same_account_and_ticker: receipt %s is for %s ticker %s, lot %s belongs to %s ticker %s',
                       new.receipt_id, new.account, new.ticker_id, lot.lot_id, lot.account, lot.ticker_id);
  end if;
  if new.tokens_in = 0 or new.tokens_in > lot.tokens_remaining then
    raise exception using
      errcode = 'check_violation',
      constraint = 'lots_take_what_they_hold',
      message = format('lots_take_what_they_hold: receipt %s takes %s tokens off lot %s, which holds %s',
                       new.receipt_id, new.tokens_in, lot.lot_id, lot.tokens_remaining);
  end if;
  remaining := lot.tokens_remaining - new.tokens_in;
  if new.status <> 'RECONCILED' and (remaining = 0) <> (new.status = 'SOLD') then
    raise exception using
      errcode = 'check_violation',
      constraint = 'lots_sold_when_empty',
      message = format('lots_sold_when_empty: receipt %s is %s but leaves %s tokens on lot %s',
                       new.receipt_id, new.status, remaining, lot.lot_id);
  end if;

  update public.lots
     set status = case when new.status = 'RECONCILED' then lot.status else new.status::text::public.lot_status end,
         tokens_remaining = remaining,
         last_receipt_id = new.receipt_id
   where lot_id = lot.lot_id;
  return null;
end;
$$;

create trigger receipts_move_their_lot
  after insert on public.receipts
  for each row execute function private.receipt_moves_its_lot();

-- ---------------------------------------------------------------------------------------------------------------
-- Payments: the inbox (PRD 7.2 and 9)
-- ---------------------------------------------------------------------------------------------------------------

create table public.payments (
  chain_id integer not null default 4663
    constraint payments_chain_id_robinhood check (chain_id = 4663),
  tx_hash public.bytes32 not null,
  log_index integer not null
    constraint payments_log_index_range check (log_index >= 0),
  block_number bigint not null
    constraint payments_block_number_range check (block_number >= 0),
  block_timestamp bigint not null
    constraint payments_block_timestamp_range check (block_timestamp >= 0),
  from_address public.evm_address not null,
  to_address public.evm_address not null references public.accounts (address),
  amount public.uint256 not null
    constraint payments_amount_range check (amount > 0),
  status public.payment_status not null default 'RECEIVED',
  grace_ends_at bigint
    constraint payments_grace_ends_at_range check (grace_ends_at >= 0),
  sorted_by_receipt_id public.uint256,
  indexed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index),
  constraint payments_not_to_self check (from_address <> to_address),
  constraint payments_sorted_has_receipt check ((status = 'SORTED') = (sorted_by_receipt_id is not null)),
  constraint payments_waiting_has_grace check ((status = 'WAITING_GRACE') = (grace_ends_at is not null)),
  constraint payments_sorted_by_receipt_fkey foreign key (sorted_by_receipt_id, to_address)
    references public.receipts (receipt_id, account)
);
comment on table public.payments is
  'Inbound USDG Transfer logs the module treats as income (PRD 7.2): to an installed account, after its install snapshot, outside its bracketed owner ops and module actions.';
comment on column public.payments.chain_id is 'Robinhood Chain. M0 indexes no other chain, and another needs a migration that also types its amount.';
comment on column public.payments.amount is 'USDG base units, 6 decimals.';
comment on column public.payments.block_timestamp is 'The block''s timestamp, unix seconds.';
comment on column public.payments.grace_ends_at is
  'WAITING_GRACE only: observedAt + 3,600, unix seconds, when anyone may split it (SPEC 8).';
comment on column public.payments.sorted_by_receipt_id is
  'SORTED only: the account''s split receipt that sorted it. Derived from logs (PRD 10).';

create index payments_account_time_idx on public.payments (to_address, block_number desc, log_index desc);
create index payments_waiting_idx on public.payments (to_address, block_number, log_index) where status <> 'SORTED';
create index payments_sorted_by_idx on public.payments (sorted_by_receipt_id) where sorted_by_receipt_id is not null;

-- SORTED is final, and the receipt that sorted a payment is one of the account's splits, written after the payment
-- arrived. A split receipt is FILLED, QUEUED or a refusal with USDG in, and settle's refusals carry none. The
-- foreign key reports a receipt that is missing or another account's.
create function private.payment_follows_its_split() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  split record;
begin
  if tg_op = 'UPDATE' and old.status = 'SORTED'
     and (new.status, new.sorted_by_receipt_id) is distinct from (old.status, old.sorted_by_receipt_id) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'payments_sorted_is_final',
      message = format('payments_sorted_is_final: payment %s:%s was sorted by receipt %s and stays that way',
                       old.tx_hash, old.log_index, old.sorted_by_receipt_id);
  end if;
  if new.sorted_by_receipt_id is null then
    return new;
  end if;
  select status, usdg_in, block_number, log_index into split
    from public.receipts where receipt_id = new.sorted_by_receipt_id and account = new.to_address;
  if not found then
    return new;
  end if;
  if split.status not in ('FILLED', 'QUEUED', 'REFUSED_TICKER', 'REFUSED_ACCOUNT') or split.usdg_in = 0 then
    raise exception using
      errcode = 'check_violation',
      constraint = 'payments_sorted_by_a_split',
      message = format('payments_sorted_by_a_split: receipt %s is %s with %s USDG in, not a split',
                       new.sorted_by_receipt_id, split.status, split.usdg_in);
  end if;
  if (split.block_number, split.log_index) <= (new.block_number, new.log_index) then
    raise exception using
      errcode = 'check_violation',
      constraint = 'payments_sorted_after_arrival',
      message = format('payments_sorted_after_arrival: receipt %s at block %s log %s came before payment %s:%s at block %s log %s',
                       new.sorted_by_receipt_id, split.block_number, split.log_index,
                       new.tx_hash, new.log_index, new.block_number, new.log_index);
  end if;
  return new;
end;
$$;

create trigger payments_follow_their_split
  before insert or update on public.payments
  for each row execute function private.payment_follows_its_split();
create trigger payments_identity_fixed
  before update on public.payments
  for each row execute function private.keep_columns('status', 'grace_ends_at', 'sorted_by_receipt_id', 'updated_at');
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- The keeper's runs and the waits behind PRD 7.4's five-day prompt
-- ---------------------------------------------------------------------------------------------------------------

create table public.keeper_runs (
  run_id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  action public.keeper_action not null,
  account public.evm_address,
  ticker_id public.uint8,
  tx_hash public.bytes32,
  outcome public.keeper_outcome,
  error text,
  detail jsonb not null default '{}'::jsonb
    constraint keeper_runs_detail_object check (jsonb_typeof(detail) = 'object'),
  constraint keeper_runs_finish_after_start check (finished_at >= started_at),
  constraint keeper_runs_outcome_when_finished check ((finished_at is null) = (outcome is null)),
  constraint keeper_runs_error_when_failed check ((error is not null) = coalesce(outcome in ('REVERTED', 'FAILED'), false)),
  constraint keeper_runs_revert_has_tx check (outcome is distinct from 'REVERTED' or tx_hash is not null),
  constraint keeper_runs_index_sends_nothing check (action <> 'INDEX' or tx_hash is null)
);
comment on table public.keeper_runs is
  'One row per keeper action: inserted when it starts, finished once. SUCCEEDED means the postcondition was read back from chain state.';
comment on column public.keeper_runs.error is 'Why a REVERTED or FAILED run did not succeed: the decoded revert or the RPC error. Null otherwise.';
comment on column public.keeper_runs.detail is
  'Structured extras: base fee against the ceiling, the simulation''s reason, receipt ids, gas used, block range.';

create index keeper_runs_started_idx on public.keeper_runs (started_at desc);
create index keeper_runs_account_idx on public.keeper_runs (account, started_at desc) where account is not null;

-- A run changes only while it is open: what it did is set once, when it finishes.
create function private.keeper_run_finishes_once() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.finished_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = format('%s: run %s finished at %s and never changes', tg_name, old.run_id, old.finished_at);
  end if;
  return new;
end;
$$;

create trigger keeper_runs_finish_once
  before update on public.keeper_runs
  for each row execute function private.keeper_run_finishes_once();
create trigger keeper_runs_identity_fixed
  before update on public.keeper_runs
  for each row execute function private.keep_columns('finished_at', 'tx_hash', 'outcome', 'error', 'detail');

create table public.bucket_waits (
  account public.evm_address not null references public.accounts (address),
  ticker_id public.uint8 not null,
  reason public.receipt_reason not null
    constraint bucket_waits_reason_set check (reason <> 'NONE'),
  bucket_since public.uint64 not null,
  first_seen_at bigint not null
    constraint bucket_waits_first_seen_at_range check (first_seen_at >= 0),
  last_seen_at bigint not null,
  primary key (account, ticker_id),
  constraint bucket_waits_seen_in_order check (last_seen_at >= first_seen_at)
);
comment on table public.bucket_waits is
  'Per non-empty bucket, the reason the keeper''s settle simulations keep returning and since when (SPEC 10). After five days on one reason the app asks the owner to raise the cap, switch ticker or release (PRD 7.4).';
comment on column public.bucket_waits.bucket_since is 'bucketOf(account, tickerId).since, unix seconds. A different since is a new bucket.';
comment on column public.bucket_waits.first_seen_at is 'Chain time, unix seconds, of the first simulation that returned this reason. Reset when the reason or the bucket changes.';
comment on column public.bucket_waits.last_seen_at is 'Chain time, unix seconds, of the latest simulation that returned it.';

-- ---------------------------------------------------------------------------------------------------------------
-- Offchain records: passkey credentials and saved cards
-- ---------------------------------------------------------------------------------------------------------------

create table public.passkey_credentials (
  credential_id text primary key
    constraint passkey_credentials_credential_id_format check (
      credential_id ~ '^[A-Za-z0-9_-]+$' and length(credential_id) between 22 and 1364
    ),
  public_key text not null
    constraint passkey_credentials_public_key_format check (public_key ~ '^0x04[0-9a-f]{128}$'),
  rp_id text not null
    constraint passkey_credentials_rp_id_format check (
      rp_id ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$' and length(rp_id) <= 253
    ),
  account_address public.evm_address not null,
  counter bigint not null default 0
    constraint passkey_credentials_counter_range check (counter between 0 and 4294967295),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  constraint passkey_credentials_public_key_key unique (public_key)
);
comment on table public.passkey_credentials is
  'Sleeve''s own WebAuthn records (D-003, D-014): a synced passkey gives back its credential id, never its public key, so sign-in on a new device looks the key and the account up here.';
comment on column public.passkey_credentials.credential_id is 'The credential''s rawId, base64url without padding: 16 to 1,023 bytes.';
comment on column public.passkey_credentials.public_key is
  'P-256 public key, SEC1 uncompressed: 0x04, then x and y as 32 bytes each. x and y are the passkey validator''s pubKeyX and pubKeyY.';
comment on column public.passkey_credentials.rp_id is 'The relying party id the credential is bound to: Sleeve''s domain, or localhost while developing.';
comment on column public.passkey_credentials.account_address is
  'The Kernel account the passkey owns. Written at registration, before the account deploys, so there is no foreign key to accounts.';
comment on column public.passkey_credentials.counter is 'The WebAuthn signature counter last seen. Synced passkeys report 0.';

create index passkey_credentials_account_idx on public.passkey_credentials (account_address);

create function private.passkey_counter_only_rises() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.counter < old.counter then
    raise exception using
      errcode = 'check_violation',
      constraint = tg_name,
      message = format('%s: the signature counter of a credential only rises, not from %s to %s',
                       tg_name, old.counter, new.counter);
  end if;
  return new;
end;
$$;

create trigger passkey_credentials_identity_fixed
  before update on public.passkey_credentials
  for each row execute function private.keep_columns('counter', 'last_used_at');
create trigger passkey_credentials_counter_rises
  before update on public.passkey_credentials
  for each row execute function private.passkey_counter_only_rises();

create table public.cards (
  card_id text primary key
    constraint cards_card_id_format check (card_id ~ '^[A-Za-z0-9_-]{12,64}$' and card_id <> 'sample'),
  account public.evm_address not null references public.accounts (address),
  receipt_id public.uint256,
  week_start bigint
    constraint cards_week_start_range check (week_start >= 0),
  options jsonb not null default '{"showAmounts": false, "showProof": false}'::jsonb
    constraint cards_options_shape check (
      jsonb_typeof(options) = 'object'
      and coalesce(jsonb_typeof(options -> 'showAmounts') = 'boolean', false)
      and coalesce(jsonb_typeof(options -> 'showProof') = 'boolean', false)
    ),
  created_at timestamptz not null default now(),
  constraint cards_one_subject check ((receipt_id is null) <> (week_start is null)),
  constraint cards_receipt_of_account_fkey foreign key (receipt_id, account)
    references public.receipts (receipt_id, account)
);
comment on table public.cards is
  'Shared payday and week cards (PRD 7.10). The opaque id is the only key: it never encodes the receipt or the account.';
comment on column public.cards.receipt_id is 'A receipt card''s FILLED or SETTLED receipt, which must be the account''s own. Null for a week card.';
comment on column public.cards.week_start is 'A week card''s Monday 00:00 New York time, unix seconds. Null for a receipt card.';
comment on column public.cards.options is
  'showAmounts and showProof, both false unless the owner turned them on (PRD 7.10). Other keys are free for the look.';

create index cards_account_idx on public.cards (account, created_at desc);
create index cards_receipt_idx on public.cards (receipt_id) where receipt_id is not null;

-- A card shows one of the account's own buys, or one New York week. The foreign key reports a receipt that is
-- missing or another account's.
create function private.card_shows_a_buy_or_a_week() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  receipt_status public.receipt_status;
  local_start timestamp;
begin
  if new.receipt_id is not null then
    select status into receipt_status from public.receipts where receipt_id = new.receipt_id and account = new.account;
    if found and receipt_status not in ('FILLED', 'SETTLED') then
      raise exception using
        errcode = 'check_violation',
        constraint = 'cards_receipt_is_a_buy',
        message = format('cards_receipt_is_a_buy: receipt %s is %s; a card shows a FILLED or SETTLED buy',
                         new.receipt_id, receipt_status);
    end if;
  end if;
  if new.week_start is not null then
    local_start := to_timestamp(new.week_start) at time zone 'America/New_York';
    if extract(isodow from local_start) <> 1 or local_start::time <> time '00:00' then
      raise exception using
        errcode = 'check_violation',
        constraint = 'cards_week_starts_monday',
        message = format('cards_week_starts_monday: %s is %s in New York, not a Monday at 00:00',
                         new.week_start, local_start);
    end if;
  end if;
  return new;
end;
$$;

create trigger cards_show_a_buy_or_a_week
  before insert on public.cards
  for each row execute function private.card_shows_a_buy_or_a_week();
create trigger cards_identity_fixed
  before update on public.cards
  for each row execute function private.keep_columns('options');

-- ---------------------------------------------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------------------------------------------
-- Row level security is on everywhere. Only receipts and lots carry a policy: a read for anon and authenticated.
-- A table without a policy gives those roles nothing. The service role bypasses row level security (Supabase
-- creates it with BYPASSRLS), so the grants below are its only limit.

alter table public.chain_cursor enable row level security;
alter table public.accounts enable row level security;
alter table public.rule_versions enable row level security;
alter table public.receipts enable row level security;
alter table public.reconciliations enable row level security;
alter table public.lots enable row level security;
alter table public.payments enable row level security;
alter table public.keeper_runs enable row level security;
alter table public.bucket_waits enable row level security;
alter table public.passkey_credentials enable row level security;
alter table public.cards enable row level security;

create policy receipts_public_read on public.receipts for select to anon, authenticated using (true);
create policy lots_public_read on public.lots for select to anon, authenticated using (true);

-- Supabase's default privileges hand every new table in public to anon, authenticated and service_role. Take them
-- back and grant only what each role uses, so a wrong policy alone or a wrong grant alone cannot open a table.
revoke all on table
  public.chain_cursor, public.accounts, public.rule_versions, public.receipts, public.reconciliations, public.lots,
  public.payments, public.keeper_runs, public.bucket_waits, public.passkey_credentials, public.cards
  from anon, authenticated, service_role;
revoke all on sequence public.keeper_runs_run_id_seq from anon, authenticated, service_role;

grant select on table public.receipts, public.lots to anon, authenticated;

-- Chain history only grows. The service role never deletes it, receipts, rule versions and reconciliations never
-- change once written (update is there so an upsert can replay a row, and *_append_only refuses any change), and
-- lots move only with the receipts that move them.
grant select, insert, update on table
  public.chain_cursor, public.accounts, public.rule_versions, public.receipts, public.reconciliations, public.payments
  to service_role;
grant select on table public.lots to service_role;
grant select, insert, update, delete on table
  public.keeper_runs, public.bucket_waits, public.passkey_credentials, public.cards
  to service_role;
grant usage, select on sequence public.keeper_runs_run_id_seq to service_role;

-- The service role runs these inside its own writes: checks and triggers call them, and some look others up by name.
-- A function a later migration adds here is the service role's too, or a new check would refuse every keeper write.
revoke all on all functions in schema private from public;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;
alter default privileges in schema private grant execute on functions to service_role;

-- Later migrations start from nothing for anon and authenticated: a new table, sequence or function in public gets
-- no privileges for them until its migration grants some on purpose. Postgres lets every role execute a new function
-- unless the default is changed, so that default goes too, for every function this role creates.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;
