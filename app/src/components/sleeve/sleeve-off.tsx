'use client';

import type { Address } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { Note } from '@/components/ui/card';
import { useAccount } from '@/data/hooks';
import type { AccountOverview } from '@/data/types';

/**
 * Sleeve off (D-040): an account on chain whose Kernel no longer runs the module, as after Remove Sleeve. The module
 * keeps no ledger for it and reads every amount as zero, so screens built on the module's view show the way Home
 * instead of those zeros.
 */

export function isSleeveOff(overview: AccountOverview): boolean {
  return overview.deployed && !overview.moduleInstalled;
}

/** Whether Sleeve is off for the account, read from chain. False until the account reads back. */
export function useSleeveOff(account: Address | null): boolean {
  const overview = useAccount(account ?? undefined);
  return overview.data !== undefined && isSleeveOff(overview.data);
}

/** The short note a product screen shows while Sleeve is off for the account, with the way to Home. */
export function SleeveOffNote({ className }: { className?: string }): JSX.Element {
  return (
    <Note title="Sleeve is off for this account" className={className}>
      <p>
        Payments are not split while it is off. Your USDG and Stock Tokens stay in your account, and Home shows them, with Send
        and the way to turn Sleeve back on.
      </p>
      <ButtonLink href="/home" size="sm" variant="secondary" icon="home" className="mt-3">
        Go to Home
      </ButtonLink>
    </Note>
  );
}

export interface SleeveOnlyProps {
  account: Address;
  /** What the screen shows while the account reads back. */
  pending: ReactNode;
  /** Above the note, for a screen whose body carries its own page header. */
  header?: ReactNode;
  children: ReactNode;
}

/**
 * A screen's body for an account Sleeve is on for, or the note in its place while Sleeve is off. When the account read
 * fails, the body shows, with its own reads and their errors.
 */
export function SleeveOnly({ account, pending, header, children }: SleeveOnlyProps): JSX.Element {
  const overview = useAccount(account);
  if (overview.data === undefined) return <>{overview.isError ? children : pending}</>;
  if (!isSleeveOff(overview.data)) return <>{children}</>;
  return (
    <>
      {header}
      <SleeveOffNote className="max-w-reading" />
    </>
  );
}
