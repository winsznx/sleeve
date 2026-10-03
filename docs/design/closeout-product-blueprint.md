# Closeout product UI blueprint for Sleeve

This is the build reference for Sleeve's signed-in app and its public verify page. It records how the owner's closeout product UI is built, value by value, and maps every pattern onto a Sleeve screen. The landing has its own blueprint in `docs/design/closeout-landing-blueprint.md`. Sleeve's tokens already exist in `app/src/styles/tokens.css` (v2), so wherever this file gives a closeout value it also names the Sleeve token that replaces it.

All closeout paths are relative to `/Users/mac/closeout/apps/web/`. `L` means line number in that file. Values were read from source on 3 October 2026 and checked against renders of the running dev server on `http://localhost:4664`.

How to read it:

1. Sections 1 to 12 describe closeout as it is, with exact values.
2. Section 13 lists closeout defects. Do not copy them.
3. Section 14 is the blue map for the product UI with the green token for each use.
4. Section 15 maps every Sleeve screen onto the patterns, with wireframes, data hooks and copy constraints.
5. Section 16 is sources and method.

Copy rule reminder for builders: closeout's words, name and logo never appear in Sleeve. Only structure and values carry over.

---

## 0. What closeout's product UI is, in one paragraph

A flat light-grey page (`#eceef1`) holds a borderless left rail of icon plus label links where the current page is a single white pill with a soft shadow. To the right sits one big white workspace panel with 22 px corners, inset 12 px from the window on top, right and bottom. The panel opens with a 68 px breadcrumb bar under a hairline. Content is black and grey type on white, cut into 16 to 18 px radius bordered panels, ruled lists and small uppercase status tags. Color only appears in tags, a few tinted callouts and one red, one amber, one blue, one green. The primary action is always a black control. On phones the rail disappears, the panel goes edge to edge, and a frosted bottom bar with four items and a More sheet takes over.

The comment at the top of `app/product.css` L1-5 states the intent: "a flat light-grey page, a borderless left icon+label rail with one white pill active row, a rounded white workspace panel, a breadcrumb bar with back/forward chevrons, a stat-tile row whose tiles carry a metric, a small trend line and a See in details link, a two-column module row, and a queue list with per-row actions."

Important: the stat-tile row, module row and queue list (`.dash-*`, L403-857) are styled in `product.css` but no `.tsx` file uses them (checked with grep over `app/**/*.tsx`). Neither do `.page-heading`, `.page-toolbar`, `.filter-pills`, `.workspace-search`, `.directory-*`, `.connection-*`, `.closeout-form`, `.settings-*` or `.closeouts-row`. The pages render with Tailwind utilities instead. Those orphan classes are the most complete expression of the intended design, so this blueprint documents both: what renders, and the CSS-only patterns. Sleeve should build from the CSS-only patterns where they fit, because they are richer and already responsive.

---

## 1. Tokens

### 1.1 Color

Source: `app/globals.css` L7-40, mirrored in `tailwind.config.ts` L23-50.

| Closeout token | Value | Role in the product UI | Sleeve token (tokens.css) |
| --- | --- | --- | --- |
| page shell (hard coded, `product.css` L10) | `#eceef1` | Area behind the rail and panel | `--color-shell` `#eceef1` |
| rail raised fills (`product.css` L46, L132) | `rgba(255,255,255,0.7)` | Org card, help card | `--color-shell-raised` |
| rail hover (`product.css` L99) | `rgba(255,255,255,0.72)` | Nav link hover | `--color-shell-raised` |
| `--canvas`, `--surface` | `#ffffff` | Workspace panel, cards | `--color-canvas`, `--color-surface` |
| `--surface-muted` | `#f4f5f7` | Stat tile fill, inputs, table header strip, row hover, selected row | `--color-surface-muted` |
| `--surface-strong` | `#ebedf1` | Neutral tag fill, low-severity mark | `--color-surface-strong` |
| `--border` | `#e7e9ee` | Every hairline and card border | `--color-border` |
| `--border-strong` | `#d4d8e0` | Hover border, breadcrumb slash | `--color-border-strong` |
| none | none | Input outline at 3:1 | `--color-border-control` `#898d94` (new in Sleeve) |
| `--ink` | `#0b0b0c` | Headings, primary text | `--color-ink` |
| `--ink-secondary` | `#5b6270` | Body, labels, nav links | `--color-ink-secondary` |
| `--ink-muted` | `#8a909c` | Metadata, timestamps, column headers. 3.21:1 on white, fails AA | `--color-ink-muted` `#6a6f7b` (5.03:1 on white) |
| `--brand` | `#101114` | Primary buttons, avatar, pressed filter pill | `--color-brand` |
| `--brand-strong` | `#000000` | Primary hover | `--color-brand-strong` |
| `--accent` | `#3b71f0` | Focus outline | `--color-accent` green-600 `#007456` |
| `--accent-strong` | `#2554cc` | unused in product | `--color-accent-strong` green-700 |
| `--accent-soft` | `#eaf0fe` | unused in product | `--color-accent-soft` green-100 |
| `--preserve` / `-soft` | `#3b71f0` / `#eaf0fe` | Keep state, positive emphasis | `--color-equity` / `--color-equity-soft` for split meaning, `--color-accent` otherwise |
| `--info` / `-soft` | `#3b71f0` / `#eaf0fe` | Planned and scheduled tags | `--color-info` / `--color-info-soft` |
| `--success` / `-soft` | `#17a673` / `#e6f7f0` | Complete, healthy, active | `--color-success` / `--color-success-soft` (green-600 / green-100) |
| `--warning` / `-soft` | `#c98a14` / `#fcf3e1` | Needs review, degraded | `--color-warning` `#bc8000`, text `--color-warning-text` `#946300` |
| `--close`, `--danger` / `-soft` | `#d93b3b` / `#fdecec` | Change, blocked, partial, errors | `--color-danger`, text `--color-danger-text` `#ca2b2f` |

Sleeve adds apricot for the spend side (`--color-spend*`) and amber hatching for waiting (`--pattern-waiting`). Closeout has no equivalent; section 15 says where they go.

### 1.2 Type

Source: `app/fonts.ts` L3-15, `tailwind.config.ts` L61-78, `globals.css` L54-57.

- Sans: Instrument Sans 400, 500, 600, 700 via `next/font/google`, variable `--font-instrument-sans`. Body falls back to `Inter, -apple-system, Arial, sans-serif` (`globals.css` L55).
- Mono: IBM Plex Mono 400, 500, variable `--font-ibm-plex-mono`. Used for dates, resource keys, step numbers. In the renders the mono text fell back to a Courier-like face, so the variable is not reaching the Tailwind `font-mono` stack on some routes. Sleeve's `--font-mono` already has a named fallback.
- Product base size: 14 px (`product.css` L12).
- `-webkit-font-smoothing: antialiased` (`globals.css` L56).

Tailwind steps used by the product pages (`tailwind.config.ts` L68-77):

| Name | Size | Line height | Tracking | Sleeve token |
| --- | --- | --- | --- | --- |
| `text-h1` | 40 px (2.5rem) | 1.1 | -0.028em | Do not use for page titles. See 3.3 |
| `text-h2` | 30 px | 1.15 | -0.022em | `--text-h1-*` (25 to 30 px) for page titles |
| `text-h3` | 21 px | 1.25 | -0.014em | `--text-h2-*` (21 px) |
| `text-body` | 15 px | 1.55 | | `--text-body-*` |
| `text-body-s` | 13 px | 1.5 | | `--text-body-s-*` |
| `text-label` | 12 px | 1.25 | 0.005em | `--text-label-*` |
| `text-micro` | 11 px | 1.25 | 0.02em | `--text-micro-*` |

CSS-only sizes in `product.css`: page h1 30/1.15/-0.025em/600 (L280-285), page lede 14/1.65 max-width 660 px (L287-293), module and section h2 16/600/-0.012em (L556-560, L699-703), row title 15/600/-0.01em (L769-775), stat figure 28/1.15/-0.028em/600 (L445-452), breakdown figure 21/600/-0.02em (L598-604). Sleeve tokens: `--text-h1` 30 px, `--text-h3` 16 px, `--text-figure-m` 28 px, `--text-figure-s` 21 px match these.

Weights in practice: 600 for titles, current nav item, figures and tags in CSS; 500 for row names, buttons and Tailwind tags; 400 elsewhere.

### 1.3 Radii

From `globals.css` L34-36, `tailwind.config.ts` L79-86 and the literal values in `product.css`:

| Value | Where | Sleeve token |
| --- | --- | --- |
| 6 px | Global `:focus-visible` box-shadow radius (`globals.css` L81) | `--radius-xs` |
| 8 px | Breadcrumb chevron hit area (L236) | `--radius-xs` |
| 10 px | Buttons (`rounded-control`), tags, search, select, error retry (L336, L392, L800) | `--radius-control` |
| 11 px | Avatar (L58), form fields (L1063) | `--radius-control` |
| 12 px | Nav links (L91), mobile nav items (L1387), stat icon tiles at 13 (L430) | `--radius-control` or `--radius-row` |
| 14 px | Org card (L45), list rows in modules (L579, L724), empty and skeleton boxes (L652, L834, L854), note callout (L1084) | `--radius-row` |
| 16 px | `rounded-panel`: panels, list containers, help card (L134), directory list (L865) | `--radius-panel` |
| 18 px | Modules, stat tiles, connection cards, settings sections, error card, More sheet (L350, L414, L542, L686, L943, L1102, L1406) | `--radius-module` |
| 20 px | `rounded-large`: StatTile, StepperPanel, connection cards as rendered, verdict banner, form card (L1046) | `--radius-large` |
| 22 px | Workspace panel (L186) | `--radius-workspace` |
| 24 px | `rounded-card`: NeedsYouCard | `--radius-card` |
| 999 px | Rail create button (L126), filter pills (L312), queue Go button (L816) | `--radius-pill` |

The rule underneath: controls 10, rows 14, containers 16 to 18, hero objects 20 to 24, the frame 22, and pills only for the one primary rail action and filters.

### 1.4 Shadows

| Name | Value | Where | Sleeve |
| --- | --- | --- | --- |
| card | `0 1px 2px rgba(11,11,12,0.04), 0 6px 18px rgba(11,11,12,0.05)` | StatTile, StepperPanel, verdict banner, healthy connection, plan mobile cards (`tailwind.config.ts` L88) | `--shadow-card` |
| nav pill | `0 1px 2px rgba(11,11,12,0.06), 0 4px 12px rgba(11,11,12,0.05)` | Current rail link (L105) | `--shadow-raised` |
| workspace | `0 1px 2px rgba(11,11,12,0.04), 0 8px 24px rgba(11,11,12,0.04)` | Workspace panel (L188) | `--shadow-workspace` |
| floating | `0 12px 40px rgba(11,11,12,0.10)` | unused in product (`tailwind.config.ts` L89) | `--shadow-floating` |
| sheet | `0 12px 40px rgba(11,11,12,0.16)` | Mobile More sheet (L1408) | `--shadow-overlay` |
| soft | `0 1px 3px rgba(11,11,12,0.05)` | unused | `--shadow-soft` |

`Panel.tsx` L14-16 states the rule: bounded objects (a tile, a card that is one thing) may carry elevation, ordinary ruled lists and table rows never do.

### 1.5 Spacing rhythm

Closeout uses odd literal values in CSS rather than a scale. The recurring ones: gaps 3, 7, 10, 13, 14, 16, 18, 20, 22 px; paddings 11-14 (controls and nav), 13-16 (rows), 18-20 (tiles and modules), 24-26 (cards, page), 28-36 (page top). Page padding is `28px 26px 40px`, `34px 36px 48px` at 1440 px and up, `24px 20px 36px` at 1100 px and down, `22px 18px 32px` under 768 px (L268-270, L1207-1216, L1233-1236, L1275-1278). The Tailwind pages use `px-6 py-6` (24 px) instead, which is why their content sits closer to the panel edge than the CSS pages intend.

Sleeve: `--layout-gutter` already steps 16, 20, 26, 36 px. Use it for page padding left and right, and `--space-7` (28 px) top, `--space-10` (40 px) bottom. Below 768 px use 22/16/32. Keep the 16 px phone gutter from the build contract rather than closeout's 18 px.

### 1.6 Motion

- Nav and link color and background: `140ms ease` (L94). Tailwind `duration-fast` 140 ms, `standard` 220 ms, `narrative` 360 ms (`tailwind.config.ts` L100-104).
- StepperPanel row color change uses `duration-standard` (`StepperPanel.tsx` L30).
- Nothing else moves. No entrance animations, no skeleton shimmer, no page transitions, no `prefers-reduced-motion` block anywhere in `product.css`.

Sleeve already has `--duration-*`, `--ease-standard` and a reduced-motion block in `tokens.css`. Keep motion to state changes: sheet in and out, toast, tab underline, the split rail filling once on a new receipt.

---

## 2. App shell

Markup (`app/(product)/layout.tsx` L4-5):

```
div.product-shell
  aside.workspace-rail            NavRail.tsx
  main#main-content.product-workspace
    {page}                        each page renders its own TopBar first
  MobileNav                       nav.workspace-mobile-nav + div.workspace-mobile-more
```

### 2.1 Page shell

`.product-shell` (L7-13): `min-height: 100vh; display: flex; background: #eceef1; color: var(--ink); font-size: 14px`. Under 768 px it switches to `background: #fff; padding-bottom: 78px` (L1256-1259).

### 2.2 Left rail (desktop and tablet)

Container `.workspace-rail` (L17-28): `width: 262px; flex-shrink: 0; padding: 24px 16px 18px; display: flex; flex-direction: column; justify-content: space-between; position: sticky; top: 0; height: 100vh; overflow-y: auto`. At 1100 px and down: `width: 224px; padding-left/right: 12px` (L1228-1232). Hidden under 768 px (L1253-1255). Note `tailwind.config.ts` L98 says the rail is 248 px; the CSS wins at 262. Sleeve: `--layout-rail` 16.375rem (262 px) and `--layout-rail-compact` 14rem (224 px).

Top group, in order (`NavRail.tsx` L29-69):

1. Logo link `.workspace-logo` (L30-39): flex, `padding: 6px 10px 22px`, image 146 px wide. Sleeve: the Sleeve wordmark (`components/ui/wordmark.tsx`) at the same box. No network logo here.
2. Org card `.workspace-org` (L41-76): flex, gap 11, radius 14, fill `rgba(255,255,255,0.7)`, padding `11px 12px`, margin-bottom 20. Avatar `.workspace-avatar` 34x34, radius 11, `--brand` fill, white 13/600 initial. Name 13/600, `overflow-wrap: anywhere`. Sub line 11 px `--ink-muted`, margin-top 2.
3. Nav `.workspace-navigation` (L78-117): column, gap 3. Each link: `min-height: 46px; display: flex; align-items: center; gap: 13px; padding: 11px 14px; border-radius: 12px; color: var(--ink-secondary); font-size: 14px; transition: background 140ms ease, color 140ms ease`. Hover: `rgba(255,255,255,0.72)` fill, ink text. Current (`aria-current="page"`): `#fff` fill, nav-pill shadow, ink, 600. Icons are 20x20 `<img>` at `opacity: 0.75`, 1 when current. The SVGs in `public/brand/icons/*.svg` are 24x24 viewBox, 1.5 stroke, round caps and joins, stroke `#55504A`.
4. Create action `.workspace-create` (L119-129): `padding-top: 20px`; the link inside is `width: 100%; min-height: 46px; border-radius: 999px; font-size: 14px; gap: 9px`, using the primary `LinkButton` (black). It renders 230x46 at 1440.

Bottom group (`NavRail.tsx` L71-91):

5. Help card `.workspace-help` (L131-168): fill `rgba(255,255,255,0.7)`, radius 16, padding 16, margin-bottom 14. Icon tile 32x32 white radius 10, 17 px glyph, margin-bottom 11. Title 13/600. Body 12/1.6 `--ink-secondary`, margin `6px 0 12px`. Link row 12/600, flex space-between, min-height 32, trailing arrow glyph.
6. Two secondary links `.workspace-settings`, same style as nav links, 19 px icons.
7. Footer `.workspace-footer` (L170-176): margin `12px 12px 0`, padding-top 14, top border `1px solid rgba(11,11,12,0.08)`, 11 px `--ink-muted`.

At 1440x900 the bottom group starts around y 548 and the footer sits at y 874, so the rail fills the full height with no scroll.

### 2.3 Workspace panel

`.product-workspace` (L180-189): `flex: 1; min-width: 0; min-height: calc(100vh - 24px); margin: 12px 12px 12px 0; background: #fff; border-radius: 22px; overflow: hidden; box-shadow: workspace`. Under 768 px: `margin: 0; border-radius: 0; box-shadow: none; min-height: calc(100vh - 78px)` (L1260-1265).

### 2.4 Top bar and breadcrumbs

`TopBar.tsx` L9-42 renders `header.workspace-topbar` with a breadcrumb nav and a trailing action slot.

- `.workspace-topbar` (L191-199): `min-height: 68px; padding: 14px 26px; display: flex; align-items: center; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--border)`. 1440 and up: left and right padding 36 (L1212-1215). 1100 and down: `14px 20px` (L1247-1249). Under 768: `padding: 12px 18px; min-height: 62px; gap: 12px; flex-wrap: wrap` (L1266-1271).
- `.workspace-breadcrumbs` (L201-219): flex, gap 10, 14 px, wrap, `--ink-muted`. Last crumb (`aria-current`) ink 600.
- Back and forward chevrons `.breadcrumb-chevrons` (L221-238): two 28x28 cells, radius 8, 14 px glyphs, then `padding-right: 8px; margin-right: 2px; border-right: 1px solid var(--border)`. They are `aria-hidden` and do nothing. Hidden under 768 px.
- Divider `/` in `--border-strong` (L240-242).
- Default action `.website-link` (L244-255): 13 px `--ink-muted`, min-height 40, nowrap, hover ink, text "Back to website" plus a north-east arrow. Pages pass a primary button here instead when they have one action (closeouts list, plan).

Sleeve: keep the bar height and padding (`--layout-topbar` 62/68 px). Drop the fake chevrons, or make them real `history.back()` and `history.forward()` buttons with labels. The trailing slot holds the page's single primary action, or the market session pill (section 15.1) when there is none.

### 2.5 Mobile bottom navigation and More sheet

`MobileNav.tsx` L7-10 and `product.css` L1364-1430, active under 768 px only.

- Bar `.workspace-mobile-nav`: `display: flex; position: fixed; bottom: 0; left: 0; right: 0; z-index: 40; background: rgba(255,255,255,0.94); backdrop-filter: blur(16px); border-top: 1px solid var(--border); padding: 7px 8px max(7px, env(safe-area-inset-bottom))`.
- Items (three links plus a More button): `flex: 1; flex-direction: column; justify-content: center; align-items: center; gap: 5px; min-height: 54px; font-size: 10px; color: var(--ink-muted); border-radius: 12px`. Icons 21x21. Current: `--surface-muted` fill, ink, 600. Rendered bar height 69 px at 390 wide.
- More sheet `.workspace-mobile-more`: `position: fixed; z-index: 39; bottom: 80px; left: 12px; right: 12px; border: 1px solid var(--border); background: #fff; border-radius: 18px; padding: 16px; shadow 0 12px 40px rgba(11,11,12,0.16)`. Header row flex space-between with `padding-left: 12px`, bold title, a 44x44 close button with a 24 px multiplication sign. Links: `padding: 14px 12px; min-height: 46px; display: flex; justify-content: space-between; border-top: 1px solid var(--border); font-size: 14px`, trailing north-east arrow.
- The bar's toggle uses `aria-expanded` and `aria-controls`. There is no focus trap, no Escape handling and no scrim.

Sleeve: `PRIMARY_NAV` (Home, Inbox, Receipts) plus More holding `SECONDARY_NAV` (Rule, Sell, Verify a receipt) in `components/sleeve/navigation.ts` already matches this exactly. Raise the label from 10 px to 11 px (`--text-micro`), and give the sheet a scrim, Escape, focus return and a focus trap (section 10).

### 2.6 Breakpoints

| Width | Changes |
| --- | --- |
| 1440 and up | Page padding 34/36/48, topbar sides 36 (L1207-1216) |
| 1279 and down | Stat row 2 columns, module row 1 column (L1218-1225) |
| 1100 and down | Rail 224, page padding 24/20/36, directory drops last column, connection grid 1 column, topbar 14/20 (L1227-1250) |
| 767 and down | Rail hidden, panel full bleed, bottom nav, h1 25 px, everything 1 column (L1252-1431) |

Tailwind pages switch at `lg` (1024 px) and `md` (768 px) instead, so between 768 and 1023 they show stacked rows next to a visible 224 px rail.

---

## 3. Page headers

### 3.1 CSS page heading (intended)

`.page-heading` and its twin `.queue-heading` (L272-293, L1175-1197): flex row, space-between, `align-items: flex-start`, gap 20, margin-bottom 26 (24 for queue). h1 30/1.15/-0.025em/600. Lede 14/1.65 `--ink-secondary`, margin-top 8, `max-width: 660px`. Actions `.queue-actions` (L1199-1203): flex, gap 10, wrap. Under 768 px: margin-bottom 20, gap 13, h1 25 px; actions wrap under the text.

Rendered on the dashboard: h1 at x 298, y 117, buttons right-aligned 44 px tall, secondary "Refresh" then primary.

### 3.2 Toolbar under the heading

`.page-toolbar` (L295-302): flex space-between, center, gap 14, margin-bottom 20, wrap. Holds filter pills (3.4) and the search field (9.5). Under 768 px `align-items: stretch` and search goes full width.

### 3.3 What the Tailwind pages do instead

Most routes skip a heading and put the title only in the breadcrumb (closeouts list, directory, connections, access map, exceptions). Detail and form pages use a 40 px `text-h1` (New Closeout, Members, a principal's name), which is 10 px bigger than the CSS heading on the dashboard. That mismatch is visible between routes. Sleeve rule: every screen has one h1 at `--text-h1` (30 px, 25 px on phones) inside the 3.1 structure. Sleeve already has `components/ui/page-header.tsx`; it should match 3.1.

### 3.4 Filter pills

`.filter-pills` (L304-328): flex, gap 7, wrap. Button: `1px solid var(--border); border-radius: 999px; background: #fff; color: var(--ink-secondary); padding: 8px 16px; min-height: 40px; font-size: 13px`. Hover border `--border-strong`. Pressed (`aria-pressed="true"`): `--brand` fill and border, white text. Under 768 px `padding: 8px 13px; font-size: 12px`. Sleeve: receipts filters by ticker and status (PRD 7.10). Bump min-height to 44 px (`--size-touch`).

---

## 4. Buttons

`_components/Button.tsx` L6-31:

- Base: `min-h-11` (44 px), `inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors duration-fast`, disabled `cursor-not-allowed opacity-50`.
- Size md: `px-4 py-2 text-body` (16 px sides, 15 px text). Size sm: `px-3 py-1.5 text-body-s` (12 px sides, 13 px), still 44 px tall.
- Primary: `bg-brand text-surface hover:bg-brand-strong` (`#101114` to `#000`).
- Secondary: white, ink text, `border-border`, hover `border-border-strong`. Rendered 88x44 for "Refresh".
- Ghost: transparent, `--ink-secondary`, hover ink.
- Close (destructive): `bg-close text-surface hover:opacity-90`. Hover lightens the red under white text, which lowers contrast. Sleeve already uses `--color-danger-strong` for hover.
- Pill variant only in the rail (`.workspace-create a`, 999 px radius, 46 px) and the queue Go button (`.dash-queue-go` L811-826: 40 px, padding 0 16, pill, brand fill, 13/500).
- Disabled primary renders as grey `#888` with white text at 50 percent opacity (New Closeout screenshot), which fails contrast; that is acceptable for disabled controls under WCAG, but say why it is disabled in text next to it.

Sleeve: primary is always the black pill or black rounded control, never green (`tokens.css` brand comment). Green is for meaning (equity, success, links, focus), not for the main action.

---

## 5. Cards, panels and tiles

### 5.1 Panel (rendered everywhere)

`Panel.tsx` L3-30: `section.rounded-panel border border-border bg-surface` (16 px, 1 px `#e7e9ee`, white), `shadow-card` only when `elevated`. Optional header: `flex items-center justify-between border-b border-border px-4 py-3`, title `text-h3 font-semibold` (21 px), trailing action. Sleeve: `components/ui/card.tsx`. Use 16 px titles (`--text-h3`), not 21, inside panels; 21 is too big next to 30 px page titles.

### 5.2 Stat tile with link (CSS, intended dashboard)

`.dash-stats` grid 4 columns, gap 16, margin-bottom 18 (L405-410); 2 columns at 1279 and down, 1 under 768.

`.dash-stat` (L412-501): 1 px border, radius 18, `--surface-muted` fill, column flex.

```
.dash-stat-top      flex, gap 13, padding 18 18 14
  .dash-stat-icon   42x42, radius 13, white, 17 px glyph, --ink-secondary
  div
    span            13 px --ink-secondary          (label)
    strong          28/1.15/-0.028em/600, mt 2      (figure)
.dash-stat-trend    flex space-between, gap 10, padding 0 18 14, 13 px, border-bottom 1px --border
  span              8x8 round dot (em) + label in --ink-secondary
  b                 600 value, tone class colors it
.dash-stat-link     flex space-between, min-height 48, padding 0 18, 13 px --ink-secondary, margin-top auto; hover ink
```

Tone classes (L499-529): `.tone-close` red, `.tone-preserve` blue, `.tone-success` green, `.tone-warning` amber, `.tone-muted` grey, plus `bg-` versions for the dots.

### 5.3 StatTile (rendered on detail pages)

`StatTile.tsx` L5-27: `rounded-large border border-border bg-surface p-5 shadow-card` (20 px radius, 20 px padding, card shadow). Figure `text-h1 font-semibold` 40 px, tone colors it (preserve rendered blue). Label `mt-1 text-body-s text-ink-secondary`. Two side by side in `grid grid-cols-2 gap-3`. Rendered 267x108 at 1440. Comment L1-4: only for a real object's detail view, never a dashboard grid.

### 5.4 Module and breakdown rows (CSS)

`.dash-modules` grid `minmax(0,0.9fr) minmax(0,1.1fr)`, gap 16, margin-bottom 18 (L533-538). `.dash-module`: 1 px border, radius 18, white, padding 20 (16 under 768). Head: flex, baseline, space-between, gap 14, margin-bottom 16; h2 16/600; trailing 13 px `--ink-muted` nowrap.

`.dash-breakdown` column gap 10; `.dash-breakdown-row` (L574-609): flex, center, gap 13, 1 px border, radius 14, padding `13px 15px`; icon tile 38x38 `--surface-muted`, 15 px glyph; label 13 px secondary; figure 21/600/-0.02em; last child pushed right.

Chart (L612-679): SVG, axis text 10 px `--ink-muted`, grid stroke `--border` dashed `3 4`, area fill `rgba(59,113,240,0.14)`, line 2 px `--preserve` round, dots white with 2 px stroke. Empty chart: dashed 1 px border, radius 14, min-height 180, 13 px muted, centered. Legend: flex, gap 18, 12 px secondary, 8 px dots.

### 5.5 Connection card (rendered)

`connections/page.tsx` L27-70: `rounded-large border p-4` (20 px radius, 16 px padding). Healthy: `bg-gradient-to-br from-surface to-surface-muted shadow-card`. Others: plain white. Header: provider tile 44x44 (section 8.3) and 15/500 name, health tag right. Meta grid `mt-4 grid-cols-2 md:grid-cols-4 gap-4`, each cell a 12 px uppercase muted label over 13 px secondary value. Warning strip: `mt-3 rounded-control border border-warning bg-warning-soft p-3 text-body-s text-warning`.

CSS version `.connection-card` (L939-1015): padding 24 (18 under 768), radius 18, header flex; identity h2 16/600, sub 12 muted; description 13/1.65 secondary, margin 18 0; meta `dl` 2 columns gap 18, top border, padding-top 18, `dt` 11 px muted, `dd` 13 px secondary; `details.connection-scope` with summary min-height 30.

### 5.6 Verdict banner (rendered on receipt and run)

`receipt/page.tsx` L51-71: `mb-6 rounded-large border p-5 shadow-card` with tone: partial `border-danger bg-danger-soft`, blocked `border-warning bg-warning-soft`, complete `border-success bg-success-soft`. Inside: 12 px uppercase tone-colored label, then the verdict in `text-h1` 40/600, then a 13 px secondary line naming how it was computed. Run page variant (`run/page.tsx` L60-88): `p-4`, flex space-between, h3-size status and a tag on the right.

### 5.7 Decision card (rendered, dashboard)

`NeedsYouCard.tsx` L17-72: `rounded-card border-2 border-warning/40 bg-surface p-5 shadow-sm`, hover `border-warning`. Top row: an 11 px uppercase tag on `bg-warning/20`, a 13 px muted subject, a right tag. Title `mt-1.5`. Body 13 px secondary. Context list `mt-3 rounded-control bg-surface-muted p-3` with bullet dots. Footer `mt-4 border-t pt-3` with 32 px black and white buttons. It references `text-heading-s`, `text-warning-ink` and `bg-brand-hover`, none of which exist in `tailwind.config.ts`, so the title has no size and the tag text falls back to inherited color (defect).

### 5.8 Note callout

`.closeout-preserve-note` (L1080-1097): flex, gap 12, `--preserve-soft` fill, radius 14, padding 16, 13/1.65 secondary, margin 22 0; strong title 13 px ink, block, margin-bottom 3. Plan inspector equivalents (`PlanPreviewClient.tsx` L200-235): `rounded-panel border p-4`, 12 px uppercase muted label, 13 px body; positive version `border-preserve bg-preserve-soft` with a blue label; blocker version `border-danger bg-danger-soft`.

---

## 6. Lists and tables

### 6.1 Ruled list in a panel (rendered, the workhorse)

Closeouts list (`closeouts/page.tsx` L59-90), directory (`directory/page.tsx` L34-60), exceptions (`exceptions/page.tsx` L32-56):

```
div.overflow-hidden rounded-panel border border-border bg-surface
  header row (lg and up only)
    grid gap-4 border-b bg-surface-muted px-4 py-2
    text-label uppercase tracking-wide text-ink-muted        12 px caps column names
  row (a Link when it navigates)
    grid grid-cols-1 gap-2  lg:grid-cols-[minmax(0,1fr)_160px_140px_140px] lg:items-center lg:gap-4
    border-b border-border px-4 py-3.5 last:border-b-0 hover:bg-surface-muted
    col 1: 15/500 ink title over 13 px secondary subtitle
    col 2: status tag
    col 3: mono 13 px muted date (YYYY-MM-DD)
    col 4: 13/500 "View" plus arrow
```

Rendered row height 72 px at 1440. A failed row gets `bg-danger-soft/40` across the whole row (the Globex partial row). Under `lg` every cell stacks, so a phone row is about 158 px tall with the tag stretched full width (defect, section 13).

### 6.2 CSS directory row (intended)

`.directory-list` and `.closeouts-list` (L861-867): white, 1 px border, radius 16, overflow hidden. `.directory-row` (L869-931): grid `minmax(0,1.5fr) 100px minmax(0,1fr) 90px`, center, gap 22, padding `18px 22px`, top border between rows, hover `--surface-muted`. Identity: 42x42 radius 13 `--surface-muted` initial tile, name 14/500, sub 12 muted, gap 13. Other columns 13 px secondary. Header row: `--surface-muted`, 12 px muted, padding 12 top and bottom. At 1100: 3 columns, gap 14. Under 768: 2 columns `minmax(0,1fr) 80px`, padding `16px 14px`, third cell spans both columns with `padding-left: 55px` so it aligns under the name, header hidden.

`.closeouts-row` (L1132-1168): grid `minmax(0,1fr) 120px 120px 55px`, gap 20, padding `19px 22px`, bottom border; under 768 `minmax(0,1fr) 100px`, time drops to column 1, last cell right-aligned.

This is the correct phone behavior. Sleeve lists use it, not the stacked Tailwind version.

### 6.3 Queue row with actions (CSS, intended)

`.dash-queue` (L683-857): white module, radius 18, padding 20. Head flex space-between wrap, h2 16/600, a 13/600 count in the close tone on the right. List column gap 10. `.dash-queue-row`: grid `44px minmax(0,1fr) auto`, center, gap 14, 1 px border, radius 14, padding `14px 16px`, hover `--border-strong`. Mark 44x44 radius 13, 16/600, tone fills: high `--close-soft`/`--close`, medium `--warning-soft`/`--warning`, low `--surface-strong`/secondary. Main: 12 px muted kicker, 15/600 title, 13 px secondary body, all `overflow-wrap: anywhere`. Actions: flex gap 10; `time` 12 px muted; a 40 px select (radius 10, `--surface-muted`, chevron data-URI at right 11 px); a 40 px black pill Go. Under 768: 2 columns `40px minmax(0,1fr)`, padding 13, 40 px mark, actions on a full-width row with `padding-left: 54px`.

### 6.4 Compact rows

- GrantRow (`GrantRow.tsx` L13-22): flex space-between, gap 3, `border-b px-4 py-2.5 text-body-s`; left a provider badge and a mono 13 px label; right 11 px uppercase muted count. Rendered 44 px tall.
- ReceiptRow (`ReceiptRow.tsx` L10-19): flex, gap 3, `border-b px-4 py-3`; a 6x6 round tone dot at `mt-1.5`; 15/500 label over 13 px secondary detail.
- Timeline lines (`directory/[id]/page.tsx` L123-139): inside a padded panel, each `border-b py-2` with a mono 11 px muted date, then text.
- Settings key value (`.settings-detail` L1113-1130): flex space-between, gap 20, padding 13 0, top border, 13 px; `dt` secondary, `dd` right-aligned, wraps anywhere.

### 6.5 Table

Access map (`access-map/page.tsx` L29-61): wrapper `overflow-x-auto rounded-panel border bg-surface`; `table` has `min-width: 620px` under `.product-shell` (L1017-1020) and `border-collapse: collapse` (`globals.css` L84-87). Header row `border-b bg-surface-muted text-label uppercase tracking-wide text-ink-muted`, cells `px-4 py-2 text-left`, `th` 600. Body rows `border-b text-body-s`, cells `px-4 py-3`. Side panel `aside` 320 px column (`lg:grid-cols-[1fr_320px]`), `p-4 shadow-card`.

Sleeve uses no wide tables. Receipt fields and verify checks are key value lists (6.4). The receipts list is a row list (6.2).

---

## 7. Detail pages

### 7.1 Two-pane plan view (rendered, `PlanPreviewClient.tsx`)

Desktop (`lg` and up, L48-94): the page is `flex h-screen flex-col`; under the topbar a `flex flex-1 overflow-hidden` row.

- Left column `w-[420px] shrink-0 overflow-y-auto border-r`. Summary block `border-b p-4`: 12 px caps muted label, 21/600 title, 13 px secondary subject, a quote box `mt-3 rounded-control bg-surface-muted p-3 text-body-s`, a 13 px muted date line.
- Groups: a header strip `flex items-center gap-2 border-b bg-surface-muted px-4 py-2` with a tag and a 13 px muted count; group sections tinted `bg-close-soft/30` or `bg-preserve-soft/30`.
- Rows are buttons `flex w-full flex-col gap-1 border-b px-4 py-3 text-left hover:bg-surface-muted`, selected `bg-surface-muted`.
- Right inspector `flex-1 overflow-y-auto p-6`, `max-w-reading` (680 px): tag row, `mt-3 text-h2` 30/600 title, 15 px secondary reason, then `mt-6 grid gap-4` of callout boxes (5.8). Provider state box uses 13 px mono lines.
- Actions live in the topbar slot: secondary Cancel and primary Confirm, both size sm, with a 13 px danger error under them.

Mobile (L97-156): a tab strip of five equal cells, `border-b-2 py-2 text-center text-micro uppercase tracking-wide`, current `border-brand text-brand`, then a scrolling body `p-4`, then a footer `flex gap-2 border-t p-4` with Back (secondary) and Continue (primary) at `flex-1`. On a real phone that footer sits under the fixed bottom nav (defect).

### 7.2 Narrow detail column (rendered, receipt and run)

`mx-auto max-w-reading px-6 py-6` (680 px centered). Order: verdict banner (5.6), then section h2 at `text-h3` with `mb-2`, then a ruled panel per group. A failing group's heading turns `text-danger` and its panel border `border-danger`. A retry block: `mt-6 rounded-large border border-danger bg-danger-soft p-4 shadow-card`, caps label, a disc list, then a small destructive button.

### 7.3 Object detail with two columns (rendered, principal)

`grid grid-cols-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_1fr]`. Left: 40 px name, 13 px secondary meta, two StatTiles, then a list panel. Right: the access list and a history panel. Section headings `mb-2 mt-6 text-h3`.

---

## 8. Badges, status pills and marks

### 8.1 StateTag

`StateTag.tsx` L28-36: `inline-flex items-center gap-1 rounded-control border border-border px-2 py-[3px] text-label font-medium uppercase tracking-wide` plus tone fill and text. Renders about 22 px tall, 12 px caps at 500, 10 px radius, a 1 px `#e7e9ee` border on top of the tint.

Tones (L1-24):

| Tone | Fill | Text | Measured text contrast |
| --- | --- | --- | --- |
| change, blocked, partial, revoked, disconnected | `--danger-soft` `#fdecec` | `#d93b3b` | 3.96 (fails 4.5) |
| keep, running, verifying, restored | `--preserve-soft` `#eaf0fe` | `#3b71f0` | 3.83 (fails) |
| planned, scheduled | `--info-soft` | `--info` | 3.83 (fails) |
| complete, active, healthy | `#e6f7f0` | `#17a673` | 2.81 (fails) |
| needs review, degraded, missing scope | `#fcf3e1` | `#c98a14` | 2.67 (fails) |
| already correct, draft | `#ebedf1` | `#5b6270` | 5.23 |
| unknown, cancelled, expired | `#ebedf1` | `#8a909c` | 2.74 (fails) |

Every colored tag fails AA. Sleeve's `components/ui/badge.tsx` must use the `-text` tokens: `--color-success-text` on `--color-success-soft` 5.17, `--color-warning-text` on `--color-warning-soft` 4.71, `--color-danger-text` on `--color-danger-soft` 4.72, `--color-spend-text` on `--color-spend-soft` 6.09, `--color-ink-secondary` on `--color-surface-strong` 5.23. Use sentence case instead of caps for status words longer than one word, and never show raw enum strings like `OBSERVED_ABSENT` (the run page does).

### 8.2 Provider badge

`ProviderBadge.tsx` L9-15: `inline-flex items-center gap-1.5 rounded-control border border-border bg-surface px-2 py-[3px] text-label font-medium text-ink-secondary` with a 6x6 `--ink-muted` dot. In a grid cell it stretches to the cell height (run page, defect).

Sleeve equivalent: a ticker chip with the real token icon in place of the dot: 20 px `TokenIcon`, 12/500 ticker, same border and radius. `components/token/token-icon.tsx` and `token-stack.tsx` exist.

### 8.3 Icon tile

`ProviderTile.tsx` L55-70: `inline-flex shrink-0 items-center justify-center rounded-control` 44x44 (md) or 32x32 (sm), tinted per provider, 20 px stroke glyph, `shadow-card` when healthy. Tints never encode status (comment L9-13). `.dash-stat-icon` is the CSS twin at 42x42 radius 13 white.

Sleeve: token icons replace provider tiles. A sleeve card's icon tile is 42x42, radius 13, white on the muted tile, holding the token icon at 26 px.

### 8.4 Count chip and small labels

- Count chip in the dashboard section title: `rounded-control bg-warning/20 px-2 py-0.5 text-micro font-medium`.
- Uppercase micro labels (`text-label uppercase tracking-wide text-ink-muted`) sit above every field value and callout. Closeout uses them a lot. Sleeve keeps them for field labels inside receipts and forms only, not above section headings.

---

## 9. Forms and inputs

### 9.1 CSS form card (intended)

`.form-layout` (L1037-1041): `max-width: 860px; margin: auto; padding: 36px 26px` (26/18 under 768). `.closeout-form` (L1043-1049): white, 1 px border, radius 20, padding 26 (20/16 under 768), margin-top 26.

- Label (L1051-1056): 13/600, block, margin-bottom 8.
- Field (L1058-1067): `width: 100%; border: 1px solid var(--border); border-radius: 11px; padding: 12px 14px; background: var(--surface-muted); font-size: 14px`. All inputs, selects and textareas in the shell get `min-height: 44px` (L1031-1035).
- Field group `.closeout-field` margin-bottom 22.
- Hint `.closeout-hint` 12/1.65 muted, margin-top 8.

### 9.2 Rendered form (New Closeout)

`closeouts/new/page.tsx` L52-170: column `max-w-reading px-6 py-8`. h1, 15 px lede, StepperPanel, segmented control, a Panel `elevated` with `p-4`, then the submit right-aligned (`mt-6 flex justify-end`).

- Labels: 12 px uppercase muted (`text-label uppercase tracking-wide text-ink-muted`).
- Textarea: `mt-2 w-full rounded-control border border-border bg-surface p-3 text-body text-ink outline-none focus:border-border-strong`. `outline-none` plus a border that moves from `#e7e9ee` to `#d4d8e0` is the only focus sign (defect: the shell's 2 px focus-visible outline is removed by `outline-none` precedence on this element).
- Select: `mt-2 w-full rounded-control border bg-surface p-2.5 text-body`.
- Segmented control (L70-83): track `flex gap-1 rounded-control border border-border bg-surface-muted p-1 text-body-s`; segments `flex-1 rounded-control px-3 py-1.5 font-medium`; selected `bg-surface text-ink border border-border`; others secondary. Rendered 632x44. No `role="tablist"` or `aria-pressed`.
- Choice buttons (L139-151): `rounded-control border px-3 py-1.5 text-body-s font-medium`; selected `border-brand bg-brand text-surface`; others `border-border text-ink-secondary`. Under 44 px tall.

### 9.3 Stepper panel

`StepperPanel.tsx` L9-51: container `flex flex-col gap-2 rounded-large border bg-surface p-2 shadow-card`. Row `flex items-start gap-3 rounded-panel px-4 py-3`. Number tile `h-7 w-7 rounded-control font-mono text-body-s`, zero-padded "01". Active row: neutral `bg-gradient-to-br from-brand to-brand-strong text-surface`, preserve `bg-preserve`, close `bg-close`; active tile `bg-surface/20 text-surface`; inactive tile `border bg-surface text-ink-muted`. Title 15/500, description 13 px (`text-surface/80` when active). Rendered 632x240 at 1440, the black active row 614x68.

Sleeve: onboarding is a real sequence (passkey, residency check, rule, address), so the stepper fits there. Active row uses the black gradient, not green.

### 9.4 Inline errors

Under an action: `max-w-xs text-right text-body-s text-danger` (plan page L116) or `mt-2 text-body-s text-danger` (run page L126). Form-level failures reuse the full ErrorState card (11.3). No field-level error styling exists.

Sleeve: error text below the field in `--color-danger-text`, field border `--color-danger`, `aria-describedby` and `aria-invalid`. `components/ui/field.tsx` is the place.

### 9.5 Search field

`.workspace-search` (L330-343): `height: 40px; width: 260px; max-width: 100%; padding: 0 14px 0 36px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-muted); font-size: 13px`, a 16 px magnifier data-URI stroked `#8a909c` at `12px center`. Full width under 768.

### 9.6 Select chevron

`.dash-queue-select` (L797-809): `min-height: 40px; border-radius: 10px; background: var(--surface-muted); padding: 0 30px 0 12px; appearance: none`, chevron data-URI stroked `#5b6270` at `right 11px center`.

### 9.7 Input contrast

`#e7e9ee` border on a `#f4f5f7` fill is 1.21:1 against white and nearly invisible on the muted fill. WCAG 1.4.11 needs 3:1 for the boundary. Sleeve's `--color-border-control` `#898d94` reaches 3.06 on `#f4f5f7`. Use it for every input, select, checkbox and slider track. Inputs use 16 px text (`--text-input-size`) to stop iOS zoom.

---

## 10. Sheets and dialogs

Closeout has one overlay: the mobile More sheet (2.5). No dialog, no confirm step, no toast, no popover. The plan's Confirm button runs immediately.

Sleeve needs a dialog (sell-back off-hours override, show-proof warning on cards, release confirmation), a bottom sheet (payment address QR on phones), and toasts (copied, split ran). Build them from closeout's tokens so they look native. These values are derived, not copied, and are marked so.

| Part | Value | Basis |
| --- | --- | --- |
| Scrim | `--color-scrim` `rgba(11,11,12,0.4)` | Derived from closeout ink |
| Dialog | white, `--radius-large` 20 px, padding 24, `--shadow-overlay`, width `min(100% - 32px, --layout-dialog 480px)` | Card radius and sheet shadow from L1406-1408 |
| Dialog head | h2 at `--text-h2` 21/600, 13 px secondary body, actions right-aligned, gap 10, primary last | Page heading rhythm (3.1) |
| Bottom sheet | full width, top radius `--radius-sheet` 28 px, padding `16px 16px max(16px, env(safe-area-inset-bottom))`, max-height `--layout-sheet-max` 90dvh, a 36x4 grab bar `--color-border-strong` radius 999 | `tailwind.config.ts` L84 `sheet: 28px`, safe-area from L1374 |
| Toast | `--color-brand` fill, white 13/500 text, radius 14, padding 12 16, `--shadow-floating`, bottom center above the bottom nav (`bottom: calc(--layout-bottom-nav + 12px)`) | Brand pill and floating shadow |
| Behavior | focus moves into the overlay, Tab is trapped, Escape closes, focus returns to the opener, `aria-modal="true"` with a labelled title, body scroll locked | Missing in closeout |
| Motion | sheet translates from `--motion-sheet-offset` over `--duration-standard` with `--ease-standard`; dialog fades and moves 8 px; both collapse to a fade under reduced motion | tokens.css |

`components/ui/dialog.tsx` and `toast.tsx` already exist; check them against this table.

---

## 11. Empty, loading and error states

### 11.1 Empty

Rendered `EmptyState` (`Panel.tsx` L45-60): `flex flex-col items-center gap-3 rounded-panel border border-dashed border-border px-8 py-16 text-center`, 21/600 title, 15 px secondary body capped at 680 px, optional action. Inline empty inside a panel: `p-4 text-body-s text-ink-muted` (one line).

CSS version `.dash-empty` (L828-847): left-aligned column, gap 10, dashed 1 px border, radius 14, padding `30px 24px`, 16/600 title, 13 px secondary body max 62ch, then a secondary button. The dashboard's copy pattern is good: say what an empty list does and does not prove, then give the one action that fills it.

Sleeve uses the left-aligned CSS version. PRD 15: empty means nothing splits until USDG arrives from outside, and app top-ups do not split. The action is to show the payment address.

### 11.2 Loading

Rendered `LoadingState` (`Panel.tsx` L33-39): a dashed 16 px radius box, `px-8 py-16`, centered 15 px muted text such as "Loading closeouts...". `.dash-skeleton` (L849-857) is the same idea at min-height 140 and radius 14. No shimmer, no layout-shaped skeleton. The page header and topbar render immediately; only the body waits.

Sleeve: `components/ui/skeleton.tsx` blocks shaped like the final layout (two sleeve cards, address card, three rows) in `--color-skeleton`, with `aria-busy="true"` on the region and a visually hidden "Loading" label. No shimmer when reduced motion is on.

### 11.3 Error

`ErrorState` (`Panel.tsx` L41-43) with `.workspace-error` (L345-401): `role="alert"`, flex, gap 16, 1 px border, white, radius 18, padding 26 (20/16 under 768). Symbol 36x36 radius 12, `--danger-soft` fill, `--danger` 600 "!". Title 16/600/-0.01em. Body 13 px secondary, wraps anywhere, margin-top 6. Actions flex gap 14 wrap, margin-top 18, 13 px: a 40 px button (1 px border, radius 10, padding `9px 17px`, `--surface-muted`, 500) and an underlined link (`text-underline-offset: 4px`). Copy structure: what failed (the raw message), a reassurance line ("your data hasn't changed"), retry and a route to the likely cause.

Sleeve keeps this card exactly and fills it per PRD 15: what failed, and that the USDG is still in the account. Raw RPC messages go in a `details` disclosure, not the main line.

---

## 12. Focus, accessibility and contrast, measured

- Global focus (`globals.css` L78-82): `outline: none; box-shadow: 0 0 0 3px rgba(59,113,240,0.25); border-radius: 6px`. The ring composites to `#cedcfb`, 1.38:1 on white.
- Product focus (`product.css` L1026-1029): `.product-shell :is(button,a,input,select,textarea):focus-visible { outline: 2px solid var(--accent); outline-offset: 3px }`. 4.37:1 on white. Sleeve: `--color-focus` green-600, 5.78:1 on white, 2 px with 2 px offset (`--focus-ring-*`).
- Text contrast on white: ink 19.6, ink-secondary 6.13, ink-muted 3.21 (fails). On `#f4f5f7`: ink-muted 2.94. On the shell `#eceef1`: ink-secondary 5.27, ink-muted 2.76. Sleeve's ink-muted `#6a6f7b` is 5.03 on white but 4.33 on the shell, so rail metadata on the grey uses ink-secondary.
- Status text: see 8.1, all colored tags fail.
- Touch targets: nav 46, buttons 44, mobile nav 54, filter pills 40, chevrons 28 (decorative), choice buttons about 32 (fail 44).
- Landmarks: `main#main-content` exists but there is no skip link to it.
- Live regions: only the dashboard count (`aria-live="polite"`).
- Reduced motion: no rules.

---

## 13. Closeout defects not to copy

1. Orphan CSS: the `.dash-*`, `.page-*`, `.directory-*`, `.connection-*`, `.closeout-form`, `.settings-*` classes are never used, while the dashboard's `.queue-summary`, `.queue-stat`, `.queue-layout`, `.queue-main`, `.queue-toolbar`, `.queue-filters`, `.queue-search`, `.queue-list`, `.queue-row`, `.queue-person`, `.queue-avatar`, `.queue-meta`, `.queue-review`, `.queue-empty`, `.queue-count`, `.queue-sidebar` and `.queue-guide` have no CSS at all. The dashboard therefore renders its stats, review queue and guide as unstyled text (seen in the 1440 render). Build each Sleeve screen from styled components only.
2. Undefined Tailwind keys in `NeedsYouCard.tsx`: `text-heading-s`, `text-warning-ink`, `bg-brand-hover`. Sleeve's Tailwind theme must fail the build on unknown classes or be checked by a test.
3. Every colored status tag fails AA (8.1). `--ink-muted` fails AA (12).
4. Two h1 sizes, 30 and 40 px, across routes (3.3).
5. Stacked Tailwind rows on phones stretch tags to full width and make 158 px rows (6.1). Use the CSS grid collapse in 6.2.
6. Plan page uses `h-screen`, so on phones its step footer sits under the fixed bottom nav and cannot be reached. Use `min-h-[100dvh]` and pad by `--layout-bottom-nav`.
7. Breadcrumb chevrons look like buttons and do nothing.
8. `capitalize` on a line containing an email address renders "Ops@Acme.Com" (`directory/[id]/page.tsx` L57). Never transform case on user data or addresses.
9. Raw enum strings in the UI (`OBSERVED_ABSENT`, `PARTIAL` as a huge title). Sleeve maps every status and reason to plain words in one table (`components/sleeve/text.ts`).
10. Destructive hover uses `opacity: 0.9`, lowering contrast under white text.
11. No dialog before an irreversible action (plan Confirm runs immediately).
12. The textarea's `outline-none` removes the visible focus ring.
13. ProviderBadge stretches inside a grid cell (run page).
14. The rail width is 262 px in CSS but 248 px in the Tailwind config.
15. The live API returns 500 for every list route, so the running app shows error cards on most screens. The renders in this file used mocked responses (section 16).
16. The 1 px `#e7e9ee` border carries no information on input fields (9.7).
17. No skip link, no reduced-motion block, no focus trap in the More sheet.

---

## 14. Blue map for the product UI

Every product use of blue, with its Sleeve replacement. The landing blueprint section 15 covers the token definitions and gradient math; this table is the product subset with the decision made.

| File and line | Use | Closeout value | Sleeve replacement | Measured |
| --- | --- | --- | --- | --- |
| `globals.css` L80 | Global focus ring | `rgba(59,113,240,0.25)` 3 px shadow | `--color-focus` solid 2 px outline, offset 2 | 5.78 on white |
| `product.css` L1027 | Shell focus outline | `--accent` 2 px | `--color-focus` | 5.78 |
| `product.css` L502-504 | `.tone-preserve` text | `--preserve` | `--color-equity-text` when it means the equity side, else `--color-success-text` | 5.78 on white, 5.30 on muted |
| `product.css` L518-520 | `.bg-tone-preserve` dot | `--preserve` | `--color-equity` | 5.78 on white |
| `product.css` L630 | Chart area | `rgba(59,113,240,0.14)` | `--color-chart-area` `rgba(0,116,86,0.14)` | decorative |
| `product.css` L635, L643 | Chart line and dot stroke | `--preserve` | `--color-chart-equity`; spend series `--color-chart-spend`; waiting hatched `--pattern-waiting` | 3:1 or more on white |
| `product.css` L1083 | Note callout fill | `--preserve-soft` | `--color-accent-soft` with ink text, or `--color-equity-surface` inside equity context | ink on green-100 above 15 |
| `StateTag.tsx` L3 | Keep tag | `bg-preserve-soft text-preserve` | `--color-success-soft` / `--color-success-text` | 5.17 |
| `StateTag.tsx` L11-12 | Planned, scheduled tags | `bg-info-soft text-info` | `--color-info-soft` / `--color-info-text` | 5.47 |
| `StateTag.tsx` L13-14 | Running, verifying tags | `bg-preserve-soft text-preserve` | Not needed in Sleeve. If a pending state is shown, use neutral `--color-surface-strong` / `--color-ink-secondary` | 5.23 |
| `StateTag.tsx` L16 | Restored tag | `bg-preserve-soft text-preserve` | Not used | |
| `StatTile.tsx` L18 | Preserve figure color | `text-preserve` | Keep figures ink; put the color in a 8 px dot or the token icon beside the figure (`tokens.css` split comment) | ink 19.6 |
| `ProviderTile.tsx` L17 | Slack tile tint | `bg-preserve-soft text-preserve` | Replaced by real token icons on a white or muted tile | |
| `ReceiptRow.tsx` L11 | Preserve dot | `bg-preserve` | Status dot from 15.6's status table | 3:1 or more |
| `RelationshipStrip.tsx` L37 | Preserved rail line | `var(--preserve)` | `components/sleeve/split-rail.tsx`: spend apricot, equity green, waiting hatched | 3:1 vs track |
| `StepperPanel.tsx` L25 | Preserve active step | `bg-preserve text-surface` | Black gradient only (`--color-brand` to `--color-brand-strong`) | 18.9 |
| `open-access/page.tsx` L195 | Low severity bar | `bg-info` | Not used. Sleeve shows no severity bars | |
| `directory/[id]/page.tsx` L74 | "overlapping" text | `text-preserve` | `--color-accent-text` for any inline green note | 5.78 |
| `PlanPreviewClient.tsx` L21 | Keep group tint | `bg-preserve-soft/30` | `--color-equity-surface` green-50 for the equity group in a split breakdown | |
| `PlanPreviewClient.tsx` L163 | Keep card on phones | `border-preserve/30 bg-preserve-soft/60` | `--color-equity-border` / `--color-equity-surface` | |
| `PlanPreviewClient.tsx` L208-209 | Positive callout | `border-preserve bg-preserve-soft`, label `text-preserve` | `--color-accent-border` / `--color-accent-soft`, label `--color-accent-text` | 5.17 |
| `tailwind.config.ts` L106 | `bg-hero-panel` (unused) | blue three-stop | `--gradient-hero` | no text on it |
| `tailwind.config.ts` L108 | `bg-accent-deep` (unused) | blue two-stop | `--gradient-accent-deep`; white text passes at every stop | 5.78 or more |
| `tailwind.config.ts` L91 | `shadow-focus` | blue 0.25 | Remove; use the outline | |

Blue-cast neutrals (`#f4f5f7`, `#ebedf1`, `#e7e9ee`, `#d4d8e0`, `#5b6270`) stay as they are in `tokens.css`. The palette work already decided that.

---

## 15. Sleeve screens on these patterns

Shared rules for every screen:

- Data only through `app/src/data` hooks (`useAccount`, `useLedger`, `useRule`, `useBuckets`, `useSplitPreview`, `useHoldings`, `useInbox`, `useReceipts`, `useReceipt`, `useCard`, `useVerification`, `useSellQuote`, `useMarket`, `useSession`, and the write hooks). Every hook returns a `Read` with loading, error and ready states; map them to 11.2, 11.3 and the ready layout.
- Every holding and every receipt shows "debt security, not a share" (`components/ui/debt-security-line.tsx`). A Stock Token is never a share, stock ownership or a dividend right. "Stock Tokens" and "Robinhood Chain" in full. No yield, APY, returns or performance. Borrow, pay links, baskets and crews never appear.
- Real token icons everywhere a ticker or USDG appears (`components/token/*`).
- Amounts are ink. Color sits in the dot, the rail or the icon beside the amount.
- Status and reason words come from one mapping in `components/sleeve/text.ts`. Suggested words for receipts (SPEC 13 statuses in `packages/core/src/spec.ts` L31-41):

| Status | Tag text | Tag tone |
| --- | --- | --- |
| FILLED | Bought | success |
| SETTLED | Bought after wait | success |
| QUEUED | Waiting | warning (with `--pattern-waiting` in graphics) |
| RELEASED | Released to spend | neutral |
| PART_SOLD | Partly sold | neutral |
| SOLD | Sold | neutral |
| RECONCILED | Reconciled | neutral |
| REFUSED_TICKER | Ticker not allowed | danger |
| REFUSED_ACCOUNT | Account blocked | danger |

Reasons (SPEC 13, L45-55) as plain lines under a waiting item: SESSION "Market closed", PAUSED "Token paused by issuer", ORACLE_PAUSED "Price feed paused", MULTIPLIER "Corporate action pending", STALE "Market price is out of date", DEPEG "USDG is off its dollar price", CLIP "Order too large for the pool", PREMIUM "Price above your cap". These need the owner's sign-off as copy (open question).

### 15.1 Shell for Sleeve

```
+--------------------------------------------------------------------------------+
| #eceef1                                                                        |
| [Sleeve wordmark]        +---------------------------------------------------+ |
| +----------------------+ | < >  Home                     [Market open  pill] | |
| | 0x12..ab  [copy]     | |---------------------------------------------------| |
| | Smart account        | |  page                                            | |
| +----------------------+ |                                                   | |
| (o) Home      <- white   |                                                   | |
|     Inbox      pill      |                                                   | |
|     Receipts             |                                                   | |
|     Rule                 |                                                   | |
|     Sell                 |                                                   | |
| ( Receive USDG )  black  |                                                   | |
|                   pill   |                                                   | |
| +----------------------+ |                                                   | |
| | Market session card  | |                                                   | |
| +----------------------+ |                                                   | |
|     Verify a receipt     |                                                   | |
| ------------------------ |                                                   | |
| disclaimer, 11 px        +---------------------------------------------------+ |
+--------------------------------------------------------------------------------+
```

- Org card becomes the account card: a 34x34 black avatar tile with the Sleeve mark or the address's first character, the shortened smart account address 13/600 in mono, sub line "Smart account" 11 px. Copy button 44x44 inside (`copy-field.tsx`).
- Nav order from `navigation.ts`: Home, Inbox, Receipts in the top group; Rule and Sell also in the top group on desktop (they are core in M0), Verify a receipt in the bottom group as a `.workspace-settings` style link. On phones Rule, Sell and Verify sit in More, as `navigation.ts` has it.
- The rail pill is the one action every payee needs: "Receive USDG". It opens the payment address sheet (15.2).
- The help card becomes a market session card from `useMarket()`: icon tile, "Market open" or "Market closed", next open or close time in the viewer's zone, one link to the session details. It states facts only.
- Rail footer: the disclaimer "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc." at 11 px in `--color-ink-secondary` (ink-muted fails on the shell at 4.33). On phones it goes at the bottom of the More sheet and on every public page footer.
- Topbar trailing slot: the market session pill (StateTag style, success or warning tone, with sentence-case text) when the page has no single primary action.

### 15.2 Home: the two sleeves and the payment address

PRD 15: the first screen is the sentence, the two sleeves and the payment address; proof comes after. Hooks: `useAccount`, `useLedger`, `useRule`, `useBuckets`, `useHoldings`, `useInbox`, `useReceipts` (latest 5), `useMarket`.

Desktop, 1440:

```
page heading (3.1)
  h1  the rule as a sentence, e.g. "10 percent of every payment buys SPY"      [Edit rule] secondary
  lede one line on what happens off-hours
dash-stats, 3 tiles here (spend, equity, address), grid 1fr 1fr 1.1fr, gap 16
  +-----------------------+ +-----------------------+ +--------------------------+
  | [USDG icon] Spend      | | [SPY][QQQ] Equity     | | Payment address          |
  | 450.00 USDG            | | 0.0712 SPY            | | 0x5f..d168  [copy]       |
  | trend: o apricot dot   | | trend: o green dot    | | QR 96 px, chain name     |
  |  "from 3 payments"     | |  value at feed price  | | "Send USDG on Robinhood  |
  |------------------------| |  debt security line   | |  Chain"                  |
  | See spend activity   > | |-----------------------| |--------------------------|
  +-----------------------+ | See holdings        > | | Show full address      > |
                            +-----------------------+ +--------------------------+
waiting module (only when a bucket is QUEUED), full width
  .dash-module with --pattern-waiting rail at the left edge, reason in plain words,
  amount waiting in USDG, [Release to spend] secondary, [Buy now] when allowed
dash-modules (0.9fr / 1.1fr)
  left : Holdings breakdown rows (5.4) with token icons, figure, debt security line
  right: Recent receipts queue rows (6.3) with status tag, time, [View] pill
```

- Spend tile: `--color-spend*` for the dot and the icon tile tint only. Figure is ink.
- Equity tile: token stack icons, raw balance and value at feed price, the feed timestamp in 12 px muted (PRD 7.11 keeps pool and feed price apart). The debt-security line sits in the trend row.
- Address tile: reuses `payment-address-card.tsx`. On phones it becomes the first card and "Receive USDG" opens the bottom sheet (10) with a 240 px QR.
- Split rail (`split-rail.tsx`) runs across the top of the stat row on a new payment: one bar showing spend and equity proportions of the last split, filled once with `--duration-narrative`, static under reduced motion.
- Empty state (11.1, left aligned): "Nothing has split yet. Send USDG to your address from another account. Top-ups made inside Sleeve do not split." Action: Copy address.
- Error state (11.3): what failed, "Your USDG is still in your account.", Try again.
- Phone (390): one column in this order: rule sentence, address card, spend, equity, waiting, holdings, receipts. Stat tile figure stays 28 px.

### 15.3 Rule editor

Hooks: `useRule`, `useSetRule`, `usePauseRule`, `useResumeRule`, `useSplitPreview`. Pattern: the CSS form card (9.1) at 860 px, with a live preview module beside it on desktop (`grid 1fr 340px`, gap 24), below it on phones.

- Field 1: share of pay to Stock Tokens as a slider plus a number field (`slider.tsx`), basis points under the hood, whole percent in the UI. Label 13/600 above, hint below.
- Field 2: ticker as a choice grid (`choice.tsx`): 2 columns of 64 px choice cards, each with the token icon, ticker 15/600, the issuer's name for the token as a 13 px line, selected state `--color-brand` 2 px border with a check, not green fill.
- Field 3: premium cap with plain wording, e.g. "Wait if the price is more than 0.5 percent above the market reference."
- Preview module: the split of a sample 500 USDG payment as two rows with dots and the split rail, then "Rounding dust goes to spend." Data from `useSplitPreview`.
- Pause and resume: secondary button in the heading actions, with a dialog (10) for pause.
- Submit: primary, right aligned, with 9.4 errors.

### 15.4 Inbox

Hooks: `useInbox`, `useSplit`. Pattern: the queue list (6.3). Each item is an inbound USDG transfer: mark tile with the USDG icon, kicker "From 0xab..12" mono 12 px, title the amount, body the state in words (RECEIVED "Arrived", WAITING_GRACE "Splits after a short wait", SORTED "Split"), right side time and a pill action "Split now" when the public split is callable. Filter pills above: All, Waiting, Split. Empty state per 11.1.

### 15.5 Receipts list

Hooks: `useReceipts` with filters. Pattern: toolbar (3.2) with ticker filter pills (with token icons) and status pills, a mono search by receipt id, then the CSS row list (6.2) with columns `token+title | status | time | amount`, header strip on desktop, 2-column collapse on phones. A CSV export secondary button in the heading (PRD 7.10). Loading skeleton of 6 rows at 72 px.

### 15.6 Receipt detail

Hooks: `useReceipt`, `useVerification` for the inline check. Pattern: the narrow detail column (7.2) at 680 px.

1. Verdict banner (5.6) with sentence-case status ("Bought", "Waiting", "Ticker not allowed") at `--text-figure-m` 28 px, not 40 px caps. Tone from the status table. Subline: what this receipt records and the block, plus the debt-security line for any receipt that touches a Stock Token.
2. "The split" panel: two ReceiptRows (6.4) with apricot and green dots: spend amount USDG, equity amount and what it became.
3. "The price" panel as key value rows (6.4): pool price with timestamp, feed price with round and timestamp, premium paid against the reference, uiMultiplier at fill. Pool and feed never merged (PRD 7.11). Mono for numbers.
4. "Check this receipt" panel: the verifier result lines with match marks and the RPC provider name, and a link to the public verify page.
5. Actions: "Make a card" secondary, "Copy receipt id" ghost.

### 15.7 Card composer and public card

Hooks: `useCreateCard`, `useCard`. Composer is a two-pane layout like 7.1 at a smaller scale: options on the left (receipt card or week card, show-proof toggle), the card preview on the right on `--gradient-stage` with the card on white or `--glass-light`. The card shows ticker with icon, share of pay, the debt-security line, Sleeve wordmark, and nothing else by default (PRD 7.10). Turning on show proof opens a dialog (10) that says the receipt id reveals the account onchain. Export as PNG and an OpenGraph image share the same component. The public `/card/[id]` page reuses the public frame of the verify page, with the disclaimer footer.

### 15.8 Sell-back

Hooks: `useSellQuote`, `useSell`, `useMarket`. Pattern: form card (9.1) with a holding picker (choice grid with token icons and balances), amount field, then a quote module laid out as key value rows: what you sell, expected USDG, pool price and feed price with timestamps, premium or discount against the reference. When `SellWaitReason` is SESSION or STALE, show the waiting module with the reason and an override path; the override opens `override-dialog.tsx` styled per 10, with the risk stated in one sentence and the primary button labelled with the action. SellBlock reasons render as an inline danger callout (5.8 blocker version).

### 15.9 Onboarding

Hooks: `useCheckEligibility`, `useCreateAccount`, `useSignIn`, `useSetRule`. Pattern: the rendered New Closeout layout (9.2) at 680 px, no rail (signed-out frame with the wordmark top left and the disclaimer at the bottom). Stepper panel (9.3) with four rows: Create your passkey, Confirm where you live, Choose your rule, Get your address. The active row is the black gradient. One step's form shows below it in an elevated panel. Residency is a select plus an attestation checkbox with `--color-border-control`. A block result shows the ErrorState card in the warning tone with the reason in words. Passkey is the only login. No email field.

### 15.10 Verify (public)

Hooks: `useVerification`. Signed-out public frame: a 68 px top bar with the wordmark and a "Open the app" secondary link, then the narrow column (7.2). Form: one mono input for the receipt id, primary "Check receipt". Result: verdict banner with MATCH (success, "Matches the chain"), MISMATCH (danger), NOT_FOUND (neutral), PROVIDER_BLOCKED (warning, "The check could not reach its RPC provider"). Below, each VerifyCheck as a key value row with expected, found and a match mark, then the provider name used. Footer with the disclaimer and the issuer disclosure link.

---

## 16. Sources and method

Read in full, in `/Users/mac/closeout/apps/web/`:

- `app/product.css` (1,431 lines), `app/globals.css` (87), `tailwind.config.ts` (115), `app/fonts.ts`, `app/layout.tsx`
- `app/(product)/layout.tsx` and every page under `app/(product)/`: `open-access`, `closeouts`, `closeouts/new`, `closeouts/[id]/plan` with `PlanPreviewClient.tsx`, `closeouts/[id]/run`, `closeouts/[id]/receipt`, `directory`, `directory/[id]`, `directory/relationships/[id]` (classes only), `connections`, `access-map`, `exceptions`, `settings`
- Every file in `app/_components/` (16 files)
- `lib/api.ts`, `lib/useApi.ts`, `fixtures/data.ts`, `fixtures/types.ts`
- `/Users/mac/closeout/packages/ui/src/index.ts`: an empty export with a comment saying primitives still live in `apps/web/app/_components`. Nothing to take from it.
- Icons: `public/brand/icons/*.svg`, 24x24, stroke 1.5.

Read in Sleeve: `internal/CLAUDE.md`, PRD sections 7.10 to 7.12 and 15, `app/src/styles/tokens.css`, `app/src/components/sleeve/navigation.ts`, `app/src/data/hooks.ts` and `types.ts` (signatures), `packages/core/src/spec.ts` L29-71, `docs/design/closeout-landing-blueprint.md` sections 15 and 16.

Screenshots, saved in the session scratchpad and not in the repo:

- Plain run against `http://localhost:4664` at 1440x900 and 390x844: `npx --no-install playwright screenshot --full-page --wait-for-timeout=2500`. Every data route showed the error card, because the closeout API proxy returned HTTP 500 for `/findings`, `/principals` and the other list routes on 3 October 2026.
- Mocked run: a Playwright 1.63 script intercepted `**/api/proxy/**` and answered each route from closeout's own `fixtures/data.ts`, so the ready states render. Routes captured at both sizes: `/open-access`, `/closeouts`, `/closeouts/new`, `/closeouts/co-acme-1/plan`, `/closeouts/co-globex-1/run`, `/closeouts/co-globex-1/receipt`, `/closeouts/co-jrivera-1/receipt`, `/directory`, `/directory/p-acme`, `/connections`, `/access-map`, `/exceptions`, plus `/settings` (static).
- Rendered sizes quoted in this file (row heights, button sizes, rail positions) were read from those 1440 and 390 renders.

Contrast ratios were computed with the WCAG 2.x relative luminance formula in Node for every pair quoted.
