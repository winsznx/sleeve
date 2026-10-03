import { MODULE_PARAMS, RULE_DEFAULTS, formatBps } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';
import { formatDuration } from '@/components/ui/format-time';

/**
 * The landing page's words (D-024: the payday split leads, the receipt stays behind it). Every string passes
 * scripts/copy-lint.mjs, and every number is a product constant from @sleeve/core or a read from the data layer,
 * never a figure typed here.
 */

/** The sentence a stranger should repeat (PRD section 1), the hero headline and the page description. */
export const ONE_SENTENCE =
  'When you get paid, part of it becomes a US Stock Token you own and the rest stays spendable. You set it once.';

/** What Sleeve is, in the build contract's words. */
export const HERO_BADGE = 'A payment address that invests part of every payment';

export const HERO_LEAD =
  'Give payers your address. Your rule splits every USDG payment, and while the market is closed, the equity share waits as USDG.';

/** One label for the sign-up intent, used by the hero and the closing band. */
export const START_LABEL = 'Get your payment address';
export const START_HREF = '/onboard';

/** Where the app keeps each thing the landing shows (D-024 navigation). */
export const APP_HREFS = {
  home: '/home',
  payments: '/payments',
  holdings: '/holdings',
  rule: '/rule',
  history: '/history',
  checkSplit: '/verify',
} as const;

/**
 * Section anchors. The marketing navbar, its phone sheet and the footer link to these ids (LANDING_ANCHORS in
 * components/shell/site-map.ts), so they only change together with that map.
 */
export const SECTION_IDS = {
  how: 'how-it-works',
  features: 'what-it-does',
  rule: 'your-rule',
  sleeves: 'two-sleeves',
  holdings: 'holdings',
  tickers: 'launch-tickers',
  proof: 'proof',
  eligibility: 'who-can-use-it',
  questions: 'questions',
} as const;

/** The proof card keeps the old in-page anchor, so a link to #receipts still lands on proof. */
export const PROOF_CARD_ID = 'receipts';

/** FAQ anchors. The marketing header links to what-you-hold. */
export const QUESTION_IDS = {
  holding: 'what-you-hold',
  custody: 'who-holds-my-money',
  closed: 'market-closed',
  cost: 'what-it-costs',
  eligibility: 'who-can-sign-up',
  exit: 'getting-out',
} as const;

/**
 * closeout's eyebrow pills (blueprint 1.6): each names its section in the navbar's words, so the pill is wayfinding
 * and the heading under it makes the point. The launch tickers' pill carries the live market state instead.
 */
export const EYEBROWS = {
  how: 'How a payday works',
  features: 'What your rule does',
  sleeves: 'Where each payday lands',
  questions: 'Questions',
  start: 'Sign up with a passkey or a wallet',
} as const;

/** The steps of one payday, in the order the module runs them (SPEC 9). */
export const STEP_ORDER = ['address', 'arrives', 'splits', 'lands'] as const;

export type StepId = (typeof STEP_ORDER)[number];

export interface Step {
  id: StepId;
  title: string;
  body: string;
  /** The figure on the glass under the step's picture: a product constant, never a measured result. */
  stat: string;
  statLabel: string;
}

const SUGGESTED_SYMBOL = tickerSymbol(RULE_DEFAULTS.tickerId);

/** One payday from the address to the Stock Token. */
export const STEPS: Record<StepId, Step> = {
  address: {
    id: 'address',
    title: 'Share your address',
    body: 'Give your payment address to whoever pays you. They send USDG on Robinhood Chain from any wallet.',
    stat: '1',
    statLabel: 'address for every payer. A plain USDG transfer works, with no Sleeve account on their side.',
  },
  arrives: {
    id: 'arrives',
    title: 'A payment arrives',
    body: "Sleeve's keeper sees the USDG land and starts the split. If the keeper stops, anyone can start it later.",
    stat: formatDuration(MODULE_PARAMS.graceSeconds),
    statLabel: "after which anyone can start a split Sleeve's keeper missed",
  },
  splits: {
    id: 'splits',
    title: 'Your rule splits it',
    body: 'The spend share stays USDG, ready to use. The equity share buys the Stock Token you picked.',
    stat: formatBps(RULE_DEFAULTS.equityBps),
    statLabel: `of each payment buys ${SUGGESTED_SYMBOL} in the suggested start`,
  },
  lands: {
    id: 'lands',
    title: 'It lands, or waits for the market',
    body: 'When the market is open and the price is inside your cap, the Stock Token lands in your account. Otherwise the USDG waits and buys at the open.',
    stat: formatBps(RULE_DEFAULTS.premiumCapBps),
    statLabel: 'the suggested cap above the Chainlink price. Past it, the buy waits.',
  },
};
