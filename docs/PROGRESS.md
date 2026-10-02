# Progress

Read this first in every session and continue from the last completed step.

## Current phase

B (G6 spike) and C components 1 and 2 running. Deadline: Sunday 4 October 2026, 16:59 Lagos. V0 checkpoint: Saturday 3 October, 17:00 Lagos.

## Done

| Step | Result | Evidence |
| --- | --- | --- |
| A. Setup | Contract renamed and amended, root CLAUDE.md, git, .gitignore, secret scan with pre-push hook | docs/DECISIONS.md D-001 to D-008 |
| A. Keys | DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1, KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, TEST_PAYER 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC. Keys in ~/.sleeve-keys, mode 600 | addresses only |
| A. Funding plan | 0.0025, 0.0030 and 0.0003 ETH plus 60 USDG at 0.0316 gwei | docs/FUNDING.md |
| A. Batch 1 | Posted 2 October 15:50 Lagos | open inputs below |
| Research sweep | 18 addresses confirmed, pools picked (D-010), disclosure captured, passkey stack verified on 4663, 48 PRD gaps sorted | docs/research/, docs/disclosure/ |
| Batch 2 | 22 owner decisions posted 17:10 Lagos with recommended defaults; 26 engineering decisions logged | D-009 to D-013, docs/SPEC.md draft 2 |
| C1. LedgerMath | Accepted by adversarial review. 60 tests, 13 fuzz tests at 10,000 runs (I2, I5, I9, outflow order, reconcile). Slither: one informational pragma note | commit c74d7e0 |

## Open inputs

- Batch 1: funding, ZeroDev, Alchemy, Supabase, Vercel scope, GitHub repo, production domain, closeout folder path. VPS answered: GreenCloud 172.93.185.150.
- Batch 2: owner decisions 1 to 22 (docs/research/prd-questions.md). Items 1 to 9 gate PriceGuard constants and the module.

## Next step

G6 review and SessionCalendar acceptance, then component 3: PriceGuard with TokenSource.
