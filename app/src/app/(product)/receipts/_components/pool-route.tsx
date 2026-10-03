import type { JSX } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import type { TokenKey } from '@/components/token/registry';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { feeTierPercent } from '../_lib/pool';
import { Glyph } from './glyphs';

/**
 * A swap's route as a picture: the token paid in, the pool it went through with its venue and fee tier, the token
 * received. One hop, as every M0 swap is (D-009 Q32). Decorative for assistive technology: the facts beside it say
 * the same in words, so the picture is hidden and never the only source.
 */

export interface RouteEndView {
  token: TokenKey | null;
  symbol: string;
}

export interface PoolRouteProps {
  from: RouteEndView;
  to: RouteEndView;
  /** "Uniswap v3", or null when the receipt names no venue. */
  venue: string | null;
  /** v3 fee in hundredths of a basis point, or null off the allowlist. */
  fee: number | null;
  allowlisted: boolean;
  /** Draws the route as planned rather than taken. */
  planned?: boolean;
  className?: string;
}

function End({ end }: { end: RouteEndView }): JSX.Element {
  return (
    <span className="flex w-14 shrink-0 flex-col items-center gap-1.5 text-center">
      {end.token === null ? (
        <span className="size-avatar rounded-pill bg-surface-strong" />
      ) : (
        <TokenIcon token={end.token} size="lg" decorative />
      )}
      <span className="text-label font-semibold text-ink">{end.symbol}</span>
    </span>
  );
}

function Connector({ planned }: { planned: boolean }): JSX.Element {
  return (
    <span className="relative flex h-[2.125rem] min-w-4 flex-1 items-center">
      <span className={cx('w-full border-t-2', planned ? 'border-dashed border-border-strong' : 'border-ink-muted')} />
      <Icon name="chevronRight" className="absolute -right-1.5 size-4 text-ink-muted" />
    </span>
  );
}

export function PoolRoute({ from, to, venue, fee, allowlisted, planned = false, className }: PoolRouteProps): JSX.Element {
  return (
    <div aria-hidden="true" className={cx('flex min-w-0 items-start gap-2', className)}>
      <End end={from} />
      <Connector planned={planned} />
      <span
        className={cx(
          'flex min-h-[2.125rem] shrink-0 items-center gap-2 rounded-pill border px-3 py-1.5',
          allowlisted ? 'border-border bg-surface-muted' : 'border-danger bg-danger-soft',
        )}
      >
        <Glyph name="pool" className={cx('size-4', allowlisted ? 'text-ink-secondary' : 'text-danger')} />
        <span className="flex flex-col leading-none">
          <span className="text-label font-semibold text-ink">{venue ?? 'Pool'}</span>
          <span className={cx('mt-0.5 text-label', allowlisted ? 'text-ink-secondary' : 'text-danger')}>
            {fee === null ? (allowlisted ? 'Allowlisted' : 'Not allowlisted') : `${feeTierPercent(fee)} fee tier`}
          </span>
        </span>
      </span>
      <Connector planned={planned} />
      <End end={to} />
    </div>
  );
}
