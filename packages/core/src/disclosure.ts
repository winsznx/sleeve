/**
 * The issuer disclosure Sleeve shows word for word (PRD 10). Pinned values from docs/disclosure/README.md.
 * The text itself ships as a file whose bytes hash to `keccak256`; never retype it.
 */
export const DISCLOSURE = {
  keccak256: '0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89',
  sha256: '9bb00fc01df7700d045cd888a8a92246cee1bca0a0e4eb7166b0c79423ac29bc',
  byteLength: 2_360,
  /** ISO date of retrieval, 2 October 2026. */
  retrievedOn: '2026-10-02',
  sources: ['https://docs.robinhood.com/rhj/product', 'https://docs.robinhood.com/rhj'],
  issuer: 'Robinhood Assets (Jersey) Limited',
} as const;
