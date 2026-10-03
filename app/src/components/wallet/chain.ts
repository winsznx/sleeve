import type { Chain } from '@rainbow-me/rainbowkit';
import { CHAIN_ID, EXPLORER_URL, PUBLIC_RPC_URL } from '@sleeve/core';
import { robinhood } from 'viem/chains';

if (robinhood.id !== CHAIN_ID) throw new Error(`viem's Robinhood Chain entry has id ${robinhood.id}, expected ${CHAIN_ID}`);

/**
 * Sleeve's NetworkGlyph (icon-system.md 6) as an image, for the one place RainbowKit draws a chain icon itself. An
 * image cannot read Sleeve's CSS variables, so the stroke is currentColor, which an image draws in plain black.
 */
const NETWORK_GLYPH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.75 17.25 6.5 10 10.25 2.75 6.5Z"/>' +
  '<path d="m2.75 10 7.25 3.75L17.25 10"/><path d="m2.75 13.5 7.25 3.75 7.25-3.75"/></svg>';

/**
 * Robinhood Chain for wagmi and RainbowKit. viem's entry also lists a third-party RPC and websocket; a wallet that
 * adds the chain gets only the official RPC and the Blockscout explorer. The icon is the neutral glyph, never a
 * Robinhood mark (D-021, D-022).
 */
export const robinhoodChain = {
  ...robinhood,
  rpcUrls: { default: { http: [PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER_URL, apiUrl: `${EXPLORER_URL}/api` } },
  iconUrl: `data:image/svg+xml,${encodeURIComponent(NETWORK_GLYPH_SVG)}`,
  // RainbowKit sets this as an inline background in the page, where the token resolves.
  iconBackground: 'var(--color-surface)',
} as const satisfies Chain;
