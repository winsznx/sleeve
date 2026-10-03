import { PUBLIC_RPC_URL } from '@sleeve/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { JSX } from 'react';

import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

import { PublicFrame } from './public-frame';
import { readReceiptIdInput } from './receipt-id-input';
import { VerifyForm } from './verify-form';

export const metadata: Metadata = { title: 'Verify a receipt' };

interface VerifyPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** What the verifier does, in order (PRD 10). */
const STEPS = [
  'Reads the receipt and its stored hash from Robinhood Chain.',
  'Reads the Chainlink round the receipt names again, with getRoundData.',
  "Reads the transaction's token transfers and the multiplier events.",
  'Recomputes every number: the amounts, the all-in price, the premium and the receipt hash.',
  'Shows each field with the receipt value, the recomputed value and MATCH or MISMATCH. A mismatch is shown as it is, never smoothed.',
] as const;

export default async function VerifyPage({ searchParams }: VerifyPageProps): Promise<JSX.Element> {
  const submitted = (await searchParams).id;
  const typed = typeof submitted === 'string' ? submitted : undefined;
  if (typed !== undefined) {
    const id = readReceiptIdInput(typed);
    if (id !== null) redirect(`/verify/${id}`);
  }

  return (
    <PublicFrame current="verify">
      <PageHeader
        title="Verify a receipt"
        description="Every Sleeve receipt is public. Enter its number and the verifier recomputes it from chain data, field by field."
      />
      <Card>
        <VerifyForm defaultValue={typed ?? ''} invalid={typed !== undefined} />
      </Card>
      <section aria-labelledby="how-it-checks" className="mt-8">
        <h2 id="how-it-checks" className="text-h3 text-ink">
          How the check works
        </h2>
        <ol className="mt-3 flex list-decimal flex-col gap-2 pl-5 text-body text-ink-secondary marker:text-ink-muted">
          {STEPS.map((step) => (
            <li key={step} className="pl-1">
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-4 max-w-reading text-body-s text-ink-secondary">
          It reads through the public Robinhood Chain RPC, <span className="break-all font-mono text-mono-s text-ink">{PUBLIC_RPC_URL}</span>,
          a different provider from the one Sleeve&apos;s keeper uses.
        </p>
      </section>
    </PublicFrame>
  );
}
