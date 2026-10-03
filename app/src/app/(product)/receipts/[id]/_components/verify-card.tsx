'use client';

import { PUBLIC_RPC_URL } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useVerification } from '@/data/hooks';
import type { VerifyResult } from '@/data/types';

/**
 * "Check this split" (docs/design/closeout-product-blueprint.md 15.6): anyone can recompute the receipt an action
 * wrote from public chain data, through the public RPC, a different provider from the keeper's. The check runs here
 * only when the reader asks, because that RPC is rate limited (D-012); the field by field table lives on the
 * verifier page.
 */

const LINK = 'inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

function rpcHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function ResultLine({ result }: { result: VerifyResult }): JSX.Element {
  const total = result.checks.length;
  const failing = result.checks.filter((check) => !check.ok).length;
  switch (result.status) {
    case 'MATCH':
      return (
        <p className="flex items-start gap-2.5 text-body-s text-ink">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-pill bg-success text-on-accent">
            <Icon name="check" className="size-4" />
          </span>
          <span className="pt-0.5">
            <span className="font-semibold">Matches chain data.</span> {total === 1 ? 'The one check matches.' : `All ${total} checks match.`}
          </span>
        </p>
      );
    case 'MISMATCH':
      return (
        <p className="flex items-start gap-2.5 text-body-s text-ink">
          <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-pill bg-danger text-on-danger">
            <Icon name="alert" className="size-4" />
          </span>
          <span className="pt-0.5">
            <span className="font-semibold">Does not match chain data.</span> {failing} of {total} checks differ.
          </span>
        </p>
      );
    case 'NOT_FOUND':
      return <p className="text-body-s text-ink">The verifier found no receipt with this number on Robinhood Chain.</p>;
    case 'PROVIDER_BLOCKED':
      return <p className="text-body-s text-ink">The public RPC did not answer, so nothing was checked. It is rate limited, so try again in a minute.</p>;
  }
}

export interface VerifyCardProps {
  receiptId: bigint;
  /** What the action is called in the title: "split", "sale". */
  noun: string;
}

export function VerifyCard({ receiptId, noun }: VerifyCardProps): JSX.Element {
  const [asked, setAsked] = useState(false);
  const verification = useVerification(asked ? receiptId : undefined);
  const id = receiptId.toString();

  return (
    <section aria-labelledby="action-verify-title" className="min-w-0 rounded-module border border-accent-border bg-info-soft p-card md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden="true" className="grid size-icon-tile shrink-0 place-items-center rounded-row border border-accent-border bg-surface text-accent">
            <Icon name="verify" />
          </span>
          <div className="min-w-0">
            <h3 id="action-verify-title" className="text-h3 text-ink">
              Check this {noun}
            </h3>
            <p className="mt-1 max-w-reading text-body-s text-ink-secondary">
              The verifier reads receipt {id} again from public chain data, through {rpcHost(PUBLIC_RPC_URL)}, a different
              provider from Sleeve&apos;s keeper, and recomputes every field.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 md:flex-col md:items-end">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => (asked ? void verification.refetch() : setAsked(true))}
            busy={asked && verification.isFetching}
            busyLabel="Checking"
          >
            {asked ? 'Check again' : 'Check it here'}
          </Button>
          <Link href={`/verify/${id}`} className={LINK}>
            Recompute receipt {id}
          </Link>
        </div>
      </div>

      <div aria-live="polite">
        {!asked ? null : (
          <div className="mt-4 rounded-row border border-accent-border bg-surface p-3.5">
            {verification.isPending ? (
              <SkeletonGroup label={`Checking receipt ${id}`} className="flex items-center gap-2.5">
                <Skeleton className="size-6 rounded-pill" />
                <Skeleton className="h-4 w-48 max-w-full" />
              </SkeletonGroup>
            ) : verification.isError ? (
              <p className="text-body-s text-ink">The check did not run. It only reads the chain, so nothing on any account changed.</p>
            ) : (
              <ResultLine result={verification.data} />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
