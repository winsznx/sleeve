/**
 * The keeper's own nonce counter: it starts from the account's pending nonce, goes up by one per signed transaction,
 * and starts over from the pending nonce after any send error, so a refused or replaced transaction never leaves a
 * gap or a reuse behind it. Takes are serialized, so two sends can never sign with one nonce.
 */
export class NonceManager {
  private next: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly fetchPending: () => Promise<number>) {}

  /** The nonce for the next transaction. */
  take(): Promise<number> {
    return this.serialize(async () => {
      if (this.next === null) this.next = await this.fetchPending();
      const nonce = this.next;
      this.next += 1;
      return nonce;
    });
  }

  /** Forgets the local count and reads the pending nonce again. */
  resync(): Promise<number> {
    return this.serialize(async () => {
      this.next = await this.fetchPending();
      return this.next;
    });
  }

  /** The nonce the next take would return, or null before the first one. */
  peek(): number | null {
    return this.next;
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
