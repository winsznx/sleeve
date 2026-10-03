import { SAMPLE_RECEIPT_IDS } from '@/data/mock';

/**
 * Numbers a reviewer can check while the mock data layer runs, one per kind of action. The page shows them only on
 * sample data, under a label that says so; on chain data nobody's receipt is offered as an example.
 */
export const SAMPLE_CHECKS: readonly { id: bigint; label: string }[] = [
  { id: SAMPLE_RECEIPT_IDS.filledSpy, label: 'payday that bought SPY' },
  { id: SAMPLE_RECEIPT_IDS.queuedSession, label: 'payday that waits' },
  { id: SAMPLE_RECEIPT_IDS.settled, label: 'buy after a wait' },
  { id: SAMPLE_RECEIPT_IDS.sold, label: 'sale' },
];
