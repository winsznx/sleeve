import { formatUsdg, shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { formatUtc } from '@/components/ui/format-time';
import { ListRow } from '@/components/ui/list';
import type { InboundState, InboxItem } from '@/data/types';

import { INBOX_STATE_LABEL, inboxStateSentence } from './text';

const STATE_TONE: Record<InboundState, BadgeTone> = {
  RECEIVED: 'neutral',
  WAITING_GRACE: 'waiting',
  SORTED: 'success',
};

export function InboxStateTag({ state }: { state: InboundState }): JSX.Element {
  return <Badge tone={STATE_TONE[state]}>{INBOX_STATE_LABEL[state]}</Badge>;
}

export interface InboxRowProps {
  item: InboxItem;
  /** Where receipts live; a sorted transfer links to `${receiptsHref}/${id}`. Default /receipts. */
  receiptsHref?: string;
}

/**
 * One inbound USDG transfer in a ruled List (PRD 7.2): amount, sender in short form, time, and whether it is
 * sorted. Unsorted USDG stays spendable the whole time, and the row says what happens next. The inbox is built
 * from chain logs, so the screen labels the list as derived (PRD 10).
 */
export function InboxRow({ item, receiptsHref = '/receipts' }: InboxRowProps): JSX.Element {
  return (
    <ListRow
      leading={
        <TokenIcon token="USDG" size="lg" decorative />
      }
      title={
        <>
          <Amount value={formatUsdg(item.amount)} unit="USDG" /> received
        </>
      }
      meta={
        <>
          <span className="block">
            From <span className="font-mono text-mono-s">{shortAddress(item.from)}</span>
          </span>
          <span className="block">{formatUtc(item.timestamp)}</span>
        </>
      }
      trailing={<InboxStateTag state={item.state} />}
    >
      <p className="mt-2 text-body-s text-ink-secondary">
        {inboxStateSentence(item.state, item.graceEndsAt)}
        {item.sortedBy === null ? null : (
          <>
            {' '}
            <Link
              href={`${receiptsHref}/${item.sortedBy.receiptId}`}
              className="font-medium text-link underline underline-offset-4 hover:text-link-hover"
            >
              Receipt {item.sortedBy.receiptId.toString()}
            </Link>
          </>
        )}
      </p>
    </ListRow>
  );
}
