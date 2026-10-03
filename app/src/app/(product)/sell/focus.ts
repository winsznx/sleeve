import { useCallback, useMemo, useRef } from 'react';

export interface FocusOnArrival {
  /** Call in the event handler whose result will replace the control that was just used. */
  request: () => void;
  /** Ref for the element that should take focus when it next mounts, usually a heading with tabIndex -1. */
  target: (node: HTMLElement | null) => void;
}

/**
 * Sends focus to what an action produced: the quote after "Get a quote", the result after "Sell". The control the
 * person used often unmounts on the way, so without this focus would fall back to the page and a screen reader
 * would hear nothing. A ref callback runs when the node arrives, so no Effect is needed. Focusing waits one task,
 * because a dialog closing in the same commit leaves the top layer only in its own effect, and focus cannot enter
 * an inert page before that.
 */
export function useFocusOnArrival(): FocusOnArrival {
  const pending = useRef(false);
  const request = useCallback(() => {
    pending.current = true;
  }, []);
  const target = useCallback((node: HTMLElement | null) => {
    if (node === null || !pending.current) return;
    pending.current = false;
    window.setTimeout(() => {
      if (node.isConnected) node.focus();
    }, 0);
  }, []);
  return useMemo(() => ({ request, target }), [request, target]);
}
