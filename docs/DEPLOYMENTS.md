# Deployments

## Robinhood Chain mainnet, chain id 4663

Deployed 3 October 2026 between 20:37:55 and 20:38:04 Lagos time (blocks 79,338,287 to 79,338,373) by DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1, from commit ca795ff with a clean tree, following docs/DEPLOY_PLAN.md. Seven transactions, 18,410,544 gas, 0.000423594 ETH in total.

| Contract | Address | Transaction | Block | Gas | Source |
| --- | --- | --- | --- | --- | --- |
| SleeveBuy | `0xDF3e060D64086ec3309265Ce83B34813eE45F81A` | [0x9d78c42e](https://robinhoodchain.blockscout.com/tx/0x9d78c42e7429e3e4a3d136cf30361eca3790df98deb8848c82dab575c0c1ee62) | 79,338,287 | 1,375,058 | [exact match](https://repo.sourcify.dev/4663/0xDF3e060D64086ec3309265Ce83B34813eE45F81A) |
| SleeveTrade | `0x3757964A25C94040e81a215Dd85B748f6bB9ca84` | [0x4e1da474](https://robinhoodchain.blockscout.com/tx/0x4e1da474c95b5912eb207a15820b3913becf18c9deef2178cc5cf928d09fe767) | 79,338,303 | 4,285,597 | [exact match](https://repo.sourcify.dev/4663/0x3757964A25C94040e81a215Dd85B748f6bB9ca84) |
| SleeveSell | `0xC0003635086E51aC0c19c40c193043D58d86c987` | [0xd0f69cf5](https://robinhoodchain.blockscout.com/tx/0xd0f69cf54006d31db7eb75f22f43879a6bb2547102c2f401be28b68f7544c22e) | 79,338,318 | 3,910,250 | [exact match](https://repo.sourcify.dev/4663/0xC0003635086E51aC0c19c40c193043D58d86c987) |
| SleeveTimelock | `0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D` | [0x26c8388e](https://robinhoodchain.blockscout.com/tx/0x26c8388e857c546b323010c821324c20f5700316434eba96c6a3c0536d1e5693) | 79,338,331 | 1,673,590 | [exact match](https://repo.sourcify.dev/4663/0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D) |
| SessionCalendarExtension | `0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D` | [0x9edae299](https://robinhoodchain.blockscout.com/tx/0x9edae2995f7f560b8c8198ee311fe7a50cbe5d3ea2400415cc06065823772e8c) | 79,338,344 | 1,823,538 | [exact match](https://repo.sourcify.dev/4663/0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D) |
| TokenSource | `0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F` | [0x3207b109](https://robinhoodchain.blockscout.com/tx/0x3207b109626c24dda48236a51f0d94b22f7eab0e0751278f35594ccb8ea6ee83) | 79,338,357 | 1,616,061 | [exact match](https://repo.sourcify.dev/4663/0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F) |
| SleeveModule | `0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9` | [0x38523e10](https://robinhoodchain.blockscout.com/tx/0x38523e1061dd33658cab2bbf98a4a8514dcb30a17c33ced08fbaf49a9cc58107) | 79,338,373 | 3,726,450 | [exact match](https://repo.sourcify.dev/4663/0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9) |

The full record, with constructor arguments decoded and encoded, library links, block hashes and costs, is contracts/deployments/4663.json. forge's broadcast is contracts/broadcast/Deploy.s.sol/4663/run-latest.json.

## Checks after the deploy

- Read-back from chain state (contracts/script/ReadBack.s.sol) through the public RPC: every check passed. It compared the code at all seven addresses with this commit's build, every library link, the timelock's delay, roles and full event history, the calendar, every TokenSource ticker, feed, session type and pool, the pools left off the allowlist, and the module's immutables and guard limits. The dRPC free tier refused the read-back's event-history query (log ranges over 10,000 blocks), so the second provider is the public RPC; it reruns on the Alchemy app once that exists.
- Verification inputs: contracts/script/verify.py compiled every input and matched the chain, 9 of 9 checks (contracts/deployments/4663.verify.json).
- Source verification: all seven contracts verified on Sourcify with exact_match for both runtime and creation code. Blockscout's explorer at robinhoodchain.blockscout.com reads Sourcify; direct Blockscout verification through its PRO API waits on a free API key.

## Configuration

- SleeveModule: USDG, TokenSource and the calendar above, SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2, the USDG/USD feed 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2, default keeper KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, disclosure hash 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89, guard limits 25 hours, 25 hours, 50 bps and 24 hours, grace 3,600 seconds.
- SleeveTimelock: 48-hour minimum delay, DEPLOYER as proposer, canceller and executor, no admin role holder. It administers TokenSource and SessionCalendarExtension only.
- TokenSource: SPY, QQQ, NVDA and AAPL, each ALL_DAY, with the D-010 pools (docs/DEPLOY_PLAN.md section 3).
