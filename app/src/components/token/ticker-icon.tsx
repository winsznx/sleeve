import type { JSX } from 'react';

import type { TickerId } from '@sleeve/core';

import { tickerSymbol } from '@/components/sleeve/text';

import { isTokenKey, type TokenKey } from './registry';
import { TokenIcon, type TokenIconSize } from './token-icon';

/** The icon key for a launch ticker, or null for an id the manifest does not know. */
export function tickerTokenKey(tickerId: TickerId): TokenKey | null {
  const symbol = tickerSymbol(tickerId);
  return isTokenKey(symbol) ? symbol : null;
}

/**
 * A launch ticker's icon, decorative because the ticker's name always sits next to it. Renders nothing for an id
 * the manifest does not know, so a removed or unknown ticker never gets an invented mark.
 */
export function TickerIcon({
  tickerId,
  size = 'sm',
  className,
}: {
  tickerId: TickerId;
  size?: TokenIconSize;
  className?: string;
}): JSX.Element | null {
  const symbol = tickerSymbol(tickerId);
  if (!isTokenKey(symbol)) return null;
  return size === 'lg' || size === 'xl' || size === '2xl' ? (
    <TokenIcon token={symbol} size={size} decorative className={className} />
  ) : (
    <TokenIcon token={symbol} size={size} decorative className={className} />
  );
}
