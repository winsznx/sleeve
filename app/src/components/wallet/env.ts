/**
 * The WalletConnect (Reown) project id from dashboard.reown.com, inlined by Next at build time. Null until the owner
 * creates the project: the app then offers only wallets that run in the browser and says why QR is off.
 * A value that is set but malformed fails the build instead of failing later at the relay.
 */
export function parseWalletConnectProjectId(value: string | undefined): string | null {
  const id = value?.trim() ?? '';
  if (id === '') return null;
  if (!/^[0-9a-f]{32}$/.test(id)) {
    throw new Error('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be the 32 character hex project id from dashboard.reown.com');
  }
  return id;
}

export const WALLETCONNECT_PROJECT_ID = parseWalletConnectProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID);
