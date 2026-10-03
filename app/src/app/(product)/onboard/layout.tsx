import type { JSX, ReactNode } from 'react';

import { WalletProviders } from '@/components/wallet/wallet-providers';

/**
 * wagmi and RainbowKit for onboarding only (D-022, docs/research/wallet-connect.md section 5): on mount wagmi loads
 * every wallet SDK and, with a project id, calls Reown, so Home and Payments never pay for them.
 */
export default function OnboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return <WalletProviders>{children}</WalletProviders>;
}
