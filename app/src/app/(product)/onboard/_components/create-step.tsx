'use client';

import { shortAddress, type RuleInput } from '@sleeve/core';
import { useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { cx } from '@/components/ui/cx';
import { Icon } from '@/components/ui/icons';
import { ConnectWalletButton } from '@/components/wallet/connect-wallet-button';
import { useWalletConnection, useWalletSigner } from '@/components/wallet/use-wallet';
import { walletProblem, walletProblemText } from '@/components/wallet/wallet-problems';
import { isDataLayerError } from '@/data/errors';
import { useCreateAccount } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { AccountSetupStep, AccountSignerInput, Session } from '@/data/types';
import { signerApprovalLine } from '@/lib/signer';

import { countryPhrase, recoverySummary, ruleSummary, signerSummary, type ChosenRecovery, type ChosenSigner, type Step } from '../_lib/onboarding';

const STEP_WORDS: Record<AccountSetupStep, { doing: string; done: string }> = {
  approve: { doing: 'Waiting for your approval', done: 'Approved' },
  deploy: { doing: 'Deploying your account', done: 'Account deployed' },
  install: { doing: 'Installing the Sleeve module with your rule', done: 'Sleeve module installed' },
  recovery: { doing: 'Adding your recovery wallet', done: 'Recovery wallet added' },
  check: { doing: 'Checking that both are in place', done: 'Checked' },
};

function setupFailureText(error: Error, owner: ChosenSigner): string {
  if (isDataLayerError(error)) {
    switch (error.code) {
      case 'PasskeyCancelled':
        return 'The passkey prompt closed before you approved it. Nothing was created. Try again when you are ready.';
      case 'PasskeyUnavailable':
        return "This browser could not use your passkey here. It works only on Sleeve's own site. Nothing was created.";
      case 'SponsorshipUnavailable':
        return walletProblemText({ kind: 'SPONSORSHIP' });
      case 'SourceUnavailable':
        return 'Sleeve could not reach Robinhood Chain, so the account was not checked. Nothing moved. Try again in a moment.';
      default:
        return 'The account was not created. Nothing moved. Try again in a moment.';
    }
  }
  return walletProblemText(walletProblem(error), owner.kind === 'wallet' ? owner.address : undefined);
}

export interface CreateStepProps {
  residence: string;
  signer: ChosenSigner;
  recovery: ChosenRecovery;
  rule: RuleInput;
  onEdit: (step: Step) => void;
  onCreated: (session: Session) => void;
}

/**
 * The last step (D-019, D-022): what was chosen, who will sign and how, then the account. The owner approves one
 * UserOp that deploys the account and installs the module with the rule; a recovery wallet goes in with a second
 * approval; and the payment address appears only after both views are read back.
 */
export function CreateStep({ residence, signer, recovery, rule, onEdit, onCreated }: CreateStepProps): JSX.Element {
  const create = useCreateAccount();
  const connection = useWalletConnection();
  const walletSigner = useWalletSigner();
  const [current, setCurrent] = useState<AccountSetupStep | null>(null);
  const [reached, setReached] = useState<AccountSetupStep[]>([]);

  const steps: AccountSetupStep[] =
    recovery.kind === 'wallet' ? ['approve', 'deploy', 'install', 'recovery', 'check'] : ['approve', 'deploy', 'install', 'check'];
  const walletReady =
    signer.kind === 'passkey' ||
    (connection.status === 'connected' && connection.address.toLowerCase() === signer.address.toLowerCase());

  function run() {
    const input: AccountSignerInput =
      signer.kind === 'passkey'
        ? { kind: 'passkey', credentialId: signer.credential.credentialId }
        : { kind: 'wallet', wallet: walletSigner(signer.address) };
    setReached([]);
    setCurrent(null);
    create.mutate(
      {
        rule,
        recoverySigner: recovery.kind === 'wallet' ? recovery.address : null,
        signer: input,
        onStep: (step) => {
          setCurrent(step);
          setReached((previous) => [...previous, step]);
        },
      },
      { onSuccess: onCreated },
    );
  }

  const summary: { id: Step; term: string; value: string }[] = [
    { id: 'eligibility', term: 'Where you live', value: countryPhrase(residence) },
    { id: 'signer', term: 'Signs for the account', value: signerSummary(signer) },
    { id: 'recovery', term: 'Recovery', value: recoverySummary(recovery) },
    { id: 'rule', term: 'Your rule', value: ruleSummary(rule) },
  ];

  return (
    <div className="flex flex-col gap-5">
      <dl className="divide-y divide-border rounded-large border border-border bg-surface">
        {summary.map((row) => (
          <div key={row.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <dt className="text-body-s text-ink-secondary">{row.term}</dt>
              <dd className="text-body text-ink">{row.value}</dd>
            </div>
            {row.id === 'recovery' && signer.kind === 'wallet' ? null : (
              <Button variant="ghost" size="sm" onClick={() => onEdit(row.id)} disabled={create.isPending} className="-mr-2 shrink-0">
                Change<span className="sr-only"> {row.term.toLowerCase()}</span>
              </Button>
            )}
          </div>
        ))}
      </dl>

      <Note title={signer.kind === 'passkey' ? 'One approval with your passkey' : 'One signature in your wallet'}>
        {signerApprovalLine(signer.kind)} It deploys your account and installs the Sleeve module with your rule in one step.
        {recovery.kind === 'wallet' ? ' Adding the recovery wallet asks once more.' : ''}
        {DATA_SOURCE === 'mock' ? ' Sample data: nothing is sent to Robinhood Chain, and the account lasts until you reload the page.' : ''}
      </Note>

      {create.isPending || create.isError ? (
        <ol aria-label="Setting up your account" className="flex flex-col gap-2 rounded-large border border-border bg-surface p-4">
          {steps.map((step) => {
            const failed = create.isError && current === step;
            const done = reached.includes(step) && (step !== current || create.isSuccess);
            const doing = create.isPending && current === step;
            return (
              <li key={step} className="flex items-center gap-3 text-body-s">
                <span
                  aria-hidden="true"
                  className={cx(
                    'grid size-6 shrink-0 place-items-center rounded-pill',
                    failed && 'bg-danger-soft text-danger',
                    !failed && done && 'bg-success-soft text-success',
                    !failed && doing && 'bg-brand text-on-brand',
                    !failed && !done && !doing && 'border border-border bg-surface',
                  )}
                >
                  {failed ? '!' : done ? <Icon name="check" className="size-3.5" /> : doing ? <span className="size-1.5 rounded-pill bg-surface" /> : null}
                </span>
                <span className={cx(done || doing || failed ? 'text-ink' : 'text-ink-muted', doing && 'font-medium')}>
                  {done ? STEP_WORDS[step].done : STEP_WORDS[step].doing}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {create.isError ? (
        <ErrorBlock title="The account was not created">{setupFailureText(create.error, signer)}</ErrorBlock>
      ) : null}

      {walletReady ? null : (
        <div className="flex flex-wrap items-center gap-3 rounded-row bg-warning-soft p-4 text-body-s text-ink">
          <span className="min-w-0 flex-1">
            {connection.status === 'connected'
              ? walletProblemText({ kind: 'WRONG_OWNER', selected: connection.address }, signer.kind === 'wallet' ? signer.address : undefined)
              : `Connect ${signer.kind === 'wallet' ? shortAddress(signer.address) : 'your wallet'} again to sign.`}
          </span>
          <ConnectWalletButton />
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={run} busy={create.isPending} busyLabel="Creating your account" disabled={!walletReady} className="w-full sm:w-auto">
          {create.isError ? 'Try again' : 'Create my Sleeve account'}
        </Button>
      </div>
    </div>
  );
}
