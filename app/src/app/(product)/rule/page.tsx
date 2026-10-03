import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Your rule' };

export default function RulePage() {
  return (
    <main className="mx-auto w-full max-w-content px-gutter py-section">
      <h1 className="text-h1 text-ink">Your rule</h1>
    </main>
  );
}
