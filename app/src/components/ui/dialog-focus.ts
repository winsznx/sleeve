// TypeScript's DOM types do not have focusVisible yet. Safari 18.4, Chrome 145 and Firefox 104 support it.
declare global {
  interface FocusOptions {
    focusVisible?: boolean;
  }
}

/** What had focus when a dialog opened, and whether it showed a focus ring then. */
export interface DialogOpener {
  element: Element | null;
  ring: boolean;
}

/**
 * showModal for Sleeve's dialogs and sheets. The browser focuses the first control inside, and WebKit draws that
 * control's ring even when a tap opened the dialog, so on an iPhone every sheet opened with a green outline on its
 * first button. A ring on whatever had focus is how the browser says the person is on a keyboard: then the first
 * control keeps focus and its ring. Otherwise the dialog element takes focus itself, which draws nothing, and a
 * screen reader still reads the dialog's name.
 */
export function showModalFrom(dialog: HTMLDialogElement): DialogOpener {
  const element = document.activeElement;
  const ring = element?.matches(':focus-visible') ?? false;
  dialog.showModal();
  if (!ring) dialog.focus({ preventScroll: true, focusVisible: false });
  return { element, ring };
}

/** Sends focus back to what had it before the dialog opened, with a ring only if it had one then. */
export function returnFocus(opener: DialogOpener | null, options: FocusOptions = {}): void {
  if (opener === null) return;
  const { element, ring } = opener;
  if (element instanceof HTMLElement && element.isConnected) element.focus({ ...options, focusVisible: ring });
}
