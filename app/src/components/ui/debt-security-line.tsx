import type { JSX } from 'react';

import { DEBT_SECURITY_LINE, EXIT_LINE } from '@/lib/copy';

import { cx } from './cx';

/**
 * "debt security, not a share", word for word (build contract copy rules, docs/DESIGN.md 12.5). It goes directly
 * under every holding's and every receipt's token amount: never in a tooltip, never truncated, never behind a
 * toggle.
 */
export function DebtSecurityLine({ className }: { className?: string }): JSX.Element {
  return <p className={cx('text-body-s font-medium text-ink-secondary', className)}>{DEBT_SECURITY_LINE}</p>;
}

/** The issuer-accurate exit line (D-014), shown beside the sell action on a holding. */
export function ExitLine({ className }: { className?: string }): JSX.Element {
  return <p className={cx('text-body-s text-ink-secondary', className)}>{EXIT_LINE}</p>;
}
