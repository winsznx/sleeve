import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { RULE_DEFAULTS } from '@sleeve/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DataLayerError } from '@/data/errors';

import { lintText } from '../../../../scripts/copy-lint.mjs';
import { robinhoodChain } from './chain';
import { walletList } from './config';
import { ConnectWalletButton } from './connect-wallet-button';
import { parseWalletConnectProjectId } from './env';
import { SLEEVE_WALLET_CSS } from './theme';
import { installSleeveModuleCall, SLEEVE_ACCOUNT_INDEX, sleeveInstallData } from './wallet-account';
import { WalletSignerError } from './wallet-checks';
import { walletProblem, walletProblemText } from './wallet-problems';
import { WalletProviders } from './wallet-providers';

/** cast calldata of installModule(2, 0x...dEaD, initData) with the fork tests' default rule (wallet-connect.md 14). */
const CAST_INSTALL_CALLDATA =
  '0x9517e29f0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000017400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000232800000000000000000000000000000000000000000000000000000000000003e800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000017d78400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

const WALLETCONNECT_WALLETS = new Set(['metaMask', 'rainbow', 'trust', 'walletConnect']);

describe('the wallet list', () => {
  it('without a project id holds no wallet that needs WalletConnect, and builds without throwing', () => {
    const ids = walletList(null).flatMap((group) => group.wallets.map((wallet) => wallet({ projectId: '', appName: 'Sleeve' }).id));
    expect(ids).toEqual(['rabby', 'coinbase']);
    expect(ids.some((id) => WALLETCONNECT_WALLETS.has(id))).toBe(false);
    expect(() => connectorsForWallets(walletList(null), { appName: 'Sleeve', projectId: '' })).not.toThrow();
  });
});

describe('parseWalletConnectProjectId', () => {
  it('reads an empty value as no id, and refuses one that is set but malformed', () => {
    expect(parseWalletConnectProjectId(undefined)).toBeNull();
    expect(parseWalletConnectProjectId('   ')).toBeNull();
    expect(parseWalletConnectProjectId(' 21fef48091f12692cad574a6f7753643 ')).toBe('21fef48091f12692cad574a6f7753643');
    expect(() => parseWalletConnectProjectId('YOUR_PROJECT_ID')).toThrow(/32 character hex/);
  });
});

describe('the module install call', () => {
  it('encodes the default rule exactly as cast does for the fork tests', () => {
    const rule = { ...RULE_DEFAULTS, spendBps: 9_000, equityBps: 1_000 };
    const call = installSleeveModuleCall(
      '0x00000000000000000000000000000000000000aa',
      '0x000000000000000000000000000000000000dEaD',
      sleeveInstallData('0x0000000000000000000000000000000000000000', rule),
    );
    expect(call.data).toBe(CAST_INSTALL_CALLDATA);
    expect(call.to).toBe('0x00000000000000000000000000000000000000aa');
  });

  it('keeps Sleeve wallet accounts on their own salt', () => {
    expect(`0x${SLEEVE_ACCOUNT_INDEX.toString(16)}`).toBe('0xa48a6d278da47a227527162cfbcf7e07c7c669c653780a0a8fe37f5597c65240');
  });
});

describe('the RainbowKit theme', () => {
  it('carries none of the stock blue, the forbidden green or the connection dot', () => {
    for (const color of ['30E000', '0E76FD', '00C805']) expect(SLEEVE_WALLET_CSS.toUpperCase()).not.toContain(color);
    expect(SLEEVE_WALLET_CSS).toContain('var(--color-brand)');
  });

  it('gives Robinhood Chain a neutral icon and only the official RPC', () => {
    expect(robinhoodChain.id).toBe(4663);
    expect(robinhoodChain.rpcUrls.default.http).toEqual(['https://rpc.mainnet.chain.robinhood.com']);
    expect(robinhoodChain.iconUrl.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(robinhoodChain.iconUrl)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('ConnectWalletButton', () => {
  it('renders only a placeholder on the server, whatever the wallet state', () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <WalletProviders>
          <ConnectWalletButton />
        </WalletProviders>
      </QueryClientProvider>,
    );
    expect(html).toContain('bg-skeleton');
    expect(html).not.toContain('Connect a wallet');
  });
});

describe('walletProblem', () => {
  it('names each wallet failure onboarding handles', () => {
    const rejected = Object.assign(new Error('User rejected the request.'), { name: 'UserRejectedRequestError' });
    const wrapped = Object.assign(new Error('Request failed'), { cause: rejected });
    expect(walletProblem(wrapped)).toEqual({ kind: 'REJECTED' });
    expect(walletProblem({ code: 4001, message: 'denied' })).toEqual({ kind: 'REJECTED' });
    expect(walletProblem(new WalletSignerError('CONTRACT_WALLET', '0x00000000000000000000000000000000000000aa'))).toEqual({
      kind: 'CONTRACT_WALLET',
      address: '0x00000000000000000000000000000000000000aa',
    });
    expect(walletProblem(new WalletSignerError('WRONG_OWNER', '0x00000000000000000000000000000000000000bb')).kind).toBe('WRONG_OWNER');
    expect(walletProblem(new DataLayerError({ code: 'SponsorshipUnavailable' }, 'no'))).toEqual({ kind: 'SPONSORSHIP' });
    expect(walletProblem(new Error('UserOperation reverted during simulation with reason: AA10 sender already constructed'))).toEqual({
      kind: 'ALREADY_DEPLOYED',
    });
    expect(walletProblem(Object.assign(new Error('mismatch'), { name: 'ConnectorChainMismatchError' }))).toEqual({ kind: 'CHAIN' });
    expect(walletProblem(new Error('something else'))).toEqual({ kind: 'UNKNOWN' });
  });

  it('says each one plainly, and asks for the right account by its short address', () => {
    const owner = '0x05a1C0FfEE00000000000000000000000000b92D';
    const selected = '0x00000000000000000000000000000000000000bb';
    expect(walletProblemText({ kind: 'WRONG_OWNER', selected }, owner)).toBe(
      'Your wallet has 0x0000…00bb selected. Switch to 0x05a1…b92D in your wallet to continue.',
    );
    const kinds = ['REJECTED', 'SPONSORSHIP', 'ALREADY_DEPLOYED', 'CHAIN', 'UNKNOWN'] as const;
    for (const kind of kinds) expect(lintText(walletProblemText({ kind }))).toEqual([]);
    expect(lintText(walletProblemText({ kind: 'CONTRACT_WALLET', address: owner }))).toEqual([]);
  });
});
