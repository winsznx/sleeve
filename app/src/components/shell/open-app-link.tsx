'use client';

import { shortAddress } from '@sleeve/core';
import Link from 'next/link';
import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { useSession } from '@/data/hooks';

import { AccountAvatar } from './account-avatar';
import { APP_HOME } from './site-map';

/**
 * The navbar's one way in: closeout's 44 px black pill. When someone is signed in on this device, the pill gains
 * their account's avatar and its accessible name says whose account opens (docs/design/inspiration.md 4.1). The
 * words stay "Open the app" for everyone.
 */
export function OpenAppLink({ className }: { className?: string }): JSX.Element {
  const session = useSession();
  const account = session.data?.account ?? null;
  return (
    <Link
      href={APP_HOME}
      aria-label={account === null ? undefined : `Open the app as ${shortAddress(account)}`}
      className={cx(
        'inline-flex min-h-control shrink-0 items-center justify-center gap-2.5 whitespace-nowrap rounded-pill bg-brand text-body-s font-medium text-on-brand transition-colors duration-fast ease-standard hover:bg-brand-strong',
        account === null ? 'px-5' : 'pl-2 pr-5',
        className,
      )}
    >
      {account === null ? null : <AccountAvatar address={account} size="sm" tone="light" />}
      Open the app
    </Link>
  );
}
