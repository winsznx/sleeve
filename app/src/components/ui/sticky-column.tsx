'use client';

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import { cx } from './cx';

/** The window height a pinned column leaves free: the 36 px sample data strip, 24 px above the column and 36 below. */
const ROOM_PX = 96;

/**
 * From 1280 px. A column that fits the window pins under the sample data strip; a taller one scrolls until its end
 * is in view and pins there, so its last part, often the main button, never sits out of reach while the column
 * beside it scrolls.
 */
const PIN = {
  top: 'xl:sticky xl:top-[calc(var(--sample-notice-height,0px)+1.5rem)] xl:self-start',
  bottom: 'xl:sticky xl:bottom-6 xl:self-end',
} as const;

type Pin = keyof typeof PIN;

export interface StickyColumnProps {
  children: ReactNode;
  className?: string;
}

/**
 * A grid column that holds its place beside a longer one from 1280 px, the way a swap card stays beside its quote.
 * It measures itself against the window, so a column taller than the window pins by its end instead of hiding it.
 * Before the first measure, and on the server, it stays in the normal flow, which is where it starts anyway.
 */
export function StickyColumn({ children, className }: StickyColumnProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pin, setPin] = useState<Pin | null>(null);

  // The column's height and the window's are layout the browser owns: measured on mount and whenever either changes.
  useEffect(() => {
    const column = ref.current;
    if (column === null) return;
    const measure = () => setPin(column.offsetHeight + ROOM_PX <= window.innerHeight ? 'top' : 'bottom');
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(column);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, []);

  return (
    <div ref={ref} data-pin={pin ?? undefined} className={cx('min-w-0', pin === null ? null : PIN[pin], className)}>
      {children}
    </div>
  );
}
