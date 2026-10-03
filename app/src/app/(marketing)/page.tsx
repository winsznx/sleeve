import type { Metadata } from 'next';
import type { JSX } from 'react';

import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

import { ONE_SENTENCE } from './landing-copy';
import { Eligibility, FinalCall, Hero, HowItWorks, Proof, WhatSleeveIsNot, WhatYouHold } from './landing-sections';

export const metadata: Metadata = { description: ONE_SENTENCE };

/**
 * The landing page: the one sentence, how it works, the receipt as proof, what Sleeve is not, who can use it, and
 * what a holder holds, with the issuer's disclosure read and hash-checked on the server. The root layout adds the
 * disclaimer footer.
 */
export default async function LandingPage(): Promise<JSX.Element> {
  const paragraphs = disclosureParagraphs(await readDisclosureText());
  return (
    <>
      <Hero />
      <HowItWorks />
      <Proof />
      <WhatSleeveIsNot />
      <Eligibility />
      <WhatYouHold paragraphs={paragraphs} />
      <FinalCall />
    </>
  );
}
