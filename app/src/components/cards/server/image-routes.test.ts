// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import CardOgImage, { generateImageMetadata as cardOgMetadata } from '@/app/(public)/card/[id]/opengraph-image';
import CardPage, { generateMetadata as cardPageMetadata } from '@/app/(public)/card/[id]/page';
import CardTwitterImage from '@/app/(public)/card/[id]/twitter-image';
import VerifyOgImage, { alt as verifyAlt, size as verifySize } from '@/app/(public)/verify/opengraph-image';
import VerifyTwitterImage from '@/app/(public)/verify/twitter-image';
import { GET as cardGet, HEAD as cardHead } from '@/app/api/card/[id]/[format]/route';
import { GET as sampleGet, HEAD as sampleHead } from '@/app/api/card/sample/[format]/route';
import SiteOgImage, { alt as siteAlt, contentType as siteType, size as siteSize } from '@/app/opengraph-image';
import SiteTwitterImage from '@/app/twitter-image';
import { createMockDataLayer, SAMPLE_CARD_IDS, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { cardFingerprint } from '../card-view';

vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: 'sleeve.test', 'x-forwarded-proto': 'https' }),
}));

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const POST = { width: 1080, height: 1350 };
const WIDE = { width: 1200, height: 630 };

/** Width and height from a PNG's IHDR chunk, which follows the 8-byte signature. */
async function pngSize(response: Response): Promise<{ width: number; height: number }> {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('image/png');
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function cardRequest(id: string, format: string, query = '', method: 'GET' | 'HEAD' = 'GET') {
  return [
    new Request(`https://sleeve.test/api/card/${id}/${format}${query}`, { method }),
    { params: Promise.resolve({ id, format }) },
  ] as const;
}

function sampleRequest(format: string, query: string, method: 'GET' | 'HEAD' = 'GET') {
  return [
    new Request(`https://sleeve.test/api/card/sample/${format}?${query}`, { method }),
    { params: Promise.resolve({ format }) },
  ] as const;
}

describe('card image routes', { timeout: 60_000 }, () => {
  it('draws a shared card as a 1080 by 1350 post', async () => {
    // #when the post image of the sample payday card is asked for
    const response = await cardGet(...cardRequest(SAMPLE_CARD_IDS.receipt, 'post'));

    // #then it is a PNG of the post size
    expect(await pngSize(response)).toEqual(POST);
  });

  it('draws a shared card as a 1200 by 630 wide image', async () => {
    // #when the wide image is asked for
    const response = await cardGet(...cardRequest(SAMPLE_CARD_IDS.receipt, 'wide'));

    // #then it is a PNG of the link preview size
    expect(await pngSize(response)).toEqual(WIDE);
  });

  it('draws every colorway of the week card with a toggle in the address', async () => {
    for (const theme of ['paper', 'mint', 'stage', 'deep']) {
      // #when each colorway is asked for with the proof left off
      const response = await cardGet(...cardRequest(SAMPLE_CARD_IDS.week, 'post', `?theme=${theme}&proof=0`));

      // #then each is a post-size PNG
      expect(await pngSize(response)).toEqual(POST);
    }
  });

  it('names the file when asked to download', async () => {
    // #when a download is asked for
    const response = await cardGet(...cardRequest(SAMPLE_CARD_IDS.receipt, 'wide', '?download=1'));

    // #then the response names the file by kind, id and size
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="sleeve-payday-card-${SAMPLE_CARD_IDS.receipt}-wide.png"`,
    );
    expect(await pngSize(response)).toEqual(WIDE);
  });

  it('answers HEAD without drawing', async () => {
    // #when the page asks whether the image exists
    const head = await cardHead(...cardRequest(SAMPLE_CARD_IDS.receipt, 'post', '', 'HEAD'));

    // #then the answer is yes, with no body
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('image/png');
    expect(await head.text()).toBe('');
  });

  it('answers not found for anything that is not a card', async () => {
    // #when the address names no card, a size that does not exist, or an id of the wrong shape
    const statuses = [
      (await cardGet(...cardRequest('nothing-here', 'post'))).status,
      (await cardGet(...cardRequest(SAMPLE_CARD_IDS.receipt, 'story'))).status,
      (await cardHead(...cardRequest('..', 'post', '', 'HEAD'))).status,
    ];

    // #then each is not found
    expect(statuses).toEqual([404, 404, 404]);
  });

  it('draws a sample card a tab made, from the sample history, when the fingerprint agrees', async () => {
    // #given a card made in a tab, with amounts and proof
    const card = await createMockDataLayer().createCard({
      subject: { kind: 'receipt', receiptId: SAMPLE_RECEIPT_IDS.filledSpy },
      showAmounts: true,
      showProof: true,
    });
    const query = `receipt=${SAMPLE_RECEIPT_IDS.filledSpy}&showAmounts=1&showProof=1&expect=${cardFingerprint(card)}`;

    // #when the sample route is asked to draw it
    const response = await sampleGet(...sampleRequest('post', query));

    // #then it draws the same card, and HEAD agrees
    expect(await pngSize(response)).toEqual(POST);
    expect((await sampleHead(...sampleRequest('post', query, 'HEAD'))).status).toBe(200);
  });

  it('refuses a sample card whose fingerprint differs from the sample history', async () => {
    // #given a fingerprint the sample history does not produce
    const query = `receipt=${SAMPLE_RECEIPT_IDS.filledSpy}&expect=00000000`;

    // #then both GET and HEAD answer conflict
    expect((await sampleGet(...sampleRequest('wide', query))).status).toBe(409);
    expect((await sampleHead(...sampleRequest('wide', query, 'HEAD'))).status).toBe(409);
  });

  it('refuses a sample card for a receipt that did not buy, and an address that names nothing', async () => {
    expect((await sampleGet(...sampleRequest('post', `receipt=${SAMPLE_RECEIPT_IDS.queuedSession}`))).status).toBe(404);
    expect((await sampleGet(...sampleRequest('post', ''))).status).toBe(404);
  });
});

describe('OpenGraph and Twitter images', { timeout: 60_000 }, () => {
  it('gives the site a 1200 by 630 picture of a payday splitting', async () => {
    // #then the declared size, type and alt text match the drawn PNGs
    expect([siteSize, siteType]).toEqual([WIDE, 'image/png']);
    expect(siteAlt).toContain(DEBT_SECURITY_LINE);
    expect(await pngSize(SiteOgImage())).toEqual(WIDE);
    expect(await pngSize(SiteTwitterImage())).toEqual(WIDE);
  });

  it('gives the verifier its own 1200 by 630 picture', async () => {
    expect(verifySize).toEqual(WIDE);
    expect(verifyAlt).toContain('check a split');
    expect(await pngSize(VerifyOgImage())).toEqual(WIDE);
    expect(await pngSize(VerifyTwitterImage())).toEqual(WIDE);
  });

  it('previews a shared card as the card itself, in its own words', async () => {
    // #given the sample payday card's link
    const params = Promise.resolve({ id: SAMPLE_CARD_IDS.receipt });

    // #when a crawler reads the card page's images
    const [metadata] = await cardOgMetadata({ params });

    // #then the alt text is the card's words and both images are link-preview PNGs
    expect(metadata?.alt).toContain('10% of this payday became SPY');
    expect(metadata?.size).toEqual(WIDE);
    expect(await pngSize(await CardOgImage({ params }))).toEqual(WIDE);
    expect(await pngSize(await CardTwitterImage({ params }))).toEqual(WIDE);
  });

  it('falls back to the site picture for a link with no card', async () => {
    // #given a link that names no card
    const params = Promise.resolve({ id: 'nothing-here' });

    // #then the preview says what Sleeve is instead
    const [metadata] = await cardOgMetadata({ params });
    expect(metadata?.alt).toBe(siteAlt);
    expect(await pngSize(await CardOgImage({ params }))).toEqual(WIDE);
  });
});

describe('card page metadata', () => {
  it('titles a card page by its kind and keeps it out of search engines', async () => {
    // #when the payday, week and missing card pages are titled
    const payday = await cardPageMetadata({ params: Promise.resolve({ id: SAMPLE_CARD_IDS.receipt }) });
    const week = await cardPageMetadata({ params: Promise.resolve({ id: SAMPLE_CARD_IDS.week }) });
    const none = await cardPageMetadata({ params: Promise.resolve({ id: 'nothing-here' }) });

    // #then each says what it is, and the card pages ask not to be indexed
    expect(payday).toMatchObject({ title: 'A payday card', robots: { index: false, follow: false } });
    expect(payday.description).toContain(DEBT_SECURITY_LINE);
    expect([week.title, none.title]).toEqual(['A week card', 'A Sleeve card']);
  });

  it('answers not found for an id that cannot be a card id', async () => {
    // #when the page is asked for an id of the wrong shape
    const page = CardPage({ params: Promise.resolve({ id: '../receipts' }), searchParams: Promise.resolve({}) });

    // #then it throws Next's not found signal
    await expect(page).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
});
