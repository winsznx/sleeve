'use client';

import { formatBps, formatFeedPrice, formatUsdg, shortAddress, TOTAL_BPS, type Rule } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import type { WaitEnd } from '@/components/sleeve/payment-outcome';
import { SenderMark } from '@/components/sleeve/payment-row';
import { percentWords, tickerSymbol, tokenText, triggerLabel, usdgExactText, waitCause } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatDuration, formatNewYork, formatUtc, formatUtcDate } from '@/components/ui/format-time';
import type { Holding, InboxItem, ReceiptRecord } from '@/data/types';

/**
 * A payment's money trail (D-029): where it came from, how the rule split it, what stayed spendable, what bought which
 * Stock Token at what price against the market reference or why it waits and until when, and where the money sits
 * now. Every line is read from the transfer, the receipt that sorted it, the receipt that ended a wait and the
 * account's lots; the details page holds the proof.
 */

type Tone = 'arrive' | 'split' | 'spend' | 'equity' | 'waiting' | 'now';

const DOT: Record<Tone, string> = {
  arrive: 'bg-surface border-2 border-ink',
  split: 'bg-surface border-2 border-ink-muted',
  spend: 'bg-spend',
  equity: 'bg-equity',
  waiting: 'bg-waiting-stripes ring-1 ring-inset ring-waiting',
  now: 'bg-brand',
};

function Step({ tone, title, children, last = false }: { tone: Tone; title: ReactNode; children?: ReactNode; last?: boolean }): JSX.Element {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {last ? null : <span aria-hidden="true" className="absolute bottom-0 left-[5px] top-4 w-px bg-border-strong" />}
      <span aria-hidden="true" className={cx('relative mt-1 size-[11px] shrink-0 rounded-pill', DOT[tone])} />
      <div className="min-w-0 flex-1 text-body-s">
        <p className="font-semibold text-ink">{title}</p>
        {children === undefined ? null : <div className="mt-1 flex flex-col gap-1 text-ink-secondary">{children}</div>}
      </div>
    </li>
  );
}

function ruleWords(rule: Rule | null): string | null {
  if (rule === null) return null;
  return `rule version ${rule.version}: ${formatBps(TOTAL_BPS - rule.equityBps)} stays spendable and ${formatBps(rule.equityBps)} buys ${tickerSymbol(rule.tickerId)}`;
}

/** The buy's price line: "769.86 USDG per SPY, against a market reference of 768.21 USD, 0.21 percent above it." */
function priceWords(record: ReceiptRecord): string {
  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const side = r.premiumBps === 0n ? 'at it' : `${percentWords(r.premiumBps)} ${r.premiumBps > 0n ? 'above' : 'below'} it`;
  const cap = record.derived.rule === null ? '' : `, within your cap of ${percentWords(record.derived.rule.premiumCapBps)}`;
  return `At ${formatUsdg(r.execPrice)} USDG per ${symbol}, against a Chainlink market reference of ${formatFeedPrice(r.answer)} USD, ${side}${cap}.`;
}

/** What the lot a buy made holds now, from the account's open lots. */
function lotNow(lotId: bigint, tickerId: number, holdings: readonly Holding[] | undefined): { text: string; held: boolean } | null {
  if (holdings === undefined) return null;
  const symbol = tickerSymbol(tickerId);
  const lot = holdings.find((holding) => holding.tickerId === tickerId)?.lots.find((candidate) => candidate.id === lotId);
  if (lot === undefined) return { text: `Lot ${lotId} has been sold. Its USDG went to spend.`, held: false };
  if (lot.tokensRemaining === lot.tokensBought) {
    return { text: `${tokenText(lot.tokensRemaining, symbol)} held in your own account, lot ${lotId}.`, held: true };
  }
  return { text: `${tokenText(lot.tokensRemaining, symbol)} of lot ${lotId} still held in your account. The rest was sold to spend.`, held: true };
}

export interface MoneyTrailProps {
  item: InboxItem;
  /** The receipt that sorted it: undefined while it loads, null when it is not sorted or did not load. */
  record: ReceiptRecord | null | undefined;
  waitEnd: WaitEnd | null;
  holdings: readonly Holding[] | undefined;
  /** When the rule's ticker next opens, for a share that waits on the market. */
  reopensAt: bigint | null | undefined;
  /** Chain time now, for how long a wait has run. */
  now: bigint | undefined;
  id: string;
}

export function MoneyTrail({ item, record, waitEnd, holdings, reopensAt, now, id }: MoneyTrailProps): JSX.Element {
  const steps: JSX.Element[] = [];
  steps.push(
    <Step key="arrive" tone="arrive" title={`${usdgExactText(item.amount)} arrived`}>
      <p className="flex items-center gap-2.5">
        <SenderMark from={item.from} />
        <span className="min-w-0">
          From <span className="font-mono text-mono-s text-ink">{shortAddress(item.from)}</span>, {formatUtc(item.timestamp)}.
        </span>
      </p>
      <p>
        Transaction <span className="font-mono text-mono-s">{shortAddress(item.txHash)}</span>, read from the transfer log (derived).
      </p>
    </Step>,
  );

  if (item.state !== 'SORTED' || record === null || record === undefined) {
    steps.push(
      <Step
        key="split"
        tone="split"
        title={item.state !== 'SORTED' ? 'Not sorted yet' : record === undefined ? 'Reading its split' : 'The record of its split did not load'}
      >
        {item.state === 'SORTED' ? null : (
          <p>
            It is spendable in your account now. Your rule splits it at the next sort, by Sleeve&apos;s keeper or by you.
            {item.state === 'WAITING_GRACE' && item.graceEndsAt !== null
              ? ` If the keeper has not sorted it by ${formatUtc(item.graceEndsAt)}, anyone can start the split.`
              : ''}
          </p>
        )}
      </Step>,
    );
    steps.push(
      <Step key="now" tone="now" title="Where it is now" last>
        <p className="flex items-center gap-2">
          <TokenIcon token="USDG" size="xs" decorative />
          {usdgExactText(item.amount)} not sorted yet, in your own account.
        </p>
      </Step>,
    );
    return <Trail id={id} steps={steps} />;
  }

  const r = record.receipt;
  const symbol = tickerSymbol(r.tickerId);
  const others = record.derived.inbound.length - 1;
  const sortedAfter = r.timestamp >= item.timestamp ? ` ${formatDuration(r.timestamp - item.timestamp)} after it arrived` : '';
  const rule = ruleWords(record.derived.rule);

  if (r.status === 'RECONCILED') {
    steps.push(
      <Step key="split" tone="split" title="It matched your balance">
        <p>USDG had left your account outside Sleeve, so this payment went to bring the ledgers back to the balance. Nothing was left to split.</p>
      </Step>,
    );
  } else {
    steps.push(
      <Step key="split" tone="split" title="Your rule split it">
        <p>
          {triggerLabel(r.trigger)} started the split{sortedAfter}
          {rule === null ? '.' : `, under ${rule}.`}
        </p>
        {others > 0 ? <p>{others === 1 ? 'Split together with 1 other payment.' : `Split together with ${others} other payments.`}</p> : null}
      </Step>,
    );
  }

  const nowLines: ReactNode[] = [];
  const refused = r.status === 'REFUSED_TICKER' || r.status === 'REFUSED_ACCOUNT';
  const spendPart = refused ? r.usdgIn : r.usdgToSpend;
  if (r.status !== 'RECONCILED') {
    steps.push(
      <Step key="spend" tone="spend" title={`${usdgExactText(spendPart)} stayed spendable`}>
        <p>{refused ? `${symbol} could not be bought, so the equity share went to spend too.` : 'It went to your spendable USDG, in your own account.'}</p>
      </Step>,
    );
    nowLines.push(
      <p key="spend" className="flex items-center gap-2">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-spend" />
        {usdgExactText(spendPart)} as spendable USDG.
      </p>,
    );
  }

  if (r.status === 'FILLED') {
    steps.push(
      <Step key="equity" tone="equity" title={`${usdgExactText(r.usdgSpent)} bought ${tokenText(r.tokensOut, symbol)}`}>
        <p>{priceWords(record)}</p>
        <DebtSecurityLine />
      </Step>,
    );
    const lot = lotNow(r.lotId, r.tickerId, holdings);
    if (lot !== null) {
      nowLines.push(
        <p key="lot" className="flex items-center gap-2">
          <TickerIcon tickerId={r.tickerId} size="xs" />
          {lot.text}
        </p>,
      );
    }
  } else if (r.status === 'QUEUED') {
    if (waitEnd === null) {
      const waited = now !== undefined && now > r.timestamp ? ` It has waited ${formatDuration(now - r.timestamp)}.` : '';
      steps.push(
        <Step key="equity" tone="waiting" title={`${usdgExactText(r.usdgQueued)} waits to buy ${symbol}`}>
          <p>
            Why: {waitCause(r.reason)}.{waited}
          </p>
          <p>
            When:{' '}
            {r.reason === 'SESSION'
              ? `after the market reopens${reopensAt === null || reopensAt === undefined ? '' : `, ${formatNewYork(reopensAt)}`}. You can release it to spend before then.`
              : 'once the check that stopped it clears. You can release it to spend at any time.'}
          </p>
        </Step>,
      );
      nowLines.push(
        <p key="waiting" className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />
          {usdgExactText(r.usdgQueued)} as USDG, waiting to buy {symbol}.
        </p>,
      );
    } else if (waitEnd.kind === 'bought') {
      const settled = waitEnd.record;
      steps.push(
        <Step key="equity" tone="equity" title={`${usdgExactText(r.usdgQueued)} waited, then bought ${symbol}`}>
          <p>
            It waited because {waitCause(r.reason)}. On {formatUtcDate(settled.receipt.timestamp)} the USDG that waited bought{' '}
            {tokenText(settled.receipt.tokensOut, symbol)}, in buy #{settled.receipt.id.toString()}.
          </p>
          <p>{priceWords(settled)}</p>
          <DebtSecurityLine />
        </Step>,
      );
      const lot = lotNow(settled.receipt.lotId, r.tickerId, holdings);
      if (lot !== null) {
        nowLines.push(
          <p key="lot" className="flex items-center gap-2">
            <TickerIcon tickerId={r.tickerId} size="xs" />
            {lot.text}
          </p>,
        );
      }
    } else {
      steps.push(
        <Step key="equity" tone="spend" title={`${usdgExactText(r.usdgQueued)} waited, then moved to spend`}>
          <p>
            It waited because {waitCause(r.reason)}.{' '}
            {waitEnd.kind === 'released'
              ? `You released it to spend on ${formatUtcDate(waitEnd.record.receipt.timestamp)}.`
              : `On ${formatUtcDate(waitEnd.record.receipt.timestamp)} ${symbol} could not be bought, so it went to spend.`}
          </p>
        </Step>,
      );
      nowLines.push(
        <p key="released" className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-spend" />
          {usdgExactText(r.usdgQueued)} more as spendable USDG.
        </p>,
      );
    }
  }

  steps.push(
    <Step key="now" tone="now" title="Where it is now" last>
      {nowLines.length === 0 ? <p>Nothing of it is left apart: it went to match your balance.</p> : nowLines}
      <p className="text-ink-muted">Spendable USDG pools with the rest of your spend, so later sends are not traced to one payment.</p>
    </Step>,
  );
  return <Trail id={id} steps={steps} receiptId={r.id} />;
}

function Trail({ id, steps, receiptId }: { id: string; steps: JSX.Element[]; receiptId?: bigint }): JSX.Element {
  return (
    <div id={id} className="relative z-[1] mt-3 rounded-large border border-border bg-surface p-4 md:ml-[calc(var(--size-avatar)_+_0.75rem)]">
      <ol aria-label="Money trail">{steps}</ol>
      {receiptId === undefined ? null : (
        <Link
          href={`/receipts/${receiptId}`}
          className="mt-4 inline-flex min-h-touch items-center gap-1.5 rounded-control text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover"
        >
          Details and proof of #{receiptId.toString()}
        </Link>
      )}
    </div>
  );
}
