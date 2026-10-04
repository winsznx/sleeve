'use client';

import { formatStockToken, formatUsdg, type Address } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { isSleeveOff } from '@/components/sleeve/sleeve-off';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { ReasonTag } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { useAccount, useBuckets, useHoldings, useLedger } from '@/data/hooks';
import type { LedgerView } from '@/data/types';

import { Popover } from './popover';
import { ReceiveButton } from './receive';
import { SampleTag } from './sample-tag';

/**
 * The two sleeves at a glance (docs/design/inspiration.md 5.4): the spendable USDG in the top bar from 1024 px, and
 * behind it what is spendable, what waits to buy, and the Stock Tokens held, each valued at the Chainlink price with
 * its time and carrying the debt security line. Amounts are ink; colour lives in the icons and marks.
 */

/**
 * USDG the owner can spend now. The module's spend ledger while Sleeve is on; the whole balance while it is off, since
 * the module then keeps no ledger for the account and reads it as zero (D-040).
 */
function spendableNow(ledger: LedgerView, sleeveOff: boolean): bigint {
  return sleeveOff ? ledger.balance : ledger.spend;
}

export function BalanceChip({ account, className }: { account: Address; className?: string }): JSX.Element {
  const ledger = useLedger(account);
  const overview = useAccount(account);
  if (ledger.data === undefined || overview.isPending) {
    return ledger.data === undefined && ledger.isError ? (
      <button
        type="button"
        onClick={() => void ledger.refetch()}
        className={cx('inline-flex min-h-control-sm items-center rounded-pill border border-border px-3 text-body-s text-ink-secondary', className)}
      >
        Balance did not load
      </button>
    ) : (
      <span aria-busy="true" className={cx('inline-flex h-control-sm w-40 rounded-pill bg-skeleton', className)}>
        <span className="sr-only">Loading your balance</span>
      </span>
    );
  }
  const spend = formatUsdg(spendableNow(ledger.data, overview.data !== undefined && isSleeveOff(overview.data)));
  return (
    <Popover
      title="Your balances"
      className={className}
      buttonLabel={`${spend} USDG spendable. Show your balances.`}
      buttonClassName="inline-flex min-h-control-sm items-center gap-2 rounded-pill border border-border bg-surface pl-2 pr-3 text-body-s font-medium text-ink transition-colors duration-fast ease-standard hover:border-border-strong"
      button={
        <>
          <TokenIcon token="USDG" size="sm" decorative />
          <span aria-hidden="true" className="whitespace-nowrap tabular-nums">
            {spend} USDG<span className="hidden font-normal text-ink-secondary 2xl:inline"> spendable</span>
          </span>
        </>
      }
      panelClassName="w-[24rem]"
    >
      <BalancesPanel account={account} />
    </Popover>
  );
}

function Section({
  title,
  aside,
  children,
  className,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <section className={cx('px-4 py-3.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body-s font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** The balances, for the chip's panel and for the account sheet on narrower screens. */
export function BalancesPanel({ account, withActions = true }: { account: Address; withActions?: boolean }): JSX.Element {
  const ledger = useLedger(account);
  const buckets = useBuckets(account);
  const holdings = useHoldings(account);
  const overview = useAccount(account);
  const sleeveOff = overview.data !== undefined && isSleeveOff(overview.data);

  return (
    <div className="min-w-0 divide-y divide-border">
      <Section title="Spendable" aside={<SampleTag />}>
        {ledger.data === undefined || overview.isPending ? (
          <p className="text-body-s text-ink-secondary">
            {ledger.data === undefined && ledger.isError ? 'Your balance did not load.' : 'Loading your balance.'}
          </p>
        ) : (
          <>
            <p className="flex items-center gap-2.5">
              <TokenIcon token="USDG" size="md" decorative />
              <Amount value={formatUsdg(spendableNow(ledger.data, sleeveOff))} unit="USDG" className="text-figure-s text-ink" />
            </p>
            {sleeveOff ? (
              <p className="mt-1.5 text-body-s text-ink-secondary">Sleeve is off for this account, so payments are not split and all of it is spendable.</p>
            ) : ledger.data.unsorted > 0n ? (
              <p className="mt-1.5 text-body-s text-ink-secondary">
                Another {usdgText(ledger.data.unsorted)} arrived and is not split yet. It is spendable too.
              </p>
            ) : null}
          </>
        )}
      </Section>
      {buckets.data !== undefined && buckets.data.length > 0 ? (
        <Section title="Waiting to buy">
          <ul className="space-y-2">
            {buckets.data.map((bucket) => (
              <li key={bucket.tickerId} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body-s">
                <TickerIcon tickerId={bucket.tickerId} size="sm" />
                <span className="text-ink">
                  <span className="font-semibold tabular-nums">{usdgText(bucket.amount)}</span> to buy {tickerSymbol(bucket.tickerId)}
                </span>
                <ReasonTag reason={bucket.reason} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-body-s text-ink-secondary">It stays in your account as USDG. You can release it to spend at any time.</p>
        </Section>
      ) : null}
      <Section title="Stock Tokens">
        {holdings.data === undefined ? (
          <p className="text-body-s text-ink-secondary">{holdings.isError ? 'Your holdings did not load.' : 'Loading your holdings.'}</p>
        ) : holdings.data.length === 0 ? (
          <p className="text-body-s text-ink-secondary">None yet. The first payment that buys adds one here.</p>
        ) : (
          <ul className="space-y-3">
            {holdings.data.map((holding) => {
              const symbol = tickerSymbol(holding.tickerId);
              return (
                <li key={holding.tickerId} className="flex gap-2.5">
                  <TickerIcon tickerId={holding.tickerId} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Amount value={formatStockToken(holding.balance)} unit={symbol} className="text-body font-semibold text-ink" />
                      <Amount value={formatUsdg(holding.value)} unit="USDG" className="text-body-s text-ink" />
                    </p>
                    <DebtSecurityLine />
                    <p className="text-body-s text-ink-secondary">Valued at the Chainlink price from {formatUtc(holding.feed.updatedAt)}.</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {withActions ? (
        <div className="flex flex-wrap items-center gap-2 bg-surface-muted px-4 py-3">
          <ReceiveButton look="menu" className="flex-1" />
          <Link
            href="/holdings"
            className="inline-flex min-h-control flex-1 items-center justify-center rounded-pill border border-border-strong bg-surface px-5 text-body font-medium text-ink transition-colors duration-fast ease-standard hover:bg-surface-muted"
          >
            Holdings
          </Link>
        </div>
      ) : null}
    </div>
  );
}
