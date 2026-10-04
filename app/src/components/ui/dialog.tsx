'use client';

import { useEffect, useId, useRef, type JSX, type MouseEvent, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react';

import { IconButton } from './button';
import { cx } from './cx';
import { returnFocus, showModalFrom, type DialogOpener } from './dialog-focus';
import styles from './motion.module.css';

/**
 * Sheets and dialogs (docs/DESIGN.md 11.10), one component. Below 768 px it is a bottom sheet, from 768 a centered
 * dialog. It is a native <dialog> opened with showModal(), so the page behind it is inert, it sits in the top
 * layer above every z-index, and Escape asks it to close. The dialog element is the scrim; the panel inside it is
 * what a person reads. A tap opens it with no focus ring on the close button (dialog-focus.ts). It closes on
 * Escape, on the scrim and on its close button, and focus goes back to the control that opened it.
 */

export interface DialogProps {
  open: boolean;
  /** Called for Escape, a click on the scrim and the close button. Set open to false in it. */
  onClose: () => void;
  /** The dialog's name, shown as its text-h2 heading. */
  title: ReactNode;
  /** One line under the title. A confirmation says what moves, where it goes, and that it stays in the account. */
  description?: ReactNode;
  children?: ReactNode;
  /**
   * Buttons at the bottom. Put the primary action last: on a phone they stack full width with it at the bottom,
   * from 768 they sit in a row with it on the right.
   */
  actions?: ReactNode;
  /** Accessible name of the close button. Default "Close". */
  closeLabel?: string;
}

export function Dialog({ open, onClose, title, description, children, actions, closeLabel = 'Close' }: DialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<DialogOpener | null>(null);
  const pressStartedOnScrim = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  // Keeps the native dialog in step with the open prop: showModal and close are a browser API outside React.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open) {
      delete dialog.dataset.state;
      if (!dialog.open) opener.current = showModalFrom(dialog);
      return;
    }

    if (!dialog.open) return;
    // Close at once, so the page is live again (focus, clicks and announcements, such as a toast confirming the
    // action) while the closing state keeps the sheet painted, without pointer events, for its exit animation.
    dialog.dataset.state = 'closing';
    dialog.close();
    returnFocus(opener.current);
    opener.current = null;

    const leaving = typeof dialog.getAnimations === 'function' ? dialog.getAnimations({ subtree: true }) : [];
    let cancelled = false;
    const settle = () => {
      if (!cancelled) delete dialog.dataset.state;
    };
    if (leaving.length === 0) settle();
    else Promise.allSettled(leaving.map((animation) => animation.finished)).then(settle, settle);
    return () => {
      cancelled = true;
    };
  }, [open]);

  // While it is open the page behind must not scroll under a finger or a wheel.
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, [open]);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape: the parent owns the open state, so ask it to close instead of letting the browser do it.
    event.preventDefault();
    onClose();
  }

  function handleNativeClose() {
    // A close the browser forced anyway, such as a second Escape. Bring the parent's state back in step.
    if (open) onClose();
  }

  function handlePointerDown(event: PointerEvent<HTMLDialogElement>) {
    pressStartedOnScrim.current = event.target === event.currentTarget;
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    // Only a press that starts and ends on the scrim closes, so selecting text inside never does.
    const onScrim = event.target === event.currentTarget;
    if (onScrim && pressStartedOnScrim.current) onClose();
    pressStartedOnScrim.current = false;
  }

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      aria-modal="true"
      tabIndex={-1}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className={cx(
        styles.scrim,
        'fixed inset-0 z-overlay m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-scrim p-0 text-ink backdrop:bg-transparent focus-visible:outline-none open:flex open:items-end open:justify-center md:open:items-center md:open:px-gutter',
        'data-[state=closing]:pointer-events-none data-[state=closing]:flex data-[state=closing]:items-end data-[state=closing]:justify-center md:data-[state=closing]:items-center md:data-[state=closing]:px-gutter',
      )}
    >
      <div
        className={cx(
          styles.panel,
          'flex max-h-sheet w-full flex-col overflow-y-auto overscroll-contain rounded-t-sheet bg-surface p-card pb-[calc(var(--layout-card-padding)_+_env(safe-area-inset-bottom))] shadow-overlay md:max-w-dialog md:rounded-card md:p-6',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="pt-1.5 text-h2 text-ink">
            {title}
          </h2>
          <IconButton icon="close" label={closeLabel} onClick={onClose} className="-mr-2 -mt-0.5" />
        </div>
        {description === undefined ? null : (
          <div id={descriptionId} className="mt-1 text-body text-ink-secondary">
            {description}
          </div>
        )}
        {children === undefined ? null : <div className="mt-4 min-w-0">{children}</div>}
        {actions === undefined ? null : (
          <div className="mt-6 flex flex-col gap-2.5 md:flex-row md:justify-end [&>*]:w-full md:[&>*]:w-auto">{actions}</div>
        )}
      </div>
    </dialog>
  );
}
