import {
  ADDRESSES,
  DEPLOYMENT_4663,
  DISCLOSURE,
  SESSION_REASONS,
  SESSION_TYPES,
  STATUSES,
  aggregatorV3Abi,
  erc20Abi,
  sessionCalendarExtensionAbi,
  sessionOpenedAt,
  sleeveModuleAbi,
  stockTokenAbi,
  tokenSourceAbi,
  uniswapV3PoolAbi,
  type Address,
  type Hex,
  type Receipt,
} from '@sleeve/core';
import { encodeEventTopics, encodeFunctionData, encodeFunctionResult, encodeAbiParameters, numberToHex, pad, parseAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';

import { accessRegistryPauseAbi, stockTokenEventsAbi, stockTokenPauseAbi } from '../src/abi';
import { checkEvidence } from '../src/check';
import { ChainMismatchError, ReadFailedError, ReceiptLogMissingError } from '../src/errors';
import type { RawLog } from '../src/evidence';
import { gatherEvidence } from '../src/gather';
import { hashReceipt } from '../src/receipt';
import { verifyReceipt } from '../src/verify';
import { FakeChain } from './support/fake-chain';
import {
  ACCOUNT,
  BLOCK,
  KEEPER,
  MULTIPLIER,
  PAYER,
  RULE,
  SPY,
  TX,
  USDG,
  filledSplit,
  moduleLog,
  queuedSplit,
  receiptLog,
  ruleSetLog,
  transferLog,
} from './support/fixtures';

const MODULE = DEPLOYMENT_4663.contracts.SleeveModule.address;
const TOKEN_SOURCE = DEPLOYMENT_4663.contracts.TokenSource.address;
const CALENDAR = DEPLOYMENT_4663.contracts.SessionCalendarExtension.address;
const REGISTRY = ADDRESSES.ACCESS_CONTROLS_REGISTRY;

interface ChainOptions {
  /** Blocks between the receipt and the latest block. */
  ahead?: bigint;
  tickerActive?: boolean;
  writeCount?: number;
  extraLogs?: readonly RawLog[];
  nextReceiptId?: bigint;
}

/** A fake chain holding one receipt and everything a gather reads for it, as the deployed contracts would answer. */
function chainFor(receipt: Receipt, txLogs: readonly RawLog[], options: ChainOptions = {}): FakeChain {
  const latestNumber = BLOCK + (options.ahead ?? 1_000n);
  const chain = new FakeChain({ number: latestNumber, timestamp: receipt.timestamp + 3_600n });
  chain.blocks.set(BLOCK, receipt.timestamp);
  chain.addTransaction(TX, KEEPER, MODULE, txLogs);
  chain.logs.push(
    moduleLog('Installed', ACCOUNT, { logIndex: 0, blockNumber: BLOCK - 10n, transactionHash: `0x${'01'.repeat(32)}` }),
    ruleSetLog(ACCOUNT, RULE, { logIndex: 1, blockNumber: BLOCK - 10n, transactionHash: `0x${'01'.repeat(32)}` }),
    transferLog(USDG, PAYER, ACCOUNT, receipt.usdgIn, { logIndex: 0, blockNumber: BLOCK - 5n, transactionHash: `0x${'02'.repeat(32)}` }),
    ...(options.extraLogs ?? []),
  );
  const reply = (to: Address, data: Hex, result: Hex): void => chain.reply(to, data, result);

  reply(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'nextReceiptId' }), encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'nextReceiptId', result: options.nextReceiptId ?? receipt.id + 1n }));
  reply(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'receiptHash', args: [receipt.id] }), encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'receiptHash', result: hashReceipt(receipt) }));
  reply(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'disclosureHash' }), encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'disclosureHash', result: DISCLOSURE.keccak256 }));
  reply(
    MODULE,
    encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'guardParams' }),
    encodeFunctionResult({ abi: sleeveModuleAbi, functionName: 'guardParams', result: { stockFeedMaxAge: 90_000n, usdgFeedMaxAge: 90_000n, depegToleranceBps: 50, multiplierWindow: 86_400n } }),
  );
  const writeCount = options.writeCount ?? 0;
  reply(CALENDAR, encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'version' }), encodeFunctionResult({ abi: sessionCalendarExtensionAbi, functionName: 'version', result: 65_536 + writeCount }));
  reply(CALENDAR, encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'writeCount' }), encodeFunctionResult({ abi: sessionCalendarExtensionAbi, functionName: 'writeCount', result: writeCount }));
  reply(USDG, encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }), encodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', result: 6 }));
  reply(ADDRESSES.USDG_USD_FEED, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'decimals' }), encodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'decimals', result: 8 }));

  reply(
    TOKEN_SOURCE,
    encodeFunctionData({ abi: tokenSourceAbi, functionName: 'ticker', args: [receipt.tickerId] }),
    encodeFunctionResult({ abi: tokenSourceAbi, functionName: 'ticker', result: [SPY.token, SPY.feed, SESSION_TYPES.indexOf('ALL_DAY'), options.tickerActive ?? true] }),
  );
  if (receipt.lotId !== 0n) {
    reply(
      MODULE,
      encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'lot', args: [receipt.lotId] }),
      encodeFunctionResult({
        abi: sleeveModuleAbi,
        functionName: 'lot',
        result: { account: ACCOUNT, tickerId: 0, status: STATUSES.indexOf('FILLED'), tokensBought: receipt.tokensOut, tokensRemaining: receipt.tokensOut },
      }),
    );
  }
  reply(SPY.pool, encodeFunctionData({ abi: uniswapV3PoolAbi, functionName: 'token0' }), encodeFunctionResult({ abi: uniswapV3PoolAbi, functionName: 'token0', result: USDG }));
  reply(TOKEN_SOURCE, encodeFunctionData({ abi: tokenSourceAbi, functionName: 'isPoolAllowed', args: [0, SPY.pool] }), encodeFunctionResult({ abi: tokenSourceAbi, functionName: 'isPoolAllowed', result: true }));

  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'decimals' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'decimals', result: 18 }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'uid' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'uid', result: SPY.uid }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'uiMultiplier' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'uiMultiplier', result: MULTIPLIER }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'newUIMultiplier' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'newUIMultiplier', result: MULTIPLIER }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'effectiveAt' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'effectiveAt', result: 1_789_690_233n }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'oraclePaused' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'oraclePaused', result: false }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenPauseAbi, functionName: 'tokenPaused' }), encodeFunctionResult({ abi: stockTokenPauseAbi, functionName: 'tokenPaused', result: false }));
  reply(SPY.token, encodeFunctionData({ abi: stockTokenAbi, functionName: 'ACCESS_CONTROLLED_REGISTRY' }), encodeFunctionResult({ abi: stockTokenAbi, functionName: 'ACCESS_CONTROLLED_REGISTRY', result: REGISTRY }));
  reply(REGISTRY, encodeFunctionData({ abi: accessRegistryPauseAbi, functionName: 'paused' }), encodeFunctionResult({ abi: accessRegistryPauseAbi, functionName: 'paused', result: false }));
  reply(SPY.feed, encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'decimals' }), encodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'decimals', result: 8 }));
  if (receipt.roundId !== 0n) {
    reply(
      SPY.feed,
      encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'getRoundData', args: [receipt.roundId] }),
      encodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'getRoundData', result: [receipt.roundId, receipt.answer, receipt.updatedAt - 12n, receipt.updatedAt, receipt.roundId] }),
    );
  }
  if (receipt.usdgRoundId !== 0n) {
    const updatedAt = receipt.timestamp - 3_600n;
    reply(
      ADDRESSES.USDG_USD_FEED,
      encodeFunctionData({ abi: aggregatorV3Abi, functionName: 'getRoundData', args: [receipt.usdgRoundId] }),
      encodeFunctionResult({ abi: aggregatorV3Abi, functionName: 'getRoundData', result: [receipt.usdgRoundId, receipt.usdgAnswer, updatedAt - 12n, updatedAt, receipt.usdgRoundId] }),
    );
  }
  const open = receipt.timestamp === 1_791_070_332n ? false : true;
  reply(
    CALENDAR,
    encodeFunctionData({ abi: sessionCalendarExtensionAbi, functionName: 'sessionState', args: [receipt.timestamp, SESSION_TYPES.indexOf('ALL_DAY')] }),
    encodeFunctionResult({
      abi: sessionCalendarExtensionAbi,
      functionName: 'sessionState',
      result: open
        ? [true, SESSION_REASONS.indexOf('OPEN'), sessionOpenedAt(receipt.timestamp, 'ALL_DAY')]
        : [false, SESSION_REASONS.indexOf('WEEKEND'), 0n],
    }),
  );
  return chain;
}

function multiplierUpdateLog(token: Address, oldMultiplier: bigint, newMultiplier: bigint, effectiveAt: bigint, blockNumber: bigint): RawLog {
  return {
    address: token,
    topics: [encodeEventTopics({ abi: stockTokenEventsAbi, eventName: 'UIMultiplierUpdated' })[0]],
    data: encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256'), [oldMultiplier, newMultiplier, effectiveAt]),
    blockNumber,
    logIndex: 0,
    transactionHash: `0x${'0c'.repeat(32)}`,
  };
}

describe('gathering a receipt', () => {
  it('reads what a filled split needs and the check matches it', async () => {
    // #given a chain that holds a filled split
    const { receipt, evidence: fixture } = filledSplit();
    const chain = chainFor(receipt, fixture.transaction.logs);

    // #when the verifier gathers and checks it
    const gathered = await gatherEvidence(receipt.id, chain);

    // #then the evidence matches the fixture and every row matches
    if (!gathered.found) throw new Error('not found');
    const { evidence } = gathered;
    expect(evidence.storedHash).toBe(fixture.storedHash);
    expect(evidence.rule).toEqual(RULE);
    expect(evidence.ticker).toEqual(fixture.ticker);
    expect(evidence.history?.multiplier.lastBefore).toBe('NOT_READ');
    expect(evidence.account?.inbound).toHaveLength(1);
    const result = checkEvidence(evidence);
    expect([...result.fields, ...result.checks].filter((row) => row.status === 'MISMATCH').map((row) => row.id)).toEqual([]);
  });

  it('batches the state reads into a few multicalls', async () => {
    // #given
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    // #when
    await gatherEvidence(receipt.id, chain);
    // #then module, ticker and market reads are three batches, plus none for the registry the token reports
    expect(chain.callBatches).toHaveLength(3);
  });

  it('answers NOT_FOUND for an id the module has not reached', async () => {
    // #given a module whose next id is the receipt's
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs, { nextReceiptId: receipt.id });
    // #when
    const gathered = await gatherEvidence(receipt.id, chain);
    // #then
    expect(gathered.found).toBe(false);
    expect(chain.getLogsCalls).toHaveLength(0);
  });

  it('throws ReceiptLogMissingError when the receipt exists but its log is not in the scanned blocks', async () => {
    // #given
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    // #when the scan starts after the receipt's block
    const gathering = gatherEvidence(receipt.id, chain, { fromBlock: BLOCK + 1n });
    // #then
    await expect(gathering).rejects.toBeInstanceOf(ReceiptLogMissingError);
  });

  it('refuses a chain other than 4663', async () => {
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    chain.chain = 1;
    await expect(gatherEvidence(receipt.id, chain)).rejects.toBeInstanceOf(ChainMismatchError);
  });

  it('names a module read that failed', async () => {
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    chain.revert(MODULE, encodeFunctionData({ abi: sleeveModuleAbi, functionName: 'guardParams' }));
    await expect(gatherEvidence(receipt.id, chain)).rejects.toBeInstanceOf(ReadFailedError);
  });
});

describe('log scans', () => {
  it('scans in the widths the provider allows and learns them', async () => {
    // #given a provider that takes a million blocks a query, and a scan of two and a half million
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    chain.limits = { single: 1_000_000n, multi: 100_000n };
    // #when
    const gathered = await gatherEvidence(receipt.id, chain, { fromBlock: BLOCK - 2_500_000n });
    // #then it was refused once, learned the width from the refusal, and never asked past it again
    expect(gathered.found).toBe(true);
    expect(chain.getLogsCalls.filter((call) => call.refused)).toHaveLength(1);
    const accepted = chain.getLogsCalls.filter((call) => !call.refused);
    expect(accepted.every((call) => call.to - call.from + 1n <= 1_000_000n)).toBe(true);
    if (!gathered.found) throw new Error('not found');
    expect(checkEvidence(gathered.evidence).verdict).toBe('MATCH');
  });

  it('reads the token history in one query with lists when the receipt is recent', async () => {
    // #given a receipt 1,000 blocks old
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs, { ahead: 1_000n });
    // #when
    await gatherEvidence(receipt.id, chain);
    // #then one query covered the token and the registry
    const history = chain.getLogsCalls.filter((call) => typeof call.filter.address !== 'string');
    expect(history).toHaveLength(1);
    expect(history[0]?.filter.address).toEqual([SPY.token, REGISTRY]);
  });

  it('reads the token history one topic at a time when the receipt is old', async () => {
    // #given a receipt 500,000 blocks old
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs, { ahead: 500_000n });
    // #when
    await gatherEvidence(receipt.id, chain);
    // #then seven single queries, five on the token and two on the registry
    const singles = chain.getLogsCalls.filter((call) => [SPY.token.toLowerCase(), REGISTRY.toLowerCase()].includes(String(call.filter.address).toLowerCase()));
    expect(singles).toHaveLength(7);
  });

  it('reads the last multiplier update before the receipt only when an update follows it', async () => {
    // #given an update after the receipt and one long before it
    const { receipt, evidence } = filledSplit();
    const before = multiplierUpdateLog(SPY.token, 10n ** 18n, MULTIPLIER, 1_789_690_233n, 65_779_981n);
    const after = multiplierUpdateLog(SPY.token, MULTIPLIER, MULTIPLIER + 1n, receipt.timestamp + 86_400n * 30n, BLOCK + 10n);
    const chain = chainFor(receipt, evidence.transaction.logs, { extraLogs: [before, after] });
    // #when
    const gathered = await gatherEvidence(receipt.id, chain);
    // #then
    if (!gathered.found) throw new Error('not found');
    const multiplier = gathered.evidence.history?.multiplier;
    expect(multiplier?.after).toHaveLength(1);
    expect(multiplier?.lastBefore).not.toBe('NOT_READ');
    expect(multiplier?.lastBefore === 'NOT_READ' ? null : multiplier?.lastBefore?.newMultiplier).toBe(MULTIPLIER);
    expect(checkEvidence(gathered.evidence).verdict).toBe('MATCH');
  });

  it('looks for a removal only when the ticker is inactive now', async () => {
    // #given an inactive ticker removed after the receipt
    const { receipt, evidence } = filledSplit();
    const removed: RawLog = {
      address: TOKEN_SOURCE,
      topics: [encodeEventTopics({ abi: tokenSourceAbi, eventName: 'TickerRemoved' })[0], pad(numberToHex(0), { size: 32 }), pad(SPY.token, { size: 32 })],
      data: '0x',
      blockNumber: BLOCK + 50n,
      logIndex: 0,
      transactionHash: `0x${'0d'.repeat(32)}`,
    };
    const chain = chainFor(receipt, evidence.transaction.logs, { tickerActive: false, extraLogs: [removed] });
    // #when
    const gathered = await gatherEvidence(receipt.id, chain);
    // #then
    if (!gathered.found) throw new Error('not found');
    expect(gathered.evidence.tickerRemovedAfter).toBe(true);
    expect(checkEvidence(gathered.evidence).verdict).toBe('MATCH');
  });

  it('counts the calendar writes after the receipt only when there are any', async () => {
    // #given a write after the receipt
    const { receipt, evidence } = filledSplit();
    const write: RawLog = {
      address: CALENDAR,
      topics: [encodeEventTopics({ abi: sessionCalendarExtensionAbi, eventName: 'EarlyCloseAdded' })[0], pad(numberToHex(21_000), { size: 32 })],
      data: pad(numberToHex(65_537), { size: 32 }),
      blockNumber: BLOCK + 20n,
      logIndex: 0,
      transactionHash: `0x${'0e'.repeat(32)}`,
    };
    const chain = chainFor(receipt, evidence.transaction.logs, { writeCount: 1, extraLogs: [write] });
    // #when
    const gathered = await gatherEvidence(receipt.id, chain);
    // #then the version at the receipt is the version now less that write
    if (!gathered.found) throw new Error('not found');
    expect(gathered.evidence.calendar.writesAfter).toBe(1);
    expect(checkEvidence(gathered.evidence).fields.find((row) => row.field === 'calendarVersion')?.status).toBe('MATCH');
  });
});

describe('what each kind reads', () => {
  it('reads the account history for a split that queued, and no token uid', async () => {
    const { receipt, evidence } = queuedSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    const gathered = await gatherEvidence(receipt.id, chain);
    if (!gathered.found) throw new Error('not found');
    expect(gathered.evidence.account?.installs).toHaveLength(1);
    expect(gathered.evidence.tokenUid).toBeNull();
    expect(checkEvidence(gathered.evidence).verdict).toBe('MATCH');
  });

  it('reads no rule, market or account history for a release', async () => {
    const base = queuedSplit().receipt;
    const receipt: Receipt = { ...base, id: 7n, trigger: 'OWNER', status: 'RELEASED', reason: 'SESSION', usdgIn: 0n, usdgToSpend: 100_000_000n, usdgToEquity: 0n, usdgQueued: 0n, queuedSince: base.timestamp - 60n };
    const chain = chainFor(receipt, [receiptLog(receipt, { logIndex: 0 })]);
    const gathered = await gatherEvidence(receipt.id, chain);
    if (!gathered.found) throw new Error('not found');
    expect(gathered.evidence.rule).toBeNull();
    expect(gathered.evidence.history).toBeNull();
    expect(gathered.evidence.account).toBeNull();
    expect(checkEvidence(gathered.evidence).verdict).toBe('MATCH');
  });
});

describe('verifyReceipt', () => {
  it('returns a MATCH result through a given reader', async () => {
    const { receipt, evidence } = filledSplit();
    const result = await verifyReceipt(receipt.id.toString(), { reader: chainFor(receipt, evidence.transaction.logs) });
    expect(result.verdict).toBe('MATCH');
    expect(result.rpcUrl).toBe('https://fake.rpc.test');
  });

  it('returns NOT_FOUND with no rows', async () => {
    const { receipt, evidence } = filledSplit();
    const result = await verifyReceipt(99n, { reader: chainFor(receipt, evidence.transaction.logs) });
    expect(result.verdict).toBe('NOT_FOUND');
    expect(result.fields).toEqual([]);
    expect(result.mismatches).toBe(0);
  });

  it('checks the disclosure against text a caller passes', async () => {
    const { receipt, evidence } = filledSplit();
    const result = await verifyReceipt(receipt.id, { reader: chainFor(receipt, evidence.transaction.logs), disclosureText: 'not the issuer text' });
    expect(result.checks.find((row) => row.id === 'disclosure-text')?.status).toBe('MISMATCH');
  });

  it('rejects an id that is not a receipt id before reading anything', async () => {
    const { receipt, evidence } = filledSplit();
    const chain = chainFor(receipt, evidence.transaction.logs);
    await expect(verifyReceipt('0', { reader: chain })).rejects.toThrow(/not a receipt id/);
    expect(chain.callBatches).toHaveLength(0);
  });
});
