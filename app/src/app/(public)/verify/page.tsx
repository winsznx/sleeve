import { CHAIN_NAME, PUBLIC_RPC_URL } from '@sleeve/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { DATA_SOURCE } from '@/data/source';
import { DISCLOSURE_PUBLIC_PATH } from '@/lib/disclosure';

import { PublicFrame } from './public-frame';
import { readReceiptIdInput } from './receipt-id-input';
import { SAMPLE_CHECKS } from './sample-checks';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Check a split' };

interface VerifyPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** What the verifier does, in order (PRD 10). The content is a sequence, so the steps carry numbers. */
const STEPS = [
  { title: 'Reads the receipt', body: 'The receipt event and the hash the module stored when the split ran.' },
  { title: 'Reads the price again', body: 'The Chainlink round the receipt names, with getRoundData.' },
  { title: 'Reads the token moves', body: "The transaction's Transfer logs and the multiplier events." },
  { title: 'Recomputes every number', body: 'The amounts, the all-in price, the premium and the receipt hash.' },
  { title: 'Shows each field', body: 'The receipt value beside the recomputed one, with MATCH or MISMATCH. A mismatch is shown, never smoothed.' },
] as const;

const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

export default async function VerifyPage({ searchParams }: VerifyPageProps): Promise<JSX.Element> {
  const submitted = (await searchParams).id;
  const typed = typeof submitted === 'string' ? submitted : undefined;
  if (typed !== undefined) {
    const id = readReceiptIdInput(typed);
    if (id !== null) redirect(`/verify/${id}`);
  }

  return (
    <PublicFrame current="verify" width="content">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-12">
        <div className="min-w-0">
          <h1 className="text-h1 text-ink">Check a split</h1>
          <p className="mt-2 max-w-reading text-body text-ink-secondary">
            Every split, buy and sale Sleeve makes writes a receipt on {CHAIN_NAME}. Enter its number and the verifier reads it
            again and recomputes every field.
          </p>
          <div className="mt-6 rounded-large border border-border bg-surface p-card shadow-card md:p-6">
            <VerifyForm defaultValue={typed ?? ''} invalid={typed !== undefined} />
          </div>
          {DATA_SOURCE === 'mock' ? (
            <div className="mt-5">
              <p className="text-body-s font-semibold text-ink">Sample numbers to try</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {SAMPLE_CHECKS.map((sample) => (
                  <li key={sample.id.toString()}>
                    <Link
                      href={`/verify/${sample.id}`}
                      className="inline-flex min-h-control-sm items-center gap-2 rounded-pill border border-border bg-surface px-3.5 text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:border-border-strong hover:text-ink"
                    >
                      <span className="font-mono text-mono-s text-ink">{`#${sample.id}`}</span> {sample.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="mt-6 flex max-w-reading items-start gap-2.5 text-body-s text-ink-secondary">
            <NetworkGlyph className="mt-0.5 size-4 shrink-0 text-ink-muted" />
            <span>
              It reads through the public {CHAIN_NAME} RPC,{' '}
              <span className="break-all font-mono text-mono-s text-ink">{PUBLIC_RPC_URL}</span>, a different provider from
              the one Sleeve&apos;s keeper uses.
            </span>
          </p>
          <p className="mt-3 max-w-reading text-body-s text-ink-secondary">
            Every receipt also carries the hash of the issuer&apos;s disclosure.{' '}
            <a href={DISCLOSURE_PUBLIC_PATH} className={LINK}>
              Read the exact text it hashes
            </a>
            .
          </p>
        </div>

        <section aria-labelledby="how-it-checks" className="min-w-0">
          <h2 id="how-it-checks" className="text-h3 text-ink">
            How the check works
          </h2>
          <ol className="mt-3 flex flex-col gap-1.5 rounded-large border border-border bg-surface p-2 shadow-card">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3 rounded-panel px-3.5 py-3">
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-control border border-border bg-surface-muted font-mono text-mono-s text-ink-secondary"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-medium text-ink">{step.title}</span>
                  <span className="mt-0.5 block text-body-s text-ink-secondary">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </PublicFrame>
  );
}
