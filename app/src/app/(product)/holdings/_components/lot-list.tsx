import Link from 'next/link';
import type { JSX } from 'react';

import { tokenText } from '@/components/sleeve/text';
import { CountBadge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { formatUtcDate } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import type { LotView } from '@/data/types';

import { lotPremiumWords, lotPriceWords } from '../_lib/holdings';

/**
 * A holding's lots, oldest first, the order a sell draws from them (D-009 Q30). Each row says when the lot was
 * bought, the all-in price it paid and how far that sat from the market reference, what is left and what was sold,
 * and opens the details of the buy that opened it. The lot's number is that buy's number.
 */

export interface LotListProps {
  lots: readonly LotView[];
  symbol: string;
  /** h3 under a card title, h4 deeper. */
  headingLevel?: 3 | 4;
  className?: string;
}

export function LotList({ lots, symbol, headingLevel = 3, className }: LotListProps): JSX.Element {
  const Heading = headingLevel === 3 ? 'h3' : 'h4';
  return (
    <div className={cx('min-w-0', className)}>
      <Heading className="flex items-center gap-2 text-body-s font-semibold text-ink">
        Lots, oldest first
        <CountBadge count={lots.length} />
      </Heading>
      <ul className="mt-2 divide-y divide-border overflow-hidden rounded-row border border-border">
        {lots.map((lot) => {
          const sold = lot.tokensBought - lot.tokensRemaining;
          const id = lot.id.toString();
          return (
            <li key={id} className="relative px-4 py-3 transition-colors duration-fast ease-standard hover:bg-surface-muted">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-body-s font-medium text-ink">
                  <Link
                    href={`/receipts/${id}`}
                    className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
                  >
                    Lot {id}
                  </Link>
                </p>
                <p className="flex items-center gap-1.5 text-body-s font-medium tabular-nums text-ink">
                  {tokenText(lot.tokensRemaining, symbol)}
                  <Icon name="chevronRight" className="size-4 text-ink-muted" />
                </p>
              </div>
              <p className="mt-0.5 pr-6 text-body-s text-ink-muted">
                Bought {formatUtcDate(lot.boughtAt)} at {lotPriceWords(lot, symbol)}, {lotPremiumWords(lot)}.{' '}
                {sold > 0n ? `${tokenText(sold, symbol)} sold.` : 'Nothing sold yet.'}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
