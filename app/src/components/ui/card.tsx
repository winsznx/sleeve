import type { HTMLAttributes, JSX, ReactNode } from 'react';

import { cx } from './cx';
import { Icon, type IconName } from './icons';

/**
 * Bounded surfaces (docs/DESIGN.md 11.3). A module is the default app card. Only a card that is one selectable
 * object is elevated; lists never are. Nest one step at a time: surface cards on canvas, surface-muted panels
 * inside them, never surface-muted inside surface-muted.
 */

type CardElement = 'section' | 'div' | 'article' | 'li';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  /** surface-muted: stat tiles and the spend sleeve. */
  tone?: 'surface' | 'muted';
  /** shadow-card, for a card that is one object you open. */
  elevated?: boolean;
  /** p-card (16 px, 20 px from 768). Turn off for edge-to-edge content such as a ruled list. */
  padded?: boolean;
}

export function Card({
  as: Element = 'section',
  tone = 'surface',
  elevated = false,
  padded = true,
  className,
  children,
  ...rest
}: CardProps): JSX.Element {
  return (
    <Element
      {...rest}
      className={cx(
        'min-w-0 rounded-module border border-border',
        tone === 'muted' ? 'bg-surface-muted' : 'bg-surface',
        elevated && 'shadow-card',
        padded && 'p-card',
        className,
      )}
    >
      {children}
    </Element>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  /** h2 inside a page section, h3 inside a card that already sits under an h2. */
  headingLevel?: 2 | 3;
  /** Quiet text or a link on the right, such as a count or "See all". */
  aside?: ReactNode;
  className?: string;
}

/** A module's title row, closeout's dash-module-head: text-h3 title, meta on the right, 16 px below. */
export function CardHeader({ title, headingLevel = 2, aside, className }: CardHeaderProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={cx('mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1', className)}>
      <Heading className="text-h3 text-ink">{title}</Heading>
      {aside === undefined ? null : <div className="text-body-s text-ink-muted">{aside}</div>}
    </div>
  );
}

export interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  headingLevel?: 2 | 3;
  /** A link or small button on the right of the header. */
  action?: ReactNode;
}

/** A panel with an optional ruled header, for content that runs edge to edge under a title. */
export function Panel({ title, headingLevel = 2, action, className, children, ...rest }: PanelProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section {...rest} className={cx('min-w-0 overflow-hidden rounded-panel border border-border bg-surface', className)}>
      {title === undefined ? null : (
        <header className="flex min-h-touch items-center justify-between gap-3 border-b border-border px-4 py-3">
          <Heading className="text-h3 text-ink">{title}</Heading>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export interface StatTileProps {
  label: ReactNode;
  /** Usually an Amount. Never render 0.00 while it loads: pass a Skeleton instead. */
  value: ReactNode;
  icon?: IconName;
  /** A line under the value: a plain explanation or a link. */
  footer?: ReactNode;
  className?: string;
}

/** closeout's dash-stat: a muted tile with an icon tile, a label and a figure. */
export function StatTile({ label, value, icon, footer, className }: StatTileProps): JSX.Element {
  return (
    <div className={cx('flex min-w-0 flex-col rounded-module border border-border bg-surface-muted p-4', className)}>
      <div className="flex items-start gap-3">
        {icon === undefined ? null : (
          <span className="grid size-icon-tile shrink-0 place-items-center rounded-row bg-surface text-ink-secondary">
            <Icon name={icon} />
          </span>
        )}
        <div className="min-w-0">
          <div className="text-body-s text-ink-secondary">{label}</div>
          <div className="mt-0.5 text-figure-m tabular-nums text-ink">{value}</div>
        </div>
      </div>
      {footer === undefined ? null : <div className="mt-3 text-body-s text-ink-secondary">{footer}</div>}
    </div>
  );
}

export interface CalloutProps {
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** A calm note on green-50 with a green hairline: setup facts, how something works. Never success. */
export function Note({ title, children, className }: CalloutProps): JSX.Element {
  return (
    <div className={cx('flex gap-3 rounded-row border border-accent-border bg-info-soft p-4', className)}>
      <Icon name="info" className="mt-px text-info" />
      <div className="min-w-0 text-body-s">
        {title === undefined ? null : <div className="font-semibold text-ink">{title}</div>}
        {children === undefined ? null : <div className={cx('text-ink-secondary', title !== undefined && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

/** An amber banner for something the owner should know before acting, such as an action that spends unsorted USDG. */
export function Banner({ title, children, className }: CalloutProps): JSX.Element {
  return (
    <div className={cx('flex gap-3 rounded-row bg-warning-soft p-4', className)}>
      <Icon name="alert" className="mt-px text-warning" />
      <div className="min-w-0 text-body-s">
        {title === undefined ? null : <div className="font-semibold text-ink">{title}</div>}
        {children === undefined ? null : <div className={cx('text-ink-secondary', title !== undefined && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  );
}

/** The error state line PRD 15 asks for when an owner action fails. */
export const FUNDS_STILL_HERE = 'Nothing moved. Your USDG is still in your account.';

export interface ErrorBlockProps {
  /** What failed, in plain words: "The release did not go through". */
  title: ReactNode;
  /** Why, when it is known, and what to do next. */
  children?: ReactNode;
  /** Adds the line that nothing moved and the USDG is still in the account. Use it for failed owner actions. */
  fundsStillHere?: boolean;
  /** Usually a secondary "Try again" button. */
  action?: ReactNode;
  className?: string;
}

/** closeout's workspace error: a red symbol tile, what failed, what to do. Announced as an alert. */
export function ErrorBlock({ title, children, fundsStillHere = false, action, className }: ErrorBlockProps): JSX.Element {
  return (
    <div role="alert" className={cx('flex gap-4 rounded-module border border-border bg-surface p-5', className)}>
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-row bg-danger-soft font-semibold text-danger">
        !
      </span>
      <div className="min-w-0">
        <div className="text-h3 text-ink">{title}</div>
        {children === undefined ? null : <div className="mt-1.5 break-words text-body-s text-ink-secondary">{children}</div>}
        {fundsStillHere ? <p className="mt-1.5 text-body-s text-ink-secondary">{FUNDS_STILL_HERE}</p> : null}
        {action === undefined ? null : <div className="mt-4 flex flex-wrap items-center gap-3">{action}</div>}
      </div>
    </div>
  );
}
