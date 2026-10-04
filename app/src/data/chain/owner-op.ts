import type { RuleInput } from '@sleeve/core';
import { formatLog, zeroAddress, type Address, type Hex, type Log, type PublicClient, type RpcLog } from 'viem';

import { installSleeveModuleCall, sleeveInstallData } from '@/lib/chain/kernel';
import {
  UNINSTALL_CALL_GAS_FLOOR,
  assertBracketed,
  buildOwnerOp,
  buildUnbracketedOp,
  type BatchStep,
  type UnbracketedStep,
} from '@/lib/chain/owner-ops';

import { DataLayerError } from '../errors';
import { isInstalled, readInstallState, type SleeveKernelAccount } from './accounts';
import { CONTRACTS } from './context';
import { causeChain, decodeRevert, revertToDataLayerError, toDataLayerFailure, type RevertContext } from './errors';
import type { OpOutcome, PreparedOp, UserOpRoute } from './user-ops';

/**
 * One owner UserOp from the builder to a result read back from chain (PRD I14, build contract rule 4): the batch is
 * built bracketed and checked, simulated so a revert is named before the owner is asked to sign, prepared through the
 * route (sponsored when the paymaster will), signed once, sent, and its EntryPoint outcome read from the transaction.
 * The caller then reads the postcondition (receipts, the rule, a balance) before it resolves.
 */

export interface SimulatedBatch {
  success: boolean;
  revertData: Hex | null;
  gasUsed: bigint;
  logs: Log[];
}

interface SimulatedCall {
  status: Hex;
  returnData: Hex;
  gasUsed: Hex;
  logs?: RpcLog[];
  error?: { data?: Hex };
}

/**
 * The batch run as the EntryPoint would run it, through eth_simulateV1 at the latest block, with every log it would
 * emit. Nothing is sent and nothing moves.
 */
export async function simulateBatch(client: PublicClient, account: Address, callData: Hex): Promise<SimulatedBatch> {
  const blocks = (await client.request({
    method: 'eth_simulateV1',
    params: [
      {
        blockStateCalls: [{ calls: [{ from: CONTRACTS.entryPoint, to: account, data: callData, gas: '0x1c9c380' }] }],
        validation: false,
        traceTransfers: false,
      },
      'latest',
    ],
  } as never)) as { calls: SimulatedCall[] }[];
  const call = blocks[0]?.calls[0];
  if (call === undefined) throw new DataLayerError({ code: 'SourceUnavailable' }, 'The simulation came back empty');
  const success = call.status === '0x1';
  return {
    success,
    revertData: success ? null : (call.error?.data ?? call.returnData),
    gasUsed: BigInt(call.gasUsed),
    logs: (call.logs ?? []).map((log) => formatLog(log)),
  };
}

/** The named error a reverted simulation or UserOp carries. */
export function failureOf(revertData: Hex | null, context: RevertContext, userOpHash: Hex | null): DataLayerError {
  const revert = revertData === null ? null : decodeRevert(revertData);
  if (revert !== null) return revertToDataLayerError(revert, context);
  return new DataLayerError(
    { code: 'UserOpFailed', userOpHash, reason: revertData ?? 'no revert data' },
    'The action reverted without a reason Sleeve can name',
  );
}

export interface OwnerOpRun {
  prepared: PreparedOp;
  outcome: OpOutcome;
}

export interface RunOptions {
  revertContext?: RevertContext;
  /** Called once the op is prepared and before the owner is asked to sign. */
  onPrepared?: (prepared: PreparedOp) => void;
  /** Called once the signed op is sent, while it waits for a block. */
  onSent?: (userOpHash: Hex) => void;
}

async function ensureFunds(client: PublicClient, account: Address, prepared: PreparedOp): Promise<void> {
  if (prepared.sponsored) return;
  const balance = await client.getBalance({ address: account });
  if (balance < prepared.maxCostWei) {
    throw new DataLayerError(
      { code: 'SponsorshipUnavailable' },
      'Sleeve could not cover the network fee for this action, and the account holds too little ETH to pay it',
    );
  }
}

async function signSendWait(
  client: PublicClient,
  route: UserOpRoute,
  account: SleeveKernelAccount,
  prepared: PreparedOp,
  options: RunOptions,
): Promise<OpOutcome> {
  const context = options.revertContext ?? {};
  await ensureFunds(client, account.address, prepared);
  const signature = await account.signUserOperation(prepared.userOp);
  const userOpHash = await route.send({ ...prepared.userOp, signature });
  options.onSent?.(userOpHash);
  const outcome = await route.wait(userOpHash);
  if (!outcome.success) throw failureOf(outcome.revertData, context, userOpHash);
  return outcome;
}

/** A bracketed owner op: [beginOwnerOp, ...steps, endOwnerOp]. */
export async function runOwnerOp(
  client: PublicClient,
  route: UserOpRoute,
  account: SleeveKernelAccount,
  steps: readonly BatchStep[],
  options: RunOptions = {},
): Promise<OwnerOpRun> {
  const context = options.revertContext ?? {};
  try {
    const op = buildOwnerOp(account.address, steps);
    const simulated = await simulateBatch(client, account.address, op.callData);
    if (!simulated.success) throw failureOf(simulated.revertData, context, null);
    const prepared = await route.prepare(account, { callData: op.callData, callGasLimit: op.callGasLimit });
    assertBracketed(prepared.userOp.callData);
    if (op.callGasLimit !== null && prepared.userOp.callGasLimit < UNINSTALL_CALL_GAS_FLOOR) {
      throw new DataLayerError(
        { code: 'UserOpFailed', userOpHash: null, reason: `call gas limit ${prepared.userOp.callGasLimit} is under ${UNINSTALL_CALL_GAS_FLOOR}` },
        'The uninstall would run with too little gas for the module to release what waits, so it was not sent',
      );
    }
    options.onPrepared?.(prepared);
    const outcome = await signSendWait(client, route, account, prepared, options);
    return { prepared, outcome };
  } catch (error) {
    throw toDataLayerFailure(error, context);
  }
}

/**
 * An op without brackets for an account whose module is not installed: a USDG send or the reinstall (D-040). The
 * install state is read right before the op is built, and an account the module is installed on is refused with
 * ModuleInstalled, so this path never stands in for a bracketed owner op (I14). Then as runOwnerOp: simulated,
 * prepared, checked unchanged, signed once, sent, and its outcome read from the transaction.
 */
export async function runUnbracketedOp(
  client: PublicClient,
  route: UserOpRoute,
  account: SleeveKernelAccount,
  step: UnbracketedStep,
  options: RunOptions = {},
): Promise<OwnerOpRun> {
  const context = options.revertContext ?? {};
  try {
    const state = await readInstallState(client, account.address);
    if (isInstalled(state)) {
      throw new DataLayerError({ code: 'ModuleInstalled' }, 'Sleeve is installed on this account, so it acts only through bracketed owner ops');
    }
    if (!state.deployed) throw new DataLayerError({ code: 'NotFound' }, `No account is deployed at ${account.address} yet`);
    const op = buildUnbracketedOp(account.address, step);
    const simulated = await simulateBatch(client, account.address, op.callData);
    if (!simulated.success) throw failureOf(simulated.revertData, context, null);
    const prepared = await route.prepare(account, { callData: op.callData, callGasLimit: null });
    if (prepared.userOp.callData !== op.callData) {
      throw new DataLayerError({ code: 'UserOpFailed', userOpHash: null, reason: 'callData changed' }, 'The op changed before signing');
    }
    options.onPrepared?.(prepared);
    const outcome = await signSendWait(client, route, account, prepared, options);
    return { prepared, outcome };
  } catch (error) {
    throw toDataLayerFailure(error, context);
  }
}

/** The bundler's answer when the address got code between prepare and send (wallet-connect.md section 8). */
function alreadyDeployed(error: unknown): boolean {
  return causeChain(error).some((link) => link instanceof Error && /\bAA10\b/.test(link.message));
}

/**
 * The first UserOp (D-019): deploys the account while it has no code and installs the module in the execution phase,
 * with the rule in its install data. The one owner op without brackets: beginOwnerOp needs the module installed.
 */
export async function runInstallOp(
  client: PublicClient,
  route: UserOpRoute,
  account: SleeveKernelAccount,
  rule: RuleInput | null,
  options: RunOptions = {},
): Promise<OwnerOpRun> {
  const install = installSleeveModuleCall(account.address, CONTRACTS.module, sleeveInstallData(zeroAddress, rule));
  const attempt = async (): Promise<OwnerOpRun> => {
    const prepared = await route.prepare(account, { callData: install.data, callGasLimit: null });
    if (prepared.userOp.callData !== install.data) {
      throw new DataLayerError({ code: 'UserOpFailed', userOpHash: null, reason: 'callData changed' }, 'The install op changed before signing');
    }
    options.onPrepared?.(prepared);
    const outcome = await signSendWait(client, route, account, prepared, options);
    return { prepared, outcome };
  };
  try {
    try {
      return await attempt();
    } catch (error) {
      // Someone deployed the address first. The account now has code, so the same op goes again without initCode.
      if (!alreadyDeployed(error)) throw error;
      return await attempt();
    }
  } catch (error) {
    throw toDataLayerFailure(error);
  }
}
