import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Set up Sleeve' };

export default function OnboardPage() {
  return (
    <main className="mx-auto w-full max-w-content px-gutter py-section">
      <h1 className="text-h1 text-ink">Set up Sleeve</h1>
    </main>
  );
}
