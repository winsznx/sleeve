import { DISCLOSURE } from '@sleeve/core';

/**
 * Lines the product shows word for word. scripts/copy-lint.mjs allows these exact strings and blocks the
 * same words anywhere else, so render the constant instead of retyping the line.
 */

export const BRAND_NAME = 'Sleeve';

/** Brand guidelines, Terms 5.7(b) form. Shown in every page footer. */
export const DISCLAIMER =
  'Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.';

/** Factual compatibility line the Terms allow without consent (5.6(a)). */
export const BUILT_ON_LINE = 'Built on Robinhood Chain';

/** Carried by every holding and every receipt (build contract, PRD 4). */
export const DEBT_SECURITY_LINE = 'debt security, not a share';

/** The issuer-accurate exit line adopted in D-014. */
export const EXIT_LINE =
  "Sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and pays cash, not shares. Sleeve offers no redemption.";

export const ISSUER_NAME: string = DISCLOSURE.issuer;

/** The only label a gated feature (borrow, the pay link, baskets, crews) may carry. */
export const NOT_AVAILABLE_YET = 'Not available yet';

/** Shown while the mock data layer is selected (src/data/source.ts). */
export const SAMPLE_DATA_LINE = 'Sample data. Nothing shown here happened on chain.';
