import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TOAST_AUTO_CLOSE_MS, ToastProvider, useToast, type ToastInput } from './toast';

function Trigger({ toast, label }: { toast: ToastInput; label: string }) {
  const api = useToast();
  return (
    <button type="button" onClick={() => api.show(toast)}>
      {label}
    </button>
  );
}

function renderWith(...toasts: { toast: ToastInput; label: string }[]) {
  return render(
    <ToastProvider>
      {toasts.map(({ toast, label }) => (
        <Trigger key={label} toast={toast} label={label} />
      ))}
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('toasts', () => {
  it('announces a confirmation politely and closes it after six seconds', () => {
    renderWith({ toast: { title: 'Rule saved' }, label: 'save' });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Rule saved');
    expect(region).toHaveAttribute('aria-live', 'polite');

    act(() => vi.advanceTimersByTime(TOAST_AUTO_CLOSE_MS - 1));
    expect(screen.queryByText('Rule saved')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Rule saved')).not.toBeInTheDocument();
  });

  it('pauses while hovered or focused and keeps the time that was left', () => {
    renderWith({ toast: { title: 'Card link copied' }, label: 'copy' });
    fireEvent.click(screen.getByRole('button', { name: 'copy' }));
    act(() => vi.advanceTimersByTime(4_000));

    const card = screen.getByText('Card link copied').closest('div[class*="shadow-floating"]');
    if (card === null) throw new Error('no toast card');
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText('Card link copied')).toBeInTheDocument();

    fireEvent.pointerLeave(card);
    act(() => vi.advanceTimersByTime(1_999));
    expect(screen.queryByText('Card link copied')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Card link copied')).not.toBeInTheDocument();
  });

  it('pauses while a control inside it has focus', () => {
    renderWith({ toast: { title: 'Rule saved' }, label: 'save' });
    fireEvent.click(screen.getByRole('button', { name: 'save' }));
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });
    act(() => dismiss.focus());
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByText('Rule saved')).toBeInTheDocument();
  });

  it('shows an error as an alert that stays until dismissed', () => {
    renderWith({ toast: { tone: 'danger', title: 'The release did not go through', body: 'Nothing moved.' }, label: 'fail' });
    fireEvent.click(screen.getByRole('button', { name: 'fail' }));
    expect(screen.getByRole('alert')).toHaveTextContent('The release did not go through');
    act(() => vi.advanceTimersByTime(10 * TOAST_AUTO_CLOSE_MS));
    expect(screen.getByRole('alert')).toHaveTextContent('The release did not go through');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('The release did not go through')).not.toBeInTheDocument();
  });

  it('keeps a toast that holds an action, and closes it once the action runs', () => {
    const undo = vi.fn();
    renderWith({ toast: { title: 'Rule paused', action: { label: 'Resume', onClick: undo } }, label: 'pause' });
    fireEvent.click(screen.getByRole('button', { name: 'pause' }));
    act(() => vi.advanceTimersByTime(10 * TOAST_AUTO_CLOSE_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Rule paused')).not.toBeInTheDocument();
  });

  it('shows one toast at a time: a new one replaces the old and gets a fresh clock', () => {
    renderWith({ toast: { title: 'First' }, label: 'one' }, { toast: { title: 'Second' }, label: 'two' });
    fireEvent.click(screen.getByRole('button', { name: 'one' }));
    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.click(screen.getByRole('button', { name: 'two' }));
    expect(screen.queryByText('First')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByText('Second')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByText('Second')).not.toBeInTheDocument();
  });

  it('fails loudly without a provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger toast={{ title: 'x' }} label="x" />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });
});
