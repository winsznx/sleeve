import type { Metadata } from 'next';
import type { JSX } from 'react';

import { RuleScreen } from './rule-screen';

export const metadata: Metadata = { title: 'Your rule' };

export default function RulePage(): JSX.Element {
  return <RuleScreen />;
}
