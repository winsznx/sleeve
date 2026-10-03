import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { DISCLOSURE_PUBLIC_PATH, disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';
import { parseReceiptId } from '@/lib/receipt-id';

import { IssuerDisclosure } from '../_components/issuer-disclosure';
import { ReceiptDetail } from './receipt-detail';

interface ReceiptPageProps {
  params: Promise<{ id: string }>;
}

async function receiptId(params: ReceiptPageProps['params']): Promise<bigint> {
  const id = parseReceiptId((await params).id);
  if (id === null) notFound();
  return id;
}

export async function generateMetadata({ params }: ReceiptPageProps): Promise<Metadata> {
  return { title: `#${await receiptId(params)}` };
}

/**
 * One action's details and proof. The action reads in the browser through the data layer. The issuer disclosure is
 * read here, on the server, from the served file after its hash is checked, so the text in the proof section is the
 * text the receipts hash.
 */
export default async function ReceiptPage({ params }: ReceiptPageProps): Promise<JSX.Element> {
  const id = await receiptId(params);
  const paragraphs = disclosureParagraphs(await readDisclosureText());
  return (
    <div className="mx-auto w-full max-w-content">
      <ReceiptDetail id={id.toString()} disclosure={<IssuerDisclosure paragraphs={paragraphs} rawHref={DISCLOSURE_PUBLIC_PATH} headingLevel={3} />} />
    </div>
  );
}
