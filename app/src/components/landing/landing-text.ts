import type { Reason } from '@sleeve/core';

import type { SplitParts } from '@/components/sleeve/split-rail';
import { tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { REASON_LABEL } from '@/components/ui/badge';
import type { ReceiptRecord } from '@/data/types';

/**
 * Plain words for what a payment became, built from the split's own numbers. Exact amounts, so the parts always
 * add up to the payment (docs/DESIGN.md 12.1).
 */

/** "market closed", "below your minimum buy". A label that starts with a name, such as USDG, keeps its case. */
export function waitWords(reason: Exclude<Reason, 'NONE'>): string {
  const label = REASON_LABEL[reason];
  return /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;
}

/** "675.00 USDG spendable, 75.00 USDG waiting, market closed". */
export function splitWords(parts: SplitParts, record: ReceiptRecord): string {
  const { receipt } = record;
  const words = [`${usdgExactText(parts.spend)} spendable`];
  if (parts.equity > 0n) words.push(`${usdgExactText(parts.equity)} became ${tickerSymbol(receipt.tickerId)}`);
  if (parts.waiting > 0n) {
    words.push(
      receipt.reason === 'NONE'
        ? `${usdgExactText(parts.waiting)} waiting`
        : `${usdgExactText(parts.waiting)} waiting, ${waitWords(receipt.reason)}`,
    );
  }
  return words.join(', ');
}
