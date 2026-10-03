# Contributions

Sleeve is a payment address on Robinhood Chain (chain id 4663). USDG that arrives is split by the owner's rule: part stays USDG, and part buys Stock Tokens into the owner's own smart account. Building it meant checking Robinhood Chain's developer docs, the issuer's pages, Chainlink's feed docs, the ZeroDev SDK and the ERC-8056 draft against what the chain actually returns. This file describes the library in this repo that other builders can reuse and lists every mismatch we found, each written as an issue that can be filed as it stands.

None of the issues has been filed yet. Each one names its target and filing channel, quotes the text that is wrong, and shows the command that demonstrates it with the result we got. The research behind them is in docs/research/, written on 2 and 3 October 2026. Each claim was checked again between 00:17 and 01:16 UTC on 3 October 2026, at repo commit e27701b, unless the item says the figure comes from a research note. An accuracy review between 08:20 and 08:45 UTC the same day ran a sample of the commands again (R1 to R9, E1, C1 to C3, Z1, Z2, Z4, Z5, P1, M1, O1 and the PriceGuard tests) and checked every quotation from a web page or a spec in R1 to R10, E1, C3, Z2, Z3 and M1, and the Report an issue line, against its source. All of them matched. The only change is that the price deviations API now reports asOf 2 October with the same two rows, so its hash in the last section no longer matches a fresh fetch. Every check was read only. No transaction was signed or sent.

How the checks were run. Latest state and logs came from the public RPC https://rpc.mainnet.chain.robinhood.com, one request at a time with pauses and one address and one topic per eth_getLogs call. Historical state came from the archive RPC https://robinhood.drpc.org. In the commands below, `RPC` is the public RPC and `A` is the archive RPC. Pages and APIs were fetched with curl, and the last section lists the hashes of the main downloads. Quotes are copied from the source. Where a source sentence contains a long dash, the quote stops before it. A rerun reads later blocks, so counts and ages can move.

Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.

## Index

| ID | Target | Issue | Status |
| --- | --- | --- | --- |
| PG | This repo | PriceGuard, a guard and premium library for Stock Token buys | In this repo under MIT, public when the repo is |
| R1 | Robinhood Chain docs | Stock Token APIs page documents a tradingCapabilities shape the API does not return | Drafted, not filed |
| R2 | Robinhood Chain docs | Oracles page recommends a sequencer uptime feed that does not exist for Robinhood Chain | Drafted, not filed |
| R3 | Robinhood Chain docs | "Every Stock Token has a live Chainlink price feed", but Chainlink lists 36 of 194 | Drafted, not filed |
| R4 | Robinhood Chain docs | Token Contracts table is called onchain but comes from api.robinhood.com | Drafted, not filed |
| R5 | Issuer pages | Price deviations table drops the sign and the direction | Drafted, not filed |
| R6 | Robinhood Chain docs | Account Abstraction example imports robinhoodMainnet, which viem does not export | Drafted, not filed |
| R7 | Robinhood Chain docs | TransferWithScaledUI shown as part of "the core ERC-8056 interface" | Drafted, not filed |
| R8 | Robinhood Chain docs | oraclePaused() described as the corporate-action signal, never set on the launch tokens | Drafted, not filed |
| R9 | Robinhood Chain docs | A heartbeat staleness check accepts Friday's price on Saturday | Drafted, not filed |
| R10 | Robinhood Chain docs | Public RPC limits are not stated | Drafted, not filed |
| E1 | ERC-8056 draft | Deployed Stock Tokens differ from the draft in three places | Drafted, not filed |
| C1 | Chainlink docs | First rounds of the four launch feeds are about 1e8 times too large | Drafted, not filed |
| C2 | Chainlink | Feed descriptions use two formats | Drafted, not filed |
| C3 | Chainlink docs | "Eastern Standard Time" label, and no early-close behavior for the 24/5 feeds | Drafted, not filed |
| Z1 | ZeroDev SDK | isRIP7212SupportedNetwork(4663) is false while P256VERIFY is live | Drafted, not filed |
| Z2 | ZeroDev | Kernel meta factory has no EntryPoint stake on Robinhood Chain | Drafted, not filed |
| Z3 | ZeroDev docs | P-256 gas figure, "automatically", and the precompile chain list | Drafted, not filed |
| Z4 | ZeroDev SDK | CommonJS build requires tslib without declaring it | Drafted, not filed |
| Z5 | ZeroDev Kernel | Build of each deployed contract and per-chain availability are not documented | Drafted, not filed |
| P1 | Paxos, USDG | Permit and EIP-3009 facet has no verified source | Drafted, not filed |
| M1 | Morpho Blue market creator | Two market oracles apply the multiplier on top of the feed price | Drafted, not filed |
| O1 | Our own planning docs | G5 cited a pool that is not an NVDA pool | Corrected in D-010 |

## PG. What Sleeve ships: PriceGuard (MIT)

| Field | Value |
| --- | --- |
| Status | In this repo under the MIT license (LICENSE at the root). It becomes public with the repository, which is not public yet (docs/CLAIM_LEDGER.md row 5.10) |
| Code | contracts/src/libraries/PriceGuard.sol |
| Vectors | contracts/test/fixtures/premium_vectors.json, written by scripts/premium_vectors.py |

PriceGuard is a Solidity library for contracts that buy Stock Tokens on Robinhood Chain with USDG. Before a buy it checks the token, the market session as the caller reports it, and both Chainlink feeds. After the swap it decides, with exact integer arithmetic, whether the fill paid more than a cap above the Chainlink reference. The checks read live state on every call. The library keeps no storage and emits no events. Every function is internal, so it compiles into the calling contract.

#### Files

Each file starts with `// SPDX-License-Identifier: MIT`.

| File | What it holds |
| --- | --- |
| contracts/src/libraries/PriceGuard.sol | The checks and the premium arithmetic |
| contracts/src/interfaces/IStockToken.sol | The Stock Token views it reads: paused, oraclePaused, uiMultiplier, newUIMultiplier, effectiveAt, ACCESS_CONTROLLED_REGISTRY, decimals |
| contracts/src/interfaces/IAccessControlsRegistry.sol | The registry's isBlocked |
| contracts/src/interfaces/IAggregatorV3.sol | The Chainlink proxy views |
| contracts/src/types/SleeveTypes.sol | GuardParams and Reason |

The only outside dependency is OpenZeppelin's Math library (v5.4.0, vendored at contracts/lib/openzeppelin-contracts).

#### What it checks

checkBuy runs these steps in order and stops at the first failure.

1. Blocklist. It reads the registry from token.ACCESS_CONTROLLED_REGISTRY() on every call, so it follows the issuer's live state. A blocked account comes back as accountBlocked. A blocked pool reverts PoolBlocked(pool), because the token refuses transfers out of a blocked pool and the swap would revert anyway (docs/DECISIONS.md D-011 and D-018).
2. Pauses. token.paused(), which already includes the registry's global pause, gives PAUSED. token.oraclePaused() gives ORACLE_PAUSED.
3. Session. The caller says whether the market session is open and when it opened. A closed session gives SESSION.
4. Multiplier. MULTIPLIER while a different multiplier is scheduled to take effect within the window, 24 hours by default.
5. Stock feed. STALE when the answer is not positive, updatedAt is in the future, the round is older than the maximum age (25 hours by default), or the round is older than the current session's opening instant. The last rule refuses a price held over a weekend or holiday until the first new round lands.
6. USDG/USD feed. DEPEG when the answer is outside 1 plus or minus the tolerance (50 bps by default), not positive, in the future, or older than 25 hours.

After the swap, exceedsPremium(usdgSpent, tokensOut, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals) compares two full 512-bit products, so rounding never decides a fill. exceedsDiscount does the same for sells. premiumBps, discountBps, execPriceBuy and execPriceSell give receipt figures rounded against the owner, and `premiumBps > capBps` holds exactly when exceedsPremium is true. Malformed input reverts with a named error: a zero address, decimals other than 18 for a token or 8 for a feed, a tolerance or cap above 10,000 bps, or a non-positive answer in the premium arithmetic.

#### Limits

- It requires 18-decimal tokens and 8-decimal feeds and reverts UnexpectedDecimals otherwise.
- It does not know market hours. Sleeve passes sessionOpen and sessionOpenedAt from contracts/src/libraries/SessionCalendar.sol, also MIT, which holds the 24/5 window, NYSE holidays and early closes for 2026 and 2027.
- The blocklist and pause reads follow the Stock Token contracts on Robinhood Chain. Another ERC-8056 token needs its own versions of those two reads.
- The defaults are Sleeve's choices (docs/DECISIONS.md D-014). Callers pass their own GuardParams.

#### Evidence

The vector file holds 1,890 decision vectors and 365 receipt vectors. scripts/premium_vectors.py writes it from Python integers and fractions, and its docstring says it "shares no code and no derived constant with the Solidity". contracts/test/unit/PriceGuardVectors.t.sol replays every vector against the library, and the HP2 replay engine's tests read the same file (scripts/hp2/tests/test_engine_premium.py).

```
$ python3 scripts/premium_vectors.py --check
fixture is current
```

To check that the library stands on its own, the five files above, the three PriceGuard unit test files and the mocks they import were copied from commit e27701b into an empty Foundry project that has only forge-std and OpenZeppelin. PriceGuard.t.sol also imports SessionCalendar.sol and four Uniswap and quoter interfaces for its selector tests, so those came along. forge 1.7.1, solc 0.8.28, timings trimmed from the output:

```
$ forge test
Ran 1 test for test/unit/PriceGuard.t.sol:InterfaceSelectorsTest
Suite result: ok. 1 passed; 0 failed; 0 skipped
Ran 1 test for test/unit/PriceGuard.t.sol:SleeveTypesTest
Suite result: ok. 1 passed; 0 failed; 0 skipped
Ran 56 tests for test/unit/PriceGuard.t.sol:PriceGuardTest
Suite result: ok. 56 passed; 0 failed; 0 skipped
Ran 48 tests for test/unit/PriceGuardPremium.t.sol:PriceGuardPremiumTest
Suite result: ok. 48 passed; 0 failed; 0 skipped
Ran 3 tests for test/unit/PriceGuardVectors.t.sol:PriceGuardVectorsTest
Suite result: ok. 3 passed; 0 failed; 0 skipped
Ran 5 test suites: 109 tests passed, 0 failed, 0 skipped (109 total tests)
```

The fork tests in contracts/test/fork/PriceGuard.t.sol (10 tests) run against the real SPY, QQQ, NVDA and AAPL tokens and feeds, the real registry and the real USDG/USD feed at blocks 78,312,136 and 73,280,794. docs/PROGRESS.md records them as accepted (component 3, commits e2d2df3 and 198a12a). They were not rerun for this file, to keep load off the archive RPC. To rerun them:

```
cd contracts
FORK_RPC=https://robinhood.drpc.org forge test --match-path test/fork/PriceGuard.t.sol
```

On replayed chain data. The HP2 replay applies the same checks and defaults to 1,000 sampled payments, except the blocklist, which the protocol leaves out (docs/HP2_PROTOCOL.md, and docs/HP2_RESULTS.md "Readings of the protocol", item 7). Its provisional result, in the wording D-020 fixes: the guard refused a real extreme mispricing that buying at arrival would have paid, and in ordinary conditions it cost about 1.7 bps per payment to wait for the reference. SPY's fee-500 pool received its first liquidity at about twice the reference price, buying at arrival paid about 9,905 bps over the reference on 31 payments, and the guarded policy waited and paid about -20 bps. On the 934 payments whose arrival fill was within the 100 bps cap, waiting cost 1.66 bps per payment on average, counting the payments that did not wait. Sleeve does not claim the guard lowers the price of a typical buy. The result stays provisional until the rerun on a second provider.

#### Use

This contract compiled in the same scratch project with solc 0.8.28.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";
import {PriceGuard} from "../libraries/PriceGuard.sol";
import {Reason} from "../types/SleeveTypes.sol";

contract GuardedBuyExample {
    function canBuy(
        IStockToken token,
        IAggregatorV3 feed,
        IAggregatorV3 usdgUsdFeed,
        address account,
        address pool,
        bool sessionOpen,
        uint256 sessionOpenedAt
    ) external view returns (bool ok, Reason reason, int256 answer) {
        PriceGuard.BuyCheck memory check = PriceGuard.checkBuy(
            token, feed, usdgUsdFeed, account, pool, sessionOpen, sessionOpenedAt, PriceGuard.defaultGuardParams()
        );
        return (!check.accountBlocked && check.reason == Reason.NONE, check.reason, check.answer);
    }

    function fillTooExpensive(
        IERC20Metadata usdg,
        IStockToken token,
        IAggregatorV3 feed,
        uint256 usdgSpent,
        uint256 tokensOut,
        int256 answer,
        uint16 capBps
    ) external view returns (bool) {
        return PriceGuard.exceedsPremium(
            usdgSpent, tokensOut, answer, capBps, usdg.decimals(), token.decimals(), feed.decimals()
        );
    }
}
```

## Robinhood Chain docs and the issuer's pages

Robinhood's Report an issue page (https://docs.robinhood.com/chain/report-issue) says "To report technical issues, please contact us here", and the link is chain-developers-group@robinhood.com. That is the filing channel for R1 to R10. The issuer's pages under docs.robinhood.com/rhj are on the same site.

### R1. Stock Token APIs page documents a tradingCapabilities shape the assets API does not return, and allDayTradability is never present

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/stock-token-apis, section "/assets": the schema table, the "tradingCapabilities" and "allDayTradability" tables and the example response. Related: https://docs.robinhood.com/chain/stock-tokens, section "Per-Asset Trading Capabilities" |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The Stock Token APIs page describes tradingCapabilities as an object with three fields: fractionalTradability, allDayTradability and extendedHoursFractionalTradability. Its row for allDayTradability has type "string | null" and the note "RH all-day / overnight (24/5) trading flag for the underlier." The listed values are tradable ("Underlier is enabled for all-day / 24-5 trading."), untradable, position_closing_only, an empty string, and null ("Source has not set this field on the underlier."). Its example response shows APLD as:

```json
"tradingCapabilities": {
  "fractionalTradability": "tradable",
  "allDayTradability": "untradable",
  "extendedHoursFractionalTradability": false
}
```

The Stock Tokens page documents a different shape:

```json
"tradingCapabilities": {
  "market":    { "whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE" },
  "extended":  { "whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE" },
  "overnight": { "whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE" }
}
```

The API returns the second shape for all 194 assets. No asset has allDayTradability. For APLD, which the APIs page shows as all-day "untradable", the API returns overnight.whole "TRADING_STATUS_TRADABLE".

Two smaller gaps sit in the same schema table. The API returns isin and tokenDecimals, which the table does not list. The table describes id as "`0x` + 66-char lowercase hex", while every id is 66 characters including the `0x`.

#### Evidence

Fetched 3 October 2026, 00:22:52 UTC. The response is byte-identical to the copy saved on 2 October in docs/research/assets-api/all-assets.json, so the same commands run on that file.

```
$ curl -s https://api.robinhood.com/rhj/assets -o assets.json
$ shasum -a 256 assets.json
3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c  assets.json
$ jq '.assets | length' assets.json
194
$ jq '[.assets[] | select(.tradingCapabilities.allDayTradability != null)] | length' assets.json
0
$ jq '[.assets[] | select(.tradingCapabilities.overnight.whole == "TRADING_STATUS_TRADABLE")] | length' assets.json
194
$ jq -c '.assets[] | select(.tokenSymbol == "APLD") | .tradingCapabilities' assets.json
{"market":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"},"extended":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"},"overnight":{"whole":"TRADING_STATUS_TRADABLE","fractional":"TRADING_STATUS_TRADABLE"}}
$ jq -c '[.assets[] | .tradingCapabilities | .. | strings] | unique' assets.json
["TRADING_STATUS_TRADABLE","TRADING_STATUS_UNTRADABLE"]
$ jq -c '.assets[0] | keys' assets.json
["currentMultiplier","deployments","id","isin","logoUrl","pendingMultiplier","status","tokenDecimals","tokenName","tokenSymbol","tradingCapabilities"]
$ jq -c '[.assets[].id | length] | unique' assets.json
[66]
```

#### Why it matters to integrators

The Stock Tokens page tells developers to "check this field before executing trades to handle assets that are not tradable in a given session." A developer who codes to the APIs page reads tradingCapabilities.allDayTradability, finds it missing on every asset, and by the page's own definition of null has no answer for any of them. Depending on the default chosen, the app blocks 24/5 trading for all 194 Stock Tokens or skips the check. Our own planning document named allDayTradability as the source of each ticker's session type, and we had to switch to tradingCapabilities.overnight.whole (docs/research/session-calendar.md, Q1).

#### Suggested fix

Make the APIs page match the response: market, extended and overnight, each with whole and fractional, with the values TRADING_STATUS_TRADABLE and TRADING_STATUS_UNTRADABLE. Say which slot means 24/5 tradability. If allDayTradability is planned, mark it as not yet returned. Add isin and tokenDecimals to the schema table, and describe id as `0x` followed by 64 hex characters.

### R2. Oracles page tells integrators to check a Chainlink sequencer uptime feed that does not exist for Robinhood Chain

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/oracles-and-price-feeds, section "Checking sequencer uptime (recommended on L2)" and the "Check sequencer uptime" item under "Best practices" |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page says:

> Because Robinhood Chain is a Layer-2, verify the sequencer is up before trusting a price

> Chainlink provides an L2 Sequencer Uptime Feed for this; check it before reading any price

A snippet follows that reads `sequencerUptimeFeed.latestRoundData()` and requires `sequencerStatus == 0`. The page gives no address for `sequencerUptimeFeed`.

Chainlink's L2 sequencer page (https://docs.chain.link/data-feeds/l2-sequencer-feeds) says:

> Chainlink is no longer expanding L2 Sequencer Uptime Feeds to additional networks. Existing feeds on the supported networks listed below will continue to operate and be supported.

Robinhood Chain is not among the networks it lists, and Chainlink's feed directory for Robinhood Chain Mainnet has no uptime feed.

#### Evidence

Fetched 3 October 2026, 00:21:55 and 00:21:57 UTC. The directory URL is the `rddUrl` Chainlink's docs repo gives for "Robinhood Chain Mainnet" in src/features/data/chains.ts (docs/research/chain-constants.md, appendix A.10). The grep finds the notice and no line containing the string "robinhood".

```
$ curl -s https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/content/data-feeds/l2-sequencer-feeds.mdx \
    | grep -n -i "no longer expanding\|robinhood"
11:  Chainlink is no longer expanding L2 Sequencer Uptime Feeds to additional networks. Existing feeds on the supported
$ curl -s https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json \
    | jq 'length, ([.[] | select(.name | ascii_downcase | test("uptime|sequencer"))] | length)'
58
0
```

#### Why it matters to integrators

The snippet cannot be used as written, because there is no address to put in `sequencerUptimeFeed`. A team that follows the page can point the variable at some other contract, drop the check without saying so, or block reads. In the first two cases the contract looks protected against sequencer downtime and is not.

#### Suggested fix

Say that Chainlink publishes no sequencer uptime feed for Robinhood Chain, and remove the snippet and the best-practice item or mark them as not applicable here. Keep the feed age check and add the market-session check in R9. If Robinhood Chain later gets a sequencer status signal, publish its address on this page.

### R3. "Every Stock Token has a live Chainlink price feed", but Chainlink lists feeds for 36 of the 194 Stock Tokens

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/stock-tokens ("Why build with stock tokens" and "How Stock Tokens work"), https://docs.robinhood.com/chain/building-with-stock-tokens ("Prices"), https://docs.robinhood.com/chain/oracles-and-price-feeds ("Token price feeds") |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The Stock Tokens page says "every Stock Token has a live Chainlink price feed, so your contracts can read prices directly onchain." and "Prices are published onchain via per-asset Chainlink data feeds." Building with Stock Tokens says "Every stock token has a per-asset Chainlink price feed implementing the standard `AggregatorV3Interface`". The oracles page says "Each Stock Token on Robinhood Chain has its own Chainlink price feed."

The issuer's assets API lists 194 Stock Tokens. Chainlink's feed directory for Robinhood Chain Mainnet has feeds for 36 of them: 35 on "us_equities_24/5" hours, and GLD / USD, which the directory marks as a "dex_state_price" on "Crypto" hours. The other 158 have no Chainlink feed, among them AVGO, COST, ADBE, CRM and NFLX.

#### Evidence

Same assets download as R1 (sha256 3e378f9c...e78c). Directory fetched 3 October 2026, sha256 714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776, unchanged since 2 October (docs/research/gates-checks.md, section 4).

```
$ curl -s https://api.robinhood.com/rhj/assets -o assets.json
$ curl -s https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json -o feeds.json
$ python3 - <<'EOF'
import json, re
assets = {a["tokenSymbol"] for a in json.load(open("assets.json"))["assets"]}
fed = set()
for f in json.load(open("feeds.json")):
    m = re.fullmatch(r"(?:Robinhood )?(\S+?)(?: / |-)USD", f["name"])
    if m and m.group(1) in assets:
        fed.add(m.group(1))
print(len(assets), len(fed), sorted(assets - fed)[:5])
EOF
194 36 ['AAOI', 'ABCL', 'ADBE', 'AEHR', 'AEIS']
$ jq '[.[] | select(.docs.marketHours == "us_equities_24/5")] | length' feeds.json
35
$ jq -r '.[] | select(.name == "GLD / USD") | [.name, .docs.marketHours, .docs.attributeType] | @tsv' feeds.json
GLD / USD	Crypto	dex_state_price
```

#### Why it matters to integrators

A lending market, index product or guard built on the docs' promise will meet Stock Tokens with no reference price. GLD's feed is a DEX-state price, which can move with the same pools a buyer trades in, so a premium check against it does not tie the price to the underlying market (docs/research/session-calendar.md, Q2). Sleeve does not offer a ticker without a Chainlink feed as a rule target (docs/DECISIONS.md D-017).

#### Suggested fix

Say that Chainlink publishes feeds for a subset of Stock Tokens, and point to Chainlink's feed list for Robinhood Chain as the place to check. The oracles page already calls that list the place to read from: "it's the source of truth, so always read addresses and parameters from there rather than hardcoding them". A feed column in the Token Contracts table would help. Say also that a DEX-state feed such as GLD / USD is a different kind of price from the 24/5 feeds.

### R4. Token Contracts page says its table is "generated live from the on-chain asset registry", but the table is fetched from api.robinhood.com

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/contracts, the Stock Token table and the sentence above it |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page says:

> The table below is generated live from the on-chain asset registry.

The code that draws the table fetches an HTTP API, `const b="https://api.robinhood.com/rhj/assets"`, and no registry contract address appears on the page or in its code. The page also says "Use the addresses on this page to identify the canonical Robinhood Stock Token for each underlying", so the list readers are told to trust is an HTTP response.

#### Evidence

Fetched 3 October 2026 between 00:21:07 and 00:24:31 UTC. Hashed chunk names change when the site is rebuilt. On 2 October the same code sat in chunk index-C7gDoMED.js (docs/research/issuer-docs.md, section 1).

```
$ curl -sL https://docs.robinhood.com/chain/contracts | grep -o 'generated live from the on-chain asset registry'
generated live from the on-chain asset registry
$ curl -sL https://docs.robinhood.com/chain/contracts | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | sort -u
assets/index-BQ4e_aJN.js
$ B=https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets
$ curl -s $B/index-BQ4e_aJN.js | grep -o 'import("./index-[A-Za-z0-9_-]*\.js"),\[\],import.meta.url),path:"/chain/contracts"'
import("./index-DhgXFtCP.js"),[],import.meta.url),path:"/chain/contracts"
$ curl -s $B/index-DhgXFtCP.js | grep -o 'const b="https://api.robinhood.com/rhj/assets"'
const b="https://api.robinhood.com/rhj/assets"
$ curl -s $B/index-DhgXFtCP.js | grep -o '0x[0-9a-fA-F]\{40\}' | sort -u
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

The two addresses are WETH and USDG. The only onchain "registry" the Stock Tokens point to is the AccessControlsRegistry at 0xe10b6f6B275de231345c20D14Ab812db62151b00, which holds roles, a global pause and a blocklist, not a list of assets (docs/research/chain-constants.md, section 3).

#### Why it matters to integrators

"On-chain asset registry" tells an integrator there is a contract to read when checking that a token is canonical, without trusting a web API. Teams that want an onchain allowlist look for it and find none. Sleeve's gate G3 stayed PARTIAL for this reason, and Sleeve ships a timelocked mirror of the list instead (TokenSource in docs/SPEC.md section 3, and docs/GATES.md G3).

#### Suggested fix

Publish the onchain asset registry's address and read functions, or change the sentence to say the table comes from https://api.robinhood.com/rhj/assets. In the second case, say that each token's uid() equals the API's id, which gives readers an onchain cross-check. That holds for SPY, QQQ, NVDA and AAPL (docs/research/issuer-docs.md, section 3).

### R5. Price deviations page drops the sign and the direction: it looks up PREMIUM and DISCOUNT while the API returns DEVIATION_DIRECTION_PREMIUM and DEVIATION_DIRECTION_DISCOUNT

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/rhj/price-deviations, the table filled from https://api.robinhood.com/rhj/price-deviations |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page's code maps the direction with these two lookups:

```js
const t={DISCOUNT:"-",PREMIUM:"+"}
const n={DISCOUNT:"Discount",PAR:"At par",PREMIUM:"Premium"}
```

It keeps the API's value as it comes, `direction:(i=s(e,"direction"))`, and the API returns `DEVIATION_DIRECTION_PREMIUM` and `DEVIATION_DIRECTION_DISCOUNT`. Neither lookup has those keys, so the Deviation column shows no sign and the Direction column shows the placeholder character U+2014. The corporate actions page strips its own enum prefix before the lookup, `e.replace(/^CORPORATE_ACTION_(?:TYPE|STATUS)_/,"")`, and does not have this problem.

#### Evidence

Fetched 3 October 2026 between 00:24:34 and 00:25:44 UTC. The same keys were in the chunk shipped on 2 October (docs/research/issuer-docs.md, section 5).

```
$ curl -sL https://docs.robinhood.com/rhj/price-deviations | grep -o 'assets/index-[A-Za-z0-9_-]*\.js' | sort -u
assets/index-BQ4e_aJN.js
$ B=https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets
$ curl -s $B/index-BQ4e_aJN.js | grep -o 'import("./index-[A-Za-z0-9_-]*\.js"),\[\],import.meta.url),path:"/rhj/price-deviations"'
import("./index-BmzZmhum.js"),[],import.meta.url),path:"/rhj/price-deviations"
$ curl -s $B/index-BmzZmhum.js -o index-BmzZmhum.js
$ grep -o 'const t={DISCOUNT:"-",PREMIUM:"+"}\|const n={DISCOUNT:"Discount",PAR:"At par",PREMIUM:"Premium"}\|direction:(i=s(e,"direction"))' index-BmzZmhum.js
const t={DISCOUNT:"-",PREMIUM:"+"}
const n={DISCOUNT:"Discount",PAR:"At par",PREMIUM:"Premium"}
direction:(i=s(e,"direction"))
$ curl -s https://api.robinhood.com/rhj/price-deviations -o deviations.json
$ jq -r '.rows[] | [.tokenSymbol, .direction, .deviationPct] | @tsv' deviations.json
SATS	DEVIATION_DIRECTION_PREMIUM	1532.7364786152502
WEEK	DEVIATION_DIRECTION_DISCOUNT	50.10770046736115
```

Running the page's own two cell formatters, cut from the shipped chunk, on those rows:

```
$ cat render_check.cjs
const fs = require('fs');
const src = fs.readFileSync('index-BmzZmhum.js', 'utf8');
const code = src.slice(src.indexOf('function _(e,n){'), src.indexOf('const u=[', src.indexOf('function P(e){')));
const {_, P} = new Function(code + '; return {_, P};')();
const show = (s) => JSON.stringify(s).replace(/[^\x00-\x7f]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
for (const r of JSON.parse(fs.readFileSync('deviations.json', 'utf8')).rows)
  console.log(r.tokenSymbol, show(_(r.deviationPct, r.direction)), show(P(r.direction)));
$ node render_check.cjs
SATS "1532.7364786152502%" "\u2014"
WEEK "50.10770046736115%" "\u2014"
```

#### Why it matters to integrators

This page is the issuer's disclosure: "Robinhood discloses a deviation on this page when a token's on-chain price differs from its underlying's reference price by 5% or more for seven consecutive trading days." Today it shows 1532.7364786152502% for SATS and 50.10770046736115% for WEEK, and a reader cannot tell that the first trades above its reference and the second below.

#### Suggested fix

Strip `DEVIATION_DIRECTION_` before the lookup, as the corporate actions table does with its prefix, or key both lookups with the full enum names.

### R6. Account Abstraction page imports robinhoodMainnet from viem/chains, which viem does not export (the export is robinhood)

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/account-abstraction, the ZeroDev example. viem needs no change. |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The ZeroDev example starts with:

```ts
import { robinhoodMainnet } from "viem/chains"
```

viem 2.57.2, the latest release on npm on 3 October 2026, exports the chain as `robinhood` (id 4663) and has nothing named robinhoodMainnet. viem added the chain in 2.55.0 (CHANGELOG, PR #4818). The Alchemy example on the same page imports robinhoodMainnet from "@alchemy/common/chains", a different package that was not checked here.

#### Evidence

Fetched 3 October 2026. The docs bundle keeps each page's source URL-encoded, so the first command decodes it.

```
$ B=https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets
$ curl -s $B/index-BQ4e_aJN.js | python3 -c "import sys,urllib.parse; t=urllib.parse.unquote(sys.stdin.read()); print(sorted({l for l in t.splitlines() if 'robinhoodMainnet' in l and 'import' in l}))"
['import { robinhoodMainnet } from "@alchemy/common/chains";', 'import { robinhoodMainnet } from "viem/chains"']
$ npm view viem version
2.57.2
$ npm pack viem@2.57.2 --silent && tar xzf viem-2.57.2.tgz
$ grep -n "robinhood" package/chains/index.ts
540:export { robinhood } from './definitions/robinhood.js'
541:export { robinhoodTestnet } from './definitions/robinhoodTestnet.js'
$ grep -rl robinhoodMainnet package | wc -l
       0
```

Running the import in Node gives `SyntaxError: The requested module 'viem/chains' does not provide an export named 'robinhoodMainnet'` (docs/research/zerodev-passkey.md, section 1).

#### Why it matters to integrators

Copying the ZeroDev example fails at its import line. Whoever edits the example may also want to know that viem's `robinhood` lists https://rpc.mainnet.chain.robinhood.com and a third-party endpoint, https://rpc.ordofi.network, as default HTTP URLs, and its only default WebSocket URL is wss://rpc.ordofi.network (added in viem 2.56.7, PR #5093). The example passes its own transport, which is the safe pattern to keep.

#### Suggested fix

Change the import to `import { robinhood } from "viem/chains"` and `const chain = robinhood`.

### R7. Building with Stock Tokens shows TransferWithScaledUI as part of "the core ERC-8056 interface", while the ERC-8056 draft names that event TransferWithUIAmount

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/building-with-stock-tokens, section "ERC-8056 events" |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page says "The multiplier and its movements are exposed by the core ERC-8056 interface" and shows the interface below, given here without its comments.

```solidity
interface IScaledUIAmount {
  function uiMultiplier() external view returns (uint256);
  event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
  event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue);
}
```

The ERC-8056 draft's IScaledUIAmount declares the optional transfer event as `TransferWithUIAmount(address indexed from, address indexed to, uint256 amount, uint256 uiAmount)` and adds an optional `UIMultiplierUpdateCancelled(uint256 cancelledMultiplier, uint256 cancelledEffectiveAt)`. Different event names give different topic hashes, so the two are not interchangeable.

#### Evidence

See E1 for the full comparison. In short, run on 3 October 2026 at about 00:30 UTC:

```
$ cast keccak 'TransferWithScaledUI(address,address,uint256,uint256)'
0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802
$ cast keccak 'TransferWithUIAmount(address,address,uint256,uint256)'
0x0226a2f5c1ae0e071aeec3d4ebafcefdc5c549be11f40ed27e76e802acccf374
$ T=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C   # SPY
$ cast logs --rpc-url $RPC --address $T --from-block 77660000 --to-block 78660000 \
    0x37e7f0db430edc9dd31bc66f25f8449353aa0818f503b906747dd8f286cd3802 --json | jq length
119648
$ cast logs --rpc-url $RPC --address $T --from-block 77660000 --to-block 78660000 \
    0x0226a2f5c1ae0e071aeec3d4ebafcefdc5c549be11f40ed27e76e802acccf374 --json | jq length
0
```

#### Why it matters to integrators

An indexer written to the draft subscribes to TransferWithUIAmount and receives nothing from Stock Tokens. An indexer written from this page gets the right topic but believes it is the standard one, and misses ERC-8056 tokens that use the draft's name.

#### Suggested fix

Present TransferWithScaledUI as Robinhood's event, give its topic0 (0x37e7f0db...3802), and say that Stock Tokens do not emit the draft's optional TransferWithUIAmount or UIMultiplierUpdateCancelled. Say also that a scheduled multiplier change can be replaced before effectiveAt with only a new UIMultiplierUpdated (E1).

### R8. Oracles page says oraclePaused() marks corporate-action processing, but the flag has never been set on SPY, QQQ, NVDA or AAPL

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/oracles-and-price-feeds, section "Oracle Pauses During Corporate Actions" |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page says:

> While a corporate action is being processed, the price oracle for the affected token is paused

> You can read this state on-chain via `oraclePaused()` on the token.

> These pause windows align with the trading pauses around corporate actions.

The Stock Tokens page says "The platform manages dividends and stock splits through an onchain multiplier". Each of the four launch tokens has had one multiplier change (one UIMultiplierUpdated event each: AAPL at block 36,345,344, NVDA at 58,952,659, SPY at 65,779,981, QQQ at 69,210,998), and none of the four has ever emitted OraclePaused (docs/research/chain-constants.md section 3 and appendix A.8, scanned to block 78,335,689). On 3 October the issuer's corporate actions API lists NVDA with type CORPORATE_ACTION_TYPE_CASH_DIVIDEND, status CORPORATE_ACTION_STATUS_IN_PROGRESS and processDate 2026-10-01, and NVDA's oraclePaused() returns false.

#### Evidence

Run on 3 October 2026 between 00:35 and 00:48 UTC, public RPC, one call at a time.

```
$ T=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C   # SPY
$ TOPIC=$(cast keccak 'OraclePaused()')          # 0xe28b7053f432ae5400c6168140cbe15638399715519a0a39b16b505fb9fc9d9a
$ for s in 0 10000000 20000000 30000000 40000000 50000000 60000000 70000000; do
    e=$((s+9999999)); [ $e -gt 78664229 ] && e=78664229
    cast logs --rpc-url $RPC --address $T --from-block $s --to-block $e $TOPIC --json | jq length; sleep 3
  done
0
0
0
0
0
0
0
0
$ cast logs --rpc-url $RPC --address $T --from-block 60000000 --to-block 69999999 \
    0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055 --json | jq -c '[.[] | .transactionHash]'
["0x2fe45ab24d1b3fa87883f8b08daf29dae969c5b43d0afe9ccca299c11a641025"]
$ curl -s https://api.robinhood.com/rhj/corporate-actions | jq -c '.corpActions[] | select(.tokenSymbol == "NVDA") | {type, status, processDate}'
{"type":"CORPORATE_ACTION_TYPE_CASH_DIVIDEND","status":"CORPORATE_ACTION_STATUS_IN_PROGRESS","processDate":{"year":2026,"month":10,"day":1}}
$ cast call --rpc-url $RPC 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 'oraclePaused()(bool)'   # NVDA, block 78,671,585
false
```

#### Why it matters to integrators

A contract that follows the page treats oraclePaused() as the corporate-action signal. On the record so far it has never fired, including during all four multiplier changes, so a guard that waits for it never waits. The signals that did come first are newUIMultiplier() and effectiveAt(): each change was scheduled 580 to 588 seconds ahead (docs/research/chain-constants.md, section 3).

#### Suggested fix

State which corporate actions set the flag and which do not, or correct the text if the flag is not used. Point integrators to newUIMultiplier() and effectiveAt() as the advance signal, with the lead time seen so far.

### R9. Oracles page: a heartbeat staleness check accepts Friday's price on Saturday, and the page has no market-session check

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/oracles-and-price-feeds, "Best practices" and the line "Stock feeds update 24/5, following market hours." |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page's only freshness advice is to "compare `updatedAt` against the feed's heartbeat; reject stale prices" and to "keep your staleness check (`updatedAt` vs. heartbeat) as the primary guard rather than relying on the flag alone." On hours it says only "Stock feeds update 24/5, following market hours." The heartbeat in Chainlink's directory is 86,400 seconds, and the 24/5 session closes at 20:00 New York time on Friday (Chainlink's market hours page: "24/5 US Equities and ETFs", weekly open "20:00 Sun", weekly close "20:00 Fri"). A Friday round from late in the day is still inside the heartbeat on Saturday afternoon.

#### Evidence

Archive RPC at block 73,280,794, timestamp 1790445600, Saturday 26 September 2026 14:00 EDT. Run on 3 October 2026 at 00:50 UTC.

```
$ A=https://robinhood.drpc.org
$ cast block 73280794 --rpc-url $A -f timestamp
1790445600
$ cast call --rpc-url $A --block 73280794 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'   # NVDA
18446744073709552722 [1.844e19]
22566018707 [2.256e10]
1790366153 [1.79e9]
1790366165 [1.79e9]
18446744073709552722 [1.844e19]
$ cast call --rpc-url $A --block 73280794 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'   # AAPL
18446744073709552287 [1.844e19]
34145318048 [3.414e10]
1790365752 [1.79e9]
1790365765 [1.79e9]
18446744073709552287 [1.844e19]
```

NVDA's round is 79,435 seconds (22.07 hours) old and AAPL's 79,835 seconds (22.18 hours). Both pass a 24-hour heartbeat check. SPY and QQQ fail it at the same block (25.95 and 25.94 hours) only because their last Friday rounds came earlier in the day (docs/research/chain-constants.md, section 4). From 22 June to 2 October 2026, none of the four feeds posted a round between Friday 20:00 and Sunday 20:00 New York time (docs/research/prd-questions.md, E3).

#### Why it matters to integrators

Pools trade all weekend. A contract that follows the page prices a Saturday buy of NVDA or AAPL against Friday's last round and lets it through. Chainlink's own page for these feeds already advises the fix: "Incorporate authoritative exchange holiday calendars (NYSE/NASDAQ for US equities) into your integration" (https://docs.chain.link/data-feeds/tokenized-equity-feeds, source line 227).

#### Suggested fix

Add a market-session check to "Best practices": the 24/5 window from Sunday 20:00 to Friday 20:00 New York time, NYSE holidays and early closes, and after each reopen only a round with updatedAt at or after the reopen. Link Chainlink's market hours page. contracts/src/libraries/SessionCalendar.sol in this repo is one MIT implementation, with table tests for every daylight-saving switch and holiday in 2026 and 2027.

### R10. Connecting page: state the public RPC's limits (state window, getLogs ranges, burst challenge)

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.robinhood.com/chain/connecting, section "Public Endpoints" |
| File via | chain-developers-group@robinhood.com |

#### What is wrong

The page says "The following public endpoints are available but are rate-limited and not recommended for production use." and "For historical reads and indexing, use an archive endpoint". It gives no numbers. The endpoint serves state for only minutes of blocks, caps eth_getLogs ranges, and answers bursts with an HTML challenge page.

#### Evidence

State window, run on 3 October 2026 at 00:42 UTC with the head at block 78,668,499:

```
$ cast call --rpc-url $RPC --block 78667499 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'decimals()(uint8)'
6
$ cast call --rpc-url $RPC --block 78658499 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'decimals()(uint8)'
Error: server returned an error response: error code -32000: historical state cd0b420028cb2c952bdded162e54226d37fd97eccfc0bcb7acefd3771114ee2f is not available
```

The chain made 13,651 blocks between 00:19:29 and 00:42:28 UTC, about 9.9 per second, so the window was between about 2 and 17 minutes. docs/DECISIONS.md D-008 saw the same on 2 October.

getLogs limits, from docs/research/prd-questions.md E8: with one address and one topic, "query spans 78329651 blocks (0 to 78329650), but only 10000000 are allowed for this request; narrow the block range". With a list in one position, "only 100000 are allowed for this request; narrow the block range, or send one value per position".

Bursts: on 2 October, after about 10 to 15 quick calls, the endpoint answered HTTP 403 with a Cloudflare page titled "Just a moment...", and cleared about 13 minutes later (docs/research/chain-constants.md section 0 and docs/research/issuer-docs.md section 7).

#### Why it matters to integrators

Tools that fork mainnet at a pinned block, such as Foundry and Hardhat, stop working against this endpoint within minutes. Indexers that send address or topic lists hit the 100,000-block cap. Clients that send bursts get HTML instead of a JSON-RPC error and can misread it. With the numbers on the page, teams can size their calls and pick a provider up front.

#### Suggested fix

Add the state window, both eth_getLogs limits and the burst behavior to the "Public Endpoints" section.

## ERC-8056 draft

### E1. Deployed Stock Tokens on Robinhood Chain differ from the ERC-8056 draft: transfer event name, no UIMultiplierUpdateCancelled when a schedule is replaced, and same-block multiplier updates

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | ERC-8056 discussion thread, https://ethereum-magicians.org/t/erc-8056-scaled-ui-amount-extension-for-erc-20-tokens/25899 (the draft's discussions-to). Draft: https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8056.md, status Draft, last changed in commit 554d3467b297 on 1 September 2026 |
| File via | A post in that thread |

#### What differs

The issuer lists 194 Stock Tokens on Robinhood Chain. We checked four: SPY, QQQ, NVDA and AAPL, which share one implementation, 0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2, behind the beacon 0xe10b6f6B275de231345c20D14Ab812db62151b00 (docs/research/chain-constants.md, section 3). Sourcify holds an exact match of its source (src/Stock.sol:Stock).

1. Transfer event. The draft declares `event TransferWithUIAmount(address indexed from, address indexed to, uint256 amount, uint256 uiAmount);` as optional. The tokens' own src/interfaces/IScaledUIAmount.sol declares `event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue);`, and src/ERC20ScaledUIUpgradeable.sol emits it on every balance change.
2. Replacing a scheduled update. The draft says: "Whether a scheduled update may be cancelled or superseded before its `effectiveAt` is likewise implementation-specific; implementations that support this SHOULD emit `UIMultiplierUpdateCancelled` so off-chain consumers can distinguish a withdrawn or replaced schedule from a routine update." The tokens' `_updateUIMultiplier(uint256 newMultiplier, uint256 effectiveAt_)` overwrites the stored new multiplier and effectiveAt and emits only `UIMultiplierUpdated(oldMultiplier, newMultiplier, effectiveAt_)`. No source file of the token declares a cancel event or a cancel function.
3. Same-block updates. The draft's reference implementation requires `effectiveAtTimestamp > currentTime` ("Effective At must be in the future"). The tokens' `updateMultiplier(uint256)` calls `_updateUIMultiplier(newMultiplier, block.timestamp)`, and the check is `require(effectiveAt_ >= block.timestamp, "Effective time must not be in the past");`, so a change can take effect in the block that sets it. The draft leaves the update method to the issuer, so this is a difference from the reference code and not from a requirement. All four changes seen so far used the scheduled form, 580 to 588 seconds ahead.
4. Interface ids. supportsInterface is true for IScaledUIAmount (0xa60bf13d), IScaledUIAmountNewUIMultiplier (0x4bd27648) and IScaledUIAmountBalances (0xd890fd71), and false for IScaledUIAmountConversion (0x57854fc3), which the draft makes optional. This one is consistent with the draft.

#### Evidence

Run on 3 October 2026 between 00:28 and 00:31 UTC.

```
$ curl -s https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-8056.md | shasum -a 256
fa64d2cb20e2f15828cb8b5d7c5c83cc6fd07c2a84b07f804d216a89bd1e5848  -
$ curl -s 'https://sourcify.dev/server/v2/contract/4663/0xb35490d6f9163DE4F80d88dc75c3516eb64C5aE2?fields=sources' -o stock.json
$ jq -r '.sources["src/ERC20ScaledUIUpgradeable.sol"].content' stock.json \
    | grep -n 'function _updateUIMultiplier\|require(effectiveAt_\|emit UIMultiplierUpdated\|emit TransferWithScaledUI'
36:    function _updateUIMultiplier(uint256 newMultiplier) internal virtual {
40:    function _updateUIMultiplier(uint256 newMultiplier, uint256 effectiveAt_) internal virtual {
43:        require(effectiveAt_ >= block.timestamp, "Effective time must not be in the past");
55:        emit UIMultiplierUpdated(oldMultiplier, newMultiplier, effectiveAt_);
99:        emit TransferWithScaledUI(from, to, value, Math.mulDiv(value, uiMultiplier(), DENOMINATOR));
$ T=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C   # SPY, head about block 78,660,815
$ for id in 0xa60bf13d 0x4bd27648 0x57854fc3 0xd890fd71; do cast call --rpc-url $RPC $T 'supportsInterface(bytes4)(bool)' $id; sleep 2; done
true
true
false
true
```

The event counts on SPY are in R7: 119,648 TransferWithScaledUI logs and 0 TransferWithUIAmount logs between blocks 77,660,000 and 78,660,000.

#### Why it matters to integrators

The draft gives the cancel event a stated purpose: so "off-chain consumers can distinguish a withdrawn or replaced schedule from a routine update". On these tokens a replaced schedule looks like a new UIMultiplierUpdated, so a consumer that stored the earlier schedule has to compare state to notice. The event name difference splits indexers between this deployment and others. Same-block updates mean a guard cannot see every change coming: Sleeve's guard waits while a change is scheduled within 24 hours, and an immediate update is never pending.

#### Suggested fix

Ask three questions in the thread. Should the draft name TransferWithScaledUI as an accepted alias or require one name, given a live deployment uses the other? Are deployments that allow replacement expected to emit UIMultiplierUpdateCancelled? Is a zero-notice update compliant, since the reference code forbids it? On Robinhood's side, either emit the draft's events in a future implementation upgrade or document the differences (R7).

## Chainlink

Filing channel for C1 to C3: GitHub issues on https://github.com/smartcontractkit/documentation, the repo behind docs.chain.link.

### C1. Robinhood Chain equity feeds: the first rounds, before 23 June 2026 13:53 UTC, carry answers about 1e8 times too large

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | Chainlink's feed page for Robinhood Chain, https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood (source src/content/data-feeds/tokenized-equity-feeds/robinhood.mdx) |
| File via | GitHub issue on smartcontractkit/documentation |

#### What is wrong

getRoundData on the SPY / USD proxy returns 7424400000000000000 for round 1, which at 8 decimals reads as 74,244,000,000 USD, and 73683695000 (736.83695 USD) for round 8. Rounds 1 to 7 of SPY, 1 to 13 of QQQ, 1 to 24 of NVDA and 1 to 17 of AAPL carry answers about 1e8 times the normal scale (docs/research/prd-questions.md, E4). The last of them landed between 07:03 and 13:48 UTC on 23 June 2026 (docs/HP2_RESULTS.md, data notes). The page says nothing about them.

#### Evidence

Public RPC, run on 3 October 2026 at 00:33 and 00:44 UTC. Phase 1 round n has round id 2^64 + n.

| Feed proxy | Round | Round id | answer | updatedAt |
| --- | --- | --- | --- | --- |
| SPY 0x319724394D3A0e3669269846abE664Cd621f9f6A | 1 | 18446744073709551617 | 7424400000000000000 | 1782086443 (2026-06-22T00:00:43Z) |
| SPY | 7 | 18446744073709551623 | 7349800000000000000 | 1782198196 (2026-06-23T07:03:16Z) |
| SPY | 8 | 18446744073709551624 | 73683695000 | 1782222713 (2026-06-23T13:51:53Z) |
| NVDA 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | 24 | 18446744073709551640 | 2030652000000000000 | 1782222509 (2026-06-23T13:48:29Z) |
| NVDA | 25 | 18446744073709551641 | 20344000000 | 1782222749 (2026-06-23T13:52:29Z) |

```
$ cast call --rpc-url $RPC 0x319724394D3A0e3669269846abE664Cd621f9f6A \
    'getRoundData(uint80)(uint80,int256,uint256,uint256,uint80)' 18446744073709551617
18446744073709551617 [1.844e19]
7424400000000000000 [7.424e18]
1782086431 [1.782e9]
1782086443 [1.782e9]
18446744073709551617 [1.844e19]
```

#### Why it matters to integrators

These rounds are permanent. Every backtest, verifier or risk model that walks a feed's history from round 1, which getRoundData and the AnswerUpdated logs make easy, sees SPY at tens of billions of dollars. Sleeve's replay drops rounds above 10 times the feed's median and found 7, 13, 24 and 17 of them (docs/HP2_PROTOCOL.md, docs/HP2_RESULTS.md).

#### Suggested fix

List the affected round ranges per feed on Chainlink's feed page for Robinhood Chain, so consumers can filter them by round id instead of by a heuristic.

### C2. Robinhood Chain feed descriptions use two formats: "RHSPY / USD" and "Robinhood QQQ / USD"

| Field | Value |
| --- | --- |
| Status | Drafted, not filed. Low impact. |
| Target | The SPY, QQQ, NVDA and AAPL feed proxies on Robinhood Chain and their directory entries |
| File via | GitHub issue on smartcontractkit/documentation |

#### What is wrong

description() returns "RHSPY / USD" and "RHNVDA / USD" for two feeds and "Robinhood QQQ / USD" and "Robinhood AAPL / USD" for the other two. The directory names all four in the second form ("Robinhood SPY / USD" and so on).

#### Evidence

Public RPC, 3 October 2026 at 00:33 and 00:34 UTC.

```
$ cast call --rpc-url $RPC 0x319724394D3A0e3669269846abE664Cd621f9f6A 'description()(string)'
"RHSPY / USD"
$ cast call --rpc-url $RPC 0x80901d846d5D7B030F26B480776EE3b29374C2ae 'description()(string)'
"Robinhood QQQ / USD"
$ cast call --rpc-url $RPC 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 'description()(string)'
"RHNVDA / USD"
$ cast call --rpc-url $RPC 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'description()(string)'
"Robinhood AAPL / USD"
```

#### Why it matters to integrators

Dashboards and tools that label or match feeds by description() show inconsistent names, and code that parses the description to find a ticker breaks on half of these feeds. Sleeve pins the feed per ticker and never parses the description (contracts/src/interfaces/IAggregatorV3.sol).

#### Suggested fix

Align the descriptions, or say in the docs that description() is display text and not an identifier.

### C3. Equity feed docs: an "Eastern Standard Time" label, and no stated behavior on NYSE early-close days

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.chain.link/data-feeds/tokenized-equity-feeds (source src/content/data-feeds/tokenized-equity-feeds/index.mdx, line 39) and https://docs.chain.link/data-streams/market-hours (source src/content/data-streams/market-hours.mdx) |
| File via | GitHub issue on smartcontractkit/documentation |

#### What is wrong

The equity feed overview lists the sessions as "regular hours, pre-market, post-market, and overnight (Eastern Standard Time)". The market hours page says the times are Eastern Time and "follow US daylight saving time", and the feeds agree with it: every reopen in the record landed 18 to 69 seconds after 20:00 New York time, in EDT through the summer (docs/research/session-calendar.md, section 8).

The market hours page also has no early-close rule for the 24/5 US equities. Its only early-close section is for Precious Metals Spot. An older version said "Half-day trading may apply on the eve of certain U.S. holidays (e.g., Jul 3, Nov 28)", and that sentence was removed in commit dc096a6 on 1 July 2026 (docs/research/session-calendar.md, section 6). NYSE closes early on 27 November 2026, 24 December 2026 and 26 November 2027: the regular session ends at 13:00 and the late sessions at 17:00.

#### Evidence

Fetched 3 October 2026 at 00:32:43 UTC.

```
$ curl -s https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/content/data-feeds/tokenized-equity-feeds/index.mdx \
    | grep -o 'overnight (Eastern Standard Time)'
overnight (Eastern Standard Time)
$ curl -s https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/content/data-streams/market-hours.mdx -o market-hours.mdx
$ grep -o 'Commodities times are .*daylight saving time' market-hours.mdx
Commodities times are **ET (Eastern Time)** and follow US daylight saving time
$ grep -n '^###.*early closures' market-hours.mdx
157:### Precious Metals Spot early closures <span id="precious-metals-early-closures"></span>
```

#### Why it matters to integrators

A session calendar built from "Eastern Standard Time" would be one hour off from March to November. On early-close days nothing says whether the 24/5 feeds stop at 13:00, 17:00 or 20:00, and the first such day is 27 November 2026. Sleeve's calendar ends the session at 17:00 on those days and will check the feed rounds on 27 November (docs/DECISIONS.md D-009 Q7 and docs/research/session-calendar.md Q3).

#### Suggested fix

Write "Eastern Time, following US daylight saving time" on the overview page, and add the 24/5 US equities session end on NYSE early-close days to the market hours page.

## ZeroDev

### Z1. passkey-validator: isRIP7212SupportedNetwork(4663) is false, so Robinhood Chain UserOps use the Solidity P-256 verifier (about 340,000 extra gas) although P256VERIFY is live

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://github.com/zerodevapp/sdk: plugins/webauthn-key/utils.ts (`RIP7212_SUPPORTED_NETWORKS`, last changed in commit 58217618a3f3 on 5 December 2025) and plugins/passkey/toPasskeyValidator.ts (the signature encoding and `getStubSignature`). Published as @zerodev/webauthn-key 5.5.0 and @zerodev/passkey-validator 5.6.0, both the latest on npm on 3 October 2026 |
| File via | GitHub issue on zerodevapp/sdk |

#### What is wrong

```ts
const RIP7212_SUPPORTED_NETWORKS = [
    1, 10, 56, 97, 130, 137, 143, 183, 185, 204, 233, 324, 360, 747, 901, 919,
    ...
    11155111, 11155420, 666666666, 88153591557
]

export const isRIP7212SupportedNetwork = (chainId: number): boolean =>
    RIP7212_SUPPORTED_NETWORKS.includes(chainId)
```

4663 is not in the list. toPasskeyValidator.ts passes `isRIP7212SupportedNetwork(chainId)` as the signature's `usePrecompiled` flag, and `getStubSignature` hardcodes `false`. The passkey validator on Robinhood Chain, 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69, does not choose by itself: it calls the precompile only when `usePrecompiled` is true and otherwise calls Daimo's Solidity verifier (verified source, docs/research/zerodev-passkey.md, section 3.2).

#### Evidence

The list, on main of zerodevapp/sdk on 3 October 2026:

```
$ gh api repos/zerodevapp/sdk/contents/plugins/webauthn-key/utils.ts --jq .content | base64 -d | grep -c 4663
0
```

The precompile is live. The input is go-ethereum's test vector "CallP256Verify". Run on 3 October 2026 at 00:19:29 UTC, block 78,654,848:

```
$ V=0x$(curl -s https://raw.githubusercontent.com/ethereum/go-ethereum/master/core/vm/testdata/precompiles/p256Verify.json | jq -r '.[0].Input')
$ curl -s -X POST -H 'content-type: application/json' $RPC --data '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x0000000000000000000000000000000000000100","data":"'$V'"},"latest"]}'
{"jsonrpc":"2.0","id":1,"result":"0x0000000000000000000000000000000000000000000000000000000000000001"}
```

Gas, measured on live Robinhood Chain state through eth_call with state overrides, blocks 78,346,591 to 78,347,185 (docs/research/zerodev-passkey.md, sections 4.3 and 5.1):

| Measurement | Precompile path | Solidity path | Difference |
| --- | --- | --- | --- |
| validateUserOp | 66,033 | 414,058 | 348,025 |
| handleOps, first UserOp (deploy, install, bracketed call) | 497,093 | 838,964 | 341,871 |
| handleOps, second UserOp in the bundle | 153,308 | 478,330 | 325,022 |

On chain, the latest passkey deployment on Robinhood Chain by another app, transaction 0x8b6be63d7defb896e84e35769ff68ac4fc66da6ceb02220105d5ee2665c45afd at block 77,645,384, carries `usePrecompiled` false and used 773,418 gas (rechecked with `cast receipt` and by decoding its signature on 3 October 2026).

#### Why it matters to integrators

Every passkey UserOp on Robinhood Chain built with the SDK defaults pays roughly 325,000 to 348,000 more gas than it needs to. Bundler estimates assume the expensive path too, because the stub signature sets the flag to false, which raises the prefund the paymaster or the account must cover.

#### Suggested fix

Add 4663 to `RIP7212_SUPPORTED_NETWORKS`. Longer term, detect the precompile at runtime, since one eth_call of a known vector to 0x100 returns 1 where it exists, or let callers pass `usePrecompiled` to toPasskeyValidator. Make `getStubSignature` use the same flag.

### Z2. Kernel meta factory (FactoryStaker 0xd703aaE79538628d27099B8c4f621bE4CCd142d5) has no EntryPoint v0.7 stake on Robinhood Chain

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | ZeroDev, owner of the meta factory (owner() is 0x9775137314fE595c943712B0b336327dfa80aE8A). Code: https://github.com/zerodevapp/kernel, src/factory/FactoryStaker.sol |
| File via | GitHub issue on zerodevapp/kernel |

#### What is wrong

On Robinhood Chain the meta factory, and the Kernel v3.1 factory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419, have no stake and no deposit in EntryPoint v0.7. On Arbitrum One the same meta factory has 0.1 ETH staked with a one-day unstake delay.

ERC-7562 allows a deploying UserOp to touch storage outside the account only through a staked factory: "[STO-022] There is an `initCode` and the `factory` contract is staked.", and, for a staked factory, "[STO-031] Access the entity's own storage."

#### Evidence

Run on 3 October 2026 at 00:20 UTC.

```
$ cast call --rpc-url https://rpc.mainnet.chain.robinhood.com 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
    'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' 0xd703aaE79538628d27099B8c4f621bE4CCd142d5
(0, false, 0, 0, 0)
$ cast call --rpc-url https://rpc.mainnet.chain.robinhood.com 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
    'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419
(0, false, 0, 0, 0)
$ cast call --rpc-url https://rpc.mainnet.chain.robinhood.com 0xd703aaE79538628d27099B8c4f621bE4CCd142d5 'owner()(address)'
0x9775137314fE595c943712B0b336327dfa80aE8A
$ cast call --rpc-url https://arb1.arbitrum.io/rpc 0x0000000071727De22E5E9d8BAf0edAc6f37da032 \
    'getDepositInfo(address)((uint256,bool,uint112,uint32,uint48))' 0xd703aaE79538628d27099B8c4f621bE4CCd142d5
(0, true, 100000000000000000 [1e17], 86400 [8.64e4], 0)
```

#### Why it matters to integrators

A first UserOp that deploys an account through this factory reads the factory's own `approved` mapping (STO-031) and writes the validator's per-account storage for an account that does not exist yet (STO-022). Both need a staked factory. Bundlers serving Robinhood Chain accept these UserOps today: at least 5,486 accounts were deployed through this factory (docs/research/zerodev-passkey.md, section 3.4). A bundler that enforces ERC-7562 can reject them, and any module that reads outside storage in its install hook cannot run during deployment. Sleeve moved its module install out of the deploying UserOp's validation for this reason (docs/DECISIONS.md D-019).

#### Suggested fix

The owner calls `stake(IEntryPoint entryPoint, uint32 unstakeDelay)` on Robinhood Chain with the same 0.1 ETH and 86,400-second delay used on Arbitrum One. The function is `onlyOwner`, so only ZeroDev can do this.

### Z3. Passkeys docs: "only 3450 gas" for the P-256 precompile, "automatically" switching to it, and Robinhood Chain missing from the precompile list

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://docs.zerodev.app/onboarding/passkeys/overview (source https://github.com/zerodevapp/docs, docs/pages/onboarding/passkeys/overview.mdx, lines 28, 32 and 293) |
| File via | GitHub issue on zerodevapp/docs |

#### What is wrong

The page says:

> Native passkeys are the best option when available, since it uses the least amount of gas (only 3450 gas for verifying a P256 signature).

> if you use passkeys on a network where ERC-7212 isn't available, and the network later adds support for ERC-7212, you don't need to upgrade your validator

> it will automatically start taking advantage of the ERC-7212 precompile.

The source joins those two parts with a double hyphen. Its list "Chains with Native Passkey Precompiles" does not include Robinhood Chain.

On Robinhood Chain the precompile costs about 6,900 gas, the EIP-7951 price. The switch to the precompile depends on the SDK's hardcoded chain list (Z1), so it does not happen by itself when a chain adds the precompile.

#### Evidence

EIP-7951's gas schedule is "`6900` gas", and its comparison with RIP-7212 reads "Different gas cost: 3450 gas vs 6900 gas" (https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7951.md). On Robinhood Chain, run on 3 October 2026 at 00:19 UTC with the vector from Z1:

```
$ curl -s -X POST -H 'content-type: application/json' $RPC --data '{"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"to":"0x0000000000000000000000000000000000000100","data":"'$V'"}]}'
{"jsonrpc":"2.0","id":1,"result":"0x7837"}
$ curl -s -X POST -H 'content-type: application/json' $RPC --data '{"jsonrpc":"2.0","id":1,"method":"eth_estimateGas","params":[{"to":"0x00000000000000000000000000000000000dEaD1","data":"'$V'"}]}'
{"jsonrpc":"2.0","id":1,"result":"0x5d35"}
```

0x7837 is 30,775 and 0x5d35 is 23,861, a difference of 6,914 gas for the same calldata. A staticcall measured inside a contract took 7,308 gas including call overhead (docs/research/zerodev-passkey.md, section 4.3). The page fetched at 00:18:41 UTC does not contain the string "Robinhood".

#### Why it matters to integrators

Teams use this page to budget gas and to choose chains. On Robinhood Chain the precompile costs twice the quoted figure, and a team that trusts "automatically" pays the Solidity verifier's 300,000-plus gas on every UserOp without knowing (Z1).

#### Suggested fix

Quote 3,450 gas for RIP-7212 pricing and 6,900 gas for EIP-7951 pricing. Say that the validator uses the precompile when the SDK's chain list includes the chain. Add Robinhood Chain (4663) to the list.

### Z4. @zerodev/sdk 5.5.10: the CommonJS build requires tslib, but tslib is not a dependency

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://github.com/zerodevapp/sdk, packages/core (published as @zerodev/sdk 5.5.10, the latest on npm on 3 October 2026) |
| File via | GitHub issue on zerodevapp/sdk |

#### What is wrong

Four files of the CommonJS build call `require("tslib")`, and the package declares only semver as a dependency and viem as a peer.

#### Evidence

```
$ npm pack @zerodev/sdk@5.5.10 --silent && tar xzf zerodev-sdk-5.5.10.tgz
$ sed -n 4p package/_cjs/index.js
const tslib_1 = require("tslib");
$ grep -rl 'require("tslib")' package/_cjs
package/_cjs/index.js
package/_cjs/utils/index.js
package/_cjs/accounts/index.js
package/_cjs/actions/index.js
$ jq -c '.dependencies, .peerDependencies' package/package.json
{"semver":"^7.6.0"}
{"viem":"^2.28.0"}
```

@zerodev/passkey-validator has no exports map, so Node's ESM loader takes its CommonJS main, which loads the SDK's CommonJS build. In a Node script or test without tslib installed, the import fails with `Error: Cannot find module 'tslib'` (docs/research/zerodev-passkey.md, section 1).

#### Why it matters to integrators

Node scripts and tests that import the passkey plugin fail until the app adds tslib itself. Bundlers that use the ESM build are not affected, which hides the problem until server-side code runs.

#### Suggested fix

Add tslib to dependencies, or build the CommonJS output without importHelpers.

### Z5. Kernel v3.1 on Robinhood Chain: document the build behind each deployed contract (the ECDSA validator matches v3.1 rc1, not tag v3.1) and which SDK addresses exist per chain

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | https://github.com/zerodevapp/kernel (README and foundry.toml at tag v3.1) and the SDK's address tables in https://github.com/zerodevapp/sdk |
| File via | GitHub issue on zerodevapp/kernel |

#### What is wrong

1. The ECDSA validator that the SDK uses for Kernel v3.1 and later, 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57, does not match tag v3.1 (1,762 bytes compiled against 1,819 deployed). It matches commit e18c700 ("v3.1 rc1"), which differs by one line: its onInstall reverts AlreadyInitialized for an account that already has an owner, where the tag's version overwrites the owner (docs/GATES.md G6 and docs/research/g6-notes.md section 2).
2. Kernel's foundry.toml at v3.1 sets `optimize = true` and `runs = 1000`, which are not Foundry keys, and pins no solc. Built as is under forge 1.7.1, the implementation does not match (44,517 bytes). It matches with solc 0.8.25, optimizer on with 200 runs, EVM paris and via-IR, the settings in Sourcify's metadata for the same addresses on chain 1 (docs/research/g6-notes.md, section 2).
3. The SDK maps passkey validator versions 0.0.1 (0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06) and 0.0.2 (0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd) and ONLY_ENTRYPOINT_HOOK_ADDRESS (0xb230f0A1C7C95fa11001647383c8C7a8F316b900) for Kernel v3.x. None of the three has code on Robinhood Chain. Version 0.0.3 does.

#### Evidence

The bytecode comparison is rerun by contracts/test/spike/kernel-bytecode-check.sh in this repo. Code presence, public RPC, 3 October 2026 at 00:41 UTC:

```
$ for a in 0xb230f0A1C7C95fa11001647383c8C7a8F316b900 0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06 \
           0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69; do
    echo "$a $(cast codesize --rpc-url $RPC $a)"; sleep 2
  done
0xb230f0A1C7C95fa11001647383c8C7a8F316b900 0
0xD990393C670dCcE8b4d8F858FB98c9912dBFAa06 0
0xbA45a2BFb8De3D24cA9D7F1B551E14dFF5d690Fd 0
0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 4739
```

#### Why it matters to integrators

Auditors who rebuild from the tag get a mismatch and cannot tell a build difference from a different contract, and the deployed validator behaves differently from the tag: a second install on the same account reverts. Apps that pick passkey validator 0.0.1 or 0.0.2 on Robinhood Chain point at an address with no code.

#### Suggested fix

For each deployed address, publish the commit and compiler settings it was built from. Use Foundry's keys in foundry.toml (`optimizer`, `optimizer_runs`) and pin solc. Publish a per-chain table of which SDK addresses are deployed.

## Paxos (USDG)

### P1. USDG on Robinhood Chain: the permit and EIP-3009 facet (0x780d30b6a89BC9Eef953a543aA288c3B05b01309) has no verified source

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | Paxos, https://github.com/paxosglobal/paxos-token-contracts |
| File via | GitHub issue on paxosglobal/paxos-token-contracts |

#### What is wrong

USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168) sends permit (0xd505accf) and transferWithAuthorization (0xe3ee160e) to the facet 0x780d30b6a89BC9Eef953a543aA288c3B05b01309. Sourcify has no record of that facet, or of the pause and freeze facet 0x58cab81e3d8468A0e90df8cBfacb34535e1DE942, while the USDG implementation 0x68184C449E1a8f34fA18d289737129FD27B66f8F is verified. Blockscout's bytecode database has no match for 0x780d (docs/research/chain-constants.md, appendix A.9). All 238 FacetUpdate events came in one transaction at block 57, across five facets (docs/research/chain-constants.md, section 5).

#### Evidence

Run on 3 October 2026 at 00:56 UTC.

```
$ cast call --rpc-url $RPC 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xd505accf
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $RPC 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'getFacet(bytes4)(address)' 0xe3ee160e
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ curl -s -o /dev/null -w '%{http_code}\n' https://sourcify.dev/server/v2/contract/4663/0x780d30b6a89BC9Eef953a543aA288c3B05b01309
404
$ curl -s -o /dev/null -w '%{http_code}\n' https://sourcify.dev/server/v2/contract/4663/0x58cab81e3d8468A0e90df8cBfacb34535e1DE942
404
$ curl -s -o /dev/null -w '%{http_code}\n' https://sourcify.dev/server/v2/contract/4663/0x68184C449E1a8f34fA18d289737129FD27B66f8F
200
```

The research matched the facet's logic by reading against paxosglobal/paxos-token-contracts commit 674ac10, contracts/facets/TokenExtensionsFacet.sol, and a permit signed by a fresh key works in eth_call while the same signature with a changed value reverts InvalidSignature() (docs/research/chain-constants.md section 5 and appendix A.2, replayed in docs/research/gates-checks.md section 6).

#### Why it matters to integrators

Gasless USDG flows on Robinhood Chain, permit and EIP-3009 transfers, run through bytecode that nobody can read on an explorer. Integrators have to trust a source match they cannot reproduce from public records.

#### Suggested fix

Verify the five USDG facets on Sourcify and Blockscout for chain 4663, from the commit that built them.

## Third-party contracts on Robinhood Chain

### M1. Two Morpho Blue market oracles on Robinhood Chain multiply the Chainlink price by the Stock Token's uiMultiplier(), which the price already includes

| Field | Value |
| --- | --- |
| Status | Drafted, not filed |
| Target | The creator of Morpho Blue markets 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e (NVDA collateral) and 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45 (AAPL collateral), sender 0xCfBd7e12A0f154a45576a73C1E409200068507B9 in block 58,919,124, and whoever supplies those markets |
| File via | No public contact found. Morpho Blue markets are permissionless and their oracle is fixed at creation. |

#### What is wrong

Robinhood's oracles page says "latestRoundData() returns this directly, so you don't apply the multiplier yourself." The oracles of these two markets, 0xED29D310cfa91778A5850538DA28ed42234Cb78c (NVDA) and 0xD625d488D552775D2867194C618B945E5dDfE097 (AAPL), return the feed answer times the token's uiMultiplier() over the USDG/USD answer. They have no Sourcify record, and their bytecode contains the selectors for uiMultiplier() (0xa60bf13d), oraclePaused() (0x7706ba52) and latestRoundData() (0xfeaf968c) (docs/research/gates-checks.md, section 1.7). At block 78,653,690 the NVDA market had 623,355.49 USDG supplied and 613,930.49 borrowed, and the AAPL market 197,198.74 supplied and 197,174.57 borrowed (docs/research/gates-checks.md, section 1.5).

#### Evidence

Archive RPC at block 78,687,842, run on 3 October 2026 at 01:15 UTC:

```
$ A=https://robinhood.drpc.org; B=78687842
$ cast call --rpc-url $A --block $B 0xD625d488D552775D2867194C618B945E5dDfE097 'price()(uint256)'
333996135346627831262436878 [3.339e26]
$ cast call --rpc-url $A --block $B 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' | sed -n 2p   # AAPL feed answer
33382386412 [3.338e10]
$ cast call --rpc-url $A --block $B 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'
1000566080061092436 [1e18]
$ cast call --rpc-url $A --block $B 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' | sed -n 2p   # USDG/USD answer
100005000 [1e8]
$ python3 -c "
aapl, usdg, m = 33382386412, 100005000, 1000566080061092436
print(10**24 * aapl // usdg)
print(((aapl * 10**10 * m // 10**18) * 10**36 // (usdg * 10**10)) // 10**12)"
333807173761311934403279836
333996135346627831262436878
```

The oracle's price equals the second formula, the one with the multiplier, exactly. docs/research/gates-checks.md section 1.7 replays the NVDA oracle the same way at block 78,653,690.

#### Why it matters to integrators

Today the two oracles value the collateral 5.66 bps (AAPL) and 7.75 bps (NVDA) above the feed price, so positions reach liquidation later than the loan-to-value limit intends. The gap grows with every multiplier increase. Robinhood's docs say splits also go through the multiplier ("The multiplier accounts for corporate actions (dividends, splits)"), so after a 2-for-1 split applied that way these oracles would value the collateral at twice its price, and at the markets' 62.5 percent LLTV borrowers could take out more USDG than the collateral is worth.

#### Suggested fix

Deploy an oracle that uses the feed answer as it is, open new markets with it, and tell suppliers to move. Until then, suppliers to these two markets should know how the collateral is priced.

## Corrections to our own planning docs

### O1. Our planning document cited a G5 source pool that is not an NVDA pool

| Field | Value |
| --- | --- |
| Status | Corrected in docs/DECISIONS.md D-010 and docs/research/pools.md. Not an upstream issue. |
| Target | Sleeve's internal planning document, gate G5 and its source |

#### What was wrong

Our internal planning document cited https://dexpaprika.com/robinhood/pool/0xae1685599288831eb0844cb59058116ee3184b9a as "a USDG/NVDA v3 pool with about $6.9M liquidity". The pool pairs USDG with 0xE1E5f00A9B0255ca4dF85B3130eE0F77d15acC2D, a token whose name starts "Pushin'" and whose symbol is an emoji, at fee 10000, and its liquidity() is 0. That token is not among the 194 deployments in the issuer's assets API, and D-010 records the pool as a memecoin pool. DexPaprika's own API names the same base token, so the mistake was ours (docs/research/pools.md, "Mismatches with the PRD").

#### Evidence

Public RPC, 3 October 2026 at 00:45 UTC, head block 78,670,377.

```
$ P=0xae1685599288831eb0844cb59058116ee3184b9a
$ cast call --rpc-url $RPC $P 'token0()(address)'
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
$ cast call --rpc-url $RPC $P 'token1()(address)'
0xE1E5f00A9B0255ca4dF85B3130eE0F77d15acC2D
$ cast call --rpc-url $RPC $P 'fee()(uint24)'
10000 [1e4]
$ cast call --rpc-url $RPC $P 'liquidity()(uint128)'
0
$ jq '[.assets[].deployments[].contractAddress | ascii_downcase] | index("0xe1e5f00a9b0255ca4df85b3130ee0f77d15acc2d")' assets.json
null
```

#### Why it mattered

A reader of our planning material would have sized NVDA liquidity from a pool that holds none. Sleeve's NVDA pool is the fee-500 pool 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 (docs/DECISIONS.md D-010), and the cited pool is not on the allowlist.

#### Fix

Done. D-010 records the correction and pools.md has the evidence. The internal planning text still carries the old line and is not published.

## Checked and found consistent

These sources matched the chain, so there is nothing to file:

- Uniswap's SDK addresses for chain 4663 (Uniswap/sdks commit 17d70b1, `ROBINHOOD_ADDRESSES`): SwapRouter02's factory() is the v3 factory, QuoterV2 quotes work, and the Universal Router's creation block, 65,727,895, matches Sourcify (docs/research/chain-constants.md, section 1).
- Chainlink's directory addresses for the SPY, QQQ, NVDA, AAPL and USDG/USD feeds: each proxy's aggregator() equals the directory's contractAddress (docs/research/chain-constants.md section 4 and docs/research/gates-checks.md section 4).
- The four launch token addresses agree across the issuer's assets API, the issuer's Final Terms and the chain, and each token's uid() equals the API's id (docs/research/issuer-docs.md, section 3).
- EntryPoint v0.7 on Robinhood Chain has the same runtime code hash as on Ethereum mainnet (docs/research/chain-constants.md, section 2).
- USDG's decimals() is 6 and its EIP-2612 permit works in eth_call (docs/research/chain-constants.md, section 5).
- The Kernel v3.1 implementation, factory and meta factory match tag v3.1 byte for byte outside their immutables (docs/GATES.md, G6).
- block.number on Robinhood Chain returns an L1 estimate, as Robinhood's "Differences from Ethereum" page says (docs/research/chain-constants.md, section 2).

## Sources fetched on 3 October 2026

Times are UTC. Hashes are sha256 of the bytes received. HTML pages include build-specific markup, so their hashes can change between fetches without a text change.

| Source | Time | Bytes | sha256 |
| --- | --- | --- | --- |
| https://docs.robinhood.com/chain/stock-tokens | 00:20:57 | 42,948 | 4e410e4ffc0af9f70b43f3fa82038bd2349633f5b9b8d55c2d0cea8083af2317 |
| https://docs.robinhood.com/chain/stock-token-apis | 00:21:01 | 83,096 | 96a607aad7a9a92030d86da69b4210599b88488fa0c1adabb5172d91477ccead |
| https://docs.robinhood.com/chain/oracles-and-price-feeds | 00:21:04 | 48,636 | 43b490f0a870fea86b53271290b067850e034fa957bd2ccbf3a163f82b5bef1c |
| https://docs.robinhood.com/chain/contracts | 00:21:07 | 23,364 | fd31420cf2e89c8bab6a36446ad066672e8827b0c5dd3307c6d0f65320c292a3 |
| https://docs.robinhood.com/rhj/price-deviations | 00:21:10 | 16,955 | 7cb41923c395f9049416a068462e11ae07356679b0d1a64563e1af4c666a820f |
| https://docs.robinhood.com/chain/account-abstraction | 00:21:13 | 71,003 | ebf1b752e5cd3d62dd4511d8f0eb2abf7433d1237907216124f62b135d9a4400 |
| https://docs.robinhood.com/chain/building-with-stock-tokens | 00:21:17 | 76,578 | 3952f57bdc0a8f24ffe01af5484c0317d8b4cb6e500a5c232dab509c46864894 |
| https://docs.robinhood.com/chain/report-issue | 00:37:13 | 21,218 | 6630ac0df704554e6ddf20d29b984adb6223d46533266bf59e5d2d59cb39ea20 |
| https://docs.robinhood.com/chain/connecting | 00:43:23 | 34,814 | 2c44af10378a5d9cf87c4ee54d0a9209d6f6748b3f682a2c237ab059fe31388b |
| Docs bundle index-BQ4e_aJN.js | 00:24:16 | 1,397,448 | 134904335e37cd7f184806fc33d05f6eae1ce2ea51b9946371d08a6cd3ad67bd |
| Chunk index-DhgXFtCP.js (/chain/contracts) | 00:24:31 | 5,168 | 2fd17f26cf6bbc72daa945415b90e51d141893a89ddfba0c30f8aa6beaf3a986 |
| Chunk index-BmzZmhum.js (/rhj/price-deviations) | 00:24:34 | 5,448 | 78759636a1f46bd8dd1cc67dbbfb5e6c872b78077bfdd962b75c5c2fb2c2663f |
| Chunk index-CVScYfnJ.js (/rhj/corporate-actions) | 00:24:37 | 8,218 | bfde6ea673b5eaf2cbacf73e83985c8af22500e6727de471969c7bf5436a3034 |
| https://api.robinhood.com/rhj/assets | 00:22:52 | 162,103 | 3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c |
| https://api.robinhood.com/rhj/price-deviations | 00:25:44 | 966 | 00755ab8048498210ccf0a1227eb5f71e83931102e27f021a69c1cafb5e257dd |
| https://api.robinhood.com/rhj/corporate-actions | 00:47:27 | 26,020 | 5b07fd421411cb40be9ded5b9d0b9ed803bc3c3e418ac9e603e2b8315dd3bced |
| https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json | 00:21:57 | 84,653 | 714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776 |
| smartcontractkit/documentation main, l2-sequencer-feeds.mdx | 00:21:55 | 12,106 | 80e031c05af2887910b48a22e67086e73c5a000b6f4d8b0c8922e3a89f346594 |
| smartcontractkit/documentation main, data-streams/market-hours.mdx | 00:32:43 | 17,623 | 7e852d98dc1c916221b44b09c4d5a33c623794c335aad9499d9950627f0b3aa0 |
| smartcontractkit/documentation main, tokenized-equity-feeds/index.mdx | 00:32:43 | 21,671 | 1baaeedc7099d8f1187b8897f0912130b7682f0cd7a49eb535931549646dfd59 |
| ethereum/ERCs master, ERCS/erc-8056.md | 00:28:28 | 18,111 | fa64d2cb20e2f15828cb8b5d7c5c83cc6fd07c2a84b07f804d216a89bd1e5848 |
| ethereum/EIPs master, EIPS/eip-7951.md | 00:32:14 | 12,210 | ea599f929ceaa420d83fb90ac27a1370c2c1e150a339a68a15dc721d42d50323 |
| ethereum/ERCs master, ERCS/erc-7562.md | 00:43:50 | 34,625 | 7e8c7498dc736e0f33da2add5889707850c0742ad7cac8c37eefd6d7c40010d3 |
| https://docs.zerodev.app/onboarding/passkeys/overview | 00:18:41 | 340,846 | 8c17490e50acb9152bfc010bff66072f4708487c0b3600fc129c92275a4e717b |

In the commands above, `RPC` is https://rpc.mainnet.chain.robinhood.com. Send RPC calls one at a time with a pause between them, because the public endpoint challenges bursts (R10).
