'use client';

import type { JSX } from 'react';

import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useSignIn } from '@/data/hooks';

import { signInFailureText } from '../_lib/sentences';

/**
 * What an owner screen shows when no one is signed in: the passkey sign in, and the way in for someone new. A
 * successful sign in refreshes every read, so the screen fills in where it stands.
 */
export function SignedOutPrompt(): JSX.Element {
  const signIn = useSignIn();
  return (
    <EmptyState
      title="You are signed out"
      action={
        <div className="flex flex-col items-center gap-2">
          <Button onClick={() => signIn.mutate()} busy={signIn.isPending} busyLabel="Signing in">
            Sign in with your passkey
          </Button>
          <ButtonLink href="/onboard" variant="ghost" size="sm">
            New to Sleeve? Set up your account
          </ButtonLink>
          {signIn.isError ? (
            <p role="alert" className="max-w-reading text-body-s text-danger">
              {signInFailureText(signIn.error)}
            </p>
          ) : null}
        </div>
      }
    >
      Sign in with the passkey you made for Sleeve to see your account.
    </EmptyState>
  );
}
