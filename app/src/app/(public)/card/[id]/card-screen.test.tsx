import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CARD_ART_VERSION } from '@/components/cards/card-options';
import { createMockDataLayer, SAMPLE_CARD_IDS, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { CardData, CreateCardInput, SleeveDataLayer } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { CardScreen, type ServerCard } from './card-screen';

const ORIGIN = 'https://sleeve.test';

const fetchMock = vi.fn<typeof fetch>();
const saveClick = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:card' });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  // The saved file is handed to a detached anchor; jsdom cannot follow it, so the click is recorded instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(saveClick);
});

afterEach(() => {
  fetchMock.mockReset();
  saveClick.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(globalThis, 'ClipboardItem');
});

function pngResponse(): Response {
  return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200, headers: { 'content-type': 'image/png' } });
}

async function storedCard(id: string): Promise<CardData> {
  const card = await createMockDataLayer().getCard(id);
  if (card === null) throw new Error(`no sample card ${id}`);
  return card;
}

async function madeCard(input: CreateCardInput, layer: SleeveDataLayer = createMockDataLayer()): Promise<CardData> {
  return layer.createCard(input);
}

interface RenderOptions {
  cardId: string;
  server: ServerCard;
  layer?: SleeveDataLayer;
}

function renderScreen({ cardId, server, layer = createMockDataLayer() }: RenderOptions): void {
  render(
    <DataLayerProvider dataLayer={layer}>
      <CardScreen cardId={cardId} server={server} origin={ORIGIN} initialTheme="paper" />
    </DataLayerProvider>,
  );
}

function downloadLink(): HTMLElement {
  return screen.getByRole('link', { name: 'Download image' });
}

function preview(): HTMLElement {
  return within(screen.getByRole('region', { name: 'Card preview' })).getByRole('img');
}

describe('a card the server read', () => {
  it('shows the card at once, with its words and an image ready to download', async () => {
    // #given the sample payday card, read by the server
    const card = await storedCard(SAMPLE_CARD_IDS.receipt);

    // #when the page opens
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card } });

    // #then the preview names what the payday became, and the download is the card's own image
    expect(screen.getByRole('heading', { level: 1, name: 'A payday card' })).toBeInTheDocument();
    expect(preview().getAttribute('aria-label')).toContain(`10% of this payday became SPY. ${DEBT_SECURITY_LINE}.`);
    expect(downloadLink()).toHaveAttribute('href', `/api/card/${SAMPLE_CARD_IDS.receipt}/post?download=1&v=${CARD_ART_VERSION}`);
    expect(downloadLink()).toHaveAttribute('download', `sleeve-payday-card-${SAMPLE_CARD_IDS.receipt}-post.png`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('draws the colorway and the size the viewer picks', async () => {
    // #given the sample payday card
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #when the viewer picks the deep colorway and the wide size
    fireEvent.click(screen.getByRole('radio', { name: 'Deep' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Wide' }));

    // #then the image address asks for both
    expect(downloadLink()).toHaveAttribute('href', `/api/card/${SAMPLE_CARD_IDS.receipt}/wide?theme=deep&download=1&v=${CARD_ART_VERSION}`);
    expect(screen.getByRole('radio', { name: 'Deep' })).toBeChecked();
  });

  it('lets a viewer leave the amounts and the proof the owner showed off the image', async () => {
    // #given a payday card made with amounts and proof
    const card = await madeCard({
      subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy },
      showAmounts: true,
      showProof: true,
    });
    renderScreen({ cardId: card.cardId, server: { status: 'found', card } });
    expect(preview().getAttribute('aria-label')).toContain('1,200.00 USDG arrived');

    // #when both are left off
    fireEvent.click(screen.getByRole('checkbox', { name: 'Amounts' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Receipt and account' }));

    // #then the preview, the address and the words all leave them off
    expect(preview().getAttribute('aria-label')).not.toMatch(/USDG arrived|Receipt 455/);
    expect(downloadLink().getAttribute('href')).toContain('amounts=0&proof=0');
    expect(screen.getAllByText('Left off this image')).toHaveLength(2);
  });

  it('offers no toggles for a card that holds nothing to leave off', async () => {
    // #given the default card, made without amounts or proof
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #then there is nothing to toggle, and the words say the owner hid both
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Hidden by the owner')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Check receipt/ })).toBeNull();
  });

  it('links every receipt a proof card names to the verifier', async () => {
    // #given the sample week card, made with proof
    renderScreen({ cardId: SAMPLE_CARD_IDS.week, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.week) } });

    // #then each receipt has its own check link
    const links = screen.getAllByRole('link', { name: /^Check receipt/ });
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/verify/455', '/verify/560', '/verify/611', '/verify/642']);
    expect(screen.getByRole('heading', { level: 1, name: 'A week card' })).toBeInTheDocument();
  });
});

describe('saving and sharing', () => {
  it('downloads the drawn image under the card file name', async () => {
    // #given the sample payday card and an image service that draws it
    fetchMock.mockResolvedValue(pngResponse());
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #when the viewer downloads it
    await act(async () => {
      fireEvent.click(downloadLink());
    });

    // #then the image is fetched and saved, and the page says so
    expect(fetchMock).toHaveBeenCalledWith(`/api/card/${SAMPLE_CARD_IDS.receipt}/post?download=1&v=${CARD_ART_VERSION}`);
    expect(saveClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Download started.')).toHaveAttribute('role', 'status');
  });

  it('says what went wrong when the image cannot be drawn', async () => {
    // #given an image service that fails
    fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #when the viewer downloads
    await act(async () => {
      fireEvent.click(downloadLink());
    });

    // #then nothing is saved and the reason shows
    expect(saveClick).not.toHaveBeenCalled();
    expect(screen.getByText('The image could not be drawn (503).')).toBeInTheDocument();
  });

  it('copies the image where the browser can put images on the clipboard', async () => {
    // #given a browser with image clipboard support
    fetchMock.mockResolvedValue(pngResponse());
    const write = vi.fn<(items: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {}
      },
    );
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #when the viewer copies the image
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy image' }));
    });

    // #then the clipboard gets one PNG item
    expect(write).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Image copied. Paste it into a post or a chat.')).toBeInTheDocument();
  });

  it('shares the link where the browser has a share sheet, and hides the button where it has none', async () => {
    // #given a browser with a share sheet
    const share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'found', card: await storedCard(SAMPLE_CARD_IDS.receipt) } });

    // #when the viewer shares
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    });

    // #then the sheet gets the card page link
    expect(share).toHaveBeenCalledWith({ title: 'A payday card on Sleeve', url: `${ORIGIN}/card/${SAMPLE_CARD_IDS.receipt}` });
  });
});

describe('a card only this tab holds', () => {
  it('draws a sample card made in this tab from the sample history', async () => {
    // #given a card made in this tab, which the server never saw, and an image service that agrees to draw it
    const layer = createMockDataLayer();
    const card = await madeCard(
      { subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy }, showAmounts: false, showProof: false },
      layer,
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    // #when its page opens
    renderScreen({ cardId: card.cardId, server: { status: 'missing' }, layer });

    // #then the download draws the same card from what it was made of
    const link = await screen.findByRole('link', { name: 'Download image' });
    expect(link.getAttribute('href')).toMatch(/^\/api\/card\/sample\/post\?receipt=455&expect=[0-9a-f]{8}&download=1&v=/);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/card\/sample\/post\?receipt=455&expect=/), { method: 'HEAD' });
    expect(screen.getByText('This sample card lives in this browser tab, so the link opens it only here.')).toBeInTheDocument();
  });

  it('explains when the image service cannot draw what the tab holds', async () => {
    // #given a tab card whose history moved on, so the image service refuses it
    const layer = createMockDataLayer();
    const card = await madeCard(
      { subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy }, showAmounts: false, showProof: false },
      layer,
    );
    fetchMock.mockResolvedValue(new Response(null, { status: 409 }));

    // #when its page opens
    renderScreen({ cardId: card.cardId, server: { status: 'missing' }, layer });

    // #then the card shows, and the page says why there is no download
    expect(await screen.findByText('This sample card has no image to download')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download image' })).toBeNull();
    expect(preview()).toBeInTheDocument();
  });

  it('shows a skeleton while the tab reads the card', async () => {
    // #given a data layer that has not answered yet
    const layer = { ...createMockDataLayer(), getCard: () => new Promise<CardData | null>(() => undefined) };

    // #when the page opens
    renderScreen({ cardId: 'still-loading', server: { status: 'missing' }, layer });

    // #then it says what is loading
    expect(screen.getByRole('status')).toHaveTextContent('Loading the card');
  });

  it('says there is no card at a link that names none', async () => {
    // #when a link names no card anywhere
    renderScreen({ cardId: 'nothing-here', server: { status: 'missing' } });

    // #then the page says so and offers the way to learn what Sleeve is
    expect(await screen.findByRole('heading', { name: 'No card at this link' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See how Sleeve works' })).toHaveAttribute('href', '/');
  });

  it('shows what failed, with a retry, when the card does not load', async () => {
    // #given a data layer that fails once, then answers
    const getCard = vi
      .fn<SleeveDataLayer['getCard']>()
      .mockRejectedValueOnce(new Error('The card store did not answer.'))
      .mockResolvedValue(await storedCard(SAMPLE_CARD_IDS.receipt));
    const layer = { ...createMockDataLayer(), getCard };
    renderScreen({ cardId: SAMPLE_CARD_IDS.receipt, server: { status: 'unavailable' }, layer });
    expect(await screen.findByText('The card did not load')).toBeInTheDocument();
    expect(screen.getByText('The card store did not answer.')).toBeInTheDocument();

    // #when the viewer tries again
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    // #then the card shows
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'A payday card' })).toBeInTheDocument());
  });
});
