'use client';

import { CHAIN_NAME, RULE_DEFAULTS, TOTAL_BPS, formatBps, formatStockToken, formatUsdg, shortAddress, type Rule } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { AccountAvatar } from '@/components/shell/account-avatar';
import { NavIcon, type NavIconName } from '@/components/shell/glyphs';
import { premiumSentence } from '@/components/sleeve/premium-line';
import { SplitRail } from '@/components/sleeve/split-rail';
import { reasonSentence, tickerSymbol, usdgExact, usdgExactText } from '@/components/sleeve/text';
import type { TokenKey } from '@/components/token/registry';
import { TickerIcon, tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair, TokenStack } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { ReasonTag } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatNewYork } from '@/components/ui/format-time';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { SplitMark } from '@/components/ui/wordmark';
import type { BucketView, Holding, MarketSnapshot, ReceiptRecord } from '@/data/types';

import { APP_HREFS } from './copy';
import styles from './landing.module.css';
import { EXAMPLE_ACCOUNT_LABEL, useChainNow, useExampleAccount, type ExampleAccount, type Remote } from './landing-data';
import { formatCountdown, formatUtcClock, formatUtcDayLong, isoInstant } from './landing-time';
import { SplitDot } from './primitives';
import { LoadError, SessionPill } from './widgets';

/**
 * The hero's product scene (blueprint section 3.3), built from Sleeve's own components and fed by the data layer.
 * Left, on the neutral field: one payday as it reached the owner, a payment that resolves into its two parts
 * (PRD 15's winning screenshot). Right, on the green stage: the account it landed in, with both sleeves, the rule's
 * split and the Stock Tokens held, a weekend payday's wait hanging off its corner with the time until the market
 * opens, and the account's tokens as bubbles.
 */
export function HeroScene({ className }: { className?: string }): JSX.Element {
  const example = useExampleAccount();
  return (
    <div
      role="group"
      aria-label={`${EXAMPLE_ACCOUNT_LABEL}: one payday and the account it landed in`}
      className={cx('grid gap-6 xl:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] xl:gap-[1.625rem]', className)}
    >
      <PaydayPanel example={example} />
      <Stage example={example} />
    </div>
  );
}

function PaydayPanel({ example }: { example: Remote<ExampleAccount | null> }): JSX.Element {
  let content: ReactNode;
  if (example.status === 'loading') content = <PaydaySkeleton />;
  else if (example.status === 'ready' && example.data !== null && example.data.record.receipt.status === 'FILLED') {
    content = <Payday record={example.data.record} />;
  } else content = <GenericPayday />;

  return (
    <div className="flex min-h-[23.75rem] flex-col justify-between gap-8 overflow-hidden rounded-card bg-art-neutral p-5 sm:p-[1.625rem] md:flex-row md:items-end xl:min-h-[32.5rem] xl:flex-col xl:items-stretch xl:pt-14">
      {content}
    </div>
  );
}

type TileTone = 'neutral' | 'spend' | 'equity';

const TILE_TONE: Record<TileTone, string> = {
  neutral: 'bg-surface-muted',
  spend: 'bg-spend-soft',
  equity: 'bg-equity-soft',
};

interface NoteCardProps {
  as?: 'div' | 'li';
  tone: TileTone;
  icon: ReactNode;
  title: string;
  value?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** closeout's float card: a white notification on the field, its icon tile tinted by the part of the split it names. */
function NoteCard({ as: Element = 'div', tone, icon, title, value, children, className }: NoteCardProps): JSX.Element {
  return (
    <Element className={cx('flex items-start gap-3 rounded-module bg-surface px-4 py-3.5 shadow-floating sm:px-[1.125rem]', className)}>
      <span aria-hidden="true" className={cx('grid size-icon-tile shrink-0 place-items-center rounded-row', TILE_TONE[tone])}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-body font-semibold text-ink">{title}</p>
          {value === undefined ? null : <p className="text-body font-semibold">{value}</p>}
        </div>
        <div className="mt-0.5 text-body-s text-ink-secondary">{children}</div>
      </div>
    </Element>
  );
}

/**
 * The time the payday split, set like a lock screen above the notifications it brought, with the rule that split it
 * as the screen's one widget.
 */
function PaydayClock({ at, rule }: { at: bigint; rule: Rule | null }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 text-center md:items-start md:text-left xl:items-center xl:text-center">
      <p className="flex flex-col items-center md:items-start xl:items-center">
        <span className="text-body-s font-semibold text-ink-secondary">{formatUtcDayLong(at)}</span>
        <time dateTime={isoInstant(at)} className="mt-1 text-display-xl tabular-nums text-ink">
          {formatUtcClock(at)}
        </time>
        <span className="text-label font-medium text-ink-secondary">UTC</span>
      </p>
      {rule === null ? null : (
        <p
          className={cx(
            'inline-flex items-center gap-2 rounded-pill border border-glass-light-edge bg-glass-light px-3.5 py-1.5 text-label text-ink-secondary shadow-soft',
            styles.glass,
          )}
        >
          <SplitMark />
          <span>
            Rule: {formatBps(TOTAL_BPS - rule.equityBps)} stays <TokenIcon token="USDG" size="xs" decorative /> USDG,{' '}
            {formatBps(rule.equityBps)} buys <TickerIcon tickerId={rule.tickerId} size="xs" /> {tickerSymbol(rule.tickerId)}
          </span>
        </p>
      )}
    </div>
  );
}

const STACK = 'flex w-full flex-col gap-3 md:max-w-[26rem] xl:max-w-none';
const PARTS = 'ml-5 flex flex-col gap-3 border-l border-ink/15 pl-4';

/** One payday that bought: the payment, then what it became, every number from the split's own record. */
function Payday({ record }: { record: ReceiptRecord }): JSX.Element {
  const { receipt, derived } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const payer = derived.inbound[0]?.from;
  const equityBps = derived.rule?.equityBps;
  return (
    <>
      <PaydayClock at={receipt.timestamp} rule={derived.rule} />
      <div className={STACK}>
        <NoteCard
          tone="neutral"
          icon={<TokenIcon token="USDG" size="md" decorative />}
          title="Payment arrived"
          value={<Amount value={formatUsdg(receipt.usdgIn)} unit="USDG" />}
          className={styles.rise}
        >
          {payer === undefined ? (
            `USDG on ${CHAIN_NAME}`
          ) : (
            <>
              From <span className="font-mono text-mono-s">{shortAddress(payer)}</span> on {CHAIN_NAME}
            </>
          )}
        </NoteCard>
        <ul aria-label="What the payment became" className={PARTS}>
          <NoteCard
            as="li"
            tone="spend"
            icon={<TokenIcon token="USDG" size="md" decorative />}
            title="Stays spendable"
            value={<Amount value={usdgExact(receipt.usdgToSpend)} unit="USDG" kind="spend" />}
            className={cx(styles.rise, styles.riseSecond)}
          >
            {equityBps === undefined ? 'Kept as USDG' : `${formatBps(TOTAL_BPS - equityBps)} of the payment, kept as USDG`}
          </NoteCard>
          <NoteCard
            as="li"
            tone="equity"
            icon={<TickerIcon tickerId={receipt.tickerId} size="md" />}
            title={`Became ${symbol}`}
            value={<Amount value={formatStockToken(receipt.tokensOut)} unit={symbol} kind="equity" />}
            className={cx(styles.rise, styles.riseThird)}
          >
            <DebtSecurityLine />
            <span className="mt-0.5 block">
              For {usdgExactText(receipt.usdgSpent)}. {premiumSentence('buy', receipt.premiumBps)}
            </span>
          </NoteCard>
        </ul>
      </div>
    </>
  );
}

/** Before an example payday exists, the same story without numbers. */
function GenericPayday(): JSX.Element {
  const ticker = RULE_DEFAULTS.tickerId;
  return (
    <>
      <p className="max-w-[16rem] text-body-s font-medium text-ink-secondary">What every payday does</p>
      <div className={STACK}>
        <NoteCard tone="neutral" icon={<TokenIcon token="USDG" size="md" decorative />} title="A payment arrives">
          USDG on {CHAIN_NAME}, from anyone who pays you
        </NoteCard>
        <ul aria-label="What it becomes" className={PARTS}>
          <NoteCard as="li" tone="spend" icon={<TokenIcon token="USDG" size="md" decorative />} title="The spend share stays USDG">
            Ready to use, in your own account
          </NoteCard>
          <NoteCard as="li" tone="equity" icon={<TickerIcon tickerId={ticker} size="md" />} title="The equity share buys a Stock Token">
            <DebtSecurityLine />
          </NoteCard>
        </ul>
      </div>
    </>
  );
}

function PaydaySkeleton(): JSX.Element {
  return (
    <SkeletonGroup
      label="Loading an example payday"
      className="flex w-full flex-1 flex-col justify-between gap-8 md:flex-row md:items-end xl:flex-col xl:items-stretch"
    >
      <span className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-12 w-36 rounded-row" />
      </span>
      <span className={STACK}>
        <Skeleton className="h-[4.75rem] w-full rounded-module" />
        <Skeleton className="ml-9 h-[4.75rem] rounded-module" />
        <Skeleton className="ml-9 h-24 rounded-module" />
      </span>
    </SkeletonGroup>
  );
}

/** The card is 430 px wide; the waiting card hangs off its lower left corner from 768 px. */
const CARD_FRAME = 'relative w-full max-w-[26.875rem]';

function Stage({ example }: { example: Remote<ExampleAccount | null> }): JSX.Element {
  let content: ReactNode;
  let bubbles: readonly TokenKey[] = ['USDG', 'SPY', 'QQQ'];
  let floating = example.status === 'loading';
  if (example.status === 'loading') content = <AccountSkeleton />;
  else if (example.status === 'error') {
    content = <LoadError what={EXAMPLE_ACCOUNT_LABEL} retry={example.retry} className="shadow-overlay" />;
  } else if (example.data === null) content = <SuggestedStart />;
  else {
    content = <AccountCard data={example.data} />;
    bubbles = bubbleTokens(example.data);
    floating = example.data.buckets.length > 0;
  }

  return (
    <div
      className={cx(
        'relative flex items-start justify-center overflow-hidden rounded-card bg-stage px-3.5 py-6 md:px-8 md:pt-9',
        floating ? 'md:pb-[9.5rem]' : 'md:pb-11',
      )}
    >
      <div className={CARD_FRAME}>{content}</div>
      <div aria-hidden="true" className="pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 flex-col gap-3 md:flex">
        {bubbles.map((token) => (
          <span
            key={token}
            className={cx('grid size-[3.625rem] place-items-center rounded-pill border border-glass-light-edge bg-glass-light shadow-floating', styles.glass)}
          >
            <TokenIcon token={token} size="lg" decorative />
          </span>
        ))}
      </div>
    </div>
  );
}

/** The Stock Tokens an account holds, as icon keys, ascending ticker id. */
function heldTokens(holdings: readonly Holding[]): TokenKey[] {
  return holdings.flatMap((holding) => {
    const key = holding.balance > 0n ? tickerTokenKey(holding.tickerId) : null;
    return key === null ? [] : [key];
  });
}

/** USDG, then the Stock Tokens the account holds, three at most. */
function bubbleTokens(data: ExampleAccount): TokenKey[] {
  return ['USDG' as const, ...heldTokens(data.holdings)].slice(0, 3);
}

function AccountCard({ data }: { data: ExampleAccount }): JSX.Element {
  const { record, ledger, holdings, rule, market } = data;
  const ruleMarket = market.tickers.find((ticker) => ticker.tickerId === rule.tickerId);
  const held = holdings.filter((holding) => holding.balance > 0n);
  const heldValue = held.reduce((sum, holding) => sum + holding.value, 0n);
  const bucket = data.buckets[0];
  return (
    <>
      <div className="rounded-workspace bg-surface p-3.5 shadow-overlay sm:p-[1.125rem]">
        <div className="flex flex-wrap items-center gap-3 px-1 pb-4 pt-1">
          <AccountAvatar address={record.receipt.account} />
          <div className="min-w-0">
            <p className="text-body font-semibold text-ink">{EXAMPLE_ACCOUNT_LABEL}</p>
            <p className="text-label text-ink-secondary">
              Payment address <span className="font-mono text-mono-s">{shortAddress(record.receipt.account)}</span>
            </p>
          </div>
          {ruleMarket === undefined ? null : <SessionPill session={ruleMarket.session} className="ml-auto" />}
        </div>

        <div className="rounded-module bg-surface-muted p-3 sm:p-4">
          <ul aria-label="The two sleeves" className="grid grid-cols-2 gap-2.5">
            <SleeveTile
              kind="spend"
              title="Spend"
              amount={ledger.spend}
              note="USDG, ready to use"
              mark={<TokenIcon token="USDG" size="sm" decorative />}
            />
            <SleeveTile
              kind="equity"
              title="Stock Tokens"
              amount={heldValue}
              note="USDG at Chainlink prices"
              mark={<TokenStack tokens={heldTokens(held)} size="sm" surface="surface" decorative />}
            />
          </ul>
          <RuleSplit rule={rule} className="mt-4" />
          <QuickActions className="mt-4 border-t border-border pt-4" />
        </div>

        <Holdings holdings={held} />
      </div>
      {bucket === undefined ? null : <WaitingFloat bucket={bucket} market={market} readAt={data.marketReadAt} />}
    </>
  );
}

const SLEEVE_LOOK = {
  spend: { tile: 'border-spend-border bg-spend-surface', title: 'text-spend' },
  equity: { tile: 'border-equity-border bg-equity-surface', title: 'text-equity' },
} as const;

/** One sleeve as a tile in its own tint (docs/DESIGN.md 2.5). The amount stays ink; the title carries the tone. */
function SleeveTile({
  kind,
  title,
  amount,
  note,
  mark,
}: {
  kind: keyof typeof SLEEVE_LOOK;
  title: string;
  amount: bigint;
  note: string;
  mark: ReactNode;
}): JSX.Element {
  const look = SLEEVE_LOOK[kind];
  return (
    <li className={cx('flex min-w-0 flex-col rounded-row border px-3 py-2.5 sm:px-3.5 sm:py-3', look.tile)}>
      <span className="flex items-center justify-between gap-2">
        <span className={cx('text-body-s font-semibold', look.title)}>{title}</span>
        <span className="hidden sm:inline-flex">{mark}</span>
      </span>
      <span className="mt-1.5 whitespace-nowrap text-figure-s tabular-nums text-ink sm:text-figure-m">{formatUsdg(amount)}</span>
      <span className="text-label text-ink-secondary">{note}</span>
    </li>
  );
}

/** The rule as the split rail: what stays spendable and what buys, with the ticker's icon. */
function RuleSplit({ rule, className }: { rule: Pick<Rule, 'equityBps' | 'tickerId' | 'status'>; className?: string }): JSX.Element {
  const spendBps = TOTAL_BPS - rule.equityBps;
  const symbol = tickerSymbol(rule.tickerId);
  return (
    <div className={className}>
      <p className="mb-2 text-label font-medium text-ink-secondary">
        {rule.status === 'PAUSED' ? 'Rule paused: new USDG stays unsorted and spendable' : 'Each payment, by your rule'}
      </p>
      <SplitRail parts={{ spend: BigInt(spendBps), equity: BigInt(rule.equityBps), waiting: 0n }} animate />
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-body-s text-ink-secondary">
        <li className="flex items-center gap-1.5">
          <SplitDot kind="spend" />
          <span>
            <span className="font-semibold text-spend">{formatBps(spendBps)}</span> stays{' '}
            <TokenIcon token="USDG" size="xs" decorative /> USDG
          </span>
        </li>
        <li className="flex items-center gap-1.5">
          <SplitDot kind="equity" />
          <span>
            <span className="font-semibold text-equity">{formatBps(rule.equityBps)}</span> buys{' '}
            <TickerIcon tickerId={rule.tickerId} size="xs" /> {symbol}
          </span>
        </li>
      </ul>
    </div>
  );
}

/** The app's places with the icons its navigation uses (components/sleeve/navigation.ts). */
const QUICK_ACTIONS: readonly { href: string; label: string; icon: NavIconName }[] = [
  { href: APP_HREFS.payments, label: 'Payments', icon: 'inbox' },
  { href: APP_HREFS.holdings, label: 'Holdings', icon: 'holdings' },
  { href: APP_HREFS.rule, label: 'Rule', icon: 'rule' },
  { href: APP_HREFS.history, label: 'History', icon: 'history' },
];

/** The app's own destinations, as closeout's quick actions. They are real links into the app. */
function QuickActions({ className }: { className?: string }): JSX.Element {
  return (
    <ul aria-label="In the app" className={cx('grid grid-cols-4 gap-1.5', className)}>
      {QUICK_ACTIONS.map((action) => (
        <li key={action.href}>
          <Link
            href={action.href}
            className="group flex flex-col items-center gap-1.5 rounded-row py-1 text-micro font-medium text-ink-secondary transition-colors duration-fast hover:text-ink"
          >
            <span className="grid size-11 place-items-center rounded-pill border border-border bg-surface text-ink transition-colors duration-fast group-hover:border-border-strong">
              <NavIcon name={action.icon} />
            </span>
            {action.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Holdings({ holdings }: { holdings: readonly Holding[] }): JSX.Element {
  return (
    <div className="mt-3.5 overflow-hidden rounded-panel border border-border">
      <p className="border-b border-border px-3.5 py-2.5 text-body-s font-semibold text-ink">Stock Tokens held</p>
      {holdings.length === 0 ? (
        <p className="px-3.5 py-3 text-body-s text-ink-secondary">None yet. The equity share buys them as payments arrive.</p>
      ) : (
        <ul className="divide-y divide-border">
          {holdings.map((holding) => {
            const symbol = tickerSymbol(holding.tickerId);
            return (
              <li key={holding.tickerId} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 px-3.5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                <TickerIcon tickerId={holding.tickerId} size="lg" className="row-span-2 sm:row-span-1" />
                <div className="min-w-0">
                  <p className="text-body-s font-semibold">
                    <Amount value={formatStockToken(holding.balance)} unit={symbol} kind="equity" />
                  </p>
                  <DebtSecurityLine />
                </div>
                <p className="text-body-s font-semibold text-ink sm:text-right">
                  <Amount value={formatUsdg(holding.value)} unit="USDG" />
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * closeout's overlapping stat card, as the account's waiting buy and the time until the market opens. From 768 px it
 * hangs off the card's lower left corner over the card's padding only, so it hides nothing; on a phone it sits under
 * the card.
 */
function WaitingFloat({ bucket, market, readAt }: { bucket: BucketView; market: MarketSnapshot; readAt: number }): JSX.Element {
  const symbol = tickerSymbol(bucket.tickerId);
  const tickerKey = tickerTokenKey(bucket.tickerId);
  const session = market.tickers.find((ticker) => ticker.tickerId === bucket.tickerId)?.session;
  const opensAt = bucket.reason === 'SESSION' ? (session?.nextOpenAt ?? null) : null;
  const now = useChainNow(market.asOf.timestamp, readAt);
  return (
    <div className="mt-4 rounded-module border border-border bg-surface p-4 md:absolute md:right-[calc(100%_-_12.5rem)] md:top-[calc(100%_-_1.125rem)] md:mt-0 md:w-[17.5rem] md:border-0 md:shadow-overlay">
      <div className="flex flex-wrap items-center gap-2">
        {tickerKey === null ? null : <TokenPair from="USDG" to={tickerKey} size="sm" decorative />}
        <p className="text-body-s font-semibold text-ink">Waiting to buy {symbol}</p>
        {opensAt === null ? <ReasonTag reason={bucket.reason} className="ml-auto" /> : null}
      </div>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <Amount value={formatUsdg(bucket.amount)} unit="USDG" kind="waiting" className="text-figure-s" />
        <span className="text-label text-ink-secondary">kept as USDG</span>
      </p>
      <span aria-hidden="true" className="mt-2.5 block h-1.5 rounded-pill bg-waiting-stripes" />
      {opensAt === null ? (
        <p className="mt-2.5 text-label text-ink-secondary">{reasonSentence(bucket.reason, { symbol })}</p>
      ) : (
        <>
          <p className="mt-2.5 flex items-baseline justify-between gap-2 text-label text-ink-secondary">
            Market opens in
            <span className="whitespace-nowrap text-body-s font-semibold tabular-nums text-ink">{formatCountdown(opensAt - now)}</span>
          </p>
          <p className="text-label text-ink-secondary">{formatNewYork(opensAt)}</p>
        </>
      )}
    </div>
  );
}

/** With no example payday: the suggested start from onboarding (PRD 7.3), with no balances. */
function SuggestedStart(): JSX.Element {
  const symbol = tickerSymbol(RULE_DEFAULTS.tickerId);
  return (
    <div className="rounded-workspace bg-surface p-[1.125rem] shadow-overlay">
      <p className="px-1 text-body font-semibold text-ink">The suggested start</p>
      <p className="mt-1 px-1 text-body-s text-ink-secondary">
        Every payment: {formatBps(RULE_DEFAULTS.spendBps)} stays spendable and {formatBps(RULE_DEFAULTS.equityBps)} buys {symbol}.
      </p>
      <div className="mt-4 rounded-module bg-surface-muted p-[1.125rem]">
        <RuleSplit rule={{ ...RULE_DEFAULTS, status: 'ACTIVE' }} />
        <QuickActions className="mt-[1.125rem] border-t border-border pt-4" />
      </div>
    </div>
  );
}

function AccountSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label={`Loading the ${EXAMPLE_ACCOUNT_LABEL.toLowerCase()}`} className="rounded-workspace bg-surface p-[1.125rem] shadow-overlay">
      <span className="flex items-center gap-3 px-1 pb-4 pt-1">
        <Skeleton className="size-avatar rounded-control" />
        <span className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </span>
      </span>
      <Skeleton className="h-[17.5rem] w-full rounded-module" />
      <Skeleton className="mt-3.5 h-[11.5rem] w-full rounded-panel" />
      <Skeleton className="mt-3.5 h-16 w-full rounded-row" />
    </SkeletonGroup>
  );
}
