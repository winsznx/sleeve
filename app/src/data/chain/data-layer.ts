import {
  LAUNCH_TICKERS,
  erc20Abi,
  validateRuleInput,
  type Address,
  type Rule,
  type RuleInput,
  type TickerId,
} from '@sleeve/core';
import { isAddressEqual, type Hex, type PublicClient } from 'viem';

import { missingKeyText, readChainConfig, type ChainConfig, type ChainEnvKey } from '@/lib/chain/config';
import type { BatchStep, UnbracketedStep } from '@/lib/chain/owner-ops';
import {
  decodePublicKey,
  discoverPasskey,
  encodePublicKey,
  registerPasskey,
  signWithPasskey,
  type RegisteredPasskey,
} from '@/lib/chain/webauthn';

import { checkEligibilityOnServer } from '../eligibility-client';
import { DataLayerError } from '../errors';
import type {
  AccountOverview,
  AccountSetupStep,
  ActionPreview,
  CardData,
  CreateAccountInput,
  CreateCardInput,
  EligibilityInput,
  EligibilityResult,
  OwnerAction,
  PasskeyCredential,
  PreviewBlock,
  ReceiptPage,
  ReceiptQuery,
  ReceiptRecord,
  RemoveResult,
  SellQuote,
  SellRequest,
  Session,
  SleeveDataLayer,
  VerifyResult,
  WalletSigner,
  WithdrawRequest,
  WithdrawResult,
} from '../types';
import { AccountReader } from './account-reads';
import {
  isInstalled,
  kernelAccountFor,
  readInstallState,
  readRecoverySigner,
  type InstallState,
  type KernelOwner,
  type SleeveKernelAccount,
} from './accounts';
import { cardDataOf, cardMessage, routeCardStore, type CardStore } from './cards';
import { CONTRACTS, createChainContext } from './context';
import { findModuleUninstallResult, findOwnerOpEnded, usdgTransferred } from './decode';
import { toDataLayerFailure } from './errors';
import { HistoryReader, receiptsInLogs } from './history';
import { routeIndexSource, type IndexSource } from './index-source';
import { MarketReader, quoterViewAbi, type ListedTicker } from './market';
import { runInstallOp, runOwnerOp, runUnbracketedOp, type OwnerOpRun } from './owner-op';
import { installedRule, previewOnChain, previewUnbracketed, withdrawBlock, withdrawSteps } from './preview';
import { planSell, sellRefusal } from './sell';
import {
  browserSessionStore,
  routeCredentialStore,
  type CredentialStore,
  type SessionStore,
  type StoredSession,
} from './session';
import { zeroDevRoute, type PreparedOp, type UserOpRoute } from './user-ops';
import { ChainVerifier } from './verify';

/**
 * SleeveDataLayer on Robinhood Chain (chain id 4663): reads from the live contracts and their logs, accounts through
 * ZeroDev Kernel v3.1, and every owner write as one bracketed UserOp (I14), or one without brackets for an account
 * whose module is not installed (D-040), with its result read back from chain state before it resolves (build
 * contract rule 4).
 */

/** The browser's WebAuthn ceremonies, replaceable in tests. */
export interface WebAuthnCeremonies {
  register(rpId: string): Promise<RegisteredPasskey>;
  discover(rpId: string): Promise<string>;
  sign(rpId: string, credentialId: string, challenge: Hex): Promise<Hex>;
}

export interface ChainDataLayerOptions {
  config?: ChainConfig;
  client?: PublicClient;
  /** How UserOps reach the EntryPoint. Defaults to ZeroDev when NEXT_PUBLIC_ZERODEV_RPC_URL is set. */
  route?: UserOpRoute;
  sessions?: SessionStore;
  credentials?: CredentialStore;
  webauthn?: WebAuthnCeremonies;
  cards?: CardStore;
  eligibility?: (input: EligibilityInput) => Promise<EligibilityResult>;
  verifier?: { verify(id: bigint, now: bigint): Promise<VerifyResult> };
  /** Where log reads start. Defaults to the deploy block; a fork test starts at its fork block. */
  logsFromBlock?: bigint;
  /**
   * The keeper's index, read first for receipts and the inbox. Defaults to Sleeve's route in the browser when
   * NEXT_PUBLIC_SUPABASE_URL and the anon key are set; null reads the chain only.
   */
  index?: IndexSource | null;
}

const DEFAULT_RECEIPT_PAGE = 20;
const MAX_RECEIPT_PAGE = 100;
/** A buy quote needs some amount; with nothing to buy it is read for the reference size. */
const QUOTE_FLOOR_USDG = 1_000_000n;

const browserWebAuthn: WebAuthnCeremonies = { register: registerPasskey, discover: discoverPasskey, sign: signWithPasskey };

function missing(key: ChainEnvKey): DataLayerError {
  return new DataLayerError({ code: 'MissingConfig', key }, missingKeyText(key));
}

export function createChainDataLayer(options: ChainDataLayerOptions = {}): SleeveDataLayer {
  const config = options.config ?? readChainConfig();
  const ctx = createChainContext(config, options.client, options.logsFromBlock);
  const { client } = ctx;
  const market = new MarketReader(ctx);
  const history = new HistoryReader(ctx);
  const accounts = new AccountReader(ctx, market, history);
  const sessions = options.sessions ?? browserSessionStore();
  const credentials = options.credentials ?? routeCredentialStore();
  const webauthn = options.webauthn ?? browserWebAuthn;
  const cards = options.cards ?? routeCardStore();
  const eligibility = options.eligibility ?? ((input: EligibilityInput) => checkEligibilityOnServer(input));
  const route: UserOpRoute | null = options.route ?? (config.zeroDevRpcUrl === null ? null : zeroDevRoute(client, config.zeroDevRpcUrl));
  const index: IndexSource | null =
    options.index !== undefined ? options.index : config.supabase !== null && typeof window !== 'undefined' ? routeIndexSource() : null;
  let verifier = options.verifier ?? null;

  /** Passkeys this tab made, with their public keys, until an account is created from one. */
  const registered = new Map<string, RegisteredPasskey>();
  /** Wallets that sign for accounts in this tab, by lower-cased owner address. */
  const wallets = new Map<string, WalletSigner>();
  const kernels = new Map<string, Promise<SleeveKernelAccount>>();

  /** Reads fail as the app's named errors, never as a raw RPC error. */
  async function read<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw toDataLayerFailure(error);
    }
  }

  function requireRoute(): UserOpRoute {
    if (route === null) throw missing('NEXT_PUBLIC_ZERODEV_RPC_URL');
    return route;
  }

  function requireRpId(): string {
    if (config.passkeyRpId === null) throw missing('NEXT_PUBLIC_PASSKEY_RP_ID');
    return config.passkeyRpId;
  }

  function toSession(stored: StoredSession): Session {
    const signer = stored.signer;
    return {
      account: stored.account,
      credentialId: signer.kind === 'passkey' ? signer.credentialId : '',
      wallet: signer.kind === 'wallet' ? { owner: signer.owner, attached: wallets.has(signer.owner.toLowerCase()) } : null,
      signedInAt: BigInt(stored.signedInAt),
    };
  }

  function currentSession(): StoredSession {
    const stored = sessions.read();
    if (stored === null) throw new DataLayerError({ code: 'NotSignedIn' }, 'Sign in first');
    return stored;
  }

  /**
   * A wallet owner that finds its signer when it signs, not when the Kernel account is built: an account built for a
   * preview before the wallet was attached signs once it is (D-041).
   */
  function walletOwner(address: Address): KernelOwner {
    return {
      kind: 'wallet',
      address,
      signHash: async (hash) => {
        const wallet = wallets.get(address.toLowerCase());
        if (wallet === undefined) {
          throw new DataLayerError({ code: 'NotSignedIn' }, 'Connect the wallet that owns this account again to sign');
        }
        return wallet.signHash(hash);
      },
    };
  }

  function ownerOf(stored: StoredSession): KernelOwner {
    const signer = stored.signer;
    if (signer.kind === 'passkey') {
      return {
        kind: 'passkey',
        credentialId: signer.credentialId,
        publicKey: decodePublicKey(signer.publicKey),
        sign: (challenge) => webauthn.sign(signer.rpId, signer.credentialId, challenge),
      };
    }
    return walletOwner(signer.owner);
  }

  function kernelFor(stored: StoredSession): Promise<SleeveKernelAccount> {
    const key = `${stored.account.toLowerCase()}:${stored.signer.kind}`;
    let kernel = kernels.get(key);
    if (kernel === undefined) {
      kernel = kernelAccountFor(client, ownerOf(stored), stored.account);
      kernel.catch(() => kernels.delete(key));
      kernels.set(key, kernel);
    }
    return kernel;
  }

  async function now(): Promise<bigint> {
    return (await market.head()).timestamp;
  }

  function headBlock(): Promise<bigint> {
    return client.getBlockNumber({ cacheTime: 1_000 });
  }

  async function startSession(account: Address, signer: StoredSession['signer']): Promise<Session> {
    const stored: StoredSession = { account, signer, signedInAt: (await now()).toString() };
    sessions.write(stored);
    return toSession(stored);
  }

  /** One owner write: the bracketed op, signed, sent, and its outcome read from the transaction. */
  async function ownerWrite(steps: BatchStep[], reopensAt: bigint | null = null): Promise<{ run: OwnerOpRun; account: Address }> {
    const stored = currentSession();
    const kernel = await read(() => kernelFor(stored));
    const run = await runOwnerOp(client, requireRoute(), kernel, steps, { revertContext: { reopensAt } });
    return { run, account: stored.account };
  }

  /** The receipts the op wrote for the account, with derived fields, ascending id. */
  async function writtenReceipts(run: OwnerOpRun, account: Address): Promise<ReceiptRecord[]> {
    const written = receiptsInLogs(run.outcome.logs, account);
    if (written.length === 0) return [];
    const accountHistory = await history.history(account);
    return history.records(written, accountHistory);
  }

  /** A buy quote for `amount` USDG on the ticker's first allowlisted pool: token units per 1e6 USDG units (D-009 Q21). */
  async function buyQuote(ticker: ListedTicker, amount: bigint): Promise<{ pool: Address; quote: bigint }> {
    const pool = ticker.pools[0];
    if (pool === undefined) throw new DataLayerError({ code: 'NotFound' }, `Ticker ${ticker.id} has no allowlisted pool`);
    const amountIn = amount > QUOTE_FLOOR_USDG ? amount : QUOTE_FLOOR_USDG;
    const [tokensOut] = await client.readContract({
      address: CONTRACTS.quoter,
      abi: quoterViewAbi,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: CONTRACTS.usdg, tokenOut: ticker.token, amountIn, fee: pool.fee, sqrtPriceLimitX96: 0n }],
    });
    if (tokensOut === 0n) {
      throw new DataLayerError({ code: 'SourceUnavailable' }, 'The pool quoted no tokens, so the buy has no minimum to hold it to');
    }
    return { pool: pool.address, quote: (tokensOut * 1_000_000n) / amountIn };
  }

  async function splitSteps(account: Address): Promise<BatchStep[]> {
    const preview = await accounts.previewSplit(account);
    const ticker = await market.ticker(preview.tickerId);
    const { pool, quote } = await buyQuote(ticker, preview.equityPart);
    return [{ kind: 'split', pool, quote }];
  }

  async function settleSteps(account: Address, tickerId: TickerId): Promise<BatchStep[]> {
    const [ticker, buckets] = await Promise.all([market.ticker(tickerId), accounts.buckets(account)]);
    const amount = buckets.find((bucket) => bucket.tickerId === tickerId)?.amount ?? 0n;
    const { pool, quote } = await buyQuote(ticker, amount);
    return [{ kind: 'settle', tickerId, pool, quote }];
  }

  /** A removal: every waiting bucket released in the batch, then the uninstall (D-040). */
  async function removeSteps(account: Address): Promise<BatchStep[]> {
    return [{ kind: 'remove', release: await accounts.waitingTickerIds(account) }];
  }

  function sellStep(quote: SellQuote): BatchStep {
    const { request } = quote;
    return {
      kind: 'sell',
      sell: {
        tickerId: request.tickerId,
        tokenAmount: request.amount,
        lotId: request.lotId,
        pool: quote.pool,
        quote: quote.quote,
        overrideClosed: request.overrideClosed,
        overrideCapBps: request.overrideCapBps,
      },
    };
  }

  async function reopensAtFor(tickerId: TickerId): Promise<bigint | null> {
    const snapshot = await market.snapshot();
    return snapshot.tickers.find((entry) => entry.tickerId === tickerId)?.session.nextOpenAt ?? null;
  }

  /** The op a send or the reinstall sends while the module is not installed (D-040), or what blocks it first. */
  function unbracketedStep(
    account: Address,
    state: InstallState,
    balance: bigint,
    action: Extract<OwnerAction, { kind: 'withdraw' | 'reinstall' }>,
  ): UnbracketedStep | PreviewBlock {
    if (!state.deployed) return { code: 'NotFound' };
    if (action.kind === 'reinstall') {
      const issues = validateRuleInput(action.rule, LAUNCH_TICKERS.map((ticker) => ticker.id));
      return issues.length > 0 ? { code: 'InvalidRule', issues } : { kind: 'install', rule: action.rule };
    }
    const { request } = action;
    const block = withdrawBlock(account, request);
    if (block !== null) return block;
    if (request.amount > balance) return { code: 'InsufficientBalance', balance, needed: request.amount };
    return { kind: 'send', to: request.to, amount: request.amount };
  }

  /** The version the account's next rule takes. Versions only go up, across uninstall and reinstall (D-019). */
  async function nextRuleVersion(account: Address, current: Rule): Promise<number> {
    const { rules } = await history.history(account);
    return Math.max(current.version, ...rules.keys()) + 1;
  }

  /** The account's USDG balance at the block before a transaction's and at its own, with that block's point. */
  async function balancesAround(account: Address, blockNumber: bigint) {
    const [balanceBefore, balanceAfter, block] = await Promise.all([
      client.readContract({ address: CONTRACTS.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber: blockNumber - 1n }),
      client.readContract({ address: CONTRACTS.usdg, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber }),
      client.getBlock({ blockNumber }),
    ]);
    return { balanceBefore, balanceAfter, at: { l2Block: block.number, timestamp: block.timestamp } };
  }

  /**
   * A send from an account whose module is not installed (D-040): one plain USDG transfer. No module measures it inside
   * the transaction, so it is read from the transaction's own USDG Transfer log from the account to the destination,
   * which must carry exactly the amount (build contract rule 4). A balance delta across the block would read short
   * whenever USDG lands in the same block, so the balances are kept for display only (D-041).
   */
  async function sendWithoutModule(stored: StoredSession, request: WithdrawRequest): Promise<WithdrawResult> {
    const kernel = await read(() => kernelFor(stored));
    const run = await runUnbracketedOp(client, requireRoute(), kernel, { kind: 'send', to: request.to, amount: request.amount });
    return read(async () => {
      if (usdgTransferred(run.outcome.logs, stored.account, request.to) !== request.amount) {
        throw new DataLayerError({ code: 'SourceUnavailable' }, 'The send did not read back as the amount leaving the account');
      }
      const { balanceBefore, balanceAfter, at } = await balancesAround(stored.account, run.outcome.blockNumber);
      return { request, txHash: run.outcome.txHash, at, balanceBefore, balanceAfter, from: null };
    });
  }

  function holdsRuleInput(rule: Rule, input: RuleInput): boolean {
    return (
      rule.status === 'ACTIVE' &&
      rule.equityBps === input.equityBps &&
      rule.tickerId === input.tickerId &&
      rule.premiumCapBps === input.premiumCapBps &&
      rule.slippageBps === input.slippageBps &&
      rule.minClip === input.minClip
    );
  }

  async function createPasskey(): Promise<PasskeyCredential> {
    const rpId = requireRpId();
    try {
      const passkey = await webauthn.register(rpId);
      registered.set(passkey.credentialId, passkey);
      return { credentialId: passkey.credentialId, rpId: passkey.rpId, ceremony: 'webauthn' };
    } catch (error) {
      throw toDataLayerFailure(error);
    }
  }

  async function passkeyFor(credentialId: string): Promise<RegisteredPasskey> {
    const made = registered.get(credentialId);
    if (made !== undefined) return made;
    const record = await credentials.find(credentialId);
    if (record === null) {
      throw new DataLayerError({ code: 'PasskeyUnavailable' }, 'Sleeve has no record of this passkey. Make a new one to continue.');
    }
    return { credentialId, rpId: record.rpId, publicKey: decodePublicKey(record.publicKey) };
  }

  async function createAccount(input: CreateAccountInput): Promise<Session> {
    const step = (name: AccountSetupStep) => input.onStep?.(name);
    const userOps = requireRoute();
    const signerInput = input.signer ?? { kind: 'passkey' as const, credentialId: (await createPasskey()).credentialId };
    if (input.rule !== null) {
      const issues = validateRuleInput(input.rule, LAUNCH_TICKERS.map((ticker) => ticker.id));
      if (issues.length > 0) throw new DataLayerError({ code: 'InvalidRule', issues }, `The rule was refused: ${issues.join(', ')}`);
    }
    if (signerInput.kind === 'wallet' && input.recoverySigner !== null) {
      // Onboarding never asks for this: a wallet owner is its own way back in, and the deployed ECDSA validator
      // refuses a second owner on one account (wallet-connect.md 9).
      throw new RangeError('a wallet-owned account takes no recovery wallet');
    }

    let owner: KernelOwner;
    let signer: StoredSession['signer'];
    if (signerInput.kind === 'passkey') {
      const passkey = await read(() => passkeyFor(signerInput.credentialId));
      owner = {
        kind: 'passkey',
        credentialId: passkey.credentialId,
        publicKey: passkey.publicKey,
        sign: (challenge) => webauthn.sign(passkey.rpId, passkey.credentialId, challenge),
      };
      signer = { kind: 'passkey', credentialId: passkey.credentialId, rpId: passkey.rpId, publicKey: encodePublicKey(passkey.publicKey) };
    } else {
      const wallet = signerInput.wallet;
      wallets.set(wallet.address.toLowerCase(), wallet);
      owner = walletOwner(wallet.address);
      signer = { kind: 'wallet', owner: wallet.address };
    }

    const kernel = await read(() => kernelAccountFor(client, owner));
    if (signer.kind === 'passkey') {
      await read(() =>
        credentials.save({
          credentialId: signer.credentialId,
          publicKey: signer.publicKey,
          rpId: signer.rpId,
          accountAddress: kernel.address,
        }),
      );
    }
    kernels.set(`${kernel.address.toLowerCase()}:${signer.kind}`, Promise.resolve(kernel));

    const before = await read(() => readInstallState(client, kernel.address));
    if (!(before.initialized && before.listed)) {
      await runInstallOp(client, userOps, kernel, input.rule, {
        onPrepared: () => step('approve'),
        onSent: () => step('deploy'),
      });
      step('install');
      const installed = await read(() => readInstallState(client, kernel.address));
      if (!installed.deployed || !installed.initialized || !installed.listed) {
        throw new DataLayerError({ code: 'NotInstalled' }, `The Sleeve module did not read back as installed on ${kernel.address}`);
      }
    }

    if (input.recoverySigner !== null) {
      const existing = await read(() => readRecoverySigner(client, kernel.address));
      if (existing === null || !isAddressEqual(existing, input.recoverySigner)) {
        step('recovery');
        await runOwnerOp(client, userOps, kernel, [{ kind: 'installRecovery', owner: input.recoverySigner }]);
        const added = await read(() => readRecoverySigner(client, kernel.address));
        if (added === null || !isAddressEqual(added, input.recoverySigner)) {
          throw new DataLayerError({ code: 'SourceUnavailable' }, 'The recovery wallet did not read back on the account');
        }
      }
    }

    step('check');
    const after = await read(() => readInstallState(client, kernel.address));
    if (!after.deployed || !after.initialized || !after.listed) {
      throw new DataLayerError({ code: 'NotInstalled' }, `The Sleeve module is not installed on ${kernel.address}`);
    }
    return startSession(kernel.address, signer);
  }

  async function signIn(): Promise<Session> {
    const rpId = requireRpId();
    const credentialId = await webauthn.discover(rpId).catch((error: unknown) => {
      throw toDataLayerFailure(error);
    });
    const record = await read(() => credentials.find(credentialId));
    if (record === null) {
      throw new DataLayerError({ code: 'NotFound' }, 'Sleeve has no account for this passkey on record');
    }
    const owner: KernelOwner = {
      kind: 'passkey',
      credentialId,
      publicKey: decodePublicKey(record.publicKey),
      sign: (challenge) => webauthn.sign(record.rpId, credentialId, challenge),
    };
    const derived = await read(() => kernelAccountFor(client, owner));
    if (!isAddressEqual(derived.address, record.accountAddress)) {
      throw new DataLayerError({ code: 'PasskeyUnavailable' }, 'The stored account does not belong to this passkey');
    }
    const state = await read(() => readInstallState(client, derived.address));
    // An account without the module signs in too, so an owner who removed Sleeve can still send or turn it on (D-040).
    if (!state.deployed) {
      throw new DataLayerError({ code: 'NotInstalled' }, 'This passkey has no Sleeve account on chain yet');
    }
    return startSession(derived.address, { kind: 'passkey', credentialId, rpId: record.rpId, publicKey: record.publicKey });
  }

  /**
   * The account a wallet owns, derived as createAccount derives it: the wallet as the ECDSA root on the Sleeve salt.
   * Nothing is signed. The session holds only public data and every owner op asks the wallet again (D-041).
   */
  async function signInWithWallet(wallet: WalletSigner): Promise<Session> {
    const kernel = await read(() => kernelAccountFor(client, walletOwner(wallet.address)));
    const state = await read(() => readInstallState(client, kernel.address));
    // An account without the module signs in too, as a passkey's does, so its owner can send or turn Sleeve on (D-040).
    if (!state.deployed) {
      throw new DataLayerError({ code: 'NotFound' }, `This wallet owns no Sleeve account: nothing is deployed at ${kernel.address}`);
    }
    wallets.set(wallet.address.toLowerCase(), wallet);
    kernels.set(`${kernel.address.toLowerCase()}:wallet`, Promise.resolve(kernel));
    return startSession(kernel.address, { kind: 'wallet', owner: wallet.address });
  }

  async function attachWallet(wallet: WalletSigner): Promise<Session> {
    const stored = currentSession();
    const signer = stored.signer;
    // Screens offer this only to a wallet session; a passkey account has no wallet to attach.
    if (signer.kind !== 'wallet') throw new RangeError('only a wallet session takes a wallet to sign with');
    if (!isAddressEqual(wallet.address, signer.owner)) {
      throw new DataLayerError(
        { code: 'WrongWallet', owner: signer.owner, connected: wallet.address },
        `This account belongs to ${signer.owner}, not ${wallet.address}`,
      );
    }
    wallets.set(signer.owner.toLowerCase(), wallet);
    return toSession(stored);
  }

  async function ruleAfter(account: Address, check: (rule: Rule) => boolean, what: string): Promise<Rule> {
    const rule = await read(() => accounts.rule(account));
    if (!check(rule)) throw new DataLayerError({ code: 'SourceUnavailable' }, `The ${what} did not read back from chain`);
    return rule;
  }

  async function previewAction(action: OwnerAction): Promise<ActionPreview> {
    const stored = currentSession();
    const account = stored.account;
    return read(async () => {
      const [snapshot, rule, ledger, state] = await Promise.all([
        market.snapshot(),
        accounts.rule(account),
        accounts.ledger(account),
        readInstallState(client, account),
      ]);
      const prepare = async (callData: Hex, callGasLimit: bigint | null): Promise<PreparedOp | PreviewBlock> => {
        if (route === null) return { code: 'MissingConfig', key: 'NEXT_PUBLIC_ZERODEV_RPC_URL' };
        try {
          const kernel = await kernelFor(stored);
          return await route.prepare(kernel, { callData, callGasLimit });
        } catch (error) {
          return toDataLayerFailure(error).detail;
        }
      };
      if (!isInstalled(state) && (action.kind === 'withdraw' || action.kind === 'reinstall')) {
        return previewUnbracketed({
          action,
          account,
          asOf: ledger.asOf,
          balance: ledger.balance,
          rule: action.kind === 'reinstall' ? { before: rule, after: installedRule(action.rule, await nextRuleVersion(account, rule)) } : null,
          step: unbracketedStep(account, state, ledger.balance, action),
          client,
          gasPrice: () => client.getGasPrice(),
          prepare,
        });
      }
      let sellPlan = null;
      let steps: BatchStep[] | PreviewBlock;
      switch (action.kind) {
        case 'withdraw':
          steps = withdrawSteps(account, action.request, ledger.balance);
          break;
        case 'sell': {
          sellPlan = await planSell(ctx, market, accounts, account, action.request);
          const refusal = sellRefusal(sellPlan.quote);
          steps = refusal === null ? [sellStep(sellPlan.quote)] : refusal.detail;
          break;
        }
        case 'release':
          steps = [{ kind: 'release', tickerId: action.tickerId }];
          break;
        case 'settle':
          steps = await settleSteps(account, action.tickerId);
          break;
        case 'split':
          steps = rule.status === 'ACTIVE' ? await splitSteps(account) : { code: 'RuleNotActive' };
          break;
        case 'setRule':
          steps = [{ kind: 'setRule', rule: action.input }];
          break;
        case 'pauseRule':
          steps = [{ kind: 'pauseRule' }];
          break;
        case 'resumeRule':
          steps = [{ kind: 'resumeRule' }];
          break;
        case 'remove':
          steps = await removeSteps(account);
          break;
        case 'reinstall':
          steps = { code: 'ModuleInstalled' };
          break;
      }
      return previewOnChain({
        action,
        account,
        asOf: ledger.asOf,
        market: snapshot,
        rule,
        unsorted: ledger.unsorted,
        steps,
        sellPlan,
        client,
        gasPrice: () => client.getGasPrice(),
        prepare,
      });
    });
  }

  const layer: SleeveDataLayer = {
    source: 'chain',

    getSession: async () => {
      const stored = sessions.read();
      return stored === null ? null : toSession(stored);
    },
    createPasskey,
    createAccount,
    signIn,
    signInWithWallet,
    attachWallet,
    signOut: async () => {
      sessions.write(null);
    },

    getAccount: (account: Address): Promise<AccountOverview> => read(() => accounts.overview(account)),
    getMarket: () => read(() => market.snapshot()),
    getLedger: (account: Address) => read(() => accounts.ledger(account)),
    getRule: (account: Address) => read(() => accounts.rule(account)),
    getBuckets: (account: Address) => read(() => accounts.buckets(account)),
    previewSplit: (account: Address) => read(() => accounts.previewSplit(account)),
    getHoldings: (account: Address) => read(() => accounts.holdings(account)),
    getInbox: (account: Address) =>
      read(async () => {
        const fromIndex = index === null ? null : await index.inbox(account, await headBlock());
        if (fromIndex !== null) return fromIndex;
        const ledger = await accounts.ledger(account);
        return history.inbox(account, ledger.observation);
      }),
    listReceipts: (query: ReceiptQuery): Promise<ReceiptPage> =>
      read(async () => {
        const limit = Math.min(Math.max(query.limit ?? DEFAULT_RECEIPT_PAGE, 1), MAX_RECEIPT_PAGE);
        if (query.cursor !== undefined && !/^\d+$/.test(query.cursor)) {
          throw new RangeError(`cursor must be a nextCursor from an earlier page, got ${query.cursor}`);
        }
        const before = query.cursor === undefined ? null : BigInt(query.cursor);
        if (index !== null) {
          const page = await index.receipts({ account: query.account, tickerId: query.tickerId, status: query.status, before, limit }, await headBlock());
          if (page !== null) return page;
        }
        const accountHistory = await history.history(query.account);
        const matching = accountHistory.receipts
          .filter(({ receipt }) => query.tickerId === undefined || receipt.tickerId === query.tickerId)
          .filter(({ receipt }) => query.status === undefined || receipt.status === query.status)
          .filter(({ receipt }) => before === null || receipt.id < before)
          .sort((a, b) => (a.receipt.id < b.receipt.id ? 1 : -1));
        const page = matching.slice(0, limit);
        const items = await history.records(page, accountHistory);
        const last = page[page.length - 1];
        return { items, nextCursor: matching.length > limit && last !== undefined ? last.receipt.id.toString() : null };
      }),
    getReceipt: (id: bigint) =>
      read(async () => {
        const fromIndex = index === null ? undefined : await index.receipt(id, await headBlock());
        if (fromIndex !== undefined) return fromIndex;
        const entry = await history.receiptLog(id);
        if (entry === null) return null;
        const accountHistory = await history.history(entry.receipt.account);
        const [record] = await history.records([entry], accountHistory);
        return record ?? null;
      }),
    getCard: (cardId: string): Promise<CardData | null> =>
      read(async () => {
        const stored = await cards.get(cardId);
        if (stored === null) return null;
        const [accountHistory, rule] = await Promise.all([history.history(stored.account), accounts.rule(stored.account)]);
        return cardDataOf(stored, accountHistory, rule.equityBps);
      }),
    verifyReceipt: (id: bigint) =>
      read(async () => {
        verifier ??= new ChainVerifier();
        return verifier.verify(id, await now());
      }),
    checkEligibility: (input: EligibilityInput) => eligibility(input),

    setRule: async (input: RuleInput) => {
      const issues = validateRuleInput(input, LAUNCH_TICKERS.map((ticker) => ticker.id));
      if (issues.length > 0) throw new DataLayerError({ code: 'InvalidRule', issues }, `The rule was refused: ${issues.join(', ')}`);
      const stored = currentSession();
      const before = await read(() => accounts.rule(stored.account));
      const { account } = await ownerWrite([{ kind: 'setRule', rule: input }]);
      return ruleAfter(account, (rule) => rule.version > before.version && holdsRuleInput(rule, input), 'new rule');
    },
    pauseRule: async () => {
      const { account } = await ownerWrite([{ kind: 'pauseRule' }]);
      return ruleAfter(account, (rule) => rule.status === 'PAUSED', 'paused rule');
    },
    resumeRule: async () => {
      const { account } = await ownerWrite([{ kind: 'resumeRule' }]);
      return ruleAfter(account, (rule) => rule.status === 'ACTIVE', 'resumed rule');
    },
    split: async () => {
      const stored = currentSession();
      const steps = await read(() => splitSteps(stored.account));
      const { run, account } = await ownerWrite(steps);
      return read(() => writtenReceipts(run, account));
    },
    settle: async (tickerId: TickerId) => {
      const stored = currentSession();
      const steps = await read(() => settleSteps(stored.account, tickerId));
      const { run, account } = await ownerWrite(steps, await read(() => reopensAtFor(tickerId)));
      const written = await read(() => writtenReceipts(run, account));
      const receipt = written.find((record) => record.receipt.status !== 'RECONCILED');
      if (receipt === undefined) throw new DataLayerError({ code: 'SourceUnavailable' }, 'The settle wrote no receipt');
      return receipt;
    },
    release: async (tickerId: TickerId) => {
      const { run, account } = await ownerWrite([{ kind: 'release', tickerId }]);
      const written = await read(() => writtenReceipts(run, account));
      const receipt = written.find((record) => record.receipt.status === 'RELEASED');
      if (receipt === undefined) throw new DataLayerError({ code: 'SourceUnavailable' }, 'The release wrote no RELEASED receipt');
      return receipt;
    },
    getSellQuote: (request: SellRequest) =>
      read(async () => (await planSell(ctx, market, accounts, currentSession().account, request)).quote),
    sell: async (request: SellRequest) => {
      const stored = currentSession();
      const plan = await read(() => planSell(ctx, market, accounts, stored.account, request));
      const refusal = sellRefusal(plan.quote);
      if (refusal !== null) throw refusal;
      const { run, account } = await ownerWrite([sellStep(plan.quote)], plan.market.session.nextOpenAt);
      const written = await read(() => writtenReceipts(run, account));
      if (!written.some((record) => record.receipt.status === 'PART_SOLD' || record.receipt.status === 'SOLD')) {
        throw new DataLayerError({ code: 'SourceUnavailable' }, 'The sell wrote no PART_SOLD or SOLD receipt');
      }
      return written;
    },
    createCard: async (input: CreateCardInput) => {
      const stored = currentSession();
      const kernel = await read(() => kernelFor(stored));
      const message = cardMessage(stored.account, input, await read(now));
      const signature = await kernel.signMessage({ message }).catch((error: unknown) => {
        throw toDataLayerFailure(error);
      });
      const cardId = await read(() =>
        cards.create({ account: stored.account, subject: input.subject, showAmounts: input.showAmounts, showProof: input.showProof, message, signature }),
      );
      const card = await layer.getCard(cardId);
      if (card === null) throw new DataLayerError({ code: 'NotFound' }, 'The card did not read back');
      return card;
    },
    withdraw: async (request: WithdrawRequest): Promise<WithdrawResult> => {
      const stored = currentSession();
      // As the mock does: the preview names these, so reaching here with one is a screen's mistake, not a chain answer.
      if (request.amount <= 0n) throw new RangeError('a send moves more than zero USDG');
      if (withdrawBlock(stored.account, request) !== null) throw new RangeError('a send goes to an address outside this account');
      // Read right before the send: beginOwnerOp reverts NotInstalled on an account without the module (D-040).
      if (!isInstalled(await read(() => readInstallState(client, stored.account)))) return sendWithoutModule(stored, request);
      const { run, account } = await ownerWrite([{ kind: 'withdraw', to: request.to, amount: request.amount }]);
      return read(async () => {
        // The module's own measure of what left, taken by balance inside the transaction (SPEC 7, rule 4).
        const ended = findOwnerOpEnded(run.outcome.logs, account);
        if (ended === null || ended.ownerDelta !== -request.amount) {
          throw new DataLayerError({ code: 'SourceUnavailable' }, 'The withdraw did not read back as the amount leaving the account');
        }
        const { balanceBefore, balanceAfter, at } = await balancesAround(account, run.outcome.blockNumber);
        return {
          request,
          txHash: run.outcome.txHash,
          at,
          balanceBefore,
          balanceAfter,
          from: {
            spend: ended.fromSpend,
            unsorted: ended.fromUnsorted,
            buckets: ended.fromBuckets.flatMap((amount, tickerId) => (amount > 0n ? [{ tickerId, amount }] : [])),
          },
        };
      });
    },
    removeSleeve: async (): Promise<RemoveResult> => {
      const { run, account } = await ownerWrite(await read(() => removeSteps(currentSession().account)));
      return read(async () => {
        // Kernel removes the executor first and goes on past a reverting onUninstall, so only this event says the
        // module released what waited (D-019). A batch without it, or with it false, is not a removal.
        const result = findModuleUninstallResult(run.outcome.logs, account, CONTRACTS.module);
        if (result !== true) {
          throw new DataLayerError(
            { code: 'UninstallFailed', result },
            result === false
              ? 'Kernel removed the Sleeve module, but the module did not release what waited'
              : 'The transaction carries no uninstall result for the Sleeve module',
          );
        }
        const [written, overview, block] = await Promise.all([
          writtenReceipts(run, account),
          accounts.overview(account),
          client.getBlock({ blockNumber: run.outcome.blockNumber }),
        ]);
        if (overview.moduleInstalled) {
          throw new DataLayerError({ code: 'SourceUnavailable' }, 'The account still reads back with the Sleeve module installed');
        }
        return {
          txHash: run.outcome.txHash,
          at: { l2Block: block.number, timestamp: block.timestamp },
          released: written.filter((record) => record.receipt.status === 'RELEASED'),
        };
      });
    },
    reinstallSleeve: async (rule: RuleInput): Promise<Rule> => {
      const issues = validateRuleInput(rule, LAUNCH_TICKERS.map((ticker) => ticker.id));
      if (issues.length > 0) throw new DataLayerError({ code: 'InvalidRule', issues }, `The rule was refused: ${issues.join(', ')}`);
      const stored = currentSession();
      const kernel = await read(() => kernelFor(stored));
      await runUnbracketedOp(client, requireRoute(), kernel, { kind: 'install', rule });
      const overview = await read(() => accounts.overview(stored.account));
      if (!overview.moduleInstalled) {
        throw new DataLayerError({ code: 'NotInstalled' }, `The Sleeve module did not read back as installed on ${stored.account}`);
      }
      return ruleAfter(stored.account, (after) => holdsRuleInput(after, rule), 'reinstalled rule');
    },
    previewAction,
  };
  return layer;
}

