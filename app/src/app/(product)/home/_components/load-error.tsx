import type { JSX, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ErrorBlock } from '@/components/ui/card';

export interface LoadErrorProps {
  /** What did not load: "Your account did not load". */
  title: string;
  /** Why, in one plain sentence. */
  children: ReactNode;
  onRetry: () => void;
  /** A retry is running. */
  retrying: boolean;
}

/**
 * A read that failed (PRD 15, Error): what failed, that nothing moved and the USDG is still in the account, and a
 * way to try again. Render it from a client component, because it takes a function.
 */
export function LoadError({ title, children, onRetry, retrying }: LoadErrorProps): JSX.Element {
  return (
    <ErrorBlock
      title={title}
      fundsStillHere
      action={
        <Button variant="secondary" onClick={onRetry} busy={retrying} busyLabel="Trying again">
          Try again
        </Button>
      }
    >
      {children}
    </ErrorBlock>
  );
}
