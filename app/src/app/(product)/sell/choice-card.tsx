import { useId, type JSX, type ReactNode } from 'react';

import { cx } from '@/components/ui/cx';

export interface ChoiceCardProps {
  /** Shared by every card in one group, so arrow keys move between them. */
  name: string;
  value: string;
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  /** The option's name: the radio's accessible name, kept short. */
  title: ReactNode;
  /** Quiet text on the right of the title, such as a value or a lot number. Read as part of the description. */
  aside?: ReactNode;
  /** Lines under the title. Read as the radio's description. */
  children?: ReactNode;
}

function describedBy(...ids: (string | null)[]): string | undefined {
  const present = ids.filter((id): id is string => id !== null);
  return present.length === 0 ? undefined : present.join(' ');
}

/**
 * One exclusive choice as a row card (docs/DESIGN.md 11.4 row cards, 11.5 choices): a native radio, so the browser
 * supplies the group semantics and arrow keys, with the label stretched over the whole card so any tap selects it.
 * Black marks the selection, as everywhere in Sleeve. The kit has no radio card yet, so this one lives with the sell
 * screen; block content such as the debt security line sits outside the label, which allows phrasing content only.
 */
export function ChoiceCard({ name, value, checked, onSelect, disabled = false, title, aside, children }: ChoiceCardProps): JSX.Element {
  const id = useId();
  const asideId = `${id}-aside`;
  const detailId = `${id}-detail`;
  return (
    <div
      className={cx(
        'relative flex items-start gap-3 rounded-row border bg-surface p-4 transition-colors duration-fast ease-standard',
        checked ? 'border-brand shadow-card' : 'border-border hover:border-border-strong',
        disabled && 'opacity-disabled',
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-describedby={describedBy(aside === undefined ? null : asideId, children === undefined ? null : detailId)}
        className="mt-1 size-5 shrink-0 cursor-pointer disabled:cursor-not-allowed"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <label
            htmlFor={id}
            className={cx('min-w-0 after:absolute after:inset-0 after:rounded-row', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}
          >
            {title}
          </label>
          {aside === undefined ? null : (
            <span id={asideId} className="text-body-s text-ink-secondary">
              {aside}
            </span>
          )}
        </div>
        {children === undefined ? null : (
          <div id={detailId} className="mt-0.5">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
