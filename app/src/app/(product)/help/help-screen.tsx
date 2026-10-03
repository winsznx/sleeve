'use client';

import Link from 'next/link';
import { useId, useState, type JSX } from 'react';

import { OpenDetailsOnHash } from '@/components/landing/open-details-on-hash';
import { NavIcon } from '@/components/shell/glyphs';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';

import { HELP_ANSWERS, matchesQuery, type HelpAnswer, type HelpLink } from './help-answers';

/**
 * Help (D-029): the owner's common questions as native disclosures, each answer pointing at the screen that does the
 * thing. Typing narrows the list and opens what is left; a link to /help#an-answer opens that one.
 */

const LINK =
  'inline-flex min-h-touch items-center gap-1 text-body-s font-medium text-link underline underline-offset-4 transition-colors duration-fast ease-standard hover:text-link-hover';

function AnswerLink({ link }: { link: HelpLink }): JSX.Element {
  const content = (
    <>
      {link.label}
      <Icon name="arrowRight" className="size-4" />
    </>
  );
  // The disclosure is a static file and the eligibility list lives on the landing page: plain links for both.
  if (link.href.startsWith('/disclosure/') || link.href.startsWith('/#')) {
    return (
      <a href={link.href} className={LINK}>
        {content}
      </a>
    );
  }
  return (
    <Link href={link.href} className={LINK}>
      {content}
    </Link>
  );
}

function Answer({ answer, open }: { answer: HelpAnswer; open: boolean | undefined }): JSX.Element {
  return (
    <li className="border-t border-border first:border-t-0">
      <details id={answer.id} open={open} className="group scroll-mt-24">
        <summary className="flex min-h-control-lg cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-body font-medium text-ink transition-colors duration-fast ease-standard hover:bg-surface-muted md:px-5 [&::-webkit-details-marker]:hidden">
          {answer.question}
          <Icon name="chevronDown" className="size-4 shrink-0 text-ink-secondary transition-transform duration-fast ease-standard group-open:rotate-180" />
        </summary>
        <div className="px-4 pb-4 md:px-5">
          <div className="max-w-reading space-y-2 text-body-s leading-[1.65] text-ink-secondary">
            {answer.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-5">
            {answer.links.map((link) => (
              <AnswerLink key={link.href} link={link} />
            ))}
          </div>
        </div>
      </details>
    </li>
  );
}

export function HelpScreen(): JSX.Element {
  const [query, setQuery] = useState('');
  const countId = useId();
  const searching = query.trim() !== '';
  const shown = HELP_ANSWERS.filter((answer) => matchesQuery(answer, query));

  return (
    <div className="max-w-form">
      <PageHeader title="Help" description="Plain answers about your money in Sleeve, each with a way to the screen that does it." />
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
        <Input
          type="search"
          label="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try waiting, sell or fees"
          autoComplete="off"
          aria-describedby={countId}
          className="min-w-0 flex-1"
        />
      </div>
      <p id={countId} aria-live="polite" className="sr-only">
        {searching ? `${shown.length} ${shown.length === 1 ? 'answer matches' : 'answers match'}` : `${HELP_ANSWERS.length} answers`}
      </p>
      {shown.length === 0 ? (
        <EmptyState title="No answer matches">
          Try fewer words, or one of these: waiting, holdings, send, price, fees, recovery.
        </EmptyState>
      ) : (
        <ul aria-label="Answers" className="overflow-hidden rounded-panel border border-border bg-surface">
          {shown.map((answer) => (
            <Answer key={answer.id} answer={answer} open={searching ? true : undefined} />
          ))}
        </ul>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-1 text-body-s text-ink-secondary">
        <span className="inline-flex items-center gap-2">
          <NavIcon name="settings" className="size-4" />
          <Link href="/settings" className={LINK}>
            Settings
          </Link>
        </span>
        <span className="inline-flex items-center gap-2">
          <NavIcon name="verify" className="size-4" />
          <Link href="/verify" className={LINK}>
            Check a split
          </Link>
        </span>
      </div>
      <OpenDetailsOnHash />
    </div>
  );
}
