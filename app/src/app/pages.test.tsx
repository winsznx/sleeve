import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SiteFooter } from '@/components/site-footer';
import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import { DISCLAIMER } from '@/lib/copy';

import ReceiptPage from './(product)/receipts/[id]/page';
import VerifyReceiptPage from './(public)/verify/[id]/page';

describe('route stubs', () => {
  it('renders a receipt heading for a valid id', async () => {
    const page = await ReceiptPage({ params: Promise.resolve({ id: '455' }) });
    render(<DataLayerProvider dataLayer={createMockDataLayer()}>{page}</DataLayerProvider>);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toContain('455');
  });

  it('answers not found for an id that is not a receipt id', async () => {
    await expect(VerifyReceiptPage({ params: Promise.resolve({ id: '0x1c7' }) })).rejects.toThrow();
  });
});

describe('site footer', () => {
  it('carries the disclaimer word for word', () => {
    render(<SiteFooter />);
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument();
  });
});
