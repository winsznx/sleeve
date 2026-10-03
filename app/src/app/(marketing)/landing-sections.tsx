import { RULE_DEFAULTS, formatBps } from '@sleeve/core';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { ExitLine } from '@/components/ui/debt-security-line';
import { Disclosure } from '@/components/ui/disclosure';
import { GatedCard } from '@/components/ui/gated-card';
import { DefinitionList } from '@/components/ui/list';
import { SplitMark } from '@/components/ui/wordmark';
import { BUILT_ON_LINE, DEBT_SECURITY_LINE, ISSUER_NAME } from '@/lib/copy';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

import { EXAMPLE_RECEIPT_ID, receiptHref } from './example-receipt';
import { ExampleReceiptFields } from './example-receipt-fields';
import { ExampleSplit } from './example-split';
import { ONE_SENTENCE_PARTS } from './landing-copy';
import { LANDING_SECTIONS } from './marketing-header';

/**
 * The landing page's sections, in closeout's marketing composition (docs/DESIGN.md 12.9) with Sleeve's words. They
 * render on the server; the two example-receipt pieces are client islands on the data layer. Nothing here is
 * clickable that is not live: borrow and the pay link appear only as gated cards.
 */

const CONTAINER = 'mx-auto w-full max-w-content px-gutter';
const STACKED_BUTTON = 'sm:w-auto';

interface SectionProps {
  id: string;
  titleId: string;
  children: ReactNode;
}

function Section({ id, titleId, children }: SectionProps): JSX.Element {
  return (
    <section id={id} aria-labelledby={titleId} className="scroll-mt-24 pt-section">
      <div className={CONTAINER}>{children}</div>
    </section>
  );
}

/** closeout's section heading: the title on the left, one line on the right from 1024 px. */
function SectionHeading({ titleId, title, children }: { titleId: string; title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.85fr)] lg:items-end lg:gap-12">
      <h2 id={titleId} className="text-balance text-display-l text-ink">
        {title}
      </h2>
      <p className="max-w-reading text-body-l text-ink-secondary lg:pb-1.5">{children}</p>
    </div>
  );
}

export function Hero(): JSX.Element {
  const [promise, setOnce] = ONE_SENTENCE_PARTS;
  return (
    <section aria-labelledby="hero-title" className={cx(CONTAINER, 'pt-10 md:pt-16')}>
      <p className="inline-flex min-h-control-sm items-center gap-2.5 rounded-pill border border-border bg-surface px-4 text-body-s text-ink-secondary shadow-soft">
        <SplitMark />
        For people paid in digital dollars
      </p>
      <div className="mt-6 grid gap-6 lg:mt-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.85fr)] lg:items-end lg:gap-12">
        <h1 id="hero-title" className="text-display-l text-ink">
          {promise} <span className="mt-2 block">{setOnce}</span>
        </h1>
        <div className="flex flex-col gap-6 lg:pb-1.5">
          <p className="max-w-reading text-body-l text-ink-secondary">
            Sleeve is a payment address. Payers send USDG, your rule splits it, and the Stock Tokens it buys land in
            your own account. When the market is closed, that part waits as USDG until it reopens.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ButtonLink href="/onboard" size="lg" fullWidth className={STACKED_BUTTON}>
              Get your payment address
            </ButtonLink>
            <ButtonLink href={`#${LANDING_SECTIONS.how}`} variant="secondary" size="lg" fullWidth className={STACKED_BUTTON}>
              How it works
            </ButtonLink>
          </div>
          <p className="text-body-s text-ink-secondary">{BUILT_ON_LINE}</p>
        </div>
      </div>
      <ExampleSplit className="mt-10 md:mt-14" />
      {EXAMPLE_RECEIPT_ID === null ? null : (
        <p className="mt-3 text-body-s text-ink-secondary">
          An example payday, read from receipt {EXAMPLE_RECEIPT_ID.toString()}.
        </p>
      )}
    </section>
  );
}

const SUGGESTED_START = `${formatBps(RULE_DEFAULTS.equityBps)} in ${tickerSymbol(RULE_DEFAULTS.tickerId)}`;

export const HOW_IT_WORKS = [
  {
    title: 'Set your rule once',
    body: `Choose how much of each payment buys Stock Tokens, and which one. The suggested start is ${SUGGESTED_START}, a broad fund. Pause or change it whenever you like.`,
  },
  {
    title: 'Share your payment address',
    body: 'Your Sleeve account has its own address on Robinhood Chain. Payers send USDG to it like any other transfer, and they need no Sleeve account.',
  },
  {
    title: 'Get paid',
    body: 'The spend share stays USDG, ready to use. The equity share buys Stock Tokens into your own account, inside the price cap you set against the Chainlink reference. When the market is closed, it waits as USDG and buys after the reopen.',
  },
] as const;

export function HowItWorks(): JSX.Element {
  return (
    <Section id={LANDING_SECTIONS.how} titleId="how-title">
      <SectionHeading titleId="how-title" title="How it works">
        You do the first two once. The third happens on every payday, with nothing to press.
      </SectionHeading>
      <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="border-t border-border-strong pt-5">
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center rounded-pill bg-surface-strong text-body font-semibold tabular-nums text-ink"
            >
              {index + 1}
            </span>
            <h3 className="mt-4 text-h2 text-ink">{step.title}</h3>
            <p className="mt-2 max-w-reading text-body text-ink-secondary">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function Proof(): JSX.Element {
  return (
    <Section id={LANDING_SECTIONS.receipts} titleId="proof-title">
      <div className="grid gap-8 rounded-card bg-surface-muted p-4 sm:p-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12 lg:p-12">
        <div className="min-w-0">
          <h2 id="proof-title" className="text-balance text-display-l text-ink">
            The receipt is the proof
          </h2>
          <p className="mt-5 text-body-l text-ink-secondary">
            Every split, wait, buy and sale writes a receipt on chain, in the same transaction as the action. It
            records what arrived, what was bought and at what price, and the Chainlink round that price was checked
            against.
          </p>
          <p className="mt-4 text-body-l text-ink-secondary">
            Anyone can recompute a receipt from public chain data. Sleeve&apos;s verifier reads the chain through a
            different provider from the one its keeper uses, and shows every mismatch it finds.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <ButtonLink href="/verify" variant="secondary" size="lg" fullWidth className={STACKED_BUTTON}>
              Verify a receipt
            </ButtonLink>
            {EXAMPLE_RECEIPT_ID === null ? null : (
              <ButtonLink href={receiptHref(EXAMPLE_RECEIPT_ID)} variant="ghost" size="lg" fullWidth className={STACKED_BUTTON}>
                Open the example receipt
              </ButtonLink>
            )}
          </div>
        </div>
        <ExampleReceiptFields />
      </div>
    </Section>
  );
}

export const NOT_LIST = [
  {
    title: 'Not a trading app',
    body: 'You set one rule. There are no charts to watch and no prices to time, and Sleeve makes no guess about where the market goes.',
  },
  {
    title: 'Not holding your money',
    body: 'Your USDG and Stock Tokens stay in your own smart account. Sleeve never takes custody of them.',
  },
  {
    title: 'No Sleeve fee',
    body: 'This version charges none. A buy pays the pool fee and any premium inside your cap, and its receipt shows the all-in price.',
  },
  {
    title: 'No token and no points',
    body: 'Sleeve has no token of its own, no points, and no rewards for bringing in other people.',
  },
] as const;

export function WhatSleeveIsNot(): JSX.Element {
  return (
    <Section id="what-sleeve-is-not" titleId="not-title">
      <SectionHeading titleId="not-title" title="What Sleeve is not">
        It does one job: split each payment by the rule you set.
      </SectionHeading>
      <ul className="mt-10 grid gap-stack md:grid-cols-2 lg:grid-cols-3">
        {NOT_LIST.map((item) => (
          <li key={item.title} className="rounded-module border border-border bg-surface p-card">
            <h3 className="text-h3 text-ink">{item.title}</h3>
            <p className="mt-1.5 text-body-s text-ink-secondary">{item.body}</p>
          </li>
        ))}
        <li>
          <GatedCard className="h-full">Borrowing USDG against your Stock Tokens is not available yet.</GatedCard>
        </li>
        <li>
          <GatedCard className="h-full">A pay link, where a payer sends and splits in one step, is not available yet.</GatedCard>
        </li>
      </ul>
    </Section>
  );
}

export function Eligibility(): JSX.Element {
  return (
    <Section id={LANDING_SECTIONS.eligibility} titleId="eligibility-title">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
        <h2 id="eligibility-title" className="text-balance text-display-l text-ink">
          Who can use Sleeve
        </h2>
        <div className="min-w-0 max-w-reading">
          <p className="text-body-l text-ink">
            Sleeve is for people outside the United States who are paid in digital dollars. You cannot use it if you
            are a US person, or if you live where the issuer of Stock Tokens restricts or prohibits its offer.
          </p>
          <DefinitionList
            className="mt-5 border-y border-border"
            items={[
              { id: 'restricted', term: 'Offers restricted', value: Object.values(RESTRICTED_JURISDICTIONS).join(', ') },
              { id: 'prohibited', term: 'Prohibited', value: Object.values(PROHIBITED_JURISDICTIONS).join(', ') },
            ]}
          />
          <p className="mt-5 text-body-s text-ink-secondary">
            Onboarding asks where you live and checks the country your connection comes from. Stock Tokens move like
            any token, so Sleeve cannot enforce this on chain, and does not claim to. The issuer can change these lists,
            and Sleeve checks them again at every release.
          </p>
        </div>
      </div>
    </Section>
  );
}

export function WhatYouHold({ paragraphs }: { paragraphs: readonly string[] }): JSX.Element {
  return (
    <Section id={LANDING_SECTIONS.holdings} titleId="hold-title">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
        <h2 id="hold-title" className="text-balance text-display-l text-ink">
          What you hold
        </h2>
        <div className="min-w-0">
          <p className="max-w-reading text-body-l text-ink">
            Each Stock Token is a {DEBT_SECURITY_LINE}, issued by {ISSUER_NAME}. It tracks a US stock or fund, and gives
            you no rights in, or against, the company or fund behind it.
          </p>
          <h3 className="mt-8 text-h3 text-ink">Getting out</h3>
          <ExitLine className="mt-1.5 max-w-reading" />
          <p className="mt-3 max-w-reading text-body-s text-ink-secondary">
            Inside Sleeve you can sell back to USDG through the same check against the Chainlink reference. While the
            market is closed, a sell waits unless you choose otherwise for that one sell.
          </p>
          <Disclosure paragraphs={paragraphs} headingLevel={3} className="mt-8" />
        </div>
      </div>
    </Section>
  );
}

export function FinalCall(): JSX.Element {
  return (
    <section aria-labelledby="final-title" className="py-section">
      <div className={CONTAINER}>
        <div className="flex flex-col items-center gap-5 rounded-card bg-surface-muted px-5 py-14 text-center md:px-8 md:py-20">
          <h2 id="final-title" className="max-w-[18ch] text-balance text-display-l text-ink">
            Set it once, then get paid.
          </h2>
          <p className="max-w-reading text-pretty text-body-l text-ink-secondary">
            Choose your split and your Stock Token, share your address, and let every payday sort itself.
          </p>
          <ButtonLink href="/onboard" size="lg">
            Get your payment address
          </ButtonLink>
          <Link
            href="/home"
            className="inline-flex min-h-touch items-center text-body-s text-ink-secondary underline underline-offset-4 transition-colors duration-fast hover:text-ink"
          >
            Already set up? Open the app
          </Link>
        </div>
      </div>
    </section>
  );
}
