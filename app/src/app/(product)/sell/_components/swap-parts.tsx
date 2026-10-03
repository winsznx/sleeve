'use client';

import type { ChangeEvent, JSX, ReactNode, Ref } from 'react';

import { TokenIcon } from '@/components/token/token-icon';
import type { TokenKey } from '@/components/token/registry';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

import { Glyph } from '../../receipts/_components/glyphs';

/**
 * The pieces of the sell swap card, in the shape of a Uniswap swap: a "You sell" panel with a large amount and a
 * token chip, a switch between the panels that stays disabled because sells only go to USDG, and a "You get" panel
 * on the muted surface. Built from Sleeve's tokens; black marks the controls, green and apricot mark only meaning.
 */

export interface TokenChipButtonProps {
  token: TokenKey | null;
  symbol: string;
  onClick: () => void;
  disabled?: boolean;
  /** Joins the field's label, so the amount reads "You sell SPY". */
  symbolId: string;
}

/** The chip that names the token being sold and opens the token list. */
export function TokenChipButton({ token, symbol, onClick, disabled = false, symbolId }: TokenChipButtonProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${symbol}, choose another Stock Token`}
      className="inline-flex min-h-control shrink-0 items-center gap-2 rounded-pill border border-border bg-surface py-1 pl-1.5 pr-3 text-body font-semibold text-ink shadow-soft transition-colors duration-fast ease-standard hover:border-border-strong hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-disabled"
    >
      {token === null ? null : <TokenIcon token={token} size="md" decorative />}
      <span id={symbolId}>{symbol}</span>
      <Icon name="chevronDown" className="size-4 text-ink-secondary" />
    </button>
  );
}

/** USDG in the "You get" panel: the only token a sell can go to, so it is not a button. */
export function StaticTokenChip({ token, symbol }: { token: TokenKey; symbol: string }): JSX.Element {
  return (
    <span className="inline-flex min-h-control shrink-0 items-center gap-2 rounded-pill border border-border bg-surface py-1 pl-1.5 pr-3.5 text-body font-semibold text-ink">
      <TokenIcon token={token} size="md" decorative />
      {symbol}
    </span>
  );
}

export interface AmountFieldProps {
  id: string;
  /** The label's id and the chip symbol's id, read together as the field's name. */
  labelledBy: string;
  describedBy?: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  invalid: boolean;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

/**
 * The amount's type steps down as it grows, the way a swap keeps a long number in view: Max and a whole lot fill in
 * every digit the token holds, up to 18 after the point, and the sell must use them all.
 */
export function amountSizeClass(value: string): string {
  if (value.length > 15) return 'text-figure-s max-sm:text-body-l max-sm:font-semibold';
  if (value.length > 11) return 'text-figure-m';
  return 'text-figure-l';
}

/** The big amount, as a swap shows it: no border of its own, the panel is the field. */
export function AmountField({ id, labelledBy, describedBy, value, onChange, invalid, disabled = false, inputRef }: AmountFieldProps): JSX.Element {
  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder="0"
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cx(
        'w-0 min-w-0 flex-1 text-ellipsis bg-transparent tabular-nums text-ink placeholder:text-ink-muted focus-visible:outline-none disabled:text-ink-secondary',
        amountSizeClass(value),
      )}
    />
  );
}

export interface SwapPanelProps {
  tone: 'surface' | 'muted';
  invalid?: boolean;
  children: ReactNode;
  className?: string;
}

/** One side of the swap. The "You sell" panel draws the focus ring for the field inside it. */
export function SwapPanel({ tone, invalid = false, children, className }: SwapPanelProps): JSX.Element {
  return (
    <div
      className={cx(
        'min-w-0 rounded-large border p-4 transition-colors duration-fast ease-standard',
        tone === 'surface'
          ? 'bg-surface has-[input:focus-visible]:outline has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus'
          : 'border-transparent bg-surface-muted',
        tone === 'surface' && (invalid ? 'border-danger' : 'border-border hover:border-border-strong'),
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The switch between the panels. A swap lets the two sides trade places; a Sleeve sell cannot, because a sell only
 * goes to USDG and buying is the rule's job. The control is shown, disabled, with the reason in text next to it.
 */
export function SwitchDivider({ noteId }: { noteId: string }): JSX.Element {
  return (
    <div className="relative -my-3.5 flex justify-center">
      <button
        type="button"
        disabled
        aria-label="Switch direction"
        aria-describedby={noteId}
        className="grid size-11 place-items-center rounded-row border-4 border-surface bg-surface-muted text-ink-secondary disabled:cursor-not-allowed"
      >
        <Glyph name="arrowDown" />
      </button>
    </div>
  );
}
