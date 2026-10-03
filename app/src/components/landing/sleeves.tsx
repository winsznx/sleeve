import { LAUNCH_TICKERS } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import type { TokenKey } from '@/components/token/registry';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenStack } from '@/components/token/token-stack';
import { cx } from '@/components/ui/cx';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { EYEBROWS, SECTION_IDS } from './copy';
import { SpendDevice, StockTokensDevice } from './devices';
import { Eyebrow, LandingSection, SplitHeading } from './primitives';

const LAUNCH_KEYS: readonly TokenKey[] = LAUNCH_TICKERS.flatMap((ticker) => {
  const key = tickerTokenKey(ticker.id);
  return key === null ? [] : [key];
});

/**
 * closeout's two platform cards with device mocks (blueprint section 6) as the two sleeves. The cards sit on the
 * apricot and mint washes side by side, which is the split as a picture (docs/DESIGN.md 2.5): spend on apricot,
 * Stock Tokens on mint. Both washes carry ink at AA, and every figure sits on the white device, never on the wash.
 */
export function Sleeves(): JSX.Element {
  return (
    <LandingSection id={SECTION_IDS.sleeves} titleId="sleeves-title">
      <SplitHeading
        titleId="sleeves-title"
        eyebrow={<Eyebrow>{EYEBROWS.sleeves}</Eyebrow>}
        title={
          <>
            <span className="block">Two sleeves,</span> <span className="block">one account.</span>
          </>
        }
        lead="Each payday fills both: USDG you can spend now, and Stock Tokens you keep until you sell. Both sit in your own smart account, never with Sleeve."
      />
      <div className="mt-9 grid gap-[1.375rem] md:mt-14 lg:grid-cols-2">
        <SleeveCard
          wash="bg-apricot"
          mark={<TokenIcon token="USDG" size="2xl" decorative />}
          title="Spend"
          body="The spend share of every payment stays USDG in your account, ready to use. Money waiting to buy can move back here whenever you release it."
        >
          <SpendDevice />
        </SleeveCard>
        <SleeveCard
          id={SECTION_IDS.holdings}
          wash="bg-hero"
          mark={<TokenStack tokens={LAUNCH_KEYS} size="xl" decorative />}
          title="Stock Tokens"
          body={`The equity share buys Stock Tokens into the same account, each valued at its Chainlink price, and you can sell any of them back to USDG. Every one is a ${DEBT_SECURITY_LINE}.`}
        >
          <StockTokensDevice />
        </SleeveCard>
      </div>
    </LandingSection>
  );
}

interface SleeveCardProps {
  /** An anchor the navbar links to. */
  id?: string;
  wash: 'bg-apricot' | 'bg-hero';
  mark: ReactNode;
  title: string;
  body: string;
  children: ReactNode;
}

/**
 * A card whose device rises out of its bottom edge. Both devices meet the edge, unlike closeout's second one
 * (blueprint defect 6); on a phone the card keeps its padding all round.
 */
function SleeveCard({ id, wash, mark, title, body, children }: SleeveCardProps): JSX.Element {
  return (
    <article
      id={id}
      className={cx('flex scroll-mt-24 flex-col overflow-hidden rounded-card p-[1.125rem] md:px-[2.125rem] md:pb-0 md:pt-[2.125rem]', wash)}
    >
      <span className="mb-6 flex">{mark}</span>
      <h3 className="text-h1 font-medium text-ink">{title}</h3>
      <p className="mt-3 max-w-[46ch] text-body text-ink-secondary">{body}</p>
      <div className="mt-8 flex flex-1 items-end justify-center">{children}</div>
    </article>
  );
}
