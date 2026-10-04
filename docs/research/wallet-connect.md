# Wallet connect on Robinhood Chain (4663): RainbowKit, WalletConnect and ZeroDev

Research note for D-022 (RainbowKit with WalletConnect beside the passkey at onboarding). Written 3 October 2026, 12:00 to 14:15 UTC. It answers which versions to install, how the app behaves before the WalletConnect project id exists, how Robinhood Chain is defined, how the modal takes the v2 palette, and how a connected wallet becomes the owner of a Sleeve account or the recovery signer of a passkey account under D-019.

Nothing here touched the repo except this file. Everything ran in the session scratchpad (section 14): a scratch project with the exact versions below, `tsc` and the app's ESLint rules over the recipe, a Next 15.5.27 production build, Chromium runs against that build with a stand-in wallet, a pnpm 11.23.0 install with the repo's build policy, and read-only calls to the public Robinhood Chain RPC. No transaction or UserOp was sent and no account was created.

## 0. Short answers

1. Versions. `@rainbow-me/rainbowkit` 2.2.11 is the newest release (6 May 2026) and still requires `wagmi ^2.9.0`. wagmi 3.x (3.7.7 is latest) cannot be used with it: RainbowKit's wagmi v3 pull requests were closed unmerged and no RainbowKit 3.x is on npm. Install RainbowKit 2.2.11, wagmi 2.19.5 (the last 2.x), viem 2.57.2, `@zerodev/sdk` 5.5.10 and `@zerodev/ecdsa-validator` 5.4.9. The app's `@tanstack/react-query` 5.104.0 already fits.
2. A fresh install does not build. `@wagmi/connectors` 6.2.0 depends on `@base-org/account`, whose Node entry imports `@coinbase/cdp-sdk`, and cdp-sdk 1.53.0 and later import the `@x402/*` packages they only list as optional peers. `next build` fails with `Module not found: Can't resolve '@x402/evm'`. `serverExternalPackages: ['@base-org/account']` fixes it (verified). Two more aliases silence `pino-pretty` and `@react-native-async-storage/async-storage` warnings.
3. pnpm 11 refuses the install. With the repo's `allowBuilds`, `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: bufferutil@4.1.0, keccak@3.0.4, utf-8-validate@5.0.10`. Listing the three as `false` makes it pass. All three have JavaScript fallbacks and none reaches the browser bundle.
4. Without `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, RainbowKit throws `No projectId found` while building the config, on the server too, for MetaMask, Rainbow, Trust and WalletConnect. Rabby and Coinbase Wallet do not need it. The recipe switches to a two-wallet list, keeps every installed extension through EIP-6963 (MetaMask appears under "Installed"), and prints why phone wallets are off at the foot of the modal. Verified in Chromium: a stand-in MetaMask connected, added Robinhood Chain and switched to it with no project id.
5. viem exports Robinhood Chain as `robinhood` (since 2.55.0), not `robinhoodMainnet`. Its RPC list includes a third-party node, so the recipe overrides it with the official RPC. The wallet receives exactly `{ chainName: "Robinhood Chain", chainId: "0x1237", rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"], blockExplorerUrls: ["https://robinhoodchain.blockscout.com"], nativeCurrency: ETH, 18 }` and no icon. RainbowKit's own chain icon is the neutral NetworkGlyph.
6. Theme. Passing a theme makes RainbowKitProvider wrap the app in `<div data-rk>`, which breaks the shell's `flex-1`. The recipe passes `theme={null}` and writes the theme itself under `[data-rk]` with `cssStringFromTheme`, every value a Sleeve CSS variable. RainbowKit's `#30E000` connection dot (the `#00C805` family) and its blues are gone, and reduced motion is added because RainbowKit ignores it.
7. Wallet as owner. `signerToEcdsaValidator(publicClient, { signer: walletClient, entryPoint: getEntryPoint("0.7"), kernelVersion: KERNEL_V3_1 })` with wagmi's wallet client, then `createKernelAccount` without `initConfig` (D-019). Checked on chain 4663: the SDK address equals `KernelFactory.getAddress(initData, salt)`, the SDK sends the module install as the bare `installModule` calldata of the fork tests' path (b), byte for byte equal to `cast`'s encoding, and the wallet's signature recovers to the owner the way the ECDSA validator checks it. Only plain-key wallets can own an account: contract wallets, Coinbase's smart wallet and Base Account sign through ERC-1271.
8. Salt. Without `initConfig` the address commits only to the owner and the salt, so the SDK default salt 0 is the same account any other ZeroDev Kernel v3.1 app gives that wallet. The recipe uses a Sleeve salt. It is part of every address, so it is final before the first real user.
9. Wallet as recovery signer of a passkey account: the passkey signs a bracketed owner op that installs ZeroDev's ECDSA validator as a secondary validator for the wallet's address (zerodev-passkey.md 9.3), after the wallet proves it signs with its own key. The deployed validator refuses a second install on one account, so a wallet-owned account cannot add one.
10. Cost. In a Next 15.5.27 production build, first-load JS goes from 110 kB to 313 kB on a route with the providers, 345 kB with the ZeroDev account code. On mount, wagmi's reconnect loads every connector's SDK: 448 KB of JS transferred without a project id and 704 KB with one, against 120 KB for the plain route, and with a project id the page also calls `api.web3modal.org` and `pulse.walletconnect.org`. Mount the providers only on routes that use a wallet.

## 1. Versions

`npm view <pkg> version dist-tags peerDependencies time`, run 3 October 2026 12:05 to 12:40 UTC.

| Package | Install | Published | Why this one |
| --- | --- | --- | --- |
| @rainbow-me/rainbowkit | 2.2.11 | 2026-05-06 | Latest. Peers: `wagmi ^2.9.0`, `viem 2.x`, `@tanstack/react-query >=5.0.0`, `react >=18`, `react-dom >=18`. |
| wagmi | 2.19.5 | 2025-11-19 | Last 2.x. Depends on `@wagmi/core` 2.22.1 and `@wagmi/connectors` 6.2.0. wagmi 3.7.7 (2026-08-27) is outside RainbowKit's range. |
| viem | 2.57.2 | 2026-10-01 | Latest, the version zerodev-passkey.md tested. Exports `robinhood` (4663). |
| @tanstack/react-query | 5.104.0 (already in app/package.json) | 2026-09-26 | 5.104.1 exists (2026-10-02). No change needed. |
| @zerodev/sdk | 5.5.10 | 2026-04-01 | Latest. Peer `viem ^2.28.0`. |
| @zerodev/ecdsa-validator | 5.4.9 | 2025-05-06 | Latest. Peers `@zerodev/sdk ^5.4.13`, `viem ^2.28.0`. |

Pulled in by `@wagmi/connectors` 6.2.0 at exact versions: `@walletconnect/ethereum-provider` 2.21.1 (2025-06-03), `@metamask/sdk` 0.33.1, `@coinbase/wallet-sdk` 4.3.6 and 3.9.3 (as `cbw-sdk`), `@base-org/account` 2.4.0, `porto` 0.2.35, `@gemini-wallet/core`, the Safe SDKs. npm marks two of them deprecated: WalletConnect 2.21.1 ("Reliability and performance improvements", latest is 2.25.0) and MetaMask SDK 0.33.1 ("No longer maintained, superseded by MetaMask Connect"). wagmi 2.19.5 pins them, so they stay until RainbowKit supports wagmi 3.

RainbowKit and wagmi v3. Issue #2626 ("wagmi v3 support") was closed on 5 May 2026 with a comment from DanielSinclair that "RainbowKit v3 with Wagmi v3 support is out today", but the next day's publish was 2.2.11 with `wagmi ^2.9.0`, `main` still declares `^2.9.0`, PR #2591 (the wagmi v3 migration) was closed unmerged on 7 July 2026, and npm has no 3.x. Sources: https://github.com/rainbow-me/rainbowkit/issues/2626, https://github.com/rainbow-me/rainbowkit/pull/2591, `npm view @rainbow-me/rainbowkit versions`.

The same line (`@rainbow-me/rainbowkit ^2.2.11`, `wagmi ^2.19.5`, Next 15, React 19) is a common production stack. Two choices below matter most: reading the wagmi cookie on the client, and a project id flag that tells the user why QR is off.

## 2. Install and build changes

From /Users/mac/sleeve, exact versions as the rest of app/package.json:

```bash
pnpm --filter @sleeve/app add -E @rainbow-me/rainbowkit@2.2.11 wagmi@2.19.5 viem@2.57.2 @zerodev/sdk@5.5.10 @zerodev/ecdsa-validator@5.4.9
```

pnpm-workspace.yaml, `allowBuilds`. Without these three lines pnpm 11.23.0 exits 1 (tested in a scratch workspace with the repo's policy):

```yaml
allowBuilds:
  esbuild: true
  unrs-resolver: false
  # Optional native speedups. ws and keccak fall back to JavaScript, and none of them reaches the browser bundle.
  bufferutil: false
  keccak: false
  utf-8-validate: false
```

`bufferutil` and `utf-8-validate` come from `ws` (viem, MetaMask SDK, WalletConnect), `keccak` from `cbw-sdk` (`@coinbase/wallet-sdk` 3.9.3). Listing the three as `true` would also work. `false` keeps this repo's rule that install scripts stay off unless listed. `pnpm peers check` then reports one harmless mismatch: `use-sync-external-store@1.2.0` (through `valtio` 1.13.2 in `@reown/appkit` 1.7.8) wants React 18 or older. React 19 has the hook built in, and the shim defers to it.

app/next.config.ts, added to the existing object:

```ts
  // @base-org/account's Node entry imports @coinbase/cdp-sdk, which from 1.53.0 imports the optional @x402 peers.
  // Only wagmi's Base connector loads it, in the browser, so the server bundle never needs it.
  serverExternalPackages: ['@base-org/account'],
  webpack(config) {
    // WalletConnect's logger and MetaMask SDK reference optional modules that never run in the browser.
    config.resolve.alias = { ...config.resolve.alias, 'pino-pretty': false, '@react-native-async-storage/async-storage': false };
    return config;
  },
```

Evidence:

- Without `serverExternalPackages`, `next build` failed: `./node_modules/@coinbase/cdp-sdk/_esm/actions/x402/signX402Payment.js Module not found: Can't resolve '@x402/evm/upto/client'` and four more `@x402` paths, import trace `@base-org/account/dist/index.node.js` ← `@wagmi/connectors/dist/esm/baseAccount.js` ← `wagmi/dist/esm/exports/connectors.js` ← `@rainbow-me/rainbowkit/dist/index.js`. cdp-sdk 1.52.0 has no `@x402` import, 1.53.0 (2026-07-16) adds them, both npm and pnpm resolve 1.57.1 today. An app that depends on `@x402/evm` and `@x402/svm` itself builds without the setting. Only `index.node.js` imports cdp-sdk, the browser entry does not.
- With the config above the build compiled with no warnings and every route stayed static. Next documents `serverExternalPackages` as opting a package out of server bundling (https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages). RainbowKit's own Next example aliases `pino-pretty` the same way (https://github.com/rainbow-me/rainbowkit/blob/main/examples/with-next-app/next.config.js). An alternative to `serverExternalPackages` is a pnpm override pinning `@coinbase/cdp-sdk` to 1.52.0, which was not built here.
- `next dev` without `--turbopack` uses webpack, so the alias applies there too. Turbopack would need `turbopack.resolveAlias` instead.

Environment, both public and inlined at build time:

| Variable | Until set | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | The two-wallet list and the QR-off line (section 3) | RainbowKit's demo id is 32 lowercase hex characters, and the recipe checks that format. Public by design: the Reown allowlist is the protection. |
| `NEXT_PUBLIC_ROBINHOOD_RPC_URL` (proposed name) | Falls back to `PUBLIC_RPC_URL` from @sleeve/core | Browser read RPC for wagmi and the account code. Robinhood's docs call the public RPC rate-limited and not for production, and recommend Alchemy (`https://robinhood-mainnet.g.alchemy.com/v2/<key>`, https://docs.robinhood.com/chain/connecting). The chain data layer should read the same variable. |

## 3. The WalletConnect project id

Where it comes from. Reown's dashboard, https://dashboard.reown.com (the old cloud.walletconnect.com, and the console messages still say cloud.reown.com). Create a project for an app, copy its Project ID, then under Configuration, Domain, add the production origin. Reown's relay docs (https://docs.reown.com/cloud/relay, retrieved 3 October 2026):

- "Allowlist supports a list of origins in the format `[scheme://]<hostname[:port]`."
- "Using `localhost` (or `127.0.0.1`) is always permitted, and if empty all origins are allowed."
- "If scheme or port is specified, it must match exactly. Hostname must also match exactly, but wildcards can be used for individual labels."
- "Updates take 15 minutes to apply." Requests from other origins are denied.

Consequences for Sleeve:

- Local development works with the real id and no allowlist entry.
- Vercel previews (`<project>-git-<branch>-<team>.vercel.app`) fail unless allowlisted. A wildcard covers whole labels only, so `*.vercel.app` would let every Vercel site use the id. Either give previews a second project id through Vercel's Preview environment, or accept that QR does not work there. Passkeys already do not work on preview hostnames (zerodev-passkey.md 6.1), so previews matter only for testing.
- Domain verification (Reown's Verify API) also needs `metadata.url` to match the page. RainbowKit fills it with `window.location.origin` when `appUrl` is not given (`computeWalletConnectMetaData` in dist/index.js), so the recipe leaves `appUrl` unset. Reown says Verify needs its AppKit or AppKit Core on the app side (https://docs.reown.com/appkit/domain-verification). RainbowKit uses `@walletconnect/ethereum-provider`, so whether wallets show "verified" for Sleeve is untested.
- `appIcon` must be an absolute https URL that a phone wallet can fetch. The app has no square icon yet, so the recipe leaves it out and wallets show a generic mark until one exists.

How the app behaves until the owner supplies the id. RainbowKit's `getWalletConnectConnector` throws when the id is empty (`dist/wallets/walletConnectors/chunk-ZRMFOB3B.js`):

```js
if (!projectId || projectId === "") {
  throw new Error("No projectId found. Every dApp must now provide a WalletConnect Cloud projectId to enable WalletConnect v2 https://www.rainbowkit.com/docs/installation#configure");
}
if (projectId === "YOUR_PROJECT_ID") { projectId = exampleProjectId; }   // "21fef48091f12692cad574a6f7753643"
```

Run in Node, where `window` is undefined as in Next's server render of a client component (tests/server-config.ts):

| `connectorsForWallets` with an empty id | Result |
| --- | --- |
| all six wallets | throws `No projectId found` |
| `metaMaskWallet`, `rainbowWallet`, `trustWallet`, `walletConnectWallet`, each alone | throws. Each falls back to WalletConnect when it is not injected, and on the server nothing is injected. |
| `rabbyWallet` alone, `coinbaseWallet` alone | builds |
| all six with a 32-hex id | builds, 7 connectors (WalletConnect adds a second one for the official modal) |

So the recipe builds the list from the id (section 6). Two things are deliberately not done:

- The `"YOUR_PROJECT_ID"` literal swaps in RainbowKit's public demo project. QR would then run on another party's project, its quota and its allowlist. That is a silent fallback (build contract rule 3), and the brief asks for the WalletConnect option to explain what is missing instead.
- A placeholder id. A connector with a made-up id fails at the relay. With `0123456789abcdef0123456789abcdef` the browser console showed `[Reown Config] Failed to fetch remote project configuration ... HTTP status code: 403` and `Origin http://127.0.0.1:4792 not found on Allowlist - update configuration on cloud.reown.com`, while an injected wallet still connected.

What the user sees without the id (Chromium, screenshots in section 14): the modal lists "Installed" (any EIP-6963 extension, for example MetaMask), then "Browser wallets: Rabby Wallet, Coinbase Wallet", then the line "Phone wallets by QR code are off until Sleeve has a WalletConnect project id. Wallets installed in this browser work now." With a phone user agent the sheet shows Coinbase only, because Rabby is desktop-only, plus the same line. Inside a wallet's own browser (MetaMask, Rainbow or Trust on a phone) the injected provider should still appear in the list through EIP-6963. That was not tested on a device.

## 4. Robinhood Chain in viem and in the wallet

viem 2.57.2, `chains/definitions/robinhood.ts`:

```ts
export const robinhood = /*#__PURE__*/ defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  blockTime: 100,
  rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com', 'https://rpc.ordofi.network'], webSocket: ['wss://rpc.ordofi.network'] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com', apiUrl: 'https://robinhoodchain.blockscout.com/api' } },
  contracts: { multicall3: { address: '0xca11bde05977b3631167028862be2a173976ca11' } },
})
```

- Added in viem 2.55.0 (PR #4818, July 2026), `blockTime` in 2.55.4, the OrdoFi RPC and websocket in 2.56.7 (viem CHANGELOG.md). `robinhoodMainnet`, the name in Robinhood's AA page, does not exist (zerodev-passkey.md section 10, item 3).
- Robinhood's own values match: network name "Robinhood Chain", chain id 4663, currency ETH, explorer robinhoodchain.blockscout.com, RPC https://rpc.mainnet.chain.robinhood.com/ (https://docs.robinhood.com/chain/add-network-to-wallet, https://docs.robinhood.com/chain/connecting).
- Live checks, public RPC, 3 October 2026 (L2 block about 79,108,133): `eth_chainId` returned `0x1237`, and Multicall3 at 0xcA11...CA11 has code, so wagmi's batched reads work.
- `blockTime: 100` makes viem poll every 500 ms for watched blocks and receipts (its interval is half the block time, at least 500 ms).

What a wallet receives. wagmi's injected connector adds a missing chain with `rpcUrls: [chain.rpcUrls.default.http[0]]`, `blockExplorerUrls` from `blockExplorers`, `chainName`, `nativeCurrency`, and `iconUrls` only when the app passes them (`@wagmi/core` 2.22.1 `src/connectors/injected.ts`, `switchChain`). Recorded from the stand-in wallet in Chromium:

```json
{"blockExplorerUrls":["https://robinhoodchain.blockscout.com"],"chainId":"0x1237","chainName":"Robinhood Chain","nativeCurrency":{"name":"Ether","symbol":"ETH","decimals":18},"rpcUrls":["https://rpc.mainnet.chain.robinhood.com"]}
```

The recipe overrides `rpcUrls` so the third-party node never reaches a wallet or wagmi's fallback, and sends no icon, so no wallet shows a Robinhood mark that came from Sleeve.

The chain icon. RainbowKit has no built-in metadata for 4663 (`chainMetadataById` in dist/index.js), so it uses `iconUrl` and `iconBackground` from the chain object. The recipe gives it Sleeve's `NetworkGlyph` (icon-system.md 6, regular paths, stroke ink-secondary `#5b6270`) as a data URI. RainbowKit only draws it in its chain modal, next to the words "Robinhood Chain". Everywhere Sleeve draws the network itself, the button in section 7 included, it renders the `NetworkGlyph` component and the words.

The wallet does not need to be on 4663 to sign a UserOp, because the owner signature is `personal_sign` over the UserOp hash, which already commits to chain 4663 and the EntryPoint. Sleeve still asks for 4663 for three reasons: RainbowKit's connect flow switches to `initialChain` (rejecting the switch fails the connect, `injected.ts` `connect`), wagmi's `useWalletClient({ chainId: 4663 })` throws `ConnectorChainMismatchError` while the wallet is elsewhere (`getConnectorClient.ts`), and typed-data signatures such as a USDG permit for the registered-wallet top-up of PRD 7.2 carry chain id 4663, which MetaMask checks against its active chain.

## 5. Providers in the Next 15 App Router

Where. Only in the layouts of routes that use a wallet: `app/src/app/(product)/onboard/layout.tsx` now, the recovery-wallet settings page and wallet-signed owner actions later. Not in `(product)/layout.tsx`. Reasons, all measured (section 11): first-load JS on a provider route is 203 kB larger, and on mount wagmi's `reconnect` calls `getProvider()` on every connector (`@wagmi/core` `src/actions/reconnect.ts`), which loads the Coinbase SDK, the MetaMask SDK and, with a project id, the WalletConnect provider, which posts an `INIT` event with a client id and user agent to `pulse.walletconnect.org` whatever `telemetryEnabled` says (`@walletconnect/core` 2.21.1 EventClient `init`). A passkey user on Home or Payments should pay none of that. When owner actions of wallet-owned accounts are built, mount the providers for those accounts only, and reconnect only the connector they used: `reconnectOnMount={false}` on `WagmiProvider`, then `reconnect(config, { connectors: [recent] })`.

Order. `DataLayerProvider` in the root layout already owns the `QueryClientProvider`. `WagmiProvider` and `RainbowKitProvider` nest inside it and share that QueryClient: wagmi's provider uses no query hooks, and RainbowKit's hooks only need a QueryClientProvider above them. The wagmi docs put `WagmiProvider` outside `QueryClientProvider`, and either order works for the same reason. The data layer's `retry: shouldRetry` then also governs wagmi queries, so a failed wallet read is not retried, which is acceptable.

`'use client'`. RainbowKit's `dist/index.js` and `dist/wallets/walletConnectors/index.js` both start with `"use client"`. A Server Component that calls `connectorsForWallets` or `getDefaultConfig` receives client references and throws. Build the config only inside client modules. This is also why the wagmi docs' pattern of calling `cookieToInitialState(getConfig(), (await headers()).get('cookie'))` in a server layout (https://wagmi.sh/react/guides/ssr) cannot take a RainbowKit config as written.

`ssr: true` and cookie storage. `ssr: true` delays wagmi's rehydration and reconnect to an effect after mount (`wagmi` `src/hydrate.ts`), so server HTML and the first client render agree. `createStorage({ storage: cookieStorage })` keeps the connection in a `wagmi.store` cookie (`path=/`, `samesite=Lax`, no expiry, `@wagmi/core` `src/utils/cookie.ts`). The recipe reads that cookie on the client: `useState(() => cookieToInitialState(config, typeof document === 'undefined' ? null : document.cookie))`. That avoids the cost of the usual pattern: calling `headers()` in a layout opts every route in the application into dynamic rendering. With this pattern the server renders no wallet state, so every wallet-dependent element waits for `mounted`. Tested: with a stored `wagmi.store` cookie the reload showed no hydration warning, and the page stayed static (`○` in the build output).

`getDefaultConfig` against `createConfig` with `connectorsForWallets`. `getDefaultConfig` is `connectorsForWallets` plus `createConfig` (dist/index.js, `getDefaultConfig`), with default transports `http()` per chain and a default list of Safe, Rainbow, Base, MetaMask and WalletConnect. The recipe calls the two functions directly: the wallet list depends on the project id, the transport is explicit (`http()` alone would use viem's list), `multiInjectedProviderDiscovery` is spelled out, and the default list's Safe and Base wallets cannot own a Kernel account (section 6).

Config per mount. `useState(() => createWalletConfig(rpcUrl))` makes one config per provider instance, as the wagmi docs do with `getConfig()`. A module-scope config on the server would be shared by every request.

## 6. Wallet list

| Wallet | RainbowKit factory | Without a project id | Connects through |
| --- | --- | --- | --- |
| MetaMask | `metaMaskWallet` | left out (throws on the server). An installed extension appears under "Installed" through EIP-6963. | EIP-6963 injected on desktop, MetaMask SDK on phones, WalletConnect on desktop without the extension |
| Rainbow | `rainbowWallet` | left out. The extension appears under "Installed". | injected, else WalletConnect |
| Coinbase Wallet | `coinbaseWallet` with `preference = 'eoaOnly'` | kept | Coinbase Wallet SDK 4.3.6, extension or Coinbase's own QR. Not WalletConnect. |
| WalletConnect | `walletConnectWallet` | left out | WalletConnect QR, plus the official WalletConnect modal from its "Open" link |
| Rabby | `rabbyWallet` | kept | injected only (`flag: 'isRabby'`). Desktop only. |
| Trust Wallet | `trustWallet` | left out. The extension appears under "Installed". | injected, else WalletConnect |

When an EIP-6963 wallet and a list entry share an rdns (`io.metamask`, `me.rainbow`, `io.rabby`, `com.trustwallet.app`), the desktop modal shows the EIP-6963 one under "Installed" and hides the list entry (`useWalletConnectors(mergeEIP6963WithRkConnectors)` in dist/index.js). Verified: with a project id and the stand-in MetaMask, the modal read "Installed: MetaMask. Wallets: Rainbow, Coinbase Wallet, WalletConnect, Rabby Wallet, Trust Wallet".

Wallets that can never own or recover a Sleeve account. ZeroDev's ECDSA validator (0x845A...cE57) accepts a signature only if `ECDSA.recover(userOpHash, sig)` or `ECDSA.recover(toEthSignedMessageHash(userOpHash), sig)` returns the stored owner (Kernel v3.1 `src/validator/ECDSAValidator.sol`, `validateUserOp`). There is no ERC-1271 path. So:

- `coinbaseWallet` defaults to `preference: 'all'`, which offers Coinbase's smart wallet (ERC-1271 and ERC-6492 signatures). The recipe sets `coinbaseWallet.preference = 'eoaOnly'`. RainbowKit 2.2.11 marks `coinbaseWallet` `@deprecated` in favor of `base` (Base Account), also a smart wallet, so `base` stays out.
- `safeWallet` and any contract wallet over WalletConnect are refused before the account is built: `assertNotContractWallet` reads the address's code and refuses anything other than empty or an EIP-7702 delegation (`0xef0100...`, still a plain key).
- Rabby, MetaMask, Rainbow and Trust sign with the account's own key, including MetaMask accounts upgraded through EIP-7702.

## 7. Theme and ConnectButton.Custom

Theme. `lightTheme()` sets `accentColor #0E76FD`, `connectionIndicator #30E000`, `standby #FFD641` and `error #FF494A` (dist chunk-72HZGUJA.js). `#30E000` is in the `#00C805` family the brand rules forbid. The recipe replaces all thirty color keys, the font, the radii and two shadows with Sleeve's variables:

- `accentColor: var(--color-brand)` with `var(--color-on-brand)`: black is action and selection (DESIGN.md line 33, "Neither green nor apricot is a button fill"). RainbowKit uses the accent for its primary buttons, the selected wallet and its links.
- `connectionIndicator: var(--color-success)` (green-600 `#007456`), `standby: var(--color-waiting)`, `error: var(--color-danger-text)`, `modalBackdrop: var(--color-scrim)`, `fonts.body: var(--font-sans)`, radii from `--radius-pill`, `--radius-card`, `--radius-sheet`, `--radius-control`.
- RainbowKit writes each value into a `--rk-*` property and only strips `: ; { } < / >` (`cssStringFromTheme` in dist/index.js), so `var(--color-brand)` survives. In Chromium the computed `--rk-colors-accentColor` on the open dialog was `#101114` and `--rk-fonts-body` was the Instrument Sans stack.

Why `theme={null}`. With a theme object, RainbowKitProvider renders `<div data-rk><style>…</style>{children}</div>` (dist/index.js, `RainbowKitProvider`). The root layout's body is `flex min-h-dvh flex-col` and the AppShell's root is `flex flex-1 flex-col`, so the extra div would stop the shell filling the height. With `theme={null}` it renders children directly, and its dialogs portal into `<body>` with their own `data-rk` attribute (`Dialog`, `createPortal(...{...themeRootProps}...)`). RainbowKit documents `theme={null}` with `cssStringFromTheme` under your own selector and calls that API unstable (https://rainbowkit.com/docs/custom-theme). Verified: body's children were `div, style, main#shell, script...`, and `main` filled the 800 px and 740 px viewports.

Accessibility. RainbowKit's dialog has `role="dialog"`, `aria-modal`, a focus trap, and Escape closes it (verified). Its CSS removes outlines only from inputs, so the app's global `:focus-visible` ring (green-600, globals.css) reaches its buttons. It has no `prefers-reduced-motion` rule for its 350 ms slide, fades and spinners, so the recipe's style block turns animations and transitions off under that query. On a phone user agent the wallet row scrolls sideways inside the sheet, and the page itself had no horizontal scroll at 360 px.

ConnectButton.Custom render props (dist/components/ConnectButton/ConnectButtonRenderer.d.ts): `account` (`address`, `displayName`, `displayBalance`, `ensName`, `hasPendingTransactions`), `chain` (`id`, `name`, `hasIcon`, `iconUrl`, `iconBackground`, `unsupported`), `mounted`, `openConnectModal`, `openChainModal`, `openAccountModal`, `connectModalOpen`, `chainModalOpen`, `accountModalOpen`. The recipe renders the app's `Button`: a skeleton before mount, "Connect a wallet" with `busy` while the modal is open, "Switch to Robinhood Chain" with the NetworkGlyph when `chain.unsupported`, and the short address otherwise. Verified in Chromium: "Connect a wallet", then `0x05…4b92` after connecting, then "Switch to Robinhood Chain" when the wallet moved to chain 1.

Network calls RainbowKit makes itself: none with this setup. ENS lookups need mainnet in `chains`, and its enhanced-provider call to `enhanced-provider.rainbow.me` runs only when `RAINBOW_PROVIDER_API_KEY` is set (dist/index.js, `useMainnetEnsName`). Leave both out. Do not turn on `coolMode`: 2.2.11 had to harden it against wallet icon URLs that injected HTML.

## 8. The wallet as owner of the Sleeve account (D-019 path)

What the SDK does (`@zerodev/ecdsa-validator` 5.4.9 `toECDSAValidatorPlugin.ts`, `@zerodev/sdk` 5.5.10 `utils/toSigner.ts`):

- `signerToEcdsaValidator(publicClient, { signer, entryPoint, kernelVersion })` accepts a viem `WalletClient` with an account, an EIP-1193 provider, or a local account. wagmi's `useWalletClient().data` is the first kind. It reads the chain id from `publicClient`, so the UserOp hash commits to 4663 whatever chain the wallet shows.
- Each UserOp is signed as `signMessage({ message: { raw: userOpHash } })`, which is `personal_sign` in the wallet: one prompt per owner op, showing a 32-byte hex string. Sponsorship estimates use a stub signature, so the prompt comes once, after the paymaster answers.
- ERC-1271 signatures of the Kernel account itself (v3.1, EntryPoint 0.7) go through `signTypedData` with the domain `{ name: "Kernel", version: "0.3.1", chainId: 4663, verifyingContract: account }` (`createKernelAccount.ts`, `signMessage`), which is `eth_signTypedData_v4`. That is the case where the wallet must be on 4663.

The account. `createKernelAccount(publicClient, { plugins: { sudo }, entryPoint: getEntryPoint("0.7"), kernelVersion: KERNEL_V3_1, index })` with no `initConfig`. The SDK defaults are `index = 0n` and `useMetaFactory = true` (`createKernelAccount.ts` lines 400 to 410). Its factory data is `FactoryStaker(0xd703...42d5).deployWithFactory(KernelFactory 0xaac5...E419, initialize(0x01‖0x845A...cE57, hook 0, owner, "", []), salt)`, the same `_initCode(owner, salt, [])` the fork tests send (contracts/test/utils/KernelHelpers.sol).

The salt. KernelFactory's address is `CREATE2(keccak256(abi.encodePacked(initData, salt)))` (zerodev-passkey.md 5.1). For a passkey the address is unique to Sleeve's rpID. For a wallet it is not: with salt 0, any other app on ZeroDev's defaults (Robinhood's AA page shows `KERNEL_V3_1`) gives the same wallet the same Kernel account, possibly deployed, funded, and carrying other modules. The recipe uses `SLEEVE_ACCOUNT_INDEX = BigInt(keccak256(stringToBytes('sleeve.wallet-account.v1')))`, salt 0xa48a6d278da47a227527162cfbcf7e07c7c669c653780a0a8fe37f5597c65240. It is part of every wallet-owned address, so it needs a DECISIONS.md entry and must not change after the first real user.

First UserOp (D-019). The account's call to itself `installModule(2, sleeveModule, initData)` where `initData = abi.encodePacked(address(0), abi.encode(abi.encode(keeper, RuleInput), bytes("")))` and the module data is 224 bytes, SleeveModule's `INSTALL_DATA_LENGTH`. For a single self-call the SDK's `encodeCalls` returns that calldata unwrapped (`createKernelAccount.ts`, `encodeCalls`), and while the account has no code viem adds the factory data. That is path (b) of contracts/test/fork/SleeveModuleInstall.t.sol: deployment in validation, `onInstall` after `BeforeExecution`, so ERC-7562 never sees its USDG read. It is the one owner op without brackets, as OwnerOps.sol says, because `beginOwnerOp` needs the module installed.

Checked against chain 4663 with throwaway keys (never funded), tests/account.ts, L2 blocks 79,123,050 to 79,138,285:

| Check | Result |
| --- | --- |
| SDK account address against `KernelFactory.getAddress(initData, salt)` by `eth_call` | equal, for salt 0 and for the Sleeve salt, on three random keys |
| SDK `initialize` data against the Solidity-side encoding of `_initData(owner, [])` | equal byte for byte (only hex case differs) |
| Factory in the initCode | the meta factory 0xd703...42d5 with `deployWithFactory(0xaac5...E419, ...)` |
| `encodeCalls([installSleeveModuleCall(...)])` | the bare `installModule` calldata, selector 0x9517e29f |
| Install calldata and 224-byte module data against `cast calldata` and `cast abi-encode` | identical |
| `signUserOperation` result, recovered with `recoverMessageAddress({ raw: userOpHash })` | the owner, 65 bytes |

The contract side of this path is already proven by the fork tests, which use the deployed ECDSA validator as root (KernelHelpers.sol: "standing in for the passkey validator"). For a wallet-owned account that validator is the real root, so `test_I5_fork_firstUserOpInstall_snapshotsUsdgPaidBeforeDeployment` and `test_fork_firstUserOpInstall_thatRevertsLeavesTheAccountWithoutTheModule` cover it directly.

After the op, success is the read-back, never the receipt: show the payment address only when `SleeveModule.isInitialized(account)` and `Kernel.isModuleInstalled(2, module, "0x")` are both true (D-019). A reverted install still deploys the account (the second fork test above), and the retry then goes without initCode. If someone deploys the address between prepare and send, the bundler answers `AA10 sender already constructed`. Resend, and viem drops the factory data because the account now has code.

What D-022 asks the app to say. A wallet root can act outside Sleeve in two ways: through any ERC-4337 client, and directly, because the ECDSA validator is also a hook module whose `preCheck` accepts its owner, so the owner EOA can call `execute` and `installModule` with no UserOp and no brackets (g6-notes.md finding 2, `test_recipe_rootOwnerCanCallAccountDirectly`). That is the WRAPPED limit of PRD 7.2, and it also means a wallet-owned account meets I11 without a separate recovery signer. Copy for the screen is in section 12.

Account switches inside the wallet. The Sleeve account is derived from the wallet address, so `useWalletOwnedAccount` keys its query by address and a switch derives a different account. Before every owner op, compare the wallet's address with the stored owner (`assertWalletIsOwner`). A signature from another address fails validation with AA24 after the user has already approved it.

D-019 and zerodev-passkey.md. That note's recipe (section 8) installs the module through `initConfig`. D-019 replaced that: build the passkey account without `initConfig` and send `installSleeveModuleCall` as its first UserOp, then read back with `isSleeveInstalled`. `deployAndInstall` and `isSleeveInstalled` below take any Kernel client, passkey or wallet. Without `initConfig` the passkey address commits to the passkey only, and the zerodev-passkey.md 8.1 onboarding steps change the same way.

## 9. The wallet as recovery signer of a passkey account

Tested in zerodev-passkey.md 9.3 on live 4663 state: ZeroDev's ECDSA validator installed as a secondary validator whose owner is the recovery address, allowed to call `execute` (selector 0xe9ae5c53), lets that key move funds, uninstall the module and rotate the passkey from any ERC-4337 client with nonce key `0x00 01 845a...ce57 0000`. With a connected wallet the steps are:

1. Connect the wallet (section 7) and refuse contract wallets (`assertNotContractWallet`).
2. Prove the key: `proveEcdsaKey(wallet, sleeveAccount)` signs one plain message and recovers it locally. A recovery key that cannot sign fails only on the day it is needed, so this check is required here, unlike the owner path where the first UserOp is itself the proof.
3. The passkey signs a bracketed owner op: `sendOwnerOp(cfg, clients, [installRecoverySignerCall(account, walletAddress)], confirm)` from zerodev-passkey.md 8, so I14 holds.
4. Read back: `readEcdsaOwner(publicClient, account)` equals the wallet, and `isModuleInstalled(1, 0x845A...cE57, "0x")` is true.

Limits:

- The deployed validator (built from Kernel commit e18c700, not the v3.1 tag) reverts `AlreadyInitialized(account)` when the account already has an ECDSA owner (g6-notes.md, lines 62 and 294). So a passkey account holds one recovery wallet, changing it means uninstall then install, and a wallet-owned account cannot add one through the same validator. The tag's source overwrites the owner instead, so never rely on the tag's behavior.
- The recovery wallet can do anything the passkey can, outside Sleeve, unbracketed. The app says so when it is set (section 12).
- Outside Sleeve there is no Sleeve paymaster, so recovery UserOps need ETH in the account or a third-party paymaster.

## 10. SSR, hydration and build pitfalls

| Pitfall | What happens | Recipe |
| --- | --- | --- |
| RainbowKit modules are `"use client"` | Calling `connectorsForWallets` or `getDefaultConfig` from a Server Component throws | Config only in client modules, `config.ts` marked `'use client'` |
| Empty project id | `No projectId found` thrown during server render for MetaMask, Rainbow, Trust, WalletConnect | `walletList(null)` keeps Rabby and Coinbase only |
| `cookieToInitialState` in a layout | `await headers()` makes every route under it dynamic | Read `document.cookie` in the client provider, gate wallet UI on `mounted` |
| Wallet state in server HTML | Hydration mismatch when the cookie says connected | `ConnectButton.Custom`'s `mounted`, and any other wallet UI waits for mount |
| `theme` prop | Wrapper `<div data-rk>` breaks the shell's flex height | `theme={null}` plus the `[data-rk]` style block |
| Module-scope wagmi config | Server shares one store across requests | `useState(() => createWalletConfig(...))` |
| `@coinbase/cdp-sdk` 1.53+ | `next build` fails on `@x402/*` | `serverExternalPackages: ['@base-org/account']` |
| `pino-pretty`, async-storage | Build warnings | webpack aliases to `false` |
| pnpm 11 build policy | `ERR_PNPM_IGNORED_BUILDS`, exit 1 | three `allowBuilds: false` entries |
| Reconnect on mount | Every connector SDK loads, WalletConnect calls Reown on every page | Providers only on wallet routes |
| Wallet on another chain | `useWalletClient({ chainId: 4663 })` throws `ConnectorChainMismatchError` | Show "Switch to Robinhood Chain" from `chain.unsupported` |
| Wallet account switch | Signature from a different key, AA24 | Query keyed by address, `assertWalletIsOwner` before each op |
| Smart-contract wallets | ECDSA validator cannot verify ERC-1271 | `eoaOnly`, no `base`, no `safeWallet`, code check |
| Salt 0 | Shared address with other ZeroDev apps | `SLEEVE_ACCOUNT_INDEX` |
| Strict Mode | Config initializer runs twice in development | Harmless: WalletConnect instances are cached by config in RainbowKit |
| Second viem | `@walletconnect/utils` pins `viem@2.23.2` | Only inside the lazily loaded WalletConnect chunk, not in app types |
| Vercel previews | Origin not on the Reown allowlist, passkeys bound to the production rpID | Preview project id, or no QR on previews |

## 11. Bundle size and network cost

Measured in the scratch project: a minimal Next 15.5.27 App Router app, `next build`, with the recipe's files and the app's real Button and tokens.css.

| Route | Contents | First Load JS (Next build, gzip) |
| --- | --- | --- |
| `/` | React, react-query provider, Button | 110 kB |
| `/wallet` | plus `WalletProviders` and `ConnectWalletButton` | 313 kB (+203 kB) |
| `/onboard` | plus `useWalletOwnedAccount` (ZeroDev SDK and ECDSA validator) | 345 kB (+235 kB) |

After hydration, Chromium on `next start` (gzip transfer, page load plus 3 s, net-check.mjs):

| Page | JS files | JS transferred | Third-party requests on load |
| --- | --- | --- | --- |
| `/` | 8 | 120 KB | none |
| `/wallet`, no project id | 19 | 448 KB | none |
| `/wallet`, with a project id | 25 | 704 KB | `api.web3modal.org` (project config), `pulse.walletconnect.org` (INIT event) |

The difference between first load and transfer is wagmi's reconnect loading connector SDKs after mount (section 5). RainbowKit's stylesheet is 54,345 bytes, 12,209 gzip (`dist/index.css`). On disk the stack adds about 433 packages and 520 MB to pnpm's store (scratch install).

## 12. Recipe

Proposed paths under app/src/wallet/. Type-checked with TypeScript 5.9.3 and the app's compiler options (`strict`, `noUncheckedIndexedAccess`, `isolatedModules`), clean under the app's ESLint config (`next/core-web-vitals`, `next/typescript`) and under `node scripts/copy-lint.mjs` (0 findings), built with Next 15.5.27, and run in Chromium as described above. The ABIs are JSON because copy-lint flags the word "returns" in human-readable ABI strings, and the chain check avoids a bare lowercase "robinhood" for the same reason. `@/components/token/glyphs` and `@/components/ui/button` are the app's own files.

`chain.ts`:

```ts
import type { Chain } from '@rainbow-me/rainbowkit';
import { CHAIN_ID, EXPLORER_URL, PUBLIC_RPC_URL } from '@sleeve/core';
import { robinhood } from 'viem/chains';

if (robinhood.id !== CHAIN_ID) throw new Error(`viem's Robinhood Chain entry has id ${robinhood.id}, expected ${CHAIN_ID}`);

/** Sleeve's NetworkGlyph (icon-system.md 6) as an image, for the one place RainbowKit draws a chain icon itself. */
const NETWORK_GLYPH_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#5b6270" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round"><path d="M10 2.75 17.25 6.5 10 10.25 2.75 6.5Z"/>' +
  '<path d="m2.75 10 7.25 3.75L17.25 10"/><path d="m2.75 13.5 7.25 3.75 7.25-3.75"/></svg>';

/**
 * Robinhood Chain for wagmi and RainbowKit. viem's entry also lists a third-party RPC and websocket; a wallet that
 * adds the chain gets only the official RPC and the Blockscout explorer. The icon is the neutral glyph, never a
 * Robinhood mark (D-021, D-022).
 */
export const robinhoodChain = {
  ...robinhood,
  rpcUrls: { default: { http: [PUBLIC_RPC_URL] } },
  blockExplorers: { default: { name: 'Blockscout', url: EXPLORER_URL, apiUrl: `${EXPLORER_URL}/api` } },
  iconUrl: `data:image/svg+xml,${encodeURIComponent(NETWORK_GLYPH_SVG)}`,
  iconBackground: '#ffffff',
} as const satisfies Chain;
```

`env.ts`:

```ts
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
```

The 32-hex check matches RainbowKit's demo id. Reown does not document the format, so if a real id ever fails it, the check is the thing to change.

`config.ts`:

```ts
'use client';

import { connectorsForWallets, type WalletList } from '@rainbow-me/rainbowkit';
import {
  coinbaseWallet,
  metaMaskWallet,
  rabbyWallet,
  rainbowWallet,
  trustWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { cookieStorage, createConfig, createStorage, http } from 'wagmi';

import { robinhoodChain } from './chain';
import { WALLETCONNECT_PROJECT_ID } from './env';

/**
 * Coinbase Wallet's default ("all") offers its smart wallet, which signs with ERC-1271 and ERC-6492. The Kernel ECDSA
 * validator only recovers plain ECDSA signatures, so only the Coinbase Wallet EOA (extension or app) can own a
 * Sleeve account.
 */
coinbaseWallet.preference = 'eoaOnly';

/**
 * With a project id: the six wallets the owner named. Without one, RainbowKit throws for every wallet that can fall
 * back to WalletConnect (MetaMask, Rainbow and Trust when not installed, and WalletConnect itself), and on the server
 * nothing counts as installed, so the list keeps only wallets that never use WalletConnect. Installed extensions,
 * MetaMask and Rainbow among them, still appear under "Installed" through EIP-6963 discovery.
 */
export function walletList(projectId: string | null): WalletList {
  if (projectId === null) {
    return [{ groupName: 'Browser wallets', wallets: [rabbyWallet, coinbaseWallet] }];
  }
  return [
    {
      groupName: 'Wallets',
      wallets: [metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet, rabbyWallet, trustWallet],
    },
  ];
}

export function createWalletConfig(readRpcUrl: string) {
  return createConfig({
    chains: [robinhoodChain],
    transports: { [robinhoodChain.id]: http(readRpcUrl) },
    connectors: connectorsForWallets(walletList(WALLETCONNECT_PROJECT_ID), {
      appName: 'Sleeve',
      appDescription: 'A payment address on Robinhood Chain that invests part of every payment.',
      // projectId is typed as required; with null no wallet in the list reads it.
      projectId: WALLETCONNECT_PROJECT_ID ?? '',
    }),
    // EIP-6963: installed extensions announce themselves and RainbowKit lists them under "Installed".
    multiInjectedProviderDiscovery: true,
    storage: createStorage({ storage: cookieStorage }),
    ssr: true,
  });
}

export type WalletConfig = ReturnType<typeof createWalletConfig>;

declare module 'wagmi' {
  interface Register {
    config: WalletConfig;
  }
}
```

`theme.ts`:

```ts
import { cssStringFromTheme, lightTheme } from '@rainbow-me/rainbowkit';

const base = lightTheme({ borderRadius: 'large', fontStack: 'system', overlayBlur: 'small' });

/**
 * RainbowKit in the v2 palette. Every value is one of Sleeve's CSS variables (tokens.css stays the one source):
 * RainbowKit writes each into a --rk-* property under [data-rk], and its sanitizer only strips : ; { } < / >.
 * Black is action and selection (DESIGN.md 33), so the accent is the brand black, not green. RainbowKit's own
 * connection dot (#30E000) sits in the #00C805 family the brand rules forbid, and its blue and yellow go too.
 */
export const sleeveWalletTheme = {
  ...base,
  colors: {
    accentColor: 'var(--color-brand)',
    accentColorForeground: 'var(--color-on-brand)',
    actionButtonBorder: 'var(--color-border)',
    actionButtonBorderMobile: 'var(--color-border)',
    actionButtonSecondaryBackground: 'var(--color-surface-muted)',
    closeButton: 'var(--color-ink-secondary)',
    closeButtonBackground: 'var(--color-surface-muted)',
    connectButtonBackground: 'var(--color-surface)',
    connectButtonBackgroundError: 'var(--color-danger)',
    connectButtonInnerBackground: 'var(--color-surface-muted)',
    connectButtonText: 'var(--color-ink)',
    connectButtonTextError: 'var(--color-on-danger)',
    connectionIndicator: 'var(--color-success)',
    downloadBottomCardBackground: 'var(--color-surface)',
    downloadTopCardBackground: 'var(--color-surface-muted)',
    error: 'var(--color-danger-text)',
    generalBorder: 'var(--color-border)',
    generalBorderDim: 'var(--color-surface-muted)',
    menuItemBackground: 'var(--color-surface-muted)',
    modalBackdrop: 'var(--color-scrim)',
    modalBackground: 'var(--color-surface)',
    modalBorder: 'var(--color-border)',
    modalText: 'var(--color-ink)',
    modalTextDim: 'var(--color-ink-muted)',
    modalTextSecondary: 'var(--color-ink-secondary)',
    profileAction: 'var(--color-surface)',
    profileActionHover: 'var(--color-surface-muted)',
    profileForeground: 'var(--color-surface-muted)',
    selectedOptionBorder: 'var(--color-border-strong)',
    standby: 'var(--color-waiting)',
  },
  fonts: { body: 'var(--font-sans)' },
  radii: {
    actionButton: 'var(--radius-pill)',
    connectButton: 'var(--radius-pill)',
    menuButton: 'var(--radius-control)',
    modal: 'var(--radius-card)',
    modalMobile: 'var(--radius-sheet)',
  },
  shadows: {
    ...base.shadows,
    connectButton: 'var(--shadow-soft)',
    dialog: 'var(--shadow-overlay)',
  },
} satisfies ReturnType<typeof lightTheme>;

/**
 * The provider gets theme={null}: with a theme RainbowKit wraps the whole app in <div data-rk>, which breaks the
 * shell's flex-1 (body is flex-col). Modals portal into body with data-rk themselves, so the variables go on that
 * selector. RainbowKit ignores reduced motion (350 ms slide, spinners), so that is added here.
 */
export const SLEEVE_WALLET_CSS =
  `[data-rk]{${cssStringFromTheme(sleeveWalletTheme)}}` +
  '@media (prefers-reduced-motion: reduce){[data-rk] *,[data-rk] *::before,[data-rk] *::after' +
  '{animation:none!important;transition:none!important}}';
```

`wallet-providers.tsx`:

```tsx
'use client';

import '@rainbow-me/rainbowkit/styles.css';

import { RainbowKitProvider, type DisclaimerComponent } from '@rainbow-me/rainbowkit';
import { PUBLIC_RPC_URL } from '@sleeve/core';
import { useState, type JSX, type ReactNode } from 'react';
import { cookieToInitialState, WagmiProvider } from 'wagmi';

import { robinhoodChain } from './chain';
import { createWalletConfig } from './config';
import { WALLETCONNECT_PROJECT_ID } from './env';
import { SLEEVE_WALLET_CSS } from './theme';

/** Shown at the foot of the connect modal while WalletConnect has no project id. */
const QrCodeOff: DisclaimerComponent = ({ Text }) => (
  <Text>
    Phone wallets by QR code are off until Sleeve has a WalletConnect project id. Wallets installed in this browser
    work now.
  </Text>
);

/**
 * wagmi and RainbowKit for the routes that use a wallet (onboarding now, wallet signing later). Mounted in a route
 * layout, not the product layout: on mount wagmi's reconnect loads every connector's SDK. It sits inside
 * DataLayerProvider and shares its QueryClient, so there is one cache per tab. The config is made once per mount,
 * never at module scope, so the server never shares wallet state between requests.
 *
 * The cookie is read here during hydration, instead of in a layout through headers(), which would
 * make every product route dynamic. On the server initialState is undefined, so every piece of wallet UI waits for
 * mount (ConnectButton.Custom's mounted flag) and never renders wallet state in server HTML.
 */
export function WalletProviders({ children }: { children: ReactNode }): JSX.Element {
  const [config] = useState(() => createWalletConfig(process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL || PUBLIC_RPC_URL));
  const [initialState] = useState(() =>
    cookieToInitialState(config, typeof document === 'undefined' ? null : document.cookie),
  );
  return (
    <WagmiProvider config={config} initialState={initialState}>
      <RainbowKitProvider
        theme={null}
        modalSize="compact"
        initialChain={robinhoodChain}
        appInfo={{ appName: 'Sleeve', disclaimer: WALLETCONNECT_PROJECT_ID === null ? QrCodeOff : undefined }}
      >
        <style dangerouslySetInnerHTML={{ __html: SLEEVE_WALLET_CSS }} />
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
}
```

`appInfo.learnMoreUrl` defaults to Rainbow's "understanding web3" page under the modal's "Learn More". Point it at Sleeve's own wallet FAQ when one exists.

`connect-wallet-button.tsx`:

```tsx
'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import { CHAIN_NAME } from '@sleeve/core';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { Button } from '@/components/ui/button';

/**
 * RainbowKit's state and modals behind Sleeve's own Button. Nothing about the wallet renders until mounted, so the
 * server HTML and the first client render agree whatever the cookie holds.
 */
export function ConnectWalletButton({ fullWidth = false }: { fullWidth?: boolean }): JSX.Element {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openConnectModal, openChainModal, openAccountModal, connectModalOpen }) => {
        if (!mounted) {
          return <span aria-hidden="true" className="inline-block min-h-control w-40 rounded-pill bg-skeleton" />;
        }
        if (account === undefined || chain === undefined) {
          return (
            <Button fullWidth={fullWidth} onClick={openConnectModal} busy={connectModalOpen} busyLabel="Choosing a wallet">
              Connect a wallet
            </Button>
          );
        }
        if (chain.unsupported === true) {
          return (
            <Button fullWidth={fullWidth} variant="secondary" onClick={openChainModal}>
              <NetworkGlyph className="size-4" />
              Switch to {CHAIN_NAME}
            </Button>
          );
        }
        return (
          <Button fullWidth={fullWidth} variant="secondary" onClick={openAccountModal}>
            <span className="font-mono tabular-nums">{account.displayName}</span>
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
```

`wallet-account.ts`:

```ts
import { signerToEcdsaValidator } from '@zerodev/ecdsa-validator';
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from '@zerodev/sdk';
import { getEntryPoint, KERNEL_V3_1 } from '@zerodev/sdk/constants';
import {
  type Account,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isAddressEqual,
  keccak256,
  parseAbiParameters,
  recoverMessageAddress,
  stringToBytes,
  zeroAddress,
} from 'viem';

import { robinhoodChain } from './chain';

const ENTRY_POINT = getEntryPoint('0.7');
const KERNEL_VERSION = KERNEL_V3_1;
/** ZeroDev's ECDSA validator for Kernel 0.3.1 and later, deployed on 4663 (zerodev-passkey.md 2 and 3.1). */
export const ECDSA_VALIDATOR: Address = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57';
const MODULE_TYPE_VALIDATOR = 1n;
const MODULE_TYPE_EXECUTOR = 2n;
const KERNEL_EXECUTE_SELECTOR: Hex = '0xe9ae5c53';

/**
 * The CREATE2 salt of every wallet-owned Sleeve account. Without initConfig (D-019) the address commits only to the
 * owner and this salt, so the SDK default of 0 is the address every other ZeroDev Kernel v3.1 app gives the same
 * wallet. A Sleeve salt keeps a fresh account. It is part of every address: final before the first real user.
 */
export const SLEEVE_ACCOUNT_INDEX = BigInt(keccak256(stringToBytes('sleeve.wallet-account.v1')));

// JSON ABIs: human-readable ones need the word "returns", which copy-lint reads as a performance claim.
const moduleArgs = [
  { name: 'moduleType', type: 'uint256' },
  { name: 'module', type: 'address' },
] as const;
const kernelAbi = [
  {
    type: 'function',
    name: 'installModule',
    stateMutability: 'payable',
    inputs: [...moduleArgs, { name: 'initData', type: 'bytes' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isModuleInstalled',
    stateMutability: 'view',
    inputs: [...moduleArgs, { name: 'additionalContext', type: 'bytes' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const sleeveModuleAbi = [
  {
    type: 'function',
    name: 'isInitialized',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;
const ecdsaValidatorAbi = [
  {
    type: 'function',
    name: 'ecdsaValidatorStorage',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'owner', type: 'address' }],
  },
] as const;

/** What wagmi's useWalletClient returns once the wallet is connected on Robinhood Chain. */
export type ConnectedWallet = WalletClient<Transport, Chain, Account>;
type Call = { to: Address; value: bigint; data: Hex };

export class WalletSignerError extends Error {
  constructor(
    readonly code: 'CONTRACT_WALLET' | 'SIGNATURE_MISMATCH' | 'WRONG_OWNER',
    readonly address: Address,
  ) {
    super(code);
  }
}

/**
 * The Kernel ECDSA validator recovers a plain ECDSA signature (raw or EIP-191) and nothing else. A contract wallet
 * (Safe, Argent, a deployed smart wallet) signs through ERC-1271 and can never own or recover a Kernel account.
 * Code 0xef0100... is an EIP-7702 delegation, still an EOA key.
 */
export async function assertNotContractWallet(publicClient: PublicClient, address: Address): Promise<void> {
  const code = await publicClient.getCode({ address });
  if (code !== undefined && code !== '0x' && !code.startsWith('0xef0100')) {
    throw new WalletSignerError('CONTRACT_WALLET', address);
  }
}

/**
 * Before every owner op of a wallet-owned account. Wallets let people switch accounts at any time, and a signature
 * from another address fails validation (AA24) after the user has already approved it.
 */
export function assertWalletIsOwner(wallet: ConnectedWallet, owner: Address): void {
  if (!isAddressEqual(wallet.account.address, owner)) throw new WalletSignerError('WRONG_OWNER', wallet.account.address);
}

/**
 * Proof the wallet signs with its own key, required before it becomes a recovery signer: a wrong recovery key fails
 * silently until the day it is needed. One message, recovered locally; nothing is sent to chain.
 */
export async function proveEcdsaKey(wallet: ConnectedWallet, sleeveAccount: Address): Promise<Address> {
  const address = getAddress(wallet.account.address);
  const message = `Sleeve recovery signer\nWallet: ${address}\nSleeve account: ${sleeveAccount}\nChain: ${robinhoodChain.id}`;
  const signature = await wallet.signMessage({ account: wallet.account, message });
  const recovered = await recoverMessageAddress({ message, signature });
  if (!isAddressEqual(recovered, address)) throw new WalletSignerError('SIGNATURE_MISMATCH', address);
  return address;
}

/**
 * A Kernel v3.1 account whose root signer is the connected wallet. No initConfig: per D-019 the address commits to
 * the owner and the salt only, and the module goes in with the first UserOp's callData.
 */
export async function buildWalletOwnedAccount(publicClient: PublicClient, wallet: ConnectedWallet) {
  await assertNotContractWallet(publicClient, wallet.account.address);
  const sudo = await signerToEcdsaValidator(publicClient, {
    signer: wallet,
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
  });
  if (!isAddressEqual(sudo.address, ECDSA_VALIDATOR)) throw new Error(`unexpected ECDSA validator ${sudo.address}`);
  return createKernelAccount(publicClient, {
    plugins: { sudo },
    entryPoint: ENTRY_POINT,
    kernelVersion: KERNEL_VERSION,
    index: SLEEVE_ACCOUNT_INDEX,
  });
}

export type WalletOwnedAccount = Awaited<ReturnType<typeof buildWalletOwnedAccount>>;

/** Sponsored client for one account. zeroDevRpc is https://rpc.zerodev.app/api/v3/<projectId>/chain/4663. */
export function walletAccountClient(account: WalletOwnedAccount, publicClient: PublicClient, zeroDevRpc: string) {
  const paymaster = createZeroDevPaymasterClient({ chain: robinhoodChain, transport: http(zeroDevRpc) });
  return createKernelAccountClient({
    account,
    chain: robinhoodChain,
    client: publicClient,
    bundlerTransport: http(zeroDevRpc),
    paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
  });
}

export type RuleInput = {
  spendBps: number;
  equityBps: number;
  tickerId: number;
  premiumCapBps: number;
  slippageBps: number;
  minClip: bigint;
};

/** SleeveModule.onInstall data, abi.encode(keeper, RuleInput) (SPEC 6). A zero keeper selects the default keeper. */
export const sleeveInstallData = (keeper: Address, rule: RuleInput): Hex =>
  encodeAbiParameters(
    parseAbiParameters(
      'address keeper, (uint16 spendBps, uint16 equityBps, uint8 tickerId, uint16 premiumCapBps, uint16 slippageBps, uint128 minClip) rule',
    ),
    [keeper, rule],
  );

/** Kernel v3.1 executor initData: no hook, then abi.encode(executorData, hookData), as KernelHelpers._executorInitData. */
const executorInitData = (moduleData: Hex): Hex =>
  concatHex([zeroAddress, encodeAbiParameters(parseAbiParameters('bytes executorData, bytes hookData'), [moduleData, '0x'])]);

/**
 * The account's call to itself that installs the module. As a single self-call the SDK sends this calldata as the
 * UserOp callData unwrapped, the shape of KernelHelpers._deployThenInstall (path (b), D-019). It is the one owner op
 * without brackets: beginOwnerOp needs the module installed, and the install snapshot books the balance (I5).
 */
export const installSleeveModuleCall = (account: Address, sleeveModule: Address, installData: Hex): Call => ({
  to: account,
  value: 0n,
  data: encodeFunctionData({
    abi: kernelAbi,
    functionName: 'installModule',
    args: [MODULE_TYPE_EXECUTOR, sleeveModule, executorInitData(installData)],
  }),
});

/** D-019: the address is shown only when both views say the module is in. */
export async function isSleeveInstalled(publicClient: PublicClient, account: Address, sleeveModule: Address) {
  const code = await publicClient.getCode({ address: account });
  if (code === undefined || code === '0x') return false;
  const [initialized, listed] = await Promise.all([
    publicClient.readContract({ address: sleeveModule, abi: sleeveModuleAbi, functionName: 'isInitialized', args: [account] }),
    publicClient.readContract({
      address: account,
      abi: kernelAbi,
      functionName: 'isModuleInstalled',
      args: [MODULE_TYPE_EXECUTOR, sleeveModule, '0x'],
    }),
  ]);
  return initialized && listed;
}

/** Any Kernel account client: the wallet-owned one above or the passkey one (zerodev-passkey.md 8). */
type SleeveOpClient = {
  account: { address: Address };
  sendUserOperation(args: { calls: readonly Call[] }): Promise<Hex>;
  waitForUserOperationReceipt(args: { hash: Hex }): Promise<unknown>;
};

/**
 * First UserOp: deploys the account (viem adds factory data while it has no code) and installs the module in the
 * execution phase. If someone deployed the address first, the same call goes without initCode. A reverted install
 * leaves the account deployed without the module (fork test), so success is the read-back, never the receipt.
 */
export async function deployAndInstall(
  client: SleeveOpClient,
  publicClient: PublicClient,
  sleeveModule: Address,
  installData: Hex,
): Promise<Address> {
  const account = client.account.address;
  if (await isSleeveInstalled(publicClient, account, sleeveModule)) return account;
  const hash = await client.sendUserOperation({ calls: [installSleeveModuleCall(account, sleeveModule, installData)] });
  await client.waitForUserOperationReceipt({ hash });
  if (!(await isSleeveInstalled(publicClient, account, sleeveModule))) {
    throw new Error(`Sleeve module is not installed on ${account} after UserOp ${hash}`);
  }
  return account;
}

/**
 * The connected wallet as recovery signer of a passkey account: ZeroDev's ECDSA validator as a secondary validator
 * allowed to call execute (zerodev-passkey.md 9.3). Send it inside a bracketed owner op signed by the passkey, after
 * proveEcdsaKey. The deployed validator reverts AlreadyInitialized on an account that already has an ECDSA owner,
 * so it cannot be added to a wallet-owned account, and changing it means uninstall then install.
 */
export const installRecoverySignerCall = (account: Address, recoveryOwner: Address): Call => ({
  to: account,
  value: 0n,
  data: encodeFunctionData({
    abi: kernelAbi,
    functionName: 'installModule',
    args: [
      MODULE_TYPE_VALIDATOR,
      ECDSA_VALIDATOR,
      concatHex([
        zeroAddress,
        encodeAbiParameters(parseAbiParameters('bytes validatorData, bytes hookData, bytes selectorData'), [
          recoveryOwner,
          '0x',
          KERNEL_EXECUTE_SELECTOR,
        ]),
      ]),
    ],
  }),
});

/** The ECDSA owner the validator holds for this account: the root wallet, or a passkey account's recovery wallet. */
export async function readEcdsaOwner(publicClient: PublicClient, account: Address): Promise<Address | null> {
  const owner = await publicClient.readContract({
    address: ECDSA_VALIDATOR,
    abi: ecdsaValidatorAbi,
    functionName: 'ecdsaValidatorStorage',
    args: [account],
  });
  return owner === zeroAddress ? null : owner;
}
```

`use-wallet-account.ts` (data fetching through react-query, no effect):

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';

import { robinhoodChain } from './chain';
import { buildWalletOwnedAccount } from './wallet-account';

/**
 * The Sleeve account the connected wallet owns, derived without any write. Keyed by the wallet address, so a switch
 * of account inside the wallet derives a different Sleeve account instead of signing for the old one.
 */
export function useWalletOwnedAccount() {
  const { address, status } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const { data: wallet } = useWalletClient({ chainId: robinhoodChain.id });
  return useQuery({
    queryKey: ['sleeve', 'wallet-owned-account', address],
    queryFn: () => {
      if (publicClient === undefined || wallet === undefined) throw new Error('wallet not ready');
      return buildWalletOwnedAccount(publicClient, wallet);
    },
    enabled: status === 'connected' && publicClient !== undefined && wallet !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    structuralSharing: false,
  });
}
```

`app/src/app/(product)/onboard/layout.tsx`:

```tsx
import type { JSX, ReactNode } from 'react';

import { WalletProviders } from '@/wallet/wallet-providers';

export default function OnboardLayout({ children }: { children: ReactNode }): JSX.Element {
  return <WalletProviders>{children}</WalletProviders>;
}
```

Onboarding with a wallet, in order (the chain steps go through the data layer, which is mock today and labeled sample data):

1. "Use a passkey" stays first (D-003). "Use a wallet you already have" opens the RainbowKit modal through `ConnectWalletButton`.
2. Connected on Robinhood Chain: show the owner disclosure below. Do not show any address yet.
3. The rule step (D-014 default, 10 percent to SPY).
4. "Create my Sleeve account": `deployAndInstall(walletAccountClient(account, publicClient, zeroDevRpc), publicClient, SLEEVE_MODULE, sleeveInstallData(zeroAddress, rule))`. One wallet prompt. Show the payment address only after the read-back.
5. Errors to handle by name: the user rejects the signature (`UserRejectedRequestError`), `WalletSignerError` `CONTRACT_WALLET`, sponsorship unavailable (a new account has no ETH, so the owner-paid fallback of zerodev-passkey.md 8 needs ETH sent first), and `AA10` (resend).

Copy, plain words, no dashes:

- Owner disclosure (D-022, PRD 7.2): "Your wallet will own this Sleeve account. It can also act on the account directly, outside Sleeve. Sleeve keeps exact records only for actions you take in Sleeve. Money that an outside action brings into the account can look like a payment, and Sleeve would split it."
- Before a wallet signature: "Your wallet will ask you to sign a long code. That code stands for this action and works only on Robinhood Chain."
- Recovery wallet: "A recovery wallet can use this account without Sleeve and without your passkey, including moving everything in it. Add only a wallet you control and keep safe."
- Contract wallet refused: "This is a smart contract wallet. Sleeve needs a wallet that signs with its own key, such as MetaMask, Rabby, Rainbow, Trust or Coinbase Wallet."
- Wrong account in the wallet: "Your wallet has 0x… selected. Switch to 0x… in your wallet to continue."
- QR off: the `QrCodeOff` line in wallet-providers.tsx.

Tests the builder can add (vitest, no network):

- `walletList(null)` holds no wallet that needs WalletConnect, and `connectorsForWallets` over it does not throw in Node.
- `parseWalletConnectProjectId` for an empty value, spaces, a 32-hex id and a malformed id.
- `installSleeveModuleCall` with the fork tests' default rule (9,000 and 1,000 bps, ticker 0, cap 100, slippage 50, clip 25 USDG, keeper zero) equals the `cast` fixture in the scratchpad (section 14).
- `SLEEVE_ACCOUNT_INDEX` equals 0xa48a6d278da47a227527162cfbcf7e07c7c669c653780a0a8fe37f5597c65240.
- `SLEEVE_WALLET_CSS` contains none of `30E000`, `0E76FD`, `00C805`.
- `ConnectWalletButton` renders only the skeleton under `renderToString`.

## 13. Open questions and risks

1. Reown project. Owner to create it, allowlist the production origin, and decide on previews (second id or no QR). Until then the degraded mode in section 3 applies. Should a Vercel production build refuse to start without the id once it exists, as next.config.ts does for `NEXT_PUBLIC_SLEEVE_DATA_SOURCE`? Recommended: yes, after the owner supplies it.
2. Wallet salt. `SLEEVE_ACCOUNT_INDEX` is a design choice a reviewer would question. It needs a DECISIONS.md entry and must be final before the first real wallet-owned account.
3. Browser RPC. The proposed `NEXT_PUBLIC_ROBINHOOD_RPC_URL` needs the Alchemy app from batch 1, with a domain allowlist. The public RPC answered with Cloudflare challenges under bursts (chain-constants.md, header notes).
4. Live run. The wallet-owned first UserOp has run only in fork tests and in these offline checks. Run it once on mainnet through the real ZeroDev project and the deployed module, record it in docs/GATES.md, and only then show it in a demo (build contract, copy rules).
5. Recovery at onboarding. zerodev-passkey.md open question 6 (required, offered or deferred) is still open. A connected wallet is now the easiest recovery signer to offer.
6. Deprecated SDKs. wagmi 2.19.5 pins WalletConnect 2.21.1 and MetaMask SDK 0.33.1. Moving off them waits for a RainbowKit release on wagmi 3.
7. Domain verification. Whether wallets show Sleeve as verified with RainbowKit's provider is untested (section 3).

## 14. Reproduce

Scratchpad: `/private/tmp/claude-501/-Users-mac-sleeve/e8745a41-dfe5-4389-9aa3-ac2131949975/scratchpad/wc/`.

- `pkgs/`: packed and extracted @rainbow-me/rainbowkit 2.2.11, wagmi 2.19.5, @wagmi/core 2.22.1, @wagmi/connectors 6.2.0, viem 2.57.2, @zerodev/sdk 5.5.10, @zerodev/ecdsa-validator 5.4.9, @walletconnect/ethereum-provider 2.21.1. `cdp/`: @coinbase/cdp-sdk 1.52.0 and 1.53.0.
- `proj/`: the scratch app, with the recipe in `src/wallet/` exactly as printed in section 12. `npm install --ignore-scripts` from its package.json, `npx tsc -p tsconfig.json --noEmit`, ESLint with `eslint.config.mjs` (the app's rules), `node scripts/copy-lint.mjs <proj>/src/wallet` from the repo, `next build` with `NEXT_DIST_DIR=.next-a` (no id) and `.next-b` (`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=0123456789abcdef0123456789abcdef`). Logs: `next-build.log` (the `@x402` failure), `next-build3.log` (clean), `build-final.log` (the final files, clean, same route sizes).
- `proj/tests/`: `server-config.ts` (section 3 table), `ssr.tsx` (server render), `account.ts` and `initdata.ts` (section 8, live `eth_call`s). Run with `npx tsx --tsconfig tsconfig.run.json tests/<file>`.
- `pnpmtest/`: pnpm 11.23.0 workspace with the repo's `allowBuilds`, `pnpm-install.log` (the `ERR_PNPM_IGNORED_BUILDS` failure).
- `modal-check.mjs`, `connect-check.mjs`, `hydrate-check.mjs`, `mobile-check.mjs`, `net-check.mjs`: Playwright runs against `next start` on ports 4791 (no id) and 4792 (with id). `shots/`: the modal at 1280 and 360 px, with and without the id, with an installed wallet, and on a phone user agent.
- `cast_installdata.txt`, `cast_calldata.txt`: the Solidity-side encodings of section 8.

Key one-liners:

```bash
npm view @rainbow-me/rainbowkit@2.2.11 peerDependencies   # wagmi ^2.9.0
npm view @wagmi/connectors@6.2.0 dependencies             # pins @walletconnect/ethereum-provider 2.21.1, @base-org/account 2.4.0
npm view @coinbase/cdp-sdk@1.53.0 peerDependencies        # first version with the optional @x402 peers
cast abi-encode "f(address,(uint16,uint16,uint8,uint16,uint16,uint128))" 0x0000000000000000000000000000000000000000 "(9000,1000,0,100,50,25000000)"
cast call --rpc-url https://rpc.mainnet.chain.robinhood.com 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419 'getAddress(bytes,bytes32)(address)' <initData> <salt>
```
