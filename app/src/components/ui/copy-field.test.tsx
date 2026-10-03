import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyButton, CopyField, ShareButton } from './copy-field';

const ADDRESS = '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36';

/** jsdom has neither API; each test puts in the one it needs. */
function stubNavigator(key: 'clipboard' | 'share', value: unknown): void {
  Object.defineProperty(navigator, key, { value, configurable: true, writable: true });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(navigator, 'share');
  vi.useRealTimers();
});

describe('CopyButton', () => {
  it('copies the exact value, then says so for two seconds', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubNavigator('clipboard', { writeText });
    render(<CopyButton value={ADDRESS} label="Copy payment address" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy payment address' }));
    });
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole('status')).toHaveTextContent('Copied');

    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('says plainly when the clipboard refuses, so the person copies by hand', async () => {
    stubNavigator('clipboard', { writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    render(<CopyButton value={ADDRESS} label="Copy payment address" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy payment address' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed. Select the text and copy it.');
  });

  it('fails the same way where there is no clipboard at all', async () => {
    render(<CopyButton value={ADDRESS} label="Copy payment address" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy payment address' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed');
  });
});

describe('CopyField', () => {
  it('shows the whole value as text in a named group', () => {
    render(<CopyField label="Payment address" value={ADDRESS} copyLabel="Copy payment address" />);
    const group = screen.getByRole('group', { name: 'Payment address' });
    expect(group).toHaveTextContent(ADDRESS);
    expect(screen.getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
  });
});

describe('ShareButton', () => {
  it('renders nothing where the browser has no share sheet', () => {
    render(<ShareButton text={ADDRESS} label="Share payment address" />);
    expect(screen.queryByRole('button', { name: 'Share payment address' })).not.toBeInTheDocument();
  });

  it('hands the text to the share sheet and treats closing it as no error', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError'));
    stubNavigator('share', share);
    render(<ShareButton text={ADDRESS} title="Sleeve payment address" label="Share payment address" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share payment address' }));
    });
    expect(share).toHaveBeenCalledWith({ title: 'Sleeve payment address', text: ADDRESS });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('says so when sharing really fails', async () => {
    stubNavigator('share', vi.fn().mockRejectedValue(new Error('not allowed')));
    render(<ShareButton text={ADDRESS} label="Share payment address" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share payment address' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Sharing failed. Copy it instead.');
  });
});
