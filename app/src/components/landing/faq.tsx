import { CHAIN_NAME, DISCLOSURE, LAUNCH_TICKERS } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { TickerIcon } from '@/components/token/ticker-icon';
import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { DISCLOSURE_ANCHOR } from '@/components/ui/disclosure';
import { formatIsoDate } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { DEBT_SECURITY_LINE, EXIT_LINE, ISSUER_NAME } from '@/lib/copy';

import { EYEBROWS, QUESTION_IDS, SECTION_IDS } from './copy';
import { OpenDetailsOnHash } from './open-details-on-hash';
import { Eyebrow, LANDING_CONTAINER } from './primitives';

/** The Issuer Website the disclosure was copied from (docs/disclosure/README.md). */
const ISSUER_WEBSITE = DISCLOSURE.sources[1];

const ITEM = 'group scroll-mt-24 rounded-module px-[1.125rem] py-4 md:px-6 md:py-5';
const SUMMARY =
  '-mx-2 flex min-h-touch cursor-pointer list-none items-center justify-between gap-[1.125rem] rounded-row px-2 text-body font-medium text-ink md:text-body-l [&::-webkit-details-marker]:hidden';
const ANSWER = 'mt-3 max-w-reading space-y-3 text-body-s leading-[1.65] text-ink-secondary';
const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

/** The plus turns into a close mark when the answer is open. Ink-secondary keeps it above 3 to 1, unlike closeout's. */
function ToggleMark(): JSX.Element {
  return (
    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-pill text-ink-secondary">
      <Icon
        name="close"
        className="size-4 rotate-45 transition-transform duration-fast ease-standard group-open:rotate-0 motion-reduce:transition-none"
      />
    </span>
  );
}

function Question({ id, question, children }: { id: string; question: string; children: ReactNode }): JSX.Element {
  return (
    <details id={id} className={cx(ITEM, 'bg-surface-muted')}>
      <summary className={SUMMARY}>
        {question}
        <ToggleMark />
      </summary>
      <div className={ANSWER}>{children}</div>
    </details>
  );
}

/**
 * closeout's FAQ (blueprint section 8): the holder questions as native details, then the issuer's disclosure word for
 * word in the same collapsed form, so the text is one tap away and never a wall (D-021). The left column carries a
 * Stock Token's facts under the heading, so it is never an empty half. A link to the disclosure's anchor opens it.
 */
export function Faq({ disclosure }: { disclosure: readonly string[] }): JSX.Element {
  return (
    <section id={SECTION_IDS.questions} aria-labelledby="faq-title" className="scroll-mt-24 pt-section">
      <div className={cx(LANDING_CONTAINER, 'grid items-start gap-7 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14')}>
        <div className="flex flex-col items-start gap-5">
          <Eyebrow>{EYEBROWS.questions}</Eyebrow>
          <h2 id="faq-title" className="text-balance text-display-l text-ink">
            <span className="block">Know what you hold</span> <span className="block">before you start.</span>
          </h2>
          <p className="max-w-[28rem] text-body text-ink-secondary">
            Where your money sits, what happens when the market is closed, what it costs, and how you get out.
          </p>
          <HolderCard />
        </div>

        <div className="flex flex-col gap-3">
          <Question id={QUESTION_IDS.holding} question="Is a Stock Token the same as the stock?">
            <p>
              No. A Stock Token is a {DEBT_SECURITY_LINE}, issued by {ISSUER_NAME}. It tracks a US stock or fund and gives you
              no rights in, or against, the company or fund behind it.
            </p>
            <p>The issuer&apos;s own disclosure closes this list, word for word.</p>
          </Question>
          <Question id={QUESTION_IDS.custody} question="Who holds my money?">
            <p>
              You do. Your USDG and Stock Tokens stay in your own smart account on {CHAIN_NAME}, and Sleeve never takes
              custody of them. Its module runs only the flows written into it, and removing it moves any waiting USDG back
              to spend.
            </p>
          </Question>
          <Question id={QUESTION_IDS.closed} question="What if the market is closed?">
            <p>
              The equity share waits as USDG in your account, and the app says why. Sleeve buys after the market opens and a
              fresh Chainlink price arrives. You can release waiting USDG to spend at any time.
            </p>
          </Question>
          <Question id={QUESTION_IDS.cost} question="What does it cost?">
            <p>
              This version charges no Sleeve fee. A buy pays the pool fee and any premium inside your cap, and its record shows
              the all-in price. Sleeve pays the gas for splits and covers the gas for your own actions, within a limit.
            </p>
          </Question>
          <Question id={QUESTION_IDS.eligibility} question="Who can use it?">
            <p>
              People outside the United States who are paid in digital dollars, except where the issuer of Stock Tokens
              restricts or prohibits its offer.{' '}
              <a href={`#${SECTION_IDS.eligibility}`} className={LINK}>
                See the full list
              </a>
              .
            </p>
          </Question>
          <Question id={QUESTION_IDS.exit} question="How do I get out?">
            <p>{EXIT_LINE}</p>
            <p>
              Inside Sleeve you can sell back to USDG through the same check against the Chainlink price. While the market is
              closed, a sell waits unless you choose to override that one sell. You can also remove Sleeve from your account,
              and any waiting USDG moves to spend.
            </p>
          </Question>
          <DisclosureItem paragraphs={disclosure} />
        </div>
      </div>
      <OpenDetailsOnHash />
    </section>
  );
}

const HOLDER_FACTS = [
  { term: 'Issuer', value: ISSUER_NAME },
  { term: 'Rights', value: 'None in, or against, the company or fund it tracks' },
  { term: 'Moves', value: `Like any token on ${CHAIN_NAME}` },
  { term: 'Exit', value: 'Sell on the secondary market, for example back to USDG through Sleeve' },
] as const;

const EXAMPLE_TICKER = LAUNCH_TICKERS[0];

/** What a holder holds (PRD 10's holder questions), as one Stock Token's facts. */
function HolderCard(): JSX.Element {
  return (
    <div className="mt-2 w-full rounded-card border border-border bg-surface p-5 md:p-6">
      <h3 className="text-h3 text-ink">A Stock Token, in brief</h3>
      <div className="mt-3 flex items-center gap-3.5">
        <TickerIcon tickerId={EXAMPLE_TICKER.id} size="xl" />
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{EXAMPLE_TICKER.symbol}, for example</p>
          <p className="text-body-s font-medium text-ink-secondary">{DEBT_SECURITY_LINE}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-border border-t border-border text-body-s">
        <div className="grid gap-0.5 py-2.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-4">
          <dt className="text-ink-secondary">Tracks</dt>
          <dd className="text-ink">{EXAMPLE_TICKER.name}</dd>
        </div>
        {HOLDER_FACTS.map((fact) => (
          <div key={fact.term} className="grid gap-0.5 py-2.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-4">
            <dt className="text-ink-secondary">{fact.term}</dt>
            <dd className="text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The issuer disclosure (docs/DESIGN.md 12.6), collapsed: source and date, the full hash, then the text untouched. */
function DisclosureItem({ paragraphs }: { paragraphs: readonly string[] }): JSX.Element {
  return (
    <details id={DISCLOSURE_ANCHOR} className={cx(ITEM, 'border border-border bg-surface')}>
      <summary className={SUMMARY}>
        <span className="flex items-center gap-3">
          <Icon name="info" className="shrink-0 text-ink-secondary" />
          Issuer disclosure, word for word
        </span>
        <ToggleMark />
      </summary>
      <div className="mt-3">
        <p className="text-body-s text-ink-secondary">
          Copied from{' '}
          <a href={ISSUER_WEBSITE} className={LINK}>
            docs.robinhood.com/rhj
          </a>
          , retrieved {formatIsoDate(DISCLOSURE.retrievedOn)}. Every receipt carries this hash.
        </p>
        <div className="mt-3 flex items-start gap-1 rounded-row bg-surface-muted pl-3">
          <p className="min-w-0 flex-1 py-2.5 text-body-s text-ink-secondary">
            <span className="block">keccak256 of the text</span>
            <span className="block break-all font-mono text-mono-s">{DISCLOSURE.keccak256}</span>
          </p>
          <CopyButton value={DISCLOSURE.keccak256} label="Copy disclosure hash" className="mt-1.5" />
        </div>
        <div className="mt-4 max-w-reading space-y-3 text-body-s text-ink">
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      </div>
    </details>
  );
}
