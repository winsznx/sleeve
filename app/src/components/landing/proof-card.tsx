'use client';

import { formatStockToken, formatUsdg } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import { percentWords, tickerSymbol, usdgExact } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { useVerification } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { ReceiptRecord, VerifyResult } from '@/data/types';

import { APP_HREFS } from './copy';
import { verifyHref } from './example-receipt';
import { useExampleReceipt } from './landing-data';

const LINK = 'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

/** "rpc.mainnet.chain.robinhood.com", the host a verification read through. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The proof behind the example payday (PRD 10): its receipt's key numbers and a button that recomputes it through the
 * data layer's verifier, on demand. Nothing claims a match before the verifier has run on this visit, and a mismatch
 * lists every field that differs.
 */
export function ProofCard({ className }: { className?: string }): JSX.Element {
  const example = useExampleReceipt();
  const [requested, setRequested] = useState(false);
  const record = example.status === 'ready' ? example.data : null;
  const verification = useVerification(requested && record !== null ? record.receipt.id : undefined);
  const frame = cx('flex w-full flex-col rounded-module bg-surface p-5 text-left shadow-card', className);

  if (example.status === 'loading') {
    return (
      <SkeletonGroup label="Loading the example receipt" className={frame}>
        <Skeleton className="size-[3.375rem] rounded-pill" />
        <SkeletonText lines={5} className="mt-5" />
      </SkeletonGroup>
    );
  }
  if (record === null) {
    return (
      <div className={frame}>
        <p className="text-body-s font-semibold text-ink">No example receipt yet</p>
        <p className="mt-1 text-body-s text-ink-secondary">Any split can be recomputed from public chain data by its receipt number.</p>
        <Link href={APP_HREFS.checkSplit} className={cx(LINK, 'mt-2')}>
          Check a split
        </Link>
      </div>
    );
  }

  const receiptId = record.receipt.id.toString();
  const running = requested && verification.isFetching;
  const result = requested ? verification.data : undefined;

  let action: ReactNode;
  if (result === undefined) {
    action = (
      <Button
        variant="secondary"
        size="md"
        fullWidth
        onClick={() => setRequested(true)}
        busy={running}
        busyLabel={`Recomputing receipt ${receiptId}`}
      >
        Recompute receipt {receiptId}
      </Button>
    );
  } else {
    action = (
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <Link href={verifyHref(record.receipt.id)} className={LINK}>
          See every check
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void verification.refetch()} busy={running} busyLabel="Recomputing">
          Run it again
        </Button>
      </div>
    );
  }

  return (
    <div className={frame}>
      <div aria-live="polite" className="flex items-start gap-3.5">
        <Verdict requested={requested} running={running} result={result} failed={requested && verification.isError} receiptId={receiptId} />
      </div>
      <ReceiptLines record={record} />
      <div className="mt-auto pt-4">{action}</div>
    </div>
  );
}

interface VerdictProps {
  requested: boolean;
  running: boolean;
  result: VerifyResult | undefined;
  failed: boolean;
  receiptId: string;
}

function Verdict({ requested, running, result, failed, receiptId }: VerdictProps): JSX.Element {
  if (failed) {
    return (
      <VerdictLine tone="danger" title="The verifier did not finish">
        Nothing was compared. Run it again in a moment.
      </VerdictLine>
    );
  }
  if (!requested || result === undefined) {
    return (
      <VerdictLine tone="neutral" title={running ? `Recomputing receipt ${receiptId}` : 'Not checked on this visit'}>
        Sleeve&apos;s verifier rereads it from public chain data.
      </VerdictLine>
    );
  }
  const passed = result.checks.filter((check) => check.ok).length;
  switch (result.status) {
    case 'MATCH':
      return (
        <VerdictLine tone="success" title="Matches chain data">
          {passed} of {result.checks.length} checks matched, read through {hostOf(result.rpcUrl)}.
        </VerdictLine>
      );
    case 'MISMATCH': {
      const differing = result.checks.filter((check) => !check.ok);
      return (
        <VerdictLine tone="danger" title="Does not match chain data">
          {differing.length} of {result.checks.length} checks differ: {differing.map((check) => check.label).join(', ')}.
        </VerdictLine>
      );
    }
    case 'NOT_FOUND':
      return (
        <VerdictLine tone="danger" title={`No receipt ${receiptId} on chain`}>
          The verifier found no receipt with this number.
        </VerdictLine>
      );
    case 'PROVIDER_BLOCKED':
      return (
        <VerdictLine tone="danger" title="The provider refused the read">
          The public endpoint limits how often it answers. Run it again in a minute.
        </VerdictLine>
      );
  }
}

const VERDICT_TILE = {
  success: 'bg-success text-on-accent',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-muted text-ink-secondary',
} as const;

function VerdictLine({ tone, title, children }: { tone: keyof typeof VERDICT_TILE; title: string; children: ReactNode }): JSX.Element {
  return (
    <>
      <span aria-hidden="true" className={cx('grid size-12 shrink-0 place-items-center rounded-pill', VERDICT_TILE[tone])}>
        <Icon name={tone === 'success' ? 'check' : tone === 'danger' ? 'alert' : 'verify'} className="size-6" />
      </span>
      <span className="min-w-0">
        <span className="block text-body font-semibold text-ink">{title}</span>
        <span className="block text-body-s text-ink-secondary">{children}</span>
      </span>
    </>
  );
}

/** The receipt's key numbers, with the debt security line under the token amount. */
function ReceiptLines({ record }: { record: ReceiptRecord }): JSX.Element {
  const { receipt, derived } = record;
  const symbol = tickerSymbol(receipt.tickerId);
  const cap = derived.rule?.premiumCapBps;
  const direction = receipt.premiumBps < 0n ? 'below' : 'above';
  const bought = receipt.status === 'FILLED' || receipt.status === 'SETTLED';
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-1 flex flex-wrap items-center justify-between gap-2 text-label text-ink-secondary">
        <span>
          Receipt {receipt.id.toString()}, {formatUtc(receipt.timestamp)}
        </span>
        {DATA_SOURCE === 'mock' ? <Badge>Sample</Badge> : null}
      </p>
      <dl className="text-body-s">
        <Row term="Arrived">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <TokenIcon token="USDG" size="xs" decorative />
            <Amount value={formatUsdg(receipt.usdgIn)} unit="USDG" />
          </span>
        </Row>
        <Row term="Stayed spendable">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <TokenIcon token="USDG" size="xs" decorative />
            <Amount value={usdgExact(receipt.usdgToSpend)} unit="USDG" />
          </span>
        </Row>
        {bought ? (
          <Row term="Became">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <TickerIcon tickerId={receipt.tickerId} size="xs" />
              <Amount value={formatStockToken(receipt.tokensOut)} unit={symbol} kind="equity" />
            </span>
            <DebtSecurityLine />
          </Row>
        ) : null}
        {bought ? (
          <Row term="Price paid">
            <span className="font-semibold text-ink">
              {percentWords(receipt.premiumBps)} {direction} the Chainlink price
            </span>
            {cap === undefined ? null : <span className="block text-ink-secondary">cap {percentWords(cap)}</span>}
          </Row>
        ) : null}
      </dl>
    </div>
  );
}

/** Term above value on a phone, side by side from 640 px (docs/DESIGN.md 11.4). */
function Row({ term, children }: { term: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-0.5 py-1.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-3">
      <dt className="text-ink-secondary">{term}</dt>
      <dd className="sm:text-right">{children}</dd>
    </div>
  );
}
