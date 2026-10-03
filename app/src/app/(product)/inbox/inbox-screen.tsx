'use client';

import { EXPLORER_URL, type Address } from '@sleeve/core';
import { useId, type JSX } from 'react';

import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { EmptyState } from '@/components/ui/empty-state';
import { List } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { useInbox, useMarket, useRule, useSession, useSplitPreview } from '@/data/hooks';
import { useDataLayer } from '@/data/provider';
import type { InboxItem } from '@/data/types';

import { LoadError } from '../home/_components/load-error';
import { SignedOutPrompt } from '../home/_components/signed-out-prompt';
import { InboxEntry } from './_components/inbox-entry';
import { InboxSkeleton } from './_components/inbox-skeleton';
import { SortCard } from './_components/sort-card';

/** Every inbound transfer, newest first, with the derived label the list owes its readers (PRD 10). */
function Transfers({ items, explorerUrl }: { items: readonly InboxItem[]; explorerUrl: string | undefined }): JSX.Element {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="text-h2 text-ink">
        Transfers
      </h2>
      <p className="mt-1 max-w-reading text-body-s text-ink-secondary">
        Read from Robinhood Chain transfer logs. The sender, the transaction hash and the receipt that sorted each
        transfer are derived from those logs.
      </p>
      <List className="mt-3">
        {items.map((item) => (
          <InboxEntry key={item.id} item={item} explorerUrl={explorerUrl} />
        ))}
      </List>
    </section>
  );
}

function AccountInbox({ account }: { account: Address }): JSX.Element {
  const layer = useDataLayer();
  const inbox = useInbox(account);
  const preview = useSplitPreview(account);
  const rule = useRule(account);
  const market = useMarket();

  if (inbox.data === undefined || preview.data === undefined || rule.data === undefined || market.isPending) {
    const failed = [inbox, preview, rule].filter((query) => query.data === undefined && query.isError);
    return failed.length === 0 ? (
      <InboxSkeleton />
    ) : (
      <LoadError
        title="Your inbox did not load"
        onRetry={() => failed.forEach((query) => void query.refetch())}
        retrying={failed.some((query) => query.isFetching)}
      >
        Sleeve could not read your transfers from Robinhood Chain.
      </LoadError>
    );
  }

  const items = inbox.data;
  const unsorted = preview.data.unsorted;
  if (items.length === 0 && unsorted === 0n) {
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="No USDG has arrived yet">
          Payments sent to your payment address on Robinhood Chain show up here, and your rule splits each one.
          Top-ups through the app go to spend and do not split.
        </EmptyState>
        <PaymentAddressCard address={account} showQr />
      </div>
    );
  }

  const tickerId = preview.data.tickerId;
  return (
    <div className="flex flex-col gap-8">
      {unsorted > 0n ? (
        <SortCard
          preview={preview.data}
          rule={rule.data}
          payments={items.filter((item) => item.state !== 'SORTED').length}
          reopensAt={market.data?.tickers.find((ticker) => ticker.tickerId === tickerId)?.session.nextOpenAt}
        />
      ) : null}
      {items.length === 0 ? null : (
        <Transfers items={items} explorerUrl={layer.source === 'chain' ? EXPLORER_URL : undefined} />
      )}
    </div>
  );
}

/**
 * Inbound USDG from chain logs (PRD 7.2): who sent it, when, how much, and whether it is sorted, linked to the
 * receipt that sorted it. Unsorted USDG is spendable the whole time, and the owner can sort it now. It renders
 * inside the product shell, which supplies the main landmark, the navigation and the toasts.
 */
export function InboxScreen(): JSX.Element {
  const session = useSession();

  let body: JSX.Element;
  if (session.data === undefined) {
    body = session.isError ? (
      <LoadError title="Your session did not load" onRetry={() => void session.refetch()} retrying={session.isFetching}>
        Sleeve could not check whether you are signed in.
      </LoadError>
    ) : (
      <InboxSkeleton />
    );
  } else if (session.data === null) {
    body = <SignedOutPrompt />;
  } else {
    body = <AccountInbox key={session.data.account} account={session.data.account} />;
  }

  return (
    <div className="max-w-form">
      <PageHeader
        title="Inbox"
        description="USDG sent to your payment address, newest first. It stays spendable until your rule sorts it."
      />
      {body}
    </div>
  );
}
