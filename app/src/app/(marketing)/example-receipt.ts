import { SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DATA_SOURCE } from '@/data/source';
import type { DataSource } from '@/data/types';
import { parseReceiptId } from '@/lib/receipt-id';

/**
 * The receipt the landing page shows as proof. With the mock it is the sample SPY buy (receipt 455: 1,200 USDG in,
 * 10 percent bought SPY). On Robinhood Chain it is whatever NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID names, so a live
 * receipt from the payment campaign can be shown without a code change; unset means no example yet, and the page
 * explains the split without one. A value that is not a receipt id fails the build, like an unknown data source.
 */
export function resolveExampleReceiptId(source: DataSource, configured: string | undefined): bigint | null {
  const wanted = configured?.trim() ?? '';
  if (wanted !== '') {
    const id = parseReceiptId(wanted);
    if (id === null) throw new Error(`NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID must be a receipt id, got "${configured}"`);
    return id;
  }
  return source === 'mock' ? SAMPLE_RECEIPT_IDS.filledSpy : null;
}

/** Next inlines NEXT_PUBLIC_ variables at build time, so the server and the browser agree on it. */
export const EXAMPLE_RECEIPT_ID: bigint | null = resolveExampleReceiptId(
  DATA_SOURCE,
  process.env.NEXT_PUBLIC_SLEEVE_EXAMPLE_RECEIPT_ID,
);

export function receiptHref(id: bigint): string {
  return `/receipts/${id.toString()}`;
}

export function verifyHref(id: bigint): string {
  return `/verify/${id.toString()}`;
}
