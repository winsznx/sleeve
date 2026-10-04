# Research notes

The files in this folder are research notes written on 2 and 3 October 2026, while Sleeve was being planned and built and before the mainnet deploy. They are kept as dated records, so a figure, block number or open question in them describes the day it was written. For the current state, read [README.md](../../README.md), [docs/DEPLOYMENTS.md](../DEPLOYMENTS.md), [docs/DECISIONS.md](../DECISIONS.md) and [docs/GATES.md](../GATES.md).

| File | What it is |
| --- | --- |
| [chain-constants.md](chain-constants.md) | Chain constants fork check for the PriceGuard component and gates G4 and G7: all 18 addresses in contracts/test/utils/Chain4663.sol have code and behave as named. Written 2 October 2026. |
| [g6-notes.md](g6-notes.md) | Kernel v3.1 on Robinhood Chain: the recipe SleeveModule, the keeper and the app need from the G6 spike, run on 2 October 2026 on a fork at block 78,312,136. |
| [gates-checks.md](gates-checks.md) | Raw evidence behind docs/GATES.md for gates G1, G2, G3, G4, G5, G7 and G8, every call read only, 3 October 2026. |
| [issuer-docs.md](issuer-docs.md) | The issuer's docs on jurisdictions, canonical tokens, brand rules and copy facts, read on 2 October 2026. |
| [pools.md](pools.md) | Gate G5: the Uniswap v3 USDG pools for SPY, QQQ, NVDA and AAPL and a recommended allowlist, read only at block 78,323,256 on 2 October 2026. |
| [prd-questions.md](prd-questions.md) | Every gap, ambiguity and conflict found in a full read of the PRD and the build contract that had to be settled to ship M0, each with a recommended default. Written 2 October 2026. |
| [session-calendar.md](session-calendar.md) | Session calendar rules for 2026 and 2027 for the SessionCalendar library: when the market reference behind each launch ticker is live. Sources read 2 October 2026. |
| [wallet-connect.md](wallet-connect.md) | RainbowKit, WalletConnect and ZeroDev on Robinhood Chain for D-022: versions, the chain definition, the modal's palette, and how a connected wallet becomes the owner of a Sleeve account or the recovery signer of a passkey account. Written 3 October 2026. |
| [zerodev-passkey.md](zerodev-passkey.md) | ZeroDev passkey login on Robinhood Chain for D-003. Written 2 October 2026. Nothing was deployed or sent. |
| [assets-api/all-assets.json](assets-api/all-assets.json) | The raw issuer API records session-calendar.md cites: the full `assets` list as the API returned it. |
| [assets-api/SPY.json](assets-api/SPY.json), [QQQ.json](assets-api/QQQ.json), [NVDA.json](assets-api/NVDA.json), [AAPL.json](assets-api/AAPL.json) | The same API's record for each launch ticker, one file each, starting with its id, symbol, name and deployments. |
| [runs/calendar_research.json](runs/calendar_research.json) | The calendar research as data: the weekly window, daylight-saving switches, holidays, early closes and each ticker's session type. |
| [runs/g6_spike.json](runs/g6_spike.json) | The G6 spike's saved result: a status, test and detail per item, the pinned block, the Kernel tag and the bytecode match. |
