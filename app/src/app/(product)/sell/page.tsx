import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { PageHeader } from '@/components/ui/page-header';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

import { SellScreen } from './sell-screen';

export const metadata: Metadata = { title: 'Sell' };

/**
 * The sell-back screen. The flow is a client component on the data layer; the issuer disclosure is read here, on the
 * server, where its bytes are checked against the pinned hash before they are shown.
 */
export default async function SellPage(): Promise<JSX.Element> {
  const paragraphs = disclosureParagraphs(await readDisclosureText());
  return (
    <>
      <PageHeader
        title="Sell"
        description="Turn Stock Tokens back into USDG. The USDG goes to spend, and Sleeve never splits it."
      />
      <SellScreen />
      <Disclosure paragraphs={paragraphs} className="mt-12 max-w-reading" />
    </>
  );
}
