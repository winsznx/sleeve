'use client';

import { TOTAL_BPS, formatFeedPrice, formatStockToken, formatUsdg, tokenValueUsdg } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { percentWords, tickerSymbol } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatNewYork, formatUtc, formatUtcDate } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

import { APP_HREFS } from './copy';
import { EXAMPLE_ACCOUNT_LABEL, useExampleAccount, type ExampleAccount } from './landing-data';
import { LoadError, SessionPill, TokenChip } from './widgets';

/**
 * The sell card's picture: a sell back to USDG laid out as a swap, two stacked panels with the arrow on the seam
 * (Uniswap's card, docs/design/inspiration.md). It sells the example account's oldest lot first, as the module does
 * (D-009 Q30), and values it at the Chainlink price with that price's time. It never quotes the pool: the floor it
 * shows is the guard's, the reference less the account's cap, which the module enforces on every sell.
 */
export function SellArt({ className }: { className?: string }): JSX.Element {
  const example = useExampleAccount();
  const frame = cx('flex w-full flex-col rounded-module bg-surface p-4 text-left sm:p-5', className);

  if (example.status === 'loading') {
    return (
      <SkeletonGroup label="Loading a sell" className={frame}>
        <Skeleton className="h-24 w-full rounded-row" />
        <Skeleton className="mt-1 h-24 w-full rounded-row" />
        <SkeletonText lines={2} className="mt-4" />
      </SkeletonGroup>
    );
  }
  if (example.status === 'error') return <LoadError what={EXAMPLE_ACCOUNT_LABEL} retry={example.retry} className={className} />;
  if (example.data === null) {
    return (
      <div className={frame}>
        <p className="text-body-s font-semibold text-ink">Sell back to USDG</p>
        <p className="mt-1 text-body-s text-ink-secondary">
          Any Stock Token your payments bought can go back to USDG, checked against its Chainlink price first.
        </p>
      </div>
    );
  }
  return <SellSwap data={example.data} className={frame} />;
}

function SellSwap({ data, className }: { data: ExampleAccount; className: string }): JSX.Element {
  const holding =
    data.holdings.find((item) => item.tickerId === data.rule.tickerId && item.lots.length > 0) ??
    data.holdings.find((item) => item.lots.length > 0);
  const lot = holding?.lots[0];
  if (holding === undefined || lot === undefined) {
    return (
      <div className={className}>
        <p className="text-body-s font-semibold text-ink">Nothing to sell yet</p>
        <p className="mt-1 text-body-s text-ink-secondary">The first Stock Token arrives with the first payment that buys.</p>
      </div>
    );
  }
  const symbol = tickerSymbol(holding.tickerId);
  const tokenKey = tickerTokenKey(holding.tickerId);
  const session = data.market.tickers.find((ticker) => ticker.tickerId === holding.tickerId)?.session;
  const worth = tokenValueUsdg(lot.tokensRemaining, holding.feed.answer);
  const cap = data.rule.premiumCapBps;
  const floor = (worth * BigInt(TOTAL_BPS - cap)) / BigInt(TOTAL_BPS);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-s font-semibold text-ink">Sell back</p>
        {session === undefined ? null : <SessionPill session={session} />}
      </div>
      <div className="relative mt-3 flex flex-col gap-1">
        <SwapPanel
          label="You sell"
          amount={formatStockToken(lot.tokensRemaining)}
          unit={symbol}
          chip={tokenKey === null ? null : <TokenChip token={tokenKey} />}
          detail={<DebtSecurityLine />}
          note={`Oldest lot first, bought ${formatUtcDate(lot.boughtAt)}`}
          className="pb-5"
        />
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-row border-4 border-surface bg-surface-strong text-ink"
        >
          <Icon name="chevronDown" className="size-4" />
        </span>
        <SwapPanel
          label="Worth"
          amount={formatUsdg(worth)}
          unit="USDG"
          chip={<TokenChip token="USDG" />}
          note={`At the Chainlink price, ${formatFeedPrice(holding.feed.answer)} USD per ${symbol}, ${formatUtc(holding.feed.updatedAt)}`}
          className="pt-5"
        />
      </div>
      <p className="mt-3 text-body-s text-ink-secondary">
        Sleeve sells only within {percentWords(cap)} of the Chainlink price. At this price, at least{' '}
        <span className="whitespace-nowrap font-semibold text-ink">{formatUsdg(floor)} USDG</span> lands in spend.
      </p>
      {session === undefined || session.open || session.nextOpenAt === null ? null : (
        <p className="mt-2 text-body-s text-ink-secondary">
          Market closed: the sell waits until {formatNewYork(session.nextOpenAt)}, or you override that one sell.
        </p>
      )}
      <div className="mt-auto pt-4">
        <ButtonLink href={APP_HREFS.holdings} variant="secondary" size="md" fullWidth>
          Sell from Holdings
        </ButtonLink>
      </div>
    </div>
  );
}

interface SwapPanelProps {
  label: string;
  amount: string;
  unit: string;
  chip: ReactNode;
  /** A line that belongs directly under the amount, such as the debt security line under a Stock Token. */
  detail?: ReactNode;
  note: string;
  className?: string;
}

/** One side of the swap: a label, the amount with its unit, the token chip, and where the number comes from. */
function SwapPanel({ label, amount, unit, chip, detail, note, className }: SwapPanelProps): JSX.Element {
  return (
    <div className={cx('rounded-row bg-surface-muted px-3.5 py-3', className)}>
      <p className="text-label text-ink-secondary">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="min-w-0 text-figure-s tabular-nums text-ink">
          {amount} <span className="text-body-s font-medium text-ink-secondary">{unit}</span>
        </p>
        {chip}
      </div>
      {detail}
      <p className="mt-1 text-label text-ink-secondary">{note}</p>
    </div>
  );
}
