'use client';

import { CHAIN_ID, CHAIN_NAME, formatBps, shortAddress, TOTAL_BPS, type Address } from '@sleeve/core';
import Link from 'next/link';
import { useState, type JSX, type ReactNode } from 'react';

import { ActionDialog } from '@/components/actions/action-dialog';
import { NOTIFICATION_TYPE_COPY } from '@/components/notifications/notification-words';
import { signerOf } from '@/components/shell/account';
import { SampleTag } from '@/components/shell/sample-tag';
import { ThemeChoice } from '@/components/shell/theme-switch';
import { isSleeveOff } from '@/components/sleeve/sleeve-off';
import { tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { NetworkGlyph } from '@/components/token/glyphs';
import { TickerIcon } from '@/components/token/ticker-icon';
import { Button, ButtonLink } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-styles';
import { Card, CardHeader } from '@/components/ui/card';
import { CopyField, ShareButton } from '@/components/ui/copy-field';
import { Icon } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useAccount, useBuckets, useRemoveSleeve, useRule, useSession } from '@/data/hooks';
import type { RemoveResult } from '@/data/types';
import { NOTIFICATION_TYPES, useSettings } from '@/lib/settings';

import { failureText } from '../home/_lib/sentences';
import { SettingSwitch } from './_components/setting-switch';

/**
 * Settings (D-029): the account (payment address, how the owner signs, the recovery signer, the rule), whether
 * actions show a preview before the signature prompt, which notifications the bell shows, the theme, and removing
 * Sleeve, which moves waiting money to spend (D-040). Preferences are this browser's (lib/settings.ts); the account
 * facts are chain reads.
 */

const LINK = 'font-medium text-link underline underline-offset-4 transition-colors duration-fast ease-standard hover:text-link-hover';

function Row({ term, children }: { term: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-1 border-t border-border py-3 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-body-s text-ink-secondary">{term}</dt>
      <dd className="min-w-0 text-body-s text-ink">{children}</dd>
    </div>
  );
}

function RuleLine({ account }: { account: Address }): JSX.Element {
  const rule = useRule(account);
  if (rule.data === undefined) {
    return rule.isError ? <>Your rule did not load.</> : <Skeleton className="h-4 w-3/4" />;
  }
  const data = rule.data;
  if (data.status === 'NONE') return <>No rule yet. Every payment stays spendable until you set one.</>;
  const spend = formatBps(TOTAL_BPS - data.equityBps);
  const equity = formatBps(data.equityBps);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {spend} stays spendable USDG and {equity} buys
      <TickerIcon tickerId={data.tickerId} size="xs" />
      {tickerSymbol(data.tickerId)}
      {data.status === 'PAUSED' ? ', paused' : ''}.
    </span>
  );
}

function RecoveryLine({ account }: { account: Address }): JSX.Element {
  const overview = useAccount(account);
  const recovery = overview.data?.recoverySigner;
  if (recovery === undefined) return overview.isError ? <>Did not load.</> : <Skeleton className="h-4 w-1/2" />;
  if (recovery === null) {
    return (
      <>
        No recovery signer set. Your sign-in is the only way into the account.{' '}
        <Link href="/help#getting-out" className={LINK}>
          Why it matters
        </Link>
      </>
    );
  }
  return (
    <>
      Recovery signer <span className="font-mono text-mono-s">{shortAddress(recovery)}</span>. It can use this account without
      Sleeve.
    </>
  );
}

function AccountSection({ account, signer }: { account: Address; signer: 'passkey' | 'wallet' | null }): JSX.Element {
  return (
    <Card as="section" aria-labelledby="settings-account">
      <CardHeader title={<span id="settings-account">Account</span>} aside={<SampleTag />} />
      <CopyField
        label="Payment address"
        value={account}
        copyLabel="Copy payment address"
        actions={<ShareButton text={account} title="Sleeve payment address" label="Share payment address" />}
      />
      <dl className="mt-4">
        <Row term="Sign-in method">
          {signer === null ? 'Not known' : signer === 'passkey' ? 'Passkey on this device' : 'Connected wallet, which can also sign outside Sleeve'}
        </Row>
        <Row term="Recovery">
          <RecoveryLine account={account} />
        </Row>
        <Row term="Network">
          <span className="inline-flex items-center gap-1.5">
            <NetworkGlyph className="size-4 shrink-0 text-ink-secondary" />
            {CHAIN_NAME}, chain id {CHAIN_ID}
          </span>
        </Row>
        <Row term="Rule">
          <RuleLine account={account} />{' '}
          <Link href="/rule" className={LINK}>
            Change your rule
          </Link>
        </Row>
      </dl>
    </Card>
  );
}

function SignedOutAccount(): JSX.Element {
  return (
    <Card as="section" aria-labelledby="settings-account">
      <CardHeader title={<span id="settings-account">Account</span>} />
      <p className="text-body-s text-ink-secondary">Sign in to see your payment address, how you sign and your recovery signer.</p>
      <Link href="/onboard" prefetch={false} className={buttonClasses({ size: 'sm', className: 'mt-4' })}>
        Sign in
      </Link>
    </Card>
  );
}

function AccountPending(): JSX.Element {
  return (
    <Card as="section" aria-labelledby="settings-account" aria-busy="true">
      <CardHeader title={<span id="settings-account">Account</span>} />
      <span className="sr-only">Loading your account</span>
      <Skeleton className="h-control-lg w-full rounded-control" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-3/5" />
      </div>
    </Card>
  );
}

function PreviewsSection(): JSX.Element {
  const { previewsEnabled, setPreviewsEnabled } = useSettings();
  return (
    <Card as="section" aria-labelledby="settings-previews">
      <CardHeader title={<span id="settings-previews">Before you sign</span>} />
      <SettingSwitch
        className="pt-0"
        label="Show a preview before the signature prompt"
        description={
          previewsEnabled
            ? 'On. Every action first shows a preview card with what moves and where it goes. Then your passkey or wallet asks you to sign.'
            : 'Off. Actions go straight to the signature prompt, without the preview card. Each action still writes a record of what moved.'
        }
        checked={previewsEnabled}
        onChange={setPreviewsEnabled}
      />
    </Card>
  );
}

function NotificationsSection(): JSX.Element {
  const { notificationTypes, setNotificationType } = useSettings();
  return (
    <Card as="section" aria-labelledby="settings-notifications">
      <CardHeader
        title={<span id="settings-notifications">Notifications</span>}
        aside={
          <Link href="/notifications" className={LINK}>
            See notifications
          </Link>
        }
      />
      <p className="text-body-s text-ink-secondary">What the bell shows. Turning one off hides it in this browser; nothing changes on chain.</p>
      <div className="mt-2 divide-y divide-border">
        {NOTIFICATION_TYPES.map((type) => (
          <SettingSwitch
            key={type}
            label={NOTIFICATION_TYPE_COPY[type].label}
            description={NOTIFICATION_TYPE_COPY[type].description}
            checked={notificationTypes[type]}
            onChange={(enabled) => setNotificationType(type, enabled)}
          />
        ))}
      </div>
    </Card>
  );
}

function AppearanceSection(): JSX.Element {
  return (
    <Card as="section" aria-labelledby="settings-theme">
      <CardHeader title={<span id="settings-theme">Theme</span>} />
      <ThemeChoice legendHidden />
    </Card>
  );
}

function WaitingNow({ account }: { account: Address }): JSX.Element | null {
  const buckets = useBuckets(account);
  const waiting = (buckets.data ?? []).filter((bucket) => bucket.amount > 0n);
  if (buckets.data === undefined) return buckets.isError ? <p className="mt-3 text-body-s text-ink-secondary">Waiting USDG did not load.</p> : null;
  if (waiting.length === 0) return <p className="mt-3 text-body-s text-ink-secondary">Nothing waits to buy right now.</p>;
  return (
    <ul className="mt-3 space-y-1.5 text-body-s text-ink">
      {waiting.map((bucket) => (
        <li key={bucket.tickerId} className="flex items-start gap-2">
          <TickerIcon tickerId={bucket.tickerId} size="xs" className="mt-0.5" />
          <span className="min-w-0">
            {usdgExactText(bucket.amount)} waits to buy {tickerSymbol(bucket.tickerId)} now, and would move to spend.
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the removal moved, read from its transaction: each RELEASED receipt, with the way to its details. */
function Removed({ result }: { result: RemoveResult }): JSX.Element {
  return (
    <div role="status" className="mt-4 rounded-row border border-border bg-surface p-4">
      <p className="flex items-center gap-2 text-body font-semibold text-ink">
        <Icon name="check" className="size-4 text-success" />
        Sleeve is removed
      </p>
      <p className="mt-1 text-body-s text-ink-secondary">
        Payments that arrive now stay as USDG. Your USDG and Stock Tokens are in your account.
      </p>
      {result.released.length === 0 ? (
        <p className="mt-2 text-body-s text-ink-secondary">Nothing was waiting to buy, so nothing moved to spend.</p>
      ) : (
        <ul className="mt-2 space-y-1.5 text-body-s text-ink">
          {result.released.map(({ receipt }) => (
            <li key={receipt.id.toString()} className="flex items-start gap-2">
              <TickerIcon tickerId={receipt.tickerId} size="xs" className="mt-0.5" />
              <span className="min-w-0">
                {usdgExactText(receipt.usdgToSpend)} that waited to buy {tickerSymbol(receipt.tickerId)} moved to spend.{' '}
                <Link href={`/receipts/${receipt.id.toString()}`} className={LINK}>
                  Record #{receipt.id.toString()}
                </Link>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ButtonLink href="/home" size="sm" variant="secondary" icon="home" className="mt-4">
        Go to Home
      </ButtonLink>
    </div>
  );
}

/**
 * The remove control (PRD 7.1): one bracketed owner op, previewed first, that uninstalls the module and moves what
 * waits to spend. Once the chain reads the module off the account, the section says so and links Home, where Sleeve can
 * be turned back on.
 */
function RemoveControls({ account }: { account: Address }): JSX.Element {
  const overview = useAccount(account);
  const remove = useRemoveSleeve();
  const [open, setOpen] = useState(false);
  const removed = remove.isSuccess ? remove.data : null;

  let body: JSX.Element;
  if (removed !== null) {
    body = <Removed result={removed} />;
  } else if (overview.data === undefined) {
    body = overview.isError ? (
      <p className="mt-3 text-body-s text-ink-secondary">Your account did not load, so Sleeve cannot offer the removal yet.</p>
    ) : (
      <Skeleton className="mt-4 h-control w-44 rounded-pill" />
    );
  } else if (isSleeveOff(overview.data)) {
    body = (
      <div className="mt-4">
        <p className="text-body-s text-ink">Sleeve is off for this account. Payments are not split.</p>
        <ButtonLink href="/home" size="sm" variant="secondary" icon="play" className="mt-3">
          Turn Sleeve back on
        </ButtonLink>
      </div>
    );
  } else {
    body = (
      <>
        <WaitingNow account={account} />
        <Button
          variant="destructive"
          icon="close"
          className="mt-4"
          onClick={() => {
            remove.reset();
            setOpen(true);
          }}
        >
          Remove Sleeve
        </Button>
      </>
    );
  }

  return (
    <>
      {body}
      <ActionDialog
        open={open}
        onClose={() => {
          if (!remove.isPending) setOpen(false);
        }}
        action={{ kind: 'remove' }}
        title="Remove Sleeve?"
        description="Its module comes off your account. Each amount waiting to buy moves to spend with its own record, and payments stop splitting. Your USDG and Stock Tokens stay in your account."
        fallback={<WaitingNow account={account} />}
        confirmLabel="Approve and remove"
        confirmVariant="destructive"
        busyLabel="Removing"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => setOpen(false) })}
        error={remove.isError ? failureText(remove.error, 'remove') : undefined}
        errorTitle="Sleeve was not removed"
      />
    </>
  );
}

function RemoveSection({ account }: { account: Address | null }): JSX.Element {
  return (
    <section aria-labelledby="settings-remove" className="min-w-0 rounded-module border border-danger/40 bg-danger-soft/40 p-card">
      <h2 id="settings-remove" className="text-h3 text-ink">
        Remove Sleeve
      </h2>
      <div className="mt-2 max-w-reading space-y-2 text-body-s text-ink-secondary">
        <p>
          Removing Sleeve uninstalls its module from your account. Any USDG waiting to buy a Stock Token moves to spend in the
          same step, each with its own record. Payments stop splitting.
        </p>
        <p>Your USDG and Stock Tokens stay in your account. Sleeve never holds them, so there is nothing to withdraw from Sleeve.</p>
        <p>You can turn Sleeve back on from Home at any time. USDG already in your account then stays spendable, and only new payments split.</p>
      </div>
      {account === null ? null : <RemoveControls account={account} />}
    </section>
  );
}

export function SettingsScreen(): JSX.Element {
  const session = useSession();
  const account = session.data?.account ?? null;
  let accountSection: JSX.Element;
  if (session.isPending) accountSection = <AccountPending />;
  else if (account === null) accountSection = <SignedOutAccount />;
  else accountSection = <AccountSection account={account} signer={signerOf(session.data)} />;

  return (
    <div className="max-w-form">
      <PageHeader title="Settings" description="Your account, how actions are confirmed, what the bell shows and how Sleeve looks. Preferences stay in this browser." />
      <div className="flex flex-col gap-4 md:gap-5">
        {accountSection}
        <PreviewsSection />
        <NotificationsSection />
        <AppearanceSection />
        <RemoveSection account={account} />
      </div>
    </div>
  );
}
