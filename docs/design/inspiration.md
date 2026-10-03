# Inspiration: navbar, shareable cards and OpenGraph images

Research for D-021, written 3 October 2026. It names the references, what each one does well, the exact move Sleeve takes from it, and then turns those moves into a build direction for five surfaces: the marketing navbar, the app top bar, the receipt card, the week card and the OpenGraph images. Section 14 is the build list for the navbar-shell and cards-og builders.

Everything here sits on top of docs/DESIGN.md (tokens, type, radii, the split rail) and the closeout blueprints in this folder. Where a reference conflicts with DESIGN.md, DESIGN.md wins and the table says what was left behind.

## How this was gathered

- 23 navigation references, 16 share card references and 15 OpenGraph images.
- Live sites were captured on 3 October 2026 in Chromium through Playwright 1.63, at 1440x900 and 390x844, with menus opened by hover or click. Heights, positions, backgrounds, blur, borders and font sizes marked "measured" were read with getComputedStyle.
- OpenGraph images: each page's og:image and twitter:image tags were read with curl and the files downloaded. Sizes below are the files' real pixel sizes, which do not always match what the page declares.
- Share cards: press pages, newsroom media kits and design write-ups, quoted with their dates, plus screenshots where the card is public.
- Screenshots live in the session scratchpad (insp/nav, insp/nav2, insp/og, insp/cards). None are committed.
- Awwwards was searched for navigation picks in fintech and wallets. The results were concept and agency pieces, for example a fictional quantum hardware wallet. None showed shipped live chips or menus with data, so no Awwwards site is listed.

## Design read

Reading this as: a light, closeout-based product for people paid in digital dollars, whose live facts are whether the US market is open and how far the pool sits from the Chainlink reference. The chrome stays quiet. The live data goes inside the menus, pills and chips, and the split rail is the one loud element on every card and image.

Fixed inputs every surface keeps:

- Light theme only (D-005). Green does closeout's blue work, apricot is spend and nothing else, black is action and selection (DESIGN.md 1).
- Instrument Sans for words, IBM Plex Mono for machine values only (DESIGN.md 4).
- The split rail is the signature: apricot spend, green equity, amber stripes for waiting (DESIGN.md 12.1).
- No performance anywhere: no daily change, no sparkline, no gain or loss color (DESIGN.md 1, rule 4).
- Every holding and receipt shows "debt security, not a share" directly under the ticker or amount (DESIGN.md 12.5).
- Robinhood Chain in full, never larger or heavier than "Sleeve", no feather, no Robin Neon, no implied partnership, and the disclaimer wherever the network is named on its own (docs/research/issuer-docs.md section 4).
- Token icons through TokenIcon, TokenStack and TokenPair only. Fund and company marks identify exposure and stay small (D-023).
- While the mock data layer runs, every number is labeled as sample data.

## 1. Navigation references

Closeout's m-header is the base: 72 px, white at 86 percent with a 14 px blur, a 1 px bottom border, 14 px links in ink-secondary, a 44 px black pill (closeout-landing-blueprint.md section 2). Every row below adds to it, and only its resting state changes (section 4.2).

| # | Reference | What makes it rich (seen or measured) | Move Sleeve takes |
| --- | --- | --- | --- |
| 1 | Linear, https://linear.app | Fixed 73 px bar on a 20 px backdrop blur with a 1 px hairline (measured). Links sit in a right-hand cluster as 32 px pills; the open trigger fills. The Product panel is a framed card with two columns of title plus one-line description, a third column of plain links, and a footer strip inside the panel ("New", one sentence, "Learn more"). | The trigger pill that fills on hover and while its panel is open. The footer strip inside a panel that carries one live sentence and one link. |
| 2 | Vercel, https://vercel.com | 64 px sticky bar, transparent at the top; after scrolling it turns #FAFAFA with a 1 px line (box-shadow 0 1px 0 rgba(0,0,0,0.08)), height unchanged (measured). Full-width Products menu: small grey group labels over 20 px item names, external items marked with a north-east arrow. | Two scroll states, clear at rest and filled with a hairline after scroll, with no height change. The north-east arrow on links that leave Sleeve. |
| 3 | Stripe, https://stripe.com | The bar is a white card inset on the gradient, and the open menu extends that same white surface downward instead of floating a second box. Four columns with a hairline under each group title, then a tinted "More" column ending in an image card for Stripe Sessions. Phone: full-screen sheet with chevron rows, a bordered "See all products" card and two buttons pinned at the bottom. | The continuous bar-to-panel surface. The tinted right rail in each panel, which holds Sleeve's live preview. The two actions pinned at the bottom of the phone sheet. |
| 4 | Mercury, https://mercury.com | A centered announcement bar above the nav (glyph, sentence, arrow). 72 px sticky nav whose open trigger becomes a filled pill; on scroll it takes a solid fill with a 10 px blur (measured). The Products menu is a full-width grid of cells divided by hairlines, each with a title, a one-line description, a small label and a short list. | The hairline cell grid for the How it works panel, one cell per step. The centered glyph-plus-sentence layout for the sample data strip. |
| 5 | Ramp, https://ramp.com | Black announcement bar with "New:", a link and a close button. White floating menu with grouped columns; every item is a 40 px grey icon tile, a title and a description; a Featured column with an image card. On phones, a live counter in a chip ("US corporate payments processed by Ramp" with a ticking figure) and an "Agents at work today" strip. | Icon tiles beside menu items, which in Sleeve hold the real token icon. A live figure that carries its own label and source in the same chip. |
| 6 | Wealthsimple, https://www.wealthsimple.com/en-ca | A floating bar inset 16 px from the top, 60 px tall, 95 percent white with a 16 px blur (measured). Open trigger in a grey 12 px pill, round search button, outline "Log in", black "Get started". Phone: the same floating bar with round search and menu buttons. | Round 44 px icon buttons for search and the account on phones. |
| 7 | Raycast, https://www.raycast.com | A floating island bar with a 1 px border and a Download button that carries the platform glyph. Its OpenGraph image shows the command palette itself: a search row with a back button, results grouped under a section label, and a preview pane on the right with metadata rows. | The palette layout: grouped results on the left, a preview pane with metadata on the right. The bar shape is not taken; Sleeve keeps closeout's full-width bar. |
| 8 | Uniswap, https://uniswap.org and https://app.uniswap.org/swap | The logo opens a company menu (product tiles with icons, protocol and company lists, a legal disclosure toggle, social icons). Search and "more" icon buttons sit beside the CTA. The swap card stacks Sell over Buy, each with a large amount and a token chip with a network badge, and a square arrow tile overlaps the seam. | The stacked panels with the arrow tile on the seam, for a card's amounts and the balances popover. Not taken: the "Beta" tag on a nav item, because gated features never appear in navigation (DESIGN.md 12.8). |
| 9 | Rainbow, https://rainbow.me | Centered app icon and wordmark, a menu button on the left, and a Download button with a caption under it ("For iPhone, Android and desktop"). | A one-line caption under the main action of the phone sheet: "Sign in with a passkey or a wallet" (D-022). |
| 10 | Family, https://family.co | Dropdown items carry a title and a one-line description ("ConnectKit" over "Connecting a wallet, made simple"); a beige "Log In" pill beside a black "Get Started" pill. | A description line under every menu item, short enough to stay on one line. |
| 11 | Phantom, https://phantom.com | The links sit inside a white pill island centered on a lavender canvas, with a round search button and a lavender Download pill; the bar is fixed at 92 px (measured). | Checked, not taken. The island reads as a second container on Sleeve's white page. |
| 12 | Zora, https://zora.co | The whole bar is the logo and one centered search field whose placeholder names what it finds ("Search for creators, trends, or traders"). | Search as the center of the app top bar, with a placeholder that names its targets: "Jump to a receipt, ticker or page". |
| 13 | Arc, https://arc.net | A grain-textured band with a scalloped bottom edge; nav items with small icons. The phone menu is a full-screen sheet of very large links with icons and the company wordmark at the bottom. | The full-screen phone sheet with large links, with the required disclaimer pinned at the bottom where Arc puts its wordmark. |
| 14 | Wise, https://wise.com/us/ | A region banner above the bar with a switch link and a close button, an audience switch whose active item is a mint pill, a language chip with a flag, and a menu that pairs an image card with icon-circle links. | Checked. The active pill stays neutral (black is selection, DESIGN.md 1 rule 3). The region banner is noted for onboarding eligibility (PRD 7.12), not the navbar. |
| 15 | TradingView, https://www.tradingview.com/symbols/AMEX-SPY/ | A search pill with the shortcut inside the field ("Search (⌘K)"). Every price carries its time and session ("At close at 00:59 GMT+1"). | The shortcut hint inside the palette trigger. A time and a session word attached to every price in the markets popover. |
| 16 | Yahoo Finance, https://finance.yahoo.com/markets/ | Three tiers: a global bar with search, a section nav, and a "US Markets" strip of index tiles. The SPY page sets "At close: October 2 at 4:00:00 PM EDT" beside "After hours: 7:59:54 PM EDT". The markets header counts down to the close ("U.S. markets close in 5h 58m", per search results). | A session word and its time read as one unit. Not taken: daily changes and sparklines. |
| 17 | Aave, https://app.aave.com | Bordered chips with a leading icon in the bar ("Aave V4", "Swap", "Bridge GHO", "Connect Wallet", settings), an underline on the active tab, and under the bar a market selector (network icon, name, version tag) followed by a stat strip with info icons. | Bordered chips with a leading icon for the right cluster: the network chip and the balances chip. |
| 18 | Morpho, https://app.morpho.org | The logo carries a chevron, the active tab is a bordered pill, the external link has a north-east arrow, and a labeled figure sits in a pill at the page header ("Total Deposits" and the amount inside one pill). | A figure and its label inside one pill: "450.00 USDG spendable". |
| 19 | Hyperliquid, https://app.hyperliquid.xyz/trade | Under the nav, a market header puts Mark and Oracle prices side by side, then 24h change, volume, open interest and funding. Each label has a dotted underline that opens its definition. A footer pill shows the connection word ("Online" or "Offline"). | Pool price and Chainlink reference side by side, never merged (PRD 7.11), with dotted-underline labels that open definitions. The connection word beside the network name. Not taken: the change, volume and funding columns. |
| 20 | Jupiter, https://jup.ag | A left nav with "New" tags, a wide "Search anything" field with a "/" key hint, a Rewards chip, settings and Connect; under the bar, a watchlist strip of tokens with icons and percent changes. | The "/" key hint beside ⌘K. A token icon on every market row. Not taken: percent changes and its "Stocks" label (Sleeve writes Stock Tokens in full). |
| 21 | Polymarket, https://polymarket.com | Wide search with a "/" hint, "How it works" with an info icon placed beside Log in and Sign up, and a second row of category tabs with icons. | "How it works" as a first-class item, which becomes Sleeve's first mega menu. |
| 22 | Revolut, https://www.revolut.com/en-US/ | A 72 px sticky transparent bar with audience items (Personal, Business, Kids and Teens, Company) at 16 px and a 42 px black Sign up pill (measured). | Checked, nothing taken. It is plainer than closeout. |
| 23 | RainbowKit ConnectButton, https://rainbowkit.com/docs/connect-button | The connected state shows a chain button, a balance and an account button. accountStatus takes full, avatar or address; chainStatus takes full, icon, name or none; showBalance takes a boolean; all three accept { smallScreen, largeScreen } with the break at 768 px. | The chip trio and its responsive rule: network shown by name on large screens and folded away on small ones, balance on large only, account as an avatar on small and in full on large. Sleeve builds its own chips because they show the smart account; the wallet behind it appears only in the account menu. |

## 2. Shareable card references

| # | Reference | What it does well | Move Sleeve takes |
| --- | --- | --- | --- |
| 1 | Spotify Wrapped 2025, media kit https://newsroom.spotify.com/media-kit/2025-wrapped | The key art knocks "Wrapped" out of a black bar in white type, crosses it with the year in script, and sits it on paper grain with op-art rings. The Wrapped for Artists share card is a 2 by 2 grid of small label over bold figure (Listeners, Hours, Streams, Countries), the name in a black knockout label, four color swatches above the card to restyle it before sharing, a pager (01/13) and one Share pill. The kit names six textures (Tambourine, Slime, Plaid, Neon, Latex, Flower) and six two-color pairings. | The black knockout label for the ticker. The swatch picker above the preview, which becomes Sleeve's four colorways. One Share action under the preview. Not taken: the textures, and the lime script, whose hue sits in the band DESIGN.md section 3 rules out. |
| 2 | Strava Sticker Stats, BikeRadar (9 April 2025) https://www.bikeradar.com/news/strava-sticker-stats-spring-2025-updates and Tom's Guide (Jessica Downey, 15 January 2026) | A transparent sticker with distance, elevation gain and time, a line drawing of the route and the logo. The owner scrolls through several layouts, then copies one to the clipboard or sends it to an Instagram Story. Private activities cannot be shared. | Copy image as a first-class action beside Download. A carousel of formats in the composer. A visibility gate before anything identifying leaves the app, which in Sleeve is the proof confirmation. Not taken: transparency, because the debt security line needs a background whose contrast Sleeve controls. |
| 3 | GitHub Unwrapped, https://www.githubunwrapped.com, personal image at /og/username.jpg (1200x630) | The handle over a panel of stat tiles with icons (repos starred, PRs merged, issues closed, top language with its logo), a contribution strip, and a weekday bar chart labeled M T W T F S S with the busiest day in white and the rest muted. | The M to S bar chart for the week card. One image URL per subject, built from data the server reads. |
| 4 | Apple Card, https://www.apple.com/apple-card/ and Apple Newsroom, 25 March 2019 | The titanium card shows only the laser-etched logo and the holder's name aligned with the chip, with "no card number, CVV security code, expiration date or signature on the card". In Wallet, "Purchases are automatically totaled and organized by color-coded categories", and the Weekly Activity tile draws seven stacked bars of category colors. | Restraint as privacy: the default Sleeve card shows no amount and no address, the way that card shows no number. Seven stacked bars, one per day, for the week strip. |
| 5 | Mercury IO card, https://mercury.com/io | A deep purple card engraved with fine wave lines, chip and contactless mark, the product mark top right. Directly under the card a caption bar carries the issuing disclosure ("The IO Card is issued by Patriot Bank, N.A., Member FDIC, pursuant to a license from Mastercard International Incorporated."). | A disclosure fixed to the object it qualifies: "debt security, not a share" sits directly under the ticker on every card, never in a footnote. Engraved line texture on the Deep colorway. |
| 6 | Ramp corporate card, https://ramp.com/corporate-cards | A black card with fine concentric arcs engraved across it, the wordmark top left, the chip on the right. | Concentric engraved arcs, 1 px at 7 percent white every 14 px, on the Deep colorway. |
| 7 | Receiptify, https://receiptify.herokuapp.com (Michelle Liu, September 2020, inspired by the @albumreceipts account) | A top-ten list printed as a till receipt: an order number, the name and the date, songs under "item" and durations under "amount" (The Star and Yorkshire Evening Post coverage, September 2020). | The proof part of a card set as a receipt tape in IBM Plex Mono with label and value columns. Sleeve's tape carries real fields and a working QR code to the verifier instead of a decorative barcode. |
| 8 | Wordle, https://www.nytimes.com/games/wordle/index.html | The share grid shows the pattern of a game without the letters or the answer, so sharing spoils nothing for anyone (dinogame.gg write-up). | Share the shape and keep the payload back: the default card shows the split's proportions and the ticker, and leaves amounts and the address off (PRD 7.10). |
| 9 | Supabase Launch Week tickets, https://supabase.com/blog/designing-with-ai-midjourney (7 April 2023) | Each ticket image layers a background, a ticket outline, generated art, the GitHub avatar and text. An Edge Function renders it once with Satori, stores the PNG with a one-year cache header (31536000) and serves the stored file after that. A gold variant unlocks after the ticket is shared on two networks. | Render once per card and serve the stored image with an immutable cache. The ticket's perforation as the line between a card's statement and its evidence. Not taken: the gold variant, a reward for sharing an investing card. |
| 10 | Duolingo, streak milestones (Kurt Hartfelder, 21 January 2022) https://blog.duolingo.com/streak-milestone-design-animation and Year in Review (Jasmine Zhang and Clark Munson, 8 December 2022) | Milestones at one week, one month, 100 days and one year, each with a share card made in the moment. The Year in Review ends on one shareable card that bundles the year, built for 25 interface languages. | Offer "Make a card" at the moment a buy lands (a secondary action on a FILLED receipt), and end the week with one card that bundles it. Not taken: streak language. Streaks belong to crews, which are M1 and gated. |
| 11 | Apple Fitness awards, Apple Newsroom, 14 April 2025 https://www.apple.com/newsroom/2025/04/get-active-with-apple-watch/ | The limited-edition award is drawn from the product's own three rings set in a gold medallion, with 10 animated stickers and an animated badge for Messages. | The emblem is the product's own data shape: every Sleeve card carries the split rail as its mark. |
| 12 | Year in Monzo 2024, https://community.monzo.com/t/year-in-monzo-2024-is-here/172368 (December 2024) | The concept is a bank statement made worth sharing, shown as two posters, "money" and "monzo". A tone picker lets each person see their year in "nice" or "savage" mode, with 300 one-liners written for the top 150 UK merchants. | One choice before sharing that changes the look, which in Sleeve is the colorway and never the words. The statement line as material for the proof tape. Not taken: jokes about money (plain words, build contract copy rules). |
| 13 | Uniswap swap card, https://app.uniswap.org/swap | Sell and Buy panels stacked, each with a large amount and a token chip with icon and network badge, and a square arrow tile overlapping the seam. | The amounts block of a receipt card: a "50.00 USDG" panel over a "0.0718 SPY" panel with the arrow tile on the seam. |
| 14 | GitHub repository social card, https://opengraph.githubassets.com/1/vercel/satori (1200x600) | Owner and name with the name in bold, the description, the owner's avatar tile, a stat row with icons, and a stacked language bar along the full width of the bottom edge. | Every Sleeve card and image ends in a full-width split rail along its bottom edge, the way every repository card ends in its language bar. |
| 15 | Farcaster Mini App embeds, https://miniapps.farcaster.xyz/docs/specification | Embed images are 3:2, between 600x400 and 3000x2000, under 10 MB, with a button title of at most 32 characters. | The renderer takes a size, so a 1200x800 embed is a later addition with no new design. Not built in M0. |
| 16 | Arc Boosts, https://arc.net/boosts (gallery described by ghacks and AlternativeTo, May 2023) | Then: a gallery of user-made site customizations, each applied with "Get Boost". On 3 October 2026 the address shows the Dia announcement instead. | Nothing. A shared recipe that others apply would be a rule template, which is crews, M1 and gated. |

Robinhood's own trade confirmations and share images were not studied and are not copied (the brief for this research).

## 3. OpenGraph references

| # | Page | og:image (real size) | What it does | Move Sleeve takes |
| --- | --- | --- | --- | --- |
| 1 | https://vercel.com | og-home-not-x.png and og-home-x.png, both 2400x1350 | The mark glowing on black. The twitter:image is a separate file in which the mark sits smaller and higher. | Keep every element inside a safe area so one image survives X's handling, instead of shipping two files. |
| 2 | https://vercel.com/blog | Vercel_Blog_OG.png, 1200x628 | Light grey canvas, mark top left, a two-line headline, line art on the right inside a hairline frame. | A light canvas with a hairline frame for generic pages. |
| 3 | https://linear.app, /changelog, /now | /api/og/main?title=Linear&v=4 (1200x630); /api/og/generic?title=Changelog&v=5 (1200x628) | Mark and wordmark centered on near black. Section pages set the mark, a thin divider and the section name. A v parameter versions the template. | The mark, divider and section lockup for /verify ("Sleeve", divider, "Verify a receipt"). A version parameter so social caches refresh when a template changes. |
| 4 | https://github.com/vercel/satori | opengraph.githubassets.com auto card, 1200x600 | See card reference 14. The 2:1 file is what X shows without cropping. | The bottom-edge rail. Content kept inside a 1200x600 band. |
| 5 | https://github.com/vercel/next.js | repository-images upload, 2800x1600 | The mark inside dotted concentric circles over a crosshair grid, headline below. | Checked, not taken. |
| 6 | https://cal.com | framerusercontent PNG, 1200x630 | Wordmark top right, one headline, and the real booking calendar cropped by the bottom edge. | The site image shows Sleeve's real split card cropped by the bottom edge. |
| 7 | https://dub.co | assets.dub.co/thumbnail.jpg, 1200x630 | Faint grid, headline in one cell, logo bottom left, a cluster of product cards on an iridescent wash. | Checked, not taken: too busy at thumbnail size. |
| 8 | https://resend.com | /static/cover.jpg, 1200x630 | Dark, logo tile on top, serif headline, a code window cropped at the bottom. | The product object cropped at the bottom edge, as with Cal.com. |
| 9 | https://supabase.com/launch-week | lw15-og.png, file 1200x630 | "LW", a dithered galaxy image set inside the line of type, "15". The page declares og:image:width 800 and height 600 for a 1200x630 file. | Declare real sizes; Next writes them from the exported size. |
| 10 | https://stripe.com/sessions | 2027-opengraph.png served as WebP, 1200x630 | Full-bleed gradient art, the venue and dates in very large type, a small lockup bottom left. | Checked, not taken: event art. |
| 11 | https://www.raycast.com | Next opengraph-image route output, 2400x1260 | Logo, headline with gradient text, and the command palette UI on red folds, rendered at 2x. | 2x only for downloadable cards. OpenGraph images stay 1200x630 to keep files small. |
| 12 | https://zed.dev and https://zed.dev/blog | og.webp, 3600x1890; /api/og?title=Zed%3A%20From%20The%20Blog, 1200x630 | Italic serif tagline over an editor screenshot with grid lines and crosshair dots. The blog template sets a title, a hatched margin and the mark bottom right. | One dynamic template with a title parameter for every generic page. |
| 13 | https://planetscale.com | homepage-social PNG, 2400x1260 | Mark, a monospaced caps line and a logo wall on a dot grid. | Not taken: a logo wall implies partnership (DESIGN.md 12.9). |
| 14 | https://mercury.com | homepage-social WebP, 1200x630 | The dashboard over a blurred photo. | Checked, not taken. |
| 15 | https://www.githubunwrapped.com/JonnyBurger | /og/JonnyBurger.jpg, 1200x630 | A personal image per user. See card reference 3. | One image URL per card, built from data the server reads. |

## 4. Direction: marketing navbar

### 4.1 Anatomy from 1280 px

```
+--------------------------------------------------------------------------------------------------+
| [split mark] Sample data. Nothing shown here happened on chain.                                  |  strip, 40 px, centered
+--------------------------------------------------------------------------------------------------+
| Sleeve    How it works v   Stock Tokens v   Receipts v    Questions        [Robinhood Chain] [(o) Market open] [Open the app] |
+--------------------------------------------------------------------------------------------------+
```

- Height 68 to 72 px (the current min-h-topbar or closeout's 72; never above 80). Container max-w-content with the gutter. One line at every width from 1024.
- Left: the Wordmark. Then three disclosure triggers and one plain link. "Questions" appears only once the landing has an FAQ anchor in LANDING_SECTIONS.
- Triggers: text-body-s, text-ink-secondary, min-h-touch, px-3, rounded-pill, a 12 px chevron. Hover and open: bg-surface-muted with text-ink (Linear's filled pill), chevron turned 180 degrees (Vercel, Stripe). Never green, never black.
- Right cluster from 1280: network chip, session pill, primary button. From 1024 to 1279: session pill and primary button. Below 1024: section 4.5.
- The primary button is closeout's header button: the black pill, min-h-control (44 px), "Open the app".
- Signed in (useSession returns a session): the button becomes an account chip, a 34 px bg-brand tile with the address's first hex character in white, then the short address in mono, linking to /home. Accessible name: "Open the app as 0x5fc5...d168" with the real short form.
- The sample data strip is today's SampleDataNotice restyled after Mercury's bar: centered, the SplitMark before the sentence, 40 px, bg-info-soft and text-info as now. It stays undismissable while DATA_SOURCE is mock and keeps SAMPLE_DATA_LINE word for word.

### 4.2 Scroll states (Vercel)

- At rest: transparent background, transparent border.
- After the first 8 px: bg-chrome, backdrop-blur-lg with the -webkit- prefix, border-b border-border. No height change and no shadow.
- Detect with an IntersectionObserver on an 8 px sentinel at the top of main. No scroll listener.
- prefers-reduced-transparency: bg-surface without blur.

### 4.3 Panels

One white surface that continues out of the bar (Stripe): max-w-content, bg-surface, border-x and border-b in border-border, rounded-b-card, shadow-overlay, p-6. Content grid `1fr 320px`: content on the left, a bg-surface-muted rail on the right (Stripe's More column, Ramp's Featured), and a footer strip across the bottom (Linear) with one sentence, one link and, while the mock runs, the "Sample data" tag.

How it works (Mercury's hairline cells; numbered because it is a real sequence):

```
+------------------+------------------+--------------------+-------------------+ +----------------------+
| 1                | 2                | 3                  | 4                 | | If 500 USDG          |
| USDG arrives     | Your rule        | The guard checks   | It buys or waits, | | arrived now          |
| at your payment  | splits it        | the market         | then writes a     | | [rail 90 / 10]       |
| address          | [rail 90 / 10]   | [(o) Market open]  | receipt           | | 450.00 USDG stays    |
| [USDG icon lg]   | 90% spendable,   | Pool 0.10 percent  | [USDG -> SPY pair]| | spendable            |
|                  | 10% to SPY       | above the reference|                   | | 50.00 USDG buys SPY  |
+------------------+------------------+--------------------+-------------------+ | now   [Sample data]  |
| Each buy, wait and release writes a receipt.                   See a receipt | +----------------------+
+-------------------------------------------------------------------------------------------------------+
```

- Cell 2 uses SplitRail (card size) at RULE_DEFAULTS (10 percent SPY). Cell 3 uses the live SessionPill and the premium sentence for SPY from useMarket.
- The rail card answers "what would happen to a payment right now": RULE_DEFAULTS plus useMarket for SPY. Open and within the default 1.00 percent cap: "50.00 USDG buys SPY now". Closed: the equity part drawn in waiting stripes and "50.00 USDG waits as USDG until the market opens, Sun 4 Oct, 20:00 New York time". Over the cap: "50.00 USDG waits: the pool is above the 1.00 percent cap".
- Footer: "Each buy, wait and release writes a receipt." with the link to the receipts section (PRD 7.6).

Stock Tokens (Ramp's icon tiles, Hyperliquid's pool and reference side by side):

```
Four Stock Tokens at launch. Each is a debt security, not a share, with exposure to the fund or company named.
+----------------------------------------------+----------------------------------------------+ +---------------------+
| [SPY tile 42] SPY             (o) Market open | [QQQ tile 42] QQQ            (o) Market open | | Issuer disclosure   |
| SPDR S&P 500 ETF Trust                        | Invesco QQQ                                  | | Robinhood Assets    |
| Pool 0.10 percent above the reference         | Pool 0.04 percent below the reference        | | (Jersey) Limited    |
+----------------------------------------------+----------------------------------------------+ | Copied word for     |
| [NVDA tile 42] NVDA ...                       | [AAPL tile 42] AAPL ...                      | | word, 2 Oct 2026    |
+----------------------------------------------+----------------------------------------------+ | 0x8408c7...68e89    |
| The pool quote and the Chainlink reference are shown apart, never merged.   How the guard uses them | | Read it             |
+------------------------------------------------------------------------------------------------+ +---------------------+
```

- Names come from LAUNCH_TICKERS. The ticker is the title; the fund or company name is a muted line; the mark stays at 42 px in its tile (D-023).
- "reference" carries a dotted underline that opens a tooltip with the source and time, which the brand guidelines require for any figure: "Chainlink SPY price, updated 13:59 UTC. Pool: Uniswap v3 quote at 14:02 UTC." The premium is a sentence in ink-secondary, never green or red (DESIGN.md 12.2).
- The rail shows the disclosure facts from docs/disclosure: issuer, retrieval date, the keccak256 hash in mono with the middle elided, and a link to the disclosure block.

Receipts:

- Left: a small form, label "Receipt id", the mono input from the verify page (16 px, min-h-control-lg) and a secondary "Check receipt" button that goes to /verify with the id.
- Middle: three items with icon and one-line description: "What a receipt records" (receipts section of the landing), "How a check works" ("recomputed through a different RPC provider", the verify page), "Export your receipts" ("CSV from the receipts page").
- Rail: a sample receipt tape in Plex Mono (status, USDG in, to spend, to SPY, SPY out, premium, Chainlink round) with the "Sample data" tag.
- Footer: "Receipts are written in the same transaction as the action."

### 4.4 Right cluster

- Network chip (from 1280): `inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 min-h-control-sm text-body-s text-ink-secondary`, NetworkGlyph at 16 px, then "Robinhood Chain" in the same size and weight as the text around it. Its popover: "Robinhood Chain, chain id 4663", the data line (mock: SAMPLE_DATA_LINE; chain: "Read at block 78,312,136, 4 seconds ago"), and the DISCLAIMER constant, because the popover names the network on its own.
- Session pill: the shared component in section 5.2, using SPY's session (every launch ticker is ALL_DAY).

### 4.5 Below 1024: the menu sheet (Arc, Stripe, Rainbow)

```
+--------------------------------------+
| Sleeve                        [ X ]  |
| (o) Market open    Robinhood Chain   |
|--------------------------------------|
| How it works                     v   |  text-h1, rows at least 64 px, hairlines between
| Stock Tokens                     v   |  an open row shows its panel content as a list
| Receipts                         v   |
| Questions                            |
|                                      |
|--------------------------------------|
| [ Open the app                     ] |  pinned, primary, full width
| [ Verify a receipt                 ] |  pinned, secondary
| Sign in with a passkey or a wallet.  |  caption
| Sleeve is not affiliated with, ...   |  DISCLAIMER, text-body-s ink-secondary
+--------------------------------------+
```

- The bar below 1024: Wordmark, the compact session pill (status mark plus "Open" or "Closed"), and a 44 px Menu button.
- The sheet is full height (100dvh), bg-surface, z-overlay. Reuse the Dialog's focus trap, Escape, focus return and aria-modal; add a full-height variant. Lock body scroll while open.
- Rows are accordion buttons with aria-expanded and a region. The pinned actions and the caption stay visible while the list scrolls.

### 4.6 Keyboard, focus and motion

- Disclosure pattern, not role="menu": each trigger is a button with aria-expanded and aria-controls. Enter and Space toggle. Escape closes and returns focus to the trigger. Opening another trigger swaps panels. A click outside or focus leaving the header closes the panel.
- Hover opens after 120 ms and closes 200 ms after the pointer leaves trigger and panel, only under `(hover: hover) and (pointer: fine)`. Touch opens on tap only.
- A panel fades in and travels --motion-distance over 220 ms with ease-standard. Swapping panels cross-fades without travel. Reduced motion: opacity only.
- Rows inside panels draw their focus ring inside (`-outline-offset-2`).

## 5. Direction: app top bar

### 5.1 Tiers by width

```
1280 and up
| Receipts / 1042      [Q  Jump to a receipt, ticker or page   ⌘K]    [(o) Market open]  [(USDG) 450.00 USDG spendable v] |

1024 to 1279
| Receipts / 1042                                     [Q ⌘K]    [(o) Market open]  [(USDG) 450.00 USDG v] |

768 to 1023
| Receipts / 1042                                             [Q]    [(o) Open] |

below 768
| Sleeve                                       [(o) Open]  [Q]  [avatar] |
```

- The breadcrumb stays as built. The palette trigger, session pill and balances chip are bordered chips with a leading icon (Aave, Morpho), all min-h-control-sm.
- Which chips show at which width follows RainbowKit's responsive model with Sleeve's breakpoints. The account lives in the rail card from 768 and in the avatar button below.
- The bottom navigation does not change.

### 5.2 Session pill (shared with the marketing navbar)

| SessionState | Text | Tone | Status mark | Popover line |
| --- | --- | --- | --- | --- |
| open, OPEN | Market open | bg-equity-soft text-equity | solid 10 px dot, bg-equity (the legend dot size, DESIGN.md 2.5) | Open since Sun 27 Sep, 20:00 New York time (openedAt) |
| closed, WEEKEND | Market closed | bg-waiting-soft text-waiting | 10 px dot filled with bg-waiting-stripes | Opens Sun 4 Oct, 20:00 New York time (nextOpenAt). Payments wait as USDG until then. |
| closed, HOLIDAY | Closed for a holiday | waiting | striped dot | as above |
| closed, EARLY_CLOSE | Closed early today | waiting | striped dot | as above |
| closed, OUTSIDE_HOURS | Market closed | waiting | striped dot | as above |
| NO_SESSION or OUT_OF_RANGE | Market hours unknown | waiting | striped dot | Sleeve's calendar has no session for now, so buys wait. |

- From 1280 a closed pill adds the short time ("Market closed, opens Sun 20:00"). Below 768 it reads "Open" or "Closed".
- Times follow format-time.ts: market times in New York time. A short formatter for the pill ("Sun 20:00") sits beside formatNewYork.
- The dot carries real state, so it is allowed; it never pulses (DESIGN.md 10: nothing loops). The word always carries the meaning.
- The pill is a button that opens the markets popover. Its accessible name is the full sentence, for example "Market closed, opens Sunday 4 October at 20:00 New York time. Show market details." No aria-live.
- Data: useMarket. The app uses the rule's ticker (useRule); the marketing navbar uses SPY. Loading: a pill-sized skeleton, no shimmer. Error: "Market status unavailable" in neutral tone.
- If the chain source can supply the next close, add `nextCloseAt` to SessionState and let the open pill say "Market open, closes Fri 20:00". Until then the pill does not guess.

### 5.3 Markets popover (Hyperliquid, TradingView, Yahoo)

```
[SPY icon md] SPY   SPDR S&P 500 ETF Trust                                   (o) Market open
              Pool         771.20 USDG per SPY           at 2 Oct 2026, 14:02 UTC
              Reference    770.43 USD, Chainlink         updated 2 Oct 2026, 13:59 UTC
              The pool is 0.10 percent above the reference. Your cap is 1.00 percent, so a payment now buys.
---------------------------------------------------------------------------------------------------
[QQQ icon md] QQQ ...
---------------------------------------------------------------------------------------------------
The pool quote and the Chainlink reference are shown apart, never merged.             [Sample data]
```

- One row per launch ticker, the rule's ticker first. The verdict sentence appears only on the rule's ticker and only while the rule is ACTIVE; it uses premiumBps and exceedsPremium from @sleeve/core with the rule's cap.
- "Pool" and "Reference" carry dotted underlines that open definitions.
- Prices use formatUsdg and formatFeedPrice, times use formatUtc (chain times in UTC). No change column, no sparkline.
- 420 px popover from the pill at 768 and up, a bottom sheet below.

### 5.4 Balances chip and popover

- Chip: the USDG icon at xs, then "450.00 USDG spendable" from 1280 and "450.00 USDG" from 1024; hidden below 1024, where the account sheet carries it.
- Popover (Uniswap's stacked panels):

```
Spendable                                   450.00 USDG
Waiting to buy SPY                           20.00 USDG     Market closed
Stock Tokens
  [SPY icon md] 0.0712 SPY      54.89 USDG, valued at the Chainlink price from 2 Oct 2026, 13:59 UTC
                debt security, not a share
[ Receive USDG ]   [ Sell ]
```

- Data: useLedger, useBuckets, useHoldings, useMarket. Value is balance times the feed price with its time (PRD 7.11), worded as HoldingRow already words it. Amounts in ink; color only in icons and marks.

### 5.5 Rail account card, network health and the phone account sheet

- The rail's account card keeps the avatar tile and the short address, and its second line becomes the network: NetworkGlyph, "Robinhood Chain", then a dot after the name for read health (green when the data layer's asOf is under 60 seconds old, striped amber when older). When not healthy the line adds the word: "Robinhood Chain, reconnecting" (Hyperliquid's Online and Offline word). On the mock the line reads "Sample data".
- The card opens an account menu: full payment address in mono with copy, Receive USDG, recovery signer set or not set (AccountOverview.recoverySigner), and Sign out (useSignOut).
- Below 768 the avatar button opens the same menu as a bottom sheet, with the balances popover content added.

### 5.6 Command palette (Raycast, Linear, TradingView, Jupiter)

- Opens with ⌘K on Mac, Ctrl K elsewhere, and "/" when focus is not in a text field. The trigger shows the right hint after mount, so the server render does not guess the platform.
- A Dialog, 640 px wide, about 12vh from the top on desktop; a full-height sheet on phones. The input is a 16 px combobox with aria-expanded and aria-controls; results are a listbox with groups and options.
- Groups: Pages (Home, Inbox, Receipts, Rule, Sell, Verify a receipt), Actions (Receive USDG, Copy payment address, Make a week card, Export receipts as CSV, Edit rule, Pause rule), Stock Tokens (the four launch tickers), Receipts.
- When the query parses as a receipt id (lib/receipt-id.ts), the first result is "Open receipt 1042", read with useReceipt. Not in this account: "No receipt 1042 in your account", with "Check it on the verify page".
- From 1024 a preview pane on the right shows the highlighted item: for a receipt, the status tag, TokenPair, amounts, premium sentence and debt security line; for a ticker, its markets row.
- Arrow keys move, Enter runs, Escape closes and returns focus. Empty query shows Pages and Actions. No match: "Nothing matches. Try a receipt id or a ticker."
- Gated features never appear in results.

## 6. Direction: receipt card

### 6.1 What the card says

| Toggles | The face (statement) | The stub (evidence) |
| --- | --- | --- |
| Default | Status badge; the share of pay as a large figure; "of this payment became"; the token icon and the ticker in a knockout label; "debt security, not a share" directly under it; the stamp "Checked against the market reference before buying" | Legend ("90% stayed spendable", "10% became SPY"); the card URL in mono; the date; the full-width split rail on the bottom edge |
| Show amounts | Adds "500.00 USDG arrived", the swap block (a 50.00 USDG panel over a 0.0718 SPY panel with the arrow tile on the seam), "450.00 USDG stayed spendable", and the exact premiumSentence in place of the stamp ("Bought 0.10 percent above the market reference.") | Same |
| Show proof | Same | Adds a receipt tape in Plex Mono: receipt id, account in short form, L2 block, Chainlink round, "Robinhood Chain, chain id 4663", a QR code to the verify page, and the DISCLAIMER line |

A SETTLED card says "of this payment waited, then became", and with amounts on it follows receiptSentence for SETTLED ("50.00 USDG that waited since 26 Sep 2026 became 0.0718 SPY") with no "arrived" line, because a SETTLED receipt records the buy, not the payment.

The stamp is true for every FILLED or SETTLED receipt, so it reveals nothing about the account; the number itself waits for "Show amounts". Section 13 asks the owner to confirm this reading of PRD 7.10. The badge is the app's own status badge (components/ui/badge.tsx), so a card reads FILLED or SETTLED exactly as its receipt does (DESIGN.md 11.6 and 12.3).

### 6.2 Anatomy, Post format, 1080x1350

Sizes are final image pixels.

```
y    0 +--------------------------------------------------------------+
         | Sample data. Nothing shown here happened on chain.            |  mock only: 44 px strip, info tones
y   96   | Sleeve                                             [ FILLED ] |  wordmark 48/600; status badge 28 px
         |                                                              |
y  200   | 10%                                                          |  Instrument Sans 600, 280 px, -0.045em
y  500   | of this payment became                                       |  44 px, ink-secondary
y  580   | [SPY tile 88] [  SPY  ]                                      |  knockout: bg ink, white 64/600, pill
y  690   | debt security, not a share                                   |  36 px, 500, ink-secondary
y  800   | (check) Checked against the market reference before buying  |  32 px, check in text-equity
y  900   o - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -o  perforation: 2 px dashed border-strong,
         |                                                              |  24 px half-circle notches at both edges
y  960   | (o) 90% stayed spendable        (o) 10% became SPY           |  stub on bg-surface; 32 px legend, 20 px dots
y 1180   | sleeve.example/card/r8KQm2xV4nPz                 24 Sep 2026 |  mono 26 px ink-secondary; date 26 px
y 1310   |██████████████████████████████████████████████▌███████████████|  rail 40 px, full bleed, 4 px gaps
y 1350   +--------------------------------------------------------------+
```

- The face is the colorway; the stub is always bg-surface, so the rail, legend and URL keep DESIGN.md's colors on every colorway.
- The perforation is the ticket boundary from Supabase's tickets: statement above, evidence below.
- The token icon uses the TokenIcon tile shape and hairline ring (icon-system.md 4.3) at 88 px. The ticker is the identity; the fund or company name is not printed on the face (D-023).
- The y values above are the default card. In the build the face grows and the stub hugs its content (about 230 px without proof), so no gap opens between the legend and the URL.
- With amounts on, the swap block sits between the debt line and the perforation, and the figure shrinks to 200 px.
- With proof on, the tape takes the stub's middle band (labels left in ink-secondary, values right in ink), the QR code 168 to 200 px on the right, and the DISCLAIMER at 20 to 22 px above the URL row. The figure also drops to 200 px, or the rail is pushed off the bottom (seen in the prototype, section 9).
- The URL uses the production host from configuration. The domain is still an open input; never hardcode one.

### 6.3 Story (1080x1920) and OpenGraph (1200x630)

- Story: the same order with more air: figure 360 px, stub from y 1300. Text stays between y 250 and y 1670, clear of the Stories header and reply bar (the commonly cited 250 px safe band, for example moda.app's Instagram Story spec); only the rail runs into the bottom band.
- OpenGraph: two columns.

```
+--------------------------------------------------------------------------------------+
| Sleeve                                                     [ FILLED ] [Sample data]    |
|                                                                                       |
| 10%                                  | (check) Checked against the market reference   |
| of this payment became               |         before buying                          |
| [SPY tile 64] [ SPY ]                | or, with amounts on, the swap block            |
| debt security, not a share           |                                                |
|                                      | (o) 90% stayed spendable  (o) 10% became SPY   |
|                                                         sleeve.example/card/r8KQm2xV4nPz |
|█████████████████████████████████████████████████████████████▌████████████████████████| rail 14 px
+--------------------------------------------------------------------------------------+
```

The rail ends 15 px above the bottom edge (section 8.5), and nothing but the rail sits in the bottom-left corner.

### 6.4 Colorways (Spotify's swatches, tokens only)

| Colorway | Face | Text on the face | Note |
| --- | --- | --- | --- |
| Paper (default) | bg-canvas with a 1 px border-border frame | ink, ink-secondary | Quietest; closest to the app |
| Mint | --gradient-hero | ink and ink-secondary (worst stop green-300: 14.83 and 4.62) | |
| Apricot | --gradient-apricot | ink and ink-secondary (worst stop apricot-200: ink-secondary 4.59) | Never puts an equity figure on apricot (DESIGN.md 2.5): amounts move to the stub-colored swap panels |
| Deep green | --gradient-accent-deep with concentric arcs, 1 px at 7 percent white every 14 px, drawn as an SVG data URI image (Ramp, Mercury) | on-accent white (worst stop 5.78); the knockout flips to a white pill with ink text | The metal-card colorway |

No colorway keyed to a token's own colors (SPDR blue, NVIDIA green). The owner picks the colorway; the words never change.

### 6.5 Composer and card page

- Composer (the existing CardComposer dialog): colorway swatches as a radiogroup of four 44 px swatch buttons with visible labels; format as a segmented choice (Post, Story); the Show amounts and Show proof toggles stay, and the proof confirmation stays exactly as built. The preview is the card itself at a reduced scale on bg-stage.
- Card page /card/[cardId] in the public frame: the image with full alt text; actions "Download image" (Post or Story), "Copy image" (Strava's clipboard copy, through ClipboardItem), "Share card" (Web Share with the PNG file where navigator.canShare accepts files, otherwise copy the link) and "Copy link"; under the image, a text version of the card as a definition list; with proof on, "Check this receipt" links to the verify page; the disclaimer footer.
- Offer "Make a card" as a secondary action on a FILLED or SETTLED receipt (Duolingo's moment).

## 7. Direction: week card

### 7.1 What it says

"Week of 28 Sep 2026" (Monday 00:00 New York time, as week.ts defines it), the payday count as the large figure, "10% of each became SPY" with the token icon (TokenStack when the week bought more than one ticker), the debt security line, the week strip, the stamp ("Every buy was checked against the market reference") or, with amounts on, the range ("Bought between 0.02 and 0.12 percent above the market reference"), the legend, the URL and the rail.

The rail on a week card shows the week's mix by payday count with amounts off (the rule's share of pay, its equity part split into bought and still waiting at week end) and by USDG with amounts on.

### 7.2 The week strip

| Element | Encoding | From |
| --- | --- | --- |
| Days | Seven columns, Monday to Sunday, initials under each (M T W T F S S) | GitHub Unwrapped |
| A payday | One full-height bar per split that day, side by side when a day has two. Spend apricot at the bottom, equity green on top, in the share of pay | Apple Card weekly bars; DESIGN.md 2.4 stacking order |
| Equity that waited | The equity segment in waiting stripes | DESIGN.md pattern-waiting |
| Bought later | A 2 px connector from the striped segment to a small green cap on the day it settled; after Sunday it leaves the right edge with "bought Mon 5 Oct" | Sleeve |
| Refused | The whole bar apricot (refused equity is spendable, DESIGN.md 12.1) with "refused" under it | DESIGN.md |
| No payday | A dotted baseline tick | GitHub contribution cells |
| Market session | An 8 px band under the bars: plain surface-strong while open, waiting stripes while closed, split on Friday and Sunday where the 24/5 session closes and opens | Supabase's Monday to Friday row; stripes already mean waiting |
| Size | With amounts off every payday bar is the same height. With amounts on, bar height scales to that day's USDG and the tallest day is full height | GitHub Unwrapped's peak day |
| Ground | The strip sits on a bg-surface panel (radius 24) on every colorway, for the reason the stub does: green bars vanish on Deep green and apricot bars fade on Apricot | DESIGN.md 2.5 |

### 7.3 Anatomy, Post format, 1080x1350

```
| [Sample data strip, mock only]                                 |
| Sleeve                                     Week of 28 Sep 2026 |
|                                                                |
| 3 paydays                                                      |  figure 200 px plus "paydays" 64 px
| 10% of each became [SPY tile 64] SPY                           |
| debt security, not a share                                     |
|                                                                |
|   M      T      W      T      F      S      S                  |
|  [##]   ...   [##]   ...    ...   [##]~~~~~~~~~~~> bought Mon  |  strip, 360 px tall
|  ====   ====  ====   ====   ===/  ////   /===                  |  session band
|                                                                |
| (check) Every buy was checked against the market reference     |
o - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - o
| (o) 90% stayed spendable   (o) 10% became SPY                  |
| sleeve.example/card/w5Hn9bT6cY1s                               |
|█████████████████████████████████████████████████▌████/////////|  rail with the waiting share striped
```

Alt text example: "Sleeve week card, week of 28 September 2026: 3 paydays, 10 percent of each became SPY. One buy waited for the market to open and bought on Monday. debt security, not a share."

## 8. Direction: OpenGraph images

### 8.1 Site, app/opengraph-image.tsx

```
+--------------------------------------------------------------------------------------+
| Sleeve                                                              [Sample data]      |
|                                                                                       |
| When you get paid, part of it          +-----------------------------------------+    |
| becomes a US Stock Token you own       | stage art (three stacked layers)         |    |
| and the rest stays spendable.          |   +---------------------------------+   |    |
| You set it once.                       |   | [USDG] 500.00 USDG arrived      |   |    |
|                                        |   | [rail 90 / 10]                  |   |    |
|                                        |   | 450.00 USDG spendable           |   |    |
|                                        |   | 50.00 USDG became [SPY] SPY     |   |    |
|                                        |   | Bought 0.10 percent above the   |   |    |  the card is cropped by
|████████████████████████████████████████████████████████████▌█████████████████████████|  the bottom edge (Cal.com)
+--------------------------------------------------------------------------------------+
```

- ONE_SENTENCE_PARTS from landing-copy.ts, 46 px, weight 500, -0.03em, textWrap balance, in a 600 px column.
- The right panel is --gradient-stage built from three stacked absolute layers, holding the white split card from the fixture world, with the "Sample data" tag while the mock runs.
- The stage ends 24 px above the rail, so the rail reads as the image's base line. In the prototype the stage ran under the rail and the two fought. The white card may run off the stage's lower edge (Cal.com's crop) when its copy is longer; it never runs into the rail.
- The image does not name Robinhood Chain, so it needs no disclaimer. Alt: "Sleeve: when you get paid, part of it becomes a US Stock Token you own and the rest stays spendable."

### 8.2 Card pages, app/(public)/card/[cardId]/opengraph-image.tsx

The card's own OpenGraph format (section 6.3), with the privacy choices the owner made. Alt text from the card's words.

### 8.3 Verify, app/(public)/verify/opengraph-image.tsx

```
| Sleeve  |  Verify a receipt                                                    |  Linear's lockup
|                                                                               |
| Paste a receipt id. The check re-reads      +---------------------------+     |
| the chain through a different RPC           | RECEIPT 1042       FILLED |     |  Plex Mono tape
| provider and recomputes every number.        | USDG in ........ 500.00   |     |
|                                              | To spend ....... 450.00   |     |
|                                              | To SPY .......... 50.00   |     |
|                                              | SPY out ....... 0.0718    |     |
|                                              | Premium .. 0.10% above    |     |
|                                              | Chainlink round ... 4,211 |     |
|                                              | [Sample data]             |     |
|██████████████████████████████████████████████████████████████████████████████| rail
```

If a /verify/[receiptId] route lands, its image shows that receipt's fields from data the server reads, "Robinhood Chain, chain id 4663" with the DISCLAIMER in the bottom band, and "Recompute this receipt at" the page URL. It never says the receipt matched unless the renderer ran the check.

### 8.4 App pages

Signed-in routes inherit the site image. No account data goes into an image a crawler can fetch.

### 8.5 Sizes and safe areas

- OpenGraph files are 1200x630. All content sits inside the central 1200x600 band (15 px top and bottom). X documents a 2:1 ratio for summary_large_image (quoted by moda.app's Twitter card guide), which is also the shape GitHub ships.
- Since October 2023 X shows link cards as the image with only the domain overlaid in the lower-left corner (newscaststudio.com, whitep4nth3r.com), and in November 2023 said the title would come back overlaid at the top (10News). Keep the lower-left 320x64 of the band free of text and keep the top 64 px free of anything essential.
- Set twitter:card to summary_large_image in the root metadata. X falls back to og:image for the image but not for the card type (X Cards markup reference).
- Downloads: Post 1080x1350 and Story 1080x1920.
- Version the templates (Linear's v parameter, or let a template change alter the file Next hashes) so social caches refresh.

## 9. Building the images with next/og

Checked by rendering prototypes of the receipt card (all four colorways, with amounts and with proof), the week card and the site image through the @vercel/og 0.7.2 that Next 15.5.27 bundles (next/dist/compiled/@vercel/og). The prototype script is scratch code in the session scratchpad (insp/proto/render.mjs), useful as a reference for structure only. What it showed:

- The TTF fonts load, base64 PNG logos render, and linear, radial and repeating-linear gradients render, so the waiting stripes work as they do in CSS.
- repeating-radial-gradient throws "Invalid background image". Draw the Deep colorway's engraved arcs as an SVG data URI image instead.
- Border styles accept only solid and dashed. The perforation is dashed; a dotted line has to be drawn another way.
- fontFeatureSettings is not applied, so figures set in Instrument Sans keep its proportional digits. That is fine for a single figure; anything that must line up in columns (the proof tape) is set in Plex Mono.
- Without a hugging stub, the default card leaves a gap above the URL, and with proof on a 280 px figure pushes the rail off the bottom; section 6.2 now covers both.

Rules for the build:

- ImageResponse from next/og ships with the App Router; no package to add. It uses Satori and Resvg. Use the Node runtime.
- Fonts: only ttf, otf and woff; WOFF2 is not supported, and ttf parses fastest (Vercel OG docs, Satori README). The Google Fonts CSS API returns static TTF instances to a plain client: Instrument Sans 500 and 600 (48,732 bytes each) and IBM Plex Mono 400 (128,812 bytes), checked 3 October 2026. Commit them under app/src/og/fonts with the OFL text and read them at module scope with readFile(join(process.cwd(), ...)). Avoid the variable font file; Satori draws its default instance.
- Layout: flexbox and absolute positioning only, no grid. Any element with more than one child needs display flex.
- Backgrounds: use linear-gradient, radial-gradient, repeating-linear-gradient or url(). Stack the three stage layers as three absolute divs rather than one comma-separated value.
- Headlines: textWrap 'balance', which the bundled version handles.
- Images: token logos from public/assets/tokens as base64 data URIs (readFile with 'base64'). The ArrayBuffer form needs a TypeScript suppression, which this repo bans. Glyphs and the QR code (components/ui/qr.ts) as SVG data URIs.
- Colors: Satori cannot read CSS custom properties. Add app/src/styles/og-tokens.ts with the hex values the images use, and a test that parses tokens.css and fails on any drift, so tokens.css stays the single source (DESIGN.md 2.6 rule 7).
- Copy: strings in image JSX are UI strings and copy-lint scans them. Render DEBT_SECURITY_LINE, DISCLAIMER and SAMPLE_DATA_LINE from lib/copy.ts instead of retyping them.
- Params: on Next 15.5.27 the image function receives params as a plain object (next-metadata-route-loader.js line 176); Next 16 turns it into a Promise.
- One renderer: write CardArt as a pure component with inline styles that both ImageResponse and the DOM can draw. ImageResponse passes data URIs and the registered font names; the composer and card page pass /assets/tokens URLs and the next/font variables. That keeps the preview and the PNG from drifting apart.
- Routes: /card/[cardId]/image/[format] returns the PNG for post and story; with ?download=1 it adds Content-Disposition with a file name such as sleeve-card-r8KQm2xV4nPz-story.png.
- Caching: a receipt card never changes, so its images get an immutable one-year cache (Supabase's 31536000). A week card for a week that has ended is the same; for the current week, revalidate every 300 seconds.
- Abuse: render only from data the server reads itself (the fixture world on the mock, the chain and the card store later), never from text in the URL. A renderer that draws whatever a query string says would let anyone print a fake Sleeve receipt on Sleeve's domain.
- robots: allow /card and the opengraph-image paths. Set metadataBase from the production host.

## 10. Data the cards need

- colorway ('paper' | 'mint' | 'apricot' | 'deep') on CreateCardInput, the mock's StoredCard and both card types.
- ReceiptCard.premiumBps (signed basis points from the receipt). Drawn only with amounts on, unless the owner decides otherwise.
- WeekCard.days: seven entries, each with dayStart (00:00 New York time), session ('open' | 'partial' | 'closed'), and its splits as { outcome: 'BOUGHT' | 'WAITED' | 'REFUSED', settledDay: 0 to 6, 7 for after the week, or null while still waiting }, plus usdgIn per day only when amounts are shown.
- WeekCard.premiumRangeBps ({ low, high } or null) and waitingAtWeekEnd.
- The mock has no TypeScript session calendar yet. Until packages/core gets a port of SessionCalendar, derive the day states from the 24/5 week (Sunday 20:00 to Friday 20:00 New York time) and leave holidays for the port.
- On the mock, cards made in a browser tab live only in that tab, so the server can draw only the fixture cards (r8KQm2xV4nPz and w5Hn9bT6cY1s). Real cards need a server-side card store when the chain source lands.

## 11. What Sleeve does not borrow

- Daily changes, sparklines and gain or loss colors (Yahoo, Jupiter, Hyperliquid, TradingView). Sleeve makes no performance claims.
- "Beta" or "New" tags on nav items for unreleased features (Uniswap, Jupiter). Gated features stay out of navigation and the palette.
- Lime and neon accents (Spotify's 2025 script, Ramp's demo button, Wise's sign-up green). They sit in the hue band DESIGN.md section 3 rules out.
- Rewards for sharing (Supabase's gold ticket) and streak mechanics (Duolingo). No nudges around investing.
- Jokes about money (Monzo's savage mode).
- Logo walls in images (PlanetScale). They imply partnership.
- Dark themes (Linear, Raycast, Resend, Zed, Hyperliquid). Sleeve is light only.
- Fund or company marks at hero size, and colorways taken from token colors (D-023).
- Transparent stickers (Strava). The debt security line needs a background Sleeve controls.
- Robinhood's trade confirmations, the feather and Robin Neon, anywhere.

## 12. Self-check against the generic

- The bar stays closeout's. The menus carry Sleeve's own three questions (How it works, Stock Tokens, Receipts), and each holds live data no template would have: session state, pool against reference, and what a payment would do right now.
- The cards lead with a figure because the share of pay is the fact PRD 7.10 says a card shows. The figure is set as part of one sentence with the ticker, and the perforation, stub and bottom rail come from tickets, receipts and repository cards.
- One loud element per surface: the session pill in the bars, the split on the cards. Removed after review: Arc's scalloped edge on the proof tape (the perforation already marks the boundary) and a fifth "Ink" colorway (black means action in this system).

## 13. Open questions for the owner

1. Premium on the default receipt card. This document shows a stamp by default ("Checked against the market reference before buying") and the exact premium only with "Show amounts", because PRD 7.10 lists only the ticker, the share of pay and the debt security line for the default. Keep that, or print the exact premium by default?
2. The week strip shows which days paydays landed. While few accounts use Sleeve on Robinhood Chain, the week, the ticker, the share of pay and the days can point to one account even with amounts and proof off; the existing default already shows the week and the payday count. Keep the strip on the default card, or draw it only with "Show amounts"?
3. A mark for images: the SplitMark beside the word "Sleeve" on cards and OpenGraph images. DESIGN.md says Sleeve has no logo yet.
4. The production domain printed on cards and used for metadataBase (still an open batch 1 input).
5. Where real cards are stored once the chain source lands (a card store in Supabase is the obvious place, since D-014 already uses it for credentials).

## 14. Build list

For the navbar-shell builder:

1. Rebuild MarketingHeader per section 4: the two scroll states through an IntersectionObserver sentinel; three disclosure triggers with the panels in 4.3 (continuous white surface, bg-surface-muted rail with the live preview, footer strip); the network chip from 1280; the shared session pill; the black "Open the app" pill, or the account chip when useSession has a session; below 1024 the compact pill, a Menu button and the full-height sheet in 4.5.
2. Restyle SampleDataNotice as the centered strip with the SplitMark, keeping SAMPLE_DATA_LINE.
3. Build SessionPill and MarketsPanel as shared components (5.2 and 5.3) on useMarket, useRule, premiumBps and exceedsPremium, plus a short New York time formatter beside formatNewYork.
4. Extend AppShell's top bar to the tiers in 5.1: palette trigger, session pill, balances chip with its popover (5.4); below 768 the wordmark, compact pill, search button and avatar button with the account sheet (5.5). Give the rail account card the network health line and the account menu.
5. Build the command palette (5.6) on the Dialog, with the combobox and listbox pattern, ⌘K, Ctrl K and "/", receipt lookup through lib/receipt-id.ts and useReceipt, and the preview pane from 1024.
6. No new dependencies, tokens only, nothing gated in navigation or the palette, reduced motion respected, 360 px with no horizontal scroll.

For the cards-og builder:

1. Build CardArt (receipt card and week card) as one pure inline-style component for three formats (og 1200x630, post 1080x1350, story 1080x1920) and four colorways, per sections 6, 7 and 9.
2. Add the routes: app/opengraph-image.tsx; app/(public)/verify/opengraph-image.tsx; app/(public)/card/[cardId]/page.tsx with opengraph-image.tsx; app/(public)/card/[cardId]/image/[format]/route.tsx. Add the per-receipt verify image only if the verify builder adds /verify/[receiptId].
3. Add og-tokens.ts with its drift test against tokens.css, the TTF fonts with the OFL text, and token logos as base64 data URIs.
4. Make the data-layer additions in section 10, with mock implementations and tests. The server renderer reads the fixture world on the mock and never takes content from the URL.
5. Upgrade CardComposer (colorway swatches, format choice, live preview) and build the card page actions (Download image, Copy image, Share card, Copy link), the text version under the image, the sample data strip on every image while the mock runs, and alt text for every image.
6. In the root metadata set twitter:card to summary_large_image and metadataBase from configuration; allow the image paths in robots.

## 15. Sources

All read or captured on 3 October 2026 unless a date is given.

Navigation: https://linear.app, https://vercel.com, https://stripe.com, https://www.raycast.com, https://mercury.com, https://ramp.com, https://www.wealthsimple.com/en-ca, https://uniswap.org, https://app.uniswap.org/swap, https://rainbow.me, https://family.co, https://phantom.com, https://zora.co, https://arc.net, https://wise.com/us/, https://www.tradingview.com/symbols/AMEX-SPY/, https://finance.yahoo.com/markets/, https://finance.yahoo.com/quote/SPY/, https://app.aave.com, https://app.morpho.org, https://app.hyperliquid.xyz/trade, https://jup.ag, https://polymarket.com, https://www.revolut.com/en-US/, https://rainbowkit.com/docs/connect-button.

Cards: https://newsroom.spotify.com/media-kit/2025-wrapped (2025WrappedForArtist_Sharecard_02.png, 09141992_user_experience_header_horizontal_light_2.png); https://www.bikeradar.com/news/strava-sticker-stats-spring-2025-updates (9 April 2025); https://www.tomsguide.com/wellness/fitness/stop-screenshotting-your-runs-this-hidden-strava-feature-looks-much-cleaner-on-instagram (15 January 2026); https://www.githubunwrapped.com and https://www.githubunwrapped.com/og/JonnyBurger.jpg; https://www.apple.com/apple-card/; https://www.apple.com/newsroom/2019/03/introducing-apple-card-a-new-kind-of-credit-card-created-by-apple/ (25 March 2019); https://arun.is/blog/apple-card/ (28 March 2019); https://mercury.com/io; https://ramp.com/corporate-cards; https://receiptify.herokuapp.com; https://www.thestar.co.uk/read-this/heres-how-people-are-making-receipts-of-their-top-spotify-tracks-2981151; https://www.yorkshireeveningpost.co.uk/lifestyle/receiptify-how-create-custom-spotify-receipt-your-top-played-tracks-2981145; https://www.nytimes.com/games/wordle/index.html; https://dinogame.gg/blog/why-wordle-blew-up/; https://supabase.com/blog/designing-with-ai-midjourney (7 April 2023); https://blog.duolingo.com/streak-milestone-design-animation (21 January 2022); https://blog.duolingo.com/year-in-review-behind-the-scenes (8 December 2022); https://www.apple.com/newsroom/2025/04/get-active-with-apple-watch/ (14 April 2025); https://community.monzo.com/t/year-in-monzo-2024-is-here/172368 (December 2024); https://opengraph.githubassets.com/1/vercel/satori; https://miniapps.farcaster.xyz/docs/specification; https://arc.net/boosts; https://www.ghacks.net/?p=195846 and https://alternativeto.net/news/2023/5/arc-browser-s-boosts-2-0-take-control-of-the-web-and-make-it-look-the-way-you-really-want.

OpenGraph: the og:image files listed in section 3, read from each page's tags; https://vercel.com/docs/og-image-generation; https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image; https://github.com/vercel/satori; https://developer.x.com/cards/markup; https://www.newscaststudio.com/2023/10/06/x-twitter-headline-preview-change/; https://whitep4nth3r.com/blog/twitter-ruined-link-previews/; https://www.10news.com/elon-musk-says-news-article-headlines-are-returning-to-x; https://moda.app/resources/sizes/instagram-story; https://moda.app/resources/sizes/twitter-card; https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@500;600&family=IBM+Plex+Mono:wght@400;500.

In this repo: docs/DESIGN.md, docs/design/closeout-landing-blueprint.md, docs/design/closeout-product-blueprint.md, docs/design/icon-system.md, docs/DECISIONS.md (D-005, D-014, D-020 to D-023), docs/research/issuer-docs.md section 4, internal/Sleeve-PRD-v1.4.md sections 1, 6, 7, 10, 15 and 16, app/src/data/types.ts, app/src/data/mock/cards.ts, app/src/lib/copy.ts, scripts/copy-lint.mjs.
