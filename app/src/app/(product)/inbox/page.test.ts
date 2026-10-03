import { describe, expect, it, vi } from 'vitest';

const redirect = vi.hoisted(() =>
  vi.fn((to: string): never => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
);

vi.mock('next/navigation', () => ({ redirect }));

import InboxPage from './page';

describe('/inbox', () => {
  it('sends old inbox links to Payments (D-024)', () => {
    expect(() => InboxPage()).toThrow('NEXT_REDIRECT /payments');
    expect(redirect).toHaveBeenCalledWith('/payments');
  });
});
