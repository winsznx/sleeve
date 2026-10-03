import type { JSX } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';

import { APP_HREFS, PROOF_CARD_ID, SECTION_IDS } from './copy';
import { LANDING_CONTAINER } from './primitives';
import { ProofCard } from './proof-card';

const FACTS = [
  'Written in the same transaction as the split, never after it',
  'The all-in price, measured from what left and entered your account',
  "Rechecked through a different RPC provider from the keeper's",
] as const;

/**
 * The trust surface, kept to one compact band near the end (D-024): every split is on chain and anyone can recompute
 * it. The receipt is named here because here the subject is proof.
 */
export function Proof(): JSX.Element {
  return (
    <section id={SECTION_IDS.proof} aria-labelledby="proof-title" className="scroll-mt-24 pt-section">
      <div className={LANDING_CONTAINER}>
        <div className="grid gap-7 rounded-card bg-surface-muted p-5 md:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-14 lg:p-10">
          <div className="flex flex-col items-start">
            <h2 id="proof-title" className="max-w-[22ch] text-balance text-[clamp(1.75rem,1.35rem+1.6vw,2.5rem)] font-medium leading-[1.1] tracking-[-0.028em] text-ink">
              Every split is on chain, and anyone can recompute it.
            </h2>
            <p className="mt-4 max-w-[34rem] text-pretty text-body text-ink-secondary">
              Each split writes a receipt: what arrived, what stayed spendable, what bought or waited, and the Chainlink round
              the price was checked against.
            </p>
            <ul className="mt-5 flex flex-col gap-2.5">
              {FACTS.map((fact) => (
                <li key={fact} className="flex items-start gap-2.5 text-body-s text-ink">
                  <span aria-hidden="true" className="mt-px grid size-5 shrink-0 place-items-center rounded-pill bg-success text-on-accent">
                    <Icon name="check" className="size-3.5" />
                  </span>
                  {fact}
                </li>
              ))}
            </ul>
            <ButtonLink href={APP_HREFS.checkSplit} variant="secondary" size="lg" className="mt-7">
              Check a split
            </ButtonLink>
          </div>
          <div id={PROOF_CARD_ID} className="flex scroll-mt-24">
            <ProofCard />
          </div>
        </div>
      </div>
    </section>
  );
}
