'use client';

import type { JSX } from 'react';

import { SignInChoices } from '@/components/sleeve/sign-in-choices';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * What an owner screen shows when no one is signed in: sign in with the passkey or the wallet that owns the account
 * (D-041), and the way in for someone new. A successful sign in refreshes every read, so the screen fills in where it
 * stands.
 */
export function SignedOutPrompt(): JSX.Element {
  return (
    <EmptyState title="You are signed out" action={<SignInChoices />}>
      Sign in with the passkey or the wallet you set up Sleeve with to see your account.
    </EmptyState>
  );
}
