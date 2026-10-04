# Deployments

## Robinhood Chain mainnet, chain id 4663

Deployed 3 October 2026 between 20:37:55 and 20:38:04 Lagos time (blocks 79,338,287 to 79,338,373) by DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1, from commit ca795ff with a clean tree, following docs/DEPLOY_PLAN.md. Seven transactions, 18,410,544 gas, 0.000423594 ETH in total.

| Contract | Address | Transaction | Block | Gas | Source |
| --- | --- | --- | --- | --- | --- |
| SleeveBuy | `0xDF3e060D64086ec3309265Ce83B34813eE45F81A` | [0x9d78c42e](https://robinhoodchain.blockscout.com/tx/0x9d78c42e7429e3e4a3d136cf30361eca3790df98deb8848c82dab575c0c1ee62) | 79,338,287 | 1,375,058 | [exact match](https://repo.sourcify.dev/4663/0xDF3e060D64086ec3309265Ce83B34813eE45F81A) |
| SleeveTrade | `0x3757964A25C94040e81a215Dd85B748f6bB9ca84` | [0x4e1da474](https://robinhoodchain.blockscout.com/tx/0x4e1da474c95b5912eb207a15820b3913becf18c9deef2178cc5cf928d09fe767) | 79,338,303 | 4,285,597 | [exact match](https://repo.sourcify.dev/4663/0x3757964A25C94040e81a215Dd85B748f6bB9ca84) |
| SleeveSell | `0xC0003635086E51aC0c19c40c193043D58d86c987` | [0xd0f69cf5](https://robinhoodchain.blockscout.com/tx/0xd0f69cf54006d31db7eb75f22f43879a6bb2547102c2f401be28b68f7544c22e) | 79,338,318 | 3,910,250 | [exact match](https://repo.sourcify.dev/4663/0xC0003635086E51aC0c19c40c193043D58d86c987) |
| SleeveTimelock | `0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D` | [0x26c8388e](https://robinhoodchain.blockscout.com/tx/0x26c8388e857c546b323010c821324c20f5700316434eba96c6a3c0536d1e5693) | 79,338,331 | 1,673,590 | [exact match](https://repo.sourcify.dev/4663/0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D) |
| SessionCalendarExtension | `0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D` | [0x9edae299](https://robinhoodchain.blockscout.com/tx/0x9edae2995f7f560b8c8198ee311fe7a50cbe5d3ea2400415cc06065823772e8c) | 79,338,344 | 1,823,538 | [exact match](https://repo.sourcify.dev/4663/0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D) |
| TokenSource | `0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F` | [0x3207b109](https://robinhoodchain.blockscout.com/tx/0x3207b109626c24dda48236a51f0d94b22f7eab0e0751278f35594ccb8ea6ee83) | 79,338,357 | 1,616,061 | [exact match](https://repo.sourcify.dev/4663/0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F) |
| SleeveModule | `0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9` | [0x38523e10](https://robinhoodchain.blockscout.com/tx/0x38523e1061dd33658cab2bbf98a4a8514dcb30a17c33ced08fbaf49a9cc58107) | 79,338,373 | 3,726,450 | [exact match](https://repo.sourcify.dev/4663/0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9) |

The full record, with constructor arguments decoded and encoded, library links, block hashes and costs, is contracts/deployments/4663.json. forge's broadcast is contracts/broadcast/Deploy.s.sol/4663/run-latest.json.

## Checks after the deploy

- Read-back from chain state (contracts/script/ReadBack.s.sol) through the public RPC: every check passed. It compared the code at all seven addresses with this commit's build, every library link, the timelock's delay, roles and full event history, the calendar, every TokenSource ticker, feed, session type and pool, the pools left off the allowlist, and the module's immutables and guard limits. The dRPC free tier refused the read-back's event-history query (log ranges over 10,000 blocks), so the public RPC is the only provider it has passed on. No rerun on a second provider is recorded yet: the Alchemy app planned for it was replaced by QuickNode (D-032), whose keeper endpoint answers only the VPS.
- Verification inputs: contracts/script/verify.py compiled every input and matched the chain, 9 of 9 checks (contracts/deployments/4663.verify.json).
- Source verification: all seven contracts verified on Sourcify with exact_match for both runtime and creation code. Blockscout's explorer at robinhoodchain.blockscout.com reads Sourcify; direct Blockscout verification through its PRO API waits on a free API key.

## Configuration

- SleeveModule: USDG, TokenSource and the calendar above, SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2, the USDG/USD feed 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2, default keeper KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, disclosure hash 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89, guard limits 25 hours, 25 hours, 50 bps and 24 hours, grace 3,600 seconds.
- SleeveTimelock: 48-hour minimum delay, DEPLOYER as proposer, canceller and executor, no admin role holder. It administers TokenSource and SessionCalendarExtension only.
- TokenSource: SPY, QQQ, NVDA and AAPL, each ALL_DAY, with the D-010 pools (docs/DEPLOY_PLAN.md section 3).

## Web app, Cloudflare Workers

Live at https://trysleeve.xyz since about 02:22 Lagos time on 4 October 2026, as the Worker `sleeve` in the owner's Cloudflare account (D-033, D-034). www.trysleeve.xyz answers with a 308 redirect to the apex, keeping the path. sleeve.timjosh507.workers.dev serves the same worker for checks; ZeroDev and the QuickNode browser endpoint refuse its origin, so sign-up and chain reads work only on the production domain.

Deploy with `pnpm --filter @sleeve/app cf:deploy` (app/scripts/cloudflare.mjs). At the first deploy the worker was 18,966 KiB, 4,236 KiB gzipped, under the 10 MiB limit of the paid Workers plan.

Checks after the deploy, read from the live site:

- Every product page answers 200 and /dev/kit answers 404 (SLEEVE_ENV=production).
- /disclosure/rhj-disclosure.txt is 2,360 bytes with sha256 9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc, the pinned DISCLOSURE.sha256, and the landing page shows the issuer's text.
- /opengraph-image draws a 1200 by 630 PNG with the embedded fonts and token logos.
- /api/eligibility reads Cloudflare's cf-ipcountry (NG from the owner's network).
- /api/index reaches Supabase with the worker's SUPABASE_SERVICE_ROLE_KEY secret. Before the keeper ran it answered that the keeper had not indexed the module yet; since then it answers with the keeper's cursor (Keeper section).
- None of the four non-public values in .env.local appear in the six pages and 41 script chunks fetched from the live site. The ZeroDev 4663 URL and the browser QuickNode endpoint do, by design.

Redeployed at 13:56 Lagos on 4 October 2026 from 53de204, Worker version 29fe7723-4c2a-44b9-b50d-c0eabc87dc70, with the waitlist (D-038) and the focus fix for sheets and dialogs (D-039). Read from the live site in WebKit with an iPhone profile: a tap opens the phone menu with focus on the sheet and no ring, Enter opens it with the ring on its first link, and /waitlist answers 200. The waitlist saves sign-ups since its table was applied (Supabase section).

## Supabase

Project ookruryixsddishtpxoq. The owner applied supabase/migrations/20261003203436_sleeve.sql in the SQL editor on 4 October 2026, so the CLI's migration history does not list it; run `supabase migration repair --status applied 20261003203436 20261004120000` once before any `supabase db push`. Checked through PostgREST: all eleven tables exist for the service role, and the anon key reads receipts and lots and is refused (42501) on accounts, cards and passkey_credentials. The owner applied the waitlist migration, supabase/migrations/20261004120000_waitlist.sql, in the SQL editor by 14:09 Lagos on 4 October. Checked: the service role reads the table, and the anon key is refused on read and on insert (42501). A sign-up through https://trysleeve.xyz/api/waitlist answered 201 and stored its row with country NG, and a repeat answered the same 201 and left one row (the check row is launch-check@trysleeve.xyz with source launch-check).

## Chain endpoints and sponsorship

Set by the owner on 4 October 2026 and checked from outside the same day.

- Browser endpoint (QuickNode, NEXT_PUBLIC_ROBINHOOD_RPC_URL, D-035): referrer allowlist trysleeve.xyz, a list of 14 methods without eth_getLogs or eth_sendRawTransaction, and 20 requests a second and 20,000 a day per IP address. A request with Origin or Referer https://trysleeve.xyz is answered; one with no origin, another site, www.trysleeve.xyz or localhost gets 401, and eth_getLogs, eth_sendRawTransaction and debug calls get 401 "rejected due to request filter settings". Ten live pages loaded in Chrome sent 36 requests to it, all answered 200.
- Keeper endpoint (a second QuickNode endpoint, KEEPER_RPC): source IP allowlist 187.77.178.30 only. A request from the build machine gets 401.
- API routes read through the public RPC (readServerChainConfig, D-035).
- ZeroDev, Robinhood 4663: a chain policy sponsors up to 0.00075 ETH a day, up to 0.0002 ETH a UserOp, 50 requests a day, below a 0.5 gwei gas price, with "Sponsor all transactions" off. A prepare-only probe, built like the app's zeroDevRoute, got a throwaway Kernel account's first UserOp sponsored under that policy with nothing sent. ZeroDev sponsors on 4663 through its relayer: the sponsored op carries a zero gas price and no paymaster.

## Keeper, Hostinger VPS

Running since 10:52 Lagos time (09:52 UTC) on 4 October 2026 on the owner's Hostinger VPS, srv2029996.hstgr.cloud (187.77.178.30), as the systemd unit sleeve-keeper under the sleeve user (D-036, keeper/deploy/README.md). Release 20261004T095155Z-b7bbc48e4775, a private Node 22.20.0 at /opt/sleeve/node, secrets in /opt/sleeve/secrets at 600 root:root. KEEPER_MIN_BALANCE_ETH is 0.0003 rather than the default 0.001, because the keeper address holds 0.001.

Install or upgrade from the repo root with `bash keeper/deploy/install.sh root@nightbook-vps`, the ssh alias for this host.

Checks, read on the server and from outside:

- The key file on the server gives 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, the module's default keeper, which holds 0.001 ETH and nonce 0 on chain.
- The dry run (sleeve-keeper-once) loaded an empty index, indexed from the deploy block 79,338,287 with no errors, and found nothing to send.
- /health answers 200 and status ok 64 blocks behind the head, with 0 accounts, no alerts and the 0.001 ETH balance. It listens on 127.0.0.1:8787 only. The service used 55 MB with no restarts, and nightbook-indexer and nightbook-keeper stayed active.
- https://trysleeve.xyz/api/index answers with indexedTo from the keeper's Supabase cursor (79,843,926 at the first check).
- First real work, 4 October 2026: the keeper split ten 1 USDG payments into receipts 1 to 10, each 0 to 5 seconds after its payment (median 4), for 0.0000393 ETH of gas in all. KEEPER is at nonce 10 with 0.00096 ETH (results/hp1/RECEIPTS.md).
