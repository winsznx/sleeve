# Decisions

Each entry records a choice a reviewer would question, with the reason. Owner directives are marked as such.

## D-001 Run mode replaces one-component-per-session

Date: 2 October 2026. Owner directive.

The build contract's first working rule said to stop after every component and wait for a go. For this run the components still go in order and each meets its acceptance criteria before the next starts, but the report goes to docs/PROGRESS.md and work continues. Work stops only for the owner's stop conditions: a G6 failure on item a, c or g, a missing input with no independent work left, a ready mainnet deploy or the in-session question, a PRD invariant test whose fix would change the PRD, a PRD gap that needs a decision, or any spend beyond the agreed gas plan.

## D-002 Vercel and a VPS replace Cloudflare Workers

Superseded for the app by D-033 on 4 October 2026. The keeper stays on the VPS.

Date: 2 October 2026. Owner directive. Overrides PRD section 13, which put the keeper on Cloudflare Workers.

The app, the verifier page and any API routes deploy to Vercel. The keeper is a long-running signer that polls every few seconds and manages its own nonce, which fits a process better than a cron-triggered worker, so it runs on the owner's VPS under a supervisor with restart on failure. Anything else that cannot run on Vercel also goes to the VPS.

## D-003 Passkey is the only M0 login

Date: 2 October 2026. Owner directive. Overrides PRD section 7.1, which allowed passkey or email.

M0 login uses ZeroDev's passkey validator. Email login moves to M1. This keeps outside accounts to ZeroDev, Alchemy, Supabase, Vercel, the VPS and GitHub. The passkey's relying-party id is the production domain, so the domain must be final before any real person creates a passkey.

## D-004 Single EOA keys, no multisig

Date: 2 October 2026. Owner directive.

DEPLOYER, KEEPER and TEST_PAYER are single EOAs generated with cast and stored in ~/.sleeve-keys at mode 600. DEPLOYER holds the TokenSource admin role behind the timelock. The residual risk of a single admin key is bounded by the contract design: the admin can only remove tickers or change pools behind a 48-hour timelock with a public event, and cannot move funds or change a rule (I10). KEEPER has no authority beyond public functions.

## D-005 Frontend follows the owner's closeout folder, light theme, green for blue

Superseded for the theme by D-029 on 3 October 2026: both themes.

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
- Token icons follow the owner's icon rules: real logos only, never a letter badge; sources in order are the issuer's own asset metadata (the Robinhood assets API logoUrl, keyed by contract), then onchain metadata by exact contract address, then chain lists, then a pinned source with its reason; files are downloaded, checksummed, committed, served locally and listed in a manifest, and the sync fails loudly on any missing icon. The network is shown as text with a neutral glyph, never the Robinhood feather.
- A rich navbar (mega menu, live market session pill, network pill, account chip, mobile sheet), custom shareable receipt and week cards exported as PNG, and OpenGraph images for the site, receipts and verify, designed from researched references in docs/design/inspiration.md.
- Every contract gets a multi-agent audit before mainnet: round 1 on the committed contracts (12 lenses, dedup, two adversarial verifiers with proof-of-concept tests per finding, report in docs/audit/), and round 2 over every contract once components 5 and 6 are done. Fixes land before the deploy plan.

## D-022 Wallet connect at onboarding

Date: 3 October 2026. Owner directive, which amends D-003 (passkey only in M0).

Onboarding adds RainbowKit with WalletConnect beside the passkey. A connected wallet can own the Sleeve account (it becomes the Kernel account's ECDSA root signer, the same validator the G6 spike tested) or be added to a passkey account as its recovery signer. Consequences: WalletConnect (Reown) joins the outside accounts and needs a project id with Sleeve's domain allowed; a wallet-owned account can sign outside Sleeve, which is the documented WRAPPED limit (PRD 7.2), so the app says so when a wallet is chosen; the Robinhood Chain entry in RainbowKit uses a neutral icon, never the Robinhood feather. Integration recipe: docs/research/wallet-connect.md.

## D-023 Stock Token icons show the underlying fund or company mark

Date: 3 October 2026. Owner directive.

The issuer serves the Robinhood feather as the logo for every Stock Token, which the brand rules forbid, so the icon sync withheld all four. The owner asked for real icons wherever a Stock Token appears. The sync now pins the mark of what each token tracks (SPDR for SPY, Invesco for QQQ, NVIDIA, Apple) from assets.parqet.com, checksummed, with the issuer rung's rejection kept in the manifest. The marks identify exposure; nothing in the app says or implies that the fund sponsor or company is involved with Sleeve.

## D-024 The product leads with the payday split; receipts stay behind it

Date: 3 October 2026. Owner directive ("this product isn't about receipts").

The build contract already says it: lead with the payday split; the receipt is the trust surface, not the headline. The v1 interface and the first v2 briefs got this backwards, with Receipts as a primary destination, a landing section headed "The receipt is the proof", receipt cards and receipt OpenGraph images. From here:

- What the product shows first, everywhere: a payment arrives at your address and splits by your rule into spendable USDG and a Stock Token you own; when the market is closed the equity share waits as USDG. PRD 15: the first screen is the sentence, the two sleeves and the payment address.
- App navigation: Home, Payments (the inbox of inbound USDG, each showing what it became), Holdings (the Stock Tokens you own, with sell-back as a swap), Rule. History (the full action list with CSV export, PRD 7.10's receipt list) and Check a split (the public verifier) sit in secondary navigation. /inbox and /receipts redirect to /payments and /history; /receipts/[id] stays as the details-and-proof page of one action, reached from a payment, a holding or history.
- Landing: the split, the two sleeves, the market-closed wait, the rule, holdings and sell-back, the launch tickers; trust (every split is on chain and anyone can recompute it) is one compact section near the end, not a headline.
- Cards and OpenGraph: a payday card (what this payday became: share of pay into a ticker, with its icon and the split bar) and a week card, with amounts and the address hidden by default. The word receipt appears only where the subject is proof.
- Contracts are unchanged: every action still writes a receipt onchain, because that is what makes the split checkable.

## D-025 Public-trigger clock and settle readiness after audit round 1

Date: 3 October 2026. Source: docs/audit/AUDIT_R1.md, A1-05, A1-25 and S-01. This replaces D-009 Q15 and Q16. docs/SPEC.md section 8.

- An observation covers unsorted USDG below the stored level plus 1 USDG (OBSERVE_RESTART_GROWTH). observe restarts the clock only past that, so growth under 1 USDG rides the running clock and dust cannot postpone the public fallback. A stranger can still postpone it, at 1 USDG per restart, and that USDG becomes the owner's income. observe, the public split and previewSplit apply the one coverage rule (S-01). Q15 restarted the clock on any growth, which let 1 base unit and an observe every 50 minutes keep the public split shut for good.
- The stored level only goes down between observations: to the unsorted USDG left after an owner outflow, to zero after a reconcile, and to the current unsorted when observe finds less (A1-25). observedAt keeps running, so a later payment waits out a grace of its own instead of riding an older clock.
- Every split that sorts clears the observation, whatever its trigger. Q15 cleared it for keeper and owner splits only. A split that only reconciles keeps the clock, at level zero.
- A public settle waits for the grace after the later of the bucket's since and, while the ticker's session is open, the session's opening. It needs no observation and never changes one, so a split, an observe or another settle cannot move a bucket's clock; under Q16 a dust split by anyone cleared the observation a public settle needed. The keeper still has the first hour after every reopen (D-017). Trade-off: a sub-clip part that lifts an old bucket over the clip no longer gives the keeper a fresh hour.
- Residuals, pinned by test_A1_05a_residual_oneUsdgPerRestartPostponesThePublicSplit and test_A1_05a_residual_hourlyIncomeKeepsThePublicSplitShutWhileTheKeeperIsDown: income of 1 USDG or more arriving at least hourly keeps the public split shut while the keeper is down, since each payment needs its own observation and hour, and a griefer can do the same at 1 USDG per restart. Owner triggers and release never wait. Up to 1 USDG of later income can be sorted on an older clock.

Tests: the A1-05, A1-25 and S-01 tests in contracts/test/audit/AuditClock.t.sol, and the test_observation tests in contracts/test/unit/SleeveModuleSpec.t.sol for which calls clear, keep or leave the observation.

## D-026 Ledger, buy and admin behaviors from audit round 1

Date: 3 October 2026. Source: docs/audit/AUDIT_R1.md. docs/SPEC.md sections 1 to 13.

- A reentrancy lock per account (A1-21). The module keeps one transient lock slot per account in place of OpenZeppelin's ReentrancyGuardTransient, which this run's code standards name. Owner functions lock msg.sender, observe, split and settle lock their account argument, and a second entry for the same account reverts AccountLocked. With one lock for the whole module, a contract that installed the module on itself could make other accounts' owner ops fail from inside its own buy. Every writer of an account's state still refuses that account's reentry. Flagged for the owner, since it departs from the named standard.
- Earlier reconciles, next to D-013 (I-01, I-02, I-03). PRD 7.2 has the next split reconcile an outside pull, spend first and then pending equity. Three paths now act before that split, so owner money and sale proceeds never refill a bucket the pull emptied: endOwnerOp reconciles at the virtual balance before it credits an owner inflow, sell reconciles at the sorting balance before any token moves, and settle reverts LedgersAboveBalance until a split has reconciled. Each reconcile writes the same RECONCILED receipt and Reconciled event a split writes. No invariant changes.
- The premium is measured in USDG at par (A1-11), as D-014 adopted with prd-questions Q9 option A. The premium and discount caps and the receipts' premiumBps compare the USDG spent or received with tokens times the feed answer as if 1 USDG were 1 USD; the USDG/USD answer only gates DEPEG. With USDG at 1.005, inside the band, a fill at the 100 bps cap is about 150 bps over the USD reference. The verifier and the HP2 replay never convert premiumBps, and the app's worst-case line says it is in USDG terms.
- The RECONCILED field mapping (A1-16), which D-019's RECONCILED bullet left open. A ledger reconcile puts the shortfall in usdgIn, the cut off spend in usdgSpent and the cut off the buckets in usdgQueued, with usdgToSpend, tickerId, token and lotId zero, and the Reconciled event lists each bucket's cut. A lot reconcile writes one RECONCILED per trimmed lot with tickerId, token, lotId and the tokens trimmed in tokensIn, and no USDG. usdgSpent therefore means investment only on FILLED and SETTLED receipts, and readers sum it by status. The hashed receipt layout does not change.
- No router minimum (A1-12), amending D-009 Q12. The batch passes amountOutMinimum 0, and executeBuy checks the premium cap before the trigger's minimum, so a fill that fails both queues PREMIUM in PRD 7.4's order instead of reverting with the router's string. A minimum-out failure alone still reverts the whole call, as TooFewTokens, with nothing moved. Sells check DiscountAboveCap before TooLittleUsdg.
- The fresh round after a reopen is judged by startedAt as well (A1-10), amending D-017's sessionOpenedAt bullet. A round observed before the opening and transmitted after it carries the closed market's answer, so readStockFeed refuses a round whose startedAt or updatedAt is before the opening. Receipts keep updatedAt; the verifier reads startedAt with getRoundData.
- onUninstall reverts ModuleStillListed while the account still lists the module (A1-24), narrowing D-009 Q20. An uninstallModule of type 4, 5 or 6, or a direct call in an owner batch, no longer wipes the ledgers while Kernel keeps the executor. On a real executor uninstall Kernel removes the executor before it calls onUninstall, which still releases the buckets.
- One admin, bound at deploy (A1-26). The module's constructor requires TokenSource and the calendar to answer to the same timelock, with more code than an EIP-7702 designator, reporting MIN_DELAY_FLOOR as 172,800 and a delay at or above it. SleeveTimelock refuses an empty or zero proposer or executor list. The immutable module is then bound for good to admin writes with a 48-hour public window. The deploy script still reads back both timelock() values, getMinDelay() and the role grants.
- The last-pool rule (A1-18). TokenSource refuses to remove an active ticker's last pool (LastPoolOfActiveTicker) and to list a ticker with a feed and no pool (NoPools), because the module reads an empty allowlist as REFUSED_TICKER, which would send every equity part of the ticker to spend and let anyone settle its buckets into spend after the grace. A rotation is one scheduleBatch that adds before it removes. A removed ticker may still empty its list.
- I1 as a delta (A1-01), pending the owner. Every buy since 9a6edba, and every sell since component 6, checks that the module's own USDG and stock token balances did not change across the swap. PRD I1 reads "The module holds no USDG and no stock tokens before or after any call", which no code can keep once a stranger transfers tokens to the module, and the absolute check let one base unit block every buy for good. Proposed wording: "No call changes the module's USDG or stock token balance." Changing how a PRD invariant holds is the owner's call. Until the owner answers, SPEC sections 1, 11 and 17 describe the delta, and CLAIM_LEDGER claim 3.7 and PROGRESS keep the PRD wording.

Tests: the audit tests docs/audit/AUDIT_R1.md lists per finding, and in contracts/test/unit/SleeveModuleSpec.t.sol test_settle_checksRunInTheSpecifiedOrder (settle's order with LedgersAboveBalance first), test_buy_theRouterGetsNoMinimum and test_premium_isMeasuredInUsdgAtPar.

## D-027 Sell-back as built

Date: 3 October 2026. Source: component 6 (ad2f656) with the audit round 1 integration. docs/SPEC.md sections 12 to 14.

- The guard order. The blocklist comes first, for the account, the pool and then the router: AccountBlocked, PoolBlocked, RouterBlocked (A1-08, since the Stock Token's approve and transferFrom check the router). Then PAUSED, ORACLE_PAUSED, MULTIPLIER and DEPEG, which revert GuardNotClear with or without the override. Then SESSION and the stock round's age and reopen check, which revert SellWaits unless overrideClosed skips them. The buy guard runs SESSION before MULTIPLIER and DEPEG; the sell moves the steps the override cannot skip ahead of it, so a sell that waits is one the override can help. The exception is a broken round, an answer at or below zero or a round from the future: SellWaits(STALE) without the override and GuardNotClear(STALE) with it, and the app does not offer the override for it. The override skips the stock round's age only; the USDG/USD round keeps its 25-hour limit under DEPEG.
- overrideCapBps is independent of overrideClosed, pending the owner's reading of B2-14, which D-014 words as "the override skips session and feed age once and may widen the discount cap up to 500 bps". Zero holds the sell to the rule's premiumCapBps, and any value from the rule's cap to 500 widens it for this sell, with or without overrideClosed; overrideClosed alone keeps the rule's cap. Tying the two would add no protection, since the owner can always set both, and the widened cap is owner-only, at most 500 bps and on every receipt. If the owner reads B2-14 as one override, a widened cap without overrideClosed would revert instead.
- Without a rule, the discount cap and the slippage cap are zero, pending the owner. Such a sell fills only at or above the feed price and the quote unless it widens the discount cap with overrideCapBps, so its receipts show overrideCapBps whenever the sale is below the feed. The alternative is the product defaults, 100 and 50 bps.
- ExceedsBalance and an oldest-first reconcileLots (A1-03). A sell is capped by its lots (ExceedsLots) and by the account's token balance (ExceedsBalance), so it never sells less than asked, where prd-questions Q30 option A had a sell take at most the balance and record the shortfall. reconcileLots trims lots down to the balance oldest first, the order sells take them in, because an outflow cannot have come from a lot bought after it, such as one bought after an uninstall and reinstall. tokensRemaining is an upper bound on a lot's tokens until reconcileLots runs, and tokens arriving from outside Sleeve can refill a phantom lot and sell as it, the token side of PRD 7.2's WRAPPED limit, pinned by test_A1_03_open_outsideTokensRefillAPhantomLot. The app adds reconcileLots for every ticker with lots to the install op and to every owner batch that moves a stock token, after the move and before any sell.
- The 100-lot bound (A1-13). A sell by amount takes from at most 100 lots and reverts TooManyLots(sellableTokens, 100) when it needs more, and reconcileLots trims at most 100 lots per call. The bound limits the receipts per call, each about 55,000 gas (docs/GAS.md); a sell across 100 real lots measured 6,000,591 gas on the fork. It does not bound every read: reconcileLots sums every lot from the head, and a sell by amount and the head's walk step over empty lots, so a queue of thousands of lots still costs more. M0 queues are far smaller, and a sell by lot id always writes one lot receipt, plus one RECONCILED receipt when it first reconciles an outside pull (I-03).
- The whole sell's price and discount on every lot receipt. Each PART_SOLD or SOLD receipt carries its lot's tokens and its pro rata share of the proceeds, rounded down with the remainder on the last lot, and the whole sell's execPrice, premiumBps (the discount, positive below the feed), rounds, quote, minOut and override fields. A price per lot from rounded shares could show a discount above the cap the sell passed. The verifier recovers a sell's totals from its own run of receipts, grouped as SPEC 13 says, because one transaction can hold several sells of a ticker.

Tests: contracts/test/unit/SleeveModuleSell.t.sol and SleeveModuleSellGuard.t.sol, contracts/test/audit/AuditLots.t.sol, and in contracts/test/unit/SleeveModuleSpec.t.sol test_sell_guardOrder_firstFailureWins, test_sell_overrideClosedAndOverrideCapBpsWorkApart and test_sell_receiptPremiumIsTheDiscount_positiveBelowTheFeed. Each sell's own run of receipts, with tokenUid and uiMultiplier read at the sale (review round 2): contracts/test/unit/SleeveModuleSellRuns.t.sol and contracts/test/fork/SleeveModuleSellRuns.t.sol, whose _sellRuns applies SPEC 13's grouping to real logs.

## D-028 Mainnet deploy of the module as built

Date: 3 October 2026, 20:45 Lagos. Owner's go: DEPLOYER funded and "time to deploy contracts, verify them".

The module is immutable, so deploying it as built settles the nine open items of docs/DEPLOY_PLAN.md section 10 the way the orchestrator recommended, each matching the code: overrideCapBps widens a sale's discount cap up to 500 bps without overrideClosed (D-027); a sell with no rule has both caps at zero and is widened per sell; I1 reads as no call changes the module's own USDG or Stock Token balance (D-026, A1-01); the transient reentrancy lock is per account (A1-21); a caller's pool off a non-empty allowlist reverts PoolNotAllowed (A1-17); an ACTIVE rule may set 0 percent equity, and its receipts read QUEUED with reason CLIP and nothing queued, which the app shows as kept as spend (A1-14); a split never merges its equity part with a bucket below the clip, which the keeper settles once it reaches the clip and the owner can release at any time (A1-15, D-009 Q22); the disclosure hash is candidate 3 (D-014); and an unscheduled closure the timelock cannot list in time stays a documented gap rather than a new emergency admin power (A1-02). The owner can still revisit any of them, at the cost of a second module that accounts install.

## D-029 Dark theme, settings, notifications and an overview dashboard

Date: 3 October 2026. Owner directive, with a dark fintech dashboard as the quality reference (kept private in internal/design-refs/, not committed).

- Themes: Sleeve gets a dark theme next to the closeout-derived light theme, with a toggle in the top bar and in Settings and the system preference as the default. This replaces the run plan's "light theme only" for the app. Both themes keep green as the accent, pass WCAG AA, and stay clear of Robinhood's colors.
- Settings page: transaction previews before signing can be turned off by the owner (on by default); notification preferences; theme; the recovery signer; the sign-in method; the rule shortcut; sample-data label while the mock runs.
- Notifications: a bell in the top bar with an unread count and a panel listing what happened to the owner's money: a payment arrived, it split, a buy filled or is waiting and why, the market reopened and a waiting buy settled, a sell filled, a release. Built from the indexed events; read state stored per account.
- Home becomes an overview in the reference's structure: the money at a glance, paydays over time as a bar chart, allocation as a donut with token icons, a calendar of paydays and market sessions, recent payments with status pills, and a help card that answers the common questions. No AI features and no performance or yield figures.

## D-030 Chain data layer choices

Date: 4 October 2026. From the chain data layer build.

- Passkey owners use Sleeve's own WebAuthn ceremony bound to NEXT_PUBLIC_PASSKEY_RP_ID and a small wrapper around ZeroDev's deployed passkey validator 0.0.3 with the RIP-7212 precompile path (usePrecompiled true), instead of an extra SDK package. Gas estimation uses a stub signature on that path.
- Every owner UserOp is simulated with eth_simulateV1 before the owner is asked to sign, so a revert reaches the owner with its name before any signature, and the preview card is built from that simulation.
- A sell runs reconcileLots first in the same bracketed batch, so lots never exceed the account's token balance (audit A1-12).
- The app reads receipts and payments from the keeper's index only while the index is within 300 blocks (about 30 seconds) of the chain head; otherwise it reads the chain directly. Indexed receipts are checked against the stored hash before display.
- In development without the Supabase service key, passkey credential records stay in the browser's localStorage; production keeps them in Supabase through a server route using the service role.
- Shared cards are signed by the account itself (ERC-1271 through the Kernel account) and checked on chain by the server before storing; wallet owners sign the typed-data hash as a personal message.
- The keeper's cursor streams are named sleeve_module and usdg_transfers, which the app's /api/index route reads.
- Uninstall carries a fixed 450,000 call gas limit and refuses to send below 400,000 (D-019). No screen calls it yet; Settings explains it. (Replaced by D-040: Settings sends it.)

## D-031 Send, previews and the overview home

Date: 4 October 2026. From the screens build.

- Send's maximum is spendable plus unsorted USDG, matching the app's line that unsorted USDG is spendable too; sending into unsorted money shows a warning in the preview, and an outflow comes off spend, then unsorted, then waiting money (PRD 7.2). Waiting USDG is released first before it can be sent.
- The destination must pass an EIP-55 checksum, cannot be the zero address or the account itself, and the owner ticks "I checked every character" on a full address shown in groups of four.
- With previews turned off in Settings, confirm dialogs keep their short text and one-press actions run directly; the preview never hides a warning the action would raise.
- Buy now appears only when the market is open or the wait is for another reason; on a weekend it is hidden because the module would revert.
- Payment rows use five status pills (received, waiting to sort, sorted, bought, waiting for the market) in place of the earlier three badges.
- The mock's network fees use the gas measured in docs/GAS.md and labelled estimates otherwise.

## D-032 QuickNode is the keeper's provider

Date: 4 October 2026. Owner: the team has three months of QuickNode credits.

QuickNode replaces the planned Alchemy app. The keeper reads and sends through a QuickNode HTTPS endpoint (KEEPER_RPC, server only). Browser reads use a second QuickNode endpoint locked to the production domain, or the public RPC when it is empty. The verifier stays on the public RPC, so it never shares a provider with the keeper (D-008, D-012). The keeper polls over HTTPS; a WebSocket endpoint is not needed in M0.

## D-033 Cloudflare Workers hosts the app, replacing Vercel

Date: 4 October 2026. Owner: Cloudflare's limits suit daily traffic better than Vercel's, and the account already pays for Workers. Reverses D-002 for the app. The keeper stays on the VPS.

- The app, the verifier page and the API routes run as one Worker named sleeve, built by OpenNext (@opennextjs/cloudflare 1.20.8 with wrangler 4.147.0, config in app/wrangler.jsonc). `pnpm --filter @sleeve/app cf:deploy` is the only deploy path.
- OpenNext copies every value in the .env files it finds, at the repo root and in app/, into the worker. The shared root .env.local also holds the keeper's RPC and the explorer keys, so app/scripts/cloudflare.mjs builds with every non-public name set empty, empties the copied file, and scans the whole output for each secret value before it uploads anything. SUPABASE_SERVICE_ROLE_KEY reaches the worker as a Cloudflare secret.
- Workers has no file system holding the server's own files. The card fonts, token logos, tokens.css and the issuer disclosure are embedded as modules in app/src/generated by app/scripts/embed-server-assets.mjs, and a test fails while any copy is stale. The disclosure keeps its sha256 check at run time.
- The eligibility check reads Cloudflare's cf-ipcountry header and treats XX, an address Cloudflare cannot place, as no country. SLEEVE_ENV=production, set in wrangler.jsonc and in the build, replaces VERCEL_ENV: it hides /dev and makes the check ignore ELIGIBILITY_IP_COUNTRY.
- next/image serves the token icons unoptimized, since Next's optimizer on Workers needs Cloudflare Images. Prerendered pages come from the deployed assets through the static assets incremental cache. Nothing revalidates, so there is no R2 bucket or queue.

## D-034 trysleeve.xyz is the production origin and the passkey relying party

Date: 4 October 2026. The owner bought the domain.

Production is https://trysleeve.xyz, and passkeys use the relying party id trysleeve.xyz, which also covers www.trysleeve.xyz. A passkey binds to its relying party for good, so this cannot change once a real person creates one (D-003). app/scripts/cloudflare.mjs fixes both values and the chain data source for every production build, so a local .env.local can keep localhost values.

## D-035 Browser reads: logs from the public RPC, the rest from a locked QuickNode endpoint

Date: 4 October 2026.

The app's log streams read from the deploy block. The public RPC answers that range in one call, while QuickNode caps the blocks per eth_getLogs call, which turns one read into hundreds as the chain grows. On a keyed provider the read transport therefore sends eth_getLogs to the public RPC and everything else to NEXT_PUBLIC_ROBINHOOD_RPC_URL.

That endpoint is public by nature, since every NEXT_PUBLIC_ value ships in the page, so it is locked at QuickNode: a referrer allowlist (trysleeve.xyz, and localhost for local runs; www redirects at the edge before a page loads), a method allowlist of the reads the app makes, without eth_getLogs, and request limits per IP address. A referrer can be forged outside a browser, so the per-IP limits are what bound abuse, and the worst abuse is spent credits: the endpoint cannot move funds and is not the keeper's. The keeper uses a separate endpoint with no referrer list and CORS off, and gets a source IP allowlist for the VPS.

API routes on the worker read through the public RPC. Their requests carry no referrer, so the locked endpoint refuses them. The one route that reads the chain, card creation, makes a few calls per card, and the throttled transport's retries carry them through the public RPC's limits: from Cloudflare's edge, two of four paced calls needed one retry on 4 October.

## D-036 The keeper runs on the owner's Hostinger VPS

Date: 4 October 2026. Owner directive. Replaces the GreenCloud server named in PROGRESS (2 October) and Q34.

The keeper runs on the owner's Hostinger VPS, srv2029996.hstgr.cloud (187.77.178.30), under systemd as the `sleeve` user, beside the owner's nightbook services and apart from them: its own user, /opt/sleeve, a private Node runtime, and its two units. The keeper's QuickNode endpoint accepts requests from that address only. The GreenCloud box runs other projects and holds nothing of Sleeve's.

## D-037 The brand kit is installed, in the app's colours

Date: 4 October 2026. Owner directive: install the brand kit into the app for both themes.

The owner's brand kit (internal/brand-kit, gitignored) defines the mark: a rounded square, the payment and the account, whose detached bottom-right corner is the share set aside as stock, beside the lowercase wordmark in Manrope Bold. Its README says to move the app's colours into brand.json and rebuild when they differ, and they did: the kit's greens #12A15F and #3DDC97 also sat within delta E 2000 of 5.7 and 4.7 of Robinhood's #17AD7B and #21CE99, under the floor of 10 that keeps the palette apart from Robinhood's (D-005, app/src/styles/contrast.mjs). Version 1.1.0 uses the app's ink and equity green in each theme: #0B0B0C and #007456 on light, #F4F4F5 and #008561 on dark, at delta E 20.1 and 13.3, with the corner piece at 5.78:1 and 4.24:1 on each theme's background. favicon.ico, which cannot follow the theme, uses #008561 and #8FF3C9.

app/scripts/install-brand-kit.mjs copies the kit's files where its README puts them: the logo component and its theme CSS into src/generated/brand, the icons into src/app, the manifest icons into public, and the logo and social files into public/brand for the README and listings. The in-app logo reads CSS variables that follow data-theme. The share cards and link previews are drawn by Satori, which reads no CSS variables, so the script also writes the logo's paths into brand-art.ts and the card renderer fills them from each image's palette. The link preview keeps its payday composition with the new lockup in place of the old split rail and word.

## D-038 A waitlist on the site, linked from the footer

Date: 4 October 2026. Owner directive: build a waitlist and link it from the footer.

/waitlist asks for an email and one optional question, how the person is paid today (stablecoins, bank, both, or "I pay other people"), which is the product signal Sleeve needs for its first earners and for payroll. The server route stores the email lowercased as the key, the answer, the country Cloudflare resolved from the request and where the form was opened, in a `waitlist` table only the service role can read or insert (supabase/migrations/20261004120000_waitlist.sql). It answers the same for a new and a repeated email, so the endpoint cannot tell anyone who signed up, and a hidden honeypot field gets that answer with nothing stored. The page names no gated feature: it asks people to hear what Sleeve does next and links to onboarding for anyone ready now. The footer's link carries `from=footer`, so footer sign-ups can be counted apart.

## D-039 A dialog opened by a tap takes focus itself

Date: 4 October 2026. Owner report: on a phone, a green ring appeared on a button whenever a sheet opened.

showModal focuses the first control in a dialog, and WebKit draws that control's ring even when a tap opened it, so on an iPhone the phone menu opened with a ring on the logo and every dialog with one on its close button. app/src/components/ui/dialog-focus.ts now reads whether the control that had focus showed a ring when the dialog opened. If it did, the person is on a keyboard and the first control keeps focus and its ring. If not, the dialog element takes focus itself with focusVisible false and no outline, which a screen reader announces by the dialog's name, and Tab still reaches the first control next. Closing returns focus to the opener with a ring only if it had one. The menu sheet and the shared Dialog both use it. Checked in WebKit with an iPhone profile: a tap opens both with no ring, and Enter opens both with the ring on the first control.

## D-040 Remove Sleeve in the app, and the account after it

Date: 4 October 2026. Owner request: Remove Sleeve end to end, and no owner stranded after it (PRD 7.1 and 7.13). Replaces D-030's "No screen calls it yet".

Owner decision, 4 October 2026: PRD I14 and PRD 7.2's "the app never builds an unbracketed batch" apply while the module is installed. An account without the module sends and turns Sleeve back on with the two ops below, the same exception D-019 already makes for the first install, so no owner is ever stuck.

- Removal. Settings has a Remove Sleeve button that opens the standard preview, simulated from the exact op: each waiting bucket moves to spend, payments stop splitting, USDG and Stock Tokens stay. Confirm signs one bracketed owner op around Kernel's uninstallModule with the fixed 450,000 call gas (D-019). It resolves only when the transaction carries ModuleUninstallResult(module, true) from the account and the account then reads back without the module, and it lists the RELEASED receipts written. A missing or false result is refused as UninstallFailed, and the preview blocks a removal whose simulated result is not true.
- Call gas. ZeroDev's paymaster answers with gas limits of its own, which viem puts over the request's, so the fixed limit never reached a sponsored UserOp, and the paymaster signs over its limits, so they cannot be put back. A sponsored op whose call gas limit comes back below the fixed one now goes owner-paid with the fixed limit, and an account without ETH gets SponsorshipUnavailable instead of an uninstall that could skip its release. A prepare-only probe on 4 October answered whether ZeroDev keeps a fixed limit on 4663: it does not. For the live wallet-owned account with one waiting bucket it sponsored the bracketed uninstall (gas price 0, no paymaster) and answered callGasLimit 148,158 whether the request asked for 450,000 or left it unset. Every removal would therefore go owner-paid. Owner decision: removal must stay sponsored, so the removal op releases every waiting bucket itself before Kernel's uninstallModule, which leaves onUninstall nothing to release and nothing a short estimate could skip.
- Sleeve off. A deployed account whose module is not installed is off. Home shows its USDG balance, all of it spendable because the module keeps no ledger for it and reads (balance, 0, 0, 0), its Stock Tokens with the debt security line, Send, and Turn Sleeve back on. Payments, Holdings, Rule and Sell show a short note with the way Home, History shows the note above the records, Send offers the whole balance, and the balance chip shows the balance. Sign-in accepts any deployed account, so an owner who removed Sleeve can still get in.
- Ops without brackets. beginOwnerOp reverts NotInstalled without the module, so an account that is off gets two ops without brackets, from a builder apart from buildOwnerOp: a send, one USDG transfer, and the reinstall, onboarding's install op (D-019) with the chosen rule. The data layer reads the install state right before either, refuses an installed account with ModuleInstalled, and sends the op exactly as built. assertBracketed refuses both, so every op of an installed account stays bracketed. Nothing goes unrecorded: there is no ledger to book a send into, and the reinstall's snapshot books the whole balance as spend (I5). This reads I14 as covering accounts with the module installed, as D-019 already does for the first install.
- A send without the module returns WithdrawResult.from as null, since no ledger gave it up. Its amount is the USDG balance delta across the transaction's block. USDG landing in that block makes the delta read short, and the send is then reported as not read back.
- Turning Sleeve back on starts from the suggested rule, previews the rule and that the balance stays spendable, and reads back the module installed with that rule at the account's next version. If an uninstall ever reads false, Kernel has unlisted the module but its state remains. The account shows as off, and the reinstall releases the leftover buckets first (D-019).

Tests: app/src/data/chain/remove.test.ts (the chain layer on a fake chain), app/src/data/chain/user-ops.test.ts (the call gas through ZeroDev's route), app/src/data/mock/remove.test.ts, app/src/lib/chain/owner-ops.test.ts, and the Settings, Home, Send and Payments screen tests.

## D-041 Wallet sign in on product pages, with the wallet code loaded on request

Date: 4 October 2026. Owner report: a person set up an account owned by a Zerion wallet (0xAEf3a020Db7851cfa7aAD1514A6FB6d81A102864 on mainnet), pressed Go to Home and met "You are signed out" with only "Sign in with your passkey", which cannot open a wallet-owned account. The landing page says "Sign in with a passkey or a wallet."

- Sign in. Every signed-out prompt and the top bar's Sign in offer both, the passkey and a wallet. signInWithWallet derives the account exactly as createAccount does for a wallet, the wallet as the Kernel account's ECDSA root on the Sleeve salt, and reads its install state. Nothing deployed there is NotFound, and the screen offers Set up your account. An account Sleeve is off for signs in, as a passkey's does since D-040. A passkey that finds no account says so and points to wallet sign in.
- No signature at sign in. A session holds only public data, the account and the owner's address, and every owner op asks the wallet to sign again. A signature at sign in would prove nothing the next owner op does not prove, and it would cost a wallet prompt. Session.wallet says whether this tab holds a signer for the owner. A session read back from storage holds none, so the first action that signs asks to connect the wallet, and attachWallet takes it only when its address is the owner's, refusing any other as WrongWallet with the owner named. The data layer looks the signer up when an op is signed, so a Kernel account built for a preview before the wallet came back signs once it is attached.
- First paint stays as D-022 set it. No product page imports wagmi, RainbowKit or the Reown SDK. The app shell mounts a small wallet layer that loads the wallet island with import() on the first "Sign in with a wallet" or "Connect your wallet", and mounts it beside the page, so nothing on the page remounts. The island is onboarding's WalletProviders with a bridge that hands back a connect function and a signer. app/src/components/wallet/first-paint.test.ts walks the static imports from the root layout and every product route except onboarding and fails on any wallet package. It also checks that the island and onboarding do reach wagmi, so the walk would see one.
- Dialogs step aside. RainbowKit draws its connect modal in the page body, under any dialog in the browser's top layer, where nobody can use it. The action dialog and the card composer close right before the modal opens and come back once connecting settles, and the top bar's panel closes before the wallet path starts. With previews off, a press that would run at once still opens the dialog when the wallet must connect first.
- Wallet failures. A declined request, another account selected or another network in the wallet get their own line on the screens that sign, ahead of the screen's own words.
- Gaps closed with this. A send from an account without the module is read from the transaction's own USDG Transfer log from the account to the destination, for exactly the amount, in place of D-040's balance delta, which read short when USDG landed in the same block. The balances stay, for display. A send over the balance previews as InsufficientBalance on chain as on the mock, in USDG words, and ExceedsBalance is left to Stock Token sales. While Sleeve is off, the rail's rule card and a payment notification say so and lead Home, in place of "No rule yet" and "until your rule splits it".
- Not yet checked in a browser: the RainbowKit modal with a real wallet on these pages. Unit tests cover the connect flow, the dialogs stepping aside and both data layers.

Tests: app/src/data/chain/wallet-session.test.ts and remove.test.ts (the chain layer on the shared fake chain in data/chain/__tests__), app/src/data/mock/wallet-session.test.ts, app/src/components/wallet/connect-flow.test.ts and first-paint.test.ts, app/src/components/actions/action-dialog.test.tsx, app/src/components/sleeve/sign-in-text.test.ts, and the Home, Send, app shell and signed-out screen tests.
