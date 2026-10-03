import { cssStringFromTheme, lightTheme } from '@rainbow-me/rainbowkit';

const base = lightTheme({ borderRadius: 'large', fontStack: 'system', overlayBlur: 'small' });

/**
 * RainbowKit in the v2 palette. Every value is one of Sleeve's CSS variables (tokens.css stays the one source):
 * RainbowKit writes each into a --rk-* property under [data-rk], and its sanitizer only strips : ; { } < / >.
 * Black is action and selection (DESIGN.md 33), so the accent is the brand black, not green. RainbowKit's own
 * connection dot is a vivid green in the family the brand rules forbid (DESIGN.md 2.2), and its blue and yellow go too.
 */
export const sleeveWalletTheme = {
  ...base,
  colors: {
    accentColor: 'var(--color-brand)',
    accentColorForeground: 'var(--color-on-brand)',
    actionButtonBorder: 'var(--color-border)',
    actionButtonBorderMobile: 'var(--color-border)',
    actionButtonSecondaryBackground: 'var(--color-surface-muted)',
    closeButton: 'var(--color-ink-secondary)',
    closeButtonBackground: 'var(--color-surface-muted)',
    connectButtonBackground: 'var(--color-surface)',
    connectButtonBackgroundError: 'var(--color-danger)',
    connectButtonInnerBackground: 'var(--color-surface-muted)',
    connectButtonText: 'var(--color-ink)',
    connectButtonTextError: 'var(--color-on-danger)',
    connectionIndicator: 'var(--color-success)',
    downloadBottomCardBackground: 'var(--color-surface)',
    downloadTopCardBackground: 'var(--color-surface-muted)',
    error: 'var(--color-danger-text)',
    generalBorder: 'var(--color-border)',
    generalBorderDim: 'var(--color-surface-muted)',
    menuItemBackground: 'var(--color-surface-muted)',
    modalBackdrop: 'var(--color-scrim)',
    modalBackground: 'var(--color-surface)',
    modalBorder: 'var(--color-border)',
    modalText: 'var(--color-ink)',
    modalTextDim: 'var(--color-ink-muted)',
    modalTextSecondary: 'var(--color-ink-secondary)',
    profileAction: 'var(--color-surface)',
    profileActionHover: 'var(--color-surface-muted)',
    profileForeground: 'var(--color-surface-muted)',
    selectedOptionBorder: 'var(--color-border-strong)',
    standby: 'var(--color-waiting)',
  },
  fonts: { body: 'var(--font-sans)' },
  radii: {
    actionButton: 'var(--radius-pill)',
    connectButton: 'var(--radius-pill)',
    menuButton: 'var(--radius-control)',
    modal: 'var(--radius-card)',
    modalMobile: 'var(--radius-sheet)',
  },
  shadows: {
    ...base.shadows,
    connectButton: 'var(--shadow-soft)',
    dialog: 'var(--shadow-overlay)',
  },
} satisfies ReturnType<typeof lightTheme>;

/**
 * The provider gets theme={null}: with a theme RainbowKit wraps the whole app in <div data-rk>, which breaks the
 * shell's flex-1 (body is flex-col). Modals portal into body with data-rk themselves, so the variables go on that
 * selector. RainbowKit ignores reduced motion (350 ms slide, spinners), so that is added here.
 */
export const SLEEVE_WALLET_CSS =
  `[data-rk]{${cssStringFromTheme(sleeveWalletTheme)}}` +
  '@media (prefers-reduced-motion: reduce){[data-rk] *,[data-rk] *::before,[data-rk] *::after' +
  '{animation:none!important;transition:none!important}}';
