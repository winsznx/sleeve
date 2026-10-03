import { LAUNCH_TICKERS, RULE_DEFAULTS, TOTAL_BPS, formatBps, type TickerId } from '@sleeve/core';
import type { JSX } from 'react';

import { usdgText } from '@/components/sleeve/text';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { AmountPanel } from './art-blocks';
import { Box, CheckBadge, Fill, Lockup, Rail, StripeChip, Text, TokenMark, cssLength, pad } from './art-parts';
import type { CardEnv } from './card-env';
import { USDG_CARD_TOKEN, cardToken } from './card-view';

/**
 * The OpenGraph images that are not a card: the site's and the verifier's (docs/design/inspiration.md 8.1 and 8.3).
 * Each is 1200 by 630 with everything inside the central 1200 by 600 band, the lower left corner kept free of text
 * where X lays the domain over the image, and the split as the one loud element.
 */

export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The payment the site image shows: PRD 8.1's first payday, 500 USDG, split by the suggested rule. */
const EXAMPLE_PAYMENT = 500_000_000n;

/** The PRD's sentence cut into lines that keep "Stock Token" whole at this size. */
export const SITE_OG_HEADLINE_LINES = ['Part of every payment', 'becomes a US Stock Token', 'you own.'] as const;
export const SITE_OG_HEADLINE = SITE_OG_HEADLINE_LINES.join(' ');
export const SITE_OG_LEAD = 'The rest stays spendable. You set the split once.';

/** What the example payday splits into under the suggested rule, worked out from the product constants. */
export function exampleSplit(): { payment: bigint; spend: bigint; equity: bigint; equityBps: number; tickerId: TickerId } {
  const equity = (EXAMPLE_PAYMENT * BigInt(RULE_DEFAULTS.equityBps)) / BigInt(TOTAL_BPS);
  return {
    payment: EXAMPLE_PAYMENT,
    spend: EXAMPLE_PAYMENT - equity,
    equity,
    equityBps: RULE_DEFAULTS.equityBps,
    tickerId: RULE_DEFAULTS.tickerId,
  };
}

export function siteOgAlt(): string {
  const split = exampleSplit();
  const symbol = cardToken(split.tickerId).symbol;
  return `Sleeve. ${SITE_OG_HEADLINE} ${SITE_OG_LEAD} An example payday: ${usdgText(split.payment)} arrived, ${usdgText(split.spend)} stayed spendable and ${usdgText(split.equity)} became ${symbol}, ${DEBT_SECURITY_LINE}.`;
}

function Frame({ env, children }: { env: CardEnv; children: JSX.Element[] }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        position: 'relative',
        width: env.px(OG_SIZE.width),
        height: env.px(OG_SIZE.height),
        overflow: 'hidden',
        fontFamily: env.fonts.sans,
        backgroundColor: env.palette.color.canvas,
      }}
    >
      {children}
    </div>
  );
}

function Tag({ env, text }: { env: CardEnv; text: string }): JSX.Element {
  return (
    <Box style={{ padding: pad(env, 5, 12), borderRadius: env.px(99), backgroundColor: env.palette.color.surfaceStrong }}>
      <Text env={env} size={15} color={env.palette.color.inkSecondary} weight={500} leading={1.2}>
        {text}
      </Text>
    </Box>
  );
}

/** The four launch tickers as chips with their marks. */
function LaunchTickers({ env }: { env: CardEnv }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  return (
    <Box style={{ flexDirection: 'column', gap: px(14) }}>
      <Text env={env} size={18} color={color.inkSecondary} weight={500}>
        Stock Tokens at launch
      </Text>
      <Box style={{ gap: px(10) }}>
        {LAUNCH_TICKERS.map((ticker) => {
          const token = cardToken(ticker.id);
          return (
            <Box
              key={ticker.id}
              style={{
                alignItems: 'center',
                gap: px(8),
                padding: pad(env, 5, 14, 5, 5),
                borderRadius: px(99),
                border: `${cssLength(px(1))} solid ${color.border}`,
                backgroundColor: color.surface,
              }}
            >
              <TokenMark env={env} token={token} size={28} />
              <Text env={env} size={18} color={color.ink} weight={600}>
                {token.symbol}
              </Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** The site image: the sentence on the left, a payday splitting on the green stage on the right, cropped by the edge. */
export function SiteOgArt({ env }: { env: CardEnv }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  const split = exampleSplit();
  const token = cardToken(split.tickerId);
  const spendShare = formatBps(TOTAL_BPS - split.equityBps);
  const equityShare = formatBps(split.equityBps);

  return (
    <Frame env={env}>
      <Box style={{ position: 'absolute', top: px(56), left: px(64), width: px(590), flexDirection: 'column' }}>
        <Lockup env={env} size={38} color={color.ink} />
        <Box style={{ flexDirection: 'column', marginTop: px(68) }}>
          {SITE_OG_HEADLINE_LINES.map((line) => (
            <Text key={line} env={env} size={46} color={color.ink} weight={600} tracking={-0.035} leading={1.08}>
              {line}
            </Text>
          ))}
        </Box>
        <Text
          env={env}
          size={25}
          color={color.inkSecondary}
          weight={500}
          tracking={-0.01}
          leading={1.3}
          style={{ marginTop: px(22), maxWidth: px(470) }}
        >
          {SITE_OG_LEAD}
        </Text>
        <Box style={{ marginTop: px(40) }}>
          <LaunchTickers env={env} />
        </Box>
      </Box>

      <Box
        style={{
          position: 'absolute',
          top: px(36),
          left: px(664),
          width: px(500),
          height: px(640),
          borderRadius: px(34),
          overflow: 'hidden',
        }}
      >
        <Fill background={{ layers: 'stage' }} env={env} />
      </Box>

      <Box
        style={{
          position: 'absolute',
          top: px(84),
          left: px(686),
          width: px(456),
          flexDirection: 'column',
          gap: px(16),
          padding: px(24),
          borderRadius: px(26),
          backgroundColor: color.surface,
          boxShadow: color.shadowFloating,
        }}
      >
        <Box style={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Box style={{ alignItems: 'center', gap: px(12) }}>
            <TokenMark env={env} token={USDG_CARD_TOKEN} size={40} />
            <Box style={{ flexDirection: 'column', gap: px(2) }}>
              <Text env={env} size={15} color={color.inkSecondary} weight={500}>
                A payday arrived
              </Text>
              <Text env={env} size={25} color={color.ink} weight={600} tracking={-0.015}>
                {usdgText(split.payment)}
              </Text>
            </Box>
          </Box>
          <Tag env={env} text="Example" />
        </Box>
        <Rail
          env={env}
          rail={{ spendBps: TOTAL_BPS - split.equityBps, equityBps: split.equityBps, waited: false }}
          height={14}
          gap={4}
          rounded
          minSegment={14}
        />
        <Box style={{ gap: px(10) }}>
          <AmountPanel
            env={env}
            tone="spend"
            share={spendShare}
            label="spendable"
            value={usdgText(split.spend)}
            token={USDG_CARD_TOKEN}
            size={20}
          />
          <AmountPanel
            env={env}
            tone="equity"
            share={equityShare}
            label={`became ${token.symbol}`}
            value={usdgText(split.equity)}
            token={token}
            size={20}
          />
        </Box>
        <Text env={env} size={15} color={color.inkSecondary} weight={500}>
          {DEBT_SECURITY_LINE}
        </Text>
      </Box>

      <Box
        style={{
          position: 'absolute',
          top: px(436),
          left: px(686),
          width: px(456),
          alignItems: 'center',
          gap: px(14),
          padding: pad(env, 16, 20),
          borderRadius: px(20),
          backgroundColor: color.glassLight,
          border: `${cssLength(px(1))} solid ${color.glassLightBorder}`,
          boxShadow: color.shadowFloating,
        }}
      >
        <StripeChip env={env} size={44} />
        <Text env={env} size={18} color={color.ink} weight={500} leading={1.3} style={{ flexShrink: 1 }}>
          {`Market closed? The ${usdgText(split.equity)} waits as USDG and buys at the open.`}
        </Text>
      </Box>
    </Frame>
  );
}

export const VERIFY_OG_TITLE = 'Check a split';
export const VERIFY_OG_HEADLINE = 'Anyone can recompute a split from public chain data.';
export const VERIFY_OG_LEAD =
  'Paste a receipt id. The check reads the chain again through a different RPC provider and recomputes every number.';

/** The fields the verifier recomputes (PRD 10), as the tape on the verify image. */
export const VERIFY_OG_FIELDS = [
  'USDG in',
  'USDG to spend',
  'USDG to equity',
  'Tokens out',
  'Execution price',
  'Premium',
  'Chainlink round',
  'Receipt hash',
] as const;

export function verifyOgAlt(): string {
  return `Sleeve, ${VERIFY_OG_TITLE.toLowerCase()}. ${VERIFY_OG_HEADLINE} ${VERIFY_OG_LEAD}`;
}

/** The verifier's image: the promise on the left, the receipt tape it checks on the right (Linear's section lockup). */
export function VerifyOgArt({ env }: { env: CardEnv }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  return (
    <Frame env={env}>
      <Box style={{ position: 'absolute', top: px(56), left: px(64), width: px(560), flexDirection: 'column' }}>
        <Box style={{ alignItems: 'center', gap: px(20) }}>
          <Lockup env={env} size={38} color={color.ink} />
          <div style={{ display: 'flex', width: px(2), height: px(34), backgroundColor: color.borderStrong }} />
          <Text env={env} size={30} color={color.inkSecondary} weight={500} leading={1}>
            {VERIFY_OG_TITLE}
          </Text>
        </Box>
        <Text env={env} size={54} color={color.ink} weight={600} tracking={-0.035} leading={1.06} style={{ marginTop: px(64) }}>
          {VERIFY_OG_HEADLINE}
        </Text>
        <Text env={env} size={24} color={color.inkSecondary} weight={500} leading={1.4} style={{ marginTop: px(24), maxWidth: px(500) }}>
          {VERIFY_OG_LEAD}
        </Text>
      </Box>

      <Box
        style={{
          position: 'absolute',
          top: px(36),
          left: px(664),
          width: px(500),
          height: px(640),
          borderRadius: px(34),
          overflow: 'hidden',
        }}
      >
        <Fill background={{ layers: 'stage' }} env={env} />
      </Box>

      <Box
        style={{
          position: 'absolute',
          top: px(84),
          left: px(704),
          width: px(420),
          flexDirection: 'column',
          padding: pad(env, 26, 28),
          borderRadius: px(24),
          backgroundColor: color.surface,
          boxShadow: color.shadowFloating,
        }}
      >
        <Box
          style={{
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingBottom: px(16),
            borderBottom: `${cssLength(px(2))} dashed ${color.borderStrong}`,
          }}
        >
          <Text env={env} size={18} color={color.inkSecondary} weight={600}>
            Recomputed field by field
          </Text>
          <Box style={{ width: px(64) }}>
            <Rail
              env={env}
              rail={{ spendBps: TOTAL_BPS - RULE_DEFAULTS.equityBps, equityBps: RULE_DEFAULTS.equityBps, waited: false }}
              height={8}
              gap={2}
              rounded
              minSegment={8}
            />
          </Box>
        </Box>
        <Box style={{ flexDirection: 'column', gap: px(13), paddingTop: px(18) }}>
          {VERIFY_OG_FIELDS.map((field) => (
            <Box key={field} style={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Text env={env} size={20} color={color.ink} weight={500}>
                {field}
              </Text>
              <CheckBadge env={env} size={24} background={color.equity} ink={color.onAccent} />
            </Box>
          ))}
        </Box>
        <Text env={env} size={16} color={color.inkSecondary} weight={500} leading={1.4} style={{ marginTop: px(20) }}>
          A mismatch is shown, never smoothed.
        </Text>
      </Box>
    </Frame>
  );
}
