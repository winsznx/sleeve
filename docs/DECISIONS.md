# Decisions

Each entry records a choice a reviewer would question, with the reason. Owner directives are marked as such.

## D-001 Run mode replaces one-component-per-session

Date: 2 October 2026. Owner directive.

The build contract's first working rule said to stop after every component and wait for a go. For this run the components still go in order and each meets its acceptance criteria before the next starts, but the report goes to docs/PROGRESS.md and work continues. Work stops only for the owner's stop conditions: a G6 failure on item a, c or g, a missing input with no independent work left, a ready mainnet deploy or the in-session question, a PRD invariant test whose fix would change the PRD, a PRD gap that needs a decision, or any spend beyond the agreed gas plan.

## D-002 Vercel and a VPS replace Cloudflare Workers

Date: 2 October 2026. Owner directive. Overrides PRD section 13, which put the keeper on Cloudflare Workers.

The app, the verifier page and any API routes deploy to Vercel. The keeper is a long-running signer that polls every few seconds and manages its own nonce, which fits a process better than a cron-triggered worker, so it runs on the owner's VPS under a supervisor with restart on failure. Anything else that cannot run on Vercel also goes to the VPS.

## D-003 Passkey is the only M0 login

Date: 2 October 2026. Owner directive. Overrides PRD section 7.1, which allowed passkey or email.

M0 login uses ZeroDev's passkey validator. Email login moves to M1. This keeps outside accounts to ZeroDev, Alchemy, Supabase, Vercel, the VPS and GitHub. The passkey's relying-party id is the production domain, so the domain must be final before any real person creates a passkey.

## D-004 Single EOA keys, no multisig

Date: 2 October 2026. Owner directive.

DEPLOYER, KEEPER and TEST_PAYER are single EOAs generated with cast and stored in ~/.sleeve-keys at mode 600. DEPLOYER holds the TokenSource admin role behind the timelock. The residual risk of a single admin key is bounded by the contract design: the admin can only remove tickers or change pools behind a 48-hour timelock with a public event, and cannot move funds or change a rule (I10). KEEPER has no authority beyond public functions.

## D-005 Frontend follows the owner's closeout folder, light theme, green for blue

Date: 2 October 2026. Owner directive.

The app reuses the light theme of the owner's closeout design system: type scale, spacing, radii, shadows, component patterns and layout. Every blue becomes a green scale checked for WCAG AA on white, kept distinct from Robinhood's brand colors. No Robinhood logo or feather, nothing that implies a partnership, and no closeout name, logo or copy.

## D-006 .env.example stays tracked

Date: 2 October 2026.

The owner's .gitignore spec covers .env and .env.*, which would also hide .env.example. The build contract requires .env.example as the only env file in the repo, so .gitignore re-includes it with a negation.

## D-007 LedgerMath and SessionCalendar run alongside the G6 spike

Date: 2 October 2026.

The PRD lets LedgerMath run alongside G6 because it does not touch the account. SessionCalendar is also a pure library with no account dependency, and the owner's run plan allows the two to run as parallel subagents. Running both while G6 runs cannot waste work if G6 fails, because a stack change does not touch either library. PriceGuard and every later component wait for G6.

## D-008 Forked tests use an archive RPC

Date: 2 October 2026.

The public RPC at rpc.mainnet.chain.robinhood.com serves state for only a few minutes of blocks. A call 1,000 blocks back works and a call 10,000 blocks back fails with "historical state is not available", and blocks arrive about ten per second. A pinned fork block would stop working within minutes, so pinning a more recent block does not help. Forked tests read FORK_RPC, which defaults to dRPC's public archive endpoint https://robinhood.drpc.org, checked to serve state six days back. FORK_RPC moves to the Alchemy app once it exists. The verifier stays on the public RPC and the keeper on Alchemy, so they never share a provider.

Pinned blocks: 78,312,136 (Friday 2 October 2026 10:44 EDT, regular session) and 73,280,794 (Saturday 26 September 2026 14:00 EDT, weekend closure).

## D-009 Engineering decisions from the PRD gap sweep

Date: 2 October 2026. Source: docs/research/prd-questions.md (Q numbers). Each is an implementation detail the PRD leaves open. Owner-level questions went to the owner as batch 2 and are not decided here.

- Q3 Legs sum exactly to the equity part, so total split dust stays under one base unit for any number of legs, and it goes to spend.
- Q4 Outflows and reconciles shrink pending buckets in ascending ticker id. LedgerMath returns the total taken from pending; the module spreads it and lists per-bucket amounts on the RECONCILED receipt and the OwnerOutflow event.
- Q7 Calendar intervals are half-open. On early-close days the 24/5 session ends 17:00 New York time (27 Nov 2026, 24 Dec 2026, 26 Nov 2027), per docs/research/session-calendar.md. Timestamps outside the covered range fail closed and the module queues them.
- Q11 Execution price is stored in USDG base units per 1e18 token units and the premium in signed basis points rounded against the owner. Pass or fail is the exact integer inequality with runtime decimals, so rounding never decides a fill. One shared test-vector file feeds the module tests, the verifier and the replay.
- Q12 Guard order is PRD 7.4 steps 1 to 7, then the minimum clip, then the buy in an external self-call. Only PremiumAboveCap is caught and queued. A minimum-out failure or a partial fill (USDG spent below amountIn) reverts the whole call and nothing moves. sqrtPriceLimitX96 is zero.
- Q13 Module actions inside an open owner bracket compute unsorted from the virtual balance (balance at begin plus the module's own delta), so an owner outflow is never booked twice. endOwnerOp tolerates an account that uninstalled inside the bracket.
- Q15 observe() stores the unsorted amount and restarts the clock whenever unsorted grows past it. A public split needs the grace elapsed and unsorted no larger than the stored amount, so a dust transfer cannot pre-age the clock for a later payment. Keeper and owner splits clear it. Grace is 3,600 seconds.
- Q16 A public settle waits for the grace after the latest of the bucket's first queue time, the current session's opening instant and the observation, which gives the keeper the first hour of every session.
- Q20 onUninstall releases every bucket with a RELEASED receipt and deletes ledgers, rule, keeper and observation. Receipts and lots stay. onInstall overwrites any stale state with a fresh snapshot, because Kernel ignores a failed onUninstall.
- Q21 The trigger passes an allowlisted pool and a non-zero quote in raw token units per 1e6 USDG base units (sells: USDG base units per 1e18 token units). minOut uses the rule's slippage cap. Public callers bring their own quote, so the premium cap is their real bound. Quote, minOut and pool go on the receipt.
- Q22 A split never merges its equity part with an existing bucket. A part below the clip joins the bucket; the keeper settles any bucket that reaches the clip.
- Q23 Lots exist only for buys (FILLED or SETTLED) and take the receipt id. QUEUED receipts record money entering a bucket, SETTLED and RELEASED record it leaving. Release moves the whole bucket.
- Q24 Settle applies the current rule's caps and records the current rule version. A bucket for a ticker the rule no longer names keeps waiting until settled or released. A ticker removed from TokenSource sends its bucket to spend as REFUSED_TICKER.
- Q25 Receipts are events with every field plus keccak256 of the ABI-encoded receipt stored per id. Ids are global and sequential from 1. The public RPC serves old logs but no old state, so the verifier needs no archive node.
- Q26 Receipts add the accounting mode, the sell override, the USDG/USD round id and answer, the quote and minOut, and per-bucket amounts on RECONCILED. tokenUid is bytes32, venueId 1 is Uniswap v3 through SwapRouter02, pool is the v3 pool address, calendarVersion is uint32, payer is zero in M0.
- Q30 A sell by amount takes the oldest lot first; a sell by lot names it. Tokens outside lots cannot be sold through Sleeve in M0. Proceeds are attributed to lots pro rata.
- Q32 M0 swaps single hop only. Every launch ticker has a direct USDG fee-500 pool with 126,073 to 2,124,718 USDG.
- Q33 TimelockController with a 172,800-second minimum delay, DEPLOYER as proposer, executor and canceller, and no admin role holder. Launch values go in constructors. A script reads every deployed value back.
- Q36 The verifier recomputes from the receipt event and stored hash, the Transfer logs of the fill transaction, getRoundData at latest state, the multiplier and pause events, the calendar's pure function and the shared premium function. It never reads historical pool state, and it shows every mismatch.
- Q42 The app deploys each account with the module installed through Kernel v3.1 initConfig in the first UserOp and shows the payment address only after deployment confirms. Otherwise early payments land in the install snapshot and are never split.
- Q48 The module implements OpenZeppelin v5.4's ERC-7579 interfaces with no new dependency and its runtime size is checked at every component.

## D-010 Pool allowlist at launch

Date: 2 October 2026. Source: docs/research/pools.md, block 78,323,256.

| Ticker | Pool | Fee | Depth within 2 percent |
| --- | --- | --- | --- |
| SPY | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 500 | 217,986 USDG |
| QQQ | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 500 | 652,371 USDG |
| NVDA | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 500 | 724,558 USDG |
| AAPL | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 500 | 177,114 USDG |
| AAPL, second | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | 3000 | 36,615 USDG |

The fee-100 pools for SPY and QQQ are empty, NVDA's fee-100 and fee-10000 pools are drained, and the remaining pools are thin. The v3 factory enables only fees 100, 500, 3000 and 10000; the extreme fee tiers in PRD 7.4 exist only on v4. The PRD's G5 source pool 0xae1685599288831eb0844cb59058116ee3184b9a is a memecoin pool, not NVDA.

## D-011 Stock token checks read the live registry

Date: 2 October 2026. Source: docs/research/chain-constants.md.

Every launch token is a BeaconProxy whose beacon is the AccessControlsRegistry at 0xe10b6f6B275de231345c20D14Ab812db62151b00. It holds one blocklist for all stock tokens (isBlocked(address)) and the global pause. PriceGuard reads the registry through token.ACCESS_CONTROLLED_REGISTRY() on each call, so it follows the issuer's live state. token.paused() already includes the registry pause. Token transfers also check the pool, so a blocked pool makes the swap revert; the module checks isBlocked(pool) first and reverts PoolBlocked so the trigger can pick another allowlisted pool.

## D-012 The verifier throttles on the public RPC

Date: 2 October 2026.

Robinhood Chain's terms say the public RPC is rate limited and not for production traffic, and research calls hit a Cloudflare challenge after about 14 quick requests. The verifier stays on the public RPC so it never shares a provider with the keeper (D-008), and it sends requests one at a time with backoff.

## D-013 LedgerMath limits a reviewer would ask about

Date: 2 October 2026. Component 1 review.

- A pull the module cannot see is invisible while it is smaller than unsorted income: it shows up as less income, not as an outflow. Reconcile applies the spend-first order only to the shortfall that remains once unsorted is gone. Example: balance 1,000, spend 600, pending 300, a third party pulls 150; the next split sees balance 850, shortfall 50, and spend drops to 550. This follows from the contract seeing balances, not transfers.
- Cumulative leg rounding gives the extra unit to the leg that crosses an integer boundary, not to the leg with the largest remainder. Legs always sum to the equity part and each is within one unit of its exact share.
- validateWeights also rejects an empty basket (EmptyBasket) and a zero weight (ZeroWeight). PRD I9 only requires weights to sum to 10,000; a zero-weight leg would be a leg that never buys, so it is refused.

## D-014 Build the whole stack; batch 2 defaults adopted

Date: 2 October 2026, 19:50 Lagos. Owner directive.

The owner asked for the full product to be built without time targets, on the research and recommendations already made, leaving only key funding, allocation, deployment and live testing. Consequences:

- Batch 2 (docs/research/prd-questions.md, owner items 1 to 22) is built with the recommended defaults: ALL_DAY session type for the launch tickers set in the TokenSource constructor; a fresh-round-after-reopen guard step; USDG/USD within 50 bps and at most 25 hours old; a 24-hour pending-multiplier window with no after-clause; owner-editable premium cap 0 to 500 bps, slippage up to 500 bps, minimum clip at least 1 USDG; a paused rule leaves USDG unsorted; a per-account keeper the owner can change; timelocked ticker removal and pool add or remove only; timelocked calendar appends, in-range closures and future daylight-saving replacement; disclosure candidate 3 (keccak256 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89); campaign accounts at 50 percent equity with a 1 USDG clip while the product default stays 10 percent SPY with a 25 USDG clip; top-up through a USDG permit inside a bracketed owner op; a sell outside the session reverts SellWaits; the override skips session and feed age once and may widen the discount cap up to 500 bps; own WebAuthn ceremony with credentials in Supabase; optional recovery signer with I11 claimed only for accounts that set one; capped ZeroDev sponsorship; geolocation blocks onboarding only, including the British Virgin Islands; the issuer-accurate exit line; the three claim rewordings; the HP2 and HP1 definitions as recommended. The owner can override any of them.
- The frontend design source is /Users/mac/closeout/apps/web (Next.js and Tailwind). The other candidate held only documents.
- Contract components 2 to 6 stay strictly ordered. Work with no code dependency on them runs alongside: the app's design system and screens against SPEC.md with a mock data layer, and the HP2 replay harness. Keeper and verifier start once the module ABI is final.
- Shared TypeScript (ABIs, receipt decoding and hashing, premium math, calendar port) lives in packages/core, used by the keeper, the verifier and the app. The repo layout gains packages/ for it.
- Before mainnet, the whole flow runs locally: an anvil fork of chain 4663, contracts deployed by the deploy script, a local ERC-4337 bundler, local Supabase in Docker, the keeper, the app with a localhost passkey, and the verifier.

## D-015 Brackets are keyed by the caller

Date: 2 October 2026. G6 review.

PRD 7.2 says beginOwnerOp and endOwnerOp accept only the account as caller. No module can tell a real Kernel account from a contract that installs the module on itself, so the module keys every ledger and bracket slot by msg.sender and rejects callers that never installed it. A contract posing as an account reaches only its own state. G6 item g tests both the rejection (an EOA, a plain contract, a second Kernel account without the module) and the isolation.

## D-016 Unit runs exclude the forked spike

Date: 2 October 2026.

The G6 spike's 23 tests fork the archive RPC and make live calls to the public RPC. Contract commits run the unit and fork suites of the component being committed plus the spike when the account path changes; routine unit runs pass --no-match-path "test/spike/*" so a rate limit cannot block them.

## D-017 Calendar authority, deadlines and timelock powers

Date: 2 October 2026. Component 2 review.

- Source of the schedule: Chainlink's market-hours page and the feeds' us_equities_24/5 metadata set Sunday 20:00 to Friday 20:00 New York time for the launch tickers. The issuer's Paris-time mint window governs minting, not secondary trading, and is ignored.
- Session types: NONE, ALL_DAY and REGULAR. EXTENDED is not encoded because sources disagree on its start (04:00 or 07:00 New York). A ticker without a Chainlink feed is NONE and cannot be a rule target.
- sessionOpenedAt is the start of the unbroken open stretch: Sunday 20:00 in a normal week, 20:00 after a holiday or an early close. The fresh-round check compares the feed's updatedAt with it, and the public settle grace runs from it, so the keeper gets the first hour after each reopen, not after each daily 20:00 boundary.
- Timelock deadlines: an added closure counts only if executed before 00:00 UTC on the day, an early close before 17:00 UTC. With the 48-hour delay, a closure announced later cannot be added and is guarded by PriceGuard's age, freshness, oraclePaused and premium checks.
- Trust: two timelocked paths can open a future instant, appendYear (by omitting a holiday) and replaceFutureSwitch (by moving a session an hour). Both are public for 48 hours before they execute, and the proposal script must print every date in New York time for review. Writes are add-only for closures, so a wrong closure needs a new extension.
- Coverage ends at 1 January 2028 00:00 New York time; 2028 must be appended before Sunday 2 January 2028 20:00 EST, which means proposing at least 48 hours earlier. The keeper alerts ahead of coverageEnd().

## D-018 Failure modes the guard surfaces as reverts

Date: 2 October 2026. Component 3 review.

- A blocked pool reverts PoolBlocked instead of queueing, because the real Stock Token refuses transfers out of a blocked pool and the swap would revert anyway (shown on the fork with the real registry). If every allowlisted pool for a ticker is blocked, splits on that ticker revert until the timelock allows another pool, which takes 48 hours. The USDG stays unsorted and spendable the whole time.
- A feed or the registry that reverts or returns malformed data bubbles its own revert. That fails closed; the keeper logs the raw revert to tell causes apart.
- OpenZeppelin's TimelockController lets a 48-hour self-operation lower its own delay, so 48 hours would not be a floor. Sleeve deploys SleeveTimelock, a TimelockController whose updateDelay refuses any delay below 172,800 seconds, so "behind a 48-hour timelock" stays true.

## D-019 Account install path and module behaviors from the component 4 review

Date: 3 October 2026.

- Install path. The app deploys the account with its first UserOp, with no initConfig, and installs the module in that UserOp's callData, so onInstall runs in the execution phase. Installing through initConfig would run onInstall during validation, where it reads the USDG proxy and TokenSource; ERC-7562 bars that storage access for an unstaked factory, and the Kernel factories on 4663 are unstaked. The deployment itself carries the same exposure as every Kernel deployment on 4663, which bundlers accept today. This address does not commit to the module, so anyone can deploy the account first without it; the app then sends the install op without initCode. The app shows the payment address only after both SleeveModule.isInitialized and Kernel's isModuleInstalled return true, so no payment can land before the snapshot. This replaces D-009 Q42.
- One OwnerOpEnded event per closed bracket, inflow or outflow, carries the per-bucket amounts. It replaces SPEC's OwnerOutflow. An owner outflow that drains a bucket is recorded by that event, not by a receipt, so the verifier reads both.
- onInstall releases buckets left by a failed onUninstall with RELEASED receipts before the fresh snapshot, and an install inside an open bracket restarts the bracket from the snapshot. onInstall overwrites instead of reverting on a second install, which deviates from ERC-7579's MUST revert because the module cannot tell a double install from leftover state; the interface NatSpec says so.
- Uninstall gas. Kernel calls onUninstall with whatever gas is left and ignores a failure. With buckets to release, the app sets callGasLimit to at least 400,000 for uninstall ops and checks ModuleUninstallResult. A skipped release is recovered by a second uninstall or at the next install.
- Rule versions only go up per account, across uninstall and reinstall, so the verifier can key a receipt's rule by (account, version).
- RECONCILED writes one receipt with the totals and a companion Reconciled event with the amount taken from each bucket.
- Component 5 refuses keeper and public triggers while the account's bracket is open, refuses any account whose Kernel no longer lists the module, and calls executeFromExecutor only with fixed targets and selectors: USDG approve to the router, the router's exactInputSingle, and for sells the Stock Token's approve. The module never forwards arbitrary calls, because an executor can make the account call anything, including installModule or changeRootValidator.
- The module's constructor probes calendar.version(), checks swapRouter.factory() equals TokenSource's v3 factory, and requires the guard parameters to equal PriceGuard.defaultGuardParams() and the grace to be 3,600 seconds, because the module is immutable and a loose value would switch a guard off for good.
- SleeveTimelock gets a delay ceiling as well as the floor, so a mistaken raise cannot freeze admin writes, and its constructor requires the admin argument to be zero.
- Components 5 and 6 do not fit in one 24,576-byte contract. The buy, settle and sell machinery moves into delegatecalled external libraries that share the module's storage and receipt log, with via-IR for the module if needed. The deploy script deploys and links them.

## D-020 HP2 provisional result and how C2 may be worded

Date: 3 October 2026. Source: docs/HP2_RESULTS.md (provisional until the Alchemy rerun), results/hp2/summary.json.

The pre-registered rule returns PASS at 100 USDG on the primary reference: the pooled mean of arrival premium minus guarded premium is 309.11 bps (95 percent bootstrap interval 209.24 to 419.12), and the guarded median delay is 0 hours (90th percentile 38.5 hours, 35 percent of payments waited). The composition matters more than the headline. SPY's fee-500 pool received its first liquidity on 19 August 2026 at about twice the reference price; buying at arrival paid about 9,905 bps on 31 payments, and the guard waited and paid about -20 bps. On the other 934 payments, whose arrival fill was within the 100 bps cap, waiting cost 1.66 bps each on average. QQQ alone shows a benefit (+5.27 bps, interval 2.61 to 8.09); NVDA and AAPL show no significant difference.

Wording that stays true: the guard refused a real extreme mispricing that buying at arrival would have paid, and in ordinary conditions it cost about 1.7 bps per payment to wait for the reference. Sleeve does not claim the guard lowers the price of a typical buy. The metric and the rule were not changed after the result.

## D-021 Frontend v2 and the pre-mainnet audit

Date: 3 October 2026. Owner directive.

- The owner rejected the v1 interface as generic: text in wide empty columns, a wall of disclosure text, no product visuals, no token icons, a plain navbar. v2 follows closeout's landing and product UI section by section (blueprints in docs/design/), with a bright palette that puts green wherever closeout uses blue, clearly distinct from Robinhood's colors.
- Token icons follow the owner's Bespeak rules: real logos only, never a letter badge; sources in order are the issuer's own asset metadata (the Robinhood assets API logoUrl, keyed by contract), then onchain metadata by exact contract address, then chain lists, then a pinned source with its reason; files are downloaded, checksummed, committed, served locally and listed in a manifest, and the sync fails loudly on any missing icon. The network is shown as text with a neutral glyph, never the Robinhood feather.
- A rich navbar (mega menu, live market session pill, network pill, account chip, mobile sheet), custom shareable receipt and week cards exported as PNG, and OpenGraph images for the site, receipts and verify, designed from researched references in docs/design/inspiration.md.
- Every contract gets a multi-agent audit before mainnet: round 1 on the committed contracts (12 lenses, dedup, two adversarial verifiers with proof-of-concept tests per finding, report in docs/audit/), and round 2 over every contract once components 5 and 6 are done. Fixes land before the deploy plan.

## D-022 Wallet connect at onboarding

Date: 3 October 2026. Owner directive, which amends D-003 (passkey only in M0).

Onboarding adds RainbowKit with WalletConnect beside the passkey. A connected wallet can own the Sleeve account (it becomes the Kernel account's ECDSA root signer, the same validator the G6 spike tested) or be added to a passkey account as its recovery signer. Consequences: WalletConnect (Reown) joins the outside accounts and needs a project id with Sleeve's domain allowed; a wallet-owned account can sign outside Sleeve, which is the documented WRAPPED limit (PRD 7.2), so the app says so when a wallet is chosen; the Robinhood Chain entry in RainbowKit uses a neutral icon, never the Robinhood feather. Integration recipe: docs/research/wallet-connect.md.

## D-023 Stock Token icons show the underlying fund or company mark

Date: 3 October 2026. Owner directive.

The issuer serves the Robinhood feather as the logo for every Stock Token, which the brand rules forbid, so the icon sync withheld all four. The owner asked for real icons wherever a Stock Token appears, as in Bespeak. The sync now pins the mark of what each token tracks (SPDR for SPY, Invesco for QQQ, NVIDIA, Apple) from assets.parqet.com, checksummed, with the issuer rung's rejection kept in the manifest. The marks identify exposure; nothing in the app says or implies that the fund sponsor or company is involved with Sleeve.
