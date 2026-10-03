import type { NavItem } from '@/components/ui/app-shell';

/**
 * Where the signed-in app goes, for AppShell. Three destinations fit the phone's bottom bar; the rest sit behind
 * More. Gated features never appear here (docs/DESIGN.md 12.8), and neither does /dev/kit.
 */
export const PRIMARY_NAV: readonly NavItem[] = [
  { href: '/home', label: 'Home', icon: 'home' },
  { href: '/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/receipts', label: 'Receipts', icon: 'receipt' },
];

export const SECONDARY_NAV: readonly NavItem[] = [
  { href: '/rule', label: 'Rule', icon: 'rule' },
  { href: '/sell', label: 'Sell', icon: 'sell' },
  { href: '/verify', label: 'Verify a receipt', icon: 'verify' },
];
