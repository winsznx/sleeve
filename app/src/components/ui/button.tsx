'use client';

import Link from 'next/link';
import type { ComponentPropsWithRef, JSX, MouseEvent, ReactNode } from 'react';

import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-styles';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export type { ButtonSize, ButtonVariant };

interface ButtonLookProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The main action of a flow on a phone spans the content width. */
  fullWidth?: boolean;
  /** A leading icon. Decorative: the label names the action. */
  icon?: IconName;
}

export interface ButtonProps extends ButtonLookProps, ComponentPropsWithRef<'button'> {
  /**
   * The action is running. The button keeps its width, sets aria-busy, ignores clicks and shows busyLabel, the
   * verb in progress ("Releasing"). It stays focusable, so focus is never lost mid-action.
   */
  busy?: boolean;
  busyLabel?: string;
}

/**
 * Both labels share one grid cell, so the button is as wide as the longer one and never jumps. The one not in use
 * is invisible and aria-hidden, so the button's name is always the label on screen.
 */
function Label({ children, busy, busyLabel }: { children: ReactNode; busy: boolean; busyLabel: string | undefined }) {
  if (busyLabel === undefined) return <span>{children}</span>;
  return (
    <span className="grid">
      <span aria-hidden={busy || undefined} className={cx('col-start-1 row-start-1', busy && 'invisible')}>
        {children}
      </span>
      <span aria-hidden={!busy || undefined} className={cx('col-start-1 row-start-1', !busy && 'invisible')}>
        {busyLabel}
      </span>
    </span>
  );
}

export function Button({
  variant,
  size,
  fullWidth,
  icon,
  busy = false,
  busyLabel,
  className,
  children,
  type = 'button',
  onClick,
  ...rest
}: ButtonProps): JSX.Element {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (busy) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      {...rest}
      type={type}
      aria-busy={busy || undefined}
      aria-disabled={busy ? true : rest['aria-disabled']}
      onClick={handleClick}
      className={buttonClasses({ variant, size, fullWidth, className })}
    >
      {icon === undefined ? null : <Icon name={icon} />}
      <Label busy={busy} busyLabel={busyLabel}>
        {children}
      </Label>
    </button>
  );
}

export interface ButtonLinkProps extends ButtonLookProps, Omit<ComponentPropsWithRef<'a'>, 'href'> {
  href: string;
}

/** A link that looks like a button: navigation, never an action. Internal paths use next/link. */
export function ButtonLink({ href, variant, size, fullWidth, icon, className, children, ...rest }: ButtonLinkProps): JSX.Element {
  const classes = buttonClasses({ variant, size, fullWidth, className });
  const content = (
    <>
      {icon === undefined ? null : <Icon name={icon} />}
      <span>{children}</span>
    </>
  );
  if (/^https?:\/\//.test(href)) {
    return (
      <a {...rest} href={href} className={classes}>
        {content}
      </a>
    );
  }
  return (
    <Link {...rest} href={href} className={classes}>
      {content}
    </Link>
  );
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children' | 'aria-label'> {
  icon: IconName;
  /** The accessible name. Also shown as a tooltip. */
  label: string;
}

/** A 44 px ghost button that shows only an icon (11.1). It always carries an accessible name. */
export function IconButton({ icon, label, className, type = 'button', ...rest }: IconButtonProps): JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex size-touch shrink-0 items-center justify-center rounded-control text-ink-secondary transition-colors duration-fast ease-standard hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-disabled',
        className,
      )}
    >
      <Icon name={icon} />
    </button>
  );
}
