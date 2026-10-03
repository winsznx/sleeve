'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, useTransition, type FormEvent, type JSX, type ReactNode } from 'react';

import { readReceiptIdInput } from '@/app/(public)/verify/receipt-id-input';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import type { BadgeTone } from '@/components/ui/badge';
import { FilterPill } from '@/components/ui/choice';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { FILTER_TICKERS, STATUS_CHIPS, type HistoryFilters } from '../_lib/filters';

/**
 * The history's toolbar (docs/design/closeout-product-blueprint.md 3.2 and 3.4): ticker chips with each Stock
 * Token's icon, status chips in plain words with the tone of each row chip, and a way to open any action by its
 * number. Chips wrap from 768 px; on a phone each group is one row that scrolls sideways inside itself, so the page
 * never does and the list starts high on the screen.
 */

export const NOT_AN_ACTION_NUMBER = 'Enter a number in digits, such as 455.';

const DOT: Record<BadgeTone, string> = {
  equity: 'bg-equity',
  success: 'bg-success',
  info: 'bg-info',
  waiting: 'bg-waiting',
  danger: 'bg-danger',
  neutral: 'bg-ink-muted',
};

/** 44 px tall pills: min-h-control sits after the kit's min-h-control-sm in the stylesheet, so it wins. */
const CHIP = 'min-h-control shrink-0 whitespace-nowrap';

function ChipRow({ labelId, label, children }: { labelId: string; label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="min-w-0">
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        className="-mx-gutter flex gap-2 overflow-x-auto px-gutter pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0"
      >
        {children}
      </div>
    </div>
  );
}

export interface HistoryToolbarProps {
  filters: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
}

export function HistoryToolbar({ filters, onChange }: HistoryToolbarProps): JSX.Element {
  const tickerLabelId = useId();
  const statusLabelId = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-8">
      <ChipRow labelId={tickerLabelId} label="Ticker">
        <FilterPill className={CHIP} pressed={filters.tickerId === undefined} onClick={() => onChange({ ...filters, tickerId: undefined })}>
          All tickers
        </FilterPill>
        {FILTER_TICKERS.map((ticker) => {
          const token = tickerTokenKey(ticker.id);
          return (
            <FilterPill
              key={ticker.id}
              className={cx(CHIP, token !== null && 'gap-2 pl-1.5 pr-4')}
              pressed={filters.tickerId === ticker.id}
              onClick={() => onChange({ ...filters, tickerId: ticker.id })}
            >
              {token === null ? null : <TokenIcon token={token} size="md" decorative />}
              {ticker.symbol}
            </FilterPill>
          );
        })}
      </ChipRow>
      <div className="min-w-0 lg:col-span-2">
        <ChipRow labelId={statusLabelId} label="Status">
          <FilterPill className={CHIP} pressed={filters.status === undefined} onClick={() => onChange({ ...filters, status: undefined })}>
            Any status
          </FilterPill>
          {STATUS_CHIPS.map((chip) => (
            <FilterPill
              key={chip.status}
              className={cx(CHIP, 'gap-2 pl-3.5')}
              pressed={filters.status === chip.status}
              onClick={() => onChange({ ...filters, status: chip.status })}
            >
              <span aria-hidden="true" className={cx('size-2 shrink-0 rounded-pill', DOT[chip.tone])} />
              {chip.label}
            </FilterPill>
          ))}
        </ChipRow>
      </div>
      <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:self-center">
        <ActionJump />
      </div>
    </div>
  );
}

/** Opens any action's details by its number. Actions are public onchain, so the number need not be on this account. */
function ActionJump(): JSX.Element {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = readReceiptIdInput(value);
    if (id === null) {
      setError(NOT_AN_ACTION_NUMBER);
      return;
    }
    startOpening(() => router.push(`/receipts/${id}`));
  }

  return (
    <form role="search" aria-label="Open an action by its number" noValidate onSubmit={submit} className="min-w-0 lg:w-[17rem] lg:shrink-0">
      <div
        className={cx(
          'flex min-h-control-lg items-center rounded-pill border bg-surface pr-1 transition-colors duration-fast ease-standard has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus',
          error === null ? 'border-border-control hover:border-ink-secondary' : 'border-danger',
        )}
      >
        <label htmlFor={inputId} className="shrink-0 pl-4 text-body-s font-medium text-ink-secondary">
          Go to
        </label>
        <span aria-hidden="true" className="pl-2 font-mono text-input text-ink-muted">
          #
        </span>
        <input
          id={inputId}
          name="number"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : errorId}
          className="min-h-control w-0 min-w-0 flex-1 bg-transparent pl-0.5 pr-2 font-mono text-input tabular-nums text-ink focus-visible:outline-none"
        />
        <button
          type="submit"
          aria-busy={opening || undefined}
          className="inline-flex min-h-control-sm shrink-0 items-center rounded-pill bg-brand px-4 text-body-s font-medium text-on-brand transition-colors duration-fast ease-standard hover:bg-brand-strong focus-visible:-outline-offset-4 focus-visible:outline-focus-inverse"
        >
          {opening ? 'Opening' : 'Open'}
        </button>
      </div>
      {error === null ? null : (
        <p id={errorId} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
          <Icon name="alert" className="mt-0.5 size-4" />
          {error}
        </p>
      )}
    </form>
  );
}
