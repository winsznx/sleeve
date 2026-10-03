import { CHAIN_ID, CHAIN_NAME, type Address } from '@sleeve/core';
import type { JSX } from 'react';

import { CopyField, ShareButton } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { QRCode } from '@/components/ui/qr-code';

export interface PaymentAddressCardProps {
  /** The smart account, which is the payment address. Shown in full. */
  address: Address;
  /** Adds a QR code of the address for a payer's wallet to scan. The text stays on screen either way. */
  showQr?: boolean;
  headingLevel?: 2 | 3;
  className?: string;
}

/**
 * The payment address (docs/DESIGN.md 12.7): all 42 characters in mono, copy and share, the network in plain text,
 * and optionally a QR code of exactly the same text. The address is never shown only as a QR code.
 */
export function PaymentAddressCard({ address, showQr = false, headingLevel = 2, className }: PaymentAddressCardProps): JSX.Element {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={cx('min-w-0 rounded-module border border-border bg-surface p-card', className)}>
      <Heading className="text-h3 text-ink">Your payment address</Heading>
      <p className="mt-1 text-body-s text-ink-secondary">
        Payers send USDG on {CHAIN_NAME} to this address. Your rule splits what arrives.
      </p>
      <div className={cx('mt-4 flex flex-col gap-4', showQr && 'sm:flex-row sm:items-start')}>
        {showQr ? (
          <QRCode value={address} label="QR code of your payment address" className="shrink-0 self-center border border-border sm:self-start" />
        ) : null}
        <div className="min-w-0 flex-1">
          <CopyField
            label="Payment address"
            value={address}
            copyLabel="Copy payment address"
            actions={<ShareButton text={address} title="Sleeve payment address" label="Share payment address" />}
          />
          <p className="mt-2 text-body-s text-ink-secondary">
            {CHAIN_NAME}, chain id {CHAIN_ID}
          </p>
        </div>
      </div>
    </section>
  );
}
