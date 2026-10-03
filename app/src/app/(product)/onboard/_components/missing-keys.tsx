import type { JSX } from 'react';

import { Banner } from '@/components/ui/card';
import { missingAccountKeys, missingKeyText, readChainConfig } from '@/lib/chain/config';
import { DATA_SOURCE } from '@/data/source';

/** The keys onboarding needs on Robinhood Chain that .env.local does not have yet. Empty on sample data. */
export function missingOnboardingKeys(): string[] {
  return DATA_SOURCE === 'chain' ? missingAccountKeys(readChainConfig()).map(missingKeyText) : [];
}

/**
 * Says up front what is missing before an account can be made on Robinhood Chain, one line per key, instead of
 * letting the last step fail. NEXT_PUBLIC_ values are inlined at build time, so server and browser agree.
 */
export function MissingKeys({ lines, className }: { lines: readonly string[]; className?: string }): JSX.Element | null {
  if (lines.length === 0) return null;
  return (
    <Banner title="Sleeve is not set up for Robinhood Chain yet" className={className}>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-5">
        {lines.map((line) => (
          <li key={line} className="font-mono">
            {line}
          </li>
        ))}
      </ul>
      <p className="mt-2">Restart the app after adding them. Nothing is set up until then.</p>
    </Banner>
  );
}
