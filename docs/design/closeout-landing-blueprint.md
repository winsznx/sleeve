# Closeout landing blueprint

Reference for the Sleeve v2 landing (D-005, D-021). Written 3 October 2026 from closeout's source files and its running dev server at http://localhost:4664/.

The landing at `/` is `app/page.tsx`, which wraps `app/(marketing)/site/layout.tsx` (navbar and footer) around `app/(marketing)/site/page.tsx` (the sections). Styles are `app/(marketing)/site/marketing.css` on top of the tokens in `app/globals.css`. Every closeout path below is relative to `/Users/mac/closeout/apps/web/`, and `L` numbers are line numbers in that file. When a line number has no file name, it is `marketing.css`.

How the values were taken:

- Declared values come from the files and carry file and line.
- Rendered values were measured in Chromium through Playwright 1.63.0 at 1440x900, 1024x900 and 390x844, with `getBoundingClientRect` and `getComputedStyle` on every element. `y` is the distance from the top of the page, `x` from the left edge of the viewport.
- Contrast uses the WCAG 2 formula. Over gradients it was sampled from rendered pixels.
- Section 17 lists the screenshots and scripts.

Rules for builders:

1. Reproduce layout, spacing, type scale, radii, shadows and component patterns. D-005 allows this.
2. Never reuse closeout's name, logo or any closeout sentence. Text slots below are described by role and length only. Section 16 lists Sleeve content for each slot.
3. Swap every blue listed in section 15 for the palette agent's green.
4. Fix the defects in section 14 instead of copying them. Closeout fails WCAG AA in the places listed in section 13, and Sleeve must not.

Contents: 1 page frame and tokens, 2 navbar, 3 hero, 4 four-step list, 5 three-card grid, 6 two platform cards, 7 provider cards, 8 FAQ, 9 CTA band, 10 footer, 11 responsive summary, 12 motion and interaction, 13 accessibility audit, 14 defects not to copy, 15 blue map, 16 Sleeve slot map, 17 sources.

---

## 1. Page frame and tokens

### 1.1 Fonts

| Family | Weights | Variable | Source | Used for |
| --- | --- | --- | --- | --- |
| Instrument Sans | 400, 500, 600, 700, latin, `display: swap` | `--font-instrument-sans` | `fonts.ts` L3-8, Google Fonts through `next/font/google` | Everything except step numbers |
| IBM Plex Mono | 400, 500 | `--font-ibm-plex-mono` | `fonts.ts` L10-15 | Only the step numbers 01 to 04 (L779) |

- Body stack: `var(--font-instrument-sans), Inter, -apple-system, Arial, sans-serif` with `-webkit-font-smoothing: antialiased` (`globals.css` L54-57).
- Weight roles: 400 body, 500 headings and buttons, 600 small emphasis (card titles, values, badges), 700 only for the Stripe letter mark (L693).
- Sleeve already loads the same two families with the same weights and variable names (`/Users/mac/sleeve/app/src/app/fonts.ts` L4-16). Nothing new to load.

### 1.2 Page base

```css
/* L9-16 */
.marketing-site { --m-gutter: 24px; --m-panel: #f4f5f7; background: var(--canvas); color: var(--ink); font-size: 15px; line-height: 1.55; }
/* L18-24 */
.m-container { width: 100%; max-width: 1200px; margin: 0 auto; padding-left: var(--m-gutter); padding-right: var(--m-gutter); }
```

- Content width is 1152 px at desktop (1200 minus two 24 px gutters). On a 1440 viewport the content starts at x=144.
- The gutter drops to 18 px at 767 px and below (L1482-1484).
- Body text renders at 15/23.25 px. Every element without its own `line-height` inherits 1.55, which is why 22 px card titles render with 34.1 px leading and the 30 px device figure with 46.5 px.
- Light theme only: `color-scheme: light` (`globals.css` L39). There is no dark mode.
- Resets in `globals.css` L42-76: `box-sizing: border-box` everywhere, zero margins on h1 to h4, p and figure, links inherit color with no underline, buttons inherit font with a pointer cursor.

### 1.3 Tokens (`globals.css` L7-40, mirrored in `tailwind.config.ts` L23-50)

| Token | Value | Landing use | Blue? |
| --- | --- | --- | --- |
| `--canvas` | `#ffffff` | Page background | |
| `--surface` | `#ffffff` | Not used directly on the landing | |
| `--surface-muted` | `#f4f5f7` | App panel, bell, fields, inner button, Slack mark, secondary button hover (L123, L372, L379, L703, L911, L977) | |
| `--m-panel` (L11) | `#f4f5f7` | Every grey panel and card: solutions panel, why cards, feature cards, provider cards, FAQ items, CTA band | |
| `--surface-strong` | `#ebedf1` | Avatar, meter track, device bar track, GitHub mark | |
| `--border` | `#e7e9ee` | Header and footer rules, eyebrow pill, chips, lists, strip | |
| `--border-strong` | `#d4d8e0` | Secondary button border (L119). Also the default rail line color (L442), which both rails override | |
| `--ink` | `#0b0b0c` | Headings and primary text | |
| `--ink-secondary` | `#5b6270` | Body copy, nav links, labels | |
| `--ink-muted` | `#8a909c` | Captions and small metadata (fails AA, section 13) | |
| `--brand` | `#101114` | Primary pill buttons, active step row, CTA dot in the app card | |
| `--brand-strong` | `#000000` | Primary button hover | |
| `--accent` | `#3b71f0` | Icons, eyebrow mark, type labels, chip bars | SWAP |
| `--accent-strong` | `#2554cc` | Stripe letter mark | SWAP |
| `--accent-soft` | `#eaf0fe` | Stripe mark tile | SWAP |
| `--close` / `--close-soft` | `#d93b3b` / `#fdecec` | Close badges, close icon tile, closing rail | |
| `--preserve` / `--preserve-soft` | `#3b71f0` / `#eaf0fe` | Keep badge, keep icon tile, preserved rail, coverage meter, preserved text | SWAP |
| `--success` / `--success-soft` | `#17a673` / `#e6f7f0` | Success circle in the receipt mock | See 15.6 |
| `--warning` / `--warning-soft` | `#c98a14` / `#fcf3e1` | Not used on the landing | |
| `--danger` / `--danger-soft` | `#d93b3b` / `#fdecec` | Not used on the landing | |
| `--info` / `--info-soft` | `#3b71f0` / `#eaf0fe` | Not used on the landing | SWAP |
| `--radius-control` | `10px` | Not used on the landing | |
| `--radius-panel` | `16px` | Not used on the landing | |
| `--radius-card` | `24px` | Every top-level panel and card | |
| `--shadow-card`, `--shadow-floating` | see `globals.css` L37-38 | Not used on the landing | |

### 1.4 Radius scale in use

| Radius | Elements |
| --- | --- |
| 999 px | Buttons, eyebrow pill, chips, badges, avatar, bell, quick-action icons, meters, bars, bubbles, field tags, inner button, feature icon, success circle |
| 24 px | Hero panels, solutions panel, why cards, feature cards, provider cards, CTA band (`var(--radius-card)`) |
| 22 px | App card (L331); device frames, top corners only (L1103) |
| 20 px | Solutions art (L804) |
| 18 px | Float cards, app panel, steps, why inner panel, why art, stat float, FAQ items |
| 16 px | App grants list, glass stat, chip float |
| 14 px | Step number tile |
| 13 px | Float card icon tile, field box |
| 12 px | Why icon box (no fill, so it is invisible) |
| 11 px | Provider mark |
| 7 px | Small provider mark inside field tags |
| 2 px | Rail line, rail end cap, chip bars |

The rule behind it: pills for anything interactive or label-like, 24 px for top-level panels, 16 to 22 px for cards nested inside panels, 11 to 14 px for icon tiles.

### 1.5 Shadows

All shadows are tinted with ink `rgba(11, 11, 12, a)`. Grey panels and cards have no shadow and no border. They separate from the white page by fill alone.

| Shadow | Element | Line |
| --- | --- | --- |
| `0 1px 2px rgba(11,11,12,0.04)` | Eyebrow pill | L144 |
| `0 8px 26px rgba(11,11,12,0.12)` | Hero float cards | L275 |
| `0 16px 50px rgba(11,11,12,0.16)` | Hero app card | L332 |
| `0 10px 34px rgba(11,11,12,0.16)` | Coverage stat float | L571 |
| `0 6px 18px rgba(11,11,12,0.1)` | Provider bubbles | L629 |
| `0 -2px 30px rgba(11,11,12,0.07)` | Device frames (upward shadow) | L1104 |
| `0 8px 26px rgba(11,11,12,0.14)` | Chip float | L1205 |
| `text-shadow: 0 2px 14px rgba(11,11,12,0.2)` | Glass stat number | L828 |

### 1.6 Shared pieces

Buttons (L95-131):

```css
.m-button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-height: 48px; padding: 0 26px;
  border-radius: 999px; background: var(--brand); color: #fff; font-size: 15px; font-weight: 500; border: 1px solid var(--brand);
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease; white-space: nowrap; }
.m-button:hover { background: var(--brand-strong); }
.m-button-secondary { background: #fff; color: var(--ink); border-color: var(--border-strong); }
.m-button-secondary:hover { background: var(--surface-muted); border-color: var(--ink-muted); }
.m-header .m-button { min-height: 44px; padding: 0 22px; font-size: 14px; }
```

Rendered: hero primary 163.7x48, hero secondary 183.2x48 (a trailing play glyph after a 9 px gap), header CTA 170.4x44, CTA band primary 187.3x48. Labels never wrap (`white-space: nowrap`).

Eyebrow pill, the "hero badge" (L135-153):

```css
.m-eyebrow { display: inline-flex; align-items: center; gap: 9px; min-height: 40px; padding: 0 18px; border: 1px solid var(--border);
  border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(11,11,12,0.04); font-size: 14px; color: var(--ink-secondary); white-space: nowrap; }
.m-eyebrow .m-small-mark { color: var(--accent); font-weight: 600; }
```

- Leading glyph is U+2733, an eight-spoked asterisk set as text, `aria-hidden`.
- Closeout puts this pill above all seven section headings: hero, solutions, why, features, providers, FAQ, CTA band.
- Rendered height is 40 px. Width follows the text: 337.8 px for the 45-character hero label, 113.9 px for an 8-character label.

Section furniture (L155-196):

```css
.m-section { padding-top: 104px; padding-bottom: 8px; }
.m-section-heading { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.85fr); align-items: end; gap: 40px; margin: 28px 0 56px; }
.m-section-heading h2, .m-centered-heading h2 { font-size: 52px; line-height: 1.06; letter-spacing: -0.032em; font-weight: 500; }
.m-section-heading > p { font-size: 17px; color: var(--ink-secondary); line-height: 1.6; padding-bottom: 6px; }
.m-centered-heading { text-align: center; max-width: 780px; margin: 0 auto 56px; display: flex; flex-direction: column; align-items: center; gap: 22px; }
.m-centered-heading p { font-size: 17px; color: var(--ink-secondary); }
```

- Split heading at 1440: the h2 column is 614.5 px wide and the paragraph column 497.5 px. Both sit on one baseline because of `align-items: end`. The paragraph has 6 px of bottom padding to optically meet the h2 baseline.
- Centered heading: 780 px wide, with a 22 px gap between pill, h2 and paragraph.

Provider mark (page.tsx L8-27, CSS L673-705):

```css
.m-provider { width: 34px; height: 34px; border-radius: 11px; display: inline-grid; place-items: center; flex-shrink: 0; border: 1px solid var(--border); background: #fff; }
.m-provider svg { width: 18px; height: 18px; }
.m-provider-stripe { background: var(--accent-soft); border-color: transparent; color: var(--accent-strong); font-weight: 700; }  /* a bold letter S */
.m-provider-github { background: var(--surface-strong); border-color: transparent; color: var(--ink); }                      /* GitHub mark svg */
.m-provider-slack  { background: var(--surface-muted); border-color: transparent; }                                          /* 4-color Slack svg */
```

The mark is a `span` with `aria-label`. Each mark has a different tinted tile, so the logos read as app icons. In Sleeve this is the token icon tile. Use real token logos per D-021, never a letter.

Badge (L707-727): `inline-flex; gap 5px; border-radius 999px; padding 4px 11px; font-size 11px; font-weight 600; white-space: nowrap; margin-left: auto`. Close tone `#fdecec` fill with `#d93b3b` text. Keep tone `--preserve-soft` fill with `--preserve` text. Rendered at 25 px tall and 46 to 59 px wide.

### 1.7 Type scale

| Role | Desktop | 768 to 1100 | 767 and below | Weight | Line height | Letter spacing | Color | Line |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Hero h1 | 76 px | 58 px | 40 px | 500 | 1.02 | -0.038em (-0.03em at 767) | ink | L208-215, L1448, L1488-1491 |
| Section and centered h2 | 52 px | 40 px | 32 px | 500 | 1.06 | -0.032em | ink | L168-174, L1451-1455, L1520-1525 |
| CTA band h2 | 52 px | 40 px | 32 px | 500 | 1.06 | -0.032em | ink | L1364-1370 |
| FAQ h2 | 46 px | 46 px | 32 px | 500 | 1.08 | -0.03em | ink | L1297-1302 |
| Glass stat number | 54 px | 54 px | 40 px | 600 | 1 | -0.03em | white | L822-829, L1557-1559 |
| App readout number | 38 px | same | same | 600 | 1.1 | -0.03em | ink | L409-414 |
| Feature card h3 | 30 px | 30 px | 24 px | 500 | 1.15 | -0.024em | ink | L1084-1089, L1530-1532 |
| Device figure | 30 px | same | same | 600 | inherits 1.55 | -0.03em | ink | L1126-1130 |
| Why card h3 | 22 px | same | same | 500 | inherits 1.55 | -0.018em | ink or white | L881-885 |
| Step title | 21 px | 21 px | 17 px | 500 | inherits 1.55 | -0.014em | ink or white | L783-788, L1541-1543 |
| Provider card h3 | 21 px | same | same | 500 | inherits 1.55 | normal | ink | L1258-1262 |
| Chip float value | 20 px | same | same | 600 | inherits | -0.02em | ink | L1227-1233 |
| Field value | 18 px | same | same | 600 | inherits | -0.02em | ink | L931-935 |
| Hero lead and split-heading lead | 17 px | 17 px | 15 px | 400 | 1.6 | normal | ink-secondary | L217-223, L176-181, L1492-1497 |
| Centered-heading lead and CTA band lead | 17 px | 17 px | 15 px | 400 | inherits 1.55 | normal | ink-secondary | L193-196, L1372-1376, L1492-1497 |
| FAQ question | 17 px | 17 px | 15 px | 500 | inherits | normal | ink | L1316-1326, L1574-1576 |
| FAQ lead | 16 px | same | same | 400 | inherits | normal | ink-secondary | L1304-1307 |
| Receipt verdict | 16 px | same | same | 600 | inherits | normal | ink | L1013-1016 |
| Body, buttons | 15 px | same | same | 400 or 500 | 1.55 | normal | ink | L14-15 |
| Feature card body | 15 px | same | same | 400 | inherits | normal | ink-secondary | L1091-1096 |
| Nav, login, eyebrow, footer links, card body | 14 px | same | same | 400 | inherits | normal | ink-secondary | L59, L81, L145, L1412, L889 |
| Float card title, value | 14 px | same | same | 600 | inherits | normal | ink | L299-317 |
| FAQ answer | 14 px | same | same | 400 | 1.65 | normal | ink-secondary | L1343-1348 |
| Small UI text | 13 px | same | same | 400, 600 for titles | inherits | normal | ink-secondary for labels, ink for titles and rows | L389, L432, L508, L549, L576 |
| Badges | 11 px | same | same | 600 | inherits | normal | tone color | L707-727 |
| Device status row | 11 px | same | same | 600 | inherits | normal | ink-secondary | L1109-1117 |
| Captions and meta | 11 to 12 px | same | same | 400 | inherits | normal | ink-muted | many, see section 13 |
| Step number | 14 px IBM Plex Mono | same | same | 400 | inherits | normal | ink-secondary | L770-781 |

### 1.8 Vertical rhythm at 1440

| Block | Top y | Height | Spacing rule |
| --- | --- | --- | --- |
| Header | 0 | 73 | 72 plus a 1 px border |
| Hero eyebrow | 157 | 40 | Hero padding-top 84 |
| Hero h1 | 231 | 232.5 (3 lines) | margin-top 34 |
| Hero lead | 489.5 | 108.8 (4 lines) | margin-top 26 |
| Hero CTAs | 638.3 | 48 | margin-top 40 |
| Hero panels | 760.3 | 754.1 | margin-top 74 |
| Provider strip | 1570.4 | 65 | margin-top 56, padding-top 30 |
| Four-step section | 1635.4 | 864.8 | padding 104 top, 8 bottom |
| Three-card section | 2500.2 | 964 | same |
| Platform section | 3464.1 | 899.1 | same |
| Provider section | 4363.2 | 746.1 | padding 104 0 8 |
| FAQ section | 5109.3 | 456 | padding 104 top, 8 bottom |
| CTA band | 5669.3 | 548.9 | margin-top 104 |
| Footer | 6322.2 | 338.3 | margin-top 104 |
| Page end | 6660.5 | | |

- The space from the end of one section's content to the next eyebrow is 112 px (8 plus 104). It drops to 72 px (8 plus 64) at 767 and below.
- Split-heading sections: eyebrow, 28 px, heading, 56 px, content. The 56 px becomes 34 px at 767 and below.
- Centered-heading sections: eyebrow, 22 px, h2, 22 px, lead, 56 px, content. These gaps do not change on mobile.
- Fold at 1440x900: the CTA row ends at y=686 and the panels start at y=760, so the top 140 px of the product scene shows above the fold. At 390x844 the CTAs end at 682 and the first panel starts at 756, leaving 88 px.

### 1.9 Breakpoints

Two media queries:

- `@media (max-width: 1100px)` at L1447-1479.
- `@media (max-width: 767px)` at L1481-1577.

That gives three bands: 1101 and up, 768 to 1100, and 767 and below. There is no wide-screen rule. Above 1200 the page simply centers.

Horizontal overflow measured at 15 widths:

- From 600 to 1440: none.
- From 320 to 430: the document is 450 px wide because the header does not fit (defect 9 in section 14). At 320 the hero eyebrow also overflows.

### 1.10 Layering and overlaps

- The page has one z-index: the sticky header at 50 (L31). Nothing else sets one.
- Floating pieces are `position: absolute` with `z-index: auto`. They paint above their in-flow siblings because positioned boxes paint later:
  - the coverage stat float over the app card (3.3)
  - the bubbles in the hero stage (3.3)
  - the chip floats over the device frames (6.2)
- `overflow: hidden` clips these containers:
  - both hero panels (L245), so the floats never leave the stage's 24 px corners
  - the step art (L805)
  - the feature cards (L1069), which is what cuts the device frames at the card bottom
  - the app grants list (L499), the coverage meter (L584) and the device bar (L1142)
- Backdrop filters: the header `blur(14px)` (L33) and the glass stat `blur(14px)` (L818). Neither ships a `-webkit-` prefix.

---

## 2. Navbar (`layout.tsx` L35-61, CSS L28-91, L127-131)

```
header.m-header                      sticky top 0, z-index 50, rgba(255,255,255,0.86) + backdrop-filter blur(14px), border-bottom 1px #e7e9ee
  div.m-container.m-header-inner     flex, align center, justify space-between, gap 24, min-height 72
    a.m-logo [aria-label]            brand name plus "home"; inline-flex, no shrink; img 145x30 (svg 260x56 viewBox renders 145x31.2), priority
    nav [aria-label="Main navigation"]  flex, align center, gap 38, 14px ink-secondary
      a x4 (in-page anchors)         min-height 44, inline-flex center; hover: color ink
    div.m-header-actions             flex, align center, gap 14, no shrink
      a.m-login                      14px ink-secondary, min-height 44, padding 0 8; hover: ink
      a.m-button                     header size: min-height 44, padding 0 22, 14px, black pill
```

Rendered at 1440:

- Bar is 1440x73.
- Logo at x=144, y=20.4.
- Nav runs from x=461 to x=860.5 (399.5 wide, 44 tall). `space-between` centers it between the logo and the actions, so its center is x=660.75, not the page center at x=720.
- Actions run from x=1032.6 to x=1296: the login link is 79x44 and the CTA 170.4x44.

States:

- Hover: links go from ink-secondary to ink with no transition. The CTA goes from `#101114` to `#000` over 140 ms.
- Focus: the global ring (section 12).
- No active or current-section state, no underline, no scroll spy.

Responsive:

- 1100 and below: `nav { display: none }` (L1473-1475). Nothing replaces it: no menu button, no sheet.
- 767 and below: the gutter is 18. The logo (145) plus the gap (24) plus the actions (263.4) need 432.4 px, so the page widens to 450 px on any phone.

Scroll behavior: the bar stays on top. Content scrolls under the 86 percent white with a 14 px blur. That is the page's only scroll-linked effect. There is no shrink-on-scroll and no shadow-on-scroll.

For Sleeve's richer navbar (D-021: mega menu, live market session pill, network pill, account chip, mobile sheet):

- Keep this chrome as is: 72 px height, translucent white with blur, 1 px bottom border, 38 px link gap, 14 px ink-secondary links, pill CTA at 44 px.
- Add the missing pieces closeout lacks: a menu button and sheet below 1101 px, a current-page state, and a skip link.
- Add `-webkit-backdrop-filter`, because Safari before 18 needs the prefix and closeout ships only the unprefixed property.

---

## 3. Hero (`page.tsx` L233-320, CSS L198-669)

### 3.1 Desktop layout at 1440

```
                    [ * eyebrow pill, 45 chars ]                        y157
             Headline, 49 chars, 3 lines at 76 px                       y231
        lead paragraph, 264 chars, 4 lines, max-width 640               y489
               [ Primary pill ]  [ Secondary pill  > ]                  y638
x144                       x583 x609                                  x1296
+--------------------------+   +------------------------------------------+ y760
| neutral panel  439 wide  |   | gradient stage  687 wide                 |
|                          |   |          +--------------------+          |
|  (empty gradient field)  |   |          | app card 430 wide  |   (B)    |
|                          |   |          |                    |   (B)    |
|                          |   | +--------+---+ overlaps card  |          |
| +----------------------+ |   | | stat float |  by 137.5 px   |          |
| | notification card 1  | |   | +--------+---+                |          |
| +----------------------+ |   |          +--------------------+          |
| | notification card 2  | |   |                                          |
| +----------------------+ |   |                                          |
+--------------------------+   +------------------------------------------+ y1514
--------------------------------------------------------------------------- y1570 strip rule
 strip caption (14 px, muted)            [S] name  |  [mark] name  |  [mark] name
```

### 3.2 Badge, headline, lead, CTAs

```
section.m-hero.m-container          padding-top 84 (52 at 767), flex column, align center, text-align center  L200-206
  span.m-eyebrow                    shared pill (1.6)
  h1                                margin-top 34; 76/1.02/-0.038em/500; max-width 15ch  L208-215
  p.m-hero-description              margin-top 26; max-width 640; 17/1.6 ink-secondary  L217-223
  div.m-actions                     flex, gap 14, margin-top 40, wrap, centered  L225-231
    a.m-button                      primary black pill
    a.m-button.m-button-secondary   white pill, 1px #d4d8e0, trailing glyph in a span (aria-hidden)
```

- `15ch` at 76 px is 765.3 px of Instrument Sans, so a 49-character headline breaks into 3 lines. It is 584 px and 3 lines at 58 px, and 354 px and 4 lines at 40 px.
- The lead renders 640x108.8 at 1440 (4 lines). At 390 it is 15/24 px and runs 6 lines.
- 767 and below (L1498-1504): the CTAs stack in a column, each 100 percent wide (354 px at 390). Primary on top, 14 px gap.

### 3.3 Two-panel product scene

```css
.m-hero-panels { width: 100%; margin-top: 74px; display: grid; grid-template-columns: minmax(0, 0.78fr) minmax(0, 1.22fr); gap: 26px; text-align: left; }  /* L233-240 */
.m-panel-art { position: relative; border-radius: var(--radius-card); overflow: hidden; min-height: 520px; padding: 26px;
  display: flex; flex-direction: column; justify-content: flex-end; gap: 14px; }                                                      /* L242-252 */
```

- Rendered at 1440: the left panel is 439.1 wide and the right 686.9, both 754.1 tall.
- The height comes from the app card (666.1) plus the stage's 44 px top and bottom padding. The declared 520 px minimum never binds at desktop.
- The grid stretches the left panel to the same 754.1, so it is mostly empty gradient above the two cards. This is the "no product visuals" gap the owner named.

#### Left panel: neutral field with stacked notification cards (L262-317, page.tsx L258-279)

```css
.m-art-neutral { background:
  radial-gradient(110% 80% at 82% 10%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 62%),
  linear-gradient(160deg, #eef1f6 0%, #dfe4ec 100%); }
```

```
div.m-panel-art.m-art-neutral          cards pinned to the bottom by justify-content: flex-end, 14 gap, 26 padding
  div.m-float-card x2                  flex, align center, gap 13; #fff; radius 18; padding 13 18; shadow 0 8 26 rgba(11,11,12,.12)
    span.m-float-mark                  42x42, radius 13, grid center, 17/600, no shrink
      .m-float-close                   bg #fdecec, glyph #d93b3b (L289-292)
      .m-float-keep                    bg --preserve-soft, glyph --preserve (L294-297)   SWAP
    div
      strong                           block, 14/600, ink (22 and 15 chars)
      small                            block, 12 px, ink-muted, margin-top 2 (39 and 41 chars)
    span.m-float-value                 margin-left auto, 14/600, nowrap (7 chars)
```

- Rendered at 1440: each card is 387.1x68.3, at y=1337.9 and y=1420.1. The second ends 26 px above the panel bottom.
- At 390 the cards are 302 wide and the text wraps, making them 108.6 and 86.9 tall.
- In the reference template closeout cloned, this panel held a photograph with these cards laid over it (section 17).

#### Right panel: gradient stage and app card (L255-260, L319-561, page.tsx L38-142, L282-298)

```css
.m-art-cool { background:
  radial-gradient(120% 90% at 18% 12%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%),
  radial-gradient(90% 70% at 88% 82%, rgba(37,84,204,0.45) 0%, rgba(37,84,204,0) 65%),
  linear-gradient(158deg, #c9dcf7 0%, #9fbfee 55%, #85aae6 100%); }                                   /* SWAP: all blue */
.m-app-stage { position: relative; display: flex; align-items: center; justify-content: center; padding: 44px 30px; }   /* L319-325 */
```

Rendered stage colors: the light top left is about `#deeafa`, the middle about `#b6cef0`, and the dark bottom right about `#6991df`.

```
div.m-app-card                         width 100%, max-width 430; #fff; radius 22; padding 18; shadow 0 16 50 rgba(11,11,12,.16)  L327-334
  div.m-app-head                       flex, align center, gap 12, padding 4 4 16  L336-341
    span.m-avatar                      40x40 circle, #ebedf1, 14/600 ink-secondary, one letter  L343-354
    div > strong (15/600) + span (block, 12 px, ink-muted)  L356-365
    span.m-app-bell                    38x38 circle #f4f5f7, margin-left auto; glyph meant to be centered at 15 px  L367-376  (defect 1)
  div.m-app-panel                      #f4f5f7, radius 18, padding 18  L378-382
    div.m-app-panel-top                flex, between, gap 12, 13 px ink-secondary: label + span.m-app-chip  L384-391
      span.m-app-chip                  pill, #fff, 1px #e7e9ee, padding 5 12, 12 px, nowrap  L393-400
    div.m-app-readout                  flex, baseline, gap 10, margin-top 8  L402-407
      strong                           38/1.1/-0.03em/600  L409-414
      span                             13 px ink-muted  L416-419
    div.m-app-rails                    margin-top 18, column, gap 11  L421-426
      div.m-rail.m-rail-closing        flex, align center, gap 20, 13 px ink-secondary  L428-434
        span.m-rail-line               46x3, radius 2, #d93b3b; ::after 9x9 square, radius 2, right -12, top -3  L436-459
      div.m-rail.m-rail-preserved
        span.m-rail-line               62x3, radius 2, --preserve  L461-463   SWAP
    div.m-quick-actions                grid 4 x 1fr, gap 6, margin-top 18, padding-top 16, border-top 1px #e7e9ee  L465-472
      div x4                           column, center, gap 7, 11 px ink-secondary  L474-482
        span.m-quick-icon              46x46 circle, #fff, 1px #e7e9ee, 17 px glyph  L484-493
  div.m-app-grants                     margin-top 14, 1px #e7e9ee, radius 16, overflow hidden  L495-500
    div.m-app-grant x3                 flex, center, gap 11, padding 12 14, border-bottom 1px (none on last), 13 px  L502-513
      span.m-provider                  34x34 mark
      div > strong (500, overflow-wrap anywhere) + small (block, 11 px, ink-muted, margin-top 2)  L515-525
      span.m-badge                     close, close, keep (keep is SWAP)
  div.m-app-cta                        flex, center, gap 12, margin-top 14, padding 12 4 4  L527-533
    span.m-dot                         40x40 circle, --brand black, white glyph  L535-544
    div > strong (block, 13/600) + small (block, 12 px, ink-muted)  L546-556
    span                               trailing chevron, margin-left auto, ink-muted  L558-561
```

Rendered at 1440:

- App card: 430x666.1 at x=737.6, y=804.3, centered in the stage.
- Head: 61.8 tall. Panel: 394x290.7. Readout: 41.8 tall.
- Each rail: 20.1 tall. Quick-action strip: 87 tall.
- Grant list: 394x193.6, with rows 64.2 tall.
- CTA row: 394x56.

At 390 the card is 326 wide and 692.9 tall. The stage padding drops to 24 px top and bottom and 14 px left and right (L1544-1546).

#### Overlapping progress card (L563-606, page.tsx L284-293)

```css
.m-stat-float { position: absolute; left: 4px; bottom: 74px; width: 262px; background: #fff; border-radius: 18px; padding: 16px 18px; box-shadow: 0 10px 34px rgba(11,11,12,0.16); }
.m-stat-float strong { display: block; font-size: 13px; font-weight: 600; }
.m-stat-meter { height: 8px; border-radius: 999px; background: var(--surface-strong); overflow: hidden; margin: 11px 0 9px; }
.m-stat-meter span { display: block; height: 100%; border-radius: 999px; background: var(--preserve); }   /* SWAP; width inline 66% */
.m-stat-float p { font-size: 12px; color: var(--ink-muted); display: flex; justify-content: space-between; gap: 10px; }
.m-stat-float p b { color: var(--ink); font-weight: 600; }
```

Overlap geometry at 1440:

- The float is 262x98.7 at x=613.1, y=1341.7, so it spans x 613 to 875.
- The card starts at x=737.6, so the float covers the left 137.5 px of the card. Vertically it covers y 1341.7 to 1440.4, which hides the left end of the third grant row and of the CTA row (the round CTA icon and the first words).
- It paints above the card because it is positioned and comes later in the DOM. There is no z-index.

The overlap only happens because the 1.22fr column is narrow:

- At 1024 the stage is 976 wide. The float sits at x 28 to 290 and the card starts at 297, so they no longer touch.
- To keep the overlap at every desktop width, anchor the float to the card wrapper, not to the stage.

At 767 and below (L1547-1553) the float becomes `position: static`, full width, `margin-top: 16px`, `box-shadow: none` and `border: 1px solid var(--border)`, stacked under the card.

#### Floating provider bubbles (L608-630, page.tsx L294-297)

```css
.m-bubbles { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 12px; }
.m-bubble { width: 58px; height: 58px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.65); background: rgba(255,255,255,0.82);
  display: grid; place-items: center; font-size: 12px; font-weight: 600; color: var(--ink-secondary); box-shadow: 0 6px 18px rgba(11,11,12,0.1); }
```

- Two bubbles with a provider name as text, `aria-hidden`.
- Rendered at x=1222, from y=1073.4 to y=1201.4, centered on the stage's vertical middle and 54 px right of the card.
- The bubble fill renders about `#ecf2fb`. The reference template used avatar photos here. Sleeve should use real token icons.
- Hidden at 767 and below (L1554-1556).

### 3.4 Provider strip (L632-669, page.tsx L301-319)

```
div.m-stack-strip        width 100%, margin-top 56, flex, center, space-between, gap 26, wrap, border-top 1px #e7e9ee, padding-top 30, text-align left
  p                      14 px ink-muted (52 chars)
  div                    flex, center, gap 22, wrap, 15/500
    span x3              inline-flex, center, gap 10: 34 px provider mark + name
    i x2                 separators, 1x20 px, #e7e9ee
```

- Rendered at 1440: 1152x65. The caption is on the left. The three marks sit at x=944, 1075.3 and 1214.4, right-aligned.
- At 390 it wraps into two rows (112.7 tall): the caption first, then the marks.
- In this strip the Stripe letter inherits 15 px and renders `#2554cc` on `#eaf0fe`.

---

## 4. Four-step list (`page.tsx` L144-209, L322-345, CSS L729-842)

### 4.1 Layout at 1440

```
[ * eyebrow ]                                                         y1739
Split heading: h2 2 lines (47 chars)        | lead 17 px, 210 chars    y1807
+------------------------------------------------------------------------------+ y1978
| panel #f4f5f7, radius 24, padding 28                                         |
|  [01] Step title 21 px                     | +--------------------------+  |
|       description 14 px                    | | gradient art 478x420     |  |
|  +--------------------------------------+  | |                          |  |
|  |[02] ACTIVE: black row, white text    |  | | +----------------------+ |  |
|  +--------------------------------------+  | | | glass stat: 54 px    | |  |
|  [03] ...                                  | | | label 15 / note      | |  |
|  [04] ...                                  | | +----------------------+ |  |
|                                            | +--------------------------+  |
+------------------------------------------------------------------------------+
```

### 4.2 DOM and values

```
section#solutions.m-container.m-section
  span.m-eyebrow
  div.m-section-heading > div > h2 (with a <br> after the first clause) + p
  div.m-solutions-panel                 #f4f5f7, radius 24, padding 28, grid 1fr / 0.82fr, gap 34, align-items center  L731-739
    div.m-step-list [aria-label]        flex column, gap 4  L741-745
      button.m-step x4 [type=button, aria-pressed, aria-controls="solutions-art"]
                                        flex, align flex-start, gap 18, width 100%, left aligned, padding 18 20, no border, radius 18,
                                        transparent, ink; transition background 180ms ease, color 180ms ease  L747-759
        span.m-step-number              48x48, radius 14, #fff, ink-secondary, grid center, IBM Plex Mono 14 px, text "01".."04"  L770-781
        span
          strong                        block, 21/500/-0.014em  L783-788
          small                         block, 14 px, margin-top 5, ink-secondary  L790-795
    div#solutions-art.m-solutions-art.m-art-cool [aria-live=polite]
                                        relative, min-height 420, radius 20, overflow hidden, flex, align-items flex-end, padding 22  L801-809
      div.m-glass-stat                  width 100%, radius 16, padding 26 24, text-align center, rgba(255,255,255,0.26) fill,
                                        1px rgba(255,255,255,0.4) border, backdrop-filter blur(14px), white text  L811-820
        strong                          block, 54/1/-0.03em/600, text-shadow 0 2px 14px rgba(11,11,12,0.2)  L822-829
        span                            block, margin-top 10, 15 px  L831-835
        span.m-glass-note               declared 12 px, margin-top 6, rgba(255,255,255,0.78); renders 15 px and 10 px (defect 2)  L837-842
```

States:

- Hover on an inactive row: `rgba(255,255,255,0.6)` (L761-763).
- Active row: `background: var(--brand)` and `color: #fff` (L765-768). Its description turns `rgba(255,255,255,0.72)` (L797-799).
- The number tile stays white with ink-secondary text in both states.
- Default active index is 1, the second row (`useState(1)`, page.tsx L176).

Content per step (page.tsx L144-173): title (23 to 30 chars), description (66 to 85 chars), and for the art a big stat (1 character), a stat label (39 to 46 chars) and a note (39 to 59 chars). Clicking a row swaps the three art strings instantly. There is no transition on the art.

Rendered at 1440:

- Panel: 1152x514. Step list: 583.5 wide.
- Rows are 116.9 tall when the description wraps to 2 lines and 95.2 when it fits on 1.
- Art: 478.5x420 at x=789.5, vertically centered in the panel. Glass stat: 434.5x197.8.
- Glass background behind the text renders from `#cbdcf6` to `#8eabe7`. White text there reaches only 1.39 to 2.30 to 1 (section 13).

Responsive:

- 1100 and below: one column, with the steps on top and the art full width (920 at 1024) (L1462-1465).
- 767 and below: panel padding 18, rows padding 14 with gap 13, number tile 40x40, title 17 px, glass number 40 px (L1526-1543, L1557-1559).

---

## 5. Three-card grid with one saturated card (`page.tsx` L347-441, CSS L844-1053)

### 5.1 Layout at 1440

```
                         [ * eyebrow ]                                  y2604
            Centered h2, 35 chars, 2 lines in 780 px                    y2666
                 lead, 81 chars, 17 px                                  
+--------------------+  +--------------------+  +--------------------+  y2880
| grey card          |  | SATURATED gradient |  | grey card          |
| icon (accent)      |  | icon (white)       |  | icon (accent)      |
| h3 22 px           |  | h3 22 px white     |  | h3 22 px           |
| body 14 px         |  | body 82% white     |  | body 14 px         |
| +----------------+ |  | +----------------+ |  | +----------------+ |
| | white inner    | |  | | glass panel    | |  | | white inner    | |
| | form mock      | |  | | (empty)        | |  | | receipt mock   | |
| +----------------+ |  | +----------------+ |  | +----------------+ |
+--------------------+  +--------------------+  +--------------------+  y3456
```

### 5.2 DOM and values

```
section#why.m-container.m-section
  div.m-centered-heading > span.m-eyebrow + h2 + p
  div.m-three-up                        grid repeat(3, minmax(0, 1fr)), gap 22  L846-850
    article.m-why-card                  #f4f5f7, radius 24, padding 30 26, flex column, gap 10  L852-859
      span.m-why-icon                   40x40, grid center, radius 12 (no fill), accent glyph 20 px, margin-bottom 10  L866-875   SWAP
      h3                                22/500/-0.018em, leading inherits 1.55 = 34.1 px  L881-885
      p                                 14 px ink-secondary  L887-890
      div.m-why-inner                   margin-top 18, #fff, radius 18, padding 20, flex 1  L896-902
        (card 1: form mock)
        h4                              15/600, margin-bottom 14  L904-908
        div.m-field x2                  #f4f5f7, radius 13, padding 12 14, margin-bottom 10  L910-915
          span                          block, 11 px ink-muted (label)  L917-921
          div.m-field-row               flex, center, between, gap 12, margin-top 4  L923-929
            strong                      18/600/-0.02em  L931-935
            span.m-field-tag            inline-flex, center, gap 7, #fff, 1px #e7e9ee, pill, padding 5 11, 12 px, nowrap  L937-947
              span.m-provider           22x22, radius 7, svg 12x12  L949-958
        div.m-why-meta                  flex, between, gap 12, 12 px ink-muted, padding 6 2 14  L960-967
        span.m-inner-button             flex center, min-height 46, padding 0 14, pill, #f4f5f7, 13/500 (a span, not a control)  L969-980
    article.m-why-card.is-featured      linear-gradient(158deg, #6d9bf2 0%, #3b71f0 60%, #2554cc 100%), white  L861-864   SWAP
      span.m-why-icon                   white glyph  L877-879
      h3, p                             p is rgba(255,255,255,0.82)  L892-894
      div.m-why-art [aria-hidden]       margin-top 18, flex 1, min-height 240, radius 18,
                                        radial-gradient(90% 70% at 20% 18%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 60%),
                                        linear-gradient(160deg, rgba(255,255,255,0.26) 0%, rgba(20,60,150,0.3) 100%),
                                        border 1px rgba(255,255,255,0.3)  L982-991   SWAP (the 20,60,150 tint)
    article.m-why-card                  (card 3: receipt mock)
      div.m-why-inner
        div.m-receipt-success           flex column, center, gap 5  L993-999
          span.m-success-circle         54x54 circle, --success #17a673, white glyph 24 px, margin-bottom 8  L1001-1011
          strong                        16/600  L1013-1016
          p                             13 px ink-secondary  L1018-1021
        div.m-receipt-lines             width 100%, margin-top 16, border-top 1px #e7e9ee, padding-top 12  L1023-1028
          span                          block, 11 px ink-muted, margin-bottom 8 (section label)  L1030-1035
          div x3                        flex, between, gap 14, 13 px, padding 6 0  L1037-1044
            span + strong               value 600, nowrap; third value uses .m-preserve-text (--preserve)  L1046-1053   SWAP
```

Rendered at 1440:

- Each card is 369.3x575.4. The featured card is the middle one, at x=535.3.
- The inner panels are 317.3x339.9 and the glass art 317.3x284.2. `flex: 1` stretches every inner panel to the card bottom, so all three end level.
- The featured h3 (35 chars) wraps to 2 lines at the loose 34.1 px leading.
- Gradient pixels behind the featured title and body run from `#6191f1` to `#4378f1`. That gives white 3.04 to 4.04 to 1 and the 82 percent white body 2.54 to 3.25 to 1 (section 13).

Responsive:

- 1100 and below: one column, with the featured card second (L1466-1469). At 1024 the cards are 976 wide and 553.7 and 453.8 tall.
- At 390 the cards are 354 wide.

Text budgets: heading 35 chars; lead 81; card titles 17 to 35; card bodies 73 to 126.

---

## 6. Two platform cards with device mocks (`page.tsx` L443-574, CSS L1055-1233)

### 6.1 Layout at 1440

```
[ * eyebrow ]
Split heading: h2 2 lines (39 chars)          | lead 17 px, 152 chars
+------------------------------------+  +------------------------------------+  y3802
| grey card, padding 34 34 0         |  | grey card                          |
| (o) 52 px white icon circle        |  | (o)                                |
| h3 30 px                           |  | h3 30 px                           |
| body 15 px, max 46ch               |  | body 15 px                         |
|        +--------------------+      |  |        +--------------------+      |
|        | device 330 wide    |   +--+  |        | device             |   +--+
|        | status / h4        |   |ch|  |        | rows with badges   |   |ch|
|        | 30 px figure, bar  |   +--+  |        |                    |   +--+
|        | legend rows        |      |  |        +--------------------+      |
+--------+--------------------+------+  +------------------------------------+  y4355
          device bleeds off the card bottom          (this one stops 30 px short, defect 6)
```

### 6.2 DOM and values

```
section#features.m-container.m-section
  span.m-eyebrow
  div.m-section-heading > div > h2 (with <br>) + p
  div.m-feature-grid                    grid repeat(2, minmax(0, 1fr)), gap 22  L1057-1061
    article.m-feature x2                #f4f5f7, radius 24, padding 34 34 0, flex column, overflow hidden  L1063-1070
      span.m-feature-icon               52x52 circle, #fff, accent glyph 21 px, grid center, margin-bottom 26  L1072-1082   SWAP
      h3                                30/500/-0.024em/1.15  L1084-1089
      p                                 margin-top 12, 15 px ink-secondary, max-width 46ch  L1091-1096
      div.m-device                      margin 34 auto 0, width 100%, max-width 330, #fff, radius 22 22 0 0,
                                        shadow 0 -2px 30px rgba(11,11,12,0.07), padding 14 16 0, relative  L1098-1107
        div.m-device-status             flex, between, gap 12, 11/600 ink-secondary, padding-bottom 12  L1109-1117
        h4                              center, 14/600, padding-bottom 14  L1119-1124
        (device 1)
        p.m-device-figure               30/600/-0.03em  L1126-1130
        p                               12 px ink-muted, margin-bottom 14  L1132-1136
        div.m-device-bar                12 tall, pill, #ebedf1, overflow hidden, flex, margin-bottom 14  L1138-1145
          i x3                          inline width and color: 48% #3B71F0 (SWAP), 26% #0B0B0C, 12% #8A909C  page.tsx L483-487
        div.m-device-legend > div x3    flex, center, gap 9, 12 px ink-secondary, padding 8 0, border-top 1px #e7e9ee  L1152-1160
          em                            7x7 dot, same colors as the bar (first is SWAP)  L1162-1167, page.tsx L490-502
          span + span                   label, then value pushed right in ink-muted  L1169-1172
        (device 2)
        div.m-device-rows > div x3      flex, center, gap 10, padding 11 0, border-top 1px, 12 px  L1174-1181
          span.m-provider (34) + div > strong (500) + small (block, 11 px ink-muted, margin-top 2) + span.m-badge  L1183-1193
        div.m-chip-float                absolute, right -18, bottom 46, flex, center, gap 11, #fff, radius 16, padding 12 15,
                                        shadow 0 8px 26px rgba(11,11,12,0.14)  L1195-1206
          span.m-chip-bars              intended: flex, align flex-end, gap 3, 26 tall, three 6 px bars, radius 2, accent,
                                        heights inline 40/75/100% or 100/55/30%  L1208-1219, page.tsx L506-510, L561-565  (defect 3)
          span > span (11 px ink-muted label) + strong (20/600/-0.02em ink value)  L1221-1233
```

Rendered at 1440:

- Each card is 565x552.9. The icon sits at the top left. The h3 is at y=3914.4.
- The device is 330 wide, centered in the 497 px content box (x=261.5 in card 1).
- Device 1 shows 290.6 px and meets the card bottom edge, so it looks like a phone rising out of the card.
- Device 2 is 260.7 tall and ends 30 px above the card bottom with square bottom corners.
- The chip floats are 83x72 and 112.2x72, overhanging the device's right edge by 18 px and covering the end of the legend values.

Responsive:

- 1100 and below: one column (L1470-1472). The cards are 976 wide at 1024.
- 767 and below: card padding becomes 18 on all sides (L1526-1529), so the device no longer bleeds off the bottom edge. The h3 drops to 24 px.
- 767 and below: the chip float moves to right -6, bottom 20 with padding 9 12 (L1560-1564). At 390 it covers the third badge and two legend values.

---

## 7. Provider cards (`page.tsx` L576-627, CSS L1235-1279)

```
section#integrations.m-integrations     full-bleed section, padding 104 0 8 (64 top at 767)  L1237-1239
  div.m-container
    div.m-centered-heading > span.m-eyebrow + h2 (67 chars, 2 lines) + p (127 chars)
    div.m-integration-cards             grid repeat(3, minmax(0, 1fr)), gap 22, margin-bottom 36  L1241-1246
      article x3                        #f4f5f7, radius 24, padding 28, flex column, gap 9, align flex-start  L1248-1256
        span.m-provider                 34 px mark (but see defect 4)
        h3                              21/500, margin-top 14 (leading 32.55)  L1258-1262
        span                            type label, 12/600, --accent  L1264-1268   SWAP
        p                               14 px ink-secondary (99 to 113 chars)  L1270-1273
    a.m-button.m-button-secondary       display flex, margin 0 auto, width fit-content  L1275-1279
```

- Rendered at 1440: the cards are 369.3x247.2 at y=4770.1. The button is 227.1x48, centered at y=5053.3.
- 1100 and below: one column (L1466-1469). At 390 the cards are 354 wide, three stacked, 785.6 tall in all.

---

## 8. FAQ accordion (`page.tsx` L211-228, L629-656, CSS L1281-1348)

```
section.m-container.m-section.m-faq     grid 0.85fr / 1.15fr, gap 56, align-items start  L1283-1288
  div                                   flex column, align flex-start, gap 20  L1290-1295
    span.m-eyebrow
    h2                                  46/1.08/-0.03em/500, a <br> between two short sentences  L1297-1302
    p                                   16 px ink-secondary (69 chars)  L1304-1307
  div
    details x4                          #f4f5f7, radius 18, padding 20 24, margin-bottom 12  L1309-1314
      summary                           flex, center, between, gap 18, pointer, list-style none, 17/500, min-height 34  L1316-1326
        text (questions run 42 to 51 chars)
        span [aria-hidden] "+"          ink-muted, 22 px, line-height 1, no shrink  L1332-1337
      p                                 margin-top 12, 14/1.65 ink-secondary (answers run 186 to 281 chars)  L1343-1348
```

- The WebKit marker is hidden (L1328-1330).
- Open state: `details[open] summary span { transform: rotate(45deg) }` turns the plus into a close mark (L1339-1341). It is instant, with no transition, and the panel opens natively with no height animation.
- Rendered at 1440: left column 465.8, right 630.2. Each closed item is 630.2x74 with a 12 px gap.
- 1100 and below: one column (L1462-1465), but the h2 stays 46 px.
- 767 and below: h2 32 px, gap 28, item padding 16 18, question 15 px (L1520-1525, L1568-1576).

---

## 9. CTA band (`page.tsx` L658-676, CSS L1350-1390)

```
section.m-container                     (no .m-section padding)
  div.m-final                           margin-top 104, #f4f5f7, radius 24, padding 84 32, flex column, center, text center, gap 18  L1352-1362
    span.m-eyebrow
    h2                                  52/1.06/-0.032em/500, max-width 18ch (46 chars, 2 lines)  L1364-1370
    p                                   17 px ink-secondary, max-width 52ch (84 chars, 2 lines)  L1372-1376
    a.m-button                          primary, margin-top 14 (32 px below the paragraph)  L1378-1380
    a.m-final-secondary                 14 px ink-secondary, underline, underline-offset 4, min-height 44  L1382-1390
```

- Rendered at 1440: 1152x548.9. The h2 is 628.4 wide (18ch at 52 px) and the paragraph 588.7.
- 1100 and below: h2 40 px.
- 767 and below: margin-top 64, padding 52 20, h2 32 px, paragraph 15 px (L1510-1513, L1520-1525, L1492-1497). At 390 the band is 354x470.2.

---

## 10. Column footer (`layout.tsx` L5-30, L65-103, CSS L1392-1443)

```
footer.m-footer.m-container             margin-top 104, padding-top 56 (64 at 767), padding-bottom 40, border-top 1px #e7e9ee  L1394-1399
  div.m-footer-grid                     grid 1.4fr + 3 x 1fr, gap 34  L1401-1405
    div (brand)                         flex column, align start, gap 11, 14 px ink-secondary  L1407-1414
      a.m-logo > img 145x30
      p                                 two sentences split by <br> (93 chars)
    div x3 (link columns)
      h3                                13/600 ink, margin-bottom 3  L1416-1421
      a x3                              min-height 30, inline-flex, center; hover ink  L1423-1431
  div.m-footer-bottom                   flex, between, gap 20, wrap, margin-top 48, padding-top 26, border-top 1px, 13 px ink-muted  L1433-1443
    span                                copyright with the year from new Date()
    span                                tagline
```

- Column data lives in `FOOTER_COLUMNS` (`layout.tsx` L5-30): three headings with three links each. In-page anchors render as `<a>` and routes as `<Link>` (`layout.tsx` L85-95).
- Rendered at 1440: the brand column is 334.1 wide and each link column 238.6. Links are 30 tall on a 41 px pitch. The bottom bar is 47.1 tall.
- 1100 and below: 2 columns (L1476-1478).
- 767 and below: 1 column (L1565-1567). At 390 the footer is 888 tall and the bottom bar wraps into two lines.

Sleeve must add:

- The disclaimer "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc." at readable contrast. The 13 px `#8a909c` bottom bar fails AA.
- The issuer disclosure link.

---

## 11. Responsive summary

| Selector | 1101 and up | 768 to 1100 (L1447-1479) | 767 and below (L1481-1577) |
| --- | --- | --- | --- |
| `--m-gutter` | 24 | 24 | 18 |
| Header nav | visible | hidden, no replacement | hidden |
| Header actions | visible | visible | visible, page widens to 450 |
| `.m-hero` padding-top | 84 | 84 | 52 |
| Hero h1 | 76 | 58 | 40, -0.03em |
| Leads (hero, section, centered, CTA) | 17 | 17 | 15 |
| `.m-actions` | row, centered | row | column, children 100% |
| `.m-hero-panels` | 0.78fr / 1.22fr | 1 column | 1 column |
| `.m-panel-art` min-height | 520 | 380 | 380 |
| `.m-app-stage` padding | 44 30 | 44 30 | 24 14 |
| `.m-stat-float` | absolute, left 4, bottom 74 | same | static, full width, border, no shadow |
| `.m-bubbles` | shown | shown | hidden |
| `.m-section`, `.m-integrations`, `.m-footer` padding-top | 104 | 104 | 64 |
| `.m-section-heading` | 2 columns | 2 columns | 1 column, align start, gap 18, margin-bottom 34 |
| Section, centered and CTA h2 | 52 | 40 | 32 |
| FAQ h2 | 46 | 46 | 32 |
| `.m-solutions-panel` | 1fr / 0.82fr, padding 28 | 1 column | 1 column, padding 18 |
| `.m-step` | padding 18 20, gap 18, number 48, title 21 | same | padding 14, gap 13, number 40, title 17 |
| Glass stat number | 54 | 54 | 40 |
| `.m-three-up`, `.m-integration-cards` | 3 columns | 1 column | 1 column |
| `.m-feature-grid` | 2 columns | 1 column | 1 column |
| `.m-feature` padding | 34 34 0 | 34 34 0 | 18 |
| Feature h3 | 30 | 30 | 24 |
| `.m-chip-float` | right -18, bottom 46, padding 12 15 | same | right -6, bottom 20, padding 9 12 |
| `.m-faq` | 0.85fr / 1.15fr, gap 56 | 1 column | 1 column, gap 28, item padding 16 18, question 15 |
| `.m-final` | margin-top 104, padding 84 32 | same | margin-top 64, padding 52 20 |
| `.m-footer-grid` | 1.4fr + 3 x 1fr | 2 columns | 1 column |

Page heights: 6661 px at 1440, 9650 px at 1024, and 10522 px at 390 (captured 450 wide because of the header overflow).

---

## 12. Motion and interaction

Closeout ships no entrance animation, no scroll animation, no keyframes and no `prefers-reduced-motion` block. A grep of `marketing.css` finds two `transition` declarations and no `@keyframes`. All motion is state change.

| What | Trigger | Value | Line |
| --- | --- | --- | --- |
| Pill buttons | hover | background, border-color and color over 140ms ease. Primary goes to `#000`. Secondary goes to `#f4f5f7` with a `#8a909c` border | L108-125 |
| Step rows | hover, click | background and color over 180ms ease. Hover is `rgba(255,255,255,0.6)`, active is black with white text | L758-768 |
| Step art | click | stat, label and note swap instantly. `aria-live="polite"` announces the change | page.tsx L200-205 |
| FAQ | click or Enter on summary | native details toggle. The plus rotates 45 degrees with no transition | L1339-1341 |
| Nav, login, footer links | hover | color to ink, instant | L69-71, L89-91, L1429-1431 |
| Header | scroll | sticky, translucent, blurred. No other change | L28-35 |
| Focus | keyboard | `:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(59,113,240,0.25); border-radius: 6px }`. Pills keep their 999 px radius because `marketing.css` loads later | `globals.css` L78-82 |

Sections with no motion at all: the hero (badge, headline, panels, cards, bubbles and strip are static), the three-card grid, the platform cards, the provider cards and the CTA band. The footer has only the link hover color.

Keyboard order at 1440: logo, four nav links, login, header CTA, hero primary, hero secondary. That much was measured by pressing Tab. The rest follows DOM order: the four step buttons, the provider section's button, the four FAQ summaries, the CTA band's two links and the footer links. Step rows are real `<button>`s with `aria-pressed`. There is no skip link.

Guidance for Sleeve:

- The owner wants more richness, but closeout's restraint is part of its look.
- If you add motion, make it one orchestrated hero moment, such as the payment notification resolving into the two balances (PRD section 15), plus state-change motion on the step list.
- Gate all of it behind `prefers-reduced-motion: no-preference` and animate only transform and opacity.

---

## 13. Accessibility audit of closeout (measured)

Contrast ratios are WCAG 2. Text under 24 px regular or 18.66 px bold needs 4.5 to 1. Icons, focus rings and control boundaries need 3 to 1.

| Pair | Ratio | Where closeout uses it | Verdict |
| --- | --- | --- | --- |
| `#0b0b0c` on white | 19.67 | headings | pass |
| `#5b6270` on white | 6.13 | body, nav | pass |
| `#5b6270` on `#f4f5f7` | 5.62 | card bodies | pass |
| `#8a909c` on white | 3.21 | float card captions (12), app head subline (12), grant sublines (11), CTA subline (12), stat float caption (12), strip caption (14), why meta row (12), receipt section label (11), device captions, legend values and row sublines (11 to 12), chip labels (11), footer bottom bar (13) | fail |
| `#8a909c` on `#f4f5f7` | 2.94 | readout unit in the app panel (13), field labels (11) | fail |
| `#8a909c` on `#f4f5f7`, as an icon | 2.94 | FAQ plus sign (22 px), the only open or closed cue | fail (needs 3 to 1) |
| `#3b71f0` on white | 4.37 | "preserved" value text (13/600), eyebrow asterisk (14/600) | fail for text |
| `#3b71f0` on `#f4f5f7` | 4.01 | provider type labels (12/600), why icons | fail for text, pass for icons |
| `#3b71f0` on `#eaf0fe` | 3.83 | keep and review badges (11/600), keep icon tile | fail |
| `#d93b3b` on `#fdecec` | 3.96 | close and high badges (11/600) | fail |
| White on `#101114` | 18.88 | primary buttons, active step | pass |
| `rgba(255,255,255,0.72)` on `#101114` | 9.95 | active step description | pass |
| White on `#17a673` | 3.12 | success check glyph | pass as an icon only |
| White on the featured gradient behind the text (`#6191f1` to `#4378f1`, sampled) | 3.04 to 4.04 | featured card h3 (22/500) and icon | fail for text |
| 82% white on the same | 2.54 to 3.25 | featured card body (14) | fail |
| White on the glass stat (`#cbdcf6` to `#8eabe7`, sampled) | 1.39 to 2.30 | glass stat number and label (54 and 15) | fail |
| 78% white on the same | 1.30 to 1.96 | glass stat note | fail |
| Focus ring `#cedcfb` (25% blue over white) vs white | 1.38 | every focusable element | fail (needs 3 to 1) |

Other findings:

- Below 1101 px the nav links disappear with no menu. Below 450 px the header causes horizontal scroll. At 320 px the hero eyebrow overflows (it is `nowrap`).
- Provider marks are `span`s with `aria-label` and no role, so screen readers may skip them. Use `role="img"` with a label, or visible text.
- `.m-inner-button` looks like a button and does nothing.
- Footer links are 30 px tall. That passes the 24 px AA target minimum, but 44 px is safer on touch.
- The bubbles carry text inside an `aria-hidden` group. That is fine for decoration, but Sleeve's token bubbles should keep the token names elsewhere in readable text.

Sleeve needs AA everywhere. Section 15.6 turns these failures into constraints for the green scale.

---

## 14. Closeout defects not to copy

| # | Defect | Cause | What renders | Do instead |
| --- | --- | --- | --- | --- |
| 1 | Bell glyph sits in the top left of its circle, at 12 px muted | `.m-app-head span` (L361-365, specificity 0,1,1) beats `.m-app-bell` (L367-376, 0,1,0) on display, font-size and color | `display: block`, so `place-items` does nothing | Scope the subline selector to the text span, or raise the bell's specificity. Center a real icon |
| 2 | Glass note renders 15 px with a 10 px margin instead of 12 px and 6 px | `.m-glass-stat span` (L831-835) beats `.m-glass-note` (L837-842) | Note as big as the label | Give the label its own class. Keep the note at 13 px or more for contrast |
| 3 | Chip float bar icon is invisible | `.m-chip-float span` (L1221-1225) sets `display: block` on `.m-chip-bars` (L1208-1213), so the inline `i` bars get no width | Rendered width 0 | Use a `div`, or `display: flex` with higher specificity. The reference template shows three blue bars here |
| 4 | Provider marks in the provider cards turn accent blue at 12/600, so GitHub's mark is blue and the Stripe letter loses its strong blue | `.m-integration-cards article > span` (L1264-1268) also matches the mark `span` | Wrong mark colors | Target the type label with a class |
| 5 | Rail labels do not line up: one starts at 66 px, the other at 82 px | The closing line is 46 px with a cap and the preserved line is 62 px, each with a 20 px gap (L436-463) | 16 px misalignment | Fix the line box width and draw the cap inside it |
| 6 | Second device ends 30 px above the card bottom with square bottom corners | Device height follows content (L1098-1107). Only the tallest device meets the bottom edge | Uneven bleed | Push devices to the bottom (`margin-top: auto`) or fix the visible height |
| 7 | Why icons have a 12 px radius and a 40 px box but no fill, while feature icons sit in white circles | L866-875 vs L1072-1082 | Inconsistent icon treatment | Pick one icon tile style |
| 8 | Loose 1.55 leading on 22 px and 21 px titles and on the 30 px figure | No `line-height` on those rules | Two-line titles look gappy | Set 1.15 to 1.25 on display sizes |
| 9 | No mobile navigation. Header overflows below 450 px. Eyebrow overflows at 320 | L1473-1475 hides the nav. Actions never shrink. Eyebrow is `nowrap` | Horizontal scroll on every phone | Menu button and sheet below 1101, compact actions below 480, eyebrow allowed to wrap or truncate |
| 10 | Empty left hero panel and empty featured-card art | Photography in the source template was replaced by plain gradients (marketing.css L1-7) | Large blank areas | Fill with product visuals: real components fed by the data layer, and token icons |
| 11 | Icons are Unicode text glyphs (arrows, triple bar, play, check, bullseye, quarter circle, asterisk, chevron) | page.tsx throughout | Inconsistent rendering across fonts | Use Sleeve's icon set (`app/src/components/ui/icons.tsx`, 20 px grid, 1.5 px stroke) at the same box sizes |
| 12 | Focus ring is nearly invisible | 25% alpha blue box shadow (`globals.css` L80) | 1.38 to 1 on white | Solid ring of at least 3 to 1, 2 px, with offset |
| 13 | Muted captions fail AA | `--ink-muted` `#8a909c` at 11 to 14 px | 2.94 to 3.21 to 1 | Use ink-secondary for anything people must read, or darken muted to at least 4.5 to 1 on both white and `#f4f5f7` |
| 14 | `-webkit-backdrop-filter` missing | L33, L818 | No blur in Safari before 18 | Add the prefix |

---

## 15. Blue map: every place closeout uses blue

### 15.1 Token definitions

| File and line | Token | Value | HSL | On white |
| --- | --- | --- | --- | --- |
| `globals.css` L19, `tailwind.config.ts` L47 | `--accent` / `accent` | `#3b71f0` | 222, 86%, 59% | 4.37 |
| `globals.css` L20, `tailwind.config.ts` L48 | `--accent-strong` | `#2554cc` | 223, 69%, 47% | 6.52 |
| `globals.css` L21, `tailwind.config.ts` L49 | `--accent-soft` | `#eaf0fe` | 222, 91%, 96% | 1.14 |
| `globals.css` L24, `tailwind.config.ts` L37 | `--preserve` | `#3b71f0` | same as accent | 4.37 |
| `globals.css` L25, `tailwind.config.ts` L38 | `--preserve-soft` | `#eaf0fe` | same as accent-soft | 1.14 |
| `globals.css` L32, `tailwind.config.ts` L45 | `--info` | `#3b71f0` | same as accent | 4.37 |
| `globals.css` L33, `tailwind.config.ts` L46 | `--info-soft` | `#eaf0fe` | same as accent-soft | 1.14 |
| `globals.css` L80, `tailwind.config.ts` L91 | focus ring | `rgba(59,113,240,0.25)`, composites to `#cedcfb` | 221, 85%, 90% | 1.38 |
| `tailwind.config.ts` L106 | `bg-hero-panel`, unused | `linear-gradient(155deg, #C9DCF7 0%, #9FBFEE 55%, #8FB4E9 100%)` | 215 to 216 | |
| `tailwind.config.ts` L108 | `bg-accent-deep`, unused | `linear-gradient(155deg, #4C7EF3 0%, #2554CC 100%)` | 222 to 223 | |

Closeout uses one blue for three roles: accent (brand highlight), preserve (the kept or positive state) and info.

### 15.2 Landing uses

| File and line | Selector or element | Blue | Role and size | Sits on | Closeout ratio | Green must reach |
| --- | --- | --- | --- | --- | --- | --- |
| marketing.css L150-153 | `.m-eyebrow .m-small-mark`, the asterisk in all 7 eyebrow pills | `--accent` | glyph, 14/600 | white pill | 4.37 | 3 to 1 if treated as an icon, 4.5 to 1 if text |
| L255-260 | `.m-art-cool`, the hero stage (page.tsx L282) and the step art (page.tsx L200) | `rgba(37,84,204,0.45)` radial and `#c9dcf7`, `#9fbfee`, `#85aae6` linear | gradient field | itself | white text on it: 1.39 to 2.30 | 4.5 to 1 behind any white text, so every stop behind text needs luminance of 0.183 or less, or switch the text to ink |
| L294-297 | `.m-float-keep`, hero card 2 icon tile (page.tsx L270) | `--preserve` on `--preserve-soft` | glyph 17/600 | soft tint | 3.83 | 3 to 1 (icon) |
| L461-463 | `.m-rail-preserved .m-rail-line` (page.tsx L69-72) | `--preserve` | 62x3 line | `#f4f5f7` | 4.01 | 3 to 1 |
| L588-593 | `.m-stat-meter span`, coverage meter fill (page.tsx L287) | `--preserve` | 8 px bar | `#ebedf1` track | 3.73 vs track | 3 to 1 vs track |
| L689-694 | `.m-provider-stripe`, the letter mark in the strip (page.tsx L305), Northstar row (L552) and provider card (L616) | `--accent-strong` on `--accent-soft` | letter 15 to 18 px, 700 | soft tint | 5.71 | Sleeve shows real token logos instead, so only the tile tint carries over |
| L724-727 | `.m-badge.m-keep`, the keep badge (page.tsx L126) and review badge (L557) | `--preserve` on `--preserve-soft` | text 11/600 | soft tint | 3.83 | 4.5 to 1 |
| L861-864 | `.m-why-card.is-featured` (page.tsx L397) | `linear-gradient(158deg, #6d9bf2 0%, #3b71f0 60%, #2554cc 100%)` | saturated card behind white h3, body and icon | itself | 2.76 at the top stop, 3.04 to 4.04 behind the text | 4.5 to 1 behind body text at every stop |
| L866-875 | `.m-why-icon` (page.tsx L362, L410) | `--accent` | glyph 20 px | `#f4f5f7` | 4.01 | 3 to 1 |
| L982-991 | `.m-why-art` inside the featured card (page.tsx L406) | `rgba(20,60,150,0.3)` end stop | glass tint | featured gradient | | Tint only; derive from the green |
| L1051-1053 | `.m-preserve-text`, the third receipt value (page.tsx L435) | `--preserve` | text 13/600 | white | 4.37 | 4.5 to 1 |
| L1072-1082 | `.m-feature-icon` (page.tsx L467, L520) | `--accent` | glyph 21 px | white circle | 4.37 | 3 to 1 |
| L1215-1219 | `.m-chip-bars i` (page.tsx L506-510, L561-565) | `--accent` | 6 px bars (invisible, defect 3) | white | 4.37 | 3 to 1 |
| L1264-1268 | `.m-integration-cards article > span`, the type labels (page.tsx L618) and, by accident, the marks (L616) | `--accent` | text 12/600 | `#f4f5f7` | 4.01 | 4.5 to 1 on `#f4f5f7` |
| page.tsx L484 | device bar segment 1, inline style | `#3B71F0` | 12 px segment | `#ebedf1` track, next to a `#0B0B0C` segment | | 3 to 1 vs the track; distinct from black |
| page.tsx L490 | legend dot 1, inline style | `#3B71F0` | 7 px dot | white | 4.37 | 3 to 1 |
| `globals.css` L80 | `:focus-visible` ring | `rgba(59,113,240,0.25)` | 3 px ring | white | 1.38 | 3 to 1 (use a solid green ring) |

Not theme blue, so no swap:

- The Slack mark's `#36c5f0` stroke (page.tsx L19) is that brand's logo color. Sleeve does not show Slack.
- The closeout logo's `#7182DD` stroke (`public/brand/brand/svg/closeout-lockup-horizontal.svg`) belongs to closeout's mark. Sleeve uses its own wordmark.

### 15.3 Gradients, in full

| Name | Value | Line | Used on |
| --- | --- | --- | --- |
| Cool field | `radial-gradient(120% 90% at 18% 12%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 60%), radial-gradient(90% 70% at 88% 82%, rgba(37,84,204,0.45) 0%, rgba(37,84,204,0) 65%), linear-gradient(158deg, #c9dcf7 0%, #9fbfee 55%, #85aae6 100%)` | L255-260 | Hero stage, step art |
| Neutral field | `radial-gradient(110% 80% at 82% 10%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 62%), linear-gradient(160deg, #eef1f6 0%, #dfe4ec 100%)` | L262-266 | Hero left panel |
| Saturated card | `linear-gradient(158deg, #6d9bf2 0%, #3b71f0 60%, #2554cc 100%)` | L861-864 | Featured why card |
| Glass inset | `radial-gradient(90% 70% at 20% 18%, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0) 60%), linear-gradient(160deg, rgba(255,255,255,0.26) 0%, rgba(20,60,150,0.3) 100%)` with a `1px rgba(255,255,255,0.3)` border | L982-991 | Inside the featured card |
| Glass stat | `rgba(255,255,255,0.26)` fill, `1px rgba(255,255,255,0.4)` border, `backdrop-filter: blur(14px)` | L811-820 | Over the cool field |

To recreate the cool field in green, keep the structure: a white highlight radial at the top left, a dark-accent radial at 45 percent at the bottom right, and a three-stop 158-degree linear from a pale tint to a mid tone. Then check the pixels behind any text, not just the stops.

### 15.4 Product UI uses (for the product blueprint)

| File and line | Use |
| --- | --- |
| `product.css` L502-504 | `.tone-preserve { color: var(--preserve) }` |
| `product.css` L518-520 | `.bg-tone-preserve { background: var(--preserve) }` |
| `product.css` L630 | `.dash-chart-area { fill: rgba(59,113,240,0.14) }` |
| `product.css` L635, L643 | chart line and dot stroke `var(--preserve)` |
| `product.css` L1027 | `.product-shell :is(button, a, input, select, textarea):focus-visible { outline: 2px solid var(--accent) }` |
| `product.css` L1083 | `.closeout-preserve-note { background: var(--preserve-soft) }` |
| `_components/StateTag.tsx` L3, L13, L14, L16 | keep, running, verifying and restored tags: `bg-preserve-soft text-preserve` |
| `_components/StateTag.tsx` L11, L12 | planned and scheduled tags: `bg-info-soft text-info` |
| `_components/RelationshipStrip.tsx` L37 | preserved rail `var(--preserve)` |
| `_components/StatTile.tsx` L18 | preserve tone `text-preserve` |
| `_components/ProviderTile.tsx` L17 | Slack tile `bg-preserve-soft text-preserve` |
| `_components/ReceiptRow.tsx` L11 | preserve dot `bg-preserve` |
| `_components/StepperPanel.tsx` L25 | preserve step `bg-preserve text-surface` |
| `(product)/open-access/page.tsx` L195 | low-level bar `bg-info` |
| `(product)/directory/[id]/page.tsx` L74 | `text-preserve` |
| `(product)/closeouts/[id]/plan/PlanPreviewClient.tsx` L21, L163, L208, L209 | `bg-preserve-soft/30`, `border-preserve/30 bg-preserve-soft/60`, `border-preserve bg-preserve-soft`, `text-preserve` |

### 15.5 Blue-tinted neutrals (optional swap)

Closeout's greys lean blue: hue 215 to 225 degrees at 8 to 31 percent saturation.

- `--surface-muted` and `--m-panel` `#f4f5f7`
- `--surface-strong` `#ebedf1`
- `--border` `#e7e9ee`
- `--border-strong` `#d4d8e0`
- `--ink-secondary` `#5b6270`
- `--ink-muted` `#8a909c`
- `--brand` `#101114`
- The neutral field stops `#eef1f6` and `#dfe4ec`

These are not "blue" in the owner's sense. Next to a green accent, though, a blue cast can read cold. The palette agent should decide whether to move them to true neutral, keep them, or tilt them slightly toward the green. Whatever it picks, ink-secondary must stay at 4.5 to 1 or more on both white and the panel grey.

### 15.6 Constraints for the green scale

- Text green on white needs relative luminance of 0.1833 or less. On the panel grey `#f4f5f7` it needs 0.1639 or less. On a soft tint around luminance 0.87 it needs about 0.154 or less.
- White text on a green fill or gradient needs every pixel behind the text at luminance 0.1833 or less. For 3 to 1 on large text the limit is 0.30.
- Icons, meter fills, rails, chart strokes, bar segments and the focus ring need 3 to 1 against what they touch, which means luminance 0.30 or less on white.
- Hue: keep the whole scale, tints included, at 150 degrees or more and out of the 60 to 90 degree band. It must stay clearly apart from `#00C805` (121 degrees) and `#CCFF00` (72 degrees). Source: `docs/research/issuer-docs.md` section 4, Colors.
- Collision to resolve: closeout's `--success` is already green, `#17a673` at hue 158 with 3.12 to 1 for white. Once preserve and accent turn green, success and accent can merge or be told apart by lightness. Decide that explicitly so a receipt's success state and a brand highlight do not become two slightly different greens.
- The device bar puts the accent next to ink `#0b0b0c` and muted grey. The green segment must stay distinct from both and from the track `#ebedf1`.

---

## 16. Sleeve slot map (recommendation)

Content comes from the PRD and the data layer (`app/src/data`). Numbers come from repo scripts (build contract rule 7). Text must follow the copy rules. Gated features never appear as live. Sleeve's own name must stay more prominent than any mention of Robinhood Chain (Terms 5.7, quoted in `docs/research/issuer-docs.md` section 4).

| Closeout slot | Sleeve content |
| --- | --- |
| Hero eyebrow pill | One short factual label, for example the network as text: "Deployed on Robinhood Chain" (an allowed phrase per issuer-docs section 4). No logo, no feather |
| Hero left panel cards | PRD section 15's winning screenshot: a payment notification, then the split result as two numbers, with the premium line and "debt security, not a share" in the card subline |
| Hero app card | The account view: payment address chip, the two sleeves (spend USDG, equity in a Stock Token), the rule split as rails, recent lots with status badges, a receipt row as the CTA. Built from the real Sleeve components and fed by the mock data layer, not drawn with divs |
| Overlapping progress card | Something already true in the data, such as how this payment was split or the pending equity waiting for the market. No yield, no performance. If a label needs the word share, use the PRD terms copy-lint allows: spend share, equity share, share of pay |
| Provider bubbles | Real token icons (USDG and the launch Stock Token), per D-021's icon sourcing rules |
| Provider strip | Token icons and names for USDG and the launch tickers. Network as text with a neutral glyph |
| Four-step list | Payment arrives, the rule splits it, the guard checks session and premium, then the buy runs or waits with a receipt. The glass stat carries a script-backed figure worded per D-020 |
| Three-card grid | Rule editor mock, the waiting-for-market state as the saturated card, receipt mock with the debt-security line |
| Two platform cards | Receipts and verify in device 1. Sleeves and holdings with token icons in device 2, each holding carrying "debt security, not a share" |
| Provider cards | The launch Stock Tokens or the trust pieces (reference price, session calendar, verifier). Company logos other than token icons risk implying partnership |
| FAQ | PRD section 10's five holder questions |
| CTA band | Passkey onboarding |
| Footer | Columns, issuer disclosure link, the Robinhood Markets disclaimer at AA contrast |

---

## 17. Sources and method

Files read in full, in `/Users/mac/closeout/apps/web/`:

- `app/(marketing)/site/page.tsx` (679 lines), `app/(marketing)/site/marketing.css` (1,577 lines), `app/(marketing)/site/layout.tsx` (106 lines)
- `app/globals.css` (87), `app/fonts.ts` (15), `app/layout.tsx` (19), `app/page.tsx` (6), `tailwind.config.ts` (115)
- `app/product.css` and `app/_components`: only the blue uses in 15.4, found by grep

Running page:

- `http://localhost:4664/`, closeout's `next dev`, captured 3 October 2026.
- The "N" badge at the bottom left of every screenshot is the Next.js dev indicator, not part of the design.

Screenshots, in the session scratchpad (`/private/tmp/claude-501/-Users-mac-sleeve/9adf67e7-d89c-45dc-ac8c-dc0fac3d80ed/scratchpad/landing-blueprint/`, not committed):

- `closeout-1440-full.png` and `closeout-390-full.png`, from `npx --no-install playwright screenshot --full-page --wait-for-timeout=1500` run in `/Users/mac/sleeve` at `1440,900` and `390,844`.
- `out/sec-{1440,1024,390}-{header,hero,hero-panels,stack-strip,solutions,why,features,integrations,faq,final,footer}.png`
- `out/fold-*.png`, `out/solutions-*-step{0,2,3}.png`, `out/faq-open-*.png`, `out/focus-cta-*.png`

Measurement:

- `measure.cjs` uses Playwright 1.63.0 from the npx cache, the same version the CLI resolves. It writes `out/dump-{1440,1024,390}.json` (rect and computed style for every element), `out/overflow.json` (15 widths), `out/fonts.json`, `out/focus-*.json`, `out/hover-*.json` and `out/faq-*.json`.
- `contrast.py` and `sample.py` compute the ratios and sample gradient pixels from the 1440 full-page capture.

Origin of the layout: `marketing.css` L1-7 and `tailwind.config.ts` L4-8 say closeout cloned reference screens kept in `/Users/mac/closeout/internal/source/`. Those are images of a third-party finance template. They used photography in the hero left panel, in the featured card and in the step art, avatar photos in the bubbles, and real icons. They are named here only to show where closeout's empty gradients stood in for imagery. Do not copy them.

Downloads: none. The fonts come from Google Fonts through `next/font` at build time (closeout `fonts.ts` L1-15). Sleeve already loads them.
