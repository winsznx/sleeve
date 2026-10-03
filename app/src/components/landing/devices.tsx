'use client';

import { formatStockToken, formatUsdg } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { splitPartsOf } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgExact } from '@/components/sleeve/text';
import { TickerIcon, tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc, formatUtcDate } from '@/components/ui/format-time';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import type { InboxItem } from '@/data/types';

import { EXAMPLE_ACCOUNT_LABEL, useExampleAccount, usePaymentSplit, type ExampleAccount } from './landing-data';
import { LoadError } from './widgets';

interface DeviceProps {
  screen: string;
  title: string;
  /** The floating chip: from 768 px it hangs off the device's right edge beside the title, over empty space. */
  chip?: ReactNode;
  children: ReactNode;
}

/**
 * closeout's device frame (blueprint section 6.2): a white screen 330 px wide whose top corners are rounded and
 * whose bottom runs off the card from 768 px.
 */
function Device({ screen, title, chip, children }: DeviceProps): JSX.Element {
  return (
    <div className="relative w-full max-w-[20.625rem]">
      <div className="flex flex-col rounded-workspace bg-surface px-4 pb-4 pt-3.5 shadow-floating md:rounded-b-none md:pb-6">
        <div className="flex items-center justify-between gap-3 pb-3 text-micro font-semibold text-ink-secondary">
          <span>{screen}</span>
          <span>{EXAMPLE_ACCOUNT_LABEL}</span>
        </div>
        <p className="pb-3.5 text-center text-body-s font-semibold text-ink">{title}</p>
        {chip}
        {children}
      </div>
    </div>
  );
}

function Chip({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }): JSX.Element {
  return (
    <div className="mb-3 flex items-center gap-2.5 self-center rounded-panel border border-border bg-surface px-3 py-2 md:absolute md:-right-[1.125rem] md:top-[4.25rem] md:mb-0 md:border-0 md:shadow-overlay">
      {icon}
      <span className="flex flex-col">
        <span className="text-micro text-ink-secondary">{label}</span>
        <span className="whitespace-nowrap text-body-s font-semibold tabular-nums text-ink">{value}</span>
      </span>
    </div>
  );
}

function DeviceSkeleton({ label }: { label: string }): JSX.Element {
  return (
    <div className="w-full max-w-[20.625rem]">
      <SkeletonGroup label={label} className="rounded-workspace bg-surface px-4 pb-6 pt-3.5 shadow-floating md:rounded-b-none">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="mx-auto mt-4 h-4 w-28" />
        <Skeleton className="mt-5 h-8 w-40 rounded-row" />
        <SkeletonText lines={4} className="mt-5" />
      </SkeletonGroup>
    </div>
  );
}

function DeviceEmpty({ screen, title, children }: { screen: string; title: string; children: ReactNode }): JSX.Element {
  return (
    <Device screen={screen} title={title}>
      <p className="rounded-row border border-dashed border-border px-4 py-8 text-center text-body-s text-ink-secondary">{children}</p>
    </Device>
  );
}

/** The spend sleeve of the example account: what is ready to use, and how much each recent payment added to it. */
export function SpendDevice(): JSX.Element {
  const example = useExampleAccount();
  if (example.status === 'loading') return <DeviceSkeleton label="Loading the spend sleeve" />;
  if (example.status === 'error') {
    return <LoadError what="The spend sleeve" retry={example.retry} className="w-full max-w-[20.625rem]" />;
  }
  if (example.data === null) {
    return (
      <DeviceEmpty screen="Home" title="Spend">
        The spend share of your first payment lands here as USDG.
      </DeviceEmpty>
    );
  }
  return <Spend data={example.data} />;
}

function Spend({ data }: { data: ExampleAccount }): JSX.Element {
  const { ledger, payments } = data;
  const split = payments.filter((payment) => payment.state === 'SORTED').slice(0, 3);
  return (
    <Device
      screen="Home"
      title="Spend"
      chip={
        ledger.unsorted > 0n ? (
          <Chip
            icon={<TokenIcon token="USDG" size="md" decorative />}
            label="Not split yet"
            value={<Amount value={formatUsdg(ledger.unsorted)} unit="USDG" />}
          />
        ) : undefined
      }
    >
      <p className="flex items-baseline gap-2">
        <span className="text-figure-m tabular-nums text-ink">{formatUsdg(ledger.spend)}</span>
        <span className="text-body-s text-ink-secondary">USDG</span>
      </p>
      <p className="mb-3.5 text-label text-ink-secondary">ready to use</p>
      {split.length === 0 ? null : (
        <>
          <p className="border-t border-border pt-3 text-micro font-semibold text-ink-secondary">Spend share of recent payments</p>
          <ul className="mt-1">
            {split.map((payment) => (
              <SpendLine key={payment.id} payment={payment} />
            ))}
          </ul>
        </>
      )}
    </Device>
  );
}

/** One payment's spend part: what stayed spendable out of what arrived. */
function SpendLine({ payment }: { payment: InboxItem }): JSX.Element {
  const split = usePaymentSplit(payment);
  const parts = split.status === 'ready' && split.data !== null ? splitPartsOf(split.data.receipt) : null;
  let amount: ReactNode;
  if (split.status === 'loading') amount = <Skeleton className="my-0.5 h-4 w-24" />;
  else if (parts === null) amount = <span className="text-ink-secondary">{split.status === 'error' ? 'Did not load' : 'Split recorded'}</span>;
  else amount = <Amount value={usdgExact(parts.spend)} unit="USDG" />;
  return (
    <li className="flex items-start gap-2.5 border-t border-border py-2 first:border-t-0">
      <TokenIcon token="USDG" size="sm" decorative className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-body-s font-semibold text-ink">{amount}</span>
        <span className="block text-label text-ink-secondary">
          from a <Amount value={formatUsdg(payment.amount)} unit="USDG" /> payment, {formatUtcDate(payment.timestamp)}
        </span>
      </span>
    </li>
  );
}

/** The Stock Tokens sleeve of the example account: each holding at its Chainlink value, and what still waits. */
export function StockTokensDevice(): JSX.Element {
  const example = useExampleAccount();
  if (example.status === 'loading') return <DeviceSkeleton label="Loading the Stock Tokens" />;
  if (example.status === 'error') {
    return <LoadError what="The Stock Tokens" retry={example.retry} className="w-full max-w-[20.625rem]" />;
  }
  if (example.data === null) {
    return (
      <DeviceEmpty screen="Holdings" title="Stock Tokens">
        Your Stock Tokens show up here, each with its value at the Chainlink price.
      </DeviceEmpty>
    );
  }
  return <StockTokens data={example.data} />;
}

function StockTokens({ data }: { data: ExampleAccount }): JSX.Element {
  const held = data.holdings.filter((holding) => holding.balance > 0n);
  const value = held.reduce((sum, holding) => sum + holding.value, 0n);
  const bucket = data.buckets[0];
  const waitingKey = bucket === undefined ? null : tickerTokenKey(bucket.tickerId);
  const oldestPrice = held.reduce<bigint | null>(
    (oldest, holding) => (oldest === null || holding.feed.updatedAt < oldest ? holding.feed.updatedAt : oldest),
    null,
  );
  return (
    <Device
      screen="Holdings"
      title="Stock Tokens"
      chip={
        bucket === undefined ? undefined : (
          <Chip
            icon={waitingKey === null ? <TokenIcon token="USDG" size="md" decorative /> : <TokenPair from="USDG" to={waitingKey} size="sm" decorative />}
            label={`Waiting to buy ${tickerSymbol(bucket.tickerId)}`}
            value={<Amount value={formatUsdg(bucket.amount)} unit="USDG" kind="waiting" />}
          />
        )
      }
    >
      <p className="flex items-baseline gap-2">
        <span className="text-figure-m tabular-nums text-ink">{formatUsdg(value)}</span>
        <span className="text-body-s text-ink-secondary">USDG</span>
      </p>
      <p className="mb-3.5 text-label text-ink-secondary">at Chainlink prices</p>
      {held.length === 0 ? (
        <p className="border-t border-border pt-3 text-body-s text-ink-secondary">None yet. The equity share buys them as payments arrive.</p>
      ) : (
        <ul>
          {held.map((holding) => {
            const symbol = tickerSymbol(holding.tickerId);
            return (
              <li key={holding.tickerId} className="flex items-start gap-2.5 border-t border-border py-2.5">
                <TickerIcon tickerId={holding.tickerId} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block text-body-s font-semibold">
                    <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" />
                  </span>
                  <DebtSecurityLine />
                  <span className="block text-label text-ink-secondary">
                    {holding.lots.length === 1 ? '1 lot' : `${holding.lots.length} lots`}
                  </span>
                </span>
                <span className="whitespace-nowrap text-body-s font-semibold tabular-nums text-ink">{formatUsdg(holding.value)} USDG</span>
              </li>
            );
          })}
        </ul>
      )}
      {oldestPrice === null ? null : (
        <p className="border-t border-border pt-2.5 text-micro text-ink-secondary">Chainlink prices as of {formatUtc(oldestPrice)}</p>
      )}
    </Device>
  );
}
