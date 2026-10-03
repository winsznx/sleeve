import { parseReceiptId } from '@/lib/receipt-id';

/**
 * A receipt number as a person types it: with spaces around it, a number sign or the word "Receipt" in front,
 * grouping commas, or leading zeros. URLs stay strict (parseReceiptId); the form forgives the ways a number gets
 * written on a card, in a chat or in a spreadsheet.
 */
export function readReceiptIdInput(text: string): bigint | null {
  const compact = text
    .trim()
    .replace(/^receipt\s*/i, '')
    .replace(/^#/, '')
    .replace(/[\s,_]/g, '');
  return parseReceiptId(compact.replace(/^0+(?=\d)/, ''));
}
