/**
 * jsdom has no showModal or close on <dialog>. Tests install this stand-in, which toggles the open attribute and
 * fires close the way a browser does. It cannot make the rest of the page inert, so focus trapping is checked
 * in a real browser, not here.
 */
export function installDialogPolyfill(): void {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal === 'function') return;
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
    const first = this.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    first?.focus();
  };
  proto.show = function show(this: HTMLDialogElement): void {
    this.setAttribute('open', '');
  };
  proto.close = function close(this: HTMLDialogElement): void {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

/** What a browser does on Escape: a cancelable cancel event, then close unless it was prevented. */
export function pressEscapeOn(dialog: HTMLDialogElement): void {
  const cancel = new Event('cancel', { cancelable: true });
  dialog.dispatchEvent(cancel);
  if (!cancel.defaultPrevented) dialog.close();
}
