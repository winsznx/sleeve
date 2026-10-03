import type { Metadata } from 'next';
import type { JSX } from 'react';

import { ONE_SENTENCE } from '@/components/landing/copy';
import { CtaBand } from '@/components/landing/cta-band';
import { Eligibility } from '@/components/landing/eligibility';
import { Faq } from '@/components/landing/faq';
import { Features } from '@/components/landing/features';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { LaunchTickers } from '@/components/landing/launch-tickers';
import { Proof } from '@/components/landing/proof';
import { Sleeves } from '@/components/landing/sleeves';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

export const metadata: Metadata = { description: ONE_SENTENCE };

/**
 * The landing page in closeout's composition (docs/design/closeout-landing-blueprint.md), led by the payday split
 * (D-024): the hero and one payday as its product scene, how a payday works, what the rule does, the two sleeves, the
 * launch Stock Tokens, one compact band of proof, who can use it and what it is not, the questions with the issuer's
 * disclosure, and the closing band. The disclosure is read and hash-checked on the server; the live pieces read the
 * data layer in the browser. The root layout adds the footer with the disclaimer.
 */
export default async function LandingPage(): Promise<JSX.Element> {
  const disclosure = disclosureParagraphs(await readDisclosureText());
  return (
    <>
      <Hero />
      <HowItWorks />
      <Features />
      <Sleeves />
      <LaunchTickers />
      <Proof />
      <Eligibility />
      <Faq disclosure={disclosure} />
      <CtaBand />
    </>
  );
}
