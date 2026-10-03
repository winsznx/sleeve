'use client';

import type { Address } from '@sleeve/core';
import type { JSX } from 'react';

import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { Icon } from '@/components/ui/icons';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useAccount } from '@/data/hooks';

/**
 * The end of onboarding (D-019): the payment address, shown only once the account reads back deployed with the module
 * installed, so no payment can land before the rule can split it. Then the way home.
 */
export function Done({ account }: { account: Address }): JSX.Element {
  const overview = useAccount(account);

  if (overview.data === undefined) {
    return overview.isError ? (
      <ErrorBlock
        title="Your account did not read back"
        action={
          <Button variant="secondary" onClick={() => void overview.refetch()} busy={overview.isFetching} busyLabel="Checking">
            Check again
          </Button>
        }
      >
        Sleeve could not confirm the module on your account yet, so it does not show the address. Nothing moved.
      </ErrorBlock>
    ) : (
      <SkeletonGroup label="Checking your account" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-56 w-full rounded-module" />
      </SkeletonGroup>
    );
  }

  const ready = overview.data.deployed && overview.data.moduleInstalled;
  if (!ready) {
    return (
      <ErrorBlock
        title="The Sleeve module is not installed yet"
        action={
          <Button variant="secondary" onClick={() => void overview.refetch()} busy={overview.isFetching} busyLabel="Checking">
            Check again
          </Button>
        }
      >
        Your account exists, but until the module is installed it would not split a payment, so the address stays hidden.
      </ErrorBlock>
    );
  }

  return (
    <section aria-labelledby="done-title" className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-pill bg-success text-on-accent">
          <Icon name="check" />
        </span>
        <div>
          <h2 id="done-title" className="text-h2 text-ink">
            Your Sleeve account is ready
          </h2>
          <p className="mt-1 text-body text-ink-secondary">
            The account is deployed and the Sleeve module is installed with your rule. Share the address with whoever pays you.
          </p>
        </div>
      </div>
      <PaymentAddressCard address={account} showQr headingLevel={3} />
      <div className="flex justify-end">
        <ButtonLink href="/home" icon="home" className="w-full sm:w-auto">
          Go to Home
        </ButtonLink>
      </div>
    </section>
  );
}
