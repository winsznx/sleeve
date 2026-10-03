import { shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import { InboxStateTag } from '@/components/sleeve/inbox-row';
import { inboxStateSentence, usdgExact, usdgExactText } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { CopyButton } from '@/components/ui/copy-field';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list';
import type { InboxItem } from '@/data/types';

const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

export interface InboxEntryProps {
  item: InboxItem;
  /** A block explorer to open the transaction in. Left out for sample data, which no explorer has seen. */
  explorerUrl?: string;
}

/**
 * One inbound USDG transfer (PRD 7.2 and 9) in a ruled List: who sent it, when, how much, whether it is sorted,
 * the receipt that sorted it, and its transaction hash. Everything here comes from chain logs, so the hash is
 * labeled derived (PRD 10). The shared InboxRow has no place for the hash, so the inbox builds its own row from
 * the same parts.
 */
export function InboxEntry({ item, explorerUrl }: InboxEntryProps): JSX.Element {
  const when = formatUtc(item.timestamp);
  return (
    <ListRow
      leading={<TokenIcon token="USDG" size="lg" decorative />}
      title={
        <>
          From <span className="font-mono text-mono">{shortAddress(item.from)}</span>
        </>
      }
      meta={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <InboxStateTag state={item.state} />
          <span>{when}</span>
        </span>
      }
      trailing={<Amount value={usdgExact(item.amount)} unit="USDG" />}
    >
      <p className="mt-2 text-body-s text-ink-secondary">
        {inboxStateSentence(item.state, item.graceEndsAt)}
        {item.sortedBy === null ? null : (
          <>
            {' '}
            <Link href={`/receipts/${item.sortedBy.receiptId}`} className={LINK}>
              Open receipt {item.sortedBy.receiptId.toString()}
            </Link>
          </>
        )}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 text-body-s">
        <span className="text-ink-secondary">
          Transaction hash <span className="text-ink-muted">(derived)</span>
        </span>
        <span className="flex items-center">
          <span className="font-mono text-mono-s text-ink">{shortAddress(item.txHash)}</span>
          <CopyButton
            value={item.txHash}
            label={`Copy transaction hash of the ${usdgExactText(item.amount)} transfer, ${when}`}
          />
        </span>
        {explorerUrl === undefined ? null : (
          <a
            href={`${explorerUrl}/tx/${item.txHash}`}
            target="_blank"
            rel="noreferrer"
            className={`inline-flex min-h-touch items-center gap-1 ${LINK}`}
          >
            View on explorer{' '}
            <span className="sr-only">(opens in a new tab)</span>
            <Icon name="external" className="size-4" />
          </a>
        )}
      </div>
    </ListRow>
  );
}
