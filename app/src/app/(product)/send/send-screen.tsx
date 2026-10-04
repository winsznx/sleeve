'use client';

import { CHAIN_NAME, EXPLORER_URL, formatUsdg, shortAddress, type Address } from '@sleeve/core';
import Link from 'next/link';
import { useId, useState, type ChangeEvent, type JSX } from 'react';

import { TransactionPreview, TransactionPreviewSkeleton } from '@/components/actions/transaction-preview';
import { SignInChoices } from '@/components/sleeve/sign-in-choices';
import { isSleeveOff } from '@/components/sleeve/sleeve-off';
import { tickerSymbol, usdgExactText } from '@/components/sleeve/text';
import { TokenIcon } from '@/components/token/token-icon';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { sanitizeAmount } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { Identicon } from '@/components/ui/identicon';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { ConnectToSign } from '@/components/wallet/connect-to-sign';
import { useAccount, useActionPreview, useBuckets, useLedger, useSession, useWithdraw } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { BucketView, LedgerView, WithdrawRequest, WithdrawResult } from '@/data/types';
import { useSettings } from '@/lib/settings';
import { signerApprovalLine, signerKindOf, walletToConnect } from '@/lib/signer';

import { LoadError } from '../home/_components/load-error';
import { failureText } from '../home/_lib/sentences';
import { AmountField, StaticTokenChip, SwapPanel } from '../sell/_components/swap-parts';
import { useFocusOnArrival } from '../sell/focus';
import { addressGroups, checkAmount, checkDestination, sendable } from './_lib/send';

const TITLE = 'Send USDG';
const DESCRIPTION = `From your spendable USDG to an address outside Sleeve, on ${CHAIN_NAME}. Nothing you send splits.`;

/** The full address in groups of four, mono, so it can be checked a piece at a time against the one you were given. */
function GroupedAddress({ address, className }: { address: Address; className?: string }): JSX.Element {
  return (
    <p className={cx('break-words font-mono text-mono text-ink', className)}>
      <span className="text-ink-secondary">0x</span>
      {addressGroups(address).map((group, index) => (
        <span key={index} className={cx(index % 2 === 1 && 'text-ink-secondary')}>
          {group}
        </span>
      ))}
    </p>
  );
}

function SleeveOnBalances({ ledger, buckets, waiting }: { ledger: LedgerView; buckets: readonly BucketView[]; waiting: bigint }): JSX.Element {
  return (
    <>
      <dl className="mt-3 divide-y divide-border text-body-s">
        <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
          <dt className="flex items-center gap-2 text-ink-secondary">
            <span aria-hidden="true" className="size-2 rounded-pill bg-spend" />
            Spendable
          </dt>
          <dd className="font-semibold tabular-nums text-ink">{usdgExactText(ledger.spend)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="flex items-center gap-2 text-ink-secondary">
            <span aria-hidden="true" className="size-2 rounded-pill border border-ink-muted" />
            Not sorted yet, also spendable
          </dt>
          <dd className="font-semibold tabular-nums text-ink">{usdgExactText(ledger.unsorted)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-2.5 last:pb-0">
          <dt className="flex items-center gap-2 text-ink-secondary">
            <span aria-hidden="true" className="size-2 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />
            Waiting to buy, not included
          </dt>
          <dd className="tabular-nums text-ink-secondary">{usdgExactText(waiting)}</dd>
        </div>
      </dl>
      {waiting > 0n ? (
        <p className="mt-3 text-body-s text-ink-secondary">
          To send what waits to buy {buckets.map((bucket) => tickerSymbol(bucket.tickerId)).join(' and ')}, release it to spend
          first, on{' '}
          <Link href="/home#waiting" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
            Home
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}

/** What an account Sleeve is off for can send: all of its USDG, since the module keeps no ledger for it (D-040). */
function SleeveOffBalance({ ledger }: { ledger: LedgerView }): JSX.Element {
  return (
    <>
      <dl className="mt-3 text-body-s">
        <div className="flex items-center justify-between gap-3">
          <dt className="flex items-center gap-2 text-ink-secondary">
            <span aria-hidden="true" className="size-2 rounded-pill bg-spend" />
            In your account
          </dt>
          <dd className="font-semibold tabular-nums text-ink">{usdgExactText(ledger.balance)}</dd>
        </div>
      </dl>
      <p className="mt-3 text-body-s text-ink-secondary">
        Sleeve is off for this account, so none of it waits to buy and all of it can be sent.{' '}
        <Link href="/home" className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
          Turn Sleeve back on from Home
        </Link>
        .
      </p>
    </>
  );
}

function Aside({ ledger, buckets, sleeveOff }: { ledger: LedgerView; buckets: readonly BucketView[]; sleeveOff: boolean }): JSX.Element {
  const waiting = buckets.reduce((sum, bucket) => sum + bucket.amount, 0n);
  return (
    <aside className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="send-balances" className="rounded-card border border-border bg-surface p-4 sm:p-5">
        <h2 id="send-balances" className="text-h3 text-ink">
          What you can send
        </h2>
        {sleeveOff ? (
          <SleeveOffBalance ledger={ledger} />
        ) : (
          <SleeveOnBalances ledger={ledger} buckets={buckets} waiting={waiting} />
        )}
      </section>
      <section aria-labelledby="send-notes" className="rounded-card border border-border bg-surface-muted p-4 sm:p-5">
        <h2 id="send-notes" className="text-h3 text-ink">
          Before you send
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5 text-body-s text-ink-secondary">
          <li className="flex gap-2.5">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-warning" />A send cannot be undone. Sleeve cannot bring
            USDG back from another address.
          </li>
          <li className="flex gap-2.5">
            <Icon name="info" className="mt-0.5 size-4 shrink-0 text-info" />
            Send only to an address on {CHAIN_NAME} that can hold USDG. Sleeve keeps no address book, so check the address each
            time.
          </li>
          <li className="flex gap-2.5">
            <Icon name="split" className="mt-0.5 size-4 shrink-0 text-ink-secondary" />
            {sleeveOff ? 'USDG you send leaves your account whole.' : 'USDG you send leaves your account whole. Your rule splits only what arrives.'}
          </li>
        </ul>
      </section>
    </aside>
  );
}

interface Draft {
  amountText: string;
  toText: string;
}

function SendForm({
  account,
  ledger,
  sleeveOff,
  draft,
  onDraft,
  onContinue,
}: {
  account: Address;
  ledger: LedgerView;
  /** Sleeve is off for the account (D-040): the module keeps no ledger, so the whole balance can be sent. */
  sleeveOff: boolean;
  draft: Draft;
  onDraft: (draft: Draft) => void;
  onContinue: (request: WithdrawRequest) => void;
}): JSX.Element {
  const ids = { amount: useId(), amountLabel: useId(), amountHint: useId(), amountError: useId(), to: useId(), toHint: useId(), toError: useId() };
  const [shown, setShown] = useState({ amount: false, to: false });
  const max = sleeveOff ? ledger.balance : sendable(ledger);
  const amount = checkAmount(draft.amountText, max);
  const destination = checkDestination(draft.toText, account);
  const amountError = amount.kind === 'invalid' && (shown.amount || draft.amountText !== '') ? amount.error : null;
  const toError =
    destination.kind === 'invalid' && shown.to ? destination.error : destination.kind === 'empty' && shown.to ? 'Enter the address to send to.' : null;

  function changeAmount(event: ChangeEvent<HTMLInputElement>) {
    const next = sanitizeAmount(event.target.value, 6);
    if (next !== null) onDraft({ ...draft, amountText: next });
  }

  function submit() {
    setShown({ amount: true, to: true });
    if (amount.kind === 'valid' && destination.kind === 'valid') onContinue({ to: destination.address, amount: amount.amount });
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-labelledby="send-card-title"
      className="min-w-0 rounded-card border border-border bg-surface p-3 shadow-card sm:p-4"
    >
      <h2 id="send-card-title" className="pb-3 pl-1 text-h3 text-ink">
        Send to an outside address
      </h2>
      <SwapPanel tone="surface" invalid={amountError !== null}>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label id={ids.amountLabel} htmlFor={ids.amount} className="text-body-s font-medium text-ink-secondary">
            You send
          </label>
          <span className="flex items-center gap-1 text-body-s text-ink-secondary">
            <span className="tabular-nums">Up to {usdgExactText(max)}</span>
            <button
              type="button"
              onClick={() => onDraft({ ...draft, amountText: formatUsdg(max, { maxFractionDigits: 6, grouping: false }) })}
              disabled={max === 0n}
              aria-label={`Max, send all ${usdgExactText(max)}`}
              className="-mr-2 inline-flex min-h-control-sm items-center rounded-pill px-2.5 font-semibold text-ink transition-colors duration-fast hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-disabled"
            >
              Max
            </button>
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <AmountField
            id={ids.amount}
            labelledBy={ids.amountLabel}
            describedBy={cx(ids.amountHint, amountError !== null && ids.amountError) || undefined}
            value={draft.amountText}
            onChange={changeAmount}
            invalid={amountError !== null}
          />
          <StaticTokenChip token="USDG" symbol="USDG" />
        </div>
        <p id={ids.amountHint} className="mt-2 text-body-s text-ink-muted">
          {sleeveOff
            ? 'Sleeve is off, so all the USDG in your account can be sent.'
            : ledger.unsorted > 0n
              ? `${usdgExactText(ledger.spend)} spendable and ${usdgExactText(ledger.unsorted)} not sorted yet.`
              : 'From your spendable USDG.'}
        </p>
        {amountError === null ? null : (
          <p id={ids.amountError} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
            <Icon name="alert" className="mt-0.5 size-4" />
            {amountError}
          </p>
        )}
      </SwapPanel>

      <div aria-hidden="true" className="relative -my-3.5 flex justify-center">
        <span className="grid size-11 place-items-center rounded-row border-4 border-surface bg-surface-muted text-ink-secondary">
          <Icon name="arrowDown" />
        </span>
      </div>

      <SwapPanel tone="muted">
        <label htmlFor={ids.to} className="text-body-s font-medium text-ink-secondary">
          To
        </label>
        <div className="mt-2 flex items-start gap-3">
          <span className="mt-1.5 shrink-0">
            {destination.kind === 'valid' ? (
              <Identicon value={destination.address} size="md" />
            ) : (
              <span aria-hidden="true" className="block size-avatar rounded-[11px] border border-dashed border-border-strong" />
            )}
          </span>
          <textarea
            id={ids.to}
            value={draft.toText}
            onChange={(event) => onDraft({ ...draft, toText: event.target.value.replace(/\s+/g, '') })}
            onBlur={() => setShown((current) => ({ ...current, to: draft.toText !== '' || current.to }))}
            rows={2}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="0x..."
            aria-invalid={toError !== null || undefined}
            aria-describedby={cx(ids.toHint, toError !== null && ids.toError) || undefined}
            className={cx(
              'min-h-control-lg w-full min-w-0 resize-none rounded-control border bg-surface px-3.5 py-2.5 font-mono text-input text-ink placeholder:text-ink-muted md:text-mono',
              toError === null ? 'border-border-control hover:border-ink-secondary' : 'border-danger',
            )}
          />
        </div>
        <p id={ids.toHint} className="mt-2 text-body-s text-ink-muted">
          {destination.kind === 'valid'
            ? destination.checksummed
              ? 'The checksum matches, so no letter is mistyped. Still check that it is the address you were given.'
              : 'This address has no checksum, so a mistyped letter would not show. Check every character.'
            : `An address on ${CHAIN_NAME}. Paste it from the person you are paying.`}
        </p>
        {toError === null ? null : (
          <p id={ids.toError} className="mt-2 flex items-start gap-1.5 text-body-s text-danger">
            <Icon name="alert" className="mt-0.5 size-4" />
            {toError}
          </p>
        )}
      </SwapPanel>

      <Button type="submit" size="lg" fullWidth className="mt-3" disabled={max === 0n}>
        {max === 0n ? 'Nothing to send yet' : 'Review the send'}
      </Button>
    </form>
  );
}

function ConfirmSend({
  request,
  sending,
  error,
  onBack,
  onSend,
}: {
  request: WithdrawRequest;
  sending: boolean;
  error: Error | null;
  onBack: () => void;
  onSend: () => void;
}): JSX.Element {
  const settings = useSettings();
  const session = useSession();
  const signer = signerKindOf(session.data);
  const walletOwner = walletToConnect(session.data);
  // Whether to preview is read once, as the step opens, so turning previews off here keeps this one on screen.
  const [withPreview] = useState(settings.previewsEnabled);
  const [checked, setChecked] = useState(false);
  const preview = useActionPreview(withPreview ? { kind: 'withdraw', request } : null);
  const blocked = withPreview && preview.data !== undefined && preview.data.blocked !== null;
  const waiting = withPreview && preview.isPending;
  const checkId = useId();

  return (
    <section aria-labelledby="send-confirm-title" className="min-w-0 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 id="send-confirm-title" className="text-h3 text-ink">
        Check and send
      </h2>
      <div className="mt-4 rounded-large bg-surface-muted p-4">
        <p className="text-body-s text-ink-secondary">You send</p>
        <p className="mt-1 flex items-center gap-2.5 text-figure-m tabular-nums text-ink">
          <TokenIcon token="USDG" size="lg" decorative />
          <span>
            <span className="whitespace-nowrap">{formatUsdg(request.amount, { maxFractionDigits: 6 })}</span>{' '}
            <span className="text-h3 font-medium text-ink-secondary">USDG</span>
          </span>
        </p>
        <p className="mt-4 text-body-s text-ink-secondary">To this address, outside Sleeve</p>
        <div className="mt-2 flex items-start gap-3">
          <Identicon value={request.to} size="md" className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <GroupedAddress address={request.to} />
            <p className="mt-1 text-body-s text-ink-muted">
              Starts {shortAddress(request.to)}. On {CHAIN_NAME}.
            </p>
          </div>
          <CopyButton value={request.to} label="Copy the address you are sending to" className="-mt-2" />
        </div>
      </div>

      {withPreview ? (
        <div className="mt-4">
          {preview.data !== undefined ? (
            <TransactionPreview preview={preview.data} />
          ) : preview.isError ? (
            <ErrorBlock title="The preview did not load">
              Sleeve could not read what this send would do. You can still send it. The module checks everything again when it runs.
            </ErrorBlock>
          ) : (
            <TransactionPreviewSkeleton />
          )}
        </div>
      ) : null}

      <div className="mt-4 flex items-start gap-3 rounded-row border border-border p-3.5">
        <input
          id={checkId}
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 cursor-pointer rounded-xs"
        />
        <label htmlFor={checkId} className="cursor-pointer text-body-s text-ink">
          I checked every character of this address against the one I was given.
          <span className="block text-ink-secondary">Sleeve keeps no address book, and a send cannot be undone.</span>
        </label>
      </div>

      {walletOwner === null ? (
        <p className="mt-4 flex gap-2.5 rounded-row border border-accent-border bg-info-soft p-3.5 text-body-s text-ink-secondary">
          <Icon name={signer === 'passkey' ? 'key' : 'wallet'} className="mt-0.5 size-4 shrink-0 text-info" />
          <span>
            {signerApprovalLine(signer)}
            {DATA_SOURCE === 'mock' ? ' Sample data: nothing is sent to Robinhood Chain.' : ''}
          </span>
        </p>
      ) : (
        <ConnectToSign owner={walletOwner} className="mt-4" />
      )}

      {error === null ? null : (
        <ErrorBlock title="The send did not go through" fundsStillHere className="mt-4">
          {failureText(error, 'send')}
        </ErrorBlock>
      )}

      <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onBack} disabled={sending}>
          Edit
        </Button>
        <Button
          onClick={onSend}
          busy={sending}
          busyLabel="Waiting for approval"
          disabled={!checked || waiting || blocked || walletOwner !== null}
          icon={signer === 'passkey' ? 'key' : 'wallet'}
        >
          Approve and send
        </Button>
      </div>
    </section>
  );
}

function SendResult({
  result,
  headingRef,
  onSendMore,
}: {
  result: WithdrawResult;
  headingRef: (node: HTMLElement | null) => void;
  onSendMore: () => void;
}): JSX.Element {
  const sent = result.balanceBefore - result.balanceAfter;
  const href = `${EXPLORER_URL}/tx/${result.txHash}`;
  return (
    <section aria-labelledby="send-result-title" className="min-w-0 overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <div aria-hidden="true" className="h-2 bg-spend" />
      <div className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <TokenIcon token="USDG" size="xl" decorative />
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-pill bg-success text-on-accent">
            <Icon name="check" />
          </span>
        </div>
        <h2 id="send-result-title" ref={headingRef} tabIndex={-1} className="mt-4 text-figure-m tabular-nums text-ink focus-visible:outline-none">
          Sent {usdgExactText(sent)}
        </h2>
        <p className="mt-2 text-body text-ink-secondary">
          To <span className="font-mono text-mono text-ink">{shortAddress(result.request.to)}</span>. Your account now holds{' '}
          <span className="tabular-nums text-ink">{usdgExactText(result.balanceAfter)}</span>, read back after the send.
        </p>
        <div className="mt-4 rounded-row bg-surface-muted p-3.5 text-body-s">
          <p className="text-ink-secondary">Transaction</p>
          <p className="mt-1 flex items-center gap-1">
            <span className="min-w-0 break-all font-mono text-mono-s text-ink">{result.txHash}</span>
            <CopyButton value={result.txHash} label="Copy the transaction hash" className="-my-2 shrink-0" />
          </p>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex min-h-touch items-center gap-1 font-medium text-link underline underline-offset-4 hover:text-link-hover"
          >
            Open it on the {CHAIN_NAME} explorer
            <Icon name="external" className="size-4" />
          </a>
          {DATA_SOURCE === 'mock' ? <p className="text-ink-muted">Sample data: this transaction is not on Robinhood Chain.</p> : null}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button onClick={onSendMore}>Send more</Button>
          <ButtonLink href="/home" variant="secondary">
            Back to Home
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}

function SendSkeleton(): JSX.Element {
  return (
    <SkeletonGroup label="Loading what you can send" className="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] xl:gap-8">
      <div className="rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-4 h-36 w-full rounded-large" />
        <Skeleton className="mt-2 h-36 w-full rounded-large" />
        <Skeleton className="mt-3 h-12 w-full rounded-pill" />
      </div>
      <div className="rounded-card border border-border bg-surface p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-4 h-28 w-full rounded-row" />
      </div>
    </SkeletonGroup>
  );
}

function AccountSend({ account }: { account: Address }): JSX.Element {
  const overview = useAccount(account);
  const ledger = useLedger(account);
  const buckets = useBuckets(account);
  const withdraw = useWithdraw();
  const resultFocus = useFocusOnArrival();
  const [draft, setDraft] = useState<Draft>({ amountText: '', toText: '' });
  const [request, setRequest] = useState<WithdrawRequest | null>(null);

  if (ledger.data === undefined || buckets.data === undefined || overview.isPending) {
    const failed = [ledger, buckets].filter((query) => query.data === undefined && query.isError);
    return failed.length === 0 ? (
      <SendSkeleton />
    ) : (
      <LoadError
        title="Your balances did not load"
        onRetry={() => failed.forEach((query) => void query.refetch())}
        retrying={failed.some((query) => query.isFetching)}
      >
        Sleeve could not read what you can send from Robinhood Chain.
      </LoadError>
    );
  }

  // When the account read fails, the send keeps to the module's ledgers, the smaller and safe measure.
  const sleeveOff = overview.data !== undefined && isSleeveOff(overview.data);
  let main: JSX.Element;
  if (withdraw.isSuccess) {
    main = (
      <SendResult
        result={withdraw.data}
        headingRef={resultFocus.target}
        onSendMore={() => {
          withdraw.reset();
          setRequest(null);
          setDraft({ amountText: '', toText: '' });
        }}
      />
    );
  } else if (request !== null) {
    main = (
      <ConfirmSend
        request={request}
        sending={withdraw.isPending}
        error={withdraw.isError ? withdraw.error : null}
        onBack={() => {
          withdraw.reset();
          setRequest(null);
        }}
        onSend={() => {
          resultFocus.request();
          withdraw.mutate(request);
        }}
      />
    );
  } else {
    main = (
      <SendForm account={account} ledger={ledger.data} sleeveOff={sleeveOff} draft={draft} onDraft={setDraft} onContinue={setRequest} />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] xl:items-start xl:gap-8">
      {main}
      <Aside ledger={ledger.data} buckets={buckets.data} sleeveOff={sleeveOff} />
    </div>
  );
}

/** Send and withdraw (D-029): USDG out of the account to an outside address, checked, previewed, then signed. */
export function SendScreen(): JSX.Element {
  const session = useSession();
  let body: JSX.Element;
  if (session.data === undefined) {
    body = session.isError ? (
      <LoadError title="Your session did not load" onRetry={() => void session.refetch()} retrying={session.isFetching}>
        Sleeve could not check whether you are signed in.
      </LoadError>
    ) : (
      <SendSkeleton />
    );
  } else if (session.data === null) {
    body = (
      <EmptyState title="Sign in to send" className="max-w-reading" action={<SignInChoices />}>
        Sending needs the passkey or the wallet that owns your account. Your USDG stays in your account until you send it.
      </EmptyState>
    );
  } else {
    body = <AccountSend key={session.data.account} account={session.data.account} />;
  }
  return (
    <div className="max-w-content">
      <PageHeader back={{ href: '/home', label: 'Home' }} title={TITLE} description={DESCRIPTION} />
      {body}
    </div>
  );
}
