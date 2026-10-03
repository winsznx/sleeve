'use client';

import { useEffect, useRef, type JSX, type ReactNode, type SyntheticEvent } from 'react';

import { cx } from '@/components/ui/cx';

import styles from './shell.module.css';

/**
 * A full-height sheet for the phone menu (docs/design/inspiration.md 4.5), built like components/ui/dialog.tsx: a
 * native <dialog> opened with showModal, so the page behind is inert and focus stays inside; Escape asks the parent
 * to close; focus goes back to the button that opened it; the page does not scroll underneath.
 */

export interface MenuSheetProps {
  open: boolean;
  onClose: () => void;
  /** The sheet's accessible name. */
  label: string;
  children: ReactNode;
  className?: string;
}

export function MenuSheet({ open, onClose, label, children, className }: MenuSheetProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);

  // Keeps the native dialog in step with the open prop: showModal and close are browser APIs outside React.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        opener.current = document.activeElement;
        dialog.showModal();
      }
      return;
    }
    if (!dialog.open) return;
    dialog.close();
    const target = opener.current;
    opener.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
  }, [open]);

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
    event.preventDefault();
    onClose();
  }

  function handleNativeClose() {
    if (open) onClose();
  }

  return (
    <dialog
      ref={ref}
      aria-label={label}
      aria-modal="true"
      onCancel={handleCancel}
      onClose={handleNativeClose}
      className={cx(
        styles.sheet,
        'fixed inset-0 z-overlay m-0 h-dvh max-h-none w-full max-w-none overflow-hidden bg-surface p-0 text-ink open:flex open:flex-col',
        className,
      )}
    >
      {open ? children : null}
    </dialog>
  );
}
