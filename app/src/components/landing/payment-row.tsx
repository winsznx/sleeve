'use client';

import { formatUsdg, shortAddress } from '@sleeve/core';
import type { JSX } from 'react';

import { InboxStateTag } from '@/components/sleeve/inbox-row';
import { SplitRail, splitPartsOf } from '@/components/sleeve/split-rail';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Skeleton } from '@/components/ui/skeleton';
import type { InboxItem } from '@/data/types';

import { usePaymentSplit } from './landing-data';
import { splitWords } from './landing-text';

/**
 * One payment as the Payments screen lists it (D-024): the amount, who sent it and when, whether the rule has split
 * it yet, and once it has, what it became as a thin split rail with its words. A part that bought a Stock Token
 * carries the debt security line. A payment the rule has not split yet is spendable the whole time.
 */
export function PaymentRow({ payment, className }: { payment: InboxItem; className?: string }): JSX.Element {
  const split = usePaymentSplit(payment);
  const record = split.status === 'ready' ? split.data : null;
  const parts = record === null ? null : splitPartsOf(record.receipt);
  return (
    <li className={cx('flex items-start gap-3 py-3', className)}>
      <TokenIcon token="USDG" size="lg" decorative />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-body-s font-semibold text-ink">
            <Amount value={formatUsdg(payment.amount)} unit="USDG" />
          </p>
          <InboxStateTag state={payment.state} />
        </div>
        <p className="text-label text-ink-secondary">
          From <span className="font-mono">{shortAddress(payment.from)}</span>, {formatUtc(payment.timestamp)}
        </p>
        {split.status === 'loading' ? <Skeleton className="mt-2 h-1 w-full rounded-pill" /> : null}
        {split.status === 'error' ? <p className="mt-1.5 text-label text-ink-secondary">What it became did not load.</p> : null}
        {split.status !== 'ready' ? null : parts === null || record === null ? (
          payment.state === 'SORTED' ? null : <p className="mt-1.5 text-label text-ink-secondary">Spendable until your rule splits it</p>
        ) : (
          <>
            <SplitRail parts={parts} size="row" className="mt-2" />
            <p className="mt-1.5 text-label text-ink-secondary">{splitWords(parts, record)}</p>
            {parts.equity > 0n ? <DebtSecurityLine /> : null}
          </>
        )}
      </div>
    </li>
  );
}
