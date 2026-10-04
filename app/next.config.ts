import type { NextConfig } from 'next';

// A production build (SLEEVE_ENV=production, set by scripts/cloudflare.mjs) must name its data source. Local builds
// and previews default to the mock, which labels every screen as sample data (src/data/source.ts).
if (process.env.SLEEVE_ENV === 'production' && !process.env.NEXT_PUBLIC_SLEEVE_DATA_SOURCE) {
  throw new Error('Set NEXT_PUBLIC_SLEEVE_DATA_SOURCE to "chain" or "mock" for a production build.');
}

const nextConfig: NextConfig = {
  // A second dev server (a local preview next to a build) needs its own output folder.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@sleeve/core'],
  // The token icons are small committed files. Workers has no Next image optimizer without Cloudflare Images, so
  // next/image serves them as they are (D-033).
  images: { unoptimized: true },
  // @base-org/account's Node entry imports @coinbase/cdp-sdk, which from 1.53.0 imports the optional @x402 peers.
  // Only wagmi's Base connector loads it, in the browser, so the server bundle never needs it.
  serverExternalPackages: ['@base-org/account'],
  webpack(config) {
    // WalletConnect's logger and MetaMask SDK reference optional modules that never run in the browser. The @x402
    // packages are optional peers of @coinbase/cdp-sdk, reached only through Base Account payments, which Sleeve never
    // calls; pnpm does not hoist @base-org/account, so serverExternalPackages alone cannot keep them out of the bundle.
    config.resolve.alias = {
      ...config.resolve.alias,
      'pino-pretty': false,
      '@react-native-async-storage/async-storage': false,
      '@x402': false,
    };
    return config;
  },
};

export default nextConfig;
