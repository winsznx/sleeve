# Sleeve web app

The app at [trysleeve.xyz](https://trysleeve.xyz): the landing page, passkey onboarding, and the screens an owner uses to set a rule, watch payments split, hold Stock Tokens, sell back and check receipts. Next.js 15 with React 19, deployed as a Cloudflare Worker through OpenNext ([D-033](../docs/DECISIONS.md)).

## Screens

| Route | What it does |
| --- | --- |
| `/` | Landing: the payday split, how a payment moves, the launch Stock Tokens, proof, eligibility, questions with the issuer's disclosure |
| `/onboard` | Eligibility check (residency attestation and the request's country), passkey creation, account deployment with the Sleeve module installed, the first rule |
| `/home` | Overview: both sleeves, the rule's split, what is waiting and why, recent payments |
| `/payments`, `/inbox` | Every inbound payment and what it became |
| `/holdings` | Stock Tokens held, by lot, each marked debt security, not a share |
| `/rule` | The rule editor: share to buy, ticker, premium cap, slippage, minimum buy |
| `/sell` | Sell-back with a preview, the guard's verdict and the off-hours override |
| `/send` | Send USDG out of the account |
| `/receipts`, `/history` | Every receipt, with the fields the verifier checks |
| `/notifications`, `/settings`, `/help` | Alerts, theme and account settings, answers |
| `/verify` | The public verifier: recompute any receipt from chain data |
| `/waitlist` | Join the waitlist: an email and how you are paid today ([D-038](../docs/DECISIONS.md)) |
| `/card/[id]` | A share card for a buy or a week, amounts and address hidden by default |
| `/api/index`, `/api/cards`, `/api/card`, `/api/passkeys`, `/api/eligibility`, `/api/waitlist` | The keeper's Supabase index, share cards and their images, passkey credential records, the eligibility gate, the waitlist |

## Data sources

Screens read through one data layer with two implementations, chosen by `NEXT_PUBLIC_SLEEVE_DATA_SOURCE`:

- `mock`: an in-memory sample account; every screen is labelled as sample data. The default for local runs.
- `chain`: Robinhood Chain mainnet. Reads go through `NEXT_PUBLIC_ROBINHOOD_RPC_URL` with log reads on the public RPC ([D-035](../docs/DECISIONS.md)), owner actions are passkey-signed UserOps through ZeroDev, and indexed history comes from Supabase. Production always builds with `chain`.

## Run locally

From the repository root:

```bash
pnpm install
cp .env.example .env.local          # every variable is explained there
ln -s ../.env.local app/.env.local  # the app reads the root file through this link
pnpm --filter @sleeve/app dev       # http://localhost:3000
```

A local passkey needs `NEXT_PUBLIC_PASSKEY_RP_ID=localhost` and the site at http://localhost:3000.

## Scripts

| Script | What it does |
| --- | --- |
| `dev`, `build`, `start` | Next.js |
| `typecheck`, `lint`, `test` | TypeScript, ESLint and 999 Vitest tests. The copy lint over UI strings runs from the repository root (`pnpm lint`) |
| `test:fork` | Owner UserOps through the data layer against a fork of chain 4663 (`test/fork/`) |
| `embed-assets` | Regenerates `src/generated/` (fonts, token logos, design tokens, the disclosure) for server code, since a Worker has no file system |
| `brand:install` | Installs the brand kit's logo, icons and manifest ([D-037](../docs/DECISIONS.md)) |
| `cf:build`, `cf:preview`, `cf:deploy` | Build the Worker with OpenNext, serve it locally in workerd, or deploy it to trysleeve.xyz |

`cf:deploy` (`scripts/cloudflare.mjs`) checks the production environment, builds with every non-public value blanked, empties the env module OpenNext would copy into the Worker, scans the whole output for each secret value before uploading, and stores the one server secret as a Cloudflare secret. Never deploy with a bare `wrangler deploy`.
