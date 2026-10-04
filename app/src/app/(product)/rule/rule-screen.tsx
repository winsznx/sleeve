'use client';

import { formatBps, TOTAL_BPS, type Address, type Rule, type RuleInput } from '@sleeve/core';
import { useState, type JSX } from 'react';

import { ActionDialog } from '@/components/actions/action-dialog';
import { SleeveOnly } from '@/components/sleeve/sleeve-off';
import { tickerSymbol } from '@/components/sleeve/text';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { useMarket, usePauseRule, useResumeRule, useRule, useSession, useSetRule } from '@/data/hooks';
import type { OwnerAction } from '@/data/types';

import { LoadError } from '../home/_components/load-error';
import { SignedOutPrompt } from '../home/_components/signed-out-prompt';
import { RuleEditor } from './_components/rule-editor';
import { ruleChanges, type RuleChange } from './_lib/rule-draft';
import { ruleFailureText } from './_lib/rule-failure';

const TITLE = 'Your rule';

function statusLine(rule: Rule): string {
  const symbol = tickerSymbol(rule.tickerId);
  switch (rule.status) {
    case 'ACTIVE':
      return `Every payment: ${formatBps(TOTAL_BPS - rule.equityBps)} stays spendable and ${formatBps(rule.equityBps)} buys ${symbol}. Changes apply to the next payment; nothing already split changes.`;
    case 'PAUSED':
      return 'Paused. New payments stay unsorted and spendable USDG until you resume. Nothing already split changes.';
    case 'NONE':
      return 'You have no rule yet, so nothing splits. Choose a Stock Token and how much of each payment buys it, then save.';
  }
}

function ChangeList({ changes }: { changes: readonly RuleChange[] }): JSX.Element {
  return (
    <dl className="divide-y divide-border rounded-row border border-border">
      {changes.map((change) => (
        <div key={change.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5 text-body-s">
          <dt className="text-ink-secondary">{change.label}</dt>
          <dd className="tabular-nums text-ink">
            {change.from} to <span className="font-semibold">{change.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

type PendingOp = { kind: 'save'; input: RuleInput; changes: RuleChange[] } | { kind: 'pause' } | { kind: 'resume' };

function ownerAction(op: PendingOp): OwnerAction {
  switch (op.kind) {
    case 'save':
      return { kind: 'setRule', input: op.input };
    case 'pause':
      return { kind: 'pauseRule' };
    case 'resume':
      return { kind: 'resumeRule' };
  }
}

function AccountRule({ account }: { account: Address }): JSX.Element {
  const rule = useRule(account);
  const market = useMarket();
  const toast = useToast();
  const setRule = useSetRule();
  const pauseRule = usePauseRule();
  const resumeRule = useResumeRule();
  // The op the dialog asks about stays set after it closes, so the dialog keeps its words while it leaves.
  const [pending, setPending] = useState<PendingOp | null>(null);
  const [open, setOpen] = useState(false);

  if (rule.data === undefined) {
    return (
      <>
        <PageHeader title={TITLE} />
        {rule.isError ? (
          <LoadError title="Your rule did not load" onRetry={() => void rule.refetch()} retrying={rule.isFetching}>
            Sleeve could not read your rule from Robinhood Chain.
          </LoadError>
        ) : (
          <SkeletonGroup label="Loading your rule" className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_21.25rem]">
            <Skeleton className="h-[40rem] w-full rounded-large" />
            <Skeleton className="hidden h-96 w-full rounded-module xl:block" />
          </SkeletonGroup>
        )}
      </>
    );
  }

  const current = rule.data;
  const write = pending?.kind === 'pause' ? pauseRule : pending?.kind === 'resume' ? resumeRule : setRule;

  function ask(op: PendingOp) {
    setRule.reset();
    pauseRule.reset();
    resumeRule.reset();
    setPending(op);
    setOpen(true);
  }

  function confirm() {
    if (pending === null) return;
    const done = (title: string, body: string) => {
      setOpen(false);
      toast.show({ title, body });
    };
    if (pending.kind === 'save') {
      setRule.mutate(pending.input, {
        onSuccess: (saved) =>
          done(`Rule saved. Version ${saved.version} is active.`, 'It applies to the next payment. Nothing already split changes.'),
      });
    } else if (pending.kind === 'pause') {
      pauseRule.mutate(undefined, {
        onSuccess: () => done('Rule paused', 'New payments stay unsorted and spendable USDG until you resume.'),
      });
    } else {
      resumeRule.mutate(undefined, {
        onSuccess: () => done('Rule resumed', 'Payments split by your rule again, starting with any that waited unsorted.'),
      });
    }
  }

  const actions =
    current.status === 'ACTIVE' ? (
      <Button variant="secondary" icon="pause" onClick={() => ask({ kind: 'pause' })}>
        Pause rule
      </Button>
    ) : current.status === 'PAUSED' ? (
      <Button icon="play" onClick={() => ask({ kind: 'resume' })}>
        Resume rule
      </Button>
    ) : undefined;

  return (
    <>
      <PageHeader
        title={TITLE}
        description={
          <span className="flex flex-col gap-2">
            {current.status === 'NONE' ? null : (
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone={current.status === 'ACTIVE' ? 'success' : 'waiting'}>{current.status === 'ACTIVE' ? 'Active' : 'Paused'}</Badge>
                <span className="text-body-s text-ink-muted">Version {current.version}</span>
              </span>
            )}
            <span>{statusLine(current)}</span>
          </span>
        }
        actions={actions}
      />
      {current.status === 'PAUSED' ? (
        <Banner title="Your rule is paused" className="mb-6">
          You can still change it below. Saving a change makes the new version active.
        </Banner>
      ) : null}
      <RuleEditor
        key={`${current.version}-${current.status}`}
        current={current}
        market={market.data}
        submitLabel={current.status === 'NONE' ? 'Set your rule' : 'Save rule'}
        requireChange={current.status === 'ACTIVE'}
        busy={setRule.isPending}
        onSubmit={(input) => ask({ kind: 'save', input, changes: current.status === 'NONE' ? [] : ruleChanges(current, input) })}
      />
      {pending === null ? null : (
        <ActionDialog
          open={open}
          onClose={() => setOpen(false)}
          action={ownerAction(pending)}
          busy={write.isPending}
          error={write.isError ? ruleFailureText(write.error) : undefined}
          {...(pending.kind === 'save'
            ? {
                title: current.status === 'NONE' ? 'Set your rule?' : 'Save your rule?',
                description: 'It applies to the next payment. Nothing already split or bought changes, and your money stays in your account.',
                confirmLabel: 'Approve and save',
                busyLabel: 'Waiting for approval',
                errorTitle: 'The rule did not save',
                fallback: pending.changes.length === 0 ? null : <ChangeList changes={pending.changes} />,
              }
            : pending.kind === 'pause'
              ? {
                  title: 'Pause your rule?',
                  description:
                    'New payments stay unsorted and spendable USDG until you resume. Nothing already split, bought or waiting changes.',
                  confirmLabel: 'Approve and pause',
                  busyLabel: 'Waiting for approval',
                  errorTitle: 'The rule did not pause',
                }
              : {
                  title: 'Resume your rule?',
                  description: 'Payments split by your rule again, starting with any USDG that waited unsorted while it was paused.',
                  confirmLabel: 'Approve and resume',
                  busyLabel: 'Waiting for approval',
                  errorTitle: 'The rule did not resume',
                })}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

function RuleLoading(): JSX.Element {
  return (
    <>
      <PageHeader title={TITLE} />
      <SkeletonGroup label="Loading your rule">
        <Skeleton className="h-[40rem] w-full rounded-large" />
      </SkeletonGroup>
    </>
  );
}

/**
 * The rule page (PRD 7.3): the rule as it stands, the editor with its live split, pause and resume. Every write is an
 * owner op the owner approves with their passkey or wallet, and goes through the data layer.
 */
export function RuleScreen(): JSX.Element {
  const session = useSession();
  let body: JSX.Element;
  if (session.data === undefined) {
    body = session.isError ? (
      <>
        <PageHeader title={TITLE} />
        <LoadError title="Your session did not load" onRetry={() => void session.refetch()} retrying={session.isFetching}>
          Sleeve could not check whether you are signed in.
        </LoadError>
      </>
    ) : (
      <RuleLoading />
    );
  } else if (session.data === null) {
    body = (
      <>
        <PageHeader title={TITLE} />
        <SignedOutPrompt />
      </>
    );
  } else {
    body = (
      <SleeveOnly key={session.data.account} account={session.data.account} header={<PageHeader title={TITLE} />} pending={<RuleLoading />}>
        <AccountRule account={session.data.account} />
      </SleeveOnly>
    );
  }
  return <div className="max-w-content">{body}</div>;
}
