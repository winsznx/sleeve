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
