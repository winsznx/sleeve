'use client';

import { CHAIN_NAME } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { Glyph } from '@/app/(product)/receipts/_components/glyphs';
import { ReceiptLead } from '@/app/(product)/receipts/_components/receipt-lead';
import { actionNumber, actionTitle, showsStockTokenAmount } from '@/app/(product)/receipts/_lib/outcome';
import { rowLead } from '@/app/(product)/receipts/_lib/register';
import { NetworkGlyph } from '@/components/token/glyphs';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useReceipt, useVerification } from '@/data/hooks';
import type { ReceiptRecord, VerifyCheck, VerifyResult } from '@/data/types';

import { failingChecks, providerSentence, rpcHost, shownValue, type ShownValue } from './verify-values';

/**
 * The verifier page (PRD 10): the receipt is read and recomputed from public chain data on every visit. A verdict
 * leads, deep green when every field matches and red when any differs, then every field with the receipt's value,
 * the recomputed value and MATCH or MISMATCH, then how and through which RPC it was checked. Nothing is rounded,
 * grouped away or hidden; a mismatch is shown, never smoothed.
 */

const TAG =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-control border border-border px-2 py-0.5 text-label font-medium uppercase tracking-caps';

function VerdictTag({ ok }: { ok: boolean }): JSX.Element {
  return <span className={cx(TAG, ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>{ok ? 'MATCH' : 'MISMATCH'}</span>;
}

/** A small disc that repeats a row's result as a shape: a check, or a cross. */
function CheckMark({ ok, className }: { ok: boolean; className?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid size-6 shrink-0 place-items-center rounded-pill',
        ok ? 'bg-success-soft text-success' : 'bg-danger text-on-danger',
        className,
      )}
    >
      {ok ? <Icon name="check" className="size-4" /> : <Glyph name="cross" className="size-4" />}
    </span>
  );
}

/** The readable value over the raw one. On a red tint the quiet text steps up to ink-secondary to keep its contrast. */
function ValueText({ value, onTint = false }: { value: ShownValue; onTint?: boolean }): JSX.Element {
  const quiet = onTint ? 'text-ink-secondary' : 'text-ink-muted';
  return (
    <>
      {value.readable === null ? null : <span className="block tabular-nums text-ink">{value.readable}</span>}
      <span className={cx('block break-all font-mono text-mono-s', value.readable === null ? 'text-ink' : quiet)}>{value.raw}</span>
    </>
  );
}

const CHECK_COLUMNS = 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem] md:gap-x-5';

/**
 * One field. On a phone: the mark, the label and the verdict, then both values. From 768 px: four columns under the
 * panel's header. One verdict element serves both layouts, so it is read once.
 */
function CheckRow({ check }: { check: VerifyCheck }): JSX.Element {
  const onTint = !check.ok;
  return (
    <li
      className={cx(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t border-border px-4 py-3.5 first:border-t-0 md:px-5',
        CHECK_COLUMNS,
        onTint && 'bg-danger-soft',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <CheckMark ok={check.ok} />
        <div className="min-w-0">
          <p className="text-body-s font-medium text-ink">{check.label}</p>
          <p className={cx('text-body-s', onTint ? 'text-ink-secondary' : 'text-ink-muted')}>{check.source}</p>
        </div>
      </div>
      <div className="col-start-2 row-start-1 md:col-start-4 md:justify-self-end">
        <VerdictTag ok={check.ok} />
      </div>
      <dl className="col-span-2 mt-2.5 flex flex-col gap-2 pl-9 text-body-s md:col-span-2 md:col-start-2 md:row-start-1 md:mt-0 md:grid md:grid-cols-2 md:gap-5 md:pl-0">
        <div className="min-w-0">
          <dt className="text-ink-secondary md:sr-only">Receipt value</dt>
          <dd className="mt-0.5 md:mt-0">
            <ValueText value={shownValue(check.unit, check.actual)} onTint={onTint} />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-ink-secondary md:sr-only">Recomputed value</dt>
          <dd className="mt-0.5 md:mt-0">
            <ValueText value={shownValue(check.unit, check.expected)} onTint={onTint} />
          </dd>
        </div>
      </dl>
    </li>
  );
}

function ChecksPanel({ checks }: { checks: readonly VerifyCheck[] }): JSX.Element {
  const matching = checks.length - failingChecks(checks).length;
  return (
    <section aria-labelledby="every-check-title" className="min-w-0 overflow-hidden rounded-module border border-border bg-surface">
      <header className="flex min-h-touch flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-3 md:px-5">
        <h2 id="every-check-title" className="text-h3 text-ink">
          Every check
        </h2>
        <span className="text-body-s tabular-nums text-ink-secondary">
          {matching} of {checks.length} match
        </span>
      </header>
      <div
        aria-hidden="true"
        className={cx('hidden border-b border-border bg-surface-muted px-5 py-2.5 text-label font-medium text-ink-secondary md:grid', CHECK_COLUMNS)}
      >
        <span className="pl-9">Field</span>
        <span>Receipt value</span>
        <span>Recomputed value</span>
        <span className="text-right">Result</span>
      </div>
      <ul aria-label="Checks">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </section>
  );
}

function MatchVerdict({ result }: { result: VerifyResult }): JSX.Element {
  const count = result.checks.length;
  return (
    <section aria-labelledby="verdict-title" className="min-w-0 overflow-hidden rounded-module bg-accent-deep text-on-accent shadow-card">
      <div className="flex flex-col gap-5 p-card md:flex-row md:items-center md:justify-between md:gap-8 md:p-6">
        <div className="flex min-w-0 items-start gap-4 md:flex-1">
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-pill bg-surface text-accent">
            <Icon name="check" className="size-6" />
          </span>
          <div className="min-w-0">
            <h2 id="verdict-title" className="text-figure-m">
              Matches chain data
            </h2>
            <p className="mt-1 max-w-reading text-body">
              {count === 1 ? 'The one check matches.' : `All ${count} checks match.`} Each value on the receipt was recomputed
              from public chain data and came out the same.
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-row border border-glass-deep-edge bg-glass-deep px-4 py-3 text-body-s backdrop-blur-glass md:w-[18rem] md:shrink-0">
          <dt>Checks</dt>
          <dd className="text-right font-semibold tabular-nums">
            {count} of {count}
          </dd>
          <dt>Read through</dt>
          <dd className="break-all text-right font-mono text-mono-s">{rpcHost(result.rpcUrl)}</dd>
        </dl>
      </div>
    </section>
  );
}

function MismatchVerdict({ result }: { result: VerifyResult }): JSX.Element {
  const failing = failingChecks(result.checks);
  return (
    <section aria-labelledby="verdict-title" className="min-w-0 rounded-module border border-danger bg-danger-soft p-card md:p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-pill bg-danger text-on-danger">
          <Icon name="alert" className="size-6" />
        </span>
        <div className="min-w-0">
          <h2 id="verdict-title" className="text-figure-m text-ink">
            Does not match chain data
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            {failing.length} of {result.checks.length} checks differ. Each one is listed as the chain gave it, with nothing
            rounded or left out.
          </p>
        </div>
      </div>
      <ul aria-label="Fields that differ" className="mt-5 flex flex-col gap-3">
        {failing.map((check) => (
          <li key={check.id} className="rounded-row bg-surface p-4">
            <p className="flex items-center gap-2 text-body-s font-semibold text-ink">
              <CheckMark ok={false} className="size-5" />
              {check.label}
            </p>
            <dl className="mt-2 grid gap-2 text-body-s sm:grid-cols-2 sm:gap-4">
              <div className="min-w-0">
                <dt className="text-ink-secondary">Receipt value</dt>
                <dd className="mt-0.5">
                  <ValueText value={shownValue(check.unit, check.actual)} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-ink-secondary">Recomputed value</dt>
                <dd className="mt-0.5">
                  <ValueText value={shownValue(check.unit, check.expected)} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HashValue({ value, copyLabel }: { value: string | null; copyLabel: string }): JSX.Element {
  if (value === null) return <span>None</span>;
  return (
    <span className="flex items-start gap-1">
      <span className="min-w-0 flex-1 break-all py-px font-mono text-mono-s">{value}</span>
      <CopyButton value={value} label={copyLabel} className="-my-3 -mr-2.5" />
    </span>
  );
}

function HowChecked({ result }: { result: VerifyResult }): JSX.Element {
  const sameHash = result.storedHash !== null && result.storedHash === result.recomputedHash;
  return (
    <section aria-labelledby="how-checked-title" className="min-w-0 rounded-module border border-border bg-surface p-card">
      <h2 id="how-checked-title" className="text-h3 text-ink">
        How it was checked
      </h2>
      <dl className="mt-4 flex flex-col gap-4 text-body-s md:grid md:grid-cols-2 md:gap-x-8 md:gap-y-5 xl:grid-cols-4 xl:gap-x-6">
        <div>
          <dt className="text-ink-secondary">Read through</dt>
          <dd className="mt-1 flex items-start gap-2">
            <NetworkGlyph className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <span className="min-w-0 break-all font-mono text-mono-s text-ink">{result.rpcUrl}</span>
          </dd>
          <dd className="mt-1 text-ink-muted">{providerSentence(result.rpcUrl)}</dd>
        </div>
        <div>
          <dt className="text-ink-secondary">Chain time of the check</dt>
          <dd className="mt-0.5 text-ink">{formatUtc(result.checkedAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-secondary">Stored receipt hash</dt>
          <dd className="mt-0.5 text-ink">
            <HashValue value={result.storedHash} copyLabel="Copy stored receipt hash" />
          </dd>
        </div>
        <div>
          <dt className="text-ink-secondary">Recomputed receipt hash</dt>
          <dd className="mt-0.5 text-ink">
            <HashValue value={result.recomputedHash} copyLabel="Copy recomputed receipt hash" />
          </dd>
          <dd className={cx('mt-1 inline-flex items-center gap-1 font-medium', sameHash ? 'text-success' : 'text-danger')}>
            <Icon name={sameHash ? 'check' : 'alert'} className="size-4" />
            {sameHash ? 'The two hashes are the same' : 'The two hashes differ'}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function ResultSkeleton({ id }: { id: string }): JSX.Element {
  return (
    <SkeletonGroup label={`Recomputing receipt ${id} from public chain data`} className="flex flex-col gap-stack">
      <div className="flex items-center gap-4 rounded-module border border-border bg-surface p-card md:p-6">
        <Skeleton className="size-12 shrink-0 rounded-pill" />
        <div className="flex-1">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="mt-2.5 h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="overflow-hidden rounded-module border border-border bg-surface">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-center gap-3 border-t border-border px-5 py-4 first:border-t-0">
            <Skeleton className="size-6 shrink-0 rounded-pill" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-5 w-16 rounded-control" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/**
 * What is being checked, led by what happened (D-024): "1,200 USDG payday: 1,080 stayed spendable, 120 became SPY",
 * with the receipt's number beside it, read through the data layer, and the debt security line under it whenever it
 * names Stock Tokens bought or sold. Until the receipt reads, the number stands alone.
 */
function ReceiptHeading({ id, record }: { id: string; record: ReceiptRecord | null | undefined }): JSX.Element {
  const known = record === null || record === undefined ? null : record;
  return (
    <div className="flex min-w-0 items-center gap-4">
      {known === null ? null : <ReceiptLead lead={rowLead(known.receipt)} size="xl" />}
      <div className="min-w-0">
        <h1 className="max-w-reading break-words text-h1 text-ink">
          {known === null ? (
            `Receipt ${id}`
          ) : (
            <>
              {actionTitle(known)}{' '}
              <span className="whitespace-nowrap font-mono text-h2 font-normal text-ink-muted">{actionNumber(known.receipt.id)}</span>
            </>
          )}
        </h1>
        {known !== null && showsStockTokenAmount(known.receipt) ? <DebtSecurityLine className="mt-1" /> : null}
        <p className="mt-1 text-body text-ink-secondary">
          {known === null
            ? `Recomputed from ${CHAIN_NAME} data on every visit, field by field.`
            : `Receipt ${id}, written ${formatUtc(known.receipt.timestamp)}. Recomputed from ${CHAIN_NAME} data on every visit.`}
        </p>
      </div>
    </div>
  );
}

export interface VerifyResultViewProps {
  /** The receipt id as the URL gave it, already checked by parseReceiptId. */
  id: string;
}

export function VerifyResultView({ id }: VerifyResultViewProps): JSX.Element {
  const receiptId = BigInt(id);
  const verification = useVerification(receiptId);
  const receipt = useReceipt(receiptId);
  const result = verification.data;

  let body: ReactNode;
  if (verification.isPending) {
    body = <ResultSkeleton id={id} />;
  } else if (result === undefined) {
    body = (
      <ErrorBlock
        title="The check did not run"
        action={
          <Button variant="secondary" onClick={() => verification.refetch()}>
            Try again
          </Button>
        }
      >
        The receipt was not checked. A check only reads the chain, so nothing on any account changed.{' '}
        {verification.error?.message}
      </ErrorBlock>
    );
  } else if (result.status === 'NOT_FOUND') {
    body = (
      <EmptyState
        title={`No receipt ${id} on ${CHAIN_NAME}`}
        action={
          <ButtonLink href="/verify" variant="secondary">
            Check another number
          </ButtonLink>
        }
      >
        The verifier found no receipt with this number. Receipt numbers count up from 1 across every Sleeve account.
      </EmptyState>
    );
  } else if (result.status === 'PROVIDER_BLOCKED') {
    body = (
      <div role="alert" className="flex gap-4 rounded-module border border-border bg-warning-soft p-5">
        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-row bg-surface text-warning">
          <Icon name="alert" />
        </span>
        <div className="min-w-0">
          <h2 className="text-h3 text-ink">The check could not reach its RPC provider</h2>
          <p className="mt-1.5 break-words text-body-s text-ink-secondary">
            {result.rpcUrl} refused or limited the request, so nothing was checked. It is rate limited, so try again in a
            minute.
          </p>
          <div className="mt-4">
            <Button variant="secondary" onClick={() => verification.refetch()} busy={verification.isFetching} busyLabel="Checking">
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="flex flex-col gap-stack">
        {result.status === 'MATCH' ? <MatchVerdict result={result} /> : <MismatchVerdict result={result} />}
        <HowChecked result={result} />
        <ChecksPanel checks={result.checks} />
      </div>
    );
  }

  const found = result !== undefined && (result.status === 'MATCH' || result.status === 'MISMATCH');

  return (
    <>
      <Link
        href="/verify"
        className="-ml-1 mb-1 inline-flex min-h-touch items-center gap-1 rounded-control pr-2 text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:text-ink"
      >
        <Icon name="chevronLeft" className="size-4" />
        Check a split
      </Link>
      <header className="mb-6 flex flex-col gap-4 md:mb-7 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <ReceiptHeading id={id} record={receipt.data} />
        {found ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
            <Button variant="secondary" icon="verify" onClick={() => verification.refetch()} busy={verification.isFetching} busyLabel="Checking">
              Check again
            </Button>
            <ButtonLink href={`/receipts/${id}`} variant="ghost">
              Open receipt {id}
            </ButtonLink>
          </div>
        ) : null}
      </header>
      {body}
    </>
  );
}
