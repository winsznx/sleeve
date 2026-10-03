'use client';

import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { Card, ErrorBlock, Panel } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { EmptyState, LoadingState } from '@/components/ui/empty-state';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { DefinitionList } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { useVerification } from '@/data/hooks';
import type { VerifyCheck, VerifyResult } from '@/data/types';

import { failingChecks, providerSentence, shownValue, type ShownValue } from './verify-values';

/**
 * The verifier page (PRD 10): the receipt is read and recomputed from public chain data on every visit, and each
 * field is listed with the receipt's value, the recomputed value and MATCH or MISMATCH. Nothing is rounded,
 * grouped away or hidden; a mismatch is shown, never smoothed.
 */

const TAG = 'inline-flex items-center gap-1 whitespace-nowrap rounded-control border border-border px-2 py-0.5 text-label font-medium uppercase tracking-caps';

function VerdictTag({ ok }: { ok: boolean }): JSX.Element {
  return <span className={cx(TAG, ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>{ok ? 'MATCH' : 'MISMATCH'}</span>;
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

const CHECK_COLUMNS = 'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_6.5rem] md:gap-x-4';

/**
 * One field. On a phone: the label with the verdict beside it, then both values. From 768 px: four columns under
 * the panel's header. One verdict element serves both layouts, so it is read once.
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
      <div className="min-w-0">
        <p className="text-body-s font-medium text-ink">{check.label}</p>
        <p className={cx('text-body-s', onTint ? 'text-ink-secondary' : 'text-ink-muted')}>{check.source}</p>
      </div>
      <div className="col-start-2 row-start-1 md:col-start-4">
        <VerdictTag ok={check.ok} />
      </div>
      <dl className="col-span-2 mt-2.5 flex flex-col gap-2 text-body-s md:col-start-2 md:row-start-1 md:mt-0 md:grid md:grid-cols-2 md:gap-4">
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
  return (
    <Panel title="Every check">
      <div
        aria-hidden="true"
        className={cx('hidden border-b border-border bg-surface-muted px-5 py-2.5 text-label font-medium text-ink-secondary md:grid', CHECK_COLUMNS)}
      >
        <span>Field</span>
        <span>Receipt value</span>
        <span>Recomputed value</span>
        <span>Result</span>
      </div>
      <ul aria-label="Checks">
        {checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </Panel>
  );
}

function MatchVerdict({ result }: { result: VerifyResult }): JSX.Element {
  const count = result.checks.length;
  return (
    <Card aria-labelledby="verdict-title">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-pill bg-success text-on-accent">
          <Icon name="check" />
        </span>
        <div className="min-w-0">
          <h2 id="verdict-title" className="text-h2 text-ink">
            Matches chain data
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            {count === 1 ? 'The one check matches.' : `All ${count} checks match.`} Each value on the receipt was
            recomputed from public chain data and came out the same.
          </p>
        </div>
      </div>
    </Card>
  );
}

function MismatchVerdict({ result }: { result: VerifyResult }): JSX.Element {
  const failing = failingChecks(result.checks);
  return (
    <section aria-labelledby="verdict-title" className="min-w-0 rounded-module bg-danger-soft p-card">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-pill bg-danger text-on-danger">
          <Icon name="alert" />
        </span>
        <div className="min-w-0">
          <h2 id="verdict-title" className="text-h2 text-ink">
            Does not match chain data
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            {failing.length} of {result.checks.length} checks differ. Each one is listed as the chain gave it, with nothing
            rounded or left out.
          </p>
        </div>
      </div>
      <ul aria-label="Fields that differ" className="mt-4 flex flex-col gap-3">
        {failing.map((check) => (
          <li key={check.id} className="rounded-row bg-surface p-4">
            <p className="text-body-s font-semibold text-ink">{check.label}</p>
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
  return (
    <Card aria-labelledby="how-checked-title" className="pb-1">
      <h2 id="how-checked-title" className="text-h3 text-ink">
        How it was checked
      </h2>
      <DefinitionList
        className="mt-2"
        items={[
          {
            id: 'rpc',
            term: 'Read through',
            value: (
              <>
                <span className="block break-all font-mono text-mono-s">{result.rpcUrl}</span>
                <span className="mt-1 block text-ink-muted">{providerSentence(result.rpcUrl)}</span>
              </>
            ),
          },
          { id: 'checkedAt', term: 'Chain time of the check', value: formatUtc(result.checkedAt) },
          { id: 'stored', term: 'Stored receipt hash', value: <HashValue value={result.storedHash} copyLabel="Copy stored receipt hash" /> },
          {
            id: 'recomputed',
            term: 'Recomputed receipt hash',
            value: <HashValue value={result.recomputedHash} copyLabel="Copy recomputed receipt hash" />,
          },
        ]}
      />
    </Card>
  );
}

export interface VerifyResultViewProps {
  /** The receipt id as the URL gave it, already checked by parseReceiptId. */
  id: string;
}

export function VerifyResultView({ id }: VerifyResultViewProps): JSX.Element {
  const verification = useVerification(BigInt(id));
  const result = verification.data;

  let body: ReactNode;
  if (verification.isPending) {
    body = <LoadingState label={`Recomputing receipt ${id} from public chain data`} />;
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
        title={`No receipt ${id} on Robinhood Chain`}
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
      <ErrorBlock
        title="The public RPC did not answer"
        action={
          <Button variant="secondary" onClick={() => verification.refetch()} busy={verification.isFetching} busyLabel="Checking">
            Try again
          </Button>
        }
      >
        {result.rpcUrl} refused or limited the request, so nothing was checked. It is rate limited, so try again in a
        minute.
      </ErrorBlock>
    );
  } else {
    body = (
      <div className="flex flex-col gap-stack">
        {result.status === 'MATCH' ? <MatchVerdict result={result} /> : <MismatchVerdict result={result} />}
        <HowChecked result={result} />
        <ChecksPanel checks={result.checks} />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Button variant="secondary" onClick={() => verification.refetch()} busy={verification.isFetching} busyLabel="Checking">
            Check again
          </Button>
          <Link
            href={`/receipts/${id}`}
            className="inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover"
          >
            Open receipt {id}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        back={{ href: '/verify', label: 'Verify another receipt' }}
        title={`Receipt ${id}`}
        description="Recomputed from public chain data on every visit, field by field."
      />
      {body}
    </>
  );
}
