import { formatBps, formatStockToken, shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { tickerSymbol, tokenText, usdgExact, usdgExactText } from '@/components/sleeve/text';
import { TokenIcon } from '@/components/token/token-icon';
import type { TokenKey } from '@/components/token/registry';
import { Amount } from '@/components/ui/amount';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatNewYork, formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import type { InboundRef, ReceiptRecord } from '@/data/types';

import { Glyph } from '../../_components/glyphs';
import { ReceiptLead } from '../../_components/receipt-lead';
import { WaitReasonChip } from '../../_components/status-chip';
import { actionNumber } from '../../_lib/outcome';
import { correctionModel, moveModel, splitModel, type LotCut, type MoveSide, type SplitLeg } from '../receipt-panels';
import type { WaitOutcome } from '../wait-links';

/**
 * The first thing the details page shows after its title: what the action did with the money (D-024).
 *
 * A payday split arrives as one USDG amount, crosses Sleeve's split rail and comes out as legs: what stayed
 * spendable on apricot, what became the Stock Token on green with the debt security line under the token amount,
 * what waits as USDG on amber stripes, or what the guard refused. A buy after a wait, a release and a sale are one
 * move, drawn as two panels with an arrow tile between them, the way the sell screen draws a swap. A correction lists
 * the ledger cuts it made.
 */

/** The owner's lot today, for a buy: still held in full or in part, or sold out. Null for anyone else. */
export type LotNow = { kind: 'open'; bought: bigint; remaining: bigint } | { kind: 'closed' };

export interface ActionHeroProps {
  record: ReceiptRecord;
  /** The owner's lot today, when the viewer owns this buy. */
  lot?: LotNow | null;
  /** Where the owner sells from this lot. */
  sellHref?: string | null;
  /** For a payday whose equity share waited: the receipt that ended the wait, or the bucket still waiting. */
  waitOutcome?: WaitOutcome | null;
  /** When the market reopens, for a wait still on because the market is closed. */
  reopensAt?: bigint | null;
  /** For a buy after a wait or a release: the paydays whose equity share waited in the bucket it emptied. */
  waitedPaydays?: readonly ReceiptRecord[] | null;
}

export function ActionHero({
  record,
  lot = null,
  sellHref = null,
  waitOutcome = null,
  reopensAt = null,
  waitedPaydays = null,
}: ActionHeroProps): JSX.Element | null {
  const split = splitModel(record);
  if (split !== null) {
    return (
      <HeroFrame heading="The split" aside={<RuleAside record={record} />}>
        <Arrival amount={split.usdgIn} inbound={record.derived.inbound} />
        <SplitRail parts={split.parts} className="mt-5" />
        <ul aria-label="Where it went" className="mt-4 grid gap-3 sm:grid-cols-2">
          {split.legs.map((leg) => (
            <Leg key={leg.kind} leg={leg} lot={lot} sellHref={sellHref} outcome={waitOutcome} reopensAt={reopensAt} />
          ))}
        </ul>
        {split.premium === null ? null : <PriceLine sentence={split.premium} />}
      </HeroFrame>
    );
  }

  const move = moveModel(record);
  if (move !== null) {
    const owned = record.receipt.status === 'SETTLED' ? <LotNowLine lot={lot} symbol={move.to.symbol} sellHref={sellHref} /> : null;
    return (
      <HeroFrame heading={move.heading}>
        <div className="mt-4 grid items-stretch md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3">
          <MovePanel side={move.from} tone="surface">
            {waitedPaydays === null ? null : <WaitedPaydaysLine paydays={waitedPaydays} />}
          </MovePanel>
          <div className="relative z-10 -my-3.5 flex justify-center md:my-0 md:items-center">
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-row border-4 border-surface bg-surface-muted text-ink-secondary md:border-0 md:bg-surface">
              <Glyph name="arrowDown" className="md:hidden" />
              <Glyph name="arrowRight" className="hidden md:block" />
            </span>
          </div>
          <MovePanel side={move.to} tone="muted">
            {owned}
          </MovePanel>
        </div>
        {move.premium === null ? null : <PriceLine sentence={move.premium} />}
        {move.notes.map((note) => (
          <p key={note} className="mt-3 text-body-s text-ink-secondary">
            {note}
          </p>
        ))}
      </HeroFrame>
    );
  }

  const correction = correctionModel(record);
  if (correction !== null) {
    return (
      <HeroFrame heading="The correction">
        <p className="mt-3 max-w-reading text-body text-ink">{correction.sentence}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          {correction.shortfall === null ? null : (
            <CutTile label="Below the ledgers" amount={correction.shortfall} kind="plain" />
          )}
          {correction.cuts.map((cut) => (
            <CutTile key={cut.id} label={cut.label} amount={cut.amount} kind={cut.kind} />
          ))}
          {correction.lot === null ? null : <LotCutTile cut={correction.lot} />}
        </dl>
        <p className="mt-4 text-body-s text-ink-secondary">{correction.order}</p>
      </HeroFrame>
    );
  }
  return null;
}

function HeroFrame({ heading, aside, children }: { heading: string; aside?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <section aria-labelledby="action-hero-title" className="min-w-0 rounded-module border border-border bg-surface p-card shadow-card md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="action-hero-title" className="text-h3 text-ink">
          {heading}
        </h2>
        {aside === undefined ? null : <p className="text-body-s text-ink-secondary">{aside}</p>}
      </div>
      {children}
    </section>
  );
}

/** The rule version the split followed, read from the module's rule events, so it is labelled derived. */
function RuleAside({ record }: { record: ReceiptRecord }): JSX.Element | null {
  const rule = record.derived.rule;
  if (rule === null) return null;
  return (
    <>
      By rule {record.receipt.ruleVersion}: {formatBps(rule.equityBps)} to {tickerSymbol(rule.tickerId)}
      <span className="text-ink-muted"> (derived)</span>
    </>
  );
}

/** Who paid, from the Transfer logs: the first sender, and how many more payments the split sorted. */
function senderWords(inbound: readonly InboundRef[]): string | null {
  const first = inbound[0];
  if (first === undefined) return null;
  if (inbound.length === 1) return `from ${shortAddress(first.from)}`;
  return `from ${shortAddress(first.from)} and ${inbound.length - 1} more`;
}

function Arrival({ amount, inbound }: { amount: bigint; inbound: readonly InboundRef[] }): JSX.Element {
  const sender = senderWords(inbound);
  return (
    <div className="mt-4 flex items-center gap-3.5">
      <TokenIcon token="USDG" size="xl" chain decorative />
      <div className="min-w-0">
        <p className="text-figure-m text-ink">
          <Amount value={usdgExact(amount)} unit="USDG" />
        </p>
        <p className="mt-0.5 text-body-s text-ink-secondary">
          arrived{sender === null ? '' : ` ${sender}`}
          {sender === null ? null : <span className="text-ink-muted"> (derived)</span>}
        </p>
      </div>
    </div>
  );
}

const LEG_LOOK: Record<SplitLeg['kind'], { card: string; title: string; dot: string }> = {
  spend: { card: 'border-spend-border bg-spend-surface', title: 'text-spend', dot: 'bg-spend' },
  equity: { card: 'border-equity-border bg-equity-surface', title: 'text-equity', dot: 'bg-equity' },
  waiting: { card: 'border-border bg-surface', title: 'text-waiting', dot: 'bg-waiting-stripes' },
  refused: { card: 'border-border bg-surface-muted', title: 'text-danger', dot: 'bg-danger' },
};

function legTitle(leg: SplitLeg): string {
  switch (leg.kind) {
    case 'spend':
      return 'Stayed spendable';
    case 'equity':
      return `Became ${leg.symbol}`;
    case 'waiting':
      return `Waits to buy ${leg.symbol}`;
    case 'refused':
      return `${leg.symbol} not bought`;
  }
}

function legIcon(leg: SplitLeg): ReactNode {
  switch (leg.kind) {
    case 'spend':
    case 'waiting':
      return <TokenIcon token="USDG" size="md" decorative />;
    case 'equity':
      return leg.token === null ? null : <TokenIcon token={leg.token} size="md" decorative />;
    case 'refused':
      return leg.token === null ? (
        <TokenIcon token="USDG" size="md" decorative />
      ) : (
        <ReceiptLead lead={{ kind: 'pair', from: 'USDG', to: leg.token, mark: 'refused' }} size="md" />
      );
  }
}

interface LegProps {
  leg: SplitLeg;
  lot: LotNow | null;
  sellHref: string | null;
  outcome: WaitOutcome | null;
  reopensAt: bigint | null;
}

function Leg({ leg, lot, sellHref, outcome, reopensAt }: LegProps): JSX.Element {
  const look = LEG_LOOK[leg.kind];
  return (
    <li data-leg={leg.kind} className={cx('flex min-w-0 flex-col overflow-hidden rounded-row border', look.card)}>
      {leg.kind === 'waiting' ? <span aria-hidden="true" className="h-1.5 bg-waiting-stripes" /> : null}
      <div className="flex flex-1 flex-col p-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className={cx('flex items-center gap-2 text-body-s font-semibold', look.title)}>
            <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', look.dot)} />
            {legTitle(leg)}
          </p>
          <p className="text-body-s tabular-nums text-ink-secondary">{leg.percent}</p>
        </div>
        <div className="mt-3 flex items-center gap-2.5">
          {legIcon(leg)}
          <p className="min-w-0 text-figure-s text-ink">
            {leg.kind === 'equity' ? (
              <Amount value={formatStockToken(leg.tokens)} unit={leg.symbol} kind="equity" />
            ) : (
              <Amount value={usdgExact(leg.amount)} unit="USDG" />
            )}
          </p>
        </div>
        <LegDetail leg={leg} />
        {leg.kind === 'equity' ? <LotNowLine lot={lot} symbol={leg.symbol} sellHref={sellHref} /> : null}
        {leg.kind === 'waiting' && outcome !== null ? <WaitOutcomeLine outcome={outcome} symbol={leg.symbol} reopensAt={reopensAt} /> : null}
      </div>
    </li>
  );
}

const DERIVED = <span className="text-ink-muted"> (derived)</span>;
const INLINE_LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

/** What a receipt that ended a wait did, as "the buy", "the release", and so on. */
function closingNoun(record: ReceiptRecord): string {
  switch (record.receipt.status) {
    case 'SETTLED':
      return 'the buy';
    case 'RELEASED':
      return 'the release';
    default:
      return 'the refused buy';
  }
}

function closingSentence(record: ReceiptRecord, symbol: string): string {
  const at = formatUtc(record.receipt.timestamp);
  switch (record.receipt.status) {
    case 'SETTLED':
      return `It bought ${symbol} on ${at}.`;
    case 'RELEASED':
      return `It moved to spend on ${at}.`;
    default:
      return `It moved to spend on ${at}, when the guard refused the buy.`;
  }
}

/**
 * How the wait this payday started ended (wait-links.ts): the buy or release that took the waiting USDG out, or that
 * it is still waiting today. Read from the receipts after this one and the bucket, so it is labelled derived.
 */
function WaitOutcomeLine({ outcome, symbol, reopensAt }: { outcome: WaitOutcome; symbol: string; reopensAt: bigint | null }): JSX.Element {
  if (outcome.kind === 'waiting') {
    const reopen = outcome.bucket.reason === 'SESSION' && reopensAt !== null ? ` The market reopens ${formatNewYork(reopensAt)}.` : '';
    return (
      <p data-wait-outcome="waiting" className="mt-3 border-t border-border pt-3 text-body-s text-ink-secondary">
        <span className="font-medium text-ink">It is still waiting as USDG.</span>
        {reopen}
        {DERIVED}
      </p>
    );
  }
  const id = outcome.record.receipt.id.toString();
  return (
    <p data-wait-outcome={outcome.record.receipt.status} className="mt-3 border-t border-border pt-3 text-body-s text-ink-secondary">
      <span className="font-medium text-ink">{closingSentence(outcome.record, symbol)}</span>{' '}
      <Link href={`/receipts/${id}`} className={INLINE_LINK}>
        Open {closingNoun(outcome.record)}, {actionNumber(outcome.record.receipt.id)}
      </Link>
      {DERIVED}
    </p>
  );
}

/** The paydays whose equity share waited in the bucket this buy or release emptied, oldest first. */
function WaitedPaydaysLine({ paydays }: { paydays: readonly ReceiptRecord[] }): JSX.Element {
  return (
    <p data-waited-paydays={paydays.length} className="mt-3 border-t border-border pt-3 text-body-s text-ink-secondary">
      From{' '}
      {paydays.map((payday, index) => (
        <span key={payday.receipt.id.toString()}>
          {index === 0 ? null : index === paydays.length - 1 ? ' and ' : ', '}
          <Link href={`/receipts/${payday.receipt.id.toString()}`} className={INLINE_LINK}>
            payday {actionNumber(payday.receipt.id)}
          </Link>
        </span>
      ))}
      {DERIVED}
    </p>
  );
}

function LegDetail({ leg }: { leg: SplitLeg }): JSX.Element {
  switch (leg.kind) {
    case 'spend':
      return (
        <>
          <span aria-hidden="true" className="min-h-3 flex-1" />
          <p className="border-t border-spend-border pt-3 text-body-s text-ink-secondary">In the spend sleeve, ready to use.</p>
        </>
      );
    case 'equity':
      return (
        <>
          <DebtSecurityLine className="mt-0.5" />
          <p className="mt-1.5 text-body-s text-ink-secondary">
            for {usdgExactText(leg.amount)}
            {leg.lotId === 0n ? null : `, as lot ${leg.lotId.toString()}`}
          </p>
        </>
      );
    case 'waiting':
      return (
        <>
          <WaitReasonChip reason={leg.reason} className="mt-2 self-start" />
          <p className="mt-2 text-body-s text-ink-secondary">{leg.sentence}</p>
        </>
      );
    case 'refused':
      return <p className="mt-1.5 text-body-s text-ink-secondary">{leg.sentence}</p>;
  }
}

/** What the owner holds of this buy today, with the way to sell from it. */
function LotNowLine({ lot, symbol, sellHref }: { lot: LotNow | null; symbol: string; sellHref: string | null }): JSX.Element | null {
  if (lot === null) return null;
  if (lot.kind === 'closed') {
    return <p className="mt-3 border-t border-equity-border pt-3 text-body-s text-ink-secondary">Nothing is left in this lot today.</p>;
  }
  const sold = lot.bought - lot.remaining;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-equity-border pt-3">
      <p className="text-body-s text-ink-secondary">
        {sold <= 0n ? 'You still hold all of it.' : `You still hold ${tokenText(lot.remaining, symbol)} of it.`}
      </p>
      {sellHref === null ? null : (
        <ButtonLink href={sellHref} variant="secondary" size="sm" icon="sell">
          Sell from this lot
        </ButtonLink>
      )}
    </div>
  );
}

function PriceLine({ sentence }: { sentence: string }): JSX.Element {
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-s text-ink-secondary">
      <Icon name="check" className="size-4 text-success" />
      <span>{sentence}</span>
      <a href="#action-price" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
        See the price
      </a>
    </p>
  );
}

function TokenChip({ token, symbol }: { token: TokenKey | null; symbol: string }): JSX.Element {
  return (
    <span className="inline-flex min-h-control shrink-0 items-center gap-2 rounded-pill border border-border bg-surface py-1 pl-1.5 pr-3.5 text-body font-semibold text-ink">
      {token === null ? null : <TokenIcon token={token} size="md" decorative />}
      {symbol}
    </span>
  );
}

/** One side of a move, in the shape of a swap panel: what it was, the amount large, the token as a chip. */
function MovePanel({ side, tone, children }: { side: MoveSide; tone: 'surface' | 'muted'; children?: ReactNode }): JSX.Element {
  return (
    <div
      data-side={tone === 'surface' ? 'from' : 'to'}
      className={cx('flex min-w-0 flex-col rounded-large border p-4', tone === 'surface' ? 'border-border bg-surface' : 'border-transparent bg-surface-muted')}
    >
      <p className="text-body-s font-medium text-ink-secondary">
        {side.lotHref === null ? (
          side.label
        ) : (
          <Link href={side.lotHref} className="text-link underline underline-offset-4 hover:text-link-hover">
            {side.label}
          </Link>
        )}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 break-all text-figure-l tabular-nums text-ink">{side.amount}</span>
        <TokenChip token={side.token} symbol={side.symbol} />
      </div>
      {side.debtSecurity ? <DebtSecurityLine className="mt-1" /> : null}
      {side.note === null ? null : <p className="mt-1 text-body-s text-ink-secondary">{side.note}</p>}
      {children}
    </div>
  );
}

const CUT_DOT: Record<'spend' | 'waiting' | 'plain', string> = {
  spend: 'bg-spend',
  waiting: 'bg-waiting-stripes',
  plain: 'bg-ink-muted',
};

function CutTile({ label, amount, kind }: { label: string; amount: bigint; kind: 'spend' | 'waiting' | 'plain' }): JSX.Element {
  return (
    <div className="min-w-0 rounded-row border border-border bg-surface-muted p-4">
      <dt className="flex items-center gap-2 text-body-s text-ink-secondary">
        <span aria-hidden="true" className={cx('size-2.5 shrink-0 rounded-pill', CUT_DOT[kind])} />
        <span>
          {label} <span className="text-ink-muted">(derived)</span>
        </span>
      </dt>
      <dd className="mt-2 flex items-center gap-2.5 text-figure-s text-ink">
        <TokenIcon token="USDG" size="md" decorative />
        <Amount value={usdgExact(amount)} unit="USDG" />
      </dd>
    </div>
  );
}

/** The Stock Tokens a lot's correction trimmed off it, read from the receipt itself, with the lot it came off. */
function LotCutTile({ cut }: { cut: LotCut }): JSX.Element {
  const id = cut.lotId.toString();
  return (
    <div data-lot-cut={id} className="min-w-0 rounded-row border border-border bg-surface-muted p-4">
      <dt className="flex items-center gap-2 text-body-s text-ink-secondary">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill bg-equity" />
        <span>
          Taken off{' '}
          <Link href={`/receipts/${id}`} className={INLINE_LINK}>
            lot {id}
          </Link>
        </span>
      </dt>
      <dd className="mt-2 flex items-center gap-2.5 text-figure-s text-ink">
        {cut.token === null ? null : <TokenIcon token={cut.token} size="md" decorative />}
        <Amount value={formatStockToken(cut.tokens)} unit={cut.symbol} kind="equity" />
      </dd>
      <dd>
        <DebtSecurityLine className="mt-1" />
      </dd>
    </div>
  );
}
