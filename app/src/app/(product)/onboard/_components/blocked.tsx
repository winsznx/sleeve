import type { JSX } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import type { EligibilityResult } from '@/data/types';

import { blockSentence } from '../_lib/onboarding';

/**
 * Where onboarding stops (PRD 7.12): every reason in plain words, that nothing was set up, and the parts of Sleeve that
 * stay open to everyone. It offers no way around the check.
 */
export function Blocked({ result, onBack }: { result: EligibilityResult; onBack: () => void }): JSX.Element {
  const byConnection = result.blocks.some((block) => block.kind === 'IP_PROHIBITED' || block.kind === 'IP_RESTRICTED');
  return (
    <section aria-labelledby="blocked-title" className="mx-auto flex max-w-reading flex-col gap-6">
      <div role="alert" className="flex gap-4 rounded-module border border-border bg-surface p-5 shadow-card md:p-6">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-row bg-warning-soft text-warning">
          <Icon name="pin" />
        </span>
        <div className="min-w-0">
          <h2 id="blocked-title" className="text-h2 text-ink">
            Sleeve is not available to you
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-body text-ink">
            {result.blocks.map((block) => (
              <li key={`${block.kind}-${'country' in block ? block.country : ''}`}>{blockSentence(block)}</li>
            ))}
          </ul>
          <p className="mt-3 text-body-s text-ink-secondary">
            Nothing was set up and nothing was stored. The issuer of Stock Tokens sets these limits, and Sleeve follows them.
          </p>
        </div>
      </div>
      <div className="rounded-module border border-border bg-surface-muted p-5">
        <h3 className="text-h3 text-ink">You can still check any split</h3>
        <p className="mt-1 text-body-s text-ink-secondary">
          Every split Sleeve makes is recorded on Robinhood Chain, and anyone can recompute it from public data.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink href="/verify" icon="verify">
            Check a split
          </ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Back to the Sleeve site
          </ButtonLink>
        </div>
      </div>
      {byConnection ? null : (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-touch items-center self-start text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover"
        >
          I chose a wrong answer by mistake
        </button>
      )}
    </section>
  );
}
