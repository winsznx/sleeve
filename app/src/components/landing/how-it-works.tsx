import type { JSX } from 'react';

import { EYEBROWS, SECTION_IDS } from './copy';
import { Eyebrow, LandingSection, SplitHeading } from './primitives';
import { StepsPanel } from './steps-panel';

/** The four-step list (blueprint section 4): one payday from the address to the Stock Token, a step at a time. */
export function HowItWorks(): JSX.Element {
  return (
    <LandingSection id={SECTION_IDS.how} titleId="how-title">
      <SplitHeading
        titleId="how-title"
        eyebrow={<Eyebrow>{EYEBROWS.how}</Eyebrow>}
        title={
          <>
            <span className="block">Get paid as usual.</span> <span className="block">Your rule does the rest.</span>
          </>
        }
        lead="Share your address once. After that, every USDG payment that reaches it is split by your rule, whether you are online or not, with nothing to sign."
      />
      <StepsPanel className="mt-9 md:mt-14" />
    </LandingSection>
  );
}
