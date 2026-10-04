import type { Address } from '@sleeve/core';

/**
 * Connecting a wallet on a product page (D-041), apart from wagmi and RainbowKit so it reads and tests without them:
 * the address at once when a wallet is connected, after wagmi's reconnect when one is under way, and otherwise after
 * RainbowKit's connect modal. The wallet island feeds it wagmi's account and the modal's state.
 */

/** wagmi's account as the flow reads it. */
export interface AccountReading {
  status: 'connected' | 'connecting' | 'reconnecting' | 'disconnected';
  address: Address | undefined;
}

export interface AccountSource {
  read(): AccountReading;
  /** Calls onChange on every change until the returned function is called. */
  watch(onChange: (account: AccountReading) => void): () => void;
}

export interface ConnectOptions {
  /**
   * Runs right before the connect modal opens, and only when it will. A dialog in the browser's top layer would cover
   * the modal, so it steps aside here; the caller brings it back once connect settles.
   */
  beforeModal?: () => void;
}

/** The person closed the connect modal without connecting a wallet. Nothing failed, so screens show no error. */
export class ConnectClosedError extends Error {
  constructor() {
    super('The connect modal closed before a wallet connected');
    this.name = 'ConnectClosedError';
  }
}

interface Waiting {
  /** The modal has reported open since this wait began, so its closing means the person closed it. */
  shown: boolean;
  resolve: (address: Address) => void;
  reject: (error: unknown) => void;
}

export class ConnectFlow {
  private openModal: (() => void) | undefined = undefined;
  /** A connect asked for the modal while RainbowKit could not open it yet. */
  private modalWanted = false;
  private waiting: Waiting | null = null;
  private running: Promise<Address> | null = null;

  constructor(private readonly account: AccountSource) {}

  /** RainbowKit's modal state, from the component inside its provider that can read it. */
  modalChanged(open: boolean, openModal: (() => void) | undefined): void {
    this.openModal = openModal;
    const waiting = this.waiting;
    if (open) {
      if (waiting !== null) waiting.shown = true;
      return;
    }
    if (this.modalWanted && openModal !== undefined) {
      this.modalWanted = false;
      openModal();
      return;
    }
    if (waiting === null || !waiting.shown) return;
    const reading = this.account.read();
    if (reading.status === 'connected' && reading.address !== undefined) waiting.resolve(reading.address);
    else waiting.reject(new ConnectClosedError());
  }

  /** The connected wallet's address. A call while another is running joins it. */
  connect(options: ConnectOptions = {}): Promise<Address> {
    this.running ??= this.run(options).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(options: ConnectOptions): Promise<Address> {
    const settled = await this.settled();
    if (settled.status === 'connected' && settled.address !== undefined) return settled.address;
    options.beforeModal?.();
    return new Promise<Address>((resolve, reject) => {
      let stop: () => void = () => undefined;
      const finish = (): void => {
        stop();
        this.waiting = null;
        this.modalWanted = false;
      };
      const waiting: Waiting = {
        shown: false,
        resolve: (address) => {
          finish();
          resolve(address);
        },
        reject: (error) => {
          finish();
          reject(error);
        },
      };
      this.waiting = waiting;
      stop = this.account.watch((reading) => {
        if (reading.status === 'connected' && reading.address !== undefined) waiting.resolve(reading.address);
      });
      if (this.openModal === undefined) this.modalWanted = true;
      else this.openModal();
    });
  }

  /** The account once wagmi has finished any reconnect or connect under way. */
  private settled(): Promise<AccountReading> {
    const now = this.account.read();
    if (now.status === 'connected' || now.status === 'disconnected') return Promise.resolve(now);
    return new Promise((resolve) => {
      const stop = this.account.watch((reading) => {
        if (reading.status !== 'connected' && reading.status !== 'disconnected') return;
        stop();
        resolve(reading);
      });
    });
  }
}
