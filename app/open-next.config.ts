import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Prerendered pages are read from the deployed static assets. Nothing revalidates, so there is no R2 bucket, queue
// or self binding (D-033). OpenNext loads this file by its default export.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  enableCacheInterception: true,
});
