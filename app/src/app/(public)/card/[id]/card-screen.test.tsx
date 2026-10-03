import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockDataLayer, SAMPLE_CARD_IDS } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { renderCardPng } from './card-image';
import CardPage from './page';
import { CardScreen } from './card-screen';

vi.mock('./card-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./card-image')>()),
  renderCardPng: vi.fn(),
}));

const drawCard = vi.mocked(renderCardPng);

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:card' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
});

afterEach(() => {
  drawCard.mockReset();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'canShare');
  vi.restoreAllMocks();
});

function renderCard(cardId: string, layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <CardScreen cardId={cardId} />
    </DataLayerProvider>,
  );
}

function shownValue(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: 'dt' });
  const dd = dt.nextElementSibling;
  if (!(dd instanceof HTMLElement)) throw new Error(`no value for ${term}`);
  return dd;
}

describe('shared card', () => {
  it('shows the drawn PNG with the whole card as its text, ready to download', async () => {
    drawCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderCard(SAMPLE_CARD_IDS.receipt);

    const image = await screen.findByRole('img');
    expect(image).toHaveAttribute('src', 'blob:card');
    expect(image.getAttribute('alt')).toContain('10% of my pay became SPY');
    expect(image.getAttribute('alt')).toContain(DEBT_SECURITY_LINE);
    const download = screen.getByRole('link', { name: 'Download PNG' });
    expect(download).toHaveAttribute('href', 'blob:card');
    expect(download).toHaveAttribute('download', 'sleeve-receipt-card.png');
  });

  it('keeps amounts and the account off a default card and says so', async () => {
    drawCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderCard(SAMPLE_CARD_IDS.receipt);
    await screen.findByRole('img');
    expect(shownValue('Amounts')).toHaveTextContent('Hidden by the owner.');
    expect(shownValue('Receipt numbers and account')).toHaveTextContent('Nothing on this card leads to the account onchain.');
    expect(screen.queryByRole('link', { name: /Recompute receipt/ })).toBeNull();
  });

  it('links every receipt a proof card names to the verifier', async () => {
    drawCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    renderCard(SAMPLE_CARD_IDS.week);
    await screen.findByRole('img');
    const links = within(shownValue('Receipt numbers and account')).getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/verify/455', '/verify/560', '/verify/611', '/verify/642']);
    expect(shownValue('The week')).toHaveTextContent('Monday to Sunday in New York time');
  });

  it('shows the card as text where the browser cannot draw it', async () => {
    drawCard.mockRejectedValue(new Error('no canvas'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderCard(SAMPLE_CARD_IDS.receipt);

    expect(await screen.findByText('This browser could not draw the image', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('of my pay became SPY')).toBeInTheDocument();
    expect(screen.getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download PNG' })).toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it('shares the image itself where the browser can share files', async () => {
    drawCard.mockResolvedValue(new Blob(['png'], { type: 'image/png' }));
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    renderCard(SAMPLE_CARD_IDS.receipt);

    const shareButton = await screen.findByRole('button', { name: 'Share image' });
    await act(async () => {
      fireEvent.click(shareButton);
    });
    const shared = share.mock.calls[0]?.[0];
    expect(shared?.files?.[0]?.name).toBe('sleeve-receipt-card.png');
    expect(shared?.text).toBe(window.location.href);
  });

  it('says there is no card at a link that names none', async () => {
    renderCard('nothing-here');
    expect(await screen.findByRole('heading', { name: 'No card at this link' })).toBeInTheDocument();
    expect(drawCard).not.toHaveBeenCalled();
  });
});

describe('card page', () => {
  it('answers not found for an id that cannot be a card id', async () => {
    await expect(CardPage({ params: Promise.resolve({ id: '../receipts' }) })).rejects.toThrow();
  });
});
