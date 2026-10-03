import type { Metadata } from 'next';
import type { JSX } from 'react';

import { SendScreen } from './send-screen';

export const metadata: Metadata = { title: 'Send USDG' };

export default function SendPage(): JSX.Element {
  return <SendScreen />;
}
