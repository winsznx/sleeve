'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type JSX, type ReactNode } from 'react';

import { cx } from '@/components/ui/cx';
import { Dialog } from '@/components/ui/dialog';

import styles from './shell.module.css';
import { POPOVER_QUERY, useMediaQuery } from './use-browser';

/**
 * A button that shows a panel: anchored under the button from 768 px, a bottom sheet below. The anchored panel is a
 * disclosure, not a modal: focus stays on the button, Tab walks into the panel, and Escape, a press outside or focus
 * leaving both closes it, Escape returning focus to the button. The sheet is the app's Dialog, which traps focus and
 * returns it. Callers pass `children` as a function to close the panel from inside, after following a link.
 */

export interface PopoverProps {
  /** The panel's name, and the sheet's title on a phone. */
  title: string;
  /** What the button shows. */
  button: ReactNode;
  /** The button's accessible name when its visible content is not the whole story. */
  buttonLabel?: string;
  buttonClassName: string;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Which edge of the button the panel lines up with. */
  align?: 'start' | 'end';
  /** Width of the anchored panel, such as w-[26rem]. */
  panelClassName?: string;
  className?: string;
}

export function Popover({
  title,
  button,
  buttonLabel,
  buttonClassName,
  children,
  align = 'end',
  panelClassName,
  className,
}: PopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const anchored = useMediaQuery(POPOVER_QUERY);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const close = (): void => setOpen(false);

  // While the anchored panel is open, the document's Escape key and presses outside it are outside React's tree.
  useEffect(() => {
    if (!open || !anchored) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && wrapper.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchored]);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!anchored || !open) return;
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    // Focus left for something else on the page; a press outside is handled on pointerdown.
    if (next !== null) setOpen(false);
  }

  const content = typeof children === 'function' ? children(close) : children;

  return (
    <div ref={wrapper} className={cx('relative', className)} onBlur={handleBlur}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={open && anchored ? panelId : undefined}
        aria-haspopup={anchored ? undefined : 'dialog'}
        aria-label={buttonLabel}
        onClick={() => setOpen((current) => !current)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && anchored ? (
        <div
          id={panelId}
          role="group"
          aria-label={title}
          className={cx(
            styles.popover,
            'absolute top-full z-header mt-2 max-h-[min(36rem,calc(100dvh-7rem))] overflow-y-auto overscroll-contain rounded-large border border-border bg-surface shadow-overlay',
            align === 'end' ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {content}
        </div>
      ) : null}
      {anchored ? null : (
        <Dialog open={open} onClose={close} title={title}>
          {content}
        </Dialog>
      )}
    </div>
  );
}
