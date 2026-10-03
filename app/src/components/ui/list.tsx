import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { cx } from './cx';

/**
 * Registers (docs/DESIGN.md 11.4). A ruled list is a white panel with hairlines between rows and no shadow, as
 * in closeout's closeouts and directory lists. Below 768 px Sleeve never uses a table; rows and definition lists
 * carry the same information.
 */

export interface ListProps {
  children: ReactNode;
  /** Names the list for screen readers when no heading sits right above it. */
  label?: string;
  className?: string;
}

export function List({ children, label, className }: ListProps): JSX.Element {
  return (
    <ul aria-label={label} className={cx('overflow-hidden rounded-panel border border-border bg-surface', className)}>
      {children}
    </ul>
  );
}

export interface ListRowProps {
  /** A status tag or an icon tile. */
  leading?: ReactNode;
  title: ReactNode;
  /** Quiet second line: time, sender, receipt number. */
  meta?: ReactNode;
  /** The amount, set in tabular figures on the right. */
  trailing?: ReactNode;
  /** A quiet line under the amount. */
  trailingMeta?: ReactNode;
  /**
   * Makes the row open something. The title becomes the link and its hit area covers the whole row, so the
   * link's name stays short while the row stays one target. The focus ring is drawn inside the row because
   * the list clips.
   */
  href?: string;
  /** Content under the main line, such as a thin split rail. */
  children?: ReactNode;
  className?: string;
}

export function ListRow({ leading, title, meta, trailing, trailingMeta, href, children, className }: ListRowProps): JSX.Element {
  return (
    <li
      className={cx(
        'relative border-t border-border px-4 py-3.5 first:border-t-0 md:px-5 md:py-4',
        href !== undefined && 'transition-colors duration-fast ease-standard hover:bg-surface-muted',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {leading === undefined ? null : <div className="shrink-0 pt-0.5">{leading}</div>}
        <div className="min-w-0 flex-1">
          <div className="break-words text-body font-medium text-ink">
            {href === undefined ? (
              title
            ) : (
              <Link
                href={href}
                className="after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-focus"
              >
                {title}
              </Link>
            )}
          </div>
          {meta === undefined ? null : <div className="mt-0.5 break-words text-body-s text-ink-muted">{meta}</div>}
        </div>
        {trailing === undefined && trailingMeta === undefined ? null : (
          <div className="shrink-0 text-right">
            {trailing === undefined ? null : <div className="text-body font-semibold tabular-nums text-ink">{trailing}</div>}
            {trailingMeta === undefined ? null : <div className="mt-0.5 text-body-s text-ink-muted">{trailingMeta}</div>}
          </div>
        )}
      </div>
      {children}
    </li>
  );
}

export interface DefinitionItem {
  /** React key; defaults to the position. */
  id?: string;
  term: ReactNode;
  value: ReactNode;
  /** Machine values (addresses, hashes, ids, raw units): IBM Plex Mono, wrapping anywhere. */
  mono?: boolean;
  /** The value comes from logs, not from the receipt (PRD 10). Adds the word after the term. */
  derived?: boolean;
}

/** Receipt fields: term over value below 768, side by side above, a hairline between rows. */
export function DefinitionList({ items, className }: { items: readonly DefinitionItem[]; className?: string }): JSX.Element {
  return (
    <dl className={cx('divide-y divide-border', className)}>
      {items.map((item, index) => (
        <div key={item.id ?? index} className="py-3 md:grid md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-4">
          <dt className="text-body-s text-ink-secondary">
            {item.term}
            {item.derived ? <span className="text-ink-muted"> (derived)</span> : null}
          </dt>
          <dd className={cx('mt-0.5 min-w-0 text-body-s text-ink md:mt-0', item.mono ? 'break-all font-mono text-mono-s' : 'break-words')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
