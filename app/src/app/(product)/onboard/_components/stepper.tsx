import type { JSX } from 'react';

import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';

export interface StepperItem {
  id: string;
  title: string;
  /** What the step is for while it is ahead, or what was chosen once it is done. */
  detail: string;
  state: 'done' | 'active' | 'upcoming';
  /** Opens a finished step again to change it. */
  onOpen?: () => void;
}

/**
 * closeout's stepper panel (docs/design/closeout-product-blueprint.md 9.3) for onboarding: numbered rows, because the
 * steps are a real sequence, the current one on the black gradient, finished ones with a check and what was chosen.
 * Below 1024 px it folds into one line of progress so the step's form comes first on a phone.
 */
export function Stepper({ items, label }: { items: readonly StepperItem[]; label: string }): JSX.Element {
  const activeIndex = items.findIndex((item) => item.state === 'active');
  const active = items[activeIndex];
  return (
    <>
      <div className="lg:hidden">
        <p className="text-body-s text-ink-secondary">
          Step {activeIndex + 1} of {items.length}
          {active === undefined ? null : <span className="font-semibold text-ink">: {active.title}</span>}
        </p>
        <div aria-hidden="true" className="mt-2 flex gap-1">
          {items.map((item) => (
            <span
              key={item.id}
              className={cx('h-1 flex-1 rounded-pill', item.state === 'upcoming' ? 'bg-surface-strong' : 'bg-brand')}
            />
          ))}
        </div>
      </div>
      <nav aria-label={label} className="hidden lg:block">
        <ol className="flex flex-col gap-1.5 rounded-large border border-border bg-surface p-2 shadow-card">
          {items.map((item, index) => {
            const number = String(index + 1).padStart(2, '0');
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-7 shrink-0 place-items-center rounded-control font-mono text-body-s',
                    item.state === 'active' && 'bg-surface/20 text-on-brand',
                    item.state === 'done' && 'bg-success-soft text-success',
                    item.state === 'upcoming' && 'border border-border bg-surface text-ink-muted',
                  )}
                >
                  {item.state === 'done' ? <Icon name="check" className="size-4" /> : number}
                </span>
                <span className="min-w-0 flex-1 text-left">
                  <span className={cx('block text-body font-medium', item.state === 'active' ? 'text-on-brand' : 'text-ink')}>
                    {item.title}
                  </span>
                  <span
                    className={cx(
                      'mt-0.5 block break-words text-body-s',
                      item.state === 'active' ? 'text-on-brand' : item.state === 'done' ? 'text-ink-secondary' : 'text-ink-muted',
                    )}
                  >
                    {item.detail}
                  </span>
                </span>
              </>
            );
            const look = cx(
              'flex w-full items-start gap-3 rounded-panel px-4 py-3 transition-colors duration-standard ease-standard',
              item.state === 'active' && 'bg-gradient-to-br from-brand to-brand-strong',
            );
            return (
              <li key={item.id} aria-current={item.state === 'active' ? 'step' : undefined}>
                {item.state === 'done' && item.onOpen !== undefined ? (
                  <button type="button" onClick={item.onOpen} className={cx(look, 'hover:bg-surface-muted')}>
                    {body}
                    <span className="sr-only">, change it</span>
                  </button>
                ) : (
                  <div className={look}>{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
