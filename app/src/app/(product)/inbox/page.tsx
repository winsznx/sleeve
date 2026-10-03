import { redirect } from 'next/navigation';

/** The inbox became Payments (D-024): every inbound USDG payment and what it became. Old links land there. */
export default function InboxPage(): never {
  redirect('/payments');
}
