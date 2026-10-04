import type { Metadata } from 'next';
import type { JSX } from 'react';

import { Eyebrow, LANDING_CONTAINER } from '@/components/landing/primitives';
import { cx } from '@/components/ui/cx';
import { WaitlistForm } from '@/components/waitlist/waitlist-form';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description: 'Hear from Sleeve first: a payment address on Robinhood Chain that invests part of every payment.',
};

/** The waitlist (D-038), linked from the footer: why to join beside the form, and what is kept. */
export default function WaitlistPage(): JSX.Element {
  return (
    <section aria-labelledby="waitlist-title" className="pb-section pt-section">
      <div className={cx(LANDING_CONTAINER, 'grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16')}>
        <div className="flex flex-col items-start gap-5">
          <Eyebrow>Waitlist</Eyebrow>
          <h1 id="waitlist-title" className="text-balance text-display-l text-ink">
            Hear what Sleeve does next
          </h1>
          <p className="max-w-reading text-pretty text-body-l text-ink-secondary">
            Sleeve is live on Robinhood Chain: a payment address that invests part of every payment, by a rule you set once.
            Leave your email and we will write when there is news worth your time, and not otherwise.
          </p>
          <p className="max-w-reading text-pretty text-body text-ink-secondary">
            Tell us how you are paid today, and we will build for the way you earn.
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-6 shadow-soft sm:p-8">
          <WaitlistForm />
          <p className="mt-6 border-t border-border pt-5 text-body-s text-ink-secondary">
            We keep your email, your answer and the country your request came from, and use them only to write to you about
            Sleeve.
          </p>
        </div>
      </div>
    </section>
  );
}
