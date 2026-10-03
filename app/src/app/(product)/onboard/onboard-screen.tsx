'use client';

import { shortAddress } from '@sleeve/core';
import { useEffect, useReducer, useRef, useState, type JSX, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { useMarket, useSession } from '@/data/hooks';
import type { EligibilityResult } from '@/data/types';

import { RuleEditor } from '../rule/_components/rule-editor';
import { Blocked } from './_components/blocked';
import { CreateStep } from './_components/create-step';
import { Done } from './_components/done';
import { EligibilityStep } from './_components/eligibility-step';
import { RecoveryStep } from './_components/recovery-step';
import { SignerStep } from './_components/signer-step';
import { Stepper, type StepperItem } from './_components/stepper';
import {
  canOpen,
  countryPhrase,
  INITIAL_STATE,
  onboardReducer,
  recoverySummary,
  ruleSummary,
  signerSummary,
  STEPS,
  type OnboardState,
  type Step,
} from './_lib/onboarding';

const STEP_TEXT: Record<Step, { title: string; lead: string; ahead: string }> = {
  eligibility: {
    title: 'Where you live',
    lead: 'The issuer of Stock Tokens does not offer them everywhere, so Sleeve asks first.',
    ahead: 'Your country and two questions',
  },
  signer: {
    title: 'How you sign',
    lead: 'Whatever signs owns your Sleeve account. You approve every change with it, and Sleeve never holds your money.',
    ahead: 'A passkey or a wallet you have',
  },
  recovery: {
    title: 'Recovery wallet',
    lead: 'Optional. A second way into the account if you lose your passkey.',
    ahead: 'Optional, for passkey accounts',
  },
  rule: {
    title: 'Your rule',
    lead: 'How each payment splits. Sleeve suggests 10 percent to SPY; the choice is yours, and you can change it later.',
    ahead: 'How each payment splits',
  },
  create: {
    title: 'Your account',
    lead: 'One approval deploys your account and installs the Sleeve module with your rule. Then you get your payment address.',
    ahead: 'Deploy, install, then your address',
  },
};

function detailOf(state: OnboardState, step: Step): string {
  switch (step) {
    case 'eligibility':
      return state.residence === null ? STEP_TEXT.eligibility.ahead : `${countryPhrase(state.residence)}, eligible`;
    case 'signer':
      return state.signer === null ? STEP_TEXT.signer.ahead : signerSummary(state.signer);
    case 'recovery':
      return state.recovery === null ? STEP_TEXT.recovery.ahead : recoverySummary(state.recovery);
    case 'rule':
      return state.rule === null ? STEP_TEXT.rule.ahead : ruleSummary(state.rule);
    case 'create':
      return state.session === null ? STEP_TEXT.create.ahead : `Created, ${shortAddress(state.session.account)}`;
  }
}

function isDone(state: OnboardState, step: Step): boolean {
  switch (step) {
    case 'eligibility':
      return state.residence !== null;
    case 'signer':
      return state.signer !== null;
    case 'recovery':
      return state.recovery !== null;
    case 'rule':
      return state.rule !== null;
    case 'create':
      return state.session !== null;
  }
}

/**
 * Setting up Sleeve (PRD 7.12, D-003, D-014, D-022): eligibility first, then how the owner signs, an optional recovery
 * wallet, the rule, and the account. Each step's choice is kept, so going back to change one never loses the others.
 * The wallet providers wrap only this route (onboard/layout.tsx).
 */
export function OnboardScreen(): JSX.Element {
  const [state, dispatch] = useReducer(onboardReducer, INITIAL_STATE);
  const [blocked, setBlocked] = useState<EligibilityResult | null>(null);
  const session = useSession();
  const market = useMarket();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);

  // Focus is a browser system outside React: when the step changes, move it to the step's heading so a keyboard or
  // screen reader user lands on the new step instead of a button that no longer exists. Not on the first render.
  const shownStep = state.session === null ? state.step : 'done';
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [shownStep, blocked]);

  const items: StepperItem[] = STEPS.map((step) => ({
    id: step,
    title: STEP_TEXT[step].title,
    detail: detailOf(state, step),
    state: state.session === null && state.step === step ? 'active' : isDone(state, step) ? 'done' : 'upcoming',
    onOpen: canOpen(state, step) && state.step !== step ? () => dispatch({ type: 'goto', step }) : undefined,
  }));

  let body: ReactNode;
  if (state.session !== null) {
    body = <Done account={state.session.account} />;
  } else {
    switch (state.step) {
      case 'eligibility':
        body = (
          <EligibilityStep
            residence={state.residence}
            onEligible={(residence) => dispatch({ type: 'eligible', residence })}
            onBlocked={setBlocked}
          />
        );
        break;
      case 'signer':
        body = <SignerStep chosen={state.signer} onChosen={(signer) => dispatch({ type: 'signer', signer })} />;
        break;
      case 'recovery':
        body = <RecoveryStep chosen={state.recovery} onChosen={(recovery) => dispatch({ type: 'recovery', recovery })} />;
        break;
      case 'rule':
        body = (
          <RuleEditor
            current={null}
            initial={state.rule}
            market={market.data}
            submitLabel="Continue"
            previewPlacement="inline"
            onSubmit={(rule) => dispatch({ type: 'rule', rule })}
            secondaryAction={
              <Button variant="ghost" onClick={() => dispatch({ type: 'goto', step: state.signer?.kind === 'wallet' ? 'signer' : 'recovery' })}>
                Back
              </Button>
            }
          />
        );
        break;
      case 'create':
        body =
          state.residence === null || state.signer === null || state.recovery === null || state.rule === null ? null : (
            <CreateStep
              residence={state.residence}
              signer={state.signer}
              recovery={state.recovery}
              rule={state.rule}
              onEdit={(step) => dispatch({ type: 'goto', step })}
              onCreated={(created) => dispatch({ type: 'created', session: created })}
            />
          );
        break;
    }
  }

  const heading = state.session === null ? STEP_TEXT[state.step] : null;

  return (
    <div className="mx-auto w-full max-w-content">
      <PageHeader
        title="Set up Sleeve"
        description="A payment address that invests part of every payment: the rest stays spendable USDG, and nothing goes onchain until the last step."
      />
      {session.data !== undefined && session.data !== null && state.session === null && blocked === null ? (
        <p className="-mt-3 mb-6 text-body-s text-ink-muted">
          You are signed in to {shortAddress(session.data.account)}. Finishing here signs you in to the new account instead.
        </p>
      ) : null}
      {blocked !== null ? (
        <div>
          <h2 ref={headingRef} tabIndex={-1} className="sr-only">
            Not available
          </h2>
          <Blocked
            result={blocked}
            onBack={() => {
              setBlocked(null);
              dispatch({ type: 'goto', step: 'eligibility' });
            }}
          />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[18.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="lg:sticky lg:top-6">
            <Stepper items={items} label="Setup steps" />
          </div>
          <section aria-labelledby="onboard-step-title" className="min-w-0">
            {heading === null ? (
              <h2 id="onboard-step-title" ref={headingRef} tabIndex={-1} className="sr-only">
                Done
              </h2>
            ) : (
              <>
                <h2 id="onboard-step-title" ref={headingRef} tabIndex={-1} className="text-h2 text-ink focus-visible:outline-none">
                  {heading.title}
                </h2>
                <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{heading.lead}</p>
              </>
            )}
            <div className={heading === null ? '' : 'mt-5'}>{body}</div>
          </section>
        </div>
      )}
    </div>
  );
}
