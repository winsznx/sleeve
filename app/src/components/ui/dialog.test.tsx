import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill, pressEscapeOn } from '../__tests__/dialog-polyfill';

import { Dialog } from './dialog';

beforeAll(() => {
  installDialogPolyfill();
});

function Harness({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Release waiting USDG
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Release 75.00 USDG to spend?"
        description="It stays in your account as USDG."
        actions={<button type="button">Release to spend</button>}
      >
        <p>Body text</p>
      </Dialog>
    </>
  );
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no dialog rendered');
  return dialog;
}

describe('Dialog', () => {
  it('stays closed until asked, then opens as a modal named by its title and described by its line', () => {
    render(<Harness />);
    expect(dialogElement().open).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Release waiting USDG' }));
    const dialog = dialogElement();
    expect(dialog.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Release 75.00 USDG to spend?' })).toBe(dialog);
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('It stays in your account as USDG.');
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('closes on Escape by asking the parent, and hands focus back to the opener', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Release waiting USDG' });
    opener.focus();
    fireEvent.click(opener);
    expect(dialogElement().contains(document.activeElement)).toBe(true);

    act(() => pressEscapeOn(dialogElement()));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogElement().open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes on a press that starts and ends on the scrim, never on one inside the panel', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release waiting USDG' }));
    const dialog = dialogElement();

    const body = screen.getByText('Body text');
    fireEvent.pointerDown(body);
    fireEvent.click(body);
    // Selecting text inside and letting go over the scrim must not close it either.
    fireEvent.pointerDown(body);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.open).toBe(false);
  });

  it('closes from its close button', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release waiting USDG' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialogElement().open).toBe(false);
  });

  it('brings the parent back in step when the browser closes it anyway', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Release waiting USDG' }));
    act(() => dialogElement().close());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
