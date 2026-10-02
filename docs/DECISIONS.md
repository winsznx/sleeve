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
