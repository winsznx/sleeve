import { DISCLOSURE, REASONS, STATUSES, formatUsdg, tokenValueUsdg, type Status } from '@sleeve/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { HoldingRow } from '@/components/sleeve/holding-row';
import { InboxRow } from '@/components/sleeve/inbox-row';
import { PaymentAddressCard } from '@/components/sleeve/payment-address-card';
import { PremiumLine, premiumLinePropsOf } from '@/components/sleeve/premium-line';
import { ReceiptRow, ReceiptSummary } from '@/components/sleeve/receipt-summary';
import { RuleSummary } from '@/components/sleeve/rule-summary';
import { SleeveCard } from '@/components/sleeve/sleeve-card';
import { SplitLegend, SplitRail } from '@/components/sleeve/split-rail';
import { Amount } from '@/components/ui/amount';
import { Badge, CountBadge, GatedTag, ReasonTag, StatusTag, TickerChip, type BadgeTone } from '@/components/ui/badge';
import { Button, ButtonLink, IconButton, type ButtonSize, type ButtonVariant } from '@/components/ui/button';
import { Banner, Card, CardHeader, ErrorBlock, Note, Panel, StatTile } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { DebtSecurityLine, ExitLine } from '@/components/ui/debt-security-line';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState, LoadingState } from '@/components/ui/empty-state';
import { Footer } from '@/components/ui/footer';
import { GatedCard } from '@/components/ui/gated-card';
import { ICON_NAMES, Icon } from '@/components/ui/icons';
import { DefinitionList, List, ListRow } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { QRCode } from '@/components/ui/qr-code';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/skeleton';
import { ToastProvider } from '@/components/ui/toast';
import { SplitMark, Wordmark } from '@/components/ui/wordmark';
import { createMockDataLayer, SAMPLE_ACCOUNT, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import type { BucketView, Holding, ReceiptRecord } from '@/data/types';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';

import { BucketDemo, BusyButtonDemo, DialogDemo, FieldDemos, SplitReplay, TabsDemo, ToastDemo } from './interactive';
import { KitExample, KitGrid, KitSection } from './kit-section';

export const metadata: Metadata = { title: 'Component kit' };

const DAY = 86_400n;

/** Sample data from the mock's fixture world: the same numbers every screen sees in sample mode. */
async function loadKitData() {
  const layer = createMockDataLayer();
  const [ledger, rule, buckets, holdings, inbox, market, records, text] = await Promise.all([
    layer.getLedger(SAMPLE_ACCOUNT),
    layer.getRule(SAMPLE_ACCOUNT),
    layer.getBuckets(SAMPLE_ACCOUNT),
    layer.getHoldings(SAMPLE_ACCOUNT),
    layer.getInbox(SAMPLE_ACCOUNT),
    layer.getMarket(),
    Promise.all(Object.values(SAMPLE_RECEIPT_IDS).map((id) => layer.getReceipt(id))),
    readDisclosureText(),
  ]);
  const receipts = records
    .filter((record): record is ReceiptRecord => record !== null)
    .sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1));
  return { ledger, rule, buckets, holdings, inbox, market, receipts, paragraphs: disclosureParagraphs(text) };
}

const SECTIONS = [
  ['buttons', 'Buttons'],
  ['fields', 'Fields and choices'],
  ['cards', 'Cards and callouts'],
  ['tags', 'Tags'],
  ['lists', 'Lists'],
  ['tabs', 'Tabs'],
  ['overlays', 'Sheets, dialogs and toasts'],
  ['states', 'Empty and loading'],
  ['address', 'Payment address, copy and QR'],
  ['disclosure', 'Issuer disclosure'],
  ['lines', 'Required lines'],
  ['frame', 'Page frame'],
  ['gated', 'Gated features'],
  ['icons', 'Icons'],
  ['split', 'The split'],
  ['sleeves', 'Sleeves'],
  ['waiting', 'Waiting equity'],
  ['receipts', 'Receipts'],
  ['premium', 'Premium lines'],
  ['holdings', 'Holdings'],
  ['inbox', 'Inbox'],
  ['rule', 'Rule'],
  ['shell', 'App shell'],
] as const;

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'destructive'];
const SIZES: readonly ButtonSize[] = ['sm', 'md', 'lg'];
const TONES: readonly BadgeTone[] = ['equity', 'waiting', 'danger', 'neutral', 'success', 'info'];

/** The same holding after 0.01 of its token arrived from outside Sleeve: in the balance, in no lot. */
function withOutsideTokens(holding: Holding): Holding {
  const balance = holding.balance + 10_000_000_000_000_000n;
  return { ...holding, balance, value: tokenValueUsdg(balance, holding.feed.answer) };
}

function byStatus(receipts: readonly ReceiptRecord[], status: Status): ReceiptRecord | undefined {
  return receipts.find((record) => record.receipt.status === status);
}

export default async function KitPage(): Promise<JSX.Element> {
  const data = await loadKitData();
  const now = data.ledger.asOf.timestamp;
  const spy = data.market.tickers.find((ticker) => ticker.tickerId === 0);
  const spyBucket = data.buckets[0];
  const clipBucket: BucketView = { tickerId: 1, amount: 10_000_000n, since: now - 3n * 3_600n, reason: 'CLIP' };
  const longBucket: BucketView = { tickerId: 1, amount: 41_250_000n, since: now - 6n * DAY, reason: 'PREMIUM' };
  const firstHolding = data.holdings[0];
  const outsideHolding = firstHolding === undefined ? undefined : withOutsideTokens(firstHolding);
  const filled = byStatus(data.receipts, 'FILLED');
  const sold = byStatus(data.receipts, 'SOLD');
  const filledPremium = filled === undefined ? null : premiumLinePropsOf(filled.receipt);
  const soldPremium = sold === undefined ? null : premiumLinePropsOf(sold.receipt);

  const receiptList = (
    <List label="Sample receipts">
      {data.receipts.map((record) => (
        <ReceiptRow key={record.receipt.id.toString()} record={record} href={`/receipts/${record.receipt.id}`} />
      ))}
    </List>
  );
  const inboxList = (
    <List label="Sample inbound transfers">
      {data.inbox.map((item) => (
        <InboxRow key={item.id} item={item} />
      ))}
    </List>
  );
  const holdingList = (
    <List label="Sample holdings">
      {data.holdings.map((holding) => (
        <HoldingRow key={holding.tickerId} holding={holding} href="/sell" />
      ))}
    </List>
  );

  return (
    <ToastProvider>
      <main className="mx-auto w-full max-w-content px-gutter pb-16 pt-8">
        <header className="pb-8">
          <Wordmark href="/" />
          <h1 className="mt-4 text-h1 text-ink">Component kit</h1>
          <p className="mt-2 max-w-reading text-body text-ink-secondary">
            Every shared component in its states, on the sample data the mock serves. Rules for each piece are in
            docs/DESIGN.md. Nothing in the app links here.
          </p>
          <nav aria-label="Kit sections" className="mt-6">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-body-s">
              {SECTIONS.map(([id, title]) => (
                <li key={id}>
                  <a href={`#${id}`} className="inline-flex min-h-touch items-center text-link underline underline-offset-4 hover:text-link-hover">
                    {title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <KitSection id="buttons" title="Buttons" description="Pills. Black is the action color and there are no green buttons (11.1).">
          {VARIANTS.map((variant) => (
            <KitExample key={variant} label={`${variant}, small, default, large, disabled`}>
              <div className="flex flex-wrap items-center gap-3">
                {SIZES.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {variant === 'destructive' ? 'Uninstall Sleeve' : 'Save rule'}
                  </Button>
                ))}
                <Button variant={variant} disabled>
                  {variant === 'destructive' ? 'Uninstall Sleeve' : 'Save rule'}
                </Button>
              </div>
            </KitExample>
          ))}
          <KitGrid>
            <KitExample label="With an icon, and as a link">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" icon="copy">
                  Copy address
                </Button>
                <ButtonLink href="/receipts" variant="secondary" icon="receipt">
                  See receipts
                </ButtonLink>
              </div>
            </KitExample>
            <KitExample label="Busy: keeps its width, says the verb in progress">
              <BusyButtonDemo />
            </KitExample>
            <KitExample label="Icon buttons, 44 px, always named">
              <div className="flex items-center gap-1">
                <IconButton icon="copy" label="Copy receipt hash" />
                <IconButton icon="share" label="Share card" />
                <IconButton icon="close" label="Close" />
                <IconButton icon="more" label="More" disabled />
              </div>
            </KitExample>
            <KitExample label="Full width, the main action of a flow on a phone">
              <Button size="lg" fullWidth>
                Create my account
              </Button>
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection
          id="fields"
          title="Fields and choices"
          description="16 px controls with a 3:1 outline, label above, hint and error below (11.2). Pills for exclusive choices and filters (11.5)."
        >
          <FieldDemos />
        </KitSection>

        <KitSection id="cards" title="Cards and callouts" description="Bounded surfaces and notes (11.3).">
          <KitGrid>
            <KitExample label="Module with a header">
              <Card>
                <CardHeader title="This week" aside="3 payments" />
                <p className="text-body-s text-ink-secondary">A module is the default app card.</p>
              </Card>
            </KitExample>
            <KitExample label="Muted module, and elevated module">
              <div className="flex flex-col gap-4">
                <Card tone="muted">
                  <p className="text-body-s text-ink-secondary">Muted, for the spend sleeve and stat tiles.</p>
                </Card>
                <Card elevated>
                  <p className="text-body-s text-ink-secondary">Elevated, only when the whole card opens one object.</p>
                </Card>
              </div>
            </KitExample>
            <KitExample label="Panel with a ruled header">
              <Panel title="Recent receipts" action={<CountBadge count={14} />}>
                <p className="px-4 py-3 text-body-s text-ink-secondary">Content runs edge to edge under the header.</p>
              </Panel>
            </KitExample>
            <KitExample label="Stat tiles, loaded and loading">
              <div className="grid gap-4 sm:grid-cols-2">
                <StatTile icon="receipt" label="Receipts this week" value="3" footer="All of them verify." />
                <StatTile
                  icon="clock"
                  label="Waiting to buy"
                  value={
                    <SkeletonGroup label="Loading the waiting amount">
                      <Skeleton className="mt-1 h-7 w-28" />
                    </SkeletonGroup>
                  }
                />
              </div>
            </KitExample>
            <KitExample label="Note">
              <Note title="Top-ups do not split">
                USDG you add from a wallet you registered lands in spend. Only payments from outside are split.
              </Note>
            </KitExample>
            <KitExample label="Warning banner">
              <Banner title="This spends USDG that is not sorted yet">
                Sending 200.00 USDG uses 165.80 USDG that arrived and has not been split.
              </Banner>
            </KitExample>
            <KitExample label="Error block for a failed owner action" className="md:col-span-2">
              <ErrorBlock title="The release did not go through" fundsStillHere action={<Button variant="secondary" size="sm">Try again</Button>}>
                Your passkey prompt was closed before it signed.
              </ErrorBlock>
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection
          id="tags"
          title="Tags"
          description="Status tags show the onchain status name. Every other tag is sentence case (11.6, 12.3)."
        >
          <KitExample label="Receipt statuses">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((status) => (
                <StatusTag key={status} status={status} />
              ))}
            </div>
          </KitExample>
          <KitExample label="Why equity waits">
            <div className="flex flex-wrap gap-2">
              {REASONS.map((reason) => (
                <ReasonTag key={reason} reason={reason} />
              ))}
            </div>
          </KitExample>
          <KitExample label="Tones, gated, ticker and count">
            <div className="flex flex-wrap items-center gap-2">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone.charAt(0).toUpperCase() + tone.slice(1)}
                </Badge>
              ))}
              <GatedTag />
              <TickerChip symbol="SPY" />
              <TickerChip symbol="QQQ" />
              <CountBadge count={3} />
            </div>
          </KitExample>
        </KitSection>

        <KitSection id="lists" title="Lists" description="Ruled registers and definition lists. No tables below 768 (11.4).">
          <KitGrid>
            <KitExample label="Rows, the second one opens something">
              <List label="Example rows">
                <ListRow title="Plain row" meta="Meta in quiet ink" trailing={<Amount value="1,200.00" unit="USDG" />} />
                <ListRow
                  title="Row that opens a receipt"
                  meta="The whole row is one target"
                  trailing={<Amount value="937.25" unit="USDG" />}
                  href="/receipts/611"
                  leading={<StatusTag status="FILLED" />}
                />
              </List>
            </KitExample>
            <KitExample label="Definition list with machine values and a derived field">
              <Card padded={false} className="px-4">
                <DefinitionList
                  items={[
                    { id: 'status', term: 'Status', value: 'FILLED' },
                    { id: 'usdg', term: 'USDG in', value: <span className="tabular-nums">1,200.000000 USDG</span> },
                    { id: 'account', term: 'Account', value: SAMPLE_ACCOUNT, mono: true },
                    { id: 'tx', term: 'Transaction hash', value: filled?.derived.txHash ?? '', mono: true, derived: true },
                  ]}
                />
              </Card>
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection id="tabs" title="Tabs" description="Arrow keys move and select, Home and End jump. Four tabs at most on a phone (11.5).">
          <TabsDemo panels={{ receipts: receiptList, inbox: inboxList, holdings: holdingList }} />
        </KitSection>

        <KitSection
          id="overlays"
          title="Sheets, dialogs and toasts"
          description="A bottom sheet below 768 and a centered dialog above, with focus kept inside and handed back on close. One toast at a time, and errors stay until dismissed (11.7, 11.10)."
        >
          <KitExample label="Sheet or dialog">
            <DialogDemo />
          </KitExample>
          <KitExample label="Toasts">
            <ToastDemo />
          </KitExample>
        </KitSection>

        <KitSection id="states" title="Empty and loading" description="Say what to do next, and never show 0.00 while an amount loads (11.8, 11.9).">
          <KitGrid>
            <KitExample label="Empty, before the first payment">
              <EmptyState
                title="No payments yet"
                action={<CopyField label="Payment address" value={SAMPLE_ACCOUNT} copyLabel="Copy payment address" className="w-full text-left" />}
              >
                Nothing splits until USDG arrives from outside. Share your payment address with whoever pays you.
              </EmptyState>
            </KitExample>
            <KitExample label="Loading a whole view">
              <LoadingState label="Loading receipts" />
            </KitExample>
            <KitExample label="Skeletons for a known layout" className="md:col-span-2">
              <SkeletonGroup label="Loading your sleeves">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-module border border-border p-card">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="mt-3 h-8 w-40" />
                    <SkeletonText lines={2} className="mt-3" />
                  </div>
                  <div className="rounded-module border border-border p-card">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-3 h-8 w-36" />
                    <SkeletonText lines={2} className="mt-3" />
                  </div>
                </div>
              </SkeletonGroup>
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection
          id="address"
          title="Payment address, copy and QR"
          description="The full address in mono with copy and share, and a QR code of the same text (12.7)."
        >
          <PaymentAddressCard address={SAMPLE_ACCOUNT} showQr />
          <KitGrid>
            <KitExample label="Copy field for a hash">
              <CopyField label="Receipt hash" value={filled?.receiptHash ?? DISCLOSURE.keccak256} copyLabel="Copy receipt hash" size="sm" />
            </KitExample>
            <KitExample label="QR code alone, level H">
              <QRCode value={SAMPLE_ACCOUNT} label="QR code of the sample payment address" errorLevel="H" className="border border-border" />
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection
          id="disclosure"
          title="Issuer disclosure"
          description="The issuer's text as served, checked against the pinned hash on the server (12.6)."
        >
          <Disclosure paragraphs={data.paragraphs} id="kit-disclosure" />
        </KitSection>

        <KitSection id="lines" title="Required lines" description="Word for word from src/lib/copy.ts (12.5).">
          <KitGrid>
            <KitExample label="Under every holding and receipt token amount">
              <p className="text-body font-semibold text-equity">0.155872 SPY</p>
              <DebtSecurityLine className="mt-0.5" />
            </KitExample>
            <KitExample label="Beside the sell action on a holding">
              <ExitLine />
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection id="frame" title="Page frame" description="Page header, wordmark and footer (11.11, 12.9).">
          <KitExample label="Page header with a way back, a description and actions">
            <div className="rounded-module border border-border p-card">
              <PageHeader
                title="Receipt 455"
                back={{ href: '/receipts', label: 'Receipts' }}
                description="Every field as the module wrote it, with what comes from logs marked derived."
                actions={
                  <>
                    <ButtonLink href="/verify/455" variant="secondary" size="sm">
                      Recompute
                    </ButtonLink>
                    <Button size="sm" icon="share">
                      Make a card
                    </Button>
                  </>
                }
                className="mb-0 md:mb-0"
              />
            </div>
          </KitExample>
          <KitGrid>
            <KitExample label="Wordmark, and the split mark for eyebrow pills">
              <div className="flex flex-wrap items-center gap-6">
                <Wordmark />
                <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-surface px-3 py-1.5 text-body-s text-ink shadow-soft">
                  <SplitMark />
                  Paid in USDG
                </span>
              </div>
            </KitExample>
            <KitExample label="Footer, as the root layout prints it under every page">
              <Footer className="rounded-module border border-border" />
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection id="gated" title="Gated features" description="Dashed, no button, no numbers, never in navigation (12.8).">
          <KitGrid>
            <GatedCard>Borrowing USDG against your Stock Tokens is not available yet.</GatedCard>
            <GatedCard>Pay links, same chain or cross chain, are not available yet.</GatedCard>
            <GatedCard>Baskets and crews are not available yet.</GatedCard>
          </KitGrid>
        </KitSection>

        <KitSection id="icons" title="Icons" description="20 px line icons in currentColor (11.12).">
          <ul className="flex flex-wrap gap-3">
            {ICON_NAMES.map((name) => (
              <li key={name} className="flex w-24 flex-col items-center gap-1.5 rounded-row border border-border p-3 text-ink">
                <Icon name={name} />
                <span className="text-label text-ink-muted">{name}</span>
              </li>
            ))}
          </ul>
        </KitSection>

        <KitSection
          id="split"
          title="The split"
          description="One payment, one bar. The equity segment grows once when a new split first appears, and not at all under reduced motion (12.1)."
        >
          <KitGrid>
            <KitExample label="Bought: 90 percent spend, 10 percent equity, grows once">
              <SplitReplay parts={{ spend: 1_080_000_000n, equity: 120_000_000n, waiting: 0n }} />
            </KitExample>
            <KitExample label="Waiting, with its legend">
              <SplitRail parts={{ spend: 675_000_000n, equity: 0n, waiting: 75_000_000n }} />
              <SplitLegend
                className="mt-3"
                items={[
                  { kind: 'spend', amount: 675_000_000n, label: 'spendable' },
                  { kind: 'waiting', amount: 75_000_000n, label: 'waiting: market closed' },
                ]}
              />
            </KitExample>
            <KitExample label="A 1 percent equity share still shows, at 6 px">
              <SplitRail parts={{ spend: 990_000_000n, equity: 10_000_000n, waiting: 0n }} />
            </KitExample>
            <KitExample label="Row size, 4 px, no legend">
              <SplitRail parts={{ spend: 843_525_000n, equity: 93_725_000n, waiting: 0n }} size="row" />
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection id="sleeves" title="Sleeves" description="Spend and Stock Tokens, the two sleeves (PRD 6 and 15).">
          <KitGrid>
            <SleeveCard kind="spend" spend={data.ledger.spend} unsorted={data.ledger.unsorted} />
            <SleeveCard kind="equity" holdings={data.holdings} pending={data.ledger.pendingTotal} />
            <SleeveCard kind="spend" spend={0n} unsorted={0n} />
            <SleeveCard kind="equity" holdings={[]} pending={0n} />
          </KitGrid>
        </KitSection>

        <KitSection
          id="waiting"
          title="Waiting equity"
          description="The reason in plain words, how long, and a release button. After five days the card asks for a decision (PRD 7.4, 15)."
        >
          <KitGrid>
            {spyBucket === undefined ? null : (
              <KitExample label="Market closed, with the reopen time">
                <BucketDemo bucket={spyBucket} now={now} reopensAt={spy?.session.nextOpenAt ?? null} rule={data.rule} />
              </KitExample>
            )}
            <KitExample label="Below the minimum buy">
              <BucketDemo bucket={clipBucket} now={now} rule={data.rule} />
            </KitExample>
            <KitExample label="Price above the cap for six days" className="md:col-span-2">
              <BucketDemo bucket={longBucket} now={now} rule={data.rule} />
            </KitExample>
          </KitGrid>
        </KitSection>

        <KitSection
          id="receipts"
          title="Receipts"
          description="One card per status, built from the receipt's own numbers, then the receipts list (12.3, 12.4)."
        >
          <KitGrid>
            {STATUSES.map((status) => {
              const record = byStatus(data.receipts, status);
              if (record === undefined) return null;
              return (
                <KitExample key={status} label={status.replace(/_/g, ' ')}>
                  <ReceiptSummary
                    record={record}
                    href={`/receipts/${record.receipt.id}`}
                    verifyHref={`/verify/${record.receipt.id}`}
                    headingLevel={3}
                  />
                </KitExample>
              );
            })}
          </KitGrid>
          <KitExample label="Receipts list">{receiptList}</KitExample>
        </KitSection>

        <KitSection
          id="premium"
          title="Premium lines"
          description="The all-in price and the Chainlink reference, each with its own time, never merged (PRD 7.11)."
        >
          <KitGrid>
            {filledPremium === null ? null : (
              <KitExample label="Buy, full">
                <PremiumLine {...filledPremium} />
              </KitExample>
            )}
            {soldPremium === null ? null : (
              <KitExample label="Sell, full">
                <PremiumLine {...soldPremium} />
              </KitExample>
            )}
            {filledPremium === null ? null : (
              <KitExample label="Compact, for cards and rows">
                <PremiumLine {...filledPremium} compact />
              </KitExample>
            )}
          </KitGrid>
        </KitSection>

        <KitSection id="holdings" title="Holdings" description="The debt security line sits directly under every token amount (12.5).">
          {holdingList}
          {outsideHolding === undefined ? null : (
            <KitExample label="With Stock Tokens that arrived outside Sleeve">
              <List label="Holding with tokens from outside Sleeve">
                <HoldingRow holding={outsideHolding} />
              </List>
            </KitExample>
          )}
        </KitSection>

        <KitSection id="inbox" title="Inbox" description="Inbound USDG from chain logs: not sorted, waiting to sort, sorted (PRD 7.2).">
          {inboxList}
        </KitSection>

        <KitSection id="rule" title="Rule" description="Active, paused, and not set yet (PRD 7.3).">
          <KitGrid>
            <RuleSummary rule={data.rule} editHref="/rule" />
            <RuleSummary rule={{ ...data.rule, status: 'PAUSED', version: 3 }} editHref="/rule" />
            <RuleSummary rule={{ ...data.rule, status: 'NONE', version: 0 }} editHref="/rule" />
          </KitGrid>
        </KitSection>

        <KitSection id="shell" title="App shell" description="Bottom bar below 768, rail from 768, on its own page so it can fill the screen.">
          <p className="text-body text-ink">
            <Link href="/dev/kit/shell" className="text-link underline underline-offset-4 hover:text-link-hover">
              Open the shell preview
            </Link>{' '}
            <span className="text-ink-secondary">with the sample account, {formatUsdg(data.ledger.spend)} USDG in spend.</span>
          </p>
        </KitSection>
      </main>
    </ToastProvider>
  );
}
