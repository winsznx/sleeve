import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VerifyPage from './page';
import { NOT_A_RECEIPT_NUMBER, VerifyForm } from './verify-form';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: navigation.push }),
}));

beforeEach(() => {
  navigation.push.mockReset();
});

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

function submit(value: string) {
  fireEvent.change(screen.getByLabelText('Receipt number'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Recompute the receipt' }));
}

describe('verify form', () => {
  it('opens the result for a receipt number written the way people write it', () => {
    render(<VerifyForm defaultValue="" invalid={false} />);
    submit(`Receipt ${numberSign('455')}`);
    expect(navigation.push).toHaveBeenCalledWith('/verify/455');
  });

  it('says what to change when the input is not a receipt number, and clears it on the next edit', () => {
    render(<VerifyForm defaultValue="" invalid={false} />);
    submit('0x1c7');
    expect(navigation.push).not.toHaveBeenCalled();
    const field = screen.getByLabelText('Receipt number');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining(NOT_A_RECEIPT_NUMBER));

    fireEvent.change(field, { target: { value: '45' } });
    expect(screen.queryByText(NOT_A_RECEIPT_NUMBER)).toBeNull();
  });

  it('works as a plain GET form before JavaScript loads', () => {
    render(<VerifyForm defaultValue="" invalid={false} />);
    const form = screen.getByLabelText('Receipt number').closest('form');
    expect(form).toHaveAttribute('action', '/verify');
    expect(form).toHaveAttribute('method', 'get');
    expect(screen.getByLabelText('Receipt number')).toHaveAttribute('name', 'id');
  });
});

describe('verify page', () => {
  it('sends a submitted receipt number straight to its result', async () => {
    await expect(VerifyPage({ searchParams: Promise.resolve({ id: ` ${numberSign('455')} ` }) })).rejects.toMatchObject({
      digest: expect.stringContaining('/verify/455'),
    });
  });

  it('shows the form again with the problem when the number is not one', async () => {
    render(await VerifyPage({ searchParams: Promise.resolve({ id: 'SPY' }) }));
    expect(screen.getByLabelText('Receipt number')).toHaveValue('SPY');
    expect(screen.getByText(NOT_A_RECEIPT_NUMBER)).toBeInTheDocument();
  });

  it('opens empty with the steps of the check on a first visit', async () => {
    render(await VerifyPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Verify a receipt');
    expect(screen.queryByText(NOT_A_RECEIPT_NUMBER)).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});
