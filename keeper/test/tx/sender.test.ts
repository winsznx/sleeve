import { CHAIN_ID } from '@sleeve/core';
import { type Hex, type TransactionReceipt, WaitForTransactionReceiptTimeoutError, parseTransaction } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { MODULE_ADDRESS, type KeeperCall } from '../../src/chain/calls';
import { GasAboveCapError, SendError, TxTimeoutError } from '../../src/errors';
import { silentLogger } from '../../src/log';
import { NonceManager } from '../../src/tx/nonce';
import { TxSender } from '../../src/tx/sender';
import { FakeChain } from '../support/fake-chain';

const CALL: KeeperCall = {
  fn: 'split',
  account: '0xada0000000000000000000000000000000000001',
  pool: '0xa7bb1ac63bbab0c44316e6c8c455213441689167',
  quote: 1_297_424_691_357_802n,
};

function minedReceipt(hash: Hex, status: 'success' | 'reverted' = 'success'): TransactionReceipt {
  return {
    transactionHash: hash,
    status,
    blockNumber: 1_001n,
    blockHash: `0x${'1'.repeat(64)}`,
    gasUsed: 543_779n,
    effectiveGasPrice: 22_294_000n,
    logs: [],
  } as unknown as TransactionReceipt;
}

function setup(): { chain: FakeChain; sender: TxSender; nonces: NonceManager } {
  const chain = new FakeChain();
  chain.nonce = 5;
  chain.mined = (hash) => minedReceipt(hash);
  const account = privateKeyToAccount(generatePrivateKey());
  const nonces = new NonceManager(() => chain.pendingNonce());
  const sender = new TxSender({ chain, account, nonces, maxFeeWei: 1_000_000_000n, maxGas: 1_200_000n, log: silentLogger });
  return { chain, sender, nonces };
}

describe('TxSender', () => {
  it('signs an EIP-1559 call to the module with the keeper nonce, capped gas and capped fees', async () => {
    // #given
    const { chain, sender } = setup();
    chain.gasEstimate = 543_779n;
    // #when
    const mined = await sender.send(CALL, 22_294_000n);
    // #then
    const tx = parseTransaction(chain.sent[0] as Hex);
    expect({
      type: tx.type,
      chainId: tx.chainId,
      to: tx.to?.toLowerCase(),
      nonce: tx.nonce,
      gas: tx.gas,
      maxFeePerGas: tx.maxFeePerGas,
      // RLP carries a zero as empty, so the parsed transaction leaves it out.
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas ?? 0n,
      value: tx.value ?? 0n,
      mined: mined.receipt.status,
    }).toEqual({
      type: 'eip1559',
      chainId: CHAIN_ID,
      to: MODULE_ADDRESS.toLowerCase(),
      nonce: 5,
      gas: 662_534n,
      maxFeePerGas: 44_588_000n,
      maxPriorityFeePerGas: 0n,
      value: 0n,
      mined: 'success',
    });
  });

  it('counts nonces up across sends', async () => {
    // #given
    const { chain, sender } = setup();
    // #when
    await sender.send(CALL, 22_294_000n);
    await sender.send(CALL, 22_294_000n);
    // #then
    expect(chain.sent.map((raw) => parseTransaction(raw).nonce)).toEqual([5, 6]);
  });

  it('refuses a call whose estimate is above the per-call cap, before signing', async () => {
    // #given
    const { chain, sender } = setup();
    chain.gasEstimate = 1_300_000n;
    // #when
    const attempt = sender.send(CALL, 22_294_000n);
    // #then
    await expect(attempt).rejects.toBeInstanceOf(GasAboveCapError);
    expect(chain.sent).toEqual([]);
  });

  it('resyncs the nonce when the RPC refuses the transaction', async () => {
    // #given
    const { chain, sender, nonces } = setup();
    chain.sendRawTransaction = async () => {
      throw new Error('nonce too low');
    };
    chain.nonce = 9;
    // #when
    const attempt = sender.send(CALL, 22_294_000n);
    // #then
    await expect(attempt).rejects.toBeInstanceOf(SendError);
    expect(nonces.peek()).toBe(9);
  });

  it('waits for a transaction the node already holds instead of resyncing', async () => {
    // #given
    const { chain, sender } = setup();
    chain.sendRawTransaction = async () => {
      throw new Error('already known');
    };
    // #when
    const mined = await sender.send(CALL, 22_294_000n);
    // #then
    expect(mined.nonce).toBe(5);
  });

  it('reports a receipt that never came as a timeout with its hash, and resyncs', async () => {
    // #given
    const { chain, sender, nonces } = setup();
    chain.mined = (hash) => {
      throw new WaitForTransactionReceiptTimeoutError({ hash });
    };
    chain.nonce = 6;
    // #when
    const attempt = sender.send(CALL, 22_294_000n);
    // #then
    await expect(attempt).rejects.toBeInstanceOf(TxTimeoutError);
    expect(nonces.peek()).toBe(6);
  });
});
