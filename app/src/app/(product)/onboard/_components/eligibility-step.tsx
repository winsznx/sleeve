'use client';

import { useId, useState, type FormEvent, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/choice';
import { Select } from '@/components/ui/field';
import { useCheckEligibility } from '@/data/hooks';
import type { EligibilityResult } from '@/data/types';
import { COUNTRIES } from '@/lib/countries';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

import { joinedPlaces } from '../_lib/onboarding';

type Answer = '' | 'no' | 'yes';

const ANSWERS = [
  { value: 'no' as const, label: 'No' },
  { value: 'yes' as const, label: 'Yes' },
];

export interface EligibilityStepProps {
  /** A residence chosen before, when the person came back to this step. */
  residence: string | null;
  onEligible: (residence: string) => void;
  onBlocked: (result: EligibilityResult) => void;
}

/**
 * Who may set up Sleeve (PRD 3 and 7.12): where the person lives and two plain questions, then the server's check of
 * the country the request comes from. A block stops onboarding; checking a split stays open to everyone.
 */
export function EligibilityStep({ residence: initial, onEligible, onBlocked }: EligibilityStepProps): JSX.Element {
  const listId = useId();
  const check = useCheckEligibility();
  const [residence, setResidence] = useState(initial ?? '');
  const [usPerson, setUsPerson] = useState<Answer>(initial === null ? '' : 'no');
  const [sanctioned, setSanctioned] = useState<Answer>(initial === null ? '' : 'no');
  const [tried, setTried] = useState(false);

  const missing = residence === '' || usPerson === '' || sanctioned === '';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTried(true);
    if (missing) return;
    check.mutate(
      { residence, notUsPerson: usPerson === 'no', notSanctioned: sanctioned === 'no' },
      { onSuccess: (result) => (result.eligible ? onEligible(residence) : onBlocked(result)) },
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6 rounded-large border border-border bg-surface p-card shadow-card md:p-6">
      <Select
        label="Where do you live?"
        value={residence}
        onChange={(event) => setResidence(event.target.value)}
        error={tried && residence === '' ? 'Choose the country you live in.' : undefined}
        hint="The country you live in now, not where you were born."
        disabled={check.isPending}
        className="max-w-md"
      >
        <option value="" disabled>
          Choose your country
        </option>
        {COUNTRIES.map(([code, name]) => (
          <option key={code} value={code}>
            {name}
          </option>
        ))}
      </Select>
      <div>
        <SegmentedControl
          legend="Are you a US person?"
          options={ANSWERS}
          value={usPerson}
          onChange={setUsPerson}
          disabled={check.isPending}
          hint="A US citizen or US resident, wherever you live, or anyone acting for one."
        />
        {tried && usPerson === '' ? <p className="mt-2 text-body-s text-danger">Answer this question to go on.</p> : null}
      </div>
      <div>
        <SegmentedControl
          legend="Are you subject to sanctions?"
          options={ANSWERS}
          value={sanctioned}
          onChange={setSanctioned}
          disabled={check.isPending}
          hint="Named on a sanctions list, or acting for anyone who is."
        />
        {tried && sanctioned === '' ? <p className="mt-2 text-body-s text-danger">Answer this question to go on.</p> : null}
      </div>
      <Note title="Where Sleeve is not offered">
        <span id={listId}>
          Stock Tokens are not offered to residents of {joinedPlaces(Object.keys(RESTRICTED_JURISDICTIONS))}, or of{' '}
          {joinedPlaces(Object.keys(PROHIBITED_JURISDICTIONS))}. Sleeve also checks the country your connection comes from. It
          reads only the country, never your IP address.
        </span>
      </Note>
      {check.isError ? (
        <ErrorBlock title="The check did not finish">
          Sleeve could not check where your connection comes from. Nothing was set up. Try again in a moment.
        </ErrorBlock>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" busy={check.isPending} busyLabel="Checking" aria-describedby={listId} className="w-full sm:w-auto">
          Check and continue
        </Button>
      </div>
    </form>
  );
}
