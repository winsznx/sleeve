import { shortAddress, type Receipt } from '@sleeve/core';
import type { JSX } from 'react';

import { usdgExact } from '@/components/sleeve/text';
import { Amount } from '@/components/ui/amount';
import { CopyButton } from '@/components/ui/copy-field';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { DefinitionList } from '@/components/ui/list';

import { isoTime } from '../../_lib/register';
import { rawReceiptFields, type FieldValue, type ReceiptField, type ReceiptSection } from '../receipt-sections';

/**
 * The proof section's fact lists (the receipt, how it ran, what the logs add) and every field as stored. Machine
 * values are mono with a copy button and, when the data comes from the chain, a link to the block explorer; fields
 * read from logs or the rule's history say "derived".
 */

const EXTERNAL = 'inline-flex min-h-touch items-center gap-1 text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover';

function ExplorerLink({ base, path }: { base: string; path: string }): JSX.Element {
  return (
    <a href={`${base}${path}`} target="_blank" rel="noreferrer" className={EXTERNAL}>
      View on the explorer
      <Icon name="external" className="size-4" />
    </a>
  );
}

function FieldValueView({ value, explorerBase }: { value: FieldValue; explorerBase: string | null }): JSX.Element {
  switch (value.kind) {
    case 'text':
      return <div>{value.text}</div>;
    case 'machine':
      return (
        <div>
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 break-all py-px font-mono text-mono-s">{value.value}</span>
            {value.copyLabel === undefined ? null : <CopyButton value={value.value} label={value.copyLabel} className="-my-3 -mr-2.5" />}
          </div>
          {value.explorer === undefined || explorerBase === null ? null : <ExplorerLink base={explorerBase} path={value.explorer} />}
        </div>
      );
    case 'time':
      return (
        <div>
          <time dateTime={isoTime(value.seconds)}>{formatUtc(value.seconds)}</time>
          <span className="block font-mono text-mono-s text-ink-muted">{value.seconds.toString()}</span>
        </div>
      );
    case 'transfers':
      if (value.transfers.length === 0) return <div>None. This action sorted no incoming payment.</div>;
      return (
        <ul className="flex flex-col gap-2.5">
          {value.transfers.map((transfer) => (
            <li key={`${transfer.txHash}:${transfer.logIndex}`}>
              <Amount value={usdgExact(transfer.amount)} unit="USDG" className="font-medium" /> from{' '}
              <span className="font-mono text-mono-s">{shortAddress(transfer.from)}</span>
              <span className="block break-all font-mono text-mono-s text-ink-muted">
                {transfer.txHash}:{transfer.logIndex}
              </span>
            </li>
          ))}
        </ul>
      );
  }
}

function FieldView({ field, explorerBase }: { field: ReceiptField; explorerBase: string | null }): JSX.Element {
  return (
    <>
      <FieldValueView value={field.value} explorerBase={explorerBase} />
      {field.note === undefined ? null : <p className="mt-1 text-body-s text-ink-muted">{field.note}</p>}
    </>
  );
}

export interface FactSectionProps {
  section: ReceiptSection;
  /** The block explorer, when the data comes from the chain. Null on sample data, whose hashes exist nowhere. */
  explorerBase: string | null;
}

export function FactSection({ section, explorerBase }: FactSectionProps): JSX.Element {
  const titleId = `action-section-${section.id}`;
  return (
    <section aria-labelledby={titleId} className="min-w-0 rounded-module border border-border bg-surface px-card pb-1 pt-card md:px-6 md:pt-6">
      <h3 id={titleId} className="text-h3 text-ink">
        {section.title}
      </h3>
      {section.intro === undefined ? null : <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{section.intro}</p>}
      <DefinitionList
        className="mt-2"
        items={section.fields.map((field) => ({
          id: field.id,
          term: field.term,
          derived: field.derived,
          value: <FieldView field={field} explorerBase={explorerBase} />,
        }))}
      />
    </section>
  );
}

/** Every field in SPEC order, behind one disclosure: what anyone abi-encodes to check the receipt hash. */
export function RawFields({ receipt }: { receipt: Receipt }): JSX.Element {
  const fields = rawReceiptFields(receipt);
  return (
    <details className="group min-w-0 rounded-module border border-border bg-surface">
      <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 rounded-module px-card py-3 md:px-6 [&::-webkit-details-marker]:hidden">
        <h3 className="text-h3 text-ink">All {fields.length} receipt fields as stored</h3>
        <Icon name="chevronDown" className="text-ink-secondary transition-transform duration-fast ease-standard group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-card pb-1 pt-3 md:px-6">
        <p className="max-w-reading text-body-s text-ink-secondary">
          The module stores keccak256 of these values, encoded in this order, as the receipt hash. Each enum shows its
          uint8 in parentheses.
        </p>
        <DefinitionList
          className="mt-2"
          items={fields.map((field) => ({
            id: field.name,
            term: (
              <>
                <span className="font-mono text-mono-s text-ink">{field.name}</span>{' '}
                <span className="font-mono text-mono-s text-ink-muted">{field.type}</span>
              </>
            ),
            value: field.value,
            mono: true,
          }))}
        />
      </div>
    </details>
  );
}
