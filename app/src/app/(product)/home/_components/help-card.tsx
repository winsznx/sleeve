import Link from 'next/link';
import type { JSX } from 'react';

import { Icon } from '@/components/ui/icons';

import { OverviewCard } from './overview-card';

/** The questions owners ask first, each answered on the help page. */
const QUESTIONS = [
  'Why is part of my payment waiting?',
  'Where do my Stock Tokens live?',
  'How do I sell back to USDG?',
  'How can anyone check a split?',
] as const;

export interface HelpCardProps {
  /** Paydays in the current New York month. */
  paydaysThisMonth: number;
  /** Sorted payments that needed nothing from the owner, of those whose split has been read. */
  handsFree: { sorted: number; of: number };
}

/**
 * Help (D-029): the reference's assistant card without any assistant. Two plain counts of how the account runs,
 * then the common questions, each a way into the help page.
 */
export function HelpCard({ paydaysThisMonth, handsFree }: HelpCardProps): JSX.Element {
  return (
    <OverviewCard
      title="Questions"
      lede="How Sleeve handles your money, in plain words."
    >
      <dl className="grid grid-cols-2 gap-2.5">
        <div className="rounded-large bg-surface-muted p-3.5">
          <dt className="text-body-s text-ink-secondary">Paydays this month</dt>
          <dd className="mt-1 text-figure-m tabular-nums text-ink">{paydaysThisMonth}</dd>
        </div>
        <div className="rounded-large bg-surface-muted p-3.5">
          <dt className="text-body-s text-ink-secondary">Sorted for you</dt>
          <dd className="mt-1 text-figure-m tabular-nums text-ink">
            {handsFree.sorted}
            <span className="text-body-s font-medium text-ink-secondary"> of {handsFree.of}</span>
          </dd>
        </div>
      </dl>
      <ul className="mt-4 flex flex-col">
        {QUESTIONS.map((question) => (
          <li key={question} className="border-t border-border first:border-t-0">
            <Link
              href="/help"
              className="flex min-h-touch items-center justify-between gap-3 rounded-control py-2 text-body-s font-medium text-ink transition-colors duration-fast ease-standard hover:text-accent-strong"
            >
              {question}
              <Icon name="chevronRight" className="size-4 shrink-0 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-3">
        <Link href="/help" className="inline-flex min-h-touch items-center text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover">
          Open help
        </Link>
      </div>
    </OverviewCard>
  );
}
