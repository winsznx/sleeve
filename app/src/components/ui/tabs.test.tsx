import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Tabs, type TabItem } from './tabs';

const ITEMS: TabItem<'receipts' | 'inbox' | 'holdings'>[] = [
  { id: 'receipts', label: 'Receipts', panel: <p>Receipt list</p> },
  { id: 'inbox', label: 'Inbox', panel: <p>Inbound transfers</p> },
  { id: 'holdings', label: 'Holdings', panel: <p>Stock Token holdings</p> },
];

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name });
}

describe('Tabs', () => {
  it('follows the tabs pattern: one selected tab in the tab order, its panel labelled by it', () => {
    render(<Tabs label="Activity" items={ITEMS} />);
    expect(screen.getByRole('tablist', { name: 'Activity' })).toBeInTheDocument();
    expect(tab('Receipts')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Receipts')).toHaveAttribute('tabindex', '0');
    expect(tab('Inbox')).toHaveAttribute('tabindex', '-1');
    const panel = screen.getByRole('tabpanel', { name: 'Receipts' });
    expect(panel).toHaveTextContent('Receipt list');
    expect(tab('Receipts')).toHaveAttribute('aria-controls', panel.id);
    expect(screen.getByText('Inbound transfers').closest('[role="tabpanel"]')).not.toBeVisible();
  });

  it('moves and selects with the arrow keys, wrapping at the ends, and jumps with Home and End', () => {
    render(<Tabs label="Activity" items={ITEMS} />);
    tab('Receipts').focus();
    fireEvent.keyDown(tab('Receipts'), { key: 'ArrowRight' });
    expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Inbox')).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: 'Inbox' })).toBeVisible();

    fireEvent.keyDown(tab('Inbox'), { key: 'End' });
    expect(tab('Holdings')).toHaveFocus();
    fireEvent.keyDown(tab('Holdings'), { key: 'ArrowRight' });
    expect(tab('Receipts')).toHaveFocus();
    fireEvent.keyDown(tab('Receipts'), { key: 'ArrowLeft' });
    expect(tab('Holdings')).toHaveFocus();
    fireEvent.keyDown(tab('Holdings'), { key: 'Home' });
    expect(tab('Receipts')).toHaveAttribute('aria-selected', 'true');
  });

  it('selects on click and reports the choice in controlled mode', () => {
    const onValueChange = vi.fn();
    function Controlled() {
      const [value, setValue] = useState<'receipts' | 'inbox' | 'holdings'>('inbox');
      return (
        <Tabs
          label="Activity"
          items={ITEMS}
          value={value}
          onValueChange={(next) => {
            onValueChange(next);
            setValue(next);
          }}
        />
      );
    }
    render(<Controlled />);
    expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tab('Holdings'));
    expect(onValueChange).toHaveBeenCalledWith('holdings');
    expect(tab('Holdings')).toHaveAttribute('aria-selected', 'true');
  });

  it('falls back to the first tab when the selected one goes away', () => {
    const { rerender } = render(<Tabs label="Activity" items={ITEMS} defaultValue="inbox" />);
    expect(tab('Inbox')).toHaveAttribute('aria-selected', 'true');
    rerender(<Tabs label="Activity" items={ITEMS.filter((item) => item.id !== 'inbox')} defaultValue="inbox" />);
    expect(tab('Receipts')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Receipts')).toHaveAttribute('tabindex', '0');
  });
});
