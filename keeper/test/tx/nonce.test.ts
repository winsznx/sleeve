import { describe, expect, it } from 'vitest';

import { NonceManager } from '../../src/tx/nonce';

describe('NonceManager', () => {
  it('starts from the pending nonce and counts up locally', async () => {
    // #given
    let reads = 0;
    const nonces = new NonceManager(async () => {
      reads += 1;
      return 7;
    });
    // #when
    const taken = [await nonces.take(), await nonces.take(), await nonces.take()];
    // #then
    expect([taken, reads]).toEqual([[7, 8, 9], 1]);
  });

  it('resyncs from the pending nonce after a send error', async () => {
    // #given
    let pending = 3;
    const nonces = new NonceManager(async () => pending);
    await nonces.take();
    await nonces.take();
    pending = 4;
    // #when
    await nonces.resync();
    // #then
    expect(await nonces.take()).toBe(4);
  });

  it('never hands one nonce to two concurrent sends', async () => {
    // #given
    const nonces = new NonceManager(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 0;
    });
    // #when
    const taken = await Promise.all([nonces.take(), nonces.take(), nonces.take(), nonces.take()]);
    // #then
    expect(taken.sort()).toEqual([0, 1, 2, 3]);
  });

  it('keeps working after a failed pending read', async () => {
    // #given
    let fail = true;
    const nonces = new NonceManager(async () => {
      if (fail) throw new Error('rpc down');
      return 12;
    });
    await expect(nonces.take()).rejects.toThrow('rpc down');
    fail = false;
    // #when
    const nonce = await nonces.take();
    // #then
    expect(nonce).toBe(12);
  });
});
