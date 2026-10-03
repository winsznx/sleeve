import { RULE_DEFAULTS, formatBps, formatUsdg } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { percentWords } from '@/components/sleeve/text';
import { tickerTokenKey } from '@/components/token/ticker-icon';
import { Badge } from '@/components/ui/badge';
import { cx } from '@/components/ui/cx';
import type { IconName } from '@/components/ui/icons';

import { EYEBROWS, SECTION_IDS } from './copy';
import { CenteredHeading, Eyebrow, IconDisc, LandingSection } from './primitives';
import { SellArt } from './sell-art';
import { SessionArt } from './session-art';
import { TokenChip } from './widgets';

/**
 * closeout's three-card grid with one saturated card (blueprint section 5): it splits, it waits, you can sell back.
 * Each card carries a working piece of the product instead of an empty panel (blueprint defect 10).
 */
export function Features(): JSX.Element {
  return (
    <LandingSection id={SECTION_IDS.features} titleId="features-title">
      <CenteredHeading
        titleId="features-title"
        eyebrow={<Eyebrow>{EYEBROWS.features}</Eyebrow>}
        title="One rule, every payment"
        lead="Your rule runs without you, the buy waits for the market when it must, and you can sell back to USDG whenever you choose."
      />
      <div className="mt-10 grid gap-[1.375rem] md:mt-14 lg:grid-cols-3">
        <FeatureCard
          id={SECTION_IDS.rule}
          icon="rule"
          title="It splits on arrival"
          body="Pick the equity share and the Stock Token once. Every USDG payment to your address splits by that rule, with nothing to sign."
        >
          <RuleMock />
        </FeatureCard>
        <FeatureCard
          featured
          icon="clock"
          title="It waits for the market"
          body="When the market is closed or the price runs past your cap, the equity share waits as USDG in your account and buys after the open."
        >
          <div className="flex flex-1 flex-col justify-center rounded-module border border-glass-light-edge bg-art-on-accent p-3 sm:p-3.5">
            <SessionArt />
          </div>
        </FeatureCard>
        <FeatureCard
          icon="sell"
          title="You can sell back to USDG"
          body="Need cash before the next payday? Sell a Stock Token back through the same check against its Chainlink price."
        >
          <SellArt className="flex-1" />
        </FeatureCard>
      </div>
    </LandingSection>
  );
}

interface FeatureCardProps {
  /** An anchor the navbar links to, when the card is the one place a topic lives. */
  id?: string;
  icon: IconName;
  title: string;
  body: string;
  featured?: boolean;
  children: ReactNode;
}

/**
 * A grey card, or the saturated green one. White text sits only on the feature gradient, which keeps it at 4.63 to 1
 * or more at every stop (docs/DESIGN.md 2.4), unlike closeout's 82 percent white on light blue.
 */
function FeatureCard({ id, icon, title, body, featured = false, children }: FeatureCardProps): JSX.Element {
  return (
    <article
      id={id}
      className={cx(
        'flex scroll-mt-24 flex-col gap-2.5 rounded-card px-5 py-6 sm:px-[1.625rem] sm:py-[1.875rem]',
        featured ? 'bg-feature text-on-accent' : 'bg-surface-muted text-ink',
      )}
    >
      <IconDisc name={icon} className="mb-2.5" />
      <h3 className="text-h2 font-medium">{title}</h3>
      <p className={cx('text-body-s', featured ? 'text-on-accent' : 'text-ink-secondary')}>{body}</p>
      <div className="mt-[1.125rem] flex flex-1 flex-col">{children}</div>
    </article>
  );
}

const SUGGESTED_TICKER = tickerTokenKey(RULE_DEFAULTS.tickerId);

/** The rule editor's two fields at the suggested start (PRD 7.3), with the guards that come with every rule. */
function RuleMock(): JSX.Element {
  return (
    <div className="flex flex-1 flex-col rounded-module bg-surface p-5">
      <p className="text-body font-semibold text-ink">The suggested start</p>
      <RuleField label="Spend share" value={formatBps(RULE_DEFAULTS.spendBps)} chip={<TokenChip token="USDG" />} className="mt-3.5" />
      <RuleField
        label="Equity share"
        value={formatBps(RULE_DEFAULTS.equityBps)}
        chip={SUGGESTED_TICKER === null ? null : <TokenChip token={SUGGESTED_TICKER} />}
        className="mt-2.5"
      />
      <SplitRail
        parts={{ spend: BigInt(RULE_DEFAULTS.spendBps), equity: BigInt(RULE_DEFAULTS.equityBps), waiting: 0n }}
        className="mt-4"
      />
      <p className="mt-4 flex items-start gap-2.5 border-t border-border pt-4 text-body-s text-ink-secondary">
        <Badge tone="equity" className="mt-px">
          Active
        </Badge>
        <span>Pause or change it any time. A change applies to the next split and never re-sorts money already split.</span>
      </p>
      <dl className="mt-auto grid grid-cols-2 gap-2.5 pt-5">
        <GuardTile term="Price cap" value={percentWords(RULE_DEFAULTS.premiumCapBps)} note="above the Chainlink price" />
        <GuardTile term="Minimum buy" value={`${formatUsdg(RULE_DEFAULTS.minClip)} USDG`} note="smaller amounts wait and add up" />
      </dl>
    </div>
  );
}

function GuardTile({ term, value, note }: { term: string; value: string; note: string }): JSX.Element {
  return (
    <div className="rounded-row border border-border px-3 py-2.5">
      <dt className="text-label text-ink-secondary">{term}</dt>
      <dd className="mt-0.5">
        <span className="block text-body-s font-semibold tabular-nums text-ink">{value}</span>
        <span className="block text-label text-ink-secondary">{note}</span>
      </dd>
    </div>
  );
}

function RuleField({ label, value, chip, className }: { label: string; value: string; chip: ReactNode; className?: string }): JSX.Element {
  return (
    <div className={cx('rounded-row bg-surface-muted px-3.5 py-3', className)}>
      <p className="text-label text-ink-secondary">{label}</p>
      <div className="mt-1 flex items-center justify-between gap-3">
        <p className="text-h2 tabular-nums text-ink">{value}</p>
        {chip}
      </div>
    </div>
  );
}
