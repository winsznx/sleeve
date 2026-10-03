/*
  Tailwind 3.4 theme extension for Sleeve. Every value is a CSS custom property from
  tokens.css, so plain CSS and utilities read one source. Wire it as:

    import sleeveTheme from "./src/styles/tailwind-theme.cjs";
    theme: { colors: {}, extend: sleeveTheme }

  colors: {} drops Tailwind's stock palette (blue-500, green-600 and the rest), so a raw
  palette class generates nothing and only Sleeve's semantic colors exist. Spacing, type
  sizes, radii and screens keep their stock keys; this file only adds names.

  Colors are functions: a plain utility (bg-accent) compiles to var(--color-accent), and an
  opacity modifier (bg-accent/20) compiles to color-mix(). Base utilities therefore never depend
  on color-mix support. The legacy bg-opacity-* utilities have no effect on these colors.
*/

const color = (name) => {
  return ({ opacityValue } = {}) => {
    const opacity = opacityValue === undefined ? "1" : String(opacityValue).trim();
    if (opacity === "1" || opacity.startsWith("var(--tw-")) return `var(${name})`;
    const amount = opacity.endsWith("%") ? opacity : `calc(${opacity} * 100%)`;
    return `color-mix(in srgb, var(${name}) ${amount}, transparent)`;
  };
};

// Headings, display and figures carry their weight and tracking, because both are part of the
// role. Body, label, mono and input steps set size and leading only (label and micro also set
// tracking), so <strong className="text-body-s"> stays bold.
const roleStep = (step) => [
  `var(--text-${step}-size)`,
  {
    lineHeight: `var(--text-${step}-leading)`,
    letterSpacing: `var(--text-${step}-tracking)`,
    fontWeight: `var(--text-${step}-weight)`,
  },
];

const textStep = (step, { tracking = false } = {}) => [
  `var(--text-${step}-size)`,
  tracking
    ? { lineHeight: `var(--text-${step}-leading)`, letterSpacing: `var(--text-${step}-tracking)` }
    : { lineHeight: `var(--text-${step}-leading)` },
];

module.exports = {
  colors: {
    transparent: "transparent",
    current: "currentColor",
    inherit: "inherit",
    canvas: color("--color-canvas"),
    surface: {
      DEFAULT: color("--color-surface"),
      muted: color("--color-surface-muted"),
      strong: color("--color-surface-strong"),
    },
    shell: {
      DEFAULT: color("--color-shell"),
      raised: "var(--color-shell-raised)",
    },
    chrome: "var(--color-chrome)",
    scrim: "var(--color-scrim)",
    skeleton: color("--color-skeleton"),
    border: {
      DEFAULT: color("--color-border"),
      strong: color("--color-border-strong"),
      control: color("--color-border-control"),
    },
    ink: {
      DEFAULT: color("--color-ink"),
      secondary: color("--color-ink-secondary"),
      muted: color("--color-ink-muted"),
      inverse: color("--color-ink-inverse"),
    },
    brand: {
      DEFAULT: color("--color-brand"),
      strong: color("--color-brand-strong"),
    },
    "on-brand": color("--color-on-brand"),
    accent: {
      DEFAULT: color("--color-accent"),
      strong: color("--color-accent-strong"),
      soft: color("--color-accent-soft"),
      border: color("--color-accent-border"),
    },
    "on-accent": color("--color-on-accent"),
    link: {
      DEFAULT: color("--color-link"),
      hover: color("--color-link-hover"),
    },
    focus: {
      DEFAULT: color("--color-focus"),
      inverse: color("--color-focus-inverse"),
    },
    spend: {
      DEFAULT: color("--color-spend"),
      soft: color("--color-spend-soft"),
      surface: color("--color-spend-surface"),
      border: color("--color-spend-border"),
    },
    equity: {
      DEFAULT: color("--color-equity"),
      soft: color("--color-equity-soft"),
      surface: color("--color-equity-surface"),
      border: color("--color-equity-border"),
    },
    waiting: {
      DEFAULT: color("--color-waiting"),
      soft: color("--color-waiting-soft"),
    },
    success: {
      DEFAULT: color("--color-success"),
      soft: color("--color-success-soft"),
    },
    warning: {
      DEFAULT: color("--color-warning"),
      soft: color("--color-warning-soft"),
    },
    danger: {
      DEFAULT: color("--color-danger"),
      strong: color("--color-danger-strong"),
      soft: color("--color-danger-soft"),
    },
    "on-danger": color("--color-on-danger"),
    info: {
      DEFAULT: color("--color-info"),
      soft: color("--color-info-soft"),
    },
    chart: {
      spend: color("--color-chart-spend"),
      equity: color("--color-chart-equity"),
      waiting: color("--color-chart-waiting"),
      grid: color("--color-chart-grid"),
      axis: color("--color-chart-axis"),
      area: "var(--color-chart-area)",
    },
    // Translucent by design, so no opacity modifier: bg-glass-deep, border-glass-deep-edge.
    glass: {
      deep: "var(--glass-deep)",
      light: "var(--glass-light)",
      "deep-edge": "var(--glass-deep-border)",
      "light-edge": "var(--glass-light-border)",
    },
  },

  // text-{tone} resolves to the step that passes 4.5:1, never to the fill. A function replaces the
  // whole tone object for text, so text-warning-soft and friends do not exist; an object here would
  // deep-merge with colors and bring them back, which is why accent-strong is a flat key. text-spend
  // is apricot-700, because the apricot fill (3.65:1 on white) is not a text color.
  textColor: {
    accent: color("--color-accent-text"),
    "accent-strong": color("--color-accent-strong"),
    equity: color("--color-equity-text"),
    spend: color("--color-spend-text"),
    success: color("--color-success-text"),
    warning: color("--color-warning-text"),
    waiting: color("--color-waiting-text"),
    danger: color("--color-danger-text"),
    info: color("--color-info-text"),
  },

  borderColor: { DEFAULT: color("--color-border") },
  ringColor: { DEFAULT: color("--color-focus") },
  ringOpacity: { DEFAULT: "1" },
  ringOffsetColor: { DEFAULT: color("--color-canvas") },

  fontFamily: {
    sans: ["var(--font-sans)"],
    mono: ["var(--font-mono)"],
  },

  fontSize: {
    "display-xl": roleStep("display-xl"),
    "display-l": roleStep("display-l"),
    h1: roleStep("h1"),
    h2: roleStep("h2"),
    h3: roleStep("h3"),
    "figure-l": roleStep("figure-l"),
    "figure-m": roleStep("figure-m"),
    "figure-s": roleStep("figure-s"),
    "body-l": textStep("body-l"),
    body: textStep("body"),
    "body-s": textStep("body-s"),
    label: textStep("label", { tracking: true }),
    micro: textStep("micro", { tracking: true }),
    mono: textStep("mono"),
    "mono-s": textStep("mono-s"),
    input: textStep("input"),
  },

  letterSpacing: {
    caps: "var(--tracking-caps)",
  },

  spacing: {
    gutter: "var(--layout-gutter)",
    section: "var(--layout-section)",
    stack: "var(--layout-stack)",
    card: "var(--layout-card-padding)",
  },

  width: {
    rail: "var(--layout-rail)",
    "rail-compact": "var(--layout-rail-compact)",
  },

  height: {
    topbar: "var(--layout-topbar)",
    "bottom-nav": "var(--layout-bottom-nav)",
    touch: "var(--size-touch)",
    "control-sm": "var(--size-control-sm)",
    control: "var(--size-control)",
    "control-lg": "var(--size-control-lg)",
  },

  minHeight: {
    topbar: "var(--layout-topbar)",
    "bottom-nav": "var(--layout-bottom-nav)",
    touch: "var(--size-touch)",
    "control-sm": "var(--size-control-sm)",
    control: "var(--size-control)",
    "control-lg": "var(--size-control-lg)",
  },

  minWidth: {
    touch: "var(--size-touch)",
  },

  size: {
    icon: "var(--size-icon)",
    "icon-tile": "var(--size-icon-tile)",
    avatar: "var(--size-avatar)",
    touch: "var(--size-touch)",
  },

  maxWidth: {
    content: "var(--layout-content)",
    reading: "var(--layout-reading)",
    form: "var(--layout-form)",
    dialog: "var(--layout-dialog)",
    toast: "var(--layout-toast)",
  },

  maxHeight: {
    sheet: "var(--layout-sheet-max)",
  },

  borderRadius: {
    xs: "var(--radius-xs)",
    control: "var(--radius-control)",
    row: "var(--radius-row)",
    panel: "var(--radius-panel)",
    module: "var(--radius-module)",
    large: "var(--radius-large)",
    workspace: "var(--radius-workspace)",
    card: "var(--radius-card)",
    sheet: "var(--radius-sheet)",
    pill: "var(--radius-pill)",
  },

  boxShadow: {
    soft: "var(--shadow-soft)",
    card: "var(--shadow-card)",
    raised: "var(--shadow-raised)",
    workspace: "var(--shadow-workspace)",
    floating: "var(--shadow-floating)",
    overlay: "var(--shadow-overlay)",
  },

  backgroundImage: {
    hero: "var(--gradient-hero)",
    apricot: "var(--gradient-apricot)",
    feature: "var(--gradient-feature)",
    "accent-deep": "var(--gradient-accent-deep)",
    stage: "var(--gradient-stage)",
    step: "var(--gradient-step)",
    "art-green": "var(--gradient-art-green)",
    "art-neutral": "var(--gradient-art-neutral)",
    "art-on-accent": "var(--gradient-art-on-accent)",
    "panel-soft": "var(--gradient-panel-soft)",
    "waiting-stripes": "var(--pattern-waiting)",
  },

  backdropBlur: {
    glass: "var(--glass-blur)",
  },

  transitionDuration: {
    fast: "var(--duration-fast)",
    standard: "var(--duration-standard)",
    narrative: "var(--duration-narrative)",
  },

  transitionTimingFunction: {
    standard: "var(--ease-standard)",
    exit: "var(--ease-exit)",
  },

  zIndex: {
    sticky: "var(--z-sticky)",
    nav: "var(--z-nav)",
    header: "var(--z-header)",
    overlay: "var(--z-overlay)",
    toast: "var(--z-toast)",
  },

  opacity: {
    disabled: "var(--opacity-disabled)",
  },
};
