import { createZeroDevPaymasterClient, getUserOperationGasPrice } from '@zerodev/sdk';
import {
  createBundlerClient,
  entryPoint07Abi,
  getUserOperationHash,
  toPackedUserOperation,
  type BundlerClient,
  type UserOperation,
} from 'viem/account-abstraction';
import {
  decodeEventLog,
  encodeEventTopics,
  http,
  isAddressEqual,
  type Account,
  type Address,
  type Chain,
  type Hex,
  type Log,
  type PublicClient,
  type Transport,
  type WalletClient,
} from 'viem';

import { sleeveChain } from '@/lib/chain/chain';

import type { SleeveKernelAccount } from './accounts';
import { CONTRACTS } from './context';
import { causeChain } from './errors';

/**
 * How a signed UserOp reaches the EntryPoint. In the app: ZeroDev's bundler, with ZeroDev's paymaster when it sponsors
 * the op and the account's own ETH when it does not. In the fork test: the EntryPoint's handleOps from a funded key,
 * with no bundler at all. The data layer prepares, has the owner sign, sends and waits through one of these.
 */

export interface PreparedOp {
  /** Every field but the signature, which still holds the validator's stub. */
  userOp: UserOperation<'0.7'>;
  sponsored: boolean;
  /** Sum of the gas limits. */
  gas: bigint;
  /** gas times maxFeePerGas: the most the op can cost. */
  maxCostWei: bigint;
}

export interface OpOutcome {
  userOpHash: Hex;
  success: boolean;
  /** What the account's execution reverted with, when it failed. */
  revertData: Hex | null;
  txHash: Hex;
  blockNumber: bigint;
  logs: Log[];
}

export interface PrepareRequest {
  callData: Hex;
  /** A fixed call gas limit, never the estimate (uninstall). */
  callGasLimit: bigint | null;
}

export interface UserOpRoute {
  readonly name: 'zerodev' | 'handle-ops';
  prepare(account: SleeveKernelAccount, request: PrepareRequest): Promise<PreparedOp>;
  send(userOp: UserOperation<'0.7'>): Promise<Hex>;
  wait(userOpHash: Hex): Promise<OpOutcome>;
}

/** The paymaster would not sponsor this op. The owner pays from the account's ETH, or the op does not go. */
export class SponsorshipRefusedError extends Error {
  constructor(cause: unknown) {
    super('The paymaster did not sponsor this UserOp', { cause });
    this.name = 'SponsorshipRefusedError';
  }
}

export function isSponsorshipRefusal(error: unknown): boolean {
  return causeChain(error).some((link) => link instanceof SponsorshipRefusedError);
}

/**
 * Whether a sponsored op kept the fixed call gas limit its request asked for (an uninstall's, SPEC 6). ZeroDev's
 * paymaster answers with gas limits of its own, which viem puts over the request's, and signs over them, so a limit
 * it lowered cannot be put back afterwards. Such an op goes owner-paid instead.
 */
export function keepsCallGasLimit(request: PrepareRequest, userOp: Pick<UserOperation<'0.7'>, 'callGasLimit'>): boolean {
  return request.callGasLimit === null || userOp.callGasLimit >= request.callGasLimit;
}

function costOf(userOp: UserOperation<'0.7'>): { gas: bigint; maxCostWei: bigint } {
  const gas =
    userOp.callGasLimit +
    userOp.verificationGasLimit +
    userOp.preVerificationGas +
    (userOp.paymasterVerificationGasLimit ?? 0n) +
    (userOp.paymasterPostOpGasLimit ?? 0n);
  return { gas, maxCostWei: gas * userOp.maxFeePerGas };
}

const USER_OPERATION_EVENT = encodeEventTopics({ abi: entryPoint07Abi, eventName: 'UserOperationEvent' })[0];
const USER_OPERATION_REVERT_REASON = encodeEventTopics({ abi: entryPoint07Abi, eventName: 'UserOperationRevertReason' })[0];

/** The EntryPoint's own account of one UserOp in a transaction's logs. */
export function outcomeFromLogs(userOpHash: Hex, txHash: Hex, blockNumber: bigint, logs: Log[]): OpOutcome {
  let success: boolean | null = null;
  let revertData: Hex | null = null;
  for (const log of logs) {
    if (!isAddressEqual(log.address, CONTRACTS.entryPoint) || log.topics[1] !== userOpHash) continue;
    if (log.topics[0] === USER_OPERATION_EVENT) {
      success = decodeEventLog({ abi: entryPoint07Abi, eventName: 'UserOperationEvent', data: log.data, topics: log.topics }).args.success;
    } else if (log.topics[0] === USER_OPERATION_REVERT_REASON) {
      revertData = decodeEventLog({ abi: entryPoint07Abi, eventName: 'UserOperationRevertReason', data: log.data, topics: log.topics })
        .args.revertReason;
    }
  }
  if (success === null) throw new Error(`Transaction ${txHash} carries no UserOperationEvent for ${userOpHash}`);
  return { userOpHash, success, revertData, txHash, blockNumber, logs };
}

/** ZeroDev's bundler and paymaster at https://rpc.zerodev.app/api/v3/<project id>/chain/4663. */
export function zeroDevRoute(client: PublicClient, rpcUrl: string): UserOpRoute {
  const transport = http(rpcUrl);
  const paymaster = createZeroDevPaymasterClient({ chain: sleeveChain, transport });
  const estimateFeesPerGas = ({ bundlerClient }: { bundlerClient: unknown }) =>
    getUserOperationGasPrice(bundlerClient as Parameters<typeof getUserOperationGasPrice>[0]);
  const sponsoredClient: BundlerClient = createBundlerClient({
    chain: sleeveChain,
    client,
    transport,
    paymaster: {
      async getPaymasterData(userOperation) {
        try {
          return await paymaster.sponsorUserOperation({ userOperation });
        } catch (error) {
          throw new SponsorshipRefusedError(error);
        }
      },
    },
    userOperation: { estimateFeesPerGas },
  });
  const ownerPaidClient: BundlerClient = createBundlerClient({ chain: sleeveChain, client, transport, userOperation: { estimateFeesPerGas } });

  async function prepareWith(bundler: BundlerClient, account: SleeveKernelAccount, request: PrepareRequest) {
    const prepared = await bundler.prepareUserOperation({
      account,
      callData: request.callData,
      ...(request.callGasLimit === null ? {} : { callGasLimit: request.callGasLimit }),
    });
    return prepared as unknown as UserOperation<'0.7'>;
  }

  return {
    name: 'zerodev',
    async prepare(account, request) {
      try {
        const userOp = await prepareWith(sponsoredClient, account, request);
        if (keepsCallGasLimit(request, userOp)) return { userOp, sponsored: true, ...costOf(userOp) };
      } catch (error) {
        if (!isSponsorshipRefusal(error)) throw error;
      }
      // Without a paymaster nothing replaces a fixed call gas limit: viem estimates only the limits left unset.
      const userOp = await prepareWith(ownerPaidClient, account, request);
      return { userOp, sponsored: false, ...costOf(userOp) };
    },
    async send(userOp) {
      return ownerPaidClient.sendUserOperation({ ...userOp, entryPointAddress: CONTRACTS.entryPoint } as Parameters<
        BundlerClient['sendUserOperation']
      >[0]);
    },
    async wait(userOpHash) {
      const receipt = await ownerPaidClient.waitForUserOperationReceipt({ hash: userOpHash, timeout: 180_000 });
      const outcome = outcomeFromLogs(userOpHash, receipt.receipt.transactionHash, receipt.receipt.blockNumber, receipt.receipt.logs);
      return { ...outcome, success: receipt.success };
    },
  };
}

export interface HandleOpsRouteOptions {
  /** A funded key that sends handleOps and takes the refund, as a bundler would. */
  wallet: WalletClient<Transport, Chain, Account>;
  /** Fixed limits: no bundler estimates them. */
  verificationGasLimit?: bigint;
  callGasLimit?: bigint;
  preVerificationGas?: bigint;
}

/**
 * The EntryPoint's handleOps from a funded key, with no bundler and no paymaster: the account pays its own prefund.
 * The fork test drives the data layer's owner-op path through this, exactly as the module's own fork tests do
 * (contracts/test/utils/KernelHelpers.sol).
 */
export function handleOpsRoute(client: PublicClient, options: HandleOpsRouteOptions): UserOpRoute {
  const sent = new Map<Hex, Hex>();
  return {
    name: 'handle-ops',
    async prepare(account, request) {
      const [nonce, deployed, block] = await Promise.all([
        account.getNonce(),
        account.isDeployed(),
        client.getBlock({ blockTag: 'latest' }),
      ]);
      const { factory, factoryData } = deployed ? { factory: undefined, factoryData: undefined } : await account.getFactoryArgs();
      const baseFee = block.baseFeePerGas ?? 0n;
      const userOp: UserOperation<'0.7'> = {
        sender: account.address,
        nonce,
        callData: request.callData,
        callGasLimit: request.callGasLimit ?? options.callGasLimit ?? 2_000_000n,
        verificationGasLimit: options.verificationGasLimit ?? 1_000_000n,
        preVerificationGas: options.preVerificationGas ?? 100_000n,
        maxFeePerGas: baseFee * 2n + 1n,
        maxPriorityFeePerGas: 0n,
        signature: '0x',
        ...(factory !== undefined && factoryData !== undefined ? { factory, factoryData } : {}),
      };
      userOp.signature = await account.getStubSignature(userOp);
      return { userOp, sponsored: false, ...costOf(userOp) };
    },
    async send(userOp) {
      const userOpHash = getUserOperationHash({
        userOperation: userOp,
        entryPointAddress: CONTRACTS.entryPoint,
        entryPointVersion: '0.7',
        chainId: client.chain?.id ?? sleeveChain.id,
      });
      const txHash = await options.wallet.writeContract({
        address: CONTRACTS.entryPoint as Address,
        abi: entryPoint07Abi,
        functionName: 'handleOps',
        args: [[toPackedUserOperation(userOp)], options.wallet.account.address],
        gas: 10_000_000n,
      });
      sent.set(userOpHash, txHash);
      return userOpHash;
    },
    async wait(userOpHash) {
      const txHash = sent.get(userOpHash);
      if (txHash === undefined) throw new Error(`UserOp ${userOpHash} was not sent through this route`);
      const receipt = await client.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') throw new Error(`handleOps transaction ${txHash} reverted`);
      return outcomeFromLogs(userOpHash, txHash, receipt.blockNumber, receipt.logs);
    },
  };
}
