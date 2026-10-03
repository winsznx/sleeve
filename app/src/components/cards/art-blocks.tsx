import type { CSSProperties, JSX, ReactNode } from 'react';

import {
  ArrowTile,
  Arcs,
  Box,
  CheckBadge,
  Dot,
  FILL,
  Fill,
  Lockup,
  QrMark,
  StripeChip,
  Stripes,
  Text,
  TokenMark,
  css,
  cssLength,
  legendColors,
  pad,
} from './art-parts';
import type { CardEnv } from './card-env';
import type { CardFormat } from './card-options';
import type { CardThemeLook } from './card-themes';
import type { CardLegendItem, CardProofView, CardRail, CardToken } from './card-view';

/**
 * The pieces every card layout is built from: the ticket with its perforation, the header, the ticker's knockout
 * label, the legend, the amounts panels, the payday bars and the proof tape. Same rules as art-parts.tsx: flexbox and
 * absolute positioning only, every length through env.px, every color from the palette.
 */

export interface Shared {
  env: CardEnv;
  look: CardThemeLook;
  /** The face's colors, resolved. */
  ink: string;
  secondary: string;
}

/* The ticket ------------------------------------------------------------------------------------------------ */

const TICKET_RADIUS: Record<CardFormat, number> = { post: 44, wide: 30 };
const NOTCH: Record<CardFormat, number> = { post: 46, wide: 30 };

export interface TicketProps extends Shared {
  format: CardFormat;
  face: ReactNode;
  stub: ReactNode;
  /** Width of the stub beside the face on a wide ticket. */
  stubWidth?: number;
  /** The split rail along the ticket's bottom edge, under face and stub alike. */
  rail: ReactNode;
}

/**
 * A card is a ticket (Supabase's tickets, docs/design/inspiration.md 6.2): the face says what the payday became, a
 * perforation separates it from the stub, the stub carries the split, the amounts and the proof, and the split rail
 * runs along the bottom edge the way a repository card ends in its language bar. The stub is white on every colorway
 * so the apricot and green keep their colors.
 */
export function Ticket({ env, look, format, face, stub, stubWidth = 0, rail }: TicketProps): JSX.Element {
  const { px } = env;
  const post = format === 'post';
  const edge = look.ticketEdge === null ? null : env.palette.color[look.ticketEdge];
  const faceBox = (
    <Box style={{ position: 'relative', flexDirection: 'column', flexGrow: 1, flexBasis: 0, overflow: 'hidden' }}>
      <Fill background={look.face} env={env} />
      {look.arcs ? <Arcs env={env} width={post ? 1000 : 860} height={post ? 1000 : 600} /> : null}
      {face}
    </Box>
  );
  const stubBox = (
    <Box
      style={css({
        position: 'relative',
        flexDirection: 'column',
        flexShrink: 0,
        width: post ? undefined : px(stubWidth),
        backgroundColor: env.palette.color.surface,
      })}
    >
      {stub}
      <Perforation env={env} look={look} format={format} />
    </Box>
  );
  return (
    <div
      style={css({
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        flexGrow: 1,
        flexBasis: 0,
        borderRadius: px(TICKET_RADIUS[format]),
        overflow: 'hidden',
        backgroundColor: env.palette.color.surface,
        boxShadow: look.ticketShadow ? env.palette.color.shadowFloating : undefined,
        border: edge === null ? undefined : `${cssLength(px(2))} solid ${edge}`,
      })}
    >
      {post ? (
        <Box style={{ flexDirection: 'column', flexGrow: 1, flexBasis: 0 }}>
          {faceBox}
          {stubBox}
        </Box>
      ) : (
        <Box style={{ flexDirection: 'row', flexGrow: 1, flexBasis: 0 }}>
          {faceBox}
          {stubBox}
        </Box>
      )}
      {rail}
    </div>
  );
}

/**
 * The tear line along the stub's leading edge, drawn after the stub so it sits over the face's edge. On a post the
 * line ends in two notches that show the backdrop, so they appear only when the backdrop is one flat color, and carry
 * the ticket's edge so its outline runs around them. A wide ticket's line stops short of both edges with no notch,
 * because the split rail closes its bottom.
 */
function Perforation({ env, look, format }: { env: CardEnv; look: CardThemeLook; format: CardFormat }): JSX.Element {
  const { px } = env;
  const post = format === 'post';
  const notch = NOTCH[format];
  const line = `${cssLength(px(post ? 3 : 2))} dashed ${env.palette.color.borderStrong}`;
  const notchColor = post && look.notch !== null ? env.palette.color[look.notch] : null;
  const edge = look.ticketEdge === null ? null : env.palette.color[look.ticketEdge];
  const half = px(-notch / 2);
  const notchStyle = (side: 'left' | 'right'): CSSProperties =>
    css({
      display: 'flex',
      position: 'absolute',
      top: half,
      [side]: half,
      width: px(notch),
      height: px(notch),
      borderRadius: px(notch),
      backgroundColor: notchColor ?? undefined,
      border: edge === null ? undefined : `${cssLength(px(2))} solid ${edge}`,
    });
  return (
    <div style={{ ...FILL, display: 'flex', height: post ? px(2) : '100%', width: post ? '100%' : px(2) }}>
      <div
        style={{
          display: 'flex',
          position: 'absolute',
          ...(post
            ? { top: 0, left: px(notch), right: px(notch), borderTop: line }
            : { left: 0, top: px(notch), bottom: px(notch), borderLeft: line }),
        }}
      />
      {notchColor === null ? null : <div style={notchStyle('left')} />}
      {notchColor === null ? null : <div style={notchStyle('right')} />}
    </div>
  );
}

/** The split along the ticket's bottom edge: square ends, rounded by the ticket's corners. */
export function EdgeRail({ env, rail, height }: { env: CardEnv; rail: CardRail; height: number }): JSX.Element {
  const { px } = env;
  const gap = Math.max(3, Math.round(height / 7));
  const segment = (grow: number): CSSProperties => ({
    display: 'flex',
    position: 'relative',
    flexGrow: grow,
    flexBasis: 0,
    minWidth: px(height),
    overflow: 'hidden',
  });
  return (
    <Box style={{ width: '100%', height: px(height), gap: px(gap), flexShrink: 0, backgroundColor: env.palette.color.surface }}>
      {rail.spendBps > 0 ? <div style={{ ...segment(rail.spendBps), backgroundColor: env.palette.color.spend }} /> : null}
      {rail.equityBps > 0 ? (
        <div style={{ ...segment(rail.equityBps), gap: px(gap) }}>
          {rail.waited ? (
            <div style={{ display: 'flex', position: 'relative', flexGrow: 1, flexBasis: 0, overflow: 'hidden' }}>
              <Stripes env={env} height={height} />
            </div>
          ) : null}
          <div style={{ display: 'flex', flexGrow: 1, flexBasis: 0, backgroundColor: env.palette.color.equity }} />
        </div>
      ) : null}
    </Box>
  );
}

/* Header and statement -------------------------------------------------------------------------------------- */

export function Header({
  env,
  look,
  ink,
  secondary,
  dateLine,
  brandSize,
  dateSize,
}: Shared & { dateLine: string; brandSize: number; dateSize: number }): JSX.Element {
  return (
    <Box style={{ alignItems: 'center', justifyContent: 'space-between', gap: env.px(24), flexShrink: 0 }}>
      <Lockup env={env} size={brandSize} color={ink} equity={env.palette.color[look.markEquity]} />
      <Text env={env} size={dateSize} color={secondary} weight={500}>
        {dateLine}
      </Text>
    </Box>
  );
}

/** Takes the free height of the face, so the statement sits low and the header stays at the top, as on a poster. */
export function Spacer({ env, min = 0 }: { env: CardEnv; min?: number }): JSX.Element {
  return <div style={{ display: 'flex', flexGrow: 1, minHeight: env.px(min) }} />;
}

/** The ticker as identity: the token's tile beside its symbol in a knockout label (docs/design/inspiration.md 6.2). */
export function Knockout({ env, look, token, size }: Shared & { token: CardToken; size: number }): JSX.Element {
  const { px } = env;
  return (
    <Box style={{ alignItems: 'center', gap: px(Math.round(size * 0.2)) }}>
      <TokenMark env={env} token={token} size={size} />
      <Box
        style={{
          height: px(size),
          alignItems: 'center',
          paddingLeft: px(Math.round(size * 0.36)),
          paddingRight: px(Math.round(size * 0.36)),
          borderRadius: px(size),
          backgroundColor: env.palette.color[look.knockout.background],
        }}
      >
        <Text
          env={env}
          size={Math.round(size * 0.62)}
          color={env.palette.color[look.knockout.ink]}
          weight={600}
          tracking={-0.01}
          leading={1}
        >
          {token.symbol}
        </Text>
      </Box>
    </Box>
  );
}

/** A Stock Token as a chip: its tile and symbol on the knockout color. */
export function TokenChip({ env, look, token, size }: Shared & { token: CardToken; size: number }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  const inset = Math.round(size * 0.14);
  return (
    <Box
      style={{
        alignItems: 'center',
        gap: px(Math.round(size * 0.24)),
        padding: pad(env, inset, Math.round(size * 0.42), inset, inset),
        borderRadius: px(size),
        backgroundColor: color[look.knockout.background],
      }}
    >
      <TokenMark env={env} token={token} size={size} />
      <Text env={env} size={Math.round(size * 0.6)} color={color[look.knockout.ink]} weight={600} tracking={-0.01} leading={1}>
        {token.symbol}
      </Text>
    </Box>
  );
}

/** The guard's promise beside a check. */
export function Stamp({ env, look, secondary, text, size }: Shared & { text: string; size: number }): JSX.Element {
  return (
    <Box style={{ alignItems: 'center', gap: env.px(Math.round(size * 0.55)), flexShrink: 0 }}>
      <CheckBadge
        env={env}
        size={Math.round(size * 1.5)}
        background={env.palette.color[look.check.background]}
        ink={env.palette.color[look.check.ink]}
      />
      <Text env={env} size={size} color={secondary} weight={500} leading={1.25}>
        {text}
      </Text>
    </Box>
  );
}

/** One run of mono text: ids, addresses and links. */
export function Mono({
  env,
  size,
  color,
  weight = 400,
  children,
}: {
  env: CardEnv;
  size: number;
  color: string;
  weight?: 400 | 500;
  children: string;
}): JSX.Element {
  return (
    <Text env={env} size={size} color={color} family="mono" weight={weight} leading={1.35}>
      {children}
    </Text>
  );
}

/* Legend ----------------------------------------------------------------------------------------------------- */

export function LegendItem({ env, item, size }: { env: CardEnv; item: CardLegendItem; size: number }): JSX.Element {
  const { px } = env;
  return (
    <Box style={{ alignItems: 'center', gap: px(Math.round(size * 0.36)) }}>
      <Dot env={env} kind={item.kind} size={Math.round(size * 0.56)} />
      <Text env={env} size={size} color={legendColors(env, item.kind).text} weight={600} tracking={-0.01}>
        {item.share}
      </Text>
      <Text env={env} size={size} color={env.palette.color.inkSecondary} weight={500}>
        {item.label}
      </Text>
    </Box>
  );
}

/** Spend on the left over the rail's apricot, the equity share on the right over its green. */
export function LegendRow({ env, legend, size }: { env: CardEnv; legend: readonly CardLegendItem[]; size: number }): JSX.Element {
  return (
    <Box style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: env.px(32), rowGap: env.px(12) }}>
      {legend.map((item) => (
        <LegendItem key={item.kind} env={env} item={item} size={size} />
      ))}
    </Box>
  );
}

/** A legend item for a narrow stub: the share large, its words under it, and an amount when one is shown. */
export function StackedLegendItem({
  env,
  item,
  size,
  amount,
}: {
  env: CardEnv;
  item: CardLegendItem;
  size: number;
  amount?: string;
}): JSX.Element {
  const { px } = env;
  return (
    <Box style={{ alignItems: 'flex-start', gap: px(Math.round(size * 0.36)) }}>
      <Box style={{ paddingTop: px(Math.round(size * 0.3)) }}>
        <Dot env={env} kind={item.kind} size={Math.round(size * 0.5)} />
      </Box>
      <Box style={{ flexDirection: 'column', gap: px(3), flexShrink: 1 }}>
        <Text env={env} size={size} color={legendColors(env, item.kind).text} weight={600} tracking={-0.015} leading={1.05}>
          {item.share}
        </Text>
        <Text env={env} size={Math.round(size * 0.6)} color={env.palette.color.inkSecondary} weight={500} leading={1.25}>
          {item.label}
        </Text>
        {amount === undefined ? null : (
          <Text env={env} size={Math.round(size * 0.6)} color={env.palette.color.ink} weight={600} leading={1.3}>
            {amount}
          </Text>
        )}
      </Box>
    </Box>
  );
}

/* Amounts ---------------------------------------------------------------------------------------------------- */

export interface AmountPanelProps {
  env: CardEnv;
  /** Which sleeve the money is in: spendable, waiting for the market, or a Stock Token. */
  tone: 'spend' | 'waiting' | 'equity';
  share?: string;
  label: string;
  value: string;
  token: CardToken;
  detail?: string;
  size: number;
}

const PANEL_TONE = {
  spend: { background: 'spendSurface', border: 'spendBorder', text: 'spendText' },
  waiting: { background: 'surfaceMuted', border: 'border', text: 'waitingText' },
  equity: { background: 'equitySurface', border: 'equityBorder', text: 'equityText' },
} as const;

/**
 * One sleeve of a payday with its amount and its token's icon (DESIGN.md 2.5: spend on the apricot surface, the
 * Stock Token on the green one, amounts in ink on both).
 */
export function AmountPanel({ env, tone, share, label, value, token, detail, size }: AmountPanelProps): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  const keys = PANEL_TONE[tone];
  return (
    <Box
      style={{
        flexDirection: 'column',
        flexGrow: 1,
        flexBasis: 0,
        gap: px(Math.round(size * 0.32)),
        padding: pad(env, Math.round(size * 0.66), Math.round(size * 0.74)),
        borderRadius: px(Math.round(size * 0.8)),
        backgroundColor: color[keys.background],
        border: `${cssLength(px(2))} solid ${color[keys.border]}`,
      }}
    >
      <Box style={{ alignItems: 'center', justifyContent: 'space-between', gap: px(Math.round(size * 0.3)) }}>
        <Box style={{ alignItems: 'center', gap: px(Math.round(size * 0.28)), flexShrink: 1 }}>
          {tone === 'waiting' ? (
            <StripeChip env={env} size={Math.round(size * 0.5)} />
          ) : (
            <Dot env={env} kind={tone} size={Math.round(size * 0.44)} />
          )}
          {share === undefined ? null : (
            <Text env={env} size={Math.round(size * 0.66)} color={color[keys.text]} weight={600}>
              {share}
            </Text>
          )}
          <Text env={env} size={Math.round(size * 0.66)} color={color.inkSecondary} weight={500}>
            {label}
          </Text>
        </Box>
        <TokenMark env={env} token={token} size={Math.round(size * 1.05)} />
      </Box>
      <Text env={env} size={size} color={color.ink} weight={600} tracking={-0.02} leading={1.1}>
        {value}
      </Text>
      {detail === undefined ? null : (
        <Text env={env} size={Math.round(size * 0.6)} color={color.inkSecondary} weight={500}>
          {detail}
        </Text>
      )}
    </Box>
  );
}

/** Two panels side by side with an arrow tile between them when one became the other. */
export function PanelPair({
  env,
  left,
  right,
  arrow,
  size,
}: {
  env: CardEnv;
  left: ReactNode;
  right: ReactNode;
  arrow: boolean;
  size: number;
}): JSX.Element {
  const { px } = env;
  return (
    <Box style={{ alignItems: 'stretch', gap: px(arrow ? 10 : 16) }}>
      {left}
      {arrow ? (
        <Box style={{ alignItems: 'center', flexShrink: 0 }}>
          <ArrowTile env={env} size={size} direction="right" />
        </Box>
      ) : null}
      {right}
    </Box>
  );
}

/* Week ------------------------------------------------------------------------------------------------------- */

export interface PaydayBarsProps {
  env: CardEnv;
  count: number;
  rail: CardRail;
  width: number;
  height: number;
  gap: number;
  /** Bars drawn before the rest become a count. */
  max: number;
  /** The equity color, for bars drawn on a green face. */
  equity: string;
  countColor: string;
}

/**
 * One bar per payday the rule split, a capsule with the equity share on top and spend under it (DESIGN.md 2.4
 * stacking), all the same height because a card without amounts shows the week's shape, never its size.
 */
export function PaydayBars({ env, count, rail, width, height, gap, max, equity, countColor }: PaydayBarsProps): JSX.Element | null {
  const { px } = env;
  if (count <= 0) return null;
  const shown = count > max ? max - 1 : count;
  const rest = count - shown;
  const seam = Math.max(3, Math.round(width / 10));
  const least = Math.round(height * 0.14);
  return (
    <Box style={{ alignItems: 'flex-end', gap: px(gap) }}>
      {Array.from({ length: shown }, (_, index) => (
        <Box
          key={index}
          style={{
            flexDirection: 'column',
            width: px(width),
            height: px(height),
            gap: px(seam),
            flexShrink: 0,
            borderRadius: px(width),
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexGrow: rail.equityBps, flexBasis: 0, minHeight: px(least), backgroundColor: equity }} />
          <div
            style={{
              display: 'flex',
              flexGrow: rail.spendBps,
              flexBasis: 0,
              minHeight: px(least),
              backgroundColor: env.palette.color.spend,
            }}
          />
        </Box>
      ))}
      {rest > 0 ? (
        <Box style={{ height: px(height), alignItems: 'center', paddingLeft: px(Math.round(gap / 2)) }}>
          <Text env={env} size={Math.round(Math.max(width, 24) * 0.8)} color={countColor} weight={600}>
            {`+${rest}`}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Up to three token marks overlapping, for a week that bought more than one Stock Token. */
export function TokenStackMark({ env, tokens, size }: { env: CardEnv; tokens: readonly CardToken[]; size: number }): JSX.Element {
  const { px } = env;
  const shown = tokens.slice(0, 3);
  return (
    <Box style={{ alignItems: 'center' }}>
      {shown.map((token, index) => (
        <Box
          key={token.key}
          style={{
            marginLeft: index === 0 ? 0 : px(-Math.round(size * 0.32)),
            borderRadius: px(Math.round(size * 0.36)),
            border: `${cssLength(px(Math.max(2, Math.round(size / 16))))} solid ${env.palette.color.surface}`,
          }}
        >
          <TokenMark env={env} token={token} size={size} />
        </Box>
      ))}
    </Box>
  );
}

/* Proof ------------------------------------------------------------------------------------------------------ */

/** A label in words beside a machine value in mono (DESIGN.md 4.3: mono only for machine values). */
function ProofRow({
  env,
  label,
  value,
  size,
  mono,
}: {
  env: CardEnv;
  label: string;
  value: string;
  size: number;
  mono: boolean;
}): JSX.Element {
  const color = env.palette.color;
  return (
    <Box style={{ alignItems: 'baseline', gap: env.px(Math.round(size * 0.6)) }}>
      <Text env={env} size={size} color={color.inkSecondary} weight={500} style={{ width: env.px(Math.round(size * 4.6)), flexShrink: 0 }}>
        {label}
      </Text>
      <Text
        env={env}
        size={size}
        color={color.ink}
        weight={mono ? 400 : 500}
        family={mono ? 'mono' : 'sans'}
        leading={1.35}
        style={{ flexShrink: 1 }}
      >
        {value}
      </Text>
    </Box>
  );
}

/** Receipt numbers, the account and where anyone can check them, beside a QR code to the verifier. */
export function ProofTape({ env, proof, size, qr }: { env: CardEnv; proof: CardProofView; size: number; qr: number }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  const many = proof.receiptIds.length > 1;
  return (
    <Box
      style={{
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: px(24),
        padding: pad(env, Math.round(size * 0.9), Math.round(size * 1.1)),
        borderRadius: px(Math.round(size * 1.1)),
        backgroundColor: color.surfaceMuted,
      }}
    >
      <Box style={{ flexDirection: 'column', gap: px(Math.round(size * 0.4)), flexShrink: 1 }}>
        <ProofRow env={env} size={size} mono label={many ? 'Receipts' : 'Receipt'} value={proofIds(proof)} />
        <ProofRow env={env} size={size} mono label="Account" value={proof.account} />
        <ProofRow env={env} size={size} mono={false} label="Network" value={proof.network} />
        {proof.verifyLabel === null ? null : <ProofRow env={env} size={size} mono label="Check at" value={proof.verifyLabel} />}
      </Box>
      {proof.verifyUrl === null ? null : (
        <Box style={{ padding: px(8), borderRadius: px(14), backgroundColor: color.surface, flexShrink: 0 }}>
          <QrMark env={env} value={proof.verifyUrl} size={qr} />
        </Box>
      )}
    </Box>
  );
}

/** "455" or "455, 560, 611 and 642": the receipt list without its leading word. */
function proofIds(proof: CardProofView): string {
  return proof.receipts.replace(/^Receipts? /, '');
}

/** The narrow stub's proof: the QR code and the numbers it leads to. */
export function CompactProof({ env, proof, qr }: { env: CardEnv; proof: CardProofView; qr: number }): JSX.Element {
  const { px } = env;
  const color = env.palette.color;
  return (
    <Box style={{ alignItems: 'center', gap: px(14) }}>
      {proof.verifyUrl === null ? null : <QrMark env={env} value={proof.verifyUrl} size={qr} />}
      <Box style={{ flexDirection: 'column', gap: px(3), flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
        <Text env={env} size={13} color={color.inkSecondary} weight={500}>
          {proof.receiptIds.length > 1 ? 'Receipts' : 'Receipt'}
        </Text>
        <Mono env={env} size={15} color={color.ink} weight={500}>
          {proofIds(proof)}
        </Mono>
        <Mono env={env} size={14} color={color.inkSecondary}>
          {proof.account}
        </Mono>
      </Box>
    </Box>
  );
}

export function Disclaimer({ env, text, size }: { env: CardEnv; text: string; size: number }): JSX.Element {
  return (
    <Text env={env} size={size} color={env.palette.color.inkSecondary} weight={400} leading={1.35}>
      {text}
    </Text>
  );
}
