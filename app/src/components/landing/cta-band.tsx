import Link from 'next/link';
import type { JSX } from 'react';

import { ButtonLink } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';

import { APP_HREFS, EYEBROWS, START_HREF, START_LABEL } from './copy';
import { Eyebrow, LANDING_CONTAINER } from './primitives';

/**
 * closeout's closing band (blueprint section 9) on the bright mint wash, which carries ink and the black pill at full
 * contrast (docs/DESIGN.md 2.4: ink-secondary 4.62 to 1 at its darkest stop).
 */
export function CtaBand(): JSX.Element {
  return (
    <section aria-labelledby="cta-title" className={cx(LANDING_CONTAINER, 'pb-16 pt-section md:pb-24')}>
      <div className="flex flex-col items-center gap-[1.125rem] rounded-card bg-hero px-5 py-[3.25rem] text-center md:px-8 md:py-[5.25rem]">
        <Eyebrow>{EYEBROWS.start}</Eyebrow>
        <h2 id="cta-title" className="max-w-[18ch] text-balance text-display-l text-ink">
          Set it once, then get paid.
        </h2>
        <p className="max-w-[52ch] text-pretty text-body-l text-ink-secondary">
          Pick your split and your Stock Token, share your payment address, and every payment after that follows your rule.
        </p>
        <ButtonLink href={START_HREF} size="lg" className="mt-3.5">
          {START_LABEL}
        </ButtonLink>
        <Link
          href={APP_HREFS.home}
          className="inline-flex min-h-touch items-center text-body-s text-ink-secondary underline underline-offset-4 transition-colors duration-fast hover:text-ink"
        >
          Already set up? Open the app
        </Link>
      </div>
    </section>
  );
}
