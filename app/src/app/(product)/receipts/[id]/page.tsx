import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { Disclosure } from '@/components/ui/disclosure';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';
import { parseReceiptId } from '@/lib/receipt-id';

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
  return { title: `Receipt ${await receiptId(params)}` };
}

/**
 * The receipt reads in the browser through the data layer. The issuer disclosure is read here, on the server, from
 * the served file after its hash is checked, so the text under every receipt is the text the receipts hash.
 */
export default async function ReceiptPage({ params }: ReceiptPageProps): Promise<JSX.Element> {
  const id = await receiptId(params);
  const paragraphs = disclosureParagraphs(await readDisclosureText());
  return (
    <div className="w-full max-w-form">
      <ReceiptDetail id={id.toString()} disclosure={<Disclosure paragraphs={paragraphs} />} />
    </div>
  );
}
