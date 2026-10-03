import { CHAIN_NAME } from '@sleeve/core';
import type { JSX } from 'react';

import { Icon } from '@/components/ui/icons';
import { DEBT_SECURITY_LINE, ISSUER_NAME } from '@/lib/copy';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

import { SECTION_IDS } from './copy';
import { LANDING_CONTAINER } from './primitives';

const NOT_LIST = [
  {
    title: 'Not a broker, and not the issuer',
    body: 'Sleeve buys on public pools on Robinhood Chain. It never mints or redeems Stock Tokens.',
  },
  {
    title: 'Not a custodian',
    body: 'Your USDG and Stock Tokens stay in your own smart account. Its module runs only the flows written into it, and Sleeve cannot freeze your money.',
  },
  {
    title: 'Not the stock itself',
    body: `A Stock Token is a ${DEBT_SECURITY_LINE}, issued by ${ISSUER_NAME}. It tracks a US stock or fund and gives no rights in the company or fund.`,
  },
  {
    title: 'Not a trading app',
    body: 'No charts and no orders to place. You set one rule, and each payment follows it.',
  },
  {
    title: 'Not a promise about prices',
    body: "Sleeve says nothing about where a Stock Token's price goes. It can fall as well as rise.",
  },
] as const;

/**
 * Who can sign up and what Sleeve is not, side by side in one ruled panel: the eligibility lists as chips (PRD 3 and
 * 7.12), and the five things a new user might wrongly assume, each with one plain line.
 */
export function Eligibility(): JSX.Element {
  return (
    <div className={`${LANDING_CONTAINER} pt-section`}>
      <div className="grid overflow-hidden rounded-card border border-border lg:grid-cols-2">
        <section id={SECTION_IDS.eligibility} aria-labelledby="eligibility-title" className="scroll-mt-24 p-5 sm:p-8 lg:p-10">
          <h2 id="eligibility-title" className="text-h1 font-medium text-ink">
            Who can use Sleeve
          </h2>
          <p className="mt-3 max-w-[34rem] text-body text-ink-secondary">
            People outside the United States who get paid in digital dollars: for work, for invoices, or from family abroad.
          </p>
          <p className="mt-6 text-body-s font-semibold text-ink">Not open to US persons, or to anyone living in these places.</p>
          <CountryGroup label="Where the issuer restricts its offer" countries={Object.values(RESTRICTED_JURISDICTIONS)} />
          <CountryGroup label="Where its offer is prohibited" countries={Object.values(PROHIBITED_JURISDICTIONS)} />
          <p className="mt-6 max-w-[34rem] text-body-s text-ink-secondary">
            Onboarding asks where you live and checks the country your connection comes from. Stock Tokens move like any
            token, so Sleeve cannot enforce this on chain, and does not claim to.
          </p>
          <div className="mt-6 flex gap-3 rounded-row border border-accent-border bg-info-soft p-4">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-pill bg-surface text-accent">
              <Icon name="receive" />
            </span>
            <p className="min-w-0 text-body-s text-ink-secondary">
              <span className="block font-semibold text-ink">Paid in another stablecoin, or on another chain?</span>
              Move it to your payment address as USDG on {CHAIN_NAME}. Your rule splits it when it lands.
            </p>
          </div>
        </section>
        <section aria-labelledby="not-title" className="border-t border-border bg-surface-muted p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
          <h2 id="not-title" className="text-h1 font-medium text-ink">
            What Sleeve is not
          </h2>
          <ul className="mt-3 divide-y divide-border">
            {NOT_LIST.map((item) => (
              <li key={item.title} className="flex gap-3.5 py-3.5">
                <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-pill border border-border bg-surface text-ink-secondary">
                  <Icon name="close" className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-body font-semibold text-ink">{item.title}</span>
                  <span className="mt-0.5 block text-body-s text-ink-secondary">{item.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

function CountryGroup({ label, countries }: { label: string; countries: readonly string[] }): JSX.Element {
  return (
    <div className="mt-4">
      <p className="text-label font-medium text-ink-secondary">{label}</p>
      <ul aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
        {countries.map((country) => (
          <li key={country} className="rounded-pill border border-border bg-surface px-3 py-1 text-body-s text-ink">
            {country}
          </li>
        ))}
      </ul>
    </div>
  );
}
