import type { Metadata } from 'next';
import type { JSX } from 'react';

import { PaymentsScreen } from './payments-screen';

export const metadata: Metadata = { title: 'Payments' };

export default function PaymentsPage(): JSX.Element {
  return <PaymentsScreen />;
}
