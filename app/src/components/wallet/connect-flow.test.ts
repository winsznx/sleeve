import type { Address } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { ConnectClosedError, ConnectFlow, type AccountReading, type AccountSource } from './connect-flow';

const WALLET: Address = '0x05a1C0FfEE00000000000000000000000000b92D';
const CONNECTED: AccountReading = { status: 'connected', address: WALLET };
const DISCONNECTED: AccountReading = { status: 'disconnected', address: undefined };
const RECONNECTING: AccountReading = { status: 'reconnecting', address: undefined };

/** wagmi's account as a store the test moves by hand. */
function fakeAccount(initial: AccountReading) {
  let current = initial;
  const listeners = new Set<(account: AccountReading) => void>();
  const source: AccountSource = {
    read: () => current,
    watch(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
  return {
    source,
    set(next: AccountReading) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
    listening: () => listeners.size,
  };
}

/** A flow whose RainbowKit modal records each open in `events`, as does the beforeModal the test passes. */
function flowWith(initial: AccountReading) {
  const account = fakeAccount(initial);
  const flow = new ConnectFlow(account.source);
  const events: string[] = [];
  const openModal = () => events.push('modal opened');
  flow.modalChanged(false, openModal);
  const beforeModal = () => events.push('stepped aside');
  return { account, flow, events, openModal, beforeModal };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ConnectFlow', () => {
  it('answers at once with a wallet that is already connected, and opens nothing', async () => {
    const { flow, events, beforeModal } = flowWith(CONNECTED);
    expect(await flow.connect({ beforeModal })).toBe(WALLET);
    expect(events).toEqual([]);
  });

  it('steps the caller aside before it opens the modal, and answers once the wallet connects', async () => {
    // #given no wallet connected
    const { account, flow, events, openModal, beforeModal } = flowWith(DISCONNECTED);
    // #when a connect is asked for and the person connects in the modal
    const address = flow.connect({ beforeModal });
    await settle();
    expect(events).toEqual(['stepped aside', 'modal opened']);
    flow.modalChanged(true, openModal);
    account.set(CONNECTED);
    // #then the address comes back and the flow stops listening
    expect(await address).toBe(WALLET);
    expect(account.listening()).toBe(0);
  });

  it('rejects with ConnectClosedError when the modal closes without a wallet', async () => {
    const { flow, openModal, beforeModal } = flowWith(DISCONNECTED);
    const address = flow.connect({ beforeModal });
    await settle();
    flow.modalChanged(true, openModal);
    flow.modalChanged(false, openModal);
    await expect(address).rejects.toBeInstanceOf(ConnectClosedError);
  });

  it('waits out a reconnect, and opens the modal only when it ends with no wallet', async () => {
    // #given wagmi reconnecting from the cookie, twice
    const back = flowWith(RECONNECTING);
    const gone = flowWith(RECONNECTING);
    const reconnected = back.flow.connect();
    const lost = gone.flow.connect();
    await settle();
    // #when one reconnect finds the wallet and the other does not
    back.account.set(CONNECTED);
    gone.account.set(DISCONNECTED);
    await settle();
    // #then the first answers with no modal, and the second opens it
    expect(await reconnected).toBe(WALLET);
    expect([back.events, gone.events]).toEqual([[], ['modal opened']]);
    gone.account.set(CONNECTED);
    expect(await lost).toBe(WALLET);
  });

  it('opens the modal as soon as RainbowKit offers it, when it could not open yet', async () => {
    const { flow, events } = flowWith(DISCONNECTED);
    flow.modalChanged(false, undefined);
    void flow.connect();
    await settle();
    expect(events).toEqual([]);
    flow.modalChanged(false, () => events.push('modal opened later'));
    expect(events).toEqual(['modal opened later']);
  });

  it('joins a second press to the connect already running', async () => {
    const { flow } = flowWith(DISCONNECTED);
    expect(flow.connect()).toBe(flow.connect());
  });
});
