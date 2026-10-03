import type { NextConfig } from 'next';

// A production deploy must name its data source. Local builds and previews default to the mock,
// which labels every screen as sample data (src/data/source.ts).
if (process.env.VERCEL_ENV === 'production' && !process.env.NEXT_PUBLIC_SLEEVE_DATA_SOURCE) {
  throw new Error('Set NEXT_PUBLIC_SLEEVE_DATA_SOURCE to "chain" or "mock" for a production build.');
}

const nextConfig: NextConfig = {
  // A second dev server (a local preview next to a build) needs its own output folder.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@sleeve/core'],
  // Server code reads the issuer disclosure from public/ (src/lib/disclosure.ts); keep it in every function bundle.
  outputFileTracingIncludes: {
    '/**': ['./public/disclosure/rhj-disclosure.txt'],
  },
};

export default nextConfig;
