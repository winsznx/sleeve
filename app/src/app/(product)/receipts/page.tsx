import { redirect } from 'next/navigation';

import { historyHref } from './_lib/history-href';

/**
 * The full action list moved to /history (D-024). Old links keep working: the filters they carry come along, so
 * /receipts?ticker=SPY lands on the SPY history. One action's details stay at /receipts/[id].
 */

interface ReceiptsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function ReceiptsPage({ searchParams }: ReceiptsPageProps): Promise<never> {
  redirect(historyHref(await searchParams));
}
