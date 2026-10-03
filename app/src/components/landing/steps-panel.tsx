'use client';

import { CHAIN_ID, CHAIN_NAME, RULE_DEFAULTS, TOTAL_BPS, formatBps, formatStockToken, formatUsdg, shortAddress } from '@sleeve/core';
import { useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from 'react';

import { premiumSentence } from '@/components/sleeve/premium-line';
import { SplitLegend, SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { NetworkGlyph } from '@/components/token/glyphs';
import { TickerIcon, tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { Amount } from '@/components/ui/amount';
import { Badge, CountBadge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatNewYork, formatUtc } from '@/components/ui/format-time';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';

import { STEP_ORDER, STEPS, type Step, type StepId } from './copy';
import styles from './landing.module.css';
import { EXAMPLE_ACCOUNT_LABEL, useExampleAccount, type ExampleAccount } from './landing-data';
import { PaymentRow } from './payment-row';
import { LoadError } from './widgets';

/** The split leads, as closeout's second step does: it is the part of a payday only Sleeve does. */
const FIRST_SELECTED: StepId = 'splits';

/** Each step's picture sits on its own field of the green scale, pale where it starts and deep where it lands. */
const FIELD: Record<StepId, string> = {
  address: 'bg-hero',
  arrives: 'bg-stage',
  splits: 'bg-step',
  lands: 'bg-accent-deep',
};

/**
 * closeout's step list (blueprint section 4.2) as the WAI-ARIA tabs pattern, vertical: the chosen step is the black
 * row, and its picture is drawn from the example account through the data layer. Arrow keys, Home and End move
 * between steps; only the chosen step is in the tab order.
 */
export function StepsPanel({ className }: { className?: string }): JSX.Element {
  const [active, setActive] = useState<StepId>(FIRST_SELECTED);
  const tabs = useRef<Partial<Record<StepId, HTMLButtonElement | null>>>({});
  const baseId = useId();
  const step = STEPS[active];
  const panelId = `${baseId}-panel`;
  const tabId = (id: StepId): string => `${baseId}-tab-${id}`;

  function choose(id: StepId): void {
    setActive(id);
    tabs.current[id]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    const last = STEP_ORDER.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    const id = next === null ? undefined : STEP_ORDER[next];
    if (id === undefined) return;
    event.preventDefault();
    choose(id);
  }

  return (
    <div
      className={cx(
        'grid items-center gap-5 rounded-card bg-surface-muted p-[1.125rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.82fr)] lg:gap-[2.125rem] lg:p-7',
        className,
      )}
    >
      <div role="tablist" aria-orientation="vertical" aria-label="How a payday works" className="flex flex-col gap-1">
        {STEP_ORDER.map((id, index) => {
          const item = STEPS[id];
          const selected = id === active;
          return (
            <button
              key={id}
              ref={(element) => {
                tabs.current[id] = element;
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(id)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cx(
                'flex w-full items-start gap-3.5 rounded-module p-3.5 text-left transition-colors duration-standard ease-standard focus-visible:outline-offset-[-2px] md:gap-[1.125rem] md:px-5 md:py-[1.125rem]',
                selected ? 'bg-brand text-on-brand focus-visible:outline-focus-inverse' : 'text-ink hover:bg-surface',
              )}
            >
              <span
                aria-hidden="true"
                className="grid size-10 shrink-0 place-items-center rounded-row bg-surface font-mono text-body-s text-ink-secondary md:size-12"
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="min-w-0 md:pt-0.5">
                <span className="block text-h3 font-medium md:text-h2 md:font-medium">{item.title}</span>
                <span className={cx('mt-1 block text-body-s', selected ? 'text-on-brand' : 'text-ink-secondary')}>{item.body}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(active)}
        tabIndex={0}
        className={cx(
          'flex min-h-[25rem] flex-col justify-between gap-5 overflow-hidden rounded-large p-4 sm:p-[1.375rem] lg:min-h-[34rem]',
          FIELD[step.id],
        )}
      >
        <div key={step.id} className={cx('flex flex-1 items-center justify-center', styles.fade)}>
          <StepArt step={step.id} />
        </div>
        <GlassStat step={step} />
      </div>
    </div>
  );
}

/** closeout's glass stat on deep glass, so the white figure passes AA over any part of any field. */
function GlassStat({ step }: { step: Step }): JSX.Element {
  return (
    <div className={cx('rounded-panel border border-glass-deep-edge bg-glass-deep px-5 py-4 text-center text-on-accent', styles.glass)}>
      <p className="text-display-l font-semibold tabular-nums">{step.stat}</p>
      <p className="mt-2 text-body-s">{step.statLabel}</p>
    </div>
  );
}

function StepArt({ step }: { step: StepId }): JSX.Element {
  const example = useExampleAccount();
  if (example.status === 'loading') {
    return (
      <SkeletonGroup label="Loading the example payday" className="w-full max-w-sm rounded-module bg-surface p-4 shadow-floating">
        <Skeleton className="h-4 w-32" />
        <SkeletonText lines={3} className="mt-4" />
      </SkeletonGroup>
    );
  }
  if (example.status === 'error') {
    return <LoadError what={EXAMPLE_ACCOUNT_LABEL} retry={example.retry} className="w-full max-w-sm shadow-floating" />;
  }
  const data = example.data;
  let art: JSX.Element;
  if (step === 'address') art = <AddressArt data={data} />;
  else if (step === 'arrives') art = <ArrivalArt data={data} />;
  else if (step === 'splits') art = <SplitArt data={data} />;
  else art = <LandsArt data={data} />;
  return (
    <div className="flex w-full max-w-sm flex-col items-start gap-2">
      <p className={cx('rounded-pill border border-glass-light-edge bg-glass-light px-2.5 py-1 text-label font-medium text-ink-secondary', styles.glass)}>
        {data === null ? 'How every payday runs' : EXAMPLE_ACCOUNT_LABEL}
      </p>
      {art}
    </div>
  );
}

function ArtCard({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cx('w-full rounded-module bg-surface p-4 text-left shadow-floating', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <p className="text-body-s font-semibold text-ink">{title}</p>
        {aside}
      </div>
      <div className="pt-3">{children}</div>
    </div>
  );
}

function NetworkLine(): JSX.Element {
  return (
    <p className="flex items-center gap-2 text-body-s text-ink-secondary">
      <NetworkGlyph className="size-4" />
      {CHAIN_NAME}, chain id {CHAIN_ID}
    </p>
  );
}

/** The address a payer needs, in its short form only, so nobody pays a sample account by copying it. */
function AddressArt({ data }: { data: ExampleAccount | null }): JSX.Element {
  if (data === null) {
    return (
      <ArtCard title="Your payment address">
        <p className="text-body-s text-ink-secondary">Your own smart account on {CHAIN_NAME}, made when you sign up.</p>
        <div className="mt-3 flex flex-col gap-1.5">
          <NetworkLine />
          <p className="flex items-center gap-2 text-body-s text-ink-secondary">
            <TokenIcon token="USDG" size="xs" decorative />
            Takes USDG from any wallet
          </p>
        </div>
      </ArtCard>
    );
  }
  const payers = [...new Set(data.payments.map((payment) => payment.from))];
  const shown = payers.slice(0, 3);
  return (
    <ArtCard title="Payment address" aside={<TokenIcon token="USDG" size="lg" chain />}>
      <p className="font-mono text-h2 text-ink">{shortAddress(data.record.receipt.account)}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        <NetworkLine />
        <p className="flex items-center gap-2 text-body-s text-ink-secondary">
          <TokenIcon token="USDG" size="xs" decorative />
          Takes USDG from any wallet
        </p>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-label font-medium text-ink-secondary">
          Paid so far by <span className="font-semibold tabular-nums text-ink">{payers.length}</span>{' '}
          {payers.length === 1 ? 'sender' : 'senders'}
        </p>
        <ul aria-label="Senders" className="mt-2 flex flex-wrap gap-1.5">
          {shown.map((payer) => (
            <li key={payer} className="rounded-pill border border-border bg-surface-muted px-2.5 py-1 font-mono text-mono-s text-ink-secondary">
              {shortAddress(payer)}
            </li>
          ))}
          {payers.length > shown.length ? (
            <li className="rounded-pill bg-surface-strong px-2.5 py-1 text-label font-semibold text-ink-secondary">
              {payers.length - shown.length} more
            </li>
          ) : null}
        </ul>
      </div>
    </ArtCard>
  );
}

/** The newest payments as the Payments screen lists them, with what each one became. */
function ArrivalArt({ data }: { data: ExampleAccount | null }): JSX.Element {
  if (data === null || data.payments.length === 0) {
    return (
      <ArtCard title="Payments">
        <p className="text-body-s text-ink-secondary">
          Each USDG transfer to your address shows up here, with who sent it and what your rule did with it.
        </p>
      </ArtCard>
    );
  }
  const recent = data.payments.slice(0, 3);
  return (
    <ArtCard title="Payments" aside={<CountBadge count={data.payments.length} />}>
      <ul className="-my-3 divide-y divide-border">
        {recent.map((payment) => (
          <PaymentRow key={payment.id} payment={payment} />
        ))}
      </ul>
    </ArtCard>
  );
}

/** The example payday split by the rule: the rail and its exact parts. */
function SplitArt({ data }: { data: ExampleAccount | null }): JSX.Element {
  const record = data?.record;
  if (record === undefined || record.receipt.status !== 'FILLED') {
    const symbol = tickerSymbol(RULE_DEFAULTS.tickerId);
    return (
      <ArtCard title="The suggested start">
        <SplitRail parts={{ spend: BigInt(RULE_DEFAULTS.spendBps), equity: BigInt(RULE_DEFAULTS.equityBps), waiting: 0n }} />
        <p className="mt-3 text-body-s text-ink-secondary">
          {formatBps(RULE_DEFAULTS.spendBps)} stays USDG, {formatBps(RULE_DEFAULTS.equityBps)} buys {symbol}.
        </p>
      </ArtCard>
    );
  }
  const { receipt, derived } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const equityBps = derived.rule?.equityBps;
  return (
    <ArtCard title={`Payday, ${formatUtc(receipt.timestamp)}`} aside={<Badge tone="equity">Split</Badge>}>
      <p className="flex items-center gap-2 text-body-s text-ink-secondary">
        <TokenIcon token="USDG" size="xs" decorative />
        <Amount value={formatUsdg(receipt.usdgIn)} unit="USDG" className="font-semibold text-ink" /> arrived
      </p>
      <SplitRail parts={{ spend: receipt.usdgToSpend, equity: receipt.usdgSpent, waiting: receipt.usdgQueued }} animate className="mt-3" />
      <SplitLegend
        className="mt-3"
        items={[
          { kind: 'spend', amount: receipt.usdgToSpend, label: 'spendable' },
          { kind: 'equity', amount: receipt.usdgSpent, label: `became ${symbol}` },
        ]}
      />
      <div className="mt-3 flex items-start gap-2.5 border-t border-border pt-3">
        <TickerIcon tickerId={receipt.tickerId} size="md" className="mt-0.5" />
        <div className="min-w-0">
          <p className="text-body-s font-semibold">
            <Amount value={formatStockToken(receipt.tokensOut)} unit={symbol} kind="equity" /> in the account
          </p>
          <DebtSecurityLine />
        </div>
      </div>
      {equityBps === undefined ? null : (
        <p className="mt-3 border-t border-border pt-3 text-body-s text-ink-secondary">
          Your rule: {formatBps(TOTAL_BPS - equityBps)} stays USDG, {formatBps(equityBps)} buys {symbol}.
        </p>
      )}
    </ArtCard>
  );
}

/** Where the equity share went: a Stock Token in the account, or USDG kept until the market opens. */
function LandsArt({ data }: { data: ExampleAccount | null }): JSX.Element {
  const record = data?.record;
  const bought = record !== undefined && record.receipt.status === 'FILLED' ? record.receipt : null;
  const boughtKey = bought === null ? null : tickerTokenKey(bought.tickerId);
  const bucket = data?.buckets[0];
  const waitingKey = bucket === undefined ? null : tickerTokenKey(bucket.tickerId);
  const opensAt =
    bucket === undefined || bucket.reason !== 'SESSION'
      ? null
      : (data?.market.tickers.find((ticker) => ticker.tickerId === bucket.tickerId)?.session.nextOpenAt ?? null);

  if (bought === null && bucket === undefined) {
    return (
      <ArtCard title="Where the equity share goes">
        <p className="text-body-s text-ink-secondary">
          Into your account as a Stock Token, or kept as USDG until the market opens and the price is inside your cap.
        </p>
        <DebtSecurityLine className="mt-2" />
      </ArtCard>
    );
  }

  return (
    <ArtCard title="Where the equity share went">
      <ul className="-my-3 divide-y divide-border">
        {bought === null ? null : (
          <li className="flex items-start gap-3 py-3">
            {boughtKey === null ? null : <TokenPair from="USDG" to={boughtKey} size="md" decorative />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-body font-semibold">
                  <Amount value={formatStockToken(bought.tokensOut)} unit={tickerSymbol(bought.tickerId)} kind="equity" />
                </p>
                <Badge tone="equity">Landed</Badge>
              </div>
              <DebtSecurityLine />
              <p className="mt-1 text-body-s text-ink-secondary">
                For {usdgExactText(bought.usdgSpent)}. {premiumSentence('buy', bought.premiumBps)}
              </p>
            </div>
          </li>
        )}
        {bucket === undefined ? null : (
          <li className="flex items-start gap-3 py-3">
            {waitingKey === null ? null : <TokenPair from="USDG" to={waitingKey} size="md" decorative />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <p className="text-body font-semibold">
                  <Amount value={formatUsdg(bucket.amount)} unit="USDG" kind="waiting" />
                </p>
                <Badge tone="waiting">Waiting</Badge>
              </div>
              <span aria-hidden="true" className="mt-2 block h-1.5 rounded-pill bg-waiting-stripes" />
              <p className="mt-2 text-body-s text-ink-secondary">
                {opensAt === null
                  ? `Kept as USDG to buy ${tickerSymbol(bucket.tickerId)} once the guard clears.`
                  : `Kept as USDG to buy ${tickerSymbol(bucket.tickerId)} after the market opens, ${formatNewYork(opensAt)}.`}
              </p>
            </div>
          </li>
        )}
      </ul>
    </ArtCard>
  );
}
