import type { JSX } from 'react';

import {
  AmountPanel,
  CompactProof,
  Disclaimer,
  EdgeRail,
  Header,
  Knockout,
  LegendRow,
  Mono,
  PanelPair,
  PaydayBars,
  ProofTape,
  Spacer,
  StackedLegendItem,
  Stamp,
  Ticket,
  TokenChip,
  TokenStackMark,
  type Shared,
} from './art-blocks';
import { Box, Fill, SampleNote, SampleStrip, Text, TokenMark, pad } from './art-parts';
import type { CardEnv } from './card-env';
import { CARD_FORMATS, type CardFormat } from './card-options';
import { CARD_THEME_LOOKS, type CardTheme } from './card-themes';
import { USDG_CARD_TOKEN, type CardView, type PaydayCardView, type WeekCardView } from './card-view';

/**
 * The shareable card as one picture (PRD 7.10, D-024), drawn by the page for the preview and by next/og for the PNG
 * and the OpenGraph image, from the same code. The face says what the payday or the week became; the stub under the
 * perforation carries the split, the amounts and the proof when the owner showed them, and the card's address; the
 * split rail runs along the bottom edge.
 */

export interface CardArtProps {
  view: CardView;
  format: CardFormat;
  theme: CardTheme;
  env: CardEnv;
}

const STRIP = { height: 64, size: 26 } as const;
const MARGIN: Record<CardFormat, number> = { post: 40, wide: 26 };
const STUB_WIDTH = 350;

export function CardArt({ view, format, theme, env }: CardArtProps): JSX.Element {
  const look = CARD_THEME_LOOKS[theme];
  const shared: Shared = { env, look, ink: env.palette.color[look.faceInk], secondary: env.palette.color[look.faceSecondary] };
  const { width, height } = CARD_FORMATS[format];
  const post = format === 'post';
  const content = (() => {
    if (post) return view.kind === 'payday' ? <PaydayPost view={view} {...shared} /> : <WeekPost view={view} {...shared} />;
    return view.kind === 'payday' ? <PaydayWide view={view} {...shared} /> : <WeekWide view={view} {...shared} />;
  })();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        width: env.px(width),
        height: env.px(height),
        overflow: 'hidden',
        fontFamily: env.fonts.sans,
        color: env.palette.color.ink,
      }}
    >
      <Fill background={look.backdrop} env={env} />
      {post && view.sampleLine !== null ? <SampleStrip env={env} line={view.sampleLine} height={STRIP.height} size={STRIP.size} /> : null}
      <Box style={{ position: 'relative', flexGrow: 1, flexBasis: 0, padding: env.px(MARGIN[format]) }}>{content}</Box>
    </div>
  );
}

/**
 * How full the stub is: the statement gives up height as amounts and proof take it, so nothing leaves the card.
 * Proof takes more room than amounts, because it carries the QR code and the network line with the disclaimer.
 */
function density(view: CardView): 0 | 1 | 2 | 3 {
  if (view.proof === null) return view.amounts === null ? 0 : 1;
  return view.amounts === null ? 2 : 3;
}

/** A figure keeps its width: "10%" at full size, "100%" or "12.5%" smaller. */
function figureSize(figure: string, base: number): number {
  if (figure.length <= 3) return base;
  return Math.round(base * (figure.length === 4 ? 0.8 : 0.66));
}

/* Payday card, post ---------------------------------------------------------------------------------------------- */

const PAYDAY_POST = [
  { figure: 360, lead: 50, token: 108, debt: 34, stamp: 30, gap: 30, pad: 56 },
  { figure: 250, lead: 44, token: 92, debt: 31, stamp: 28, gap: 22, pad: 48 },
  { figure: 212, lead: 42, token: 86, debt: 30, stamp: 27, gap: 20, pad: 46 },
  { figure: 150, lead: 36, token: 70, debt: 28, stamp: 24, gap: 14, pad: 40 },
] as const;

function PaydayPost({ view, ...shared }: Shared & { view: PaydayCardView }): JSX.Element {
  const { env, ink, secondary } = shared;
  const { px } = env;
  const type = PAYDAY_POST[density(view)];
  const color = env.palette.color;

  const face = (
    <Box style={{ position: 'relative', flexDirection: 'column', flexGrow: 1, padding: pad(env, type.pad, 64, type.pad - 8) }}>
      <Header {...shared} dateLine={view.dateLine} brandSize={44} dateSize={30} />
      <Spacer env={env} min={36} />
      <Box style={{ flexDirection: 'column', flexShrink: 0 }}>
        <Text env={env} size={figureSize(view.figure, type.figure)} color={ink} weight={600} tracking={-0.055} leading={0.84}>
          {view.figure}
        </Text>
        <Text
          env={env}
          size={type.lead}
          color={secondary}
          weight={500}
          tracking={-0.015}
          style={{ marginTop: px(Math.round(type.gap * 0.7)) }}
        >
          {view.lead}
        </Text>
        <Box style={{ marginTop: px(type.gap) }}>
          <Knockout {...shared} token={view.token} size={type.token} />
        </Box>
        {view.debtLine === null ? null : (
          <Text env={env} size={type.debt} color={secondary} weight={500} style={{ marginTop: px(Math.round(type.gap * 0.7)) }}>
            {view.debtLine}
          </Text>
        )}
      </Box>
      {view.stamp === null ? null : (
        <Box style={{ marginTop: px(type.gap + 22) }}>
          <Stamp {...shared} text={view.stamp} size={type.stamp} />
        </Box>
      )}
    </Box>
  );

  const stub = (
    <Box style={{ flexDirection: 'column', gap: px(Math.max(16, type.gap - 4)), padding: pad(env, 38, 64, 30) }}>
      {view.amounts === null ? <LegendRow env={env} legend={view.legend} size={34} /> : <PaydayAmountsBlock view={view} env={env} />}
      {view.proof === null ? null : <ProofTape env={env} proof={view.proof} size={23} qr={view.amounts === null ? 172 : 148} />}
      {view.disclaimer === null ? null : <Disclaimer env={env} text={view.disclaimer} size={19} />}
      {view.link === null ? null : (
        <Mono env={env} size={24} color={color.inkMuted}>
          {view.link}
        </Mono>
      )}
    </Box>
  );

  return <Ticket {...shared} format="post" face={face} stub={stub} rail={<EdgeRail env={env} rail={view.rail} height={36} />} />;
}

/** A payday's amounts as its two sleeves: what stayed spendable and what became the Stock Token, each with its icon. */
function PaydayAmountsBlock({ view, env }: { view: PaydayCardView; env: CardEnv }): JSX.Element | null {
  const { px } = env;
  const amounts = view.amounts;
  if (amounts === null) return null;
  const [spend, equity] = view.legend;
  if (amounts.arrived === null || amounts.spendable === null) {
    // A settled buy records the wait and the buy, not the payment: the waiting USDG, then the Stock Token.
    return (
      <Box style={{ flexDirection: 'column', gap: px(18) }}>
        <LegendRow env={env} legend={view.legend} size={30} />
        <PanelPair
          env={env}
          arrow
          size={48}
          left={<AmountPanel env={env} tone="waiting" label="waited as USDG" value={amounts.spent} token={USDG_CARD_TOKEN} size={32} />}
          right={
            <AmountPanel
              env={env}
              tone="equity"
              label={`became ${view.token.symbol}`}
              value={amounts.bought}
              token={view.token}
              size={32}
            />
          }
        />
      </Box>
    );
  }
  return (
    <Box style={{ flexDirection: 'column', gap: px(18) }}>
      <Box style={{ alignItems: 'center', gap: px(16) }}>
        <TokenMark env={env} token={USDG_CARD_TOKEN} size={46} />
        <Text env={env} size={32} color={env.palette.color.ink} weight={600} tracking={-0.015}>
          {amounts.arrived}
        </Text>
        <Text env={env} size={30} color={env.palette.color.inkSecondary} weight={500}>
          arrived
        </Text>
      </Box>
      <PanelPair
        env={env}
        arrow={false}
        size={48}
        left={
          <AmountPanel
            env={env}
            tone="spend"
            share={spend?.share}
            label={spend?.label ?? ''}
            value={amounts.spendable}
            token={USDG_CARD_TOKEN}
            size={34}
          />
        }
        right={
          <AmountPanel
            env={env}
            tone="equity"
            share={equity?.share}
            label={equity?.label ?? ''}
            value={amounts.bought}
            token={view.token}
            detail={`for ${amounts.spent}`}
            size={34}
          />
        }
      />
    </Box>
  );
}

/* Payday card, wide ---------------------------------------------------------------------------------------------- */

function PaydayWide({ view, ...shared }: Shared & { view: PaydayCardView }): JSX.Element {
  const { env, ink, secondary } = shared;
  const { px } = env;
  const color = env.palette.color;
  const amounts = view.amounts;
  const [spend, equity] = view.legend;

  const face = (
    <Box style={{ position: 'relative', flexDirection: 'column', flexGrow: 1, padding: pad(env, 30, 40, 40) }}>
      <Header {...shared} dateLine={view.dateLine} brandSize={30} dateSize={20} />
      <Spacer env={env} min={18} />
      <Box style={{ alignItems: 'flex-end', gap: px(30), flexShrink: 0 }}>
        <Text env={env} size={figureSize(view.figure, 236)} color={ink} weight={600} tracking={-0.055} leading={0.84}>
          {view.figure}
        </Text>
        <Box style={{ flexDirection: 'column', gap: px(14), paddingBottom: px(4), flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          <Text env={env} size={28} color={secondary} weight={500} tracking={-0.01} leading={1.15}>
            {view.lead}
          </Text>
          <Knockout {...shared} token={view.token} size={64} />
          {view.debtLine === null ? null : (
            <Text env={env} size={21} color={secondary} weight={500}>
              {view.debtLine}
            </Text>
          )}
        </Box>
      </Box>
      <Spacer env={env} min={18} />
      <Box style={{ flexShrink: 0 }}>
        {amounts === null ? (
          view.stamp === null ? null : (
            <Stamp {...shared} text={view.stamp} size={19} />
          )
        ) : (
          <Text env={env} size={19} color={secondary} weight={500}>
            {amounts.arrived === null
              ? `${amounts.spent} waited as USDG, then became ${amounts.bought}.`
              : `${amounts.arrived} arrived. ${amounts.spent} became ${amounts.bought}.`}
          </Text>
        )}
      </Box>
    </Box>
  );

  const stub = (
    <Box style={{ flexDirection: 'column', flexGrow: 1, padding: pad(env, 26, 28, 20) }}>
      {view.sampleLine === null ? null : <SampleNote env={env} line={view.sampleLine} size={14} />}
      <Spacer env={env} min={14} />
      <Box style={{ flexDirection: 'column', gap: px(view.proof === null ? 18 : 12) }}>
        {spend === undefined ? null : (
          <StackedLegendItem env={env} item={spend} size={view.proof === null ? 34 : 28} amount={amounts?.spendable ?? undefined} />
        )}
        {equity === undefined ? null : (
          <StackedLegendItem
            env={env}
            item={equity}
            size={view.proof === null ? 34 : 28}
            amount={amounts === null ? undefined : amounts.bought}
          />
        )}
      </Box>
      <Spacer env={env} min={14} />
      {view.proof === null ? null : (
        <Box style={{ flexDirection: 'column', marginBottom: px(16) }}>
          <CompactProof env={env} proof={view.proof} qr={84} />
        </Box>
      )}
      {view.link === null ? null : (
        <Mono env={env} size={14} color={color.inkMuted}>
          {view.link}
        </Mono>
      )}
    </Box>
  );

  return (
    <Ticket
      {...shared}
      format="wide"
      face={face}
      stub={stub}
      stubWidth={STUB_WIDTH}
      rail={<EdgeRail env={env} rail={view.rail} height={16} />}
    />
  );
}

/* Week card, post ------------------------------------------------------------------------------------------------ */

const WEEK_POST = [
  { figure: 300, lead: 46, barWidth: 40, barHeight: 112, chip: 70, line: 32, stamp: 30, gap: 30, pad: 56 },
  { figure: 250, lead: 42, barWidth: 36, barHeight: 96, chip: 64, line: 30, stamp: 28, gap: 24, pad: 48 },
  { figure: 230, lead: 40, barWidth: 34, barHeight: 88, chip: 62, line: 29, stamp: 27, gap: 22, pad: 46 },
  { figure: 170, lead: 36, barWidth: 30, barHeight: 70, chip: 54, line: 27, stamp: 24, gap: 14, pad: 40 },
] as const;

function WeekPost({ view, ...shared }: Shared & { view: WeekCardView }): JSX.Element {
  const { env, look, ink, secondary } = shared;
  const { px } = env;
  const color = env.palette.color;
  const type = WEEK_POST[density(view)];
  const figure = figureSize(view.figure, type.figure);

  const face = (
    <Box style={{ position: 'relative', flexDirection: 'column', flexGrow: 1, padding: pad(env, type.pad, 64, type.pad - 8) }}>
      <Header {...shared} dateLine={view.dateLine} brandSize={44} dateSize={30} />
      <Spacer env={env} min={36} />
      <Box style={{ alignItems: 'flex-end', gap: px(30), flexShrink: 0 }}>
        <Text env={env} size={figure} color={ink} weight={600} tracking={-0.05} leading={0.84}>
          {view.figure}
        </Text>
        <Box
          style={{
            flexDirection: 'column',
            gap: px(Math.round(type.gap * 0.7)),
            paddingBottom: px(Math.round(figure * 0.03)),
            flexShrink: 1,
          }}
        >
          <Text env={env} size={type.lead} color={secondary} weight={500} tracking={-0.015} leading={1.1}>
            {view.lead}
          </Text>
          <PaydayBars
            env={env}
            count={view.paydays}
            rail={view.rail}
            width={type.barWidth}
            height={type.barHeight}
            gap={Math.round(type.barWidth * 0.34)}
            max={10}
            equity={color[look.markEquity]}
            countColor={secondary}
          />
        </Box>
      </Box>
      <Box
        style={{ alignItems: 'center', flexWrap: 'wrap', columnGap: px(16), rowGap: px(12), marginTop: px(type.gap + 14), flexShrink: 0 }}
      >
        <Text env={env} size={type.line} color={secondary} weight={500}>
          {view.boughtLine}
        </Text>
        {view.tokens.map((token) => (
          <TokenChip key={token.key} {...shared} token={token} size={type.chip} />
        ))}
      </Box>
      {view.debtLine === null ? null : (
        <Text env={env} size={type.line} color={secondary} weight={500} style={{ marginTop: px(Math.round(type.gap * 0.5)) }}>
          {view.debtLine}
        </Text>
      )}
      {view.stamp === null ? null : (
        <Box style={{ marginTop: px(type.gap + 16) }}>
          <Stamp {...shared} text={view.stamp} size={type.stamp} />
        </Box>
      )}
    </Box>
  );

  const stub = (
    <Box style={{ flexDirection: 'column', gap: px(Math.max(16, type.gap - 4)), padding: pad(env, 36, 64, 30) }}>
      <Box style={{ flexDirection: 'column', gap: px(14) }}>
        <Text env={env} size={24} color={color.inkSecondary} weight={500}>
          {view.legendTitle}
        </Text>
        <LegendRow env={env} legend={view.legend} size={32} />
      </Box>
      {view.amounts === null ? null : <WeekAmountsBlock view={view} env={env} />}
      {view.proof === null ? null : <ProofTape env={env} proof={view.proof} size={22} qr={view.amounts === null ? 160 : 136} />}
      {view.disclaimer === null ? null : <Disclaimer env={env} text={view.disclaimer} size={19} />}
      {view.link === null ? null : (
        <Mono env={env} size={24} color={color.inkMuted}>
          {view.link}
        </Mono>
      )}
    </Box>
  );

  return <Ticket {...shared} format="post" face={face} stub={stub} rail={<EdgeRail env={env} rail={view.rail} height={36} />} />;
}

/** The week in USDG: what arrived and what bought Stock Tokens, each beside its icons. */
function WeekAmountsBlock({ view, env }: { view: WeekCardView; env: CardEnv }): JSX.Element | null {
  const { px } = env;
  const color = env.palette.color;
  const amounts = view.amounts;
  if (amounts === null) return null;
  const row = (icon: JSX.Element, label: string, value: string) => (
    <Box style={{ alignItems: 'center', justifyContent: 'space-between', gap: px(20) }}>
      <Box style={{ alignItems: 'center', gap: px(16) }}>
        {icon}
        <Text env={env} size={28} color={color.inkSecondary} weight={500}>
          {label}
        </Text>
      </Box>
      <Text env={env} size={30} color={color.ink} weight={600} tracking={-0.015}>
        {value}
      </Text>
    </Box>
  );
  return (
    <Box
      style={{ flexDirection: 'column', gap: px(14), padding: pad(env, 20, 24), borderRadius: px(24), backgroundColor: color.surfaceMuted }}
    >
      {row(<TokenMark env={env} token={USDG_CARD_TOKEN} size={40} />, 'Arrived this week', amounts.arrived)}
      {row(
        view.tokens.length === 0 ? (
          <TokenMark env={env} token={USDG_CARD_TOKEN} size={40} />
        ) : (
          <TokenStackMark env={env} tokens={view.tokens} size={40} />
        ),
        'Bought Stock Tokens',
        amounts.bought,
      )}
    </Box>
  );
}

/* Week card, wide ------------------------------------------------------------------------------------------------ */

function WeekWide({ view, ...shared }: Shared & { view: WeekCardView }): JSX.Element {
  const { env, look, ink, secondary } = shared;
  const { px } = env;
  const color = env.palette.color;
  const amounts = view.amounts;
  const [spend, equity] = view.legend;

  const face = (
    <Box style={{ position: 'relative', flexDirection: 'column', flexGrow: 1, padding: pad(env, 30, 40, 40) }}>
      <Header {...shared} dateLine={view.dateLine} brandSize={30} dateSize={20} />
      <Spacer env={env} min={18} />
      <Box style={{ alignItems: 'flex-end', gap: px(28), flexShrink: 0 }}>
        <Text env={env} size={figureSize(view.figure, 236)} color={ink} weight={600} tracking={-0.05} leading={0.84}>
          {view.figure}
        </Text>
        <Box style={{ flexDirection: 'column', gap: px(16), paddingBottom: px(6), flexGrow: 1, flexShrink: 1, flexBasis: 0 }}>
          <Text env={env} size={28} color={secondary} weight={500} tracking={-0.01} leading={1.15}>
            {view.lead}
          </Text>
          <PaydayBars
            env={env}
            count={view.paydays}
            rail={view.rail}
            width={26}
            height={72}
            gap={9}
            max={12}
            equity={color[look.markEquity]}
            countColor={secondary}
          />
        </Box>
      </Box>
      <Spacer env={env} min={18} />
      <Box style={{ alignItems: 'center', flexWrap: 'wrap', columnGap: px(14), rowGap: px(10), flexShrink: 0 }}>
        {view.tokens.length === 0 ? (
          <Text env={env} size={20} color={secondary} weight={500}>
            {view.boughtLine}
          </Text>
        ) : (
          view.tokens.map((token) => <TokenChip key={token.key} {...shared} token={token} size={44} />)
        )}
        {view.debtLine === null ? null : (
          <Text env={env} size={20} color={secondary} weight={500}>
            {view.debtLine}
          </Text>
        )}
      </Box>
    </Box>
  );

  const stub = (
    <Box style={{ flexDirection: 'column', flexGrow: 1, padding: pad(env, 26, 28, 20) }}>
      {view.sampleLine === null ? null : <SampleNote env={env} line={view.sampleLine} size={14} />}
      <Spacer env={env} min={14} />
      <Box style={{ flexDirection: 'column', gap: px(12) }}>
        <Text env={env} size={16} color={color.inkSecondary} weight={500}>
          {view.legendTitle}
        </Text>
        {spend === undefined ? null : <StackedLegendItem env={env} item={spend} size={view.proof === null && amounts === null ? 32 : 26} />}
        {equity === undefined ? null : (
          <StackedLegendItem env={env} item={equity} size={view.proof === null && amounts === null ? 32 : 26} />
        )}
        {amounts === null ? null : (
          <Box style={{ flexDirection: 'column', gap: px(2) }}>
            <Text env={env} size={16} color={color.ink} weight={600}>
              {`${amounts.arrived} arrived`}
            </Text>
            <Text env={env} size={16} color={color.inkSecondary} weight={500}>
              {`${amounts.bought} bought Stock Tokens`}
            </Text>
          </Box>
        )}
      </Box>
      <Spacer env={env} min={14} />
      {view.proof === null ? null : (
        <Box style={{ flexDirection: 'column', marginBottom: px(16) }}>
          <CompactProof env={env} proof={view.proof} qr={76} />
        </Box>
      )}
      {view.link === null ? null : (
        <Mono env={env} size={14} color={color.inkMuted}>
          {view.link}
        </Mono>
      )}
    </Box>
  );

  return (
    <Ticket
      {...shared}
      format="wide"
      face={face}
      stub={stub}
      stubWidth={STUB_WIDTH}
      rail={<EdgeRail env={env} rail={view.rail} height={16} />}
    />
  );
}
