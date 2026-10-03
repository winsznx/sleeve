# Sleeve design system

Light and dark themes. Version 2, 3 October 2026, with the dark theme of D-029 added the same day (section 14). Replaces version 1 of 2 October 2026.

Sleeve's interface follows the owner's closeout app (/Users/mac/closeout/apps/web) closely: structure, type, spacing, radii, shadows and component patterns come from its globals.css, product.css, app/(marketing)/site/marketing.css, tailwind.config.ts, fonts.ts and app/_components. Version 2 makes the palette bright. Every place closeout uses blue is now a step of one green scale, closeout's light blue to saturated blue fields became bright mint to deep emerald, and the spend side of the split gained one warm accent, apricot. Closeout's name, logo, icons and copy are not used anywhere. D-005 and D-014 record the directive.

| File | What it holds |
| --- | --- |
| app/src/styles/tokens.css | Every token as a CSS custom property on :root, and the dark theme's values on :root[data-theme='dark'] |
| app/src/styles/theme.ts | The theme preference's storage key and the boot script the root layout inlines in head |
| app/src/styles/tailwind-theme.cjs | Tailwind 3.4 theme extension that maps utilities to those properties |
| app/src/styles/tailwind-theme.d.cts | Types for importing the theme into a TypeScript Tailwind config |
| app/src/styles/contrast.mjs | Every color claim in this file as data, plus the color math (WCAG 2 contrast, OKLCH, CIEDE2000, color-vision simulation). No dependencies |
| scripts/contrast-check.mjs | Runs contrast.mjs against tokens.css, prints section 3 and exits 1 on any failure |
| app/src/app/dev/palette | The /dev/palette page: every swatch, gradient, text pairing and the spend and equity combination, rendered from the same report |

After any token change, run `node scripts/contrast-check.mjs`, replace section 3 with its output and look at /dev/palette.

## What changed from version 1

| Version 1 | Version 2 | Why |
| --- | --- | --- |
| Spend was ink (#0B0B0C), equity green | Spend is apricot-500 #CD6C10, equity green-600 #007456 | The owner asked for a bright palette with a complementary accent. A black spend segment next to a black primary button read as an action. Apricot against green is the product's split in one look |
| Green steps were muted jade (green-200 #B4E5D1, green-300 #81CCAD) | Light steps are saturated mint (green-200 #B6F7DB, green-300 #8FF3C9) | Bright, like closeout's #C9DCF7 to #85AAE6 fields, which carry more chroma than v1's greens did |
| green-400 #5EB994 existed | No 400. The scale jumps from 300 to 500 | Every vivid green from OKLCH lightness 0.60 to 0.85 at hue 163 to 171 sits within CIEDE2000 10 of a Robinhood reference green (#00C805, #21CE99, #17AD7B). The check samples that band and proves it (section 3) |
| One art gradient (art-green) | hero, stage, step, feature, accent-deep, apricot and art-on-accent | Each closeout field got its own green version, named by where it goes |
| Text never on art | Deep glass (green-900 at 72 percent) carries white text over any gradient | Closeout's glass stat put white text on rgba(255, 255, 255, 0.26) over light blue, which cannot pass |
| Checks: 162, two reference colors | Checks: 246, four reference colors, color-vision distances for the split | Apricot and amber had to be proven apart, and the split proven readable for protan and deutan viewers |

## 1. Principles

1. Green does the work closeout gave blue. green-600 marks the equity share, links, focus, success, info and a verified receipt. Mint steps are tints and art. Deep steps are hover, pressed, gradient ends and the surfaces that carry white text.
2. Apricot is the spend side and nothing else. It never marks an action, a warning or a loss.
3. Black is action and selection, as in closeout. Primary buttons are black pills, a pressed filter turns black, the active tab gets a black bar. Neither green nor apricot is a button fill.
4. Amounts are colored by what they are, never by direction. Spend is apricot, equity is green, waiting is amber stripes. Nothing turns red because it went down or green because it went up, because Sleeve makes no performance claims.
5. Color never works alone. Every status shows its word, every segment of the split has a label, and waiting money is hatched as well as amber.
6. Bright surfaces carry dark text. White text only sits on green-500 or darker, on black, on the danger red, or on deep glass. Mint and apricot washes carry ink.
7. Machine values (addresses, hashes, ids, raw units) are set in IBM Plex Mono. Everything else is Instrument Sans.
8. Mobile first. Every screen works at 360 px wide with a 16 px gutter and no horizontal scroll, then scales up.

## 2. Color

### 2.1 Every closeout blue and what replaced it

File and line are under /Users/mac/closeout/apps/web. Ratios are WCAG 2 contrast on white, truncated to two decimals.

Tokens

| Closeout value | Where (file:line) | On white | Sleeve token | Sleeve value | On white |
| --- | --- | --- | --- | --- | --- |
| --accent #3B71F0 | globals.css:19, tailwind.config.ts:47 | 4.36 | --color-accent, --color-accent-text, --color-link, --color-focus | green-600 #007456 | 5.78 |
| --accent-strong #2554CC | globals.css:20, tailwind.config.ts:48 | 6.52 | --color-accent-strong, --color-link-hover | green-700 #086149 | 7.45 |
| --accent-soft #EAF0FE | globals.css:21, tailwind.config.ts:49 | 1.14 | --color-accent-soft, --color-equity-soft, --color-success-soft | green-100 #D8FAEB | 1.11 |
| --preserve #3B71F0 | globals.css:24, tailwind.config.ts:37 | 4.36 | --color-equity, --color-equity-text, --color-chart-equity | green-600 #007456 | 5.78 |
| --preserve-soft #EAF0FE | globals.css:25, tailwind.config.ts:38 | 1.14 | --color-equity-soft | green-100 #D8FAEB | 1.11 |
| --info #3B71F0 | globals.css:32, tailwind.config.ts:45 | 4.36 | --color-info, --color-info-text | green-600 #007456 | 5.78 |
| --info-soft #EAF0FE | globals.css:33, tailwind.config.ts:46 | 1.14 | --color-info-soft | green-50 #EDFCF6 | 1.05 |
| --success #17A673 (a green already, 3.11 on white, CIEDE2000 2.2 from #17AD7B) | globals.css:26, tailwind.config.ts:39 | 3.11 | --color-success, --color-success-text | green-600 #007456 | 5.78 |
| focus box-shadow 0 0 0 3px rgba(59, 113, 240, 0.25) | globals.css:80 | 1.37 as drawn | --color-focus as a 2 px outline, 2 px offset | green-600 #007456 | 5.78 |
| app shell focus outline 2px var(--accent) | product.css:1027 | 4.36 | same as above | green-600 | 5.78 |

Gradients and art

| Closeout value | Where | Sleeve token | Sleeve value |
| --- | --- | --- | --- |
| hero-panel linear-gradient(155deg, #C9DCF7 0%, #9FBFEE 55%, #8FB4E9 100%) | tailwind.config.ts:106 | --gradient-hero | linear-gradient(155deg, green-100 #D8FAEB 0%, green-200 #B6F7DB 55%, green-300 #8FF3C9 100%) |
| m-art-cool: white glow at 18% 12%, rgba(37, 84, 204, 0.45) glow at 88% 82%, linear-gradient(158deg, #C9DCF7 0%, #9FBFEE 55%, #85AAE6 100%) | marketing.css:255 to 260, used for the hero app stage at page.tsx:282 | --gradient-stage | radial-gradient(120% 90% at 18% 12%, white 0.65 to 0 at 60%), radial-gradient(110% 85% at 96% 100%, green-600 at 0.95, 0.55 at 30%, 0 at 68%), linear-gradient(158deg, green-100 0%, green-200 42%, green-300 100%) |
| the same m-art-cool on the step panel art | page.tsx:200 (m-solutions-art) | --gradient-step | radial-gradient(90% 55% at 20% 0%, white 0.55 to 0 at 62%), linear-gradient(175deg, green-200 0%, green-300 28%, green-500 62%, green-800 100%). Mint at the top, deep emerald at the foot where the deep glass sits |
| m-why-card.is-featured linear-gradient(158deg, #6D9BF2 0%, #3B71F0 60%, #2554CC 100%) | marketing.css:862 | --gradient-feature | linear-gradient(158deg, green-500 #008561 0%, green-600 #007456 60%, green-800 #0D4E3C 100%). White on #6D9BF2 was 2.75; white on green-500 is 4.63 |
| accent-deep linear-gradient(155deg, #4C7EF3 0%, #2554CC 100%) | tailwind.config.ts:108 | --gradient-accent-deep | linear-gradient(155deg, green-600 0%, green-800 100%) |
| m-why-art inset: white 0.4 glow, linear-gradient(160deg, white 0.26, rgba(20, 60, 150, 0.3)) | marketing.css:988 to 989 | --gradient-art-on-accent | same shape, deep end rgba(12, 59, 45, 0.3), which is green-900 at 30 percent |
| m-glass-stat rgba(255, 255, 255, 0.26) with white text | marketing.css:816 to 819 | --glass-deep | rgba(12, 59, 45, 0.72), green-900 at 72 percent, with a 14 px blur. White text on it is 5.31 even over pure white |
| dash-chart-area rgba(59, 113, 240, 0.14) | product.css:630 | --color-chart-area | rgba(0, 116, 86, 0.14), green-600 at 14 percent |
| m-art-neutral, panel-soft | marketing.css:263 to 266, tailwind.config.ts:107 | --gradient-art-neutral, --gradient-panel-soft | unchanged |
| none | | --gradient-apricot | linear-gradient(155deg, apricot-50 #FFF6ED 0%, apricot-100 #FFECD9 55%, apricot-200 #FFD8B5 100%), the spend side in marketing art |

Elements that used the blue tokens

| Closeout element | Where | Sleeve equivalent |
| --- | --- | --- |
| eyebrow mark `.m-eyebrow .m-small-mark` color accent | marketing.css:151 | the eyebrow mark is a 14 by 6 px split rail, apricot then green |
| floating "keep" card `.m-float-keep` preserve-soft and preserve | marketing.css:295 to 296 | `bg-equity-soft text-equity` |
| relationship rail `.m-rail-preserved .m-rail-line` preserve | marketing.css:461 to 462 | `bg-equity` segment of the split rail |
| stat meter fill `.m-stat-meter span` preserve | marketing.css:592 | `bg-equity`; meters only show a split, never progress toward a goal |
| provider glyph tile `.m-provider-stripe` accent-soft and accent-strong | marketing.css:690 to 692 | `bg-accent-soft text-accent-strong` |
| badge `.m-badge.m-keep` preserve-soft and preserve | marketing.css:725 to 726 | `bg-equity-soft text-equity` |
| why-card icon `.m-why-icon` accent | marketing.css:872 | `text-accent` |
| receipt line `.m-preserve-text` preserve | marketing.css:1052 | `text-equity` |
| feature icon `.m-feature-icon` accent on white | marketing.css:1077 | `bg-surface text-accent` |
| chip bars `.m-chip-bars i` accent | marketing.css:1218 | `bg-equity`, or `bg-spend` for spend bars |
| integration card label `.m-integration-cards article > span` accent | marketing.css:1266 | `text-accent` |
| `.tone-preserve`, `.bg-tone-preserve` | product.css:503, 519 | `text-equity`, `bg-equity` |
| chart line and dot stroke preserve | product.css:635, 643 | `stroke-chart-equity` |
| `.closeout-preserve-note` preserve-soft | product.css:1083 | Note: `bg-info-soft border-accent-border` |
| component classes text-preserve (8), bg-preserve-soft (6), bg-preserve-soft/30 and /60, border-preserve and /30, bg-preserve (2), text-info (2), bg-info-soft (2), bg-info (1) | app/**/*.tsx, counted with grep on 3 October 2026 | the matching equity or info utility. Opacity variants are decoration only (rule 6 in 2.4) |

### 2.2 How the scales were made

Green. The light steps keep the luminance of the closeout blues they replace (green-200 1.21 against #C9DCF7 1.39 on white, green-300 1.32 against #9FBFEE 1.88) but carry more chroma, OKLCH 0.076 to 0.112, so the hero wash reads as bright mint instead of grey-green. Hue holds at OKLCH 165 to 171 (HSL 153 to 165): emerald and jade, well away from #CCFF00 (HSL 72) and #00C805 (HSL 121.5). The deep steps start at green-500, the first vivid green outside the reference band, and green-600 is the first that passes 4.5:1 for text on every light surface and tint. Steps 700 to 950 hold the hue and drop lightness for hover, gradient ends, glass and deep text.

Why no 400. Robinhood used #21CE99 for links and #17AD7B for link hover (github.com/robinhood/thorn, docs/_theme/thorn/static/thorn.css_t lines 158 and 163, fetched 3 October 2026). Both sit at HSL 160, inside the hue we want. The check samples every in-gamut color from OKLCH lightness 0.60 to 0.84, hue 163 to 171, chroma 0.10 and up, and finds none farther than CIEDE2000 10 from a reference. So no solid green token lives there. Gradients pass through that band on their way from mint to emerald; no flat fill or text color does.

Apricot. OKLCH hue 43 to 68 (HSL 19 to 30), placed to sit apart from the danger red #D93B3B (CIEDE2000 22.0) and the waiting amber #BC8000 (CIEDE2000 11.8). apricot-500 #CD6C10 is the spend mark, 3.65:1 on white, enough for a segment or dot. apricot-700 #94400C is spend text, 7.00:1 on white. The light steps are the spend tints and the apricot wash. Under protan and deutan simulation spend and equity stay 9.5 and 18.9 apart in OKLab x100, above the target of 8.

Electric aqua was considered as a second accent and dropped. Any aqua bright enough to feel electric lands at HSL hue 175 to 190, which reads as closeout's blue family at a glance and crowds the green that replaces it. One warm accent against one green is the combination.

### 2.3 Primitives

Components never read these. They feed the semantic tokens in 2.4.

| Step | Green | Role | Apricot | Role |
| --- | --- | --- | --- | --- |
| 50 | #EDFCF6 | info-soft, equity-surface, gradient art | #FFF6ED | spend-surface, apricot wash start |
| 100 | #D8FAEB | accent-soft, equity-soft, success-soft, hero start | #FFECD9 | spend-soft, apricot wash middle |
| 200 | #B6F7DB | accent-border, equity-border, selection, hero middle | #FFD8B5 | spend-border, apricot wash end |
| 300 | #8FF3C9 | hero end, stage and step art | #FFBE87 | art only |
| 400 | none, see 2.2 | | #FFA053 | art only, the brightest warm note in illustrations |
| 500 | #008561 | feature card start, step panel middle | #CD6C10 | spend, chart-spend |
| 600 | #007456 | accent, equity, link, focus, success, info, chart-equity | #B1540B | fills and art |
| 700 | #086149 | accent-strong, link-hover | #94400C | spend-text |
| 800 | #0D4E3C | feature, accent-deep and step panel ends | #74310E | deep text in apricot art |
| 900 | #0C3B2D | glass-deep (72 percent), solid glass fallback, art-on-accent end | #57240C | deep text in apricot art |
| 950 | #08281F | deepest green text | none | |

### 2.4 Semantic tokens

Components use these names, never a palette step and never a hex value. The Tailwind column is what tailwind-theme.cjs generates. `text-{tone}` always resolves to the step that passes 4.5:1.

Surfaces

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-canvas | #FFFFFF | Page background | bg-canvas |
| --color-surface | #FFFFFF | Cards, panels, inputs, sheets | bg-surface |
| --color-surface-muted | #F4F5F7 | Stat tiles, row hover, the 24 px landing panels (closeout --m-panel), table header | bg-surface-muted |
| --color-surface-strong | #EBEDF1 | Neutral tags, avatars, meter tracks | bg-surface-strong |
| --color-shell | #ECEEF1 | App background behind the rail and workspace, 768 px and up | bg-shell |
| --color-shell-raised | rgba(255, 255, 255, 0.7) | Cards and hover rows on the shell | bg-shell-raised |
| --color-chrome | rgba(255, 255, 255, 0.94) | Fixed bars over content, with a backdrop blur | bg-chrome |
| --color-scrim | rgba(11, 11, 12, 0.4) | Behind sheets and dialogs | bg-scrim |
| --color-skeleton | surface-strong | Skeleton blocks | bg-skeleton |
| --color-selection | green-200 #B6F7DB | Text selection, set in the base layer | none |

Borders

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-border | #E7E9EE | Hairlines, card, list and tag borders. The default for `border` | border-border |
| --color-border-strong | #D4D8E0 | Hover borders, secondary button, dashed empty and gated outlines | border-border-strong |
| --color-border-control | #898D94 | Inputs, selects, checkboxes and radios (3:1, WCAG 1.4.11) | border-border-control |

Ink and brand

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-ink | #0B0B0C | Primary text and every amount | text-ink |
| --color-ink-secondary | #5B6270 | Secondary text, labels under figures, inactive navigation | text-ink-secondary |
| --color-ink-muted | #6A6F7B | Meta text, hints, timestamps, icon glyphs. Allowed surfaces in 2.6 | text-ink-muted |
| --color-ink-inverse | #FFFFFF | White text where on-brand and on-accent do not fit | text-ink-inverse |
| --color-brand | #101114 | Primary button, pressed filter, active tab bar, active step row | bg-brand, border-brand |
| --color-brand-strong | #000000 | Primary button hover and pressed | hover:bg-brand-strong |
| --color-on-brand | #FFFFFF | Label on brand | text-on-brand |

Accent, links and focus

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-accent | green-600 #007456 | Green fills, icons, strokes | bg-accent, fill-accent, stroke-accent |
| --color-accent-strong | green-700 #086149 | Hover and pressed for green fills, glyphs on accent-soft | bg-accent-strong, text-accent-strong |
| --color-accent-soft | green-100 #D8FAEB | Green tags, chips, glyph tiles | bg-accent-soft |
| --color-accent-border | green-200 #B6F7DB | Border around green-tinted panels and notes | border-accent-border |
| --color-accent-text | green-600 #007456 | Green text | text-accent |
| --color-on-accent | #FFFFFF | Text on green-500 and darker, on the feature card, deep band and deep glass | text-on-accent |
| --color-link | green-600 | Inline links, always underlined | text-link |
| --color-link-hover | green-700 | Link hover | hover:text-link-hover |
| --color-focus | green-600 | Focus ring, 2 px outline, 2 px offset | outline-focus, ring-focus |
| --color-focus-inverse | #FFFFFF | Focus ring on black, green fills and deep glass | outline-focus-inverse |

The split

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-spend | apricot-500 #CD6C10 | Spend segment, spend dot, spend chart bars | bg-spend, fill-spend |
| --color-spend-soft | apricot-100 #FFECD9 | Spend tag and glyph tile | bg-spend-soft |
| --color-spend-surface | apricot-50 #FFF6ED | Spend sleeve card | bg-spend-surface |
| --color-spend-border | apricot-200 #FFD8B5 | Border of the spend sleeve card | border-spend-border |
| --color-spend-text | apricot-700 #94400C | Spend words and labels (the fill is 3.65:1, not a text color) | text-spend |
| --color-equity | accent | Equity segment, dot, chart line | bg-equity, fill-equity |
| --color-equity-soft | accent-soft | Filled and settled tags | bg-equity-soft |
| --color-equity-surface | green-50 #EDFCF6 | Equity sleeve card | bg-equity-surface |
| --color-equity-border | green-200 #B6F7DB | Border of the equity sleeve card | border-equity-border |
| --color-equity-text | accent-text | Equity words and labels | text-equity |
| --color-waiting | warning #BC8000 | Waiting stripes and icon | bg-waiting |
| --color-waiting-soft | warning-soft #FCF3E1 | Queued tag, base of the stripes | bg-waiting-soft |
| --color-waiting-text | warning-text #946300 | Waiting words and tag text | text-waiting |

Status

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-success | green-600 | Success icon, verified check fill | bg-success |
| --color-success-soft | green-100 | Success tag | bg-success-soft |
| --color-success-text | green-600 | Success text | text-success |
| --color-warning | #BC8000 | Warning icon, dot, stripes | bg-warning |
| --color-warning-soft | #FCF3E1 | Warning tag and banner | bg-warning-soft |
| --color-warning-text | #946300 | Warning text | text-warning |
| --color-danger | #D93B3B | Error icon, destructive button | bg-danger |
| --color-danger-strong | #CA2B2F | Destructive button hover and pressed | hover:bg-danger-strong |
| --color-danger-soft | #FDECEC | Error tag and banner | bg-danger-soft |
| --color-danger-text | #CA2B2F | Error and refused text | text-danger |
| --color-on-danger | #FFFFFF | Destructive button label | text-on-danger |
| --color-info | green-600 | Info icon | fill-info, stroke-info |
| --color-info-soft | green-50 #EDFCF6 | Note panels | bg-info-soft |
| --color-info-text | green-600 | Info tag text | text-info |

Charts

| Token | Value | Use | Tailwind |
| --- | --- | --- | --- |
| --color-chart-spend | spend #CD6C10 | Spend series | fill-chart-spend |
| --color-chart-equity | equity #007456 | Equity series and line | fill-chart-equity, stroke-chart-equity |
| --color-chart-waiting | waiting #BC8000 | Waiting series, always as the hatch pattern (base waiting-soft, 2 px stripes at 45 degrees every 6 px) | fill-chart-waiting |
| --color-chart-grid | border #E7E9EE | Grid lines, dashed 3 4 as in closeout | stroke-chart-grid |
| --color-chart-axis | ink-muted #6A6F7B | Axis labels, set in HTML so they keep their size when the drawing scales | text-ink-muted |
| --color-chart-area | rgba(0, 116, 86, 0.14) | Area under the equity line, closeout's 14 percent | fill-chart-area |

Stacked bars put spend at the bottom, equity bought above it and equity waiting on top, each separated by a 3 unit gap. /dev/palette draws one.

Gradients, glass and patterns

| Token | Value | Use | Tailwind | Text on it |
| --- | --- | --- | --- | --- |
| --gradient-hero | 155deg, green-100 0%, green-200 55%, green-300 100% | Landing hero panel, bright section washes | bg-hero | ink and ink-secondary. Worst stop green-300: ink 14.83, ink-secondary 4.62, focus 4.35 |
| --gradient-stage | three layers, see 2.1 | The hero app stage behind the product card | bg-stage | none. White cards float on it |
| --gradient-step | two layers, mint to green-800, see 2.1 | The step panel art beside the numbered steps | bg-step | none directly. Deep glass at the foot carries white text |
| --gradient-feature | 158deg, green-500 0%, green-600 60%, green-800 100% | The featured card in a three-up row | bg-feature | on-accent. Worst stop green-500: 4.63 |
| --gradient-accent-deep | 155deg, green-600 0%, green-800 100% | Closing call to action band, verified receipt header | bg-accent-deep | on-accent. Worst stop 5.78 |
| --gradient-apricot | 155deg, apricot-50 0%, apricot-100 55%, apricot-200 100% | Spend art, the spend half of a split illustration | bg-apricot | ink and ink-secondary. Worst stop apricot-200: ink-secondary 4.59 |
| --gradient-art-on-accent | white 0.4 glow, then white 0.26 to green-900 at 0.3 | Inset art inside the feature card | bg-art-on-accent | none |
| --gradient-art-neutral | closeout's m-art-neutral, unchanged | Hero notes panel | bg-art-neutral | none. White cards float on it |
| --gradient-panel-soft | #F7F8FA to #EDEFF3, unchanged | Soft grey panels | bg-panel-soft | ink and ink-secondary |
| --gradient-art-green | alias of --gradient-stage | The v1 name, kept so v1 components still render | bg-art-green | none |
| --glass-deep | rgba(12, 59, 45, 0.72), green-900 at 72 percent | Stat and caption panes on any gradient, 14 px blur | bg-glass-deep backdrop-blur-glass | on-accent, 5.31 even over white |
| --glass-deep-border | rgba(255, 255, 255, 0.24) | Its edge | border-glass-deep-edge | |
| --glass-light | rgba(255, 255, 255, 0.88) | Light pane on any gradient, 14 px blur | bg-glass-light backdrop-blur-glass | ink 14.90 and ink-secondary 4.64, even over black |
| --glass-light-border | rgba(255, 255, 255, 0.6) | Its edge | border-glass-light-edge | |
| --pattern-waiting | repeating-linear-gradient(135deg, warning-soft 0 4px, warning 4px 6px) | Waiting segment of the split rail | bg-waiting-stripes | none |

With `prefers-reduced-transparency: reduce`, glass-deep becomes solid green-900 (white text 12.50) and glass-light becomes white.

### 2.5 The spend and equity combination

The one place the palette is loud, on purpose. A payment's split shows apricot on the left for what stayed spendable, green for what became Stock Tokens and amber hatching for the equity share waiting as USDG.

- Rail: apricot-500, green-600, then the waiting pattern, 2 px gaps on the card surface.
- Legend: a 10 px dot in the segment color, the label in ink-secondary, the amount in `text-spend`, `text-equity` or `text-waiting`.
- Sleeve cards: spend on `bg-spend-surface border-spend-border` with the title in `text-spend`; equity on `bg-equity-surface border-equity-border` with the title in `text-equity`. Amounts on both are ink.
- Tags: Spend `bg-spend-soft text-spend`, Filled `bg-equity-soft text-equity`, Queued `bg-waiting-soft text-waiting`, Refused `bg-danger-soft text-danger`.
- Marketing art: the apricot wash and the mint hero wash side by side are the split as a picture. Never put a spend figure on a green surface or an equity figure on an apricot one.

### 2.6 Rules

1. Text on a tint uses that tone's text token. In Tailwind this is automatic: `text-accent`, `text-equity`, `text-spend`, `text-success`, `text-warning`, `text-waiting`, `text-danger` and `text-info` resolve to the text step, and `text-warning-soft` and similar do not exist.
2. ink-muted only on canvas, surface, surface-muted, info-soft, equity-surface, spend-surface and the shell-raised cards of the rail. On surface-strong, the shell, accent-soft or spend-soft, use ink-secondary.
3. Inputs, checkboxes and radios sit on canvas, surface or surface-muted. border-control reaches 3:1 only there.
4. White text only on brand, brand-strong, danger, danger-strong, green-500 or darker, the feature and deep gradients, and deep glass. Never on mint, never on apricot.
5. warning, danger and spend are fill and icon colors. Their text is warning-text, danger-text and spend-text, which `text-warning`, `text-danger` and `text-spend` already resolve to.
6. Opacity modifiers (`bg-accent/20`) compile to `color-mix()`. Use them for decoration only. Anything with a contrast duty uses a named token.
7. No raw hex, rgb, hsl or arbitrary color utilities (`bg-[#...]`) in components, and no palette primitive outside app/src/styles. Section 13.4 has the greps.
8. No solid green between green-300 and green-500. If a design needs a mid green, it is a gradient passing through, not a token.

### 2.7 Where blue gets back in

| Source | Fix |
| --- | --- |
| Tailwind's stock palette | `theme.colors = {}` removes it. `bg-blue-500` and `text-green-600` generate nothing |
| Tailwind's default ring color (#3B82F6 at 50 percent) and border color (gray-200) | The theme sets ringColor, ringOpacity and borderColor defaults to Sleeve tokens |
| Tailwind preflight's placeholder color #9CA3AF (2.53:1) | The base layer sets ink-muted |
| Browser link and focus colors | Preflight resets links; the base layer draws Sleeve's focus ring |
| Native checkbox, radio, range and progress controls | `accent-color` on :root in tokens.css |
| Text selection highlight | `::selection` in the base layer |
| Chrome's autofill background #E8F0FE | Inset canvas shadow in the base layer |
| Chart libraries' default series colors | Always pass the chart tokens |
| Icon sets and token icons with baked-in colors | UI icons use `currentColor`. Token icons are images and keep their own colors, inside a neutral tile |
| The operating system's passkey sheet | Outside the page. It keeps the system's colors |

## 3. Check output

Generated by `node scripts/contrast-check.mjs` on 3 October 2026, with the dark theme measured at the end. Contrast is WCAG 2, compared unrounded and printed truncated to two decimals, which is why #00C805 shows 2.26 here and 2.27 in docs/research/issuer-docs.md, which rounds. /dev/palette renders the same report.

Tokens: app/src/styles/tokens.css

### Green scale

HSL hue band 150 to 170.

| Step | Hex | HSL | OKLCH | On white | Allowed uses | Stands in for (closeout) | Rules |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | #EDFCF6 | 156.0, 71%, 96% | 0.978 0.018 170.1 | 1.05 | tint, art | none (notes and equity surfaces) | pass |
| 100 | #D8FAEB | 153.5, 77%, 91% | 0.957 0.041 167.1 | 1.11 | tint, art | #EAF0FE accent-soft, preserve-soft (globals.css:21, 25) | pass |
| 200 | #B6F7DB | 154.2, 80%, 84% | 0.925 0.076 166.3 | 1.21 | tint, highlight, border, art | #C9DCF7 gradient start (marketing.css:259, tailwind.config.ts:106) | pass |
| 300 | #8FF3C9 | 154.8, 81%, 76% | 0.891 0.112 165.2 | 1.32 | tint, art | #9FBFEE, #85AAE6, #8FB4E9 gradient middle and end (marketing.css:259, tailwind.config.ts:106) | pass |
| 500 | #008561 | 163.8, 100%, 26% | 0.547 0.114 165.9 | 4.63 | under white, fill, art | #6D9BF2, #4C7EF3 featured and deep gradient starts (marketing.css:862, tailwind.config.ts:108) | pass |
| 600 | #007456 | 164.5, 100%, 23% | 0.496 0.101 167.2 | 5.78 | text, focus, fill, under white | #3B71F0 accent, preserve, info (globals.css:19, 24, 32) | pass |
| 700 | #086149 | 163.8, 85%, 21% | 0.439 0.086 168.1 | 7.45 | text, fill, under white | #2554CC accent-strong and glow (globals.css:20, marketing.css:258, 862) | pass |
| 800 | #0D4E3C | 163.4, 71%, 18% | 0.380 0.070 169.3 | 9.66 | text, fill, under white | #2554CC gradient end (tailwind.config.ts:108) | pass |
| 900 | #0C3B2D | 162.1, 66%, 14% | 0.317 0.056 168.9 | 12.50 | text, fill, under white | rgba(20, 60, 150, 0.3) inset art (marketing.css:989) | pass |
| 950 | #08281F | 163.1, 67%, 9% | 0.250 0.041 171.0 | 15.74 | text, fill, under white | none (deepest text and card ink) | pass |

### Apricot scale

HSL hue band 18 to 34.

| Step | Hex | HSL | OKLCH | On white | Allowed uses | Stands in for (closeout) | Rules |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | #FFF6ED | 30.0, 100%, 96% | 0.978 0.015 67.6 | 1.06 | tint, art | none (spend surfaces) | pass |
| 100 | #FFECD9 | 30.0, 100%, 93% | 0.953 0.033 67.4 | 1.15 | tint, art | none (spend tiles and chips) | pass |
| 200 | #FFD8B5 | 28.4, 100%, 85% | 0.907 0.063 63.8 | 1.33 | tint, border, art | none | pass |
| 300 | #FFBE87 | 27.5, 100%, 76% | 0.849 0.103 61.0 | 1.61 | art | none | pass |
| 400 | #FFA053 | 26.9, 100%, 66% | 0.788 0.146 57.4 | 2.01 | art | none | pass |
| 500 | #CD6C10 | 29.2, 86%, 43% | 0.632 0.151 55.1 | 3.65 | fill, art | none (the spend mark) | pass |
| 600 | #B1540B | 26.4, 88%, 37% | 0.552 0.142 50.1 | 5.06 | fill, art | none | pass |
| 700 | #94400C | 22.9, 85%, 31% | 0.476 0.127 46.1 | 7.00 | text, fill | none (spend words on tints) | pass |
| 800 | #74310E | 20.6, 78%, 25% | 0.401 0.105 44.3 | 9.59 | text, fill | none | pass |
| 900 | #57240C | 19.2, 76%, 19% | 0.329 0.083 43.3 | 12.62 | text, fill | none | pass |

Use rules: text = text and links, 4.5:1 on every light surface and tint; focus = focus ring, 3:1 on every surface it can sit on, the black pill included; fill = meaningful fills, icons, segments and strokes, 3:1; under white = carries white text at 4.5:1 (feature card, deep band, verified check); tint = background under ink and ink-secondary text; highlight = text selection and highlights, under ink only; border = decorative border, no contrast duty; art = illustration and gradient stops, no contrast duty.

### Distance from reference colors

| Reference | Hex | HSL hue | On white | Source |
| --- | --- | --- | --- | --- |
| Robin Neon | #CCFF00 | 72.0 | 1.17 | docs.robinhood.com/chain/brand-guidelines, fetched 2 October 2026 (docs/research/issuer-docs.md section 4) |
| Logo green | #00C805 | 121.5 | 2.26 | www.designyourway.net/blog/robinhood-logo/, a third-party logo page (docs/research/issuer-docs.md section 4) |
| Former link green | #21CE99 | 161.6 | 2.02 | github.com/robinhood/thorn docs/_theme/thorn/static/thorn.css_t line 158, fetched 3 October 2026 |
| Former link hover green | #17AD7B | 160.0 | 2.87 | github.com/robinhood/thorn docs/_theme/thorn/static/thorn.css_t line 163, fetched 3 October 2026 |

| green | HSL hue | CIEDE2000 to #CCFF00 | CIEDE2000 to #00C805 | CIEDE2000 to #21CE99 | CIEDE2000 to #17AD7B | Rules |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 156.0 | 29.8 | 33.7 | 26.2 | 31.4 | pass |
| 100 | 153.5 | 28.2 | 30.6 | 21.6 | 27.3 | pass |
| 200 | 154.2 | 26.8 | 26.6 | 15.9 | 22.7 | pass |
| 300 | 154.8 | 26.0 | 22.9 | 11.3 | 19.2 | pass |
| 500 | 163.8 | 42.8 | 26.8 | 22.0 | 13.3 | pass |
| 600 | 164.5 | 48.0 | 32.3 | 28.5 | 20.1 | pass |
| 700 | 163.8 | 54.6 | 39.6 | 36.8 | 27.7 | pass |
| 800 | 163.4 | 62.2 | 47.3 | 46.0 | 34.0 | pass |
| 900 | 162.1 | 71.3 | 52.8 | 53.4 | 39.5 | pass |
| 950 | 163.1 | 82.5 | 57.5 | 58.5 | 44.9 | pass |

| apricot | HSL hue | CIEDE2000 to #CCFF00 | CIEDE2000 to #00C805 | CIEDE2000 to #21CE99 | CIEDE2000 to #17AD7B | Rules |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 30.0 | 30.0 | 36.3 | 31.5 | 35.8 | pass |
| 100 | 30.0 | 29.5 | 36.7 | 32.9 | 36.4 | pass |
| 200 | 28.4 | 31.4 | 39.6 | 37.0 | 39.1 | pass |
| 300 | 27.5 | 36.1 | 44.8 | 43.0 | 43.6 | pass |
| 400 | 26.9 | 43.0 | 51.6 | 49.7 | 49.1 | pass |
| 500 | 29.2 | 51.0 | 55.1 | 53.9 | 50.7 | pass |
| 600 | 26.4 | 57.8 | 59.6 | 58.1 | 53.7 | pass |
| 700 | 22.9 | 64.7 | 64.4 | 62.9 | 57.3 | pass |
| 800 | 20.6 | 71.2 | 68.0 | 67.4 | 58.9 | pass |
| 900 | 19.2 | 78.7 | 69.6 | 70.5 | 59.6 | pass |

Skipped band: 8397 in-gamut samples with OKLCH lightness 0.6 to 0.84, hue 163 to 171 and chroma 0.1 or more; the farthest from every reference is #82E0C2 (OKLCH 0.840 0.100 171.0) at CIEDE2000 9.46, under 10, so no green step can live there. pass.

### Every color literal in the tokens file

102 distinct literals, 37 of them chromatic (OKLCH chroma 0.04 or more) and 35 translucent. Rules: no chromatic literal with an HSL hue from 190 to 260 (blue) or 60 to 90 (Robin Neon), none within CIEDE2000 10 of a reference color, and every translucent literal is white, ink or a palette step at an alpha. The cool greys kept from closeout stay under the chroma floor.

### Contrast pairs DESIGN.md relies on

| Foreground | Background | Ratio | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- |
| ink | canvas | 19.67 | 4.5 | body text | pass |
| ink | surface-muted | 18.03 | 4.5 | body text | pass |
| ink | surface-strong | 16.78 | 4.5 | body text | pass |
| ink | shell | 16.92 | 4.5 | body text | pass |
| ink | accent-soft | 17.60 | 4.5 | body text | pass |
| ink | equity-surface | 18.60 | 4.5 | body text | pass |
| ink | spend-soft | 17.09 | 4.5 | body text | pass |
| ink | spend-surface | 18.41 | 4.5 | body text | pass |
| ink | info-soft | 18.60 | 4.5 | body text | pass |
| ink | warning-soft | 17.84 | 4.5 | body text | pass |
| ink | danger-soft | 17.22 | 4.5 | body text | pass |
| ink | selection | 16.22 | 4.5 | body text | pass |
| ink | shell-raised over shell | 18.82 | 4.5 | body text on rail cards | pass |
| ink | chrome over ink | 17.26 | 4.5 | nav label, active | pass |
| ink-secondary | canvas | 6.12 | 4.5 | secondary text | pass |
| ink-secondary | surface-muted | 5.61 | 4.5 | secondary text | pass |
| ink-secondary | surface-strong | 5.22 | 4.5 | secondary text | pass |
| ink-secondary | shell | 5.27 | 4.5 | secondary text | pass |
| ink-secondary | accent-soft | 5.48 | 4.5 | secondary text | pass |
| ink-secondary | equity-surface | 5.79 | 4.5 | secondary text | pass |
| ink-secondary | spend-soft | 5.32 | 4.5 | secondary text | pass |
| ink-secondary | spend-surface | 5.73 | 4.5 | secondary text | pass |
| ink-secondary | info-soft | 5.79 | 4.5 | secondary text | pass |
| ink-secondary | warning-soft | 5.55 | 4.5 | secondary text | pass |
| ink-secondary | danger-soft | 5.36 | 4.5 | secondary text | pass |
| ink-secondary | shell-raised over shell | 5.86 | 4.5 | secondary text on rail cards | pass |
| ink-secondary | chrome over ink | 5.37 | 4.5 | nav label, inactive | pass |
| ink-muted | canvas | 5.03 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | surface-muted | 4.61 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | info-soft | 4.75 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | equity-surface | 4.75 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | spend-surface | 4.71 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | shell-raised over shell | 4.81 | 4.5 | meta text on rail cards | pass |
| accent-text | canvas | 5.78 | 4.5 | green text | pass |
| accent-text | surface-muted | 5.29 | 4.5 | green text | pass |
| accent-text | surface-strong | 4.93 | 4.5 | green text | pass |
| accent-text | shell | 4.97 | 4.5 | green text | pass |
| accent-text | accent-soft | 5.17 | 4.5 | green text | pass |
| accent-text | equity-surface | 5.46 | 4.5 | green text | pass |
| accent-text | spend-soft | 5.02 | 4.5 | green text | pass |
| accent-text | spend-surface | 5.41 | 4.5 | green text | pass |
| accent-text | info-soft | 5.46 | 4.5 | green text | pass |
| accent-text | warning-soft | 5.24 | 4.5 | green text | pass |
| accent-text | danger-soft | 5.06 | 4.5 | green text | pass |
| accent-strong | accent-soft | 6.67 | 4.5 | green glyph tile (closeout m-provider-stripe) | pass |
| link | canvas | 5.78 | 4.5 | inline link | pass |
| link | surface-muted | 5.29 | 4.5 | inline link | pass |
| link | info-soft | 5.46 | 4.5 | inline link | pass |
| link | equity-surface | 5.46 | 4.5 | inline link | pass |
| link-hover | canvas | 7.45 | 4.5 | inline link, hover | pass |
| link-hover | surface-muted | 6.83 | 4.5 | inline link, hover | pass |
| equity-text | canvas | 5.78 | 4.5 | equity words and tile glyphs | pass |
| equity-text | equity-soft | 5.17 | 4.5 | equity words and tile glyphs | pass |
| equity-text | equity-surface | 5.46 | 4.5 | equity words and tile glyphs | pass |
| equity-text | surface-muted | 5.29 | 4.5 | equity words and tile glyphs | pass |
| spend-text | canvas | 7.00 | 4.5 | spend words and tile glyphs | pass |
| spend-text | spend-soft | 6.08 | 4.5 | spend words and tile glyphs | pass |
| spend-text | spend-surface | 6.55 | 4.5 | spend words and tile glyphs | pass |
| spend-text | surface-muted | 6.42 | 4.5 | spend words and tile glyphs | pass |
| success-text | success-soft | 5.17 | 4.5 | success tag | pass |
| success-text | canvas | 5.78 | 4.5 | success tag | pass |
| info-text | info-soft | 5.46 | 4.5 | info tag | pass |
| info-text | canvas | 5.78 | 4.5 | info tag | pass |
| warning-text | warning-soft | 4.70 | 4.5 | waiting and warning text | pass |
| warning-text | canvas | 5.19 | 4.5 | waiting and warning text | pass |
| warning-text | surface-muted | 4.76 | 4.5 | waiting and warning text | pass |
| waiting-text | waiting-soft | 4.70 | 4.5 | waiting tag | pass |
| waiting-text | canvas | 5.19 | 4.5 | waiting tag | pass |
| danger-text | danger-soft | 4.71 | 4.5 | error and refused text | pass |
| danger-text | canvas | 5.38 | 4.5 | error and refused text | pass |
| danger-text | surface-muted | 4.93 | 4.5 | error and refused text | pass |
| on-brand | brand | 18.87 | 4.5 | primary button label | pass |
| on-brand | brand-strong | 21.00 | 4.5 | primary button label | pass |
| on-accent | accent | 5.78 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | accent-strong | 7.45 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | success | 5.78 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | green-900 | 12.50 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-danger | danger | 4.52 | 4.5 | destructive button label | pass |
| on-danger | danger-strong | 5.38 | 4.5 | destructive button label | pass |
| focus | canvas | 5.78 | 3 | focus ring | pass |
| focus | surface-muted | 5.29 | 3 | focus ring | pass |
| focus | surface-strong | 4.93 | 3 | focus ring | pass |
| focus | shell | 4.97 | 3 | focus ring | pass |
| focus | accent-soft | 5.17 | 3 | focus ring | pass |
| focus | equity-surface | 5.46 | 3 | focus ring | pass |
| focus | spend-soft | 5.02 | 3 | focus ring | pass |
| focus | spend-surface | 5.41 | 3 | focus ring | pass |
| focus | info-soft | 5.46 | 3 | focus ring | pass |
| focus | warning-soft | 5.24 | 3 | focus ring | pass |
| focus | danger-soft | 5.06 | 3 | focus ring | pass |
| focus | brand | 3.26 | 3 | focus ring | pass |
| focus | chrome over ink | 5.07 | 3 | focus ring in the nav bar | pass |
| focus-inverse | brand | 18.87 | 3 | focus ring on black and green fills | pass |
| focus-inverse | accent | 5.78 | 3 | focus ring on black and green fills | pass |
| focus-inverse | accent-strong | 7.45 | 3 | focus ring on black and green fills | pass |
| focus-inverse | green-500 | 4.63 | 3 | focus ring on black and green fills | pass |
| focus-inverse | green-800 | 9.66 | 3 | focus ring on black and green fills | pass |
| border-control | canvas | 3.33 | 3 | input and checkbox boundary | pass |
| border-control | surface-muted | 3.05 | 3 | input and checkbox boundary | pass |
| equity | canvas | 5.78 | 3 | equity segment, dot, icon, chart line | pass |
| equity | surface-muted | 5.29 | 3 | equity segment, dot, icon, chart line | pass |
| equity | surface-strong | 4.93 | 3 | equity segment, dot, icon, chart line | pass |
| equity | shell | 4.97 | 3 | equity segment, dot, icon, chart line | pass |
| equity | equity-surface | 5.46 | 3 | equity segment, dot, icon, chart line | pass |
| spend | canvas | 3.65 | 3 | spend segment, dot, chart bar | pass |
| spend | surface-muted | 3.34 | 3 | spend segment, dot, chart bar | pass |
| spend | surface-strong | 3.11 | 3 | spend segment, dot, chart bar | pass |
| spend | spend-surface | 3.41 | 3 | spend segment, dot, chart bar | pass |
| waiting | canvas | 3.37 | 3 | waiting stripes and icon | pass |
| waiting | surface-muted | 3.09 | 3 | waiting stripes and icon | pass |
| waiting | waiting-soft | 3.05 | 3 | waiting stripes and icon | pass |
| danger | canvas | 4.52 | 3 | error icon and fill | pass |
| danger | danger-soft | 3.96 | 3 | error icon and fill | pass |
| ink-muted | canvas | 5.03 | 3 | icon glyphs | pass |
| ink-muted | surface-muted | 4.61 | 3 | icon glyphs | pass |
| brand | canvas | 18.87 | 3 | selected pill, active tab bar | pass |
| brand | surface-muted | 17.30 | 3 | selected pill, active tab bar | pass |
| success | canvas | 5.78 | 3 | verified check circle | pass |
| chart-spend | canvas | 3.65 | 3 | chart series | pass |
| chart-equity | canvas | 5.78 | 3 | chart series | pass |
| chart-waiting | canvas | 3.37 | 3 | chart series | pass |

### Text on gradients and glass

Gradients that carry text are measured at every stop; the worst stop decides. Glass is measured composited over the backdrop that is worst for the text: white under deep glass, black under light glass.

| Surface | Stops or composite | Foreground | Worst ratio | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- | --- |
| gradient-feature | #008561, #007456, #0D4E3C | on-accent | 4.63 | 4.5 | feature card text | pass |
| gradient-feature | #008561, #007456, #0D4E3C | focus-inverse | 4.63 | 3 | focus ring on the feature card | pass |
| gradient-accent-deep | #007456, #0D4E3C | on-accent | 5.78 | 4.5 | text on the deep band | pass |
| gradient-accent-deep | #007456, #0D4E3C | focus-inverse | 5.78 | 3 | focus ring on the deep band | pass |
| gradient-hero | #D8FAEB, #B6F7DB, #8FF3C9 | ink | 14.83 | 4.5 | text on the mint wash | pass |
| gradient-hero | #D8FAEB, #B6F7DB, #8FF3C9 | ink-secondary | 4.62 | 4.5 | secondary text on the mint wash | pass |
| gradient-hero | #D8FAEB, #B6F7DB, #8FF3C9 | focus | 4.35 | 3 | focus ring on the mint wash | pass |
| gradient-apricot | #FFF6ED, #FFECD9, #FFD8B5 | ink | 14.74 | 4.5 | text on the apricot wash | pass |
| gradient-apricot | #FFF6ED, #FFECD9, #FFD8B5 | ink-secondary | 4.59 | 4.5 | secondary text on the apricot wash | pass |
| gradient-apricot | #FFF6ED, #FFECD9, #FFD8B5 | focus | 4.33 | 3 | focus ring on the apricot wash | pass |
| glass-deep over white | #507268 | on-accent | 5.31 | 4.5 | white text on deep glass | pass |
| glass-deep over white | #507268 | focus-inverse | 5.31 | 3 | focus ring on deep glass | pass |
| glass-light over black | #E0E0E0 | ink | 14.90 | 4.5 | text on light glass | pass |
| glass-light over black | #E0E0E0 | ink-secondary | 4.64 | 4.5 | secondary text on light glass | pass |
| glass-light over black | #E0E0E0 | focus | 4.37 | 3 | focus ring on light glass | pass |

No text directly on: gradient-stage (hero app stage: text sits on white cards floating on it); gradient-step (step panel: text sits on --glass-deep at the foot of the panel); gradient-art-on-accent (decorative inset inside the feature card); gradient-art-neutral (hero notes panel: text sits on white cards floating on it).

### The split under color-vision deficiency

Protan and deutan are simulated with Machado, Oliveira and Fernandes (2009) at severity 1.0 and measured in OKLab x100, the units and thresholds of the dataviz method (target 8, full-vision floor 15).

| Pair | Hex | Measure | Value | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- | --- |
| spend and equity | #CD6C10, #007456 | cvd | protan 9.5, deutan 18.9 (OKLab x100) | 8 | spend and equity segments side by side, protan and deutan | pass |
| spend and equity | #CD6C10, #007456 | normal | 25.1 (OKLab x100) | 15 | spend and equity segments, full color vision | pass |
| spend and waiting | #CD6C10, #BC8000 | de2000 | 11.8 (CIEDE2000) | 10 | spend mark and waiting stripes; waiting is also always hatched | pass |
| spend and danger | #CD6C10, #D93B3B | de2000 | 22.0 (CIEDE2000) | 15 | spend mark and the danger red | pass |
| equity and waiting | #007456, #BC8000 | cvd | protan 12.3, deutan 19.9 (OKLab x100) | 8 | equity segment beside the waiting stripes, protan and deutan | pass |

### Measured, not relied on

| Foreground | Background | Ratio | Why it does not matter |
| --- | --- | --- | --- |
| spend | equity | 1.58 | spend and equity segments: a 2px gap, hue and the color-vision distance above separate them |
| equity | waiting | 1.71 | equity and waiting segments: a 2px gap and the waiting stripes separate them |
| on-accent | spend | 3.65 | no text on the spend fill; spend words use spend-text on a tint |
| on-accent | green-300 | 1.32 | never white on mint: mint carries ink |
| ink-muted | accent-soft | 4.50 | not allowed: use ink-secondary on the green-100 tint |
| ink-muted | spend-soft | 4.37 | not allowed: use ink-secondary on the apricot-100 tint |
| ink-muted | surface-strong | 4.29 | not allowed: use ink-secondary on surface-strong |
| ink-muted | shell | 4.32 | not allowed: use ink-secondary on the shell |
| border-control | surface-strong | 2.84 | not allowed: inputs sit on canvas or surface-muted |
| warning | canvas | 3.37 | warning fill is not a text color: text uses warning-text |
| danger | danger-soft | 3.96 | danger fill is not a text color on its soft tint: text uses danger-text |
| border-strong | canvas | 1.42 | hairline divider, decorative |

### Dark theme

The dark block overrides 63 tokens. These follow another semantic token and need no value of their own: skeleton, equity, equity-soft, equity-text, waiting, waiting-soft, waiting-text, chart-spend, chart-equity, chart-waiting, chart-grid, chart-axis, gradient-art-green, pattern-waiting. These keep their light value on purpose: on-accent, on-danger, gradient-feature, gradient-accent-deep, gradient-art-on-accent, glass-deep, glass-deep-border, glass-blur. Every claim below is measured on the dark values.

| Foreground | Background | Ratio | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- |
| ink | canvas | 17.89 | 4.5 | body text | pass |
| ink | surface-muted | 15.78 | 4.5 | body text | pass |
| ink | surface-strong | 14.05 | 4.5 | body text | pass |
| ink | shell | 18.42 | 4.5 | body text | pass |
| ink | accent-soft | 14.32 | 4.5 | body text | pass |
| ink | equity-surface | 15.90 | 4.5 | body text | pass |
| ink | spend-soft | 14.70 | 4.5 | body text | pass |
| ink | spend-surface | 16.53 | 4.5 | body text | pass |
| ink | info-soft | 15.90 | 4.5 | body text | pass |
| ink | warning-soft | 14.42 | 4.5 | body text | pass |
| ink | danger-soft | 15.62 | 4.5 | body text | pass |
| ink | selection | 8.79 | 4.5 | body text | pass |
| ink | shell-raised over shell | 16.74 | 4.5 | body text on rail cards | pass |
| ink | chrome over ink | 14.46 | 4.5 | nav label, active | pass |
| ink-secondary | canvas | 9.53 | 4.5 | secondary text | pass |
| ink-secondary | surface-muted | 8.41 | 4.5 | secondary text | pass |
| ink-secondary | surface-strong | 7.49 | 4.5 | secondary text | pass |
| ink-secondary | shell | 9.82 | 4.5 | secondary text | pass |
| ink-secondary | accent-soft | 7.63 | 4.5 | secondary text | pass |
| ink-secondary | equity-surface | 8.48 | 4.5 | secondary text | pass |
| ink-secondary | spend-soft | 7.83 | 4.5 | secondary text | pass |
| ink-secondary | spend-surface | 8.81 | 4.5 | secondary text | pass |
| ink-secondary | info-soft | 8.48 | 4.5 | secondary text | pass |
| ink-secondary | warning-soft | 7.69 | 4.5 | secondary text | pass |
| ink-secondary | danger-soft | 8.33 | 4.5 | secondary text | pass |
| ink-secondary | shell-raised over shell | 8.93 | 4.5 | secondary text on rail cards | pass |
| ink-secondary | chrome over ink | 7.71 | 4.5 | nav label, inactive | pass |
| ink-muted | canvas | 6.13 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | surface-muted | 5.41 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | info-soft | 5.45 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | equity-surface | 5.45 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | spend-surface | 5.66 | 4.5 | meta text, hints, timestamps | pass |
| ink-muted | shell-raised over shell | 5.74 | 4.5 | meta text on rail cards | pass |
| accent-text | canvas | 14.82 | 4.5 | green text | pass |
| accent-text | surface-muted | 13.07 | 4.5 | green text | pass |
| accent-text | surface-strong | 11.64 | 4.5 | green text | pass |
| accent-text | shell | 15.26 | 4.5 | green text | pass |
| accent-text | accent-soft | 11.87 | 4.5 | green text | pass |
| accent-text | equity-surface | 13.18 | 4.5 | green text | pass |
| accent-text | spend-soft | 12.18 | 4.5 | green text | pass |
| accent-text | spend-surface | 13.69 | 4.5 | green text | pass |
| accent-text | info-soft | 13.18 | 4.5 | green text | pass |
| accent-text | warning-soft | 11.95 | 4.5 | green text | pass |
| accent-text | danger-soft | 12.95 | 4.5 | green text | pass |
| link | canvas | 14.82 | 4.5 | inline link | pass |
| link | surface-muted | 13.07 | 4.5 | inline link | pass |
| link | info-soft | 13.18 | 4.5 | inline link | pass |
| link | equity-surface | 13.18 | 4.5 | inline link | pass |
| link-hover | canvas | 16.21 | 4.5 | inline link, hover | pass |
| link-hover | surface-muted | 14.30 | 4.5 | inline link, hover | pass |
| equity-text | canvas | 14.82 | 4.5 | equity words and tile glyphs | pass |
| equity-text | equity-soft | 11.87 | 4.5 | equity words and tile glyphs | pass |
| equity-text | equity-surface | 13.18 | 4.5 | equity words and tile glyphs | pass |
| equity-text | surface-muted | 13.07 | 4.5 | equity words and tile glyphs | pass |
| spend-text | canvas | 12.14 | 4.5 | spend words and tile glyphs | pass |
| spend-text | spend-soft | 9.97 | 4.5 | spend words and tile glyphs | pass |
| spend-text | spend-surface | 11.21 | 4.5 | spend words and tile glyphs | pass |
| spend-text | surface-muted | 10.71 | 4.5 | spend words and tile glyphs | pass |
| success-text | success-soft | 11.87 | 4.5 | success tag | pass |
| success-text | canvas | 14.82 | 4.5 | success tag | pass |
| info-text | info-soft | 13.18 | 4.5 | info tag | pass |
| info-text | canvas | 14.82 | 4.5 | info tag | pass |
| warning-text | warning-soft | 10.00 | 4.5 | waiting and warning text | pass |
| warning-text | canvas | 12.40 | 4.5 | waiting and warning text | pass |
| warning-text | surface-muted | 10.94 | 4.5 | waiting and warning text | pass |
| waiting-text | waiting-soft | 10.00 | 4.5 | waiting tag | pass |
| waiting-text | canvas | 12.40 | 4.5 | waiting tag | pass |
| danger-text | danger-soft | 7.81 | 4.5 | error and refused text | pass |
| danger-text | canvas | 8.94 | 4.5 | error and refused text | pass |
| danger-text | surface-muted | 7.88 | 4.5 | error and refused text | pass |
| on-brand | brand | 17.89 | 4.5 | primary button label | pass |
| on-brand | brand-strong | 19.67 | 4.5 | primary button label | pass |
| on-accent | accent | 4.63 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | accent-strong | 5.78 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | success | 4.63 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-accent | green-900 | 12.50 | 4.5 | white on green fills, the verified check and the solid glass fallback | pass |
| on-danger | danger | 4.52 | 4.5 | destructive button label | pass |
| on-danger | danger-strong | 5.59 | 4.5 | destructive button label | pass |
| border-control | canvas | 4.30 | 3 | input and checkbox boundary | pass |
| border-control | surface-muted | 3.80 | 3 | input and checkbox boundary | pass |
| equity | canvas | 4.23 | 3 | equity segment, dot, icon, chart line | pass |
| equity | surface-muted | 3.74 | 3 | equity segment, dot, icon, chart line | pass |
| equity | surface-strong | 3.33 | 3 | equity segment, dot, icon, chart line | pass |
| equity | shell | 4.36 | 3 | equity segment, dot, icon, chart line | pass |
| equity | equity-surface | 3.76 | 3 | equity segment, dot, icon, chart line | pass |
| spend | canvas | 9.74 | 3 | spend segment, dot, chart bar | pass |
| spend | surface-muted | 8.59 | 3 | spend segment, dot, chart bar | pass |
| spend | surface-strong | 7.65 | 3 | spend segment, dot, chart bar | pass |
| spend | spend-surface | 9.00 | 3 | spend segment, dot, chart bar | pass |
| waiting | canvas | 9.65 | 3 | waiting stripes and icon | pass |
| waiting | surface-muted | 8.51 | 3 | waiting stripes and icon | pass |
| waiting | waiting-soft | 7.78 | 3 | waiting stripes and icon | pass |
| danger | canvas | 4.34 | 3 | error icon and fill | pass |
| danger | danger-soft | 3.79 | 3 | error icon and fill | pass |
| ink-muted | canvas | 6.13 | 3 | icon glyphs | pass |
| ink-muted | surface-muted | 5.41 | 3 | icon glyphs | pass |
| brand | canvas | 17.89 | 3 | selected pill, active tab bar | pass |
| brand | surface-muted | 15.78 | 3 | selected pill, active tab bar | pass |
| success | canvas | 4.23 | 3 | verified check circle | pass |
| chart-spend | canvas | 9.74 | 3 | chart series | pass |
| chart-equity | canvas | 4.23 | 3 | chart series | pass |
| chart-waiting | canvas | 9.65 | 3 | chart series | pass |
| focus | canvas | 14.82 | 3 | focus ring | pass |
| focus | surface-muted | 13.07 | 3 | focus ring | pass |
| focus | surface-strong | 11.64 | 3 | focus ring | pass |
| focus | shell | 15.26 | 3 | focus ring | pass |
| focus | accent-soft | 11.87 | 3 | focus ring | pass |
| focus | equity-surface | 13.18 | 3 | focus ring | pass |
| focus | spend-soft | 12.18 | 3 | focus ring | pass |
| focus | spend-surface | 13.69 | 3 | focus ring | pass |
| focus | info-soft | 13.18 | 3 | focus ring | pass |
| focus | warning-soft | 11.95 | 3 | focus ring | pass |
| focus | danger-soft | 12.95 | 3 | focus ring | pass |
| focus | chrome over ink | 11.98 | 3 | focus ring in the nav bar | pass |
| focus | accent | 3.49 | 3 | focus ring on green fills | pass |
| focus | accent-strong | 4.35 | 3 | focus ring on green fills | pass |
| focus | green-500 | 3.49 | 3 | focus ring on green fills | pass |
| focus | green-800 | 7.28 | 3 | focus ring on green fills | pass |
| focus-inverse | brand | 17.89 | 3 | inset focus ring on the white pill | pass |
| focus-inverse | brand-strong | 19.67 | 3 | inset focus ring on the white pill | pass |
| brand | surface | 16.87 | 3 | selected pill and switch on cards | pass |
| brand | surface-muted | 15.78 | 3 | selected pill and switch on cards | pass |

| Surface | Stops or composite | Foreground | Worst ratio | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- | --- |
| gradient-feature | #008561, #007456, #0D4E3C | on-accent | 4.63 | 4.5 | feature card text | pass |
| gradient-feature | #008561, #007456, #0D4E3C | focus | 3.49 | 3 | focus ring on the feature card | pass |
| gradient-accent-deep | #007456, #0D4E3C | on-accent | 5.78 | 4.5 | text on the deep band | pass |
| gradient-accent-deep | #007456, #0D4E3C | focus | 4.35 | 3 | focus ring on the deep band | pass |
| gradient-hero | #08281F, #0C3B2D | ink | 11.37 | 4.5 | text on the green wash | pass |
| gradient-hero | #08281F, #0C3B2D | ink-secondary | 6.06 | 4.5 | secondary text on the green wash | pass |
| gradient-hero | #08281F, #0C3B2D | focus | 9.42 | 3 | focus ring on the green wash | pass |
| gradient-apricot | #1C140E, #2E1D10, #3D2613 | ink | 12.86 | 4.5 | text on the apricot wash | pass |
| gradient-apricot | #1C140E, #2E1D10, #3D2613 | ink-secondary | 6.85 | 4.5 | secondary text on the apricot wash | pass |
| gradient-apricot | #1C140E, #2E1D10, #3D2613 | focus | 10.66 | 3 | focus ring on the apricot wash | pass |
| glass-deep over white | #507268 | on-accent | 5.31 | 4.5 | white text on deep glass | pass |
| glass-deep over white | #507268 | focus-inverse | 3.69 | 3 | focus ring on deep glass | pass |
| glass-light over white | #373738 | ink | 10.81 | 4.5 | text on dark glass | pass |
| glass-light over white | #373738 | ink-secondary | 5.76 | 4.5 | secondary text on dark glass | pass |
| glass-light over white | #373738 | focus | 8.96 | 3 | focus ring on dark glass | pass |

| Pair | Hex | Measure | Value | Needs | Use | Result |
| --- | --- | --- | --- | --- | --- | --- |
| spend and equity | #FFA053, #008561 | cvd | protan 17.2, deutan 27.7 (OKLab x100) | 8 | spend and equity segments side by side, protan and deutan | pass |
| spend and equity | #FFA053, #008561 | normal | 32.1 (OKLab x100) | 15 | spend and equity segments, full color vision | pass |
| spend and waiting | #FFA053, #E3AD3C | de2000 | 13.9 (CIEDE2000) | 10 | spend mark and waiting stripes; waiting is also always hatched | pass |
| spend and danger | #FFA053, #D93B3B | de2000 | 29.6 (CIEDE2000) | 15 | spend mark and the danger red | pass |
| equity and waiting | #008561, #E3AD3C | cvd | protan 19.5, deutan 27.1 (OKLab x100) | 8 | equity segment beside the waiting stripes, protan and deutan | pass |

| Foreground | Background | Ratio | Why it does not matter |
| --- | --- | --- | --- |
| spend | equity | 2.29 | spend and equity segments: a 2px gap, hue and the color-vision distance above separate them |
| equity | waiting | 2.27 | equity and waiting segments: a 2px gap and the waiting stripes separate them |
| on-accent | spend | 2.01 | no text on the spend fill; spend words use spend-text on a tint |
| on-accent | green-300 | 1.32 | never white on mint: mint carries ink |
| ink-muted | accent-soft | 4.91 | not allowed: use ink-secondary on the green-100 tint |
| ink-muted | spend-soft | 5.04 | not allowed: use ink-secondary on the apricot-100 tint |
| ink-muted | surface-strong | 4.81 | not allowed: use ink-secondary on surface-strong |
| ink-muted | shell | 6.31 | not allowed: use ink-secondary on the shell |
| border-control | surface-strong | 3.38 | not allowed: inputs sit on canvas or surface-muted |
| warning | canvas | 9.65 | warning fill is not a text color: text uses warning-text |
| danger | danger-soft | 3.79 | danger fill is not a text color on its soft tint: text uses danger-text |
| border-strong | canvas | 1.52 | hairline divider, decorative |
| focus | brand | 1.20 | the mint ring sits 2 px outside the white pill, on the surface; inset rings on the pill use focus-inverse |
| accent-strong | accent-soft | 2.72 | accent-strong is a fill in the dark theme; green words use accent-text |

Result: pass, 511 checks, 0 failures.

## 4. Typography

### 4.1 Fonts

| Role | Family | Weights | How it loads |
| --- | --- | --- | --- |
| Sans | Instrument Sans | 400, 500, 600, 700 (variable, wght 400 to 700) | next/font/google, variable --font-instrument-sans, read by --font-sans |
| Mono | IBM Plex Mono | 400, 500 | next/font/google, variable --font-ibm-plex-mono, read by --font-mono |

Both are the fonts closeout already loads, with the same next/font calls (section 13.1), and both are free on Google Fonts. No other family is used. Instrument Sans ships proportional digits by default and includes the `tnum` feature (checked in the font file closeout serves), so every amount, count and time sets `tabular-nums`.

### 4.2 Scale

Display, h1 and figure-l scale with the viewport through clamp(): the first size is at 360 px, the second is the cap and the width where it is reached.

| Step | Tailwind | Size | Leading | Tracking | Weight | Use |
| --- | --- | --- | --- | --- | --- | --- |
| display-xl | text-display-xl | 40 px to 76 px at 1170 px | 1.02 | -0.035em | 500 | Marketing hero headline |
| display-l | text-display-l | 32 px to 52 px at 1170 px | 1.06 | -0.032em | 500 | Marketing section headings, final call to action |
| h1 | text-h1 | 25 px to 30 px at 768 px | 1.15 | -0.025em | 600 | Page title in the app |
| h2 | text-h2 | 21 px | 1.25 | -0.014em | 600 | Section title in a page, sheet and dialog title |
| h3 | text-h3 | 16 px | 1.35 | -0.012em | 600 | Card and module titles, empty state title |
| figure-l | text-figure-l | 32 px to 38 px at 630 px | 1.1 | -0.03em | 600 | The payment amount on the split card |
| figure-m | text-figure-m | 28 px | 1.15 | -0.028em | 600 | Sleeve balances, stat tiles |
| figure-s | text-figure-s | 21 px | 1.2 | -0.02em | 600 | Split legend amounts, totals in rows |
| body-l | text-body-l | 15 px, 17 px from 768 px | 1.6 | | inherits | Marketing lead paragraphs |
| body | text-body | 15 px | 1.55 | | inherits | Default text, button labels |
| body-s | text-body-s | 13 px | 1.5 | | inherits | Secondary text, hints, list meta, the debt security line |
| label | text-label | 12 px | 1.25 | 0.005em | inherits, use 500 | Status tags, dense field labels |
| micro | text-micro | 11 px | 1.25 | 0.02em | inherits, use 500 | Bottom navigation labels, chart axes |
| mono | text-mono | 13 px | 1.5 | | inherits | Payment address, hashes in running layouts |
| mono-s | text-mono-s | 12 px | 1.5 | | inherits | Receipt field values |
| input | text-input | 16 px | 1.25 | | inherits | Every text input and select |

Headings, display and figures carry their weight in the token. Body steps leave weight alone, so `<strong className="text-body-s">` stays bold. Add `font-medium` or `font-semibold` where a body step needs weight.

### 4.3 Rules

- Sentence case everywhere except status tags, which show the onchain status name (section 12.3).
- Line length stops at `max-w-reading` (680 px, about 75 characters of body text).
- Nothing below 11 px. Anything a person reads to decide something is 12 px or larger.
- Inputs and selects are 16 px. Smaller text makes iOS Safari zoom into the field.
- Mono only for machine values: addresses, hashes, receipt ids, round ids, raw integer units, block numbers. Never for labels or prose.
- "Robinhood Chain" is set in the same size, weight and color as the text around it, both words alike, never italic and never split across styles. "Stock Tokens" is capitalized when it names the product.

## 5. Spacing and sizes

The base unit is 4 px. Spacing tokens use Tailwind's key names, so `p-4` and `var(--space-4)` are the same 16 px. Use the Tailwind utility in components and the variable in plain CSS.

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| --space-0-5 | 2 | | --space-6 | 24 |
| --space-1 | 4 | | --space-7 | 28 |
| --space-1-5 | 6 | | --space-8 | 32 |
| --space-2 | 8 | | --space-9 | 36 |
| --space-2-5 | 10 | | --space-10 | 40 |
| --space-3 | 12 | | --space-12 | 48 |
| --space-3-5 | 14 | | --space-14 | 56 |
| --space-4 | 16 | | --space-16 | 64 |
| --space-5 | 20 | | --space-20 | 80 |
| | | | --space-24 | 96 |

Closeout's CSS also used 9, 11, 13, 18, 22 and 26 px. Ported patterns round those to the nearest step.

Layout tokens step up with the viewport inside tokens.css, so one utility covers every width.

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| --layout-gutter | px-gutter | 16 px, 20 px from 768, 26 px from 1024, 36 px from 1440 | Page side padding |
| --layout-section | py-section | 64 px, 104 px from 768 | Space between marketing sections |
| --layout-stack | gap-stack | 16 px | Gap between modules and cards |
| --layout-card-padding | p-card | 16 px, 20 px from 768 | Padding inside cards, modules and sheets |
| --layout-content | max-w-content | 1200 px | Marketing container |
| --layout-reading | max-w-reading | 680 px | Text measure |
| --layout-form | max-w-form | 860 px | Forms and flows on wide screens |
| --layout-dialog | max-w-dialog | 480 px | Dialogs from 768 |
| --layout-toast | max-w-toast | 400 px | Toasts from 768 |
| --layout-sheet-max | max-h-sheet | 90 percent of the dynamic viewport height | Bottom sheets |
| --layout-rail | w-rail | 262 px | Navigation rail from 1024 |
| --layout-rail-compact | w-rail-compact | 224 px | Navigation rail from 768 to 1023 |
| --layout-topbar | min-h-topbar, h-topbar | 62 px, 68 px from 768 | Top bar |
| --layout-bottom-nav | min-h-bottom-nav, h-bottom-nav | 68 px plus the safe area | Bottom navigation |

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| --size-touch | min-h-touch, min-w-touch, size-touch | 44 px | Smallest target for anything tappable |
| --size-control-sm | h-control-sm, min-h-control-sm | 40 px | Filter pills, small buttons |
| --size-control | h-control, min-h-control | 44 px | Buttons |
| --size-control-lg | h-control-lg, min-h-control-lg | 48 px | Inputs, marketing buttons, the main action of a flow |
| --size-icon | size-icon | 20 px | Icons |
| --size-icon-tile | size-icon-tile | 42 px | Icon tiles in stat tiles and rows |
| --size-avatar | size-avatar | 34 px | Account avatar |

## 6. Radii

| Token | Tailwind | px | Use |
| --- | --- | --- | --- |
| --radius-xs | rounded-xs | 6 | Skeleton lines, small marks |
| --radius-control | rounded-control | 10 | Inputs, selects, tags, icon buttons |
| --radius-row | rounded-row | 14 | Row cards, icon tiles, notes |
| --radius-panel | rounded-panel | 16 | Lists, panels, empty and loading states |
| --radius-module | rounded-module | 18 | App cards and modules, stat tiles, toasts |
| --radius-large | rounded-large | 20 | Form cards, stepper |
| --radius-workspace | rounded-workspace | 22 | The workspace panel from 768, the app card in marketing |
| --radius-card | rounded-card | 24 | Marketing panels, dialogs |
| --radius-sheet | rounded-sheet | 28 | Top corners of bottom sheets |
| --radius-pill | rounded-pill | 999 | Buttons, filter pills, chips, rail segments, avatars |

A child inside a padded rounded container uses at most the outer radius minus the padding.

## 7. Shadows and elevation

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| --shadow-soft | shadow-soft | 0 1px 3px rgba(11, 11, 12, 0.05) | Eyebrow pills, chips that float |
| --shadow-card | shadow-card | 0 1px 2px / 0.04, 0 6px 18px / 0.05 | A card that is one selectable object |
| --shadow-raised | shadow-raised | 0 1px 2px / 0.06, 0 4px 12px / 0.05 | Active rail item |
| --shadow-workspace | shadow-workspace | 0 1px 2px / 0.04, 0 8px 24px / 0.04 | The workspace panel |
| --shadow-floating | shadow-floating | 0 12px 40px / 0.10 | Toasts, floating cards in marketing art |
| --shadow-overlay | shadow-overlay | 0 12px 40px / 0.16 | Sheets, dialogs, menus |

All shadows use ink rgba(11, 11, 12, alpha). Rows in a list never carry a shadow: a list is a register, separated by hairlines. Only a bounded object (a sleeve card, a holding, a floating layer) is elevated.

## 8. Borders, surfaces and layers

- Borders are 1 px border-border by default. 2 px is reserved for the focus ring and the active tab bar.
- A dashed 1 px border marks something that is not there yet. Empty states and loading panels keep closeout's dashed border-border. Gated features use dashed border-strong, so they read as deliberately unavailable rather than empty.
- On a phone the page is canvas. From 768 px the app sits on the shell, with the workspace as a white panel (`rounded-workspace shadow-workspace`, 12 px margin), as in closeout.
- Nest surfaces one step at a time: surface cards on canvas, surface-muted panels inside surface cards. Never surface-muted inside surface-muted.

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| --z-sticky | z-sticky | 30 | Sticky headers inside a page |
| --z-nav | z-nav | 40 | Bottom navigation |
| --z-header | z-header | 50 | Marketing header |
| --z-overlay | z-overlay | 60 | Scrim, sheets, dialogs |
| --z-toast | z-toast | 70 | Toasts |

## 9. Layout grid and breakpoints

Breakpoints are Tailwind's defaults, min-width, mobile first: sm 640, md 768, lg 1024, xl 1280, 2xl 1536. Closeout's product.css used max-width queries at 767, 1100 and 1279, which map to below md, below lg and below xl, and a min-width query at 1440, which survives as the widest gutter step in tokens.css.

| Width | App shell |
| --- | --- |
| Below 768 | One column. Top bar, content with the 16 px gutter, fixed bottom navigation. The shell is canvas |
| 768 to 1023 | Compact rail (224 px) on the shell, white workspace panel |
| 1024 and up | Full rail (262 px) |
| 1280 and up | Two-column module rows (0.9fr and 1.1fr); stat rows go four across (two across below 1280, one below 768) |

Marketing uses `max-w-content` with the gutter, hero panels in one column below 1024 and in 0.78fr and 1.22fr above, and `py-section` between sections.

At 360 px the content box is 328 px:

- No fixed width above 328 px below 768. The rail is hidden, cards are full width.
- No tables below 768. Closeout's `min-width: 620px` table rule is not carried over. Use ruled lists, row cards or definition lists.
- Long machine values wrap anywhere (`break-all`). Amounts never break inside the number; the unit may wrap to the next line.
- Two figures side by side (the split legend) wrap to a stack when they do not fit (`flex flex-wrap`).

## 10. Motion

| Token | Tailwind | Value | Use |
| --- | --- | --- | --- |
| --duration-fast | duration-fast | 140 ms | Color and border changes on hover, press, select |
| --duration-standard | duration-standard | 220 ms | Toasts, sheets, dialogs, menus entering and leaving |
| --duration-narrative | duration-narrative | 360 ms | The split resolving on a new payment |
| --ease-standard | ease-standard | cubic-bezier(0.2, 0.8, 0.2, 1) | Everything that enters or changes (closeout's easing) |
| --ease-exit | ease-exit | cubic-bezier(0.4, 0, 1, 1) | Things that leave |
| --motion-distance | none | 8 px, 0 with reduced motion | How far a toast or menu travels while it fades |
| --motion-sheet-offset | none | 100 percent, 0 with reduced motion | Where a bottom sheet starts |

One moment moves on purpose: when a payment's split appears for the first time, the equity segment grows from zero to its width over 360 ms. Everything else answers a person's action. List rows never animate on load, nothing loops, skeletons do not shimmer. With reduced motion the distance tokens drop to zero, so travel becomes a plain fade, and the split appears at its final width.

## 11. Components

Class recipes use the theme's utilities. Every interactive element gets the base layer's focus ring (section 13.3) without extra classes.

### 11.1 Buttons

Text buttons are pills, as on closeout's marketing pages, rail and queue actions. Closeout's Button component used 10 px corners; Sleeve standardizes on the pill.

| Variant | Classes | Use |
| --- | --- | --- |
| Primary | `bg-brand text-on-brand hover:bg-brand-strong` | The one main action of a screen |
| Secondary | `bg-surface text-ink border border-border-strong hover:bg-surface-muted hover:border-ink-muted` | Other actions |
| Ghost | `bg-transparent text-ink-secondary hover:text-ink` | Low-weight actions in toolbars |
| Destructive | `bg-danger text-on-danger hover:bg-danger-strong` | Actions that remove something, such as uninstalling Sleeve |

Shared: `inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-colors duration-fast ease-standard disabled:opacity-disabled disabled:cursor-not-allowed`. Sizes: small `min-h-control-sm px-4 text-body-s`, default `min-h-control px-5 text-body`, large `min-h-control-lg px-6 text-body`. On a phone the main action of a flow is full width at the bottom of the content.

Icon buttons are `size-touch rounded-control` ghost buttons with an `aria-label`. While an action runs, the button keeps its width, sets `aria-busy="true"` and changes its label to the verb in progress ("Releasing"). There are no green buttons.

### 11.2 Inputs

- Label above the field: `text-body-s font-semibold text-ink`, 8 px gap, connected with `htmlFor`.
- Field: `w-full min-h-control-lg rounded-control border border-border-control bg-surface px-3.5 text-input text-ink placeholder:text-ink-muted hover:border-ink-secondary`.
- Hint below: `mt-2 text-body-s text-ink-muted`.
- Error: `aria-[invalid=true]:border-danger` on the field and a message below in `text-body-s text-danger` with a leading "!" mark, linked by `aria-describedby`. The message says what to change.
- Disabled: `disabled:bg-surface-muted disabled:text-ink-secondary`.
- Amounts: `inputMode="decimal"`, `tabular-nums`, the unit (USDG, percent) inside the field on the right in `text-ink-secondary`.
- Select: the field recipe plus `appearance-none` and a 12 px chevron in ink-secondary, 12 px from the right edge.
- Checkboxes and radios: native inputs at `size-5`, green from `accent-color`, label in `text-body` on a row of at least `min-h-touch`.

### 11.3 Cards

| Pattern | Classes | Notes |
| --- | --- | --- |
| Panel | `rounded-panel border border-border bg-surface` | Optional header: `flex items-center justify-between border-b border-border px-4 py-3` with a `text-h3` title |
| Module | `rounded-module border border-border bg-surface p-card` | The default app card |
| Stat tile | `rounded-module border border-border bg-surface-muted` | Icon tile `size-icon-tile rounded-row bg-surface`, label `text-body-s text-ink-secondary`, value `text-figure-m tabular-nums` |
| Selectable card | Module plus `shadow-card` | Only when the whole card is one object you open |
| Note | `rounded-row border border-accent-border bg-info-soft p-4` | Title `text-body-s font-semibold text-ink`, body `text-body-s text-ink-secondary` |
| Warning banner | `rounded-row bg-warning-soft p-4` | Amber icon, title in ink, body in ink-secondary |
| Error block | `flex gap-4 rounded-module border border-border bg-surface p-5` | Symbol tile `size-9 rounded-row bg-danger-soft text-danger`. Says what failed and that the USDG is still in the account (PRD 15), then a secondary "Try again" |

### 11.4 Lists

- Ruled list (receipts, inbox, history): `overflow-hidden rounded-panel border border-border bg-surface`, rows separated by `border-t border-border` (none on the first), row padding `px-4 py-3.5`, from 768 `px-5 py-4`, hover `bg-surface-muted`. Because the list clips, rows draw their focus ring inside with `-outline-offset-2`.
- Row anatomy: leading status tag or icon tile, title `text-body font-medium`, meta `text-body-s text-ink-muted`, trailing amount `text-body font-semibold tabular-nums text-right`.
- Row cards, for items that ask for a decision (a bucket waiting five days): each row `rounded-row border border-border p-4`, 10 px apart, hover `border-border-strong`.
- Definition lists for receipt fields: term `text-body-s text-ink-secondary`, value `text-body-s text-ink`, machine values `font-mono text-mono-s break-all`, hairline between rows. Below 768 the term sits above the value.

### 11.5 Tabs, filters and choices

- Tabs switch sections of one page: a row of buttons `min-h-touch text-body-s font-medium text-ink-secondary`, the active one `text-ink font-semibold border-b-2 border-brand`. Use `role="tablist"`, `tab` and `tabpanel` with arrow-key movement. Four tabs at most on a phone; beyond that use a select.
- Filter pills narrow a list: `min-h-control-sm rounded-pill border border-border bg-surface px-4 text-body-s text-ink-secondary hover:border-border-strong`, pressed `aria-pressed="true"` with `bg-brand border-brand text-on-brand`. They wrap, never scroll the page.
- Exclusive choices (the equity share presets in the rule editor, for example) use the filter pill look with radio semantics: `role="radiogroup"` and `role="radio"` with `aria-checked`.

### 11.6 Badges and tags

- Status tag: `inline-flex items-center gap-1 rounded-control border border-border px-2 py-0.5 text-label font-medium uppercase tracking-caps` plus a tone from section 12.3. The text is the onchain status with spaces for underscores: FILLED, QUEUED, REFUSED TICKER, PART SOLD.
- Gated tag: "Not available yet", `rounded-control border border-dashed border-border-strong bg-surface-muted px-2 py-0.5 text-label font-medium text-ink-secondary`, sentence case.
- Ticker chip: `inline-flex items-center rounded-pill border border-border bg-surface px-2.5 text-label font-semibold text-ink`, the ticker symbol only. No company or issuer logos.
- Count badge: `rounded-pill bg-surface-strong px-2 text-label font-semibold text-ink-secondary tabular-nums`.

### 11.7 Toasts

- Bottom center on a phone, above the bottom navigation and the safe area; bottom right from 768 inside the gutter. Full width minus the gutter on a phone, `max-w-toast` above.
- `rounded-module border border-border bg-surface shadow-floating px-4 py-3 text-body-s text-ink`, an 8 px tone dot at the start, an optional action as a link.
- `role="status"` for confirmations, `role="alert"` for errors. Confirmations close after 6 seconds unless they hold an action; errors stay until dismissed. Hover and focus pause the timer. One toast at a time.
- Enter with a fade and `translateY(var(--motion-distance))` over 220 ms.
- A toast confirms; the receipt records. Never put a number only in a toast.

### 11.8 Empty states

Closeout's pattern: `flex flex-col items-center gap-3 rounded-panel border border-dashed border-border px-4 py-10 text-center`, from 768 `px-8 py-16`. Title `text-h3`, one line of `text-body text-ink-secondary` within `max-w-reading`, one action. An empty screen says what to do next. Before the first payment that is: nothing splits until USDG arrives from outside, then the payment address with a copy button (PRD 15).

### 11.9 Loading and skeletons

- Whole views use closeout's loading panel: the empty state box with `text-body text-ink-muted` naming what loads ("Loading receipts").
- Known layouts use skeleton blocks: `bg-skeleton`, `rounded-xs` for text lines, the real radius for blocks, the exact size of the content. No shimmer. The container sets `aria-busy="true"` and carries a visually hidden label.
- Never render 0.00 while an amount loads.

### 11.10 Sheets and dialogs

- Below 768: a bottom sheet, `fixed inset-x-0 bottom-0 z-overlay max-h-sheet overflow-y-auto rounded-t-sheet bg-surface shadow-overlay p-card`, with bottom padding that clears the safe area. It enters from `translateY(var(--motion-sheet-offset))` over 220 ms with `ease-standard`. Closeout's floating More menu becomes this sheet.
- From 768: a centered dialog, `max-w-dialog rounded-card bg-surface shadow-overlay p-6`.
- Both sit on `bg-scrim`, trap focus, close on Escape and on the scrim, return focus to the trigger, set `aria-modal="true"` and take their name from the `text-h2` title.
- A confirmation says what moves, where it goes, and that the money stays in the owner's account. Actions sit at the bottom, primary last on wide screens and full width on a phone.

### 11.11 Navigation

- Bottom navigation, below 768: `fixed inset-x-0 bottom-0 z-nav bg-chrome backdrop-blur-lg border-t border-border`, height `min-h-bottom-nav` plus `env(safe-area-inset-bottom)`. Three destinations plus More, as in closeout. Each item is a column with a 20 px icon over a `text-micro font-medium` label, at least `min-h-touch`. Inactive `text-ink-secondary`; active `text-ink font-semibold bg-surface-muted rounded-row` with `aria-current="page"`. Gated features never appear here.
- Rail, from 768: on the shell, `w-rail-compact`, `lg:w-rail`. The wordmark at the top, then an account card (`bg-shell-raised rounded-row`) with the short payment address, then items `min-h-control-lg rounded-row px-3.5 text-ink-secondary hover:bg-shell-raised hover:text-ink`, active `bg-surface shadow-raised text-ink font-semibold`.
- Top bar: `min-h-topbar px-gutter border-b border-border`, the page title or a breadcrumb in `text-body-s text-ink-muted` with the current page in ink. Closeout's back and forward chevrons are dropped below 768.
- Set `viewportFit: "cover"` in the root viewport so the safe-area insets exist.

### 11.12 Icons

20 px line icons, 1.5 px stroke, round caps and joins, `currentColor`, the stroke style of closeout's provider glyphs. No feather or quill shapes anywhere (Robinhood's mark). No lock, shield or fingerprint imagery as decoration. Icons that carry meaning have a text label beside them or an `aria-label`.

## 12. Sleeve patterns

### 12.1 The split rail

Sleeve's signature, adapted from closeout's relationship rails and device bar. One payment, one bar: spend on the left, the equity share on the right.

- Container: `flex h-3 w-full gap-0.5` on the card surface. The 2 px gap shows the surface between segments.
- Spend segment: `h-full rounded-pill bg-spend`, width = spend share.
- Equity bought: `h-full min-w-1.5 rounded-pill bg-equity`.
- Equity waiting: `h-full min-w-1.5 rounded-pill bg-waiting-stripes`.
- Refused or released equity counts as spend: the money is spendable, so the bar shows it as spend and the tag explains.
- In list rows the rail is `h-1` and has no legend.
- The rail is `aria-hidden="true"`. The legend is the accessible text: each part shows its amount in `text-figure-s tabular-nums` (`text-spend` for spend, `text-equity` for bought, `text-waiting` for waiting) over a plain label in `text-body-s text-ink-secondary`: "spendable", "became SPY", "waiting: market closed". The legend wraps to a stack when the amounts do not fit side by side.
- The 6 px minimum keeps a 1 percent share visible. The numbers stay exact.

The home screen leads with this card for the latest payment, then the two sleeves, then the payment address (PRD 15).

### 12.2 Amounts

- Number, then unit: "450.00 USDG", "0.0718 SPY". USDG shows two decimals on cards and full precision in the receipt.
- Always `tabular-nums`, with thousands separators. Never truncated.
- Direction is a word, not a sign or a color: received, sent, became, moved to spend.
- The premium is a sentence in `text-body-s text-ink-secondary`: "Bought 0.10 percent above the market reference." Never green or red.
- Pool price and feed price are separate lines, each with its time (PRD 7.11).

### 12.3 Status tones

| Onchain status | Tone | Tag classes | What the plain line covers |
| --- | --- | --- | --- |
| FILLED, SETTLED | equity | `bg-equity-soft text-equity` | What was bought, for how much, the premium |
| QUEUED | waiting | `bg-waiting-soft text-waiting` | The reason in plain words and when it will try again, with the release action |
| REFUSED TICKER, REFUSED ACCOUNT | danger | `bg-danger-soft text-danger` | Why the buy did not happen and that the USDG went to spend |
| RECONCILED | waiting | `bg-waiting-soft text-waiting` | That USDG left the account outside Sleeve and how the ledgers were corrected |
| RELEASED, PART SOLD, SOLD | neutral | `bg-surface-strong text-ink-secondary` | What moved to spend, or what was sold and for how much |

A verified receipt shows a `bg-success` circle with a white check and "Matches chain data". A mismatch shows a danger block that lists every field that differs (PRD 10: shown, never smoothed).

### 12.4 Receipt

1. Header: status tag, then one plain sentence built from the receipt's own numbers.
2. Key numbers: USDG in, to spend, to equity (spent or queued), tokens out, execution price, the premium sentence.
3. Directly under the token amount, the debt security line (12.5).
4. Every receipt field as a definition list (11.4). Machine values in mono. Fields derived from logs carry the word "derived" after the label (PRD 10).
5. The disclosure hash links to the disclosure block (12.6).
6. "Recompute this receipt" as an underlined `text-link`, leading to the verifier page.
7. Copy buttons for ids and hashes: icon buttons with an `aria-label` and a "Copied" toast.

### 12.5 Holdings, the debt security line and the exit line

- Every holding and every receipt shows "debt security, not a share" in `text-body-s font-medium text-ink-secondary`, directly under the token amount or ticker. Never in a tooltip, never truncated, never hidden behind a toggle.
- The holding detail shows the exit line in `text-body-s text-ink-secondary` beside the sell action: "Sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and pays cash, not shares. Sleeve offers no redemption."

### 12.6 Issuer disclosure block

- `rounded-panel bg-surface-muted p-card`. Title "Issuer disclosure" in `text-h3`.
- A source line in `text-body-s text-ink-secondary`: copied word for word from docs.robinhood.com/rhj, retrieved 2 October 2026.
- The keccak256 hash in full: `font-mono text-mono-s break-all text-ink-secondary` with a copy button. Today 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89 (docs/disclosure/README.md).
- The text from docs/disclosure/rhj-disclosure.txt, one `<p>` per line of the file, `text-body-s text-ink max-w-reading space-y-3`. No bold, links, edits or truncation inside it.

### 12.7 Payment address

- The receive screen shows all 42 characters in `font-mono text-mono break-all`, with copy and share buttons. The full address is always visible as text, never only as a QR code.
- Elsewhere the short form is the first 6 and last 4 characters, as in 0x1234…abcd, with the full value on copy.
- The network line is plain text in `text-body-s text-ink-secondary`: "Robinhood Chain, chain id 4663".

### 12.8 Gated features

Borrow, the pay link (same chain and cross chain), baskets and crews are not live. If a screen shows one at all, it is a `rounded-module border border-dashed border-border-strong bg-surface-muted p-card` card with the gated tag (11.6), no button, no numbers and at most one line on what it will do. Never in navigation, never on the home screen as an action.

### 12.9 Brand, Robinhood Chain and the footer

- The wordmark is the word "Sleeve" in `text-h2 text-ink`. It is the most prominent brand on every screen, and no Robinhood Chain mention is larger or heavier on the same screen.
- No Robinhood logo, no feather and none of Robinhood's colors. Section 3 checks that #CCFF00, #00C805, #21CE99 and #17AD7B are nowhere near the palette.
- Nothing implies a partnership. "Robinhood Chain" appears only as the network the product runs on.
- Every page's footer carries the disclaimer word for word, in `text-body-s text-ink-secondary`, never collapsed: "Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc."
- Marketing pages keep closeout's composition: eyebrow pill, hero headline (`text-display-xl`, about 15 characters per line, as closeout's `max-width: 15ch`) and lead (`text-body-l`), two pill buttons, then an art-neutral panel with floating white notification cards beside a `bg-stage` panel carrying the app card. The eyebrow mark is a 14 by 6 px split rail (apricot and green) instead of closeout's asterisk.

## 13. Wiring

### 13.1 Fonts and tokens in the root layout

```ts
// app/src/app/fonts.ts, the same calls as closeout's app/fonts.ts
import { Instrument_Sans, IBM_Plex_Mono } from "next/font/google";

export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});
```

```tsx
// app/src/app/layout.tsx
import type { Viewport } from "next";
import { THEME_BOOT_SCRIPT } from "@/styles/theme";
import { instrumentSans, ibmPlexMono } from "./fonts";
import "../styles/tokens.css";
import "./globals.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", colorScheme: "light dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${ibmPlexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

The font variable classes go on `<html>`, because tokens.css resolves `--font-sans` on :root. The boot script sets `data-theme` on `<html>` before first paint (section 14).

### 13.2 Tailwind config

```ts
// app/tailwind.config.ts
import type { Config } from "tailwindcss";
import sleeveTheme from "./src/styles/tailwind-theme.cjs";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: { colors: {}, extend: sleeveTheme },
  plugins: [],
};

export default config;
```

`colors: {}` removes Tailwind's stock palette. Spacing, font sizes, radii and screens keep their stock keys; the theme only adds names. tailwind-theme.d.cts types the default import, so the config passes `tsc --strict` without `allowJs`.

Checked on 3 October 2026 with Tailwind 3.4.19 and TypeScript 5.9.3: the config builds, the version 2 utilities (bg-hero, bg-stage, bg-step, bg-feature, bg-apricot, bg-glass-deep, backdrop-blur-glass, text-spend, bg-spend-surface, border-spend-border, fill-chart-spend, stroke-chart-grid) generate, `bg-blue-500`, `text-green-600`, `text-white` and `text-warning-soft` generate nothing, and every variable the theme references exists in tokens.css.

### 13.3 Base layer

globals.css holds the three Tailwind directives and this base layer:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html {
    -webkit-tap-highlight-color: transparent;
  }

  body {
    background-color: var(--color-canvas);
    color: var(--color-ink);
    font-family: var(--font-sans);
    font-size: var(--text-body-size);
    line-height: var(--text-body-leading);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  :focus-visible {
    outline: var(--focus-ring-width) solid var(--color-focus);
    outline-offset: var(--focus-ring-offset);
  }

  ::selection {
    background-color: var(--color-selection);
    color: var(--color-ink);
  }

  input,
  select,
  textarea {
    font-size: var(--text-input-size);
  }

  input::placeholder,
  textarea::placeholder {
    color: var(--color-ink-muted);
    opacity: 1;
  }

  input:-webkit-autofill {
    -webkit-text-fill-color: var(--color-ink);
    box-shadow: 0 0 0 1000px var(--color-canvas) inset;
  }

  :disabled {
    cursor: not-allowed;
  }
}
```

On brand or green fills, switch the ring with `focus-visible:outline-focus-inverse`. Rows inside clipping lists use `-outline-offset-2`.

### 13.4 Guardrails

These should print nothing. Add them to CI next to the copy lint.

```sh
# Raw colors in components
grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|color-mix\(' app/src --include='*.ts' --include='*.tsx' --include='*.css' | grep -v '^app/src/styles/'

# Arbitrary color utilities
grep -rnE '\b(bg|text|border|ring|outline|fill|stroke|from|via|to|decoration|shadow|accent|caret|divide|placeholder)-\[(#|rgb|hsl|oklch|color|var\(--palette)' app/src

# Palette primitives outside the tokens file
grep -rn -- '--palette-' app/src | grep -v '^app/src/styles/'
```

`node scripts/contrast-check.mjs` exits 1 when any claimed pair falls below its threshold, a green step leaves HSL hue 150 to 170 or an apricot step leaves 18 to 34, a green-400 appears, a color literal turns blue or lands near a Robinhood color, and exits 2 when a token is missing.

## 14. Dark theme

D-029 adds a dark theme next to the closeout light theme. The owner's dark fintech dashboard (internal/design-refs/dashboard-dark.png, private) sets the look; its colors were sampled with Pillow. Sleeve takes its structure of darks and its white pill, and keeps its own green where the reference uses blue.

| Reference, sampled | Sleeve token, dark |
| --- | --- |
| Page #080808, frame #070707 | shell #060607 behind the rail, canvas #0B0B0D for the page and the workspace panel |
| Cards #111113, hairline #1C1C1E | surface #131316, border #232328, border-strong #313137 |
| Inner panels #18181A to #1D1D1F, chips #252527 | surface-muted #1A1A1E, surface-strong #242429 |
| Text #FFFFFF, #BABABC, #8C8B8E | ink #F4F4F5, ink-secondary #B4B4BB, ink-muted #8F8F98 |
| Selected pill white with black text | brand #F4F4F5, on-brand #0B0B0C: the primary button and every selected state turn white |
| Blue accent #6989DB | green stays: fills green-500 #008561, which still carries white at 4.63, words, links and the focus ring green-300 #8FF3C9 |
| Status green #0BBA6D, orange #FB7F2D, red #F53C3E | Not used: they sit near Robinhood's greens or read as the spend apricot. Spend is apricot-400 #FFA053, waiting amber #E3AD3C, danger #D93B3B with danger-text #FF8F8A |

How it switches. `data-theme` on `<html>` selects the theme. A boot script (app/src/styles/theme.ts), inlined in the root layout's head, sets it before first paint from the owner's choice in localStorage (`sleeve:theme`, light or dark) or, with no choice, from `prefers-color-scheme`, and keeps it in step with the system and with other tabs. `<html>` carries suppressHydrationWarning for that one attribute. The top bar has a light and dark toggle from 768 px; Settings and the phone's More sheet offer System, Light and Dark, with System the default. lib/settings.ts holds the choice.

Rules that change in the dark theme:

- Depth goes up in lightness: shell, then the canvas workspace, then cards. The workspace panel is `bg-canvas` in both themes, which is white in light.
- Shadows barely read on black. The workspace and raised rows get a 6 percent white hairline ring instead (`--shadow-workspace`, `--shadow-raised`); cards keep their borders.
- The default focus ring is mint and sits outside the white pill. A ring drawn inset on the pill uses `focus-inverse`, which is dark in this theme; rings on the deep green fields keep the mint ring.
- `accent-strong` is a fill only. Green words use `accent-text`.
- Light glass becomes dark glass, ink at 82 percent, measured over a white backdrop, its worst case.
- The tints (accent-soft, spend-soft, warning-soft, danger-soft, info-soft) are deep versions of each hue, so ink-secondary passes 4.5 to 1 on every one.
- Token icons keep their own artwork and plates in both themes.
- The share cards' images stay light: the image renderer reads `:root` only (contrast.mjs `readRootTokens`).

The check covers both themes. contrast.mjs fails any `--color-`, `--gradient-`, `--glass-`, `--shadow-` or `--pattern-` token that has no dark value, unless it follows another semantic token or is listed as shared (white on fills, the deep green fields, deep glass), and measures every claim of section 3 again on the dark values (the Dark theme table above).

