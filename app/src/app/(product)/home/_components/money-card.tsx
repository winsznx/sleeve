'use client';

import { formatUsdg, shortAddress, type Address, type Rule, type TickerId } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { useOpenReceive } from '@/components/shell/receive';
import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair, TokenStack } from '@/components/token/token-stack';
import { ReasonTag } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { Icon } from '@/components/ui/icons';
import type { BucketView, Holding, LedgerView, SplitPreview } from '@/data/types';

import { upNext, type UpNextLine } from '../_lib/overview';
import { OverviewCard } from './overview-card';

const NEXT_MARK: Record<UpNextLine['kind'], string> = {
  sort: 'border border-ink-muted',
  wait: 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
  idle: 'bg-equity',
};

function Figure({
  swatch,
  icon,
  label,
  value,
  children,
  className,
}: {
  swatch: string;
  icon: ReactNode;
  label: string;
  value: ReactNode;
  children?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-body-s text-ink-secondary">
          <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-pill', swatch)} />
          {label}
        </p>
        <span className="flex shrink-0">{icon}</span>
      </div>
      <p className="mt-1.5 text-figure-s tabular-nums text-ink lg:text-figure-m">{value}</p>
      {children === undefined ? null : <div className="mt-1 text-body-s text-ink-secondary">{children}</div>}
    </div>
  );
}

function Usdg({ amount }: { amount: bigint }): JSX.Element {
  return (
    <>
      <span className="whitespace-nowrap">{formatUsdg(amount)}</span> <span className="text-body-s font-medium text-ink-secondary">USDG</span>
    </>
  );
}

export interface MoneyCardProps {
  /** The payment address, shown short with copy on a phone, where the full card sits below the fold. */
  account: Address;
  ledger: LedgerView;
  holdings: readonly Holding[];
  buckets: readonly BucketView[];
  rule: Rule;
  /** previewSplit, for what the unsorted USDG would become. */
  preview: SplitPreview;
  /** When a ticker's market next opens, for what waits on it. */
  reopensAt: (tickerId: TickerId) => bigint | null | undefined;
  className?: string;
}

/**
 * The money at a glance (PRD 15, D-029): what is spendable, what waits to buy and why, and the Stock Tokens held,
 * each with its token marks and the one rail that sets them side by side, all in the owner's own account. Send and
 * Receive sit in its corner, the two ways money crosses the account's edge.
 */
export function MoneyCard({ account, ledger, holdings, buckets, rule, preview, reopensAt, className }: MoneyCardProps): JSX.Element {
  const openReceive = useOpenReceive();
  const held = holdings.filter((holding) => holding.balance > 0n);
  const value = held.reduce((sum, holding) => sum + holding.value, 0n);
  const keys = held.map((holding) => tickerTokenKey(holding.tickerId)).filter((key): key is TokenKey => key !== null);
  const waitingTicker: TickerId = buckets[0]?.tickerId ?? rule.tickerId;
  const waitingToken = tickerTokenKey(waitingTicker);
  const firstReason = buckets[0]?.reason ?? 'NONE';
  const spendable = ledger.spend + ledger.unsorted;
  const everything = spendable + ledger.pendingTotal + value;
  const next = upNext(preview, buckets, rule, reopensAt);

  return (
    <OverviewCard
      title="Your money"
      className={className}
      aside={
        <>
          <ButtonLink href="/send" size="sm" icon="send">
            Send
          </ButtonLink>
          {openReceive === null ? (
            <ButtonLink href="#receive" size="sm" variant="secondary" icon="receive">
              Receive
            </ButtonLink>
          ) : (
            <Button size="sm" variant="secondary" icon="receive" onClick={openReceive} aria-haspopup="dialog">
              Receive
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-2 rounded-row bg-surface-muted py-1 pl-3 pr-1 md:hidden">
        <p className="min-w-0 text-body-s text-ink-secondary">
          Your payment address <span className="whitespace-nowrap font-mono text-mono-s text-ink">{shortAddress(account)}</span>
        </p>
        <CopyButton value={account} label="Copy your payment address" />
      </div>
      <p className="text-figure-l tabular-nums text-ink">
        <span className="whitespace-nowrap">{formatUsdg(everything)}</span> <span className="text-h3 font-medium text-ink-secondary">USDG</span>
      </p>
      <p className="mt-1 text-body-s text-ink-secondary">
        In your own account on Robinhood Chain{held.length === 0 ? '' : ', Stock Tokens valued at the Chainlink reference'}.
      </p>
      <SplitRail parts={{ spend: spendable, equity: value, waiting: ledger.pendingTotal }} className="mb-5 mt-4" />
      <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 sm:gap-x-6">
        <Figure swatch="bg-spend" icon={<TokenIcon token="USDG" size="sm" decorative />} label="Spendable" value={<Usdg amount={ledger.spend} />}>
          {ledger.unsorted > 0n ? (
            <>
              Plus <span className="whitespace-nowrap font-medium text-ink">{usdgText(ledger.unsorted)}</span> not sorted yet, also spendable.
            </>
          ) : (
            'USDG your rule kept spendable.'
          )}
        </Figure>

        <Figure
          swatch="bg-equity"
          icon={
            keys.length === 0 ? (
              <span className="grid size-icon place-items-center rounded-[6px] bg-equity-surface text-equity">
                <Icon name="split" className="size-3.5" />
              </span>
            ) : keys.length === 1 && keys[0] !== undefined ? (
              <TokenIcon token={keys[0]} size="sm" decorative />
            ) : (
              <TokenStack tokens={keys} size="sm" max={3} decorative />
            )
          }
          label="Stock Tokens"
          value={held.length === 0 ? 'None yet' : <Usdg amount={value} />}
        >
          {held.length === 0 ? (
            'Your equity share buys them as payments arrive.'
          ) : (
            <>
              {held.map((holding) => tickerSymbol(holding.tickerId)).join(' and ')} at the Chainlink reference
              <DebtSecurityLine className="mt-0.5" />
            </>
          )}
        </Figure>

        <Figure
          swatch="bg-waiting-stripes ring-1 ring-inset ring-waiting"
          icon={waitingToken === null ? <TokenIcon token="USDG" size="sm" decorative /> : <TokenPair from="USDG" to={waitingToken} size="sm" decorative />}
          label={ledger.pendingTotal > 0n ? `Waiting to buy ${tickerSymbol(waitingTicker)}` : 'Waiting to buy'}
          value={<Usdg amount={ledger.pendingTotal} />}
          className="col-span-2 sm:col-span-1"
        >
          {ledger.pendingTotal > 0n ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <ReasonTag reason={firstReason} />
              <a href="#waiting" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
                See why
              </a>
            </span>
          ) : (
            'Nothing waits now. It shows here while the market is closed.'
          )}
        </Figure>
      </div>
      <div className="mt-auto pt-5">
        <div className="rounded-large bg-surface-muted px-4 py-3">
          <h3 className="text-label font-medium text-ink-secondary">Up next</h3>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {next.map((line) => (
              <li key={line.id} className="flex items-start gap-2.5 text-body-s text-ink">
                <span aria-hidden="true" className={cx('mt-1.5 size-2 shrink-0 rounded-pill', NEXT_MARK[line.kind])} />
                <span className="min-w-0">{line.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </OverviewCard>
  );
}
