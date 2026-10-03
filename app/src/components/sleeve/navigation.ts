import type { NavItem, SectionAlias } from '@/components/ui/app-shell';

/**
 * Where the signed-in app goes (D-024): the payday split first, proof behind it. Home, Payments, Holdings and Rule
 * are the four primary places, in the phone's bottom bar and at the top of the rail; History and Check a split sit
 * behind More on a phone and lower in the rail. Gated features never appear here (docs/DESIGN.md 12.8), and neither
 * does /dev/kit. Descriptions and keywords feed the search palette.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  {
    href: '/home',
    label: 'Home',
    icon: 'home',
    description: 'The latest payday, both sleeves and your payment address.',
    keywords: ['overview', 'balance', 'spend', 'sleeves'],
  },
  {
    href: '/payments',
    label: 'Payments',
    icon: 'inbox',
    description: 'Every USDG payment that arrived and what it became.',
    keywords: ['inbox', 'paydays', 'incoming', 'arrived', 'split'],
  },
  {
    href: '/holdings',
    label: 'Holdings',
    icon: 'holdings',
    description: 'The Stock Tokens you hold, valued at the Chainlink reference, with sell-back.',
    keywords: ['Stock Tokens', 'portfolio', 'sell', 'lots'],
  },
  {
    href: '/rule',
    label: 'Rule',
    icon: 'rule',
    description: 'How much of each payment buys a Stock Token, which one, and your price cap.',
    keywords: ['split', 'cap', 'pause', 'resume', 'settings'],
  },
];

export const SECONDARY_NAV: readonly NavItem[] = [
  {
    href: '/history',
    label: 'History',
    icon: 'history',
    description: 'Every split, buy, wait, release and sale, with CSV export.',
    keywords: ['actions', 'receipts', 'csv', 'export', 'activity'],
  },
  {
    href: '/verify',
    label: 'Check a split',
    icon: 'verify',
    description: 'Recompute any action from public chain data, on the public page.',
    keywords: ['verify', 'proof', 'recompute', 'receipt'],
  },
];

/**
 * Pages that belong to a place without being in the navigation: the old inbox and receipts addresses, which redirect,
 * the details-and-proof page of one action, reached from a payment, a holding or history and named by its number,
 * and sell-back, which is part of holdings.
 */
export const SECTION_ALIASES: readonly SectionAlias[] = [
  { prefix: '/inbox', section: '/payments' },
  { prefix: '/receipts', section: '/history', label: 'Details', segmentPrefix: '#' },
  { prefix: '/sell', section: '/holdings', label: 'Sell back' },
];
