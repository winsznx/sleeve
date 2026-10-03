'use client';

import { RULE_LIMITS, parseUsdg, type Status } from '@sleeve/core';
import { useState, type JSX, type ReactNode } from 'react';

import { CountBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterPill, SegmentedControl } from '@/components/ui/choice';
import { Dialog } from '@/components/ui/dialog';
import { AmountInput, Checkbox, Input, Select } from '@/components/ui/field';
import { Slider } from '@/components/ui/slider';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { BucketWaitingCard } from '@/components/sleeve/bucket-waiting-card';
import { SplitRail, type SplitParts } from '@/components/sleeve/split-rail';
import type { BucketView } from '@/data/types';

import { KitExample, KitGrid } from './kit-section';

/** The interactive half of the kit. Each demo keeps its own state; nothing here reads the data layer. */

export function BusyButtonDemo(): JSX.Element {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="secondary" busy={busy} busyLabel="Releasing" onClick={() => setBusy(true)}>
        Release to spend
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setBusy(false)} disabled={!busy}>
        Reset
      </Button>
    </div>
  );
}

const EQUITY_PRESETS = [
  { value: '500', label: '5%' },
  { value: '1000', label: '10%' },
  { value: '2000', label: '20%' },
  { value: '5000', label: '50%' },
] as const;

type EquityPreset = (typeof EQUITY_PRESETS)[number]['value'];

const STATUS_FILTERS: readonly Status[] = ['FILLED', 'QUEUED', 'SETTLED', 'SOLD'];

function amountError(text: string): string | undefined {
  if (text === '') return undefined;
  const parsed = parseUsdg(text);
  if (!parsed.ok) return 'Enter an amount in USDG, such as 25 or 25.50.';
  return parsed.value < RULE_LIMITS.minClipFloor ? 'The minimum buy is at least 1 USDG.' : undefined;
}

export function FieldDemos(): JSX.Element {
  const [label, setLabel] = useState('Studio payroll');
  const [amount, setAmount] = useState('25');
  const [badAmount, setBadAmount] = useState('0.5');
  const [ticker, setTicker] = useState('0');
  const [attest, setAttest] = useState(false);
  const [cap, setCap] = useState(100);
  const [equity, setEquity] = useState<EquityPreset>('1000');
  const [filters, setFilters] = useState<Status[]>(['FILLED']);

  function toggleFilter(status: Status) {
    setFilters((current) => (current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  }

  return (
    <div className="flex flex-col gap-8">
      <KitGrid>
        <KitExample label="Input with a hint">
          <Input label="Label for this wallet" value={label} onChange={(event) => setLabel(event.target.value)} hint="Only you see it." />
        </KitExample>
        <KitExample label="Input with an error">
          <Input label="Label for this wallet" defaultValue="" placeholder="For example, savings" error="Enter a label of at least two letters." />
        </KitExample>
        <KitExample label="Input disabled">
          <Input label="Keeper" value="Sleeve's keeper" disabled readOnly />
        </KitExample>
        <KitExample label="Amount, USDG">
          <AmountInput
            label="Minimum buy"
            unit="USDG"
            decimals={6}
            value={amount}
            onValueChange={setAmount}
            error={amountError(amount)}
            hint="One swap stays a small part of each buy."
          />
        </KitExample>
        <KitExample label="Amount with an error">
          <AmountInput label="Minimum buy" unit="USDG" decimals={6} value={badAmount} onValueChange={setBadAmount} error={amountError(badAmount)} />
        </KitExample>
        <KitExample label="Amount disabled">
          <AmountInput label="Amount to sell" unit="SPY" decimals={18} value="0.084460" onValueChange={() => undefined} disabled />
        </KitExample>
        <KitExample label="Select">
          <Select label="Ticker" value={ticker} onChange={(event) => setTicker(event.target.value)} hint="A broad fund is the suggested start.">
            <option value="0">SPY</option>
            <option value="1">QQQ</option>
            <option value="2">NVDA</option>
            <option value="3">AAPL</option>
          </Select>
        </KitExample>
        <KitExample label="Select with an error">
          <Select label="Ticker" defaultValue="" error="Pick the ticker your equity share buys.">
            <option value="" disabled>
              Choose a ticker
            </option>
            <option value="0">SPY</option>
          </Select>
        </KitExample>
      </KitGrid>

      <KitGrid>
        <KitExample label="Checkbox">
          <Checkbox
            label="I am not a US person"
            description="Sleeve cannot be used by US persons."
            checked={attest}
            onChange={(event) => setAttest(event.target.checked)}
          />
          <Checkbox label="Disabled and checked" checked disabled readOnly />
        </KitExample>
        <KitExample label="Slider in basis points">
          <Slider
            label="Premium cap"
            value={cap}
            onValueChange={setCap}
            min={RULE_LIMITS.premiumCapBps.min}
            max={RULE_LIMITS.premiumCapBps.max}
            step={5}
            hint="How far above the market reference a buy may pay."
          />
        </KitExample>
      </KitGrid>

      <KitGrid>
        <KitExample label="Segmented control (radio pills)">
          <SegmentedControl
            legend="Equity share"
            options={EQUITY_PRESETS}
            value={equity}
            onChange={setEquity}
            hint="The rest of each payment stays spendable."
          />
        </KitExample>
        <KitExample label="Segmented control with a disabled option">
          <SegmentedControl
            legend="Ticker"
            options={[
              { value: 'SPY', label: 'SPY' },
              { value: 'QQQ', label: 'QQQ' },
              { value: 'NVDA', label: 'NVDA', disabled: true },
            ]}
            value="SPY"
            onChange={() => undefined}
          />
        </KitExample>
        <KitExample label="Filter pills">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter receipts by status">
            {STATUS_FILTERS.map((status) => (
              <FilterPill key={status} pressed={filters.includes(status)} onClick={() => toggleFilter(status)}>
                {status.charAt(0) + status.slice(1).toLowerCase()}
              </FilterPill>
            ))}
          </div>
        </KitExample>
      </KitGrid>
    </div>
  );
}

export function DialogDemo(): JSX.Element {
  const toast = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  function release() {
    setConfirmOpen(false);
    toast.show({
      title: 'Released 75.00 USDG to spend',
      body: 'Its receipt records the move.',
      action: { label: 'See receipts', href: '/receipts' },
    });
  }

  return (
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => setConfirmOpen(true)}>Release waiting USDG</Button>
      <Button variant="secondary" onClick={() => setInfoOpen(true)}>
        Long content
      </Button>
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Release 75.00 USDG to spend?"
        description="It stops waiting to buy SPY and moves to spend. It stays in your account as USDG."
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Keep waiting
            </Button>
            <Button onClick={release}>Release to spend</Button>
          </>
        }
      />
      <Dialog open={infoOpen} onClose={() => setInfoOpen(false)} title="How sorting works">
        <div className="space-y-3 text-body text-ink-secondary">
          {SORTING_STEPS.map((step) => (
            <p key={step}>{step}</p>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

const SORTING_STEPS = [
  'USDG that arrives from outside is income. Sleeve splits only that.',
  'Your rule splits it: the spend share stays USDG, the equity share buys Stock Tokens into your account.',
  'When the market is closed, or the price is further above the Chainlink reference than your cap allows, the equity share waits as USDG in your account.',
  'Every action writes a receipt that anyone can recompute from public chain data.',
  'USDG you move through Sleeve yourself, such as a top-up from a registered wallet, lands in spend and is never split.',
  'If the keeper does not sort a payment within an hour, anyone can start the split. It follows your rule either way.',
];

export function ToastDemo(): JSX.Element {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" size="sm" onClick={() => toast.show({ title: 'Rule saved', body: 'Version 3 applies from the next payment.' })}>
        Confirmation
      </Button>
      <Button variant="secondary" size="sm" onClick={() => toast.show({ tone: 'info', title: 'Card link copied' })}>
        Info
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => toast.show({ tone: 'warning', title: 'The market is closed', body: 'Your sell waits until it reopens.' })}
      >
        Warning
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          toast.show({
            tone: 'danger',
            title: 'The release did not go through',
            body: 'Nothing moved. Your USDG is still in your account.',
          })
        }
      >
        Error, stays until dismissed
      </Button>
    </div>
  );
}

export function TabsDemo({ panels }: { panels: { receipts: ReactNode; inbox: ReactNode; holdings: ReactNode } }): JSX.Element {
  return (
    <Tabs
      label="Activity"
      defaultValue="receipts"
      items={[
        { id: 'receipts', label: 'Receipts', badge: <CountBadge count={14} />, panel: panels.receipts },
        { id: 'inbox', label: 'Inbox', badge: <CountBadge count={2} />, panel: panels.inbox },
        { id: 'holdings', label: 'Holdings', panel: panels.holdings },
      ]}
    />
  );
}

export interface BucketDemoProps {
  bucket: BucketView;
  now: bigint;
  reopensAt?: bigint | null;
  rule?: { minClip: bigint; premiumCapBps: number };
}

export function BucketDemo({ bucket, now, reopensAt, rule }: BucketDemoProps): JSX.Element {
  const [releasing, setReleasing] = useState(false);
  return (
    <BucketWaitingCard
      bucket={bucket}
      now={now}
      reopensAt={reopensAt}
      rule={rule}
      onRelease={() => setReleasing(true)}
      releasing={releasing}
      ruleHref="/rule"
    />
  );
}

export function SplitReplay({ parts }: { parts: SplitParts }): JSX.Element {
  const [run, setRun] = useState(0);
  return (
    <div className="flex flex-col gap-3">
      <SplitRail key={run} parts={parts} animate />
      <div>
        <Button variant="ghost" size="sm" onClick={() => setRun((count) => count + 1)}>
          Play the split again
        </Button>
      </div>
    </div>
  );
}
