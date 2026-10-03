import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { parseReceiptId } from '@/lib/receipt-id';

import { PublicFrame } from '../public-frame';
import { VerifyResultView } from './verify-result';

interface VerifyReceiptPageProps {
  params: Promise<{ id: string }>;
}

async function receiptId(params: VerifyReceiptPageProps['params']): Promise<bigint> {
  const id = parseReceiptId((await params).id);
  if (id === null) notFound();
  return id;
}

export async function generateMetadata({ params }: VerifyReceiptPageProps): Promise<Metadata> {
  return { title: `Check receipt ${await receiptId(params)}` };
}

/** The recomputation runs in the browser through the data layer, on every visit, never from a cache. */
export default async function VerifyReceiptPage({ params }: VerifyReceiptPageProps): Promise<JSX.Element> {
  const id = await receiptId(params);
  return (
    <PublicFrame width="content">
      <VerifyResultView id={id.toString()} />
    </PublicFrame>
  );
}
