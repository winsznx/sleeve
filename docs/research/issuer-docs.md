# Issuer docs: jurisdictions, canonical tokens, brand rules, copy facts

Research for PRD sections 3, 4, 7.12, 10 and 16. Everything was read on Friday 2 October 2026 between 14:54 and 15:17 UTC. The commands and their results are in section 8.

Quoting rules for this note. Text in a quote block is copied from the source. Runs of whitespace are collapsed to one space, which matters for the PDF quotes, where `pdftotext -layout` output wraps lines and pads justified text, and for one /chain/contracts sentence that wraps in the page source. Quotes keep the source's own characters, including curly quotes in the PDF quotes and the em dashes inside two quotes. Prose outside quotes follows the repo style. Every quote block in this note was checked by script against the downloaded sources and found as an exact substring after whitespace collapsing.

The disclosure text itself, its hashes and the choice between candidates are in docs/disclosure/README.md. The recommended file is docs/disclosure/rhj-disclosure.txt, keccak256 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89, sha256 9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc. The owner still has to confirm the choice of candidate 3.

## 1. How the issuer site was read

docs.robinhood.com is a Vocs static site. Page text is in the HTML the server sends, so curl gets the same words a browser shows. The site's main bundle https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index--FXM3_nW.js also carries each page's MDX source, URL-encoded, which gave a second copy of every page to check against.

Three tables on the site are filled in by the browser after load. The page HTML shows only a loading line ("Loading tokens…", "Loading current price deviations…", "Loading corporate actions…"). The page chunks name the data source for each:

| Page | Chunk | Data source in the chunk |
| --- | --- | --- |
| /chain/contracts | assets/index-C7gDoMED.js | `const b="https://api.robinhood.com/rhj/assets"` |
| /rhj/price-deviations | assets/index-n5UQrw8n.js | `const x="https://api.robinhood.com/rhj/price-deviations"` |
| /rhj/corporate-actions | assets/index-Rm0qLETY.js | `const C="https://api.robinhood.com/rhj/corporate-actions"` |

Those three endpoints were fetched directly with `accept: application/json`.

The Base Prospectus dated 25 June 2026 defines the Issuer Website as this site:

> “Issuer Website” The website maintained by the Issuer in relation to the Programme and the Products, accessible at: http://docs.robinhood.com/rhj, as may be updated from time to time.

Every response whose headers were saved, 15 fetches across docs.robinhood.com, api.robinhood.com, robinhood.com and cdn.robinhood.com, came from a CloudFront edge in Lagos (`x-amz-cf-pop: LOS50-P4` or `LOS50-P3`). The issuer site was reachable from Nigeria at retrieval time.

## 2. Restricted and prohibited jurisdictions

Source: https://docs.robinhood.com/rhj/restricted-jurisdictions, fetched 2026-10-02T14:54:35Z and again at 15:08:06Z, byte-identical both times, 16,406 bytes, sha256 c4d747394028d4bbc71e2f213538e9b26608b9c7c369f84be760748b6bdf4ef7. The raw HTML is saved at docs/disclosure/rhj-restricted-jurisdictions-page.html. The page has exactly these two paragraphs under its title:

> The offer, sale, distribution and delivery of the Products are subject to restrictions in certain jurisdictions, including, without limitation, the U.S., Canada, the United Kingdom, and Switzerland, as set out in the Base Prospectus and applicable Final Terms.

> The Products may not be offered, sold or delivered, directly or indirectly, in the United States or to, or for the account or benefit of, U.S. Persons or to Prohibited Investors. Prohibited Investors currently include investors in the following jurisdictions (which may be subject to change): Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, and Venezuela.

- Restricted, as named on the page, "including, without limitation": the U.S., Canada, the United Kingdom, Switzerland.
- Prohibited, 11: Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, Venezuela.

### Compared with PRD section 3

| PRD section 3 | Issuer | Result |
| --- | --- | --- |
| "Not a US person." | "may not be offered, sold or delivered, directly or indirectly, in the United States or to, or for the account or benefit of, U.S. Persons" | Partial. The issuer restricts by place (in the United States) as well as by person. The IP check in PRD 7.12 covers place. The attestation should cover both. |
| "Not resident in Canada, the United Kingdom or Switzerland, where offers are restricted." | The four names match. The list is open: "including, without limitation", "as set out in the Base Prospectus and applicable Final Terms". | Names match. The PRD reads the list as closed. The Base Prospectus names a fifth jurisdiction, the British Virgin Islands (below). |
| Prohibited: "Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, Venezuela." | The same 11 in the same order. | Exact match. |
| "The issuer can change this list, so Sleeve re-reads it from the issuer's page at every release" | "(which may be subject to change)" on the page. Base Prospectus Condition 31.6 adds that further restrictions can also arrive through Final Terms. | Match. The release check needs to cover the Final Terms too, see below. |
| "Nigeria is on neither the issuer's restricted list nor its prohibited list." | Nigeria is not named on the restricted jurisdictions page, the FAQ, the Use of Website page, the Base Prospectus or the Final Terms for SPY, QQQ, NVDA and AAPL (no "Nigeria" in any of them). | Holds. The Base Prospectus general rule still applies (Condition 31.1 below), so the legal review in PRD 7.12 still covers Nigeria. |

### Other issuer text on eligibility

FAQ, https://docs.robinhood.com/rhj/faq, fetched 2026-10-02T14:54:30Z:

> Stock Tokens are designed for global investors who want exposure to US capital markets. Stock Tokens are not available in the US or to US persons and are subject to restrictions in other jurisdictions, including Canada, the United Kingdom, and Switzerland. A full list of restrictions is available here.

> Due to regulatory restrictions, Stock Tokens are not available everywhere, including residents of the United States, Canada, the United Kingdom, or Switzerland.

Use of Website, https://docs.robinhood.com/rhj/use-of-website, fetched 2026-10-02T14:54:38Z. These are the confirmations a visitor gives for using the issuer's site, not conditions for holding a token, but they show how the issuer words the same groups:

> You are not a U.S. Person, or a Canadian, Swiss or United Kingdom person, nor are you a person subject to, and/or located in any jurisdiction which is subject to, any form of international sanctions (in particular as imposed by the EU, Switzerland, the United Nations, the United Kingdom, or the USA).

Base Prospectus, https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf, dated 25 June 2026, fetched 2026-10-02T15:00:03Z, sha256 e3b4697a4831723867f71caaf567af7cdd882bafcd1e1b39d7d5fd338916db46. From the front section titled "Restricted jurisdictions":

> In addition to the restrictions on the offer or sale of the Products and the distribution of offering material set out in the section of this Base Prospectus titled “General Sales Restrictions”, the Products may not be offered or sold at any time to Prohibited Investors. The Issuer may publish a list of restricted jurisdictions on the Issuer Website to indicate the jurisdictions in which offers or sales of the Products may be restricted from time to time on the basis that Investors in such jurisdictions will or may be Prohibited Investors, Restricted Parties or otherwise deemed to be high-risk. Access to the Issuer Website in these jurisdictions may be geo-restricted by the Issuer.

Definition of Prohibited Investor:

> Any Investor that is identified as a Restricted Party or who would otherwise, through its holding of or trading in the Products, in the opinion of the Issuer, act in breach of or fall subject to Sanctions Regulations, or risk exposing the Issuer or any Transaction Party to a breach of Sanctions Regulations.

Condition 27.2, what happens to a Prohibited Investor's tokens:

> Notwithstanding any other provision in these Terms and Conditions, Prohibited Investors shall have no rights of any nature under the Products, including the right to receive the Redemption Amount or any other payment from the Issuer, and neither the Issuer nor any Transaction Party (or any of their affiliates) shall have any obligations to any Prohibited Investor.

General Sales Restrictions name six places: United States, Canada, European Union and EEA, Switzerland, United Kingdom, British Virgin Islands. The ones that go beyond the docs page:

> The Products may not be offered, sold or otherwise made available directly or indirectly in Canada or to any resident of Canada.

> The Products, qualifying as structured products pursuant to Article 70 of the Swiss Financial Services Act (“FinSA”), may be offered exclusively to professional investors in accordance with Article 4 (3)-(5) FinSA.

> The Products may not be offered, sold or otherwise made available in or from within the British Virgin Islands unless such offer, sale or distribution is conducted in compliance with all applicable laws of the British Virgin Islands, including, where applicable, the requirement to be licensed or otherwise authorised under the Securities and Investment Business Act (as amended).

The United Kingdom section limits public offers to qualified investors, fewer than 150 persons, or other exempt cases. The EU and EEA section allows public offers under the Final Terms in the listed member states.

Condition 31, Selling Restrictions:

> No offers, sales, resales, or deliveries of any Products or distribution of any offering material relating to any Products may be made in or from any jurisdiction except in circumstances which will result in compliance with any applicable laws and regulations and which will not impose any obligation on the Issuer.

> The Products offered on primary and secondary markets and other platforms under the Base Prospectus are not for distribution to (1) any U.S. Person or any person or address in the U.S.; or (2) to a Prohibited Investor.

> The Issuer reserves the right to impose further selling restrictions at its sole discretion which will be communicated in the applicable Final Terms or on the Issuer Website.

Final Terms for the four launch tickers, all dated 25 June 2026, fetched 2026-10-02T15:16:22Z to 15:16:39Z (section 8 has the URLs and hashes). Each lists "Additional Selling Restrictions" as "None." and states:

> The Products are not marketed, offered, or solicited in the U.S., or in any other prohibited jurisdiction, nor to any Prohibited Investor.

What this means for the onboarding block list:

1. The 11 prohibited jurisdictions and the 4 named restricted ones match the PRD. Block all 15, by residence attestation and by IP.
2. The issuer's restricted list is open. The Base Prospectus also restricts offers in or from within the British Virgin Islands. Whether Sleeve blocks the BVI is an owner and legal call, flagged in the open questions.
3. Prohibited Investor is a sanctions test "in the opinion of the Issuer", and a Prohibited Investor's tokens carry no rights (Condition 27.2). A user who is sanctioned, or in a sanctioned place not on the list of 11, would hold tokens worth nothing to them. That supports keeping the onboarding screen's sanctions question even for countries not on the list.
4. The Base Prospectus says access to the Issuer Website "may be geo-restricted by the Issuer". The release-time re-read should fail loudly on any non-200 response and never fall back to the last saved copy.
5. Further restrictions can arrive through Final Terms (Condition 31.6). The release check should re-read the "Additional Selling Restrictions" line of the Final Terms for each allowlisted ticker, not only the docs page.

## 3. Canonical token contracts

Source: https://docs.robinhood.com/chain/contracts, fetched 2026-10-02T14:54:39Z, sha256 ead5c1e399a08fe69785d4652bc6b749bb1bdebda876f4ec0745fd72ea391437.

> Use the addresses on this page to identify the canonical Robinhood Stock Token for each underlying — a token with a matching name/ticker but a different contract address is not a Robinhood Stock Token.

The static table on the page lists two rows: WETH 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 and USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168. The stock token table sits under this line:

> The table below is generated live from the on-chain asset registry. Each symbol links to the token's contract on Blockscout.

The browser builds that table from https://api.robinhood.com/rhj/assets (section 1), not from a contract call. The page and its chunk name no registry contract address, so gate G3 stays PARTIAL. The response at 2026-10-02T14:57:25Z held 194 assets, each with exactly one deployment on chainId 4663, all with status ASSET_STATUS_ACTIVE, no duplicate symbols, and no HOOD entry.

The Final Terms for each launch ticker name the token contract as the Securities Ledger, in this form (SPY shown):

> The address of the smart contract serving as the Securities Ledger of the Products is: 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C.

| Ticker | Build contract and Chain4663.sol | Issuer API (`deployments[0].contractAddress`) | Final Terms ledger address | Onchain read, dRPC block 78,325,148 | Result |
| --- | --- | --- | --- | --- | --- |
| SPY | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | same | same | symbol "SPY", decimals 18, name "SPDR S&P 500 ETF Trust • Robinhood Token" | Match |
| QQQ | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 | same | same | symbol "QQQ", decimals 18, name "Invesco QQQ • Robinhood Token" | Match |
| NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC | same | same | symbol "NVDA", decimals 18, name "NVIDIA • Robinhood Token" | Match |
| AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 | same | same | symbol "AAPL", decimals 18, name "Apple • Robinhood Token" | Match |
| USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | not in the API (not an RHJ product) | not applicable | symbol "USDG", decimals 6, name "Global Dollar" | Match against the static table on /chain/contracts |

"Same" means an exact string match, checksum case included. For each of the four stock tokens, `uid()` onchain equals the API's `id`, and the API's `tokenSymbol`, `tokenName` and `tokenDecimals` equal the onchain `symbol()`, `name()` and `decimals()`:

| Ticker | API `id` and onchain `uid()` | ISIN (API and Final Terms, underlying) | Product ISIN (Final Terms) |
| --- | --- | --- | --- |
| SPY | 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1 | US78462F1030 | JE00BX9H9C78 |
| QQQ | 0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed | US46090E1038 | JE00BX9H9H24 |
| NVDA | 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5 | US67066G1040 | JE00BX9C6J83 |
| AAPL | 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649 | US0378331005 | JE00BX9H9M76 |

The feed addresses in the constants table are not on any issuer page and stay "verify". The "verify" basis on the four token rows can move to official: the issuer's API, the issuer's Final Terms and the chain agree.

## 4. Brand rules that bind a third-party app

Sources:

- Brand guidelines, https://docs.robinhood.com/chain/brand-guidelines, fetched 2026-10-02T14:54:42Z, sha256 79ee200c40d23e453294d09c9078741bb958078b868883f3c9a3b46155043334. The page says: "This Brand Guidelines is version 1.0, effective as of August 20th, 2026, and was last updated on August 20th, 2026."
- Terms of Service, https://docs.robinhood.com/chain/terms-of-service, fetched 2026-10-02T15:10:52Z, sha256 c75f8e73257816907b9eb90d9af724a4b7de725c80b9c2aecff19040df04eb3c, "Last Updated: August 24, 2026". The guidelines say all word mark use "is subject to the Terms", and Terms section 5.8(c) makes the guidelines part of the trademark license.

### Naming

> You must refer to the network exclusively as 'Robinhood Chain.' The shorthand 'Hood Chain' is prohibited in all external-facing content.

> You must not use "Hood Chain," "Chain," "Robinhood" on its own, or any other shorthand, abbreviation, or informal variant to refer to the network.

> In running text and external copy, write "Robinhood Chain" in the title case in every instance. Example: "Our application is deployed on Robinhood Chain."

> You may use your own house font, but you must not to italicize, underline, or otherwise style "Robinhood Chain" in a way that distorts the mark or fragments its components. For example, do not bold "Robinhood" while leaving "Chain" in regular weight, or render the two words in different colors.

> You must not refer to Stock Tokens as "tokenized stocks" or "tokenized equities." Use "Stock Tokens" in full. Approved alternative language: "tokenized real-world assets such as Stock Tokens."

Terms 5.7(j) repeats the last rule with "or similar characterizations".

### Logo and feather

> Only the Robinhood Chain logo from this guideline is authorized for chain partnership content. The Robinhood master logo should not be used.

> To maintain brand clarity, use this asset exclusively in designated symbol spaces such as app icons, favicon placements, and compact digital interface elements where the full Robinhood Chain wordmark logo would be impractical due to space constraints. Never substitute the standalone symbol for the primary Robinhood Chain logo.

> You must not use the Robinhood Chain marks in any AI-generated content, synthetic media, deepfakes, or digitally manipulated content that could create a false impression of Robinhood's involvement, endorsement, or sponsorship of any product, service, or statement.

> You must not incorporate the Robinhood Chain Marks, or any element of the Robinhood Chain brand identity, into the artwork, iconography, metadata, or smart contract attributes of any non-fungible token (NFT), digital collectible, or token.

The owner's directive already goes further than these rules: no Robinhood logo and no feather anywhere in Sleeve. Nothing in the guidelines requires a third-party app to show the logo.

### Partnership and endorsement language (Terms)

Permitted without asking, from 5.6(a):

> (i) compatibility or interoperability with the Robinhood Chain network (e.g., "Compatible with Robinhood Chain," "Deployed on Robinhood Chain," "Built on Robinhood Chain")

From 5.6(c), hackathon material is covered when it is informational:

> (iii) presentations, conference talks, workshops, or hackathon materials that reference the Robinhood Chain network in an informational context.

Conditions, from 5.7(b), (c) and (d):

> (ii) community-operated channels, websites, or initiatives must include a prominent disclaimer such as: "This [community/project/initiative] is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc."; and (iii) the Authorized User's own name, logo, or brand must be clearly displayed and must be more prominent than any use of the Robinhood Chain Marks in the Authorized User's materials.

> The Robinhood Chain Marks may not be the most prominent element of any third-party product name, service name, or company name. The Authorized User's own branding must be the primary identifier.

> Authorized Users may not use the Robinhood Chain Marks, or any marks confusingly similar thereto, as part of their own trademark, trade name, service mark, logo, domain name, social media handle, token name, or other distinctive identifier.

Needs Robinhood's written consent, from 5.11:

> (b) claiming Robinhood sponsorship, endorsement, partnership, or certification of any product or initiative;

> (d) incorporating the Robinhood Chain Marks into advertising or promotional campaigns beyond factual identification statements permitted under Section 5.6(a);

Messaging limits, from the guidelines:

> You must not tag @RobinhoodApp in content related to Robinhood Chain partnerships; tag @RobinhoodCrypto instead.

> You must not reference $HOOD (or HOOD) in any context. This is a stock ticker and is subject to regulatory restrictions.

> You must not include projected, estimated, or forward-looking figures in co-marketing content. Only reference verified historical data.

> Any statistic included in external-facing content should come with a clear explanation of how it was derived, either within the copy or in a footnote. Please include: what is being measured, the exact time period covered, the data source (with an explicit mention and link) to make the figure verifiable. Example: "[App] surpassed [metric] on [date], according to [source, linked]."

### Colors

The guidelines give three logo pairings and no other palette:

> Black on white (#000000 on #ffffff)

> White on black (#ffffff on #000000)

> Black on Robin Neon (#000000 on #ccff00)

Hex colors seen on Robinhood's own pages on retrieval day, with hue and contrast computed here (WCAG 2 relative luminance, contrast against #FFFFFF):

| Color | Hex | Where seen | Hue | Contrast on white |
| --- | --- | --- | --- | --- |
| Robin Neon | #CCFF00 | The guidelines' third pairing. 17 uses in the docs site stylesheet (assets/style-DIQDqWCy.css), mostly the dark-theme accent, link and border colors, for example `--vocs-color_backgroundAccent: #CCFF00`. 20 uses on https://robinhood.com/us/en/ | 72 degrees | 1.18 |
| Neon variants | #BEF200, #E7FF38, #B1E500 | Docs site stylesheet, accent borders | 67 to 74 degrees | 1.12 to 1.49 |
| Near-black | #110E08 | Docs site stylesheet, 24 uses, including the light-theme accent and link color. robinhood.com/us/en/, 16 uses, 2 of them with an alpha channel | 40 degrees | 19.26 |
| Warm neutrals | #35322D, #4D4A46, #888784, #BFBFBF, #D9D9D9, #F2F2F2 | Docs site stylesheet. All but #F2F2F2 also on robinhood.com/us/en/ | Low saturation, read as grey | 12.76 for #35322D, 8.81 for #4D4A46 |
| "Robinhood Green" | #00C805 | Not on robinhood.com/us/en/, the docs site or its stylesheet on retrieval day. A third-party logo page, https://www.designyourway.net/blog/robinhood-logo/, says "Primary Color: Robinhood Green Hex: #00C805 RGB : (0, 200, 5)" | 121 degrees | 2.27 |

The brand rules govern the marks only. They say nothing about a third party's own palette. Keeping Sleeve's green distinct is the owner's rule (D-005), so the check below is a suggestion, not an issuer requirement:

1. Every green used for text or controls has contrast of at least 4.5 to 1 on white. That alone puts it far darker than #CCFF00 (1.18) and #00C805 (2.27).
2. Keep the whole green scale, tints included, out of the 60 to 90 degree hue band where Robin Neon and its variants sit, so light tints never read as neon.
3. Keep the hue at 150 degrees or more, so the darker steps read as a blue-leaning green and not as a darker #00C805 at 121 degrees.

## 5. Price deviation facts

Source: https://docs.robinhood.com/rhj/price-deviations, fetched 2026-10-02T14:54:33Z, sha256 7949d0aa42b2d2b7decb94c457ed83fca60a1c7d10cb37c2f8ea20ece1985048.

> A price deviation occurs when a Stock Token trades at a significant premium or discount to the expected price of its underlying asset. Robinhood discloses a deviation on this page when a token's on-chain price differs from its underlying's reference price by 5% or more for seven consecutive trading days.

> On-chain token prices can deviate for a variety of factors, including differences in liquidity, variances in mint and burn pricing, and market conditions.

> Deviations are assessed at the end of each business day (five days a week), comparing the NYSE closing price for the underlying — benchmarked to the nearest block — against the average on-chain price from a reputable source over the trailing seven-day period.

Current list, https://api.robinhood.com/rhj/price-deviations at 2026-10-02T14:57:27Z, `"asOf":{"year":2026,"month":10,"day":1}`, two rows:

| tokenSymbol | nyseClosePrice | onchainPrice | deviationPct | direction | consecutiveDays | firstObserved |
| --- | --- | --- | --- | --- | --- | --- |
| SATS | 88.25 USD | 1440.8899423779583 USD | 1532.7364786152502 | DEVIATION_DIRECTION_PREMIUM | 14 | 2026-09-14 |
| WEEK | 100.02 USD | 49.9022779925453743 USD | 50.10770046736115 | DEVIATION_DIRECTION_DISCOUNT | 14 | 2026-09-14 |

None of SPY, QQQ, NVDA or AAPL is on the list.

Against PRD section 4 ("the issuer only discloses deviations of 5 percent or more that persist for seven trading days"): the threshold and the length match, and the issuer adds "consecutive". The issuer's measure is end-of-day, five days a week, NYSE close against a trailing seven-day average of an on-chain price from an unnamed "reputable source". Sleeve's receipt premium is a different number: the all-in execution price of one fill against the Chainlink answer at that moment. Copy has to keep the two apart. A receipt premium is never "the issuer's price deviation", and a ticker missing from the issuer's list does not mean a fill had no premium.

Small upstream bug for the PRD 24.8 list: the page's table maps `direction` with the keys `PREMIUM`, `DISCOUNT` and `PAR`, but the API returns `DEVIATION_DIRECTION_PREMIUM` and `DEVIATION_DIRECTION_DISCOUNT`. As shipped, the page would show the deviation without a plus or minus sign and a dash placeholder instead of "Premium" or "Discount" in the Direction column. The corporate actions table strips its enum prefix and does not have this problem.

## 6. Holder facts for receipt and holding copy

FAQ, https://docs.robinhood.com/rhj/faq, fetched 2026-10-02T14:54:30Z, sha256 a6e0c3873dc3e951d3158e7646bd718c8c3688da2e36071bb84f36e83cf2dd31. The answers the copy depends on, verbatim:

> Stock Tokens are tokenized debt securities issued by Robinhood Assets (Jersey) Limited. They provide economic exposure to underlying securities but do not grant investors any legal or beneficial rights in, or against the issuer of, those underlying securities.

> Where available, you can discover and swap Stock Tokens through Robinhood Wallet, decentralized exchanges (DEXs), or centralized exchanges (CEXs).

> Yes. Every single Stock Token in circulation is backed 1:1 by the corresponding underlying equity. The underlying shares are held securely by our US-based custody partner.

> Instead of distributing cash dividends, a multiplier mechanism is used. When an underlying company pays a dividend, the dividend is automatically reinvested to purchase more shares of that stock. Instead of receiving a cash payout, your token's multiplier increases. This means your token dynamically represents more than one share of stock over time.

> Yes. You can sell your Stock Tokens from time to time in the secondary market. You can also redeem them directly with the Issuer, where there is no authorized participant (a firm that processes redemptions on investors' behalf), subject to completing the Issuer's KYC/AML (identity verification) processes.

> Your Stock Tokens are backed 1:1 by the underlying shares, held by a licensed custodian. In the unlikely event of the Issuer's insolvency, an independent security agent will sell the underlying shares, and arrange for the cash proceeds to be paid to token holders.

Product page, https://docs.robinhood.com/rhj/product, fetched 2026-10-02T14:54:29Z, product details list:

> Block confirmations for a legal transfer: 1

> 0.00% (zero) for token purchase/subscription

> 0.00% (zero) for token redemption for the first 90 (ninety) days from the date of issuance

> 0.05% for token redemption after the date falling 90 (ninety) days after the date of issuance

Service providers, https://docs.robinhood.com/rhj/service-providers, fetched 2026-10-02T14:54:37Z, names the custodian the FAQ refers to:

> Broker and Custodian: Alpaca Securities LLC, 12 E 49th Street, Floor 11, New York, NY 10017, USA.

Base Prospectus on redemption and on the issuer's powers:

> Investors may only redeem the Products directly with the Issuer where (a) one or more of the Direct Investor Redemption Conditions have been met; and (b) the relevant Investor has successfully completed the Issuer’s KYC/AML processes.

> Investors are not entitled to physical delivery of the Underlying. Investors’ interests under the Products are instead settled in cash in the Specified Currency (without prejudice to any exchanges effected by an Authorised Participant on behalf of an Investor), in the event of a redemption or termination of the Products.

Condition 27.1 lets the issuer, after a Sanctions Event, "declare any sale or transfer, or any purported sale or transfer, of any Product to be null and void" and:

> freeze, block, seize, transfer, redeem and/or recreate the token representing the relevant Products, in the manner the Issuer deems necessary or appropriate in the circumstances and in compliance with applicable law and regulation.

Corporate actions, https://docs.robinhood.com/rhj/corporate-actions, fetched 2026-10-02T14:54:36Z:

> Trading in an affected Stock Token is typically paused while a corporate action is processed. In most cases, placing new orders is unavailable from the early morning on the effective date (around 2 AM CET/CEST) and resumes once processing is complete, typically by the start of the US market day (around 3:30 PM CET/CEST).

The corporate actions API at 2026-10-02T14:57:28Z and the assets API at 14:57:25Z, for the launch tickers:

| Ticker | Corporate action | Status | processDate | Rate | currentMultiplier | pendingMultiplier |
| --- | --- | --- | --- | --- | --- | --- |
| NVDA | CASH_DIVIDEND | IN_PROGRESS | 2026-10-01 | 0.25 | 1.000775159164630595 | empty |
| QQQ | CASH_DIVIDEND | IN_PROGRESS | 2026-10-08 | 0.75143 | 1.000700791241405425 | empty |
| SPY | CASH_DIVIDEND | IN_PROGRESS | 2026-10-30 | 1.888834 | 1.001717991187472003 | empty |
| AAPL | none listed | | | | 1.000566080061092436 | empty |

Type and status values are shown without the API's `CORPORATE_ACTION_TYPE_` and `CORPORATE_ACTION_STATUS_` prefixes. The NVDA action is in progress during the M0 build. The QQQ and SPY dates fall after the 4 October deadline, inside M1.

### PRD section 10, the five holder questions, checked against the issuer

| Question | PRD 10 answer | Issuer source | Result |
| --- | --- | --- | --- |
| Who stands behind it | Robinhood Assets (Jersey) Limited, named in the disclosure | /rhj "Issuer name: Robinhood Assets (Jersey) Limited". Named in candidate 3. | Match |
| What it is | A debt security giving economic exposure, no rights in or against the underlying issuer | FAQ first answer, /rhj/product first paragraph | Match |
| Transfers | Moves like any ERC-20. Sleeve does not claim the issuer cannot restrict it | "Block confirmations for a legal transfer: 1". Base Prospectus 27.1 lets the issuer void transfers and freeze, block or seize tokens. | Match, and 27.1 is the citation for the "issuer can restrict" line |
| Economics | Balance times multiplier, dividends reinvested, price drifts above the share price | FAQ dividends answer | Match |
| Exit | "Holders do not redeem with the issuer and Sleeve offers no redemption into shares" | FAQ: "You can also redeem them directly with the Issuer, where there is no authorized participant". Base Prospectus: direct redemption only when the Direct Investor Redemption Conditions are met and KYC/AML is done, settled in cash. Product page: redemption fee 0.00% for the first 90 days from issuance, 0.05% after. | Mismatch. "Holders do not redeem with the issuer" is wrong as written. "No redemption into shares" is right. |

A wording that fits the issuer's text, for the owner to accept or change: "Exit: sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and it pays cash, not shares. Sleeve offers no redemption."

## 7. Mismatches and copy risks

Against the PRD:

1. PRD 10 "Exit" says holders do not redeem with the issuer. The FAQ and the Base Prospectus say they can, under conditions. Section 6 has the detail.
2. PRD 3 treats the restricted list as four countries. The issuer's list is open, and the Base Prospectus adds the British Virgin Islands. Section 2.
3. PRD 3 says "Not a US person". The issuer also restricts any offer made in the United States, whoever the person is.
4. PRD 4 says "seven trading days". The issuer says "seven consecutive trading days".
5. The PRD 13 constants table and the build contract mark the SPY, QQQ and NVDA token addresses "Integrator copy, verify" or "verify", and AAPL's as matching Robinhood's API example. The issuer API, the Final Terms and the chain all agree on all four, so the basis can be official. Feeds stay "verify".
6. PRD 24.8 lists upstream doc issues. Add the price deviation direction bug from section 5.

Copy risks against the brand rules and Terms:

1. Write "Stock Token" or "Stock Tokens", capitalized. The PRD and the build contract use lower-case "stock token", which is fine inside internal docs but not in UI, README or video copy.
2. Never "tokenized stocks" or "tokenized equities", or anything similar. PRD section 5 says "Chainlink tokenized equity feed". That is Chainlink's product name, but in copy it sits close to a banned phrase. "The Chainlink price feed for the Stock Token" avoids it.
3. The PRD 24.6 line "part dollars and part US stock" calls the token stock, which also breaks the build contract's rule against calling it stock ownership. If it is used in the video it needs rewording, for example "part dollars and part Stock Token".
4. "Robinhood Chain" in full, title case, one style for both words. Never "Hood Chain", "Chain" alone, or "Robinhood" alone for the network.
5. The production domain, social handles and any token or contract name must not contain "Robinhood Chain" or anything confusingly similar (Terms 5.7(d)). This bears on the open "production domain" input in docs/PROGRESS.md, because the passkey relying-party id is tied to it.
6. Sleeve's own name must be more prominent than any Robinhood Chain mention, and the safe pattern is a factual line such as "Built on Robinhood Chain". Add a disclaimer in the 5.7(b) form, for example "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.", on the site, the README and the video end card.
7. No "partner", "partnership", "official" or "endorsed" wording about Robinhood or Robinhood Chain without written consent (Terms 5.11(b)).
8. No HOOD or $HOOD anywhere. HOOD is not in the issuer's asset list today, so the ticker picker cannot show it now. A list-driven picker should still exclude it.
9. Any Robinhood Chain statistic in the README or video needs what was measured, the exact period, and a linked source, and must stay separate from Robinhood or Robinhood Crypto numbers. PRD 2 cites chain figures from news sources (S26), so those lines need the period and the link next to them.
10. Milestone targets in PRD 19 are forward-looking. Keep them out of anything that reads as co-marketing with Robinhood Chain.
11. No Robinhood Chain marks in AI-generated or edited imagery, and none on receipt cards. Cards are images, not tokens, but the AI-media rule applies to the video and any generated art.
12. If the app quotes the FAQ's multiplier answer, note that it says the token "represents more than one share of stock over time". The I12 lint over UI strings should allow quoted issuer text and still block Sleeve's own copy from calling the token a share.
13. When Sleeve tags Robinhood on social media in Robinhood Chain content, tag @RobinhoodCrypto, never @RobinhoodApp.
14. The Terms' trademark license covers the Robinhood Chain Marks only, and says they "do not include the ROBINHOOD word mark used in connection with Robinhood's brokerage, financial, or consumer products". Copy that names the product can say "Stock Tokens issued by Robinhood Assets (Jersey) Limited", the issuer's own legal name, which needs no license. Whether "Robinhood Stock Tokens" is fine as a plain reference is a question for the legal review in PRD 7.12.

One fact outside this note's scope that affects the build. Terms section 2 says "The Robinhood Chain Public RPC is subject to rate limits and is not intended for production-grade, high-throughput, or latency-sensitive applications." During this research the public RPC began answering HTTP 403 with a Cloudflare "Just a moment..." page after about 15 quick calls at 15:04 UTC, and the reads were finished on dRPC. D-008 puts the verifier on the public RPC. The verifier makes few calls, but it should back off and report a provider block as a block, not as a receipt mismatch.

## 8. Commands and results

All times UTC on 2026-10-02. Raw downloads went to a scratch folder except the three pages saved under docs/disclosure/.

| Time | Command | Result |
| --- | --- | --- |
| 14:54:00 | `curl -sS -L -D rhj.headers -o rhj.html -w 'http=%{http_code} size=%{size_download} url=%{url_effective} type=%{content_type}\n' 'https://docs.robinhood.com/rhj'` | 301 to /rhj/, then http=200 size=21718, sha256 44e5406175a43a2a8b4039db99fab4a8aea153f23e7f8aa05de5082f3132f298 |
| 14:54:29 to 14:54:42 | `curl -sS -L -D $n.headers -o $n.html -w 'http=%{http_code} size=%{size_download} url=%{url_effective}' "https://docs.robinhood.com/$p"` for each page below | all http=200 |
| 14:54:29 | p=rhj/product | 19526 bytes, sha256 fdb120afd642683ce60e83913e0719efe172d9094dc9422f2a29b97a4fb830c0 |
| 14:54:30 | p=rhj/faq | 21656 bytes, sha256 a6e0c3873dc3e951d3158e7646bd718c8c3688da2e36071bb84f36e83cf2dd31 |
| 14:54:33 | p=rhj/price-deviations | 16955 bytes, sha256 7949d0aa42b2d2b7decb94c457ed83fca60a1c7d10cb37c2f8ea20ece1985048 |
| 14:54:35 | p=rhj/restricted-jurisdictions | 16406 bytes, sha256 c4d747394028d4bbc71e2f213538e9b26608b9c7c369f84be760748b6bdf4ef7 |
| 14:54:36 | p=rhj/corporate-actions | 17756 bytes, sha256 b196a0655e85fc5f167d839f5810425471409f8728dff5605eb1bdf85b1ff8da |
| 14:54:37 | p=rhj/service-providers | 16615 bytes, sha256 12dab7bf749e1cdf99bcaee3435dbb201784361f761494bf84459beee54764cb |
| 14:54:38 | p=rhj/use-of-website | 19116 bytes, sha256 cafa21bcecc6ab12c950974036325f52fd95d7bcdbd85f01b0d4ade658f15f89 |
| 14:54:39 | p=chain/contracts | 23364 bytes, sha256 ead5c1e399a08fe69785d4652bc6b749bb1bdebda876f4ec0745fd72ea391437 |
| 14:54:42 | p=chain/brand-guidelines | 37995 bytes, sha256 79ee200c40d23e453294d09c9078741bb958078b868883f3c9a3b46155043334 |
| 14:55:47 | `curl -sS -o index.js 'https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index--FXM3_nW.js'` | http=200, 1397448 bytes, sha256 3af7bd5503c31a67c744cccbf552845555e0576855476ae04838f323ea7da22c |
| 14:56:57 to 14:57:03 | `curl -sS -o chunks/$c "https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/$c"` for c in index-C7gDoMED.js, index-n5UQrw8n.js, index-Rm0qLETY.js | http=200. sha256 8c361432fc132b913681b5a6af581046a8407124d0280e19cf2a044819e2e3e8, 664be04b3512dc9b0ce2bfdc6bcd0911e104e8fcbf7cef3bbae023435d2176c7, 8b01b515c679dd74c20b6716b09592c8583dd87e1e653553ff4e11139d9b5396 |
| 14:57:25 | `curl -sS -H 'accept: application/json' -D api_assets.headers -o api_assets.json "https://api.robinhood.com/rhj/assets"` | http=200, 162103 bytes, sha256 3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c |
| 14:57:27 | same form, `https://api.robinhood.com/rhj/price-deviations` | http=200, 966 bytes, sha256 00755ab8048498210ccf0a1227eb5f71e83931102e27f021a69c1cafb5e257dd |
| 14:57:28 | same form, `https://api.robinhood.com/rhj/corporate-actions` | http=200, 26020 bytes, sha256 8bb7ced2511b9b732a5cf90bd8524a997d3f95863ef54a4f0fd501044ec91839 |
| 14:59:50 | `curl -sS -L -D eu_legal_rhj.headers -o eu_legal_rhj.html 'https://robinhood.com/eu/en/legal/rhj/'` | http=200, 336127 bytes, 204 PDF links |
| 15:00:03 | `curl -sS -D bp.headers -o rhj_base_prospectus.pdf 'https://cdn.robinhood.com/assets/robinhood/legal/rhj_base_prospectus.pdf'` | http=200, 1600342 bytes, last-modified Wed, 02 Sep 2026 20:06:38 GMT, sha256 e3b4697a4831723867f71caaf567af7cdd882bafcd1e1b39d7d5fd338916db46 |
| 15:03:00 | `curl -sS -o docsite.css 'https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/style-DIQDqWCy.css'` | http=200, 87427 bytes, sha256 71fdb034ea9d20ca00ccbe4ad7a6fa51a22b2c802f3ad5dbe75386abde607e5c |
| 15:03:35 | `curl -sS -L -o rh_home.html 'https://robinhood.com/us/en/'` | http=200, 283156 bytes, sha256 e0d28b466a7b93850c463e853b28de61d62b8bf204cbd3631de0aebeb7ae381d |
| 15:04:05 | `curl -sS -L -A 'Mozilla/5.0' -o dyw.html 'https://www.designyourway.net/blog/robinhood-logo/'` | http=200, 121322 bytes |
| 15:04:53 | `cast block-number --rpc-url https://rpc.mainnet.chain.robinhood.com`, then `cast call --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78324337 <token> 'symbol()(string)'` and the same for name, decimals and `uid()(bytes32)` | block 78324337. SPY and QQQ returned all four values in section 3, NVDA symbol, name and decimals, AAPL symbol and name, all equal to the dRPC reads. The next calls failed, first with "error sending request" and then with HTTP 403 and a Cloudflare challenge page. |
| 15:06:14 | `cast block-number --rpc-url https://robinhood.drpc.org`, then `cast call --rpc-url https://robinhood.drpc.org --block 78325148 <token> '<sig>'` for sig in `symbol()(string)`, `name()(string)`, `decimals()(uint8)`, `uid()(bytes32)`, 0.4 s apart | block 78325148. All five tokens returned the values in section 3. |
| 15:08:01 to 15:08:06 | `curl -sS -L -o "docs/disclosure/<file>" -w 'http=%{http_code} size=%{size_download} url=%{url_effective}' "<url>"` for /rhj, /rhj/product, /rhj/restricted-jurisdictions | http=200, byte-identical to the 14:54 fetches |
| 15:10:52 | `curl -sS -L -o chain_terms-of-service.html -w '...' "https://docs.robinhood.com/chain/terms-of-service"` | http=200, 134855 bytes, sha256 c75f8e73257816907b9eb90d9af724a4b7de725c80b9c2aecff19040df04eb3c |
| 15:10:55 | same form, `https://docs.robinhood.com/chain/stock-tokens` | http=200, 42948 bytes, sha256 853e8db4bf17444a35f144e43d077b0a9b3876ef62db6c962d54575cdaa4301e |
| 15:16:22 to 15:16:39 | `curl -sS -o ft/$n.pdf "https://cdn.robinhood.com/assets/robinhood/legal/rhj_final_terms_for_tokenised_debt_securities_linked_to_$n.pdf"` for n in spdr_s_p_500_etf_trust, invesco_qqq, nvidia, apple, then `pdftotext -layout` | http=200. sha256 937fea1bf9af43c1a426b108723198849b85213039b1ca60e38121570a7b0cf5 (SPY), c64d6b60cb543ac8160e2fbc96cf0ccbd395164d4ad72c20b3cdb861f4d67121 (QQQ), 75e5bdd6db275b0482c9df28e387357b3e517890a20f26b921f8c422c31ae0f4 (NVDA), be329df5175bb749d06b2ae623489921c0fe919a8fe6c08a65a1f8cd2d245a02 (AAPL) |

The chunk-to-endpoint mapping in section 1 was read straight from the downloaded chunk files. The route table that maps each page to its chunk is in index.js, in entries of the form `{lazy:()=>ge(()=>import("./index-C7gDoMED.js"),[],import.meta.url),path:"/chain/contracts",type:"mdx",...}`.
