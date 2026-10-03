-- Local development data for Sleeve's schema. `supabase db reset` runs it after the migrations on a local
-- database, and nothing applies it to the hosted project. keeper/test/schema/seed.test.ts loads it into PGlite and
-- checks it.
--
-- Two fictional accounts on a fictional timeline after the mainnet deploy (block 79,338,287 at 19:37:55 UTC on
-- 3 October 2026, about ten blocks a second). The token, uid, pool and disclosure hash values are the real ones
-- from packages/core, and the keeper is the deployed default keeper (docs/DEPLOYMENTS.md). Everything else is made
-- up: the 0xada0, 0xb0b0 and 0xc11e addresses, prices, feed rounds, transaction and block hashes.
--
-- Ada: 10 percent to SPY, the product default (PRD 7.3), passkey on localhost.
--   Fri 9 Oct    500 USDG arrives. The keeper splits it: 450 to spend, 50 buys SPY (receipt 1, lot 1).
--   Sat 10 Oct   300 USDG arrives. The market is closed, so 30 waits as USDG (receipt 2, QUEUED SESSION).
--   Sun 11 Oct   20:02 New York, two minutes after the reopen, the keeper settles the 30 (receipt 3, lot 3).
--   Tue 13 Oct   Ada sells half of lot 1 (receipt 4, PART_SOLD).
--   Mon 19 Oct   200 USDG arrives while the base fee is above the keeper's ceiling. Someone observes it, so it is
--                WAITING_GRACE. Then 75 USDG arrives after the observation, so it is RECEIVED.
-- Bo: 50 percent to QQQ with a 1 USDG clip (D-014's campaign accounts), signs with a wallet, so no passkey row.
--   Wed 14 Oct   100 USDG arrives. QQQ fills 138 bps above the feed, over the 100 bps cap, so 50 waits
--                (receipt 5, QUEUED PREMIUM). The keeper's settle simulations keep returning PREMIUM.
--   Fri 16 Oct   An old approval pulled 60 USDG. Bo tops up 20 USDG in a bracketed owner op, and endOwnerOp first
--                reconciles the 60: 50 off spend, 10 off the QQQ bucket (receipt 6, RECONCILED).

-- ---------------------------------------------------------------------------------------------------------------
-- Accounts and rule versions
-- ---------------------------------------------------------------------------------------------------------------

insert into public.accounts (address, installed_at_block, installed_at_log_index, keeper, rule, last_seen_block, last_seen_at)
values
  ('0xada0000000000000000000000000000000000001', 79387537, 3, '0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46',
   '{"version": 1, "status": "ACTIVE", "equityBps": 1000, "tickerId": 0, "premiumCapBps": 100, "slippageBps": 50, "minClip": "25000000"}',
   93127537, '2026-10-19 18:40:02+00'),
  ('0xb0b0000000000000000000000000000000000002', 79864537, 2, '0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46',
   '{"version": 1, "status": "ACTIVE", "equityBps": 5000, "tickerId": 1, "premiumCapBps": 100, "slippageBps": 50, "minClip": "1000000"}',
   93115537, '2026-10-19 18:30:00+00');

insert into public.rule_versions
  (account, version, equity_bps, ticker_id, premium_cap_bps, slippage_bps, min_clip, tx_hash, block_number, log_index)
values
  ('0xada0000000000000000000000000000000000001', 1, 1000, 0, 100, 50, 25000000,
   '0x21118b72a08257959ad3145e1a49676360305770e853bbf4d2b11ca364f8295b', 79387537, 4),
  ('0xb0b0000000000000000000000000000000000002', 1, 5000, 1, 100, 50, 1000000,
   '0xf5fe7c25fd6f697ba0d0aab71b6f86695a83c36cc31614a57582d0dde1fc5f8f', 79864537, 3);

-- ---------------------------------------------------------------------------------------------------------------
-- Receipts, in id order. Each object lists what that receipt fills (SPEC 13, "What each receipt fills"), and
-- every other field is zero. event_data is abi.encode(receipt), computed by the encoder the insert check uses, and
-- receipt_hash is keccak256(event_data), which seed.test.ts recomputes. Prices follow packages/core premium.ts:
-- exec_price and premium_bps of a buy are execPriceBuy and premiumBps of usdg_spent and tokens_out against the
-- answer, a sale's are execPriceSell and discountBps, and min_out is minOutForBuy or minOutForSell at 50 bps.
-- Inserting the FILLED and SETTLED receipts makes lots 1 and 3, and receipt 4 takes half of lot 1.
-- ---------------------------------------------------------------------------------------------------------------

do $$
declare
  every_field_zero constant jsonb := '{
    "rule_version": 0, "payer": "0x0000000000000000000000000000000000000000", "reason": "NONE", "mode": "WRAPPED",
    "ticker_id": 0, "token": "0x0000000000000000000000000000000000000000",
    "token_uid": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "usdg_in": 0, "usdg_to_spend": 0, "usdg_to_equity": 0, "usdg_spent": 0, "usdg_queued": 0,
    "tokens_in": 0, "tokens_out": 0, "usdg_out": 0, "ui_multiplier": 0, "exec_price": 0, "premium_bps": 0,
    "round_id": 0, "answer": 0, "round_updated_at": 0, "usdg_round_id": 0, "usdg_answer": 0,
    "quote": 0, "min_out": 0, "venue_id": 0, "pool": "0x0000000000000000000000000000000000000000",
    "calendar_version": 65536,
    "disclosure_hash": "0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89",
    "lot_id": 0, "queued_since": 0, "override_closed": false, "override_cap_bps": 0
  }';
  item jsonb;
  receipt public.receipts;
begin
  for item in
    select value from jsonb_array_elements($receipts$[
      {"receipt_id": "1", "account": "0xada0000000000000000000000000000000000001", "rule_version": 1, "trigger": "KEEPER", "status": "FILLED",
       "token": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", "token_uid": "0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1",
       "usdg_in": "500000000", "usdg_to_spend": "450000000", "usdg_to_equity": "50000000", "usdg_spent": "50000000",
       "tokens_out": "74391022480000000", "ui_multiplier": "1000566000000000000", "exec_price": "672124114", "premium_bps": "14",
       "round_id": "18446744073709551768", "answer": "67125000000", "round_updated_at": "1791552600",
       "usdg_round_id": "18446744073709551647", "usdg_answer": "100010000",
       "quote": "1487900000000000", "min_out": "74023025000000000", "venue_id": 1, "pool": "0xa7bb1ac63bbab0c44316e6c8c455213441689167",
       "l2_block": "84319597", "block_timestamp": "1791554406", "lot_id": "1",
       "receipt_hash": "0x23dac18089804d763f743c04fb56b1eeac07b4c7566000a2056039020a325865",
       "tx_hash": "0xda93de35d9d9caaf6d4b5de75ee60fe9f7feb11ccb3899c7b2434d3e81fb3b1a", "block_number": 84319597, "log_index": 14},

      {"receipt_id": "2", "account": "0xada0000000000000000000000000000000000001", "rule_version": 1, "trigger": "KEEPER", "status": "QUEUED", "reason": "SESSION",
       "token": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c",
       "usdg_in": "300000000", "usdg_to_spend": "270000000", "usdg_to_equity": "30000000", "usdg_queued": "30000000",
       "l2_block": "85237587", "block_timestamp": "1791646205",
       "receipt_hash": "0x8ce476079776cb7cb88e1cfcd01e4a857f8e10114136f8fb7f87bf51e6e011af",
       "tx_hash": "0x73aa770023758d67f3ffbf26d705df8363d07c64f76429312cc8704ce31bd3a5", "block_number": 85237587, "log_index": 9},

      {"receipt_id": "3", "account": "0xada0000000000000000000000000000000000001", "rule_version": 1, "trigger": "KEEPER", "status": "SETTLED", "reason": "SESSION",
       "token": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", "token_uid": "0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1",
       "usdg_to_equity": "30000000", "usdg_spent": "30000000",
       "tokens_out": "44590120000000000", "ui_multiplier": "1000566000000000000", "exec_price": "672794781", "premium_bps": "6",
       "round_id": "18446744073709551769", "answer": "67240000000", "round_updated_at": "1791763265",
       "usdg_round_id": "18446744073709551648", "usdg_answer": "99990000",
       "quote": "1486500000000000", "min_out": "44372025000000000", "venue_id": 1, "pool": "0xa7bb1ac63bbab0c44316e6c8c455213441689167",
       "l2_block": "86408837", "block_timestamp": "1791763330", "lot_id": "3", "queued_since": "1791646205",
       "receipt_hash": "0x27b16e66161d19b526bbbc7d61cef7a60e7f9ed0a6159f7a607e1721fd887e50",
       "tx_hash": "0x02fa91d9fe71d50d299786bbf89edc7ab34082c978566be3d6137e8b5ce3a1ec", "block_number": 86408837, "log_index": 21},

      {"receipt_id": "4", "account": "0xada0000000000000000000000000000000000001", "rule_version": 1, "trigger": "OWNER", "status": "PART_SOLD",
       "token": "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", "token_uid": "0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1",
       "usdg_to_spend": "25040120", "tokens_in": "37195511240000000", "usdg_out": "25040120",
       "ui_multiplier": "1000566000000000000", "exec_price": "673202737", "premium_bps": "14",
       "round_id": "18446744073709551776", "answer": "67410000000", "round_updated_at": "1791903600",
       "usdg_round_id": "18446744073709551651", "usdg_answer": "100000000",
       "quote": "673650000", "min_out": "24931472", "venue_id": 1, "pool": "0xa7bb1ac63bbab0c44316e6c8c455213441689167",
       "l2_block": "87817537", "block_timestamp": "1791904200", "lot_id": "1",
       "receipt_hash": "0x8ec2bd0cf83a97ee22ee1e77fa862100e0660d03efc017323d939916e6d71abf",
       "tx_hash": "0x1ce4319d41f2a3de0b6d1dc81418ab8b438a795be02091ac96c2895c6a24a626", "block_number": 87817537, "log_index": 17},

      {"receipt_id": "5", "account": "0xb0b0000000000000000000000000000000000002", "rule_version": 1, "trigger": "KEEPER", "status": "QUEUED", "reason": "PREMIUM",
       "ticker_id": 1, "token": "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68",
       "usdg_in": "100000000", "usdg_to_spend": "50000000", "usdg_to_equity": "50000000", "usdg_queued": "50000000",
       "premium_bps": "138",
       "round_id": "18446744073709551704", "answer": "60230000000", "round_updated_at": "1791981900",
       "usdg_round_id": "18446744073709551652", "usdg_answer": "100020000",
       "quote": "1647000000000000", "min_out": "81938250000000000", "venue_id": 1, "pool": "0xd60a5d14db690b7afad71f76b108071d7175597d",
       "l2_block": "88603587", "block_timestamp": "1791982805",
       "receipt_hash": "0xe3b89511f7368627e98f390bde0fb63fdda993b162971708ab5f0784f8599366",
       "tx_hash": "0x208c722f7a4dbd4f5add9ca264544261eef2fe330eec44a805fe9de7ab3a678b", "block_number": 88603587, "log_index": 11},

      {"receipt_id": "6", "account": "0xb0b0000000000000000000000000000000000002", "rule_version": 1, "trigger": "OWNER", "status": "RECONCILED",
       "usdg_in": "60000000", "usdg_spent": "50000000", "usdg_queued": "10000000",
       "l2_block": "90205537", "block_timestamp": "1792143000",
       "receipt_hash": "0x2dbfd472e84c4da1f85a02b796402ea5bdf428e4f1168f189f356fb25f573d59",
       "tx_hash": "0x5c776a928421ed6f34aa50262042925a93430bf734e3f0562ead64feb611cb21", "block_number": 90205537, "log_index": 25}
    ]$receipts$::jsonb) with ordinality as list (value, position)
    order by position
  loop
    receipt := jsonb_populate_record(null::public.receipts, every_field_zero || item);
    receipt.event_data := private.receipt_event_data(receipt);
    receipt.indexed_at := now();
    insert into public.receipts select receipt.*;
  end loop;
end;
$$;

-- The Reconciled event that follows receipt 6 in its transaction: ledgers brought down to a 40 USDG balance.
insert into public.reconciliations (receipt_id, balance, from_spend, from_buckets, tx_hash, block_number, log_index)
values (6, 40000000, 50000000, '{0,10000000,0,0}',
        '0x5c776a928421ed6f34aa50262042925a93430bf734e3f0562ead64feb611cb21', 90205537, 26);

-- ---------------------------------------------------------------------------------------------------------------
-- Payments: the inbox
-- ---------------------------------------------------------------------------------------------------------------

insert into public.payments
  (tx_hash, log_index, block_number, block_timestamp, from_address, to_address, amount, status, grace_ends_at, sorted_by_receipt_id)
values
  ('0x51e9281ecc3f8496589c8348e2809b771ce895306c28c9db18d585398bb2c41f', 2, 84319537, 1791554400,
   '0xc11e000000000000000000000000000000000003', '0xada0000000000000000000000000000000000001', 500000000, 'SORTED', null, 1),
  ('0x709e6874e378a42f33bfcc394bed5bb53421265f04a564ce4f3b4e1287ac2cd6', 2, 85237537, 1791646200,
   '0xc11e000000000000000000000000000000000003', '0xada0000000000000000000000000000000000001', 300000000, 'SORTED', null, 2),
  ('0xfde05e9b4945b4f660561baf711f5c2312bda4e0d91470d8f7e66ce44f954291', 5, 88603537, 1791982800,
   '0xc11e000000000000000000000000000000000005', '0xb0b0000000000000000000000000000000000002', 100000000, 'SORTED', null, 5),
  -- Observed at 18:20 UTC (observedAt 1,792,434,000), so anyone may split it from 19:20.
  ('0x5690c101a00763f84b71d686d3b8fb3eec8588b9bf20db05b99d78cab8a3fa80', 3, 93103537, 1792432800,
   '0xc11e000000000000000000000000000000000003', '0xada0000000000000000000000000000000000001', 200000000, 'WAITING_GRACE', 1792437600, null),
  -- 75 USDG is more than the observation's 1 USDG of headroom, so this one waits for an observation of its own.
  ('0x6b9c665f751c8cfc3ea2f3eeb1804e35909600353b8471f9c6647b48d84c1fa9', 1, 93127537, 1792435200,
   '0xc11e000000000000000000000000000000000005', '0xada0000000000000000000000000000000000001', 75000000, 'RECEIVED', null, null);

-- ---------------------------------------------------------------------------------------------------------------
-- The keeper's bookkeeping
-- ---------------------------------------------------------------------------------------------------------------

-- Bo's QQQ bucket has waited on PREMIUM for five days, so the app asks Bo to raise the cap, switch ticker or release.
insert into public.bucket_waits (account, ticker_id, reason, bucket_since, first_seen_at, last_seen_at)
values ('0xb0b0000000000000000000000000000000000002', 1, 'PREMIUM', 1791982805, 1791982870, 1792434600);

insert into public.keeper_runs (started_at, finished_at, action, account, ticker_id, tx_hash, outcome, error, detail)
values
  ('2026-10-09 14:00:04.8+00', '2026-10-09 14:00:05.1+00', 'INDEX', null, null, null, 'SUCCEEDED', null,
   '{"stream": "usdg_transfers", "fromBlock": 84319500, "toBlock": 84319550}'),
  ('2026-10-09 14:00:05.2+00', '2026-10-09 14:00:06.9+00', 'SPLIT', '0xada0000000000000000000000000000000000001', 0,
   '0xda93de35d9d9caaf6d4b5de75ee60fe9f7feb11ccb3899c7b2434d3e81fb3b1a', 'SUCCEEDED', null,
   '{"receiptIds": ["1"], "gasUsed": 543779, "baseFeeGwei": "0.0316"}'),
  ('2026-10-10 15:30:04.9+00', '2026-10-10 15:30:05.8+00', 'SPLIT', '0xada0000000000000000000000000000000000001', 0,
   '0x73aa770023758d67f3ffbf26d705df8363d07c64f76429312cc8704ce31bd3a5', 'SUCCEEDED', null,
   '{"receiptIds": ["2"], "gasUsed": 238510, "reason": "SESSION"}'),
  ('2026-10-10 15:31:00+00', '2026-10-10 15:31:00.3+00', 'SETTLE', '0xada0000000000000000000000000000000000001', 0,
   null, 'SKIPPED', null, '{"previewStatus": "QUEUED", "reason": "SESSION"}'),
  ('2026-10-12 00:02:08.7+00', '2026-10-12 00:02:10.9+00', 'SETTLE', '0xada0000000000000000000000000000000000001', 0,
   '0x02fa91d9fe71d50d299786bbf89edc7ab34082c978566be3d6137e8b5ce3a1ec', 'SUCCEEDED', null,
   '{"receiptIds": ["3"], "gasUsed": 522261, "roundUpdatedAt": 1791763265}'),
  ('2026-10-14 13:00:04.6+00', '2026-10-14 13:00:05.9+00', 'SPLIT', '0xb0b0000000000000000000000000000000000002', 1,
   '0x208c722f7a4dbd4f5add9ca264544261eef2fe330eec44a805fe9de7ab3a678b', 'SUCCEEDED', null,
   '{"receiptIds": ["5"], "reason": "PREMIUM", "premiumBps": "138"}'),
  ('2026-10-19 18:00:04.7+00', '2026-10-19 18:00:04.8+00', 'SPLIT', '0xada0000000000000000000000000000000000001', 0,
   null, 'SKIPPED', null, '{"baseFeeGwei": "0.142", "ceilingGwei": "0.1", "oldestUnsortedAt": 1792432800}'),
  ('2026-10-19 18:30:00+00', '2026-10-19 18:30:00.4+00', 'SETTLE', '0xb0b0000000000000000000000000000000000002', 1,
   null, 'SKIPPED', null, '{"reason": "PREMIUM", "simulation": "GuardNotClear(PREMIUM)"}'),
  ('2026-10-19 18:40:04.9+00', '2026-10-19 18:40:14.9+00', 'SPLIT', '0xada0000000000000000000000000000000000001', 0,
   null, 'FAILED', 'eth_estimateGas timed out after 10,000 ms on KEEPER_RPC', '{}');

insert into public.chain_cursor (stream, last_block, last_block_hash)
values
  ('sleeve_module', 93127600, '0x95d9e26c205933651ee11cebdd61026fb193783b5c62475f9629d9b29fa5d055'),
  ('usdg_transfers', 93127600, '0x95d9e26c205933651ee11cebdd61026fb193783b5c62475f9629d9b29fa5d055');

-- ---------------------------------------------------------------------------------------------------------------
-- The app's records
-- ---------------------------------------------------------------------------------------------------------------

-- A P-256 key derived from a fixed test secret. No real authenticator holds it.
insert into public.passkey_credentials (credential_id, public_key, rp_id, account_address, counter, created_at, last_used_at)
values ('RJuF0LtqLPKfyXI4LLn21Q',
        '0x04a9d584f685e42e973da7ae820b69ae5578ef4c3c94e920bb5f090f7f22e78c87ecbb782ac3b45d701e09d7d8a1059b30af3ac7ccad379812fb6b238e9cd32a3d',
        'localhost', '0xada0000000000000000000000000000000000001', 0, '2026-10-03 20:58:00+00', '2026-10-13 15:09:52+00');

-- A payday card for Ada's first buy with amounts hidden, and a week card for the week of Monday 5 October
-- (00:00 New York time is 04:00 UTC) with amounts shown.
insert into public.cards (card_id, account, receipt_id, week_start, options, created_at)
values
  ('Rc7pX2kR9vTa', '0xada0000000000000000000000000000000000001', 1, null,
   '{"showAmounts": false, "showProof": false}', '2026-10-09 14:05:00+00'),
  ('Wk4nB8sJ2cLd', '0xada0000000000000000000000000000000000001', null, 1791172800,
   '{"showAmounts": true, "showProof": false}', '2026-10-12 08:00:00+00');
