import { LAUNCH_TICKERS } from '@sleeve/core';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { tokenSymbol, type TokenKey } from '@/components/token/registry';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { BUILT_ON_LINE } from '@/lib/copy';

import { HERO_BADGE, HERO_LEAD, ONE_SENTENCE, SECTION_IDS, START_HREF, START_LABEL } from './copy';
import { HeroScene } from './hero-scene';
import { Eyebrow, LANDING_CONTAINER } from './primitives';

/**
 * The hero (blueprint section 3): the badge, the PRD sentence as the headline, the lead and two pills, then one
 * payday as a product scene, then the strip of the tokens a payday moves. Centered, as closeout's.
 *
 * The headline is the whole sentence a stranger should repeat (PRD 1), so it runs to three lines at 60 px on a
 * desktop instead of closeout's 76 px, which would take four.
 */
export function Hero(): JSX.Element {
  return (
    <section aria-labelledby="hero-title" className={cx(LANDING_CONTAINER, 'flex flex-col items-center pt-12 text-center md:pt-16')}>
      <Eyebrow>{HERO_BADGE}</Eyebrow>
      <h1
        id="hero-title"
        className="mt-7 max-w-[68rem] text-balance text-[clamp(2rem,1.2rem+3.5vw,3.75rem)] font-medium leading-[1.04] tracking-[-0.035em] text-ink md:mt-8"
      >
        {ONE_SENTENCE}
      </h1>
      <p className="mt-6 max-w-[38rem] text-pretty text-body-l text-ink-secondary">{HERO_LEAD}</p>
      <div className="mt-9 flex w-full flex-col gap-3.5 sm:w-auto sm:flex-row sm:justify-center">
        <ButtonLink href={START_HREF} size="lg" fullWidth className="sm:w-auto">
          {START_LABEL}
        </ButtonLink>
        <ButtonLink href={`#${SECTION_IDS.how}`} variant="secondary" size="lg" fullWidth className="sm:w-auto">
          <span className="inline-flex items-center gap-2">
            How it works
            <Icon name="chevronDown" className="size-4" />
          </span>
        </ButtonLink>
      </div>
      <HeroScene className="mt-12 w-full text-left md:mt-14" />
      <TokenStrip />
    </section>
  );
}

const STRIP_TOKENS: readonly TokenKey[] = [
  'USDG',
  ...LAUNCH_TICKERS.flatMap((ticker) => {
    const key = tickerTokenKey(ticker.id);
    return key === null ? [] : [key];
  }),
];

/** closeout's provider strip: the network as words with a neutral glyph, then USDG and the launch Stock Tokens. */
function TokenStrip(): JSX.Element {
  return (
    <div className="mt-14 flex w-full flex-col gap-5 border-t border-border pt-7 text-left xl:flex-row xl:items-center xl:justify-between xl:gap-8">
      <p className="flex items-start gap-2 text-body-s text-ink-secondary">
        <NetworkGlyph className="mt-0.5 size-4" />
        <span>{BUILT_ON_LINE}. Payments arrive in USDG, and part of each buys a Stock Token.</span>
      </p>
      <ul aria-label="USDG and the launch Stock Tokens" className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {STRIP_TOKENS.map((token, index) => (
          <li key={token} className="flex items-center gap-4">
            {index === 0 ? null : <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />}
            <span className="flex items-center gap-2.5 text-body font-medium text-ink">
              <TokenIcon token={token} size="lg" decorative />
              {tokenSymbol(token)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
