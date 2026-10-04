# Icon system

How Sleeve pictures tokens, the network and UI actions. It takes the owner's rules from Bespeak, the container sizes from closeout, and applies both under Sleeve's brand rules (internal/CLAUDE.md, PRD 7.12). Sources are cited by file and line. Paths starting `bespeak/` are under /Users/mac/bespeak, `brand/` under /Users/mac/Downloads/bespeak-brand-system, `closeout/` under /Users/mac/closeout/apps/web.

Files that implement this document:

| File | Job |
| --- | --- |
| app/scripts/sync-icons.ts | Walks the source ladder, runs the brand guard, downloads, checksums, writes the manifest. Fails loudly. |
| app/public/assets/icons-manifest.json | Provenance for every icon, and the evidence for every withheld one. Written only by the script. |
| app/public/assets/tokens/ | The local copies the app serves. Nothing is hotlinked. |
| app/src/components/token/registry.ts | Reads the manifest. `tokenVisual`, `tokenLabel`, `tokenShape`, `tokenSymbol`, `tokenLogo`, `TOKEN_KEYS`. |
| app/src/components/token/token-icon.tsx | `TokenIcon`, the only way a token is drawn. |
| app/src/components/token/token-stack.tsx | `TokenStack` and `TokenPair` for overlapping icons. |
| app/src/components/token/glyphs.tsx | `NetworkGlyph` and `StockTokenGlyph`, the two neutral marks. |
| app/src/components/token/*.test.ts(x) | 28 tests over the manifest, the files on disk and the components. |

## 1. The owner's rules, from Bespeak

### 1.1 Real logos only, no letter badge

bespeak/packages/assets/src/icons.ts lines 3 to 6: "Every supported asset must ship a real logo. There is deliberately no letter-badge fallback in the production path: if one of the shipped assets cannot resolve, the sync fails loudly so it can be investigated and pinned rather than quietly degrading into a coloured square with a ticker in it."

The UI side holds the same line. bespeak/apps/web/src/lib/identity.ts lines 15 to 22: `iconFor` returns null only for a key missing from the manifest, and "a null here in production means a real regression worth surfacing, not an expected fallback." Callers render `{src && <Logo .../>}` and print no initials (bespeak/apps/web/src/components/identity/AssetIdentity.tsx line 35).

Closeout breaks this rule once: its Stripe provider mark is the letter S (closeout/app/(marketing)/site/page.tsx line 12). Sleeve follows Bespeak here, because Bespeak is the owner's stated icon policy and closeout's mark is a marketing illustration, not an asset identity.

### 1.2 The source ladder

bespeak/packages/assets/src/icons.ts lines 8 to 17, highest rung first:

1. ISSUER. The issuer's own asset metadata (for Bespeak, the xStocks CDN `logo` field).
2. CONTRACT. CoinGecko onchain metadata through GeckoTerminal, looked up by the exact contract address and never by ticker, because "TSLA, TSLAx and any number of impostor tokens share a symbol" (lines 12 to 13).
3. CHAIN_LIST. ethereum-lists/chains, for network and native gas identity.
4. PINNED. A manually verified source, recorded with its URL and the reason.

### 1.3 Checksummed local copies and a provenance manifest

bespeak/packages/assets/src/sync-icons.ts lines 15 to 19: production must not depend on third-party hotlinks, so "everything is pinned, checksummed and committed." Each manifest entry (icons.ts lines 19 to 32) records `sourceUrl`, `sourceKind`, `note` for pins, `retrievedAt`, `checksum` (sha256 of the bytes, "so a silent upstream swap is detectable"), `bytes` and `localPath`. A download under 400 bytes is rejected as suspicious (sync-icons.ts line 37). Hand pins survive a re-sync (lines 79 to 84).

### 1.4 The sync fails loudly

bespeak/packages/assets/src/sync-icons.ts lines 21 to 22 and 171 to 176: any shipped asset without a real icon prints `FAILED, every shipped asset must have a real icon`, lists each failure, tells the operator to pin a verified source, and exits 1.

### 1.5 Logo normalisation

bespeak/apps/web/src/components/identity/Logo.tsx:

- Official marks are never recoloured (lines 3 to 9).
- Fixed square, `object-fit: contain`, centred (line 43).
- Equity tiles use radius `round(size * 0.28)` (line 23). Payment tokens and the network are discs, radius `px / 2` (TokenIdentity.tsx lines 31 and 61).
- A 1 px inset hairline, `inset 0 0 0 1px var(--line-2)`, only on marks whose own plate would vanish into the surface (Logo.tsx line 34; the list is `DARK_PLATE_KEYS`, identity.ts line 30).
- Images load unoptimized from the local copy (Logo.tsx line 44).

### 1.6 Sizes and where they sit in Bespeak

| Component | Sizes in px | Use (cited) |
| --- | --- | --- |
| AssetIdentity | compact 24, row 34, header 44, hero 60 | tables, order and activity rows, page headers, asset page and landing (AssetIdentity.tsx lines 6 and 10 to 11) |
| TokenIdentity | xs 16, sm 20, md 26, lg 34 | xs in tables and inline beside amounts, md in transaction flows (TokenIdentity.tsx lines 4 and 6 to 8) |
| NetworkIdentity | 15 in the connect button, 18 default | the network mark with a separate 5 px status dot (TokenIdentity.tsx lines 49 to 76, ConnectButton.tsx line 82) |

Placement rules Bespeak follows: the icon is always left of the text it names, with gap 8 px at compact and row sizes and 16 px at hero (`row g2`, `row g3`, `row g4`). When the text beside it names the asset, the image alt is empty (AssetIdentity.tsx line 35); when the icon stands alone it carries the name (TokenIdentity.tsx line 29). The payment token always carries its mark "where a user is deciding what they are about to spend" (TokenIdentity.tsx lines 6 to 8). A status dot is never the identity (lines 47 to 48).

### 1.7 UI line icons in Bespeak

bespeak/apps/web/src/components/ui/Icon.tsx lines 3 to 6 and 36 to 45: 18 px grid, `stroke-width` 1.5, round caps and joins, `fill: none`, `currentColor`, `aria-hidden`, `focusable="false"`. The set is "deliberately narrow, navigation and a handful of controls only. Icons are not sprinkled onto every action."

### 1.8 Brand pack rules that bear on icons

- App icon: a 1024 square with corner radius 224, which is 21.9 percent (brand/02-app-icons/bespeak-app-icon.svg line 2).
- Avoid "random charts, fake metrics, coins, chain links, stock arrows, glass panels, and generic crypto glow" (brand/05-guidelines/design.md line 43).
- Prefer "real product screenshots, product state, receipts" (design.md line 46).
- Partner marks get equal weight "only for true partnerships" (design.md line 49).

## 2. Closeout's containers

Sleeve's layout follows closeout, so its icon containers set Sleeve's sizes and radii.

| Closeout class | Size | Radius | Fill and edge | Cite |
| --- | --- | --- | --- | --- |
| `.m-provider` | 34 | 11 (32 percent) | white, 1 px `var(--border)`; inner svg 18 | closeout/app/(marketing)/site/marketing.css lines 673 to 687 |
| `.workspace-avatar` | 34 | 11 | brand fill, white text | closeout/app/product.css lines 51 to 61 |
| `.m-float-card .m-float-mark` | 42 | 13 (31 percent) | tinted soft fill | marketing.css lines 278 to 287 |
| `.dash-stat-icon` | 42 | 13 | white, ink-secondary glyph | product.css lines 427 to 436 |
| `.m-feature-icon` | 52 | 999 | white, accent glyph at 21 px | marketing.css lines 1072 to 1082 |

Closeout's own line icons: 1.5 stroke at 16 px (product.css line 340), 1.6 at 12 px (product.css line 806), 1.6 on the 24 grid (page.tsx line 18).

## 3. Sleeve's constraints

- No Robinhood logo, feather or brand colors; nothing in hue 60 to 90 such as #CCFF00, nothing in the #00C805 family (internal/CLAUDE.md, run overrides).
- "Follows Robinhood Chain brand guidelines. No implied partnership or endorsement." (PRD 7.12).
- "Robinhood Chain" and "Stock Tokens" in full. A Stock Token is never a share.

These collide with the ladder for the four launch Stock Tokens. See section 5.

## 4. How Sleeve applies it

### 4.1 Sizes

`TOKEN_ICON_PX` in token-icon.tsx:

| Size | px | Tailwind | Source | Use in Sleeve |
| --- | --- | --- | --- | --- |
| xs | 16 | `size-4` | Bespeak TokenIdentity xs | inline in a sentence or a table cell, beside an amount |
| sm | 20 | `size-icon` (`--size-icon` 1.25rem) | Bespeak TokenIdentity sm, Sleeve line-icon size | chips, the rule editor's ticker chips, the split rail legend |
| md | 24 | `size-6` | Bespeak AssetIdentity compact | list rows (inbox, holdings, receipts list), default |
| lg | 34 | `size-avatar` (`--size-avatar` 2.125rem) | closeout `.m-provider`, Bespeak row | holding and receipt detail headers, card rows, chain badge allowed |
| xl | 42 | `size-icon-tile` (`--size-icon-tile` 2.625rem) | closeout `.dash-stat-icon` | stat tiles, landing product visuals, exported cards |
| 2xl | 52 | `size-[52px]` | closeout `.m-feature-icon` | landing feature blocks, OpenGraph and card hero |

### 4.2 Shapes

- Stock Tokens sit in a rounded-square tile, the owner's equity shape (Bespeak Logo.tsx line 23) at closeout's ratio: 5, 6, 7, 11, 13 and 16 px for 16 to 52 (`TOKEN_ICON_RADIUS_CLASS.tile`).
- USDG and ETH are discs (`rounded-pill`), as Bespeak draws payment tokens.
- `tokenShape(key)` returns `tile` or `disc` from the manifest's `kind`. Never pick a shape at the call site.

### 4.3 Faces

| Token | Face today | Detail |
| --- | --- | --- |
| USDG | the Global Dollar logo, 250 by 250 PNG, art `disc`, fills the circle | rung CONTRACT, GeckoTerminal network `robinhood`, exact contract 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 |
| ETH | the ethereum-lists ETH diamond, 1000 by 1628 PNG, art `mark`, inset 19 percent on a white plate | rung CHAIN_LIST, bytes verified against the IPFS CID |
| SPY, QQQ, NVDA, AAPL | the mark of what each token tracks (SPDR, Invesco, NVIDIA, Apple), 200 by 200 PNG, art `disc`, in the tile | rung PINNED, assets.parqet.com, approved by the owner on 3 October 2026 (D-023). Until then the tile showed `StockTokenGlyph`, see section 5 |

Every face has a 1 px inner hairline (`ring-1 ring-inset`): ink at 10 percent on logos, `ring-equity-border` (green-200) on Stock Token tiles. That is closeout's 1 px provider border (marketing.css line 680) and Bespeak's inset hairline (Logo.tsx line 34), applied to every icon so a white plate keeps its edge on white.

### 4.4 Chain badge

Only at lg, xl and 2xl (the prop types refuse it below). A black disc (`bg-ink`, `text-ink-inverse`) of 14, 16 or 20 px at bottom right, offset 4 px out, with a 2 px cutout ring in the surface color, holding the compact `NetworkGlyph`. The accessible name gains " on Robinhood Chain". Use it where a token's network is a real question, such as the receive screen and the payment address card. Never in dense lists.

### 4.5 Network identity

The network has no icon file. Its only published marks are Robinhood's, so Sleeve shows the words "Robinhood Chain" with the neutral `NetworkGlyph` (three stacked layers, 20 px grid, 1.5 stroke) at 16 or 20 px before the text, in `text-ink-secondary`. Bespeak's separate status dot rule holds: a dot may sit after the name to show RPC health, never instead of it.

### 4.6 Overlaps: TokenStack and TokenPair

- First token on top. Each later icon slides under by about 30 percent: `-ml-1.5`, `-ml-2`, `-ml-2.5`, `-ml-3`, `-ml-4` for sm to 2xl. xs is not stackable.
- Every icon wears a 2 px cutout ring in the surface under it: `surface="surface"` (white) or `surface="muted"` (`#f4f5f7`).
- Past `max` (default 4, at least 2) the rest collapse into a `+N` disc in `bg-surface-strong` and `text-ink-secondary`, laid on top. A number, never a letter.
- One accessible name for the group, listing every token including the hidden ones; inner icons are decorative. `TokenPair` names the movement: "USDG to NVDA Stock Token".
- While the four Stock Tokens share one glyph, a stack of only Stock Tokens shows four identical tiles. Do not use it for that. Show ticker chips instead (4.7). Use stacks where a disc and a tile mix: `TokenPair from="USDG" to="SPY"` on buy receipts, `from="SPY" to="USDG"` on sell-backs.

### 4.7 Chips and rows

- Chip: `inline-flex items-center gap-2 rounded-pill border px-3 py-1 text-body-s`, `TokenIcon size="sm" decorative` then the symbol. The text names the token, so the icon is decorative.
- List row: `TokenIcon size="md" decorative` left of the title, `gap-3`, vertically centred on the title line.
- Amounts: `TokenIcon size="xs" decorative` before the unit, `gap-1.5`, aligned with `align-middle`.
- Headers: `TokenIcon size="lg"` with `chain` where the network matters, `gap-4` to the name.
- Holdings and receipts still print "debt security, not a share" under the ticker. The icon never replaces it.

### 4.8 UI line icons

Sleeve's own set (app/src/components/ui/icons.tsx) keeps Bespeak's construction on a 20 px grid: 1.5 stroke, round caps and joins, `currentColor`, hidden from assistive technology, and no feather, quill, lock, shield or fingerprint. Icons mark navigation and a few controls. They are not added to every button. Glyphs inside closeout-style tiles are 18 px in a 34 tile and 20 px in a 42 tile, the ratio of `.m-provider svg` (marketing.css lines 684 to 687).

### 4.9 Server-drawn images

The OpenGraph image and exported cards cannot use React components with next/image. They call `tokenLogo(key)` for the file path and join it to the site origin, and draw `StockTokenGlyph` for withheld tokens. Same shapes, same sizes from the table above.

## 5. Stock Token logos: withheld, then pinned (D-023)

Decided 3 October 2026 in D-023: the sync pins the mark of what each token tracks (SPDR for SPY, Invesco for QQQ, NVIDIA, Apple) from assets.parqet.com, checksummed, and the manifest keeps the rejected issuer and contract candidates under each icon's `checked`, so `withheld` is empty. The rest of this section is the record from before that decision.

What the ladder returned on 2026-10-03, recorded in icons-manifest.json under `withheld`:

| Rung | Result for SPY, QQQ, NVDA and AAPL |
| --- | --- |
| ISSUER | `logoUrl` in https://api.robinhood.com/rhj/assets is `https://cdn.robinhood.com/ncw_assets/logos/<contract>.png`. All four return the same 180 by 180, 4,058 byte image, sha256 3acff25ee4e8f842d245c315002965c712c7f42f00fff4377e1ad8ce88d78ab1: the Robinhood feather on Robin Neon. 89.0 percent of its opaque pixels are in hue 60 to 90. Rejected. |
| CONTRACT | GeckoTerminal `robinhood` network, exact contract. Each returns a 14,285 byte re-encode of the same feather, 88.8 percent neon, identical pixels across the four. Rejected. |
| CHAIN_LIST | Not applicable to tokens. |
| PINNED | No approved pin. |

The candidates for a pin are the underlying company and fund sponsor logos. Apple's guidelines: "You may not use the Apple Logo or any other Apple-owned graphic symbol, logo, or icon ... except pursuant to an express written trademark license from Apple" (https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html, read 2026-10-03). NVIDIA's logo page: "These assets may not be used in any manner that isn't expressly authorized in writing by NVIDIA" (https://www.nvidia.com/en-us/about-nvidia/legal-info/logo-brand-usage/, read 2026-10-03). PRD 7.12 also rules out implied endorsement. SPDR (State Street) and Invesco terms are not checked yet.

Until the owner decides, the tile shows `StockTokenGlyph`. It is not a letter badge and not a brand: two filled candles on a 20 px grid, no direction. The options:

1. Keep the glyph for M0. No legal exposure. The cost is that the four tickers look alike and the ticker text must carry identity.
2. Pin the underlying logos after legal review, logging the decision in DECISIONS.md. Add a `pin` to the spec in sync-icons.ts with url, sha256, reason and `approvedBy`; the PINNED rung then wins and the brand guard is skipped for it by design.
3. Ask the issuer for non-Robinhood per-asset marks and let the ISSUER rung pick them up with no code change.

## 6. The two neutral glyphs

Both live in glyphs.tsx and are drawn on a 20 px grid like the UI icons.

- `NetworkGlyph`, regular: three chevron layers, `M10 2.75 17.25 6.5 10 10.25 2.75 6.5Z`, `m2.75 10 7.25 3.75L17.25 10`, `m2.75 13.5 7.25 3.75 7.25-3.75`, stroke 1.5. Compact: two layers with `vector-effect: non-scaling-stroke` at 1.25, for the 14 to 20 px badge.
- `StockTokenGlyph`: filled. Wicks are 1.5 by 12 rects (rx 0.75) at x 5.25 and 13.25; bodies are 5 by 7 at (3.5, 5) and 5 by 6.5 at (11.5, 8.5), rx 1.25. Filled so it holds at 9 px inside the 16 px tile.

## 7. Running the sync

```
cd app && node scripts/sync-icons.ts
```

Node 22.18 or later strips the types; older Node needs `--experimental-strip-types`. The committed manifest was last rewritten at 07:52 UTC on 3 October 2026 (its `generatedAt`), with six icons, the four D-023 pins among them, and nothing withheld.

What it does, in order:

1. Reads the issuer list once (194 assets on chain 4663). A ticker found under another contract fails the run.
2. Walks ISSUER, CONTRACT, CHAIN_LIST, PINNED for every asset still open. GeckoTerminal calls are spaced 2.5 s apart; 429 and 5xx retry up to four times, honouring `retry-after`.
3. Runs the brand guard on every automated candidate: the known feather sha256, a Robin Neon share of 10 percent or more of opaque pixels (hue 60 to 90, saturation and value 0.75 or more), and one picture served for several assets (compared by decoded pixel hash, so re-encodes match). Images under 400 bytes or 64 px are refused. SVG with scripts, event handlers, foreignObject or external references is refused.
4. For ETH, follows eip155-4663 to its gas symbol, then eip155-1's icon entry, and accepts only bytes whose sha256 matches the CIDv0. A committed copy that still matches the CID needs no gateway.
5. Writes nothing unless every asset is an icon or an evidenced withhold. Any other outcome exits 1 and leaves the committed files untouched.
6. Writes the files, deletes any file in public/assets/tokens the manifest no longer names, rewrites the manifest only when something other than the timestamp changed, and re-reads every file to check its sha256.

Adding an asset: add an `AssetSpec` to `ASSETS` in sync-icons.ts with its exact contract, run the sync, then the manifest tests in icons-manifest.test.ts tell you if anything is out of step with packages/core.

## 8. Rules for builders

1. Draw tokens only with `TokenIcon`, `TokenStack` or `TokenPair`. Never an `<img>` to /assets/tokens, never a remote logo URL, never initials.
2. Keys are manifest keys: `SPY`, `QQQ`, `NVDA`, `AAPL`, `USDG`, `ETH`. Use `isTokenKey` to narrow a string from the data layer.
3. Set `decorative` when visible text beside the icon names the token. Otherwise the icon names itself.
4. `className` is for layout only. Size, shape and color come from props.
5. Pass `cutout` matching the surface whenever an icon overlaps anything.
6. Pass `priority` for icons in the first viewport of the landing.
7. Never draw the Robinhood Chain network with a logo. Text plus `NetworkGlyph`.
8. A missing icon is a failed sync, not a UI fallback. In development `tokenVisual` throws on an unknown key.
