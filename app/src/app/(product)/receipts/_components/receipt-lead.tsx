import type { JSX } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair, type TokenStackSize } from '@/components/token/token-stack';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import type { RowLead, RowMark } from '../_lib/register';
import { Glyph } from './glyphs';

/**
 * The icons that lead a receipt: the move it records as a token pair (USDG into the Stock Token for a buy, the
 * reverse for a sale), or USDG alone when money only moved between ledgers. A queued buy carries a small clock and a
 * refused one a cross, so the row reads before its tag does. Decorative: the row's words name the tokens and status.
 */

const MARK: Record<RowMark, { look: string; glyph: JSX.Element }> = {
  waiting: { look: 'bg-waiting-soft text-waiting', glyph: <Icon name="clock" className="size-3" /> },
  refused: { look: 'bg-danger-soft text-danger', glyph: <Glyph name="cross" className="size-3" /> },
};

export interface ReceiptLeadProps {
  lead: RowLead;
  size?: Extract<TokenStackSize, 'md' | 'lg' | 'xl'>;
  /** The surface under the icons, which the cutout rings are drawn in. */
  surface?: 'surface' | 'muted';
  className?: string;
}

export function ReceiptLead({ lead, size = 'lg', surface = 'surface', className }: ReceiptLeadProps): JSX.Element {
  if (lead.kind === 'single') {
    return (
      <span aria-hidden="true" className={cx('relative inline-flex shrink-0', className)}>
        {size === 'md' ? (
          <TokenIcon token={lead.token} size="md" decorative />
        ) : (
          <TokenIcon token={lead.token} size={size} decorative />
        )}
      </span>
    );
  }
  const mark = lead.mark === null ? null : MARK[lead.mark];
  return (
    <span aria-hidden="true" className={cx('relative inline-flex shrink-0', className)}>
      <TokenPair from={lead.from} to={lead.to} size={size} surface={surface} decorative />
      {mark === null ? null : (
        <span
          className={cx(
            'absolute -bottom-1 -right-1 grid size-[1.125rem] place-items-center rounded-pill ring-2',
            surface === 'muted' ? 'ring-surface-muted' : 'ring-surface',
            mark.look,
          )}
        >
          {mark.glyph}
        </span>
      )}
    </span>
  );
}

/** The width a pair takes at each size, so rows with one icon line their titles up with rows that have two. */
export const LEAD_WIDTH_CLASS: Record<NonNullable<ReceiptLeadProps['size']>, string> = {
  md: 'w-10',
  lg: 'w-[3.625rem]',
  xl: 'w-[4.5rem]',
};
