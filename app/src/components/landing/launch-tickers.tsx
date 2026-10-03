import type { JSX } from 'react';

import { buttonClasses } from '@/components/ui/button-styles';
import { DISCLOSURE_ANCHOR } from '@/components/ui/disclosure';

import { SECTION_IDS } from './copy';
import { CenteredHeading, LandingSection } from './primitives';
import { MarketEyebrow, TickerGrid } from './ticker-grid';

/** The launch tickers row (blueprint section 7, closeout's provider cards), with the live market state as its eyebrow. */
export function LaunchTickers(): JSX.Element {
  return (
    <LandingSection id={SECTION_IDS.tickers} titleId="tickers-title">
      <CenteredHeading
        titleId="tickers-title"
        eyebrow={<MarketEyebrow />}
        title="Four Stock Tokens at launch"
        lead="Each has a Chainlink price feed, an allowlisted Uniswap v3 pool and a market session, and Sleeve checks all three before every buy. The marks show what each token tracks. The funds and companies behind them take no part in Sleeve."
      />
      <TickerGrid className="mt-10 md:mt-14" />
      <div className="mt-9 flex justify-center">
        {/* A plain fragment link, so the browser fires hashchange and the collapsed disclosure opens. */}
        <a href={`#${DISCLOSURE_ANCHOR}`} className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
          Read the issuer disclosure
        </a>
      </div>
    </LandingSection>
  );
}
