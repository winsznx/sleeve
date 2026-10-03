import type { Metadata } from 'next';
import type { JSX } from 'react';

import { PageHeader } from '@/components/ui/page-header';
import { DISCLOSURE_PUBLIC_PATH, disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

import { IssuerDisclosure } from '../receipts/_components/issuer-disclosure';
import { readSellStart } from './sell-start';
import { SellScreen } from './sell-screen';

export const metadata: Metadata = { title: 'Sell back' };

interface SellPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/**
 * The sell-back screen, opened from Holdings (/sell?ticker=SPY) or from a buy's details (/sell?ticker=SPY&lot=455).
 * The flow is a client component on the data layer; the issuer disclosure is read here, on the server, where its
 * bytes are checked against the pinned hash before they are shown.
 */
export default async function SellPage({ searchParams }: SellPageProps): Promise<JSX.Element> {
  const start = readSellStart(await searchParams);
  const paragraphs = disclosureParagraphs(await readDisclosureText());
  return (
    <div className="mx-auto w-full max-w-content">
      <PageHeader
        back={{ href: '/holdings', label: 'Holdings' }}
        title="Sell back"
        description="Sell Stock Tokens your rule bought back to USDG, through an allowlisted pool. The USDG goes to spend, and Sleeve never splits it."
      />
      <SellScreen initialTicker={start.tickerId} initialLot={start.lotId} />
      <IssuerDisclosure paragraphs={paragraphs} rawHref={DISCLOSURE_PUBLIC_PATH} className="mt-10" />
    </div>
  );
}
