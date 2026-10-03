import type { Metadata } from 'next';
import type { JSX } from 'react';

import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/sleeve/navigation';
import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { ReceiptRow, ReceiptSummary } from '@/components/sleeve/receipt-summary';
import { SleeveCard } from '@/components/sleeve/sleeve-card';
import { AppShell } from '@/components/ui/app-shell';
import { ButtonLink } from '@/components/ui/button';
import { CardHeader } from '@/components/ui/card';
import { List } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';

import { BucketDemo } from '../interactive';

export const metadata: Metadata = { title: 'Shell preview' };

/**
 * The app shell around a home screen built from kit parts, on the sample account. It previews the frame at every
 * width: bottom bar and More sheet below 768, rail from 768. It is a preview, not the home screen.
 */
export default async function ShellPreviewPage(): Promise<JSX.Element> {
  const layer = createMockDataLayer();
  const [ledger, rule, buckets, holdings, market, page] = await Promise.all([
    layer.getLedger(SAMPLE_ACCOUNT),
    layer.getRule(SAMPLE_ACCOUNT),
    layer.getBuckets(SAMPLE_ACCOUNT),
    layer.getHoldings(SAMPLE_ACCOUNT),
    layer.getMarket(),
    layer.listReceipts({ account: SAMPLE_ACCOUNT, limit: 5 }),
  ]);
  const latestFill = page.items.find((record) => record.receipt.status === 'FILLED') ?? page.items[0];
  const now = ledger.asOf.timestamp;

  return (
    <AppShell
      primaryNav={PRIMARY_NAV}
      secondaryNav={SECONDARY_NAV}
      account={SAMPLE_ACCOUNT}
      currentPath="/home"
      topBarAction={
        <ButtonLink href="#receive" variant="secondary" size="sm" icon="receive">
          Receive
        </ButtonLink>
      }
    >
      <PageHeader title="Home" description="When you get paid, part of it becomes a Stock Token you hold and the rest stays spendable." />
      <div className="flex flex-col gap-stack xl:grid xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-stack">
          {latestFill === undefined ? null : (
            <ReceiptSummary
              record={latestFill}
              href={`/receipts/${latestFill.receipt.id}`}
              verifyHref={`/verify/${latestFill.receipt.id}`}
              animate
            />
          )}
          <div className="grid gap-stack sm:grid-cols-2 xl:grid-cols-1">
            <SleeveCard kind="spend" spend={ledger.spend} unsorted={ledger.unsorted} />
            <SleeveCard kind="equity" holdings={holdings} pending={ledger.pendingTotal} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-stack">
          {buckets.map((bucket) => (
            <BucketDemo
              key={bucket.tickerId}
              bucket={bucket}
              now={now}
              reopensAt={market.tickers.find((ticker) => ticker.tickerId === bucket.tickerId)?.session.nextOpenAt ?? null}
              rule={rule}
            />
          ))}
          <div id="receive" className="scroll-mt-6">
            <PaymentAddressCard address={SAMPLE_ACCOUNT} showQr />
          </div>
          <section>
            <CardHeader title="Latest receipts" aside={<ButtonLink href="/receipts" variant="ghost" size="sm">See all</ButtonLink>} />
            <List label="Latest receipts">
              {page.items.map((record) => (
                <ReceiptRow key={record.receipt.id.toString()} record={record} href={`/receipts/${record.receipt.id}`} />
              ))}
            </List>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
