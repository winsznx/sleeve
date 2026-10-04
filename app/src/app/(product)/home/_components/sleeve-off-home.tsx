'use client';

import { formatBps, formatStockToken, formatUsdg, TOTAL_BPS, type Address, type RuleInput } from '@sleeve/core';
import { useId, useState, type JSX } from 'react';

import { ActionDialog } from '@/components/actions/action-dialog';
import { tickerSymbol, usdgText } from '@/components/sleeve/text';
import { TickerIcon } from '@/components/token/ticker-icon';
import { TokenIcon } from '@/components/token/token-icon';
import { Amount } from '@/components/ui/amount';
import { Button, ButtonLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { useHoldings, useLedger, useMarket, useReinstallSleeve } from '@/data/hooks';
import type { Holding } from '@/data/types';

import { RuleEditor } from '../../rule/_components/rule-editor';
import { failureText } from '../_lib/sentences';
import { HomeSkeleton } from './home-skeleton';
import { LoadError } from './load-error';

const TITLE = 'Sleeve is off for this account';
const DESCRIPTION = 'Payments that arrive stay as USDG and nothing splits them. What you hold stays in your own account on Robinhood Chain.';

/** "90% of each payment stays spendable and 10% buys SPY." */
function splitLine(rule: RuleInput): string {
  return `${formatBps(TOTAL_BPS - rule.equityBps)} of each payment stays spendable and ${formatBps(rule.equityBps)} buys ${tickerSymbol(rule.tickerId)}.`;
}

/**
 * The money in an account Sleeve is off for: the USDG balance, all of it spendable because the module keeps no ledger
 * for the account, with Send, and the Stock Tokens it holds, each with the debt security line.
 */
function MoneyOff({ balance, holdings }: { balance: bigint; holdings: readonly Holding[] }): JSX.Element {
  const headingId = useId();
  const held = holdings.filter((holding) => holding.balance > 0n);
  return (
    <Card as="section" aria-labelledby={headingId} className="flex flex-col">
      <CardHeader title={<span id={headingId}>Your money</span>} />
      <p className="flex items-center gap-2.5 text-figure-l tabular-nums text-ink">
        <TokenIcon token="USDG" size="lg" decorative />
        <span>
          <span className="whitespace-nowrap">{formatUsdg(balance)}</span> <span className="text-h3 font-medium text-ink-secondary">USDG</span>
        </span>
      </p>
      <p className="mt-1 text-body-s text-ink-secondary">In your own account. All of it is spendable while Sleeve is off.</p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <ButtonLink href="/send" size="sm" icon="send">
          Send USDG
        </ButtonLink>
      </div>

      <h3 className="mt-6 text-body-s font-semibold text-ink">Stock Tokens</h3>
      {held.length === 0 ? (
        <p className="mt-1 text-body-s text-ink-secondary">None in your account.</p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-border">
            {held.map((holding) => {
              const symbol = tickerSymbol(holding.tickerId);
              return (
                <li key={holding.tickerId} className="flex gap-2.5 py-3 last:pb-0">
                  <TickerIcon tickerId={holding.tickerId} size="md" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Amount value={formatStockToken(holding.balance)} unit={symbol} className="text-body font-semibold text-ink" />
                      <Amount value={formatUsdg(holding.value)} unit="USDG" className="text-body-s text-ink" />
                    </p>
                    <DebtSecurityLine />
                    <p className="text-body-s text-ink-secondary">Valued at the Chainlink price from {formatUtc(holding.feed.updatedAt)}.</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-body-s text-ink-secondary">Selling them back to USDG through Sleeve works again once Sleeve is on.</p>
        </>
      )}
    </Card>
  );
}

/**
 * Turning Sleeve back on (D-040): a rule, starting from the suggested 10 percent to SPY, then the install op previewed
 * and approved. The module starts from a fresh snapshot, so the balance already here stays spendable (I5).
 */
function TurnOn({ balance }: { balance: bigint }): JSX.Element {
  const headingId = useId();
  const market = useMarket();
  const reinstall = useReinstallSleeve();
  const toast = useToast();
  const [choosing, setChoosing] = useState(false);
  // The rule the dialog asks about stays set after it closes, so the dialog keeps its words while it leaves.
  const [rule, setRule] = useState<RuleInput | null>(null);
  const [open, setOpen] = useState(false);

  function confirm(input: RuleInput) {
    reinstall.mutate(input, {
      onSuccess: (saved) => {
        setOpen(false);
        toast.show({
          title: 'Sleeve is on again',
          body: `${formatBps(saved.equityBps)} of each payment buys ${tickerSymbol(saved.tickerId)} from the next payment. USDG already in your account stays spendable.`,
        });
      },
    });
  }

  return (
    <Card as="section" aria-labelledby={headingId} className={cx('flex flex-col', choosing && 'lg:col-span-2')}>
      <CardHeader title={<span id={headingId}>Turn Sleeve back on</span>} />
      <p className="max-w-reading text-body-s text-ink-secondary">
        Choose a rule and approve it, and payments split again.{' '}
        {balance > 0n ? `The ${usdgText(balance)} already in your account stays spendable. ` : ''}Only payments that arrive after
        that split.
      </p>
      {choosing ? (
        <div className="mt-5">
          <RuleEditor
            current={null}
            market={market.data}
            submitLabel="Review and turn on"
            previewPlacement="inline"
            busy={reinstall.isPending}
            secondaryAction={
              <Button variant="ghost" onClick={() => setChoosing(false)} disabled={reinstall.isPending}>
                Cancel
              </Button>
            }
            onSubmit={(input) => {
              reinstall.reset();
              setRule(input);
              setOpen(true);
            }}
          />
        </div>
      ) : (
        <div className="mt-4">
          <Button icon="play" onClick={() => setChoosing(true)}>
            Turn Sleeve back on
          </Button>
        </div>
      )}
      {rule === null ? null : (
        <ActionDialog
          open={open}
          onClose={() => {
            if (!reinstall.isPending) setOpen(false);
          }}
          action={{ kind: 'reinstall', rule }}
          title="Turn Sleeve back on?"
          description="The module goes back on your account with this rule and starts fresh. USDG already in your account stays spendable, and only payments that arrive after this split. No money moves."
          fallback={<p className="text-body-s text-ink">{splitLine(rule)}</p>}
          confirmLabel="Approve and turn on"
          busyLabel="Turning on"
          busy={reinstall.isPending}
          onConfirm={() => confirm(rule)}
          error={reinstall.isError ? failureText(reinstall.error, 'reinstall') : undefined}
          errorTitle="Sleeve did not turn on"
        />
      )}
    </Card>
  );
}

/**
 * Home for an account Sleeve is off for (D-040): what the account holds, the way to send USDG out, and the way to turn
 * Sleeve back on. It reads the balance and the holdings only, since the module keeps no state for the account.
 */
export function SleeveOffHome({ account }: { account: Address }): JSX.Element {
  const ledger = useLedger(account);
  const holdings = useHoldings(account);
  const header = <PageHeader title={TITLE} description={DESCRIPTION} />;

  if (ledger.data === undefined || holdings.data === undefined) {
    const failed = [ledger, holdings].filter((query) => query.data === undefined && query.isError);
    return (
      <>
        {header}
        {failed.length === 0 ? (
          <HomeSkeleton />
        ) : (
          <LoadError
            title="Your account did not load"
            onRetry={() => failed.forEach((query) => void query.refetch())}
            retrying={failed.some((query) => query.isFetching)}
          >
            Sleeve could not read your balances from Robinhood Chain.
          </LoadError>
        )}
      </>
    );
  }

  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-2 xl:gap-5">
        <MoneyOff balance={ledger.data.balance} holdings={holdings.data} />
        <TurnOn balance={ledger.data.balance} />
      </div>
    </>
  );
}
