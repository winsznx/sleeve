import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';

import { installDialogPolyfill, pressEscapeOn } from '../__tests__/dialog-polyfill';

import { MenuSheet } from './menu-sheet';

beforeAll(() => {
  installDialogPolyfill();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* jsdom decides :focus-visible from the last key or mouse event, so the click a browser sends after Enter
          would read as a pointer here. A keyboard user is modelled by opening on Enter's keydown. */}
      <button
        type="button"
        aria-label="Open the menu"
        onClick={() => setOpen(true)}
        onKeyDown={(event) => event.key === 'Enter' && setOpen(true)}
      />
      <MenuSheet open={open} onClose={() => setOpen(false)} label="Menu">
        <button type="button">Product</button>
      </MenuSheet>
    </>
  );
}

function sheet(): HTMLDialogElement {
  const dialog = document.querySelector('dialog');
  if (dialog === null) throw new Error('no sheet rendered');
  return dialog;
}

describe('MenuSheet', () => {
  it('opens from a tap onto the sheet itself, so its first control shows no ring', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    expect(sheet()).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Product' })).not.toHaveFocus();
  });

  it('opens from the keyboard onto its first control, and hands focus back to the menu button on Escape', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open the menu' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Product' })).toHaveFocus();

    act(() => pressEscapeOn(sheet()));
    expect(sheet().open).toBe(false);
    expect(trigger).toHaveFocus();
  });
});
