# Mainnet deploy plan

Deployed 3 October 2026 at blocks 79,338,287 to 79,338,373 from commit ca795ff, at the addresses of section 2. docs/DEPLOYMENTS.md is the record, and D-028 records the owner's go and how the module settles the decisions of section 10. The plan below is kept as written before the broadcast.

Status: ready for the owner's go, 3 October 2026. Nothing has been broadcast to a live chain. The tooling in contracts/script passed a fork dry run at block 79,304,056 and 14 fork tests at the pinned blocks of D-008. The contracts are those of commit 68c5815, whose contracts/src is unchanged by this work.

Sources: internal/CLAUDE.md, docs/SPEC.md draft 3 sections 1 to 5, D-009 Q33, D-010, D-014, D-018, D-019, D-026 (audit A1-26), docs/research/chain-constants.md, docs/research/pools.md, docs/research/g6-notes.md, docs/FUNDING.md.

## 1. In short

- Seven transactions from DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1. forge's linker sends the three external libraries first, through the CREATE2 deployer. Then the script creates SleeveTimelock, SessionCalendarExtension, TokenSource and SleeveModule.
- The dry run used 18,925,269 gas, of which 514,701 is the L1 component the chain charged at 18:42 UTC. At the gas price read then, 0.023344 gwei, the deploy costs 0.000442 ETH. forge reserves up to 0.001171 ETH while it sends.
- DEPLOYER holds 0 ETH and has nonce 0 (read at 18:02 UTC). Fund it with 0.0025 ETH, the amount docs/FUNDING.md asked for.
- The checks run on both sides of the broadcast. Deploy.s.sol checks the simulated deployment before anything is sent, ReadBack.s.sol checks the chain afterwards with the same code, and verify.py checks that what the verifiers will compile is the deployed code.
- Before step 8.2 the owner gives the go, funds DEPLOYER and answers the decisions in section 10.

## 2. What gets deployed

| Tx | Contract | Kind | Created by | Constructor arguments | Address if DEPLOYER starts at nonce 0 |
| --- | --- | --- | --- | --- | --- |
| 1 | SleeveBuy | external library | CREATE2 deployer 0x4e59b44847b379578588920cA78FbF26c0B4956C, salt 0, nonce 0 | none | 0xDF3e060D64086ec3309265Ce83B34813eE45F81A |
| 2 | SleeveTrade | external library | CREATE2 deployer, salt 0, nonce 1 | none | 0x3757964A25C94040e81a215Dd85B748f6bB9ca84 |
| 3 | SleeveSell | external library, links SleeveTrade | CREATE2 deployer, salt 0, nonce 2 | none | 0xC0003635086E51aC0c19c40c193043D58d86c987 |
| 4 | SleeveTimelock | contract | CREATE, nonce 3 | minDelay 172800, proposers [DEPLOYER], executors [DEPLOYER], admin 0x0 | 0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D |
| 5 | SessionCalendarExtension | contract | CREATE, nonce 4 | timelock_: tx 4 | 0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D |
| 6 | TokenSource | contract | CREATE, nonce 5 | timelock_: tx 4, usdg_: USDG, v3Factory_: 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA, tickers: section 3 | 0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F |
| 7 | SleeveModule | contract, links SleeveTrade, SleeveBuy and SleeveSell | CREATE, nonce 6 | config: below | 0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9 |

SleeveModule's ModuleConfig, in field order:

| Field | Value |
| --- | --- |
| usdg | USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 |
| tokenSource | tx 6 |
| calendar | tx 5 |
| swapRouter | SwapRouter02 0xCaf681a66D020601342297493863E78C959E5cb2 |
| usdgUsdFeed | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 |
| defaultKeeper | KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46 |
| disclosureHash | 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89, disclosure candidate 3 (D-014) |
| guardParams | stockFeedMaxAge 90,000 s, usdgFeedMaxAge 90,000 s, depegToleranceBps 50, multiplierWindow 86,400 s, equal to PriceGuard.defaultGuardParams() |
| grace | 3,600 s |

The encoded constructor arguments for these addresses are in Appendix A. contracts/script/DeployConfig.sol holds every value above; nothing is typed on the command line.

Order. The brief for this plan listed the timelock, the calendar, TokenSource, the libraries and then the module. Deploy.deploy() creates the timelock, the calendar, TokenSource and the module in that order, but forge links SleeveSell and the module against the libraries before the script body runs and sends the library deployments first, as the broadcaster's first transactions. No step depends on the order: the libraries hold no state and no constructor calls them.

Addresses. A library's CREATE2 address depends only on its creation code, so the dry run, the live simulation and the mainnet deploy give the same three. A change to any source file that goes into a library, a comment included, changes its metadata hash and so its address. The four contracts' addresses follow from DEPLOYER's nonce: the live simulation from DEPLOYER (section 7.3) printed exactly the addresses above. Anyone can put the same library code at the CREATE2 addresses first, which costs Sleeve nothing, but forge then skips those transactions, the timelock lands at nonce 0 and record_deployment.py stops because it expects seven transactions. Step 8.1 checks that the three addresses are still empty.

Runtime sizes against the 24,576-byte limit: SleeveTrade 19,534, SleeveSell 17,799, SleeveModule 16,610, SessionCalendarExtension 7,414, SleeveTimelock 6,720, SleeveBuy 6,099, TokenSource 3,511. The build: solc 0.8.28+commit.7893614a, optimizer on at 200 runs, EVM cancun, no via-IR, an ipfs metadata hash, as the record's compiler block lists.

What each constructor refuses, so a wrong value reverts the deploy instead of landing:

- SleeveTimelock: a delay outside 172,800 to 2,592,000 seconds, a non-zero admin, an empty proposer or executor list, a zero proposer or executor (D-018, D-019, audit A1-26).
- SessionCalendarExtension: a timelock without code.
- TokenSource: an address without code, USDG not at 6 decimals, a token not at 18, a feed not at 8, a token listed twice, a session type that does not match the feed, a ticker with a feed and no pool, a pool that is not the factory's canonical USDG pool for its fee, a fee other than 100, 500 or 3,000 (SPEC 3).
- SleeveModule: the checks of SPEC 5, among them TokenSource and the calendar answering to the same SleeveTimelock with MIN_DELAY_FLOOR 172,800 and a delay at or above it, the router's factory equal to TokenSource's, guard parameters equal to the defaults and a grace of 3,600 seconds.

## 3. Tickers and the pool allowlist

TokenSource lists the four launch tickers, each with session type ALL_DAY (B2-1), active, and the D-010 pools.

| Id | Ticker | Token | Feed, description | Pool | Fee | USDG in the pool, block 79,304,056 | Depth within 2 percent, D-010, block 78,323,256 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | SPY | 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C | 0x319724394D3A0e3669269846abE664Cd621f9f6A, RHSPY / USD | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 500 | 232,308.86 | 217,986 |
| 1 | QQQ | 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 | 0x80901d846d5D7B030F26B480776EE3b29374C2ae, Robinhood QQQ / USD | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 500 | 730,535.46 | 652,371 |
| 2 | NVDA | 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15, RHNVDA / USD | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 500 | 2,256,106.85 | 724,558 |
| 3 | AAPL | 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0, Robinhood AAPL / USD | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 500 | 151,300.83 | 177,114 |
| 3 | AAPL | | | 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed | 3,000 | 91,204.55 | 36,615 |

The other eight canonical USDG pools of these tokens stay off the allowlist, and the read-back checks each one reads as not allowed: SPY fee 100 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5 and fee 3,000 0xA43b424Bc609495AED4BCD88d654934b510B0aD9, QQQ fee 100 0x4539019B527211998642fEC342C85dcB44c7e5E4 and fee 3,000 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79, NVDA fee 100 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333, fee 3,000 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B and fee 10,000 0xc277560DF3689A401bA7deDd7626168b234Ceb5e, AAPL fee 10,000 0x3714aa8105DE1f384481B425788Af413748C1837. docs/research/pools.md has the reasons. The read-back also checks that no ticker lists another ticker's pool.

After the deploy only the timelock changes the allowlist, with 48 hours' notice: setPool adds a canonical pool or removes one, never an active ticker's last, and removeTicker is one way. No function adds a ticker (I10).

## 4. Timelock

- SleeveTimelock is OpenZeppelin 5.4's TimelockController with its delay held between MIN_DELAY_FLOOR, 172,800 seconds (48 hours), and MIN_DELAY_CEILING, 2,592,000 seconds (30 days).
- Constructor: minDelay 172,800, proposers [DEPLOYER], executors [DEPLOYER], admin 0x0. OpenZeppelin gives every proposer the canceller role as well, so DEPLOYER proposes, cancels and executes (D-009 Q33). DEFAULT_ADMIN_ROLE goes only to the timelock itself, so no account holds an admin role and any role change is itself a 48-hour operation.
- It administers TokenSource and SessionCalendarExtension and nothing else. The module has no admin. Its powers: remove a ticker, add or remove a canonical pool, append a calendar year, add closures and early closes, replace a future daylight-saving switch. None of them moves funds or touches a rule (I10).
- The read-back checks getMinDelay, the floor and the ceiling, the four role ids, that DEPLOYER holds the proposer, canceller and executor roles and not the admin role, that the timelock administers itself, that zero, KEEPER, the module, TokenSource and the calendar hold no role, that each role's admin is DEFAULT_ADMIN_ROLE, and the timelock's whole event history: exactly four RoleGranted (the admin role to the timelock, then proposer, canceller and executor to DEPLOYER), no RoleRevoked, no RoleAdminChanged and one MinDelayChange from 0 to 172,800. It also reads TokenSource.timelock() and the calendar's timelock(). That is the deploy-script item of audit A1-26.

## 5. The constants table on chain

`forge script script/ReadBack.s.sol --sig "constants()"` against the dry run's fork node at block 79,304,056, 3 October 2026 18:40:19 UTC, a Saturday. Every check passed. Deploy.run runs the same checks before it sends anything and ReadBack.run after. The code hashes are pinned in contracts/script/DeployChecks.sol; they were read at block 79,232,659 and matched again at 79,291,580, 79,296,234 and 79,304,056. The same check against the public RPC passed at block 79,299,051 in 37 seconds.

| Item | Address | Checked | Result |
| --- | --- | --- | --- |
| USDG | 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 | proxy code hash (170 bytes), decimals, symbol | 6, USDG |
| EntryPoint v0.7 | 0x0000000071727De22E5E9d8BAf0edAc6f37da032 | code hash (16,035 bytes) | match |
| Permit2 | 0x000000000022D473030F116dDEE9F6B43aC78BA3 | code hash (9,152 bytes) | match |
| ArbSys | 0x0000000000000000000000000000000000000064 | the precompile's placeholder code 0xfe | match |
| SwapRouter02 | 0xCaf681a66D020601342297493863E78C959E5cb2 | code hash (24,497 bytes), factory(), WETH9() | v3 factory, WETH 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 |
| Uniswap v3 factory | 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA | code hash (24,535 bytes) | match |
| QuoterV2 | 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 | code hash (8,273 bytes), factory() | v3 factory |
| Universal Router v2.1.2 | 0x204FAca1764B154221e35c0d20aBb3c525710498 | code hash (24,380 bytes) | match; M1, unused in M0 |
| Morpho Blue | 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010 | code hash (15,582 bytes) | match; M1, unused in M0 |
| SPY, QQQ, NVDA, AAPL tokens | section 3 | BeaconProxy code hash (283 bytes), decimals, symbol, ACCESS_CONTROLLED_REGISTRY() | 18, the expected symbol, registry 0xe10b6f6B275de231345c20D14Ab812db62151b00; paused and oraclePaused false on all four |
| SPY feed | 0x319724394D3A0e3669269846abE664Cd621f9f6A | EACAggregatorProxy code hash (9,571 bytes), decimals, description, latest answer above zero | 8, RHSPY / USD, round 154 of phase 1 (id 2^64 + 154): 770.71210575 at 2 October 12:30:38 UTC |
| QQQ feed | 0x80901d846d5D7B030F26B480776EE3b29374C2ae | same | 8, Robinhood QQQ / USD, round 401 of phase 1: 751.99912534 at 2 October 12:57:12 UTC |
| NVDA feed | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | same | 8, RHNVDA / USD, round 1162 of phase 1: 234.99711907 at 2 October 17:07:32 UTC |
| AAPL feed | 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 | same | 8, Robinhood AAPL / USD, round 700 of phase 1: 333.82386412 at 2 October 16:39:40 UTC |
| USDG/USD feed | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | same | 8, USDG / USD, round 121 of phase 1: 1.00013961 at 3 October 15:40:01 UTC |
| The five D-010 pools | section 3 | code, fee(), factory(), getPool(USDG, token, fee) equal to the pool, token0 and token1, in-range liquidity above zero | all five canonical, on their pairs, with liquidity |

Also checked by code hash: the Stock Token registry, WETH, the CREATE2 deployer, and the Kernel v3.1 implementation 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D, factory 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419, meta factory 0xd703aaE79538628d27099B8c4f621bE4CCd142d5, ECDSA validator 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57 and passkey validator 0.0.3 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69 (g6-notes).

The stock rounds were 25 to 30 hours old at this Saturday block. Feeds hold the last price while the market is closed (SPEC 2), and this check only needs a positive answer; the module's guard refuses a round over 25 hours old.

## 6. Gas and funding

From the dry run at block 79,304,056, priced by `script/gas_report.py` against the public RPC at live block 79,305,107, 18:42 UTC: gas price 23,344,000 wei, base fee 23,294,000 wei. Execution gas is the fork's receipt. The L1 gas is the live NodeInterface's `gasEstimateL1Component` for each transaction's exact calldata, at an L1 base fee estimate of 14,583,493 wei. The gas limit is the one forge set, 130 percent of its own simulation.

| Contract | Init code bytes | Execution gas | L1 gas | Total gas | Gas limit | ETH at the gas price |
| --- | --- | --- | --- | --- | --- | --- |
| SleeveBuy | 6,151 | 1,375,058 | 37,782 | 1,412,840 | 2,011,022 | 0.000032981 |
| SleeveTrade | 19,586 | 4,285,597 | 114,009 | 4,399,606 | 5,919,479 | 0.000102704 |
| SleeveSell | 17,851 | 3,910,250 | 101,043 | 4,011,293 | 5,718,740 | 0.000093640 |
| SleeveTimelock | 7,961 | 1,673,590 | 51,784 | 1,725,374 | 2,175,667 | 0.000040277 |
| SessionCalendarExtension | 7,976 | 1,823,550 | 53,201 | 1,876,751 | 2,370,615 | 0.000043811 |
| TokenSource | 7,022 | 1,616,073 | 45,777 | 1,661,850 | 2,100,894 | 0.000038794 |
| SleeveModule | 19,760 | 3,726,450 | 111,105 | 3,837,555 | 4,844,385 | 0.000089584 |
| Total | | 18,410,568 | 514,701 | 18,925,269 | 25,140,802 | 0.000441791 |

- The cost: 0.000442 ETH at today's price.
- forge's reservation: each transaction's gas limit times forge's fee cap, twice the base fee plus 1 wei, 0.001171 ETH in all and 0.000276 ETH for SleeveTrade, the largest. The account must cover the cap of the transaction in flight. The live simulation from DEPLOYER printed "Estimated amount required: 0.001179102185040771 ETH" at a cap of 0.046900001 gwei (section 7.3).
- The L1 component moves. The three dry runs read it at 0 gas (18:21 UTC, block 79,291,580, an L1 base fee estimate of 0), 102,362 gas (18:29, block 79,296,234, 2,898,072 wei) and 514,701 gas (18:42, block 79,304,056, 14,583,493 wei). The last is 2.6 to 3.1 percent of each transaction's execution gas, well inside forge's 30 percent margin. Step 8.1 reads it again.
- Funding: 0.0025 ETH, as docs/FUNDING.md asked. It covers forge's reservation twice and the cost 5.7 times, and a second full deploy if one were ever needed. FUNDING.md records fees rising about 40 times in the September congestion; at that level the deploy would cost about 0.018 ETH, so step 8.1 stops above 0.07 gwei, three times today's price.

The keeper's and the owner's gas per call is in docs/GAS.md.

## 7. Dry run evidence

### 7.1 Fork dry run at the latest block

`contracts/script/dry-run.sh` ran at 18:40 UTC on 3 October 2026. anvil forked https://robinhood.drpc.org at its latest block, 79,304,056, a Saturday with the market closed. Each step must pass for the next to run.

1. ReadBack `constants()` on the node: section 5.
2. Deploy.s.sol with `--broadcast --slow` to the node, from an ephemeral test sender 0x7E3Cecb5F4cd25A3C9C5A87E2a4446768B7255Ff made by `cast wallet new`. Its key sat in a mode 600 file, went to forge through a subshell variable loaded by shell substitution, the form of step 8.2, and was deleted on exit. Every in-script check passed, the nonce guard included, then seven transactions went out.
3. record_deployment.py wrote contracts/deployments/dry-run/4663-anvil-79304056.json after checking that each transaction's input is this checkout's creation code, libraries linked as the broadcast lists them, followed by the constructor arguments, and that each address follows from CREATE2 or the sender's nonce.
4. ReadBack.s.sol on the node: every check passed, including the role history from the node's logs.
5. DeploySmoke.t.sol on a fork of the node: a Kernel v3.1 account, 0xdBE312D2b99F815d0d426b2cACd6154B9c8Bb03C, created through the meta factory and KernelFactory with the ECDSA validator as root; the deployed module installed in the callData of its first UserOp; the product default rule (10 percent to SPY, 100 bps premium cap, 50 bps slippage, 25 USDG clip) set by a bracketed owner UserOp; 1,000 USDG paid from TEST_PAYER; the default keeper's split. Receipt 1: QUEUED, reason SESSION, usdgIn 1,000 USDG, usdgToSpend 900, usdgQueued 100, nothing bought, and the stored hash 0x2ca4c5132a7eb40743716d368068b0cf4f32b28b16a5c2aa8cca156a45a5e956 equal to keccak256 of the event's bytes. The smoke test etches the same ArbSys stand-in as every fork test, because forge cannot run the precompile.
6. gas_report.py: section 6, written to contracts/deployments/dry-run/4663-anvil-79304056.gas.json.
7. verify.py check: section 8.5, written to contracts/deployments/dry-run/4663-anvil-79304056.verify.json.

Two earlier runs, at blocks 79,291,580 and 79,296,234, passed every step the same way. The first ran before the nonce guard existed, both passed the test key inline as `--private-key "$(cat <file>)"` rather than through a variable, and only the L1 readings of section 6 differed. Their outputs are not kept.

### 7.2 Fork tests at the pinned blocks

contracts/test/fork/DeployScript.t.sol, 14 tests, all passing; the full suite outside the spike is 826 passed, 0 failed, 1 skipped (DeploySmoke, which needs the dry run's node).

- At 78,312,136, Friday 2 October 10:44 EDT, the script's deploy passes every check and the keeper's split fills on the real SPY pool: receipt 1, FILLED.
- At 73,280,794, Saturday 26 September, the same split queues with reason SESSION.
- run()'s guards: an existing record reverts AlreadyDeployed, another broadcaster BroadcasterNotDeployer, a nonce other than SLEEVE_DEPLOYER_NONCE DeployerNonceMismatch, another chain WrongChain, and then the run deploys and checks everything.
- The read-back names each mismatch it exists to catch: a missing pool, another keeper, a module bound to another TokenSource, a library link to another address, changed code, a role granted after the deploy, a swapped feed, other code at a constant address.
- `constants()` passes and prints at the pinned block.

```
cd /Users/mac/sleeve/contracts
FOUNDRY_OUT=out-deploy FOUNDRY_CACHE_PATH=cache-deploy forge test --match-path "test/fork/Deploy*.t.sol"
```

### 7.3 Live simulation from DEPLOYER

`forge script script/Deploy.s.sol --rpc-url https://robinhood.drpc.org --sender 0xe23e8C58371468A98206f07b571cF7E6194abBc1`, without `--broadcast` and without a key. At 18:37 UTC, with the final script, which also reads DEPLOYER's nonce on chain: every check passed against live state, the addresses of section 2 came out, and forge estimated 25,140,771 gas and "Estimated amount required: 0.001179102185040771 ETH" at a fee cap of 0.046900001 gwei. A run at 18:24 UTC, before the nonce check existed, gave the same addresses and gas.

## 8. The commands

Run from the contracts folder in one shell. DEPLOY_RPC is the Alchemy app's URL once it exists and dRPC's archive endpoint until then; the rate flags keep dRPC's free tier from refusing forge's reads. Never pass `--broadcast` anywhere but step 8.2.

```
cd /Users/mac/sleeve/contracts
export FOUNDRY_OUT=out-deploy FOUNDRY_CACHE_PATH=cache-deploy
export DEPLOYER=0xe23e8C58371468A98206f07b571cF7E6194abBc1
export DEPLOY_RPC=https://robinhood.drpc.org
export PUBLIC_RPC=https://rpc.mainnet.chain.robinhood.com
```

### 8.0 Before the day

1. The owner's go, DEPLOYER funded with 0.0025 ETH, and section 10 answered. The build contract makes a ready mainnet deploy a stop condition.
2. Every agent stopped. Nothing under contracts/src, contracts/script, contracts/lib, foundry.toml or remappings.txt changes between the dry run and the record.
3. The tooling committed. `git status --porcelain -- src script foundry.toml remappings.txt lib` prints nothing. Note `git rev-parse HEAD`; record_deployment.py writes it into the record.
4. Slither and aderyn rerun on that commit in the audit snapshot, as AUDIT_R1 S-03 requires, and the full suite green: `forge test --no-match-path "test/spike/*"`.

### 8.1 Pre-flight, read only, within the hour before 8.2

```
# 1. The whole rehearsal at the latest block: constants, deploy, record, read-back, smoke,
#    gas with today's L1 component, verification inputs. Ends with "== done".
script/dry-run.sh

# 2. The key file holds DEPLOYER's key. Prints the address only.
( set +x; DEPLOYER_KEY="$(cat ~/.sleeve-keys/deployer.key)"; cast wallet address --private-key "$DEPLOYER_KEY" )
#    expect 0xe23e8C58371468A98206f07b571cF7E6194abBc1

# 3. Funds, nonce and gas price.
cast balance "$DEPLOYER" --ether --rpc-url "$PUBLIC_RPC"   # at least 0.0013
cast nonce "$DEPLOYER" --rpc-url "$PUBLIC_RPC"             # 0
cast gas-price --rpc-url "$PUBLIC_RPC"                     # at most 70000000

# 4. The library addresses are still empty, and no record exists.
for a in 0xDF3e060D64086ec3309265Ce83B34813eE45F81A 0x3757964A25C94040e81a215Dd85B748f6bB9ca84 0xC0003635086E51aC0c19c40c193043D58d86c987; do
  cast codesize "$a" --rpc-url "$PUBLIC_RPC"               # 0 each
done
test ! -e deployments/4663.json && echo "no record yet"

# 5. The constants table on chain.
forge script script/ReadBack.s.sol --sig "constants()" --rpc-url "$DEPLOY_RPC" \
  --compute-units-per-second 50 --fork-retries 10 --fork-retry-backoff 3000
#    expect "Constants: every check passed"

# 6. The deploy simulated from DEPLOYER against live state: no key, no broadcast.
forge script script/Deploy.s.sol --rpc-url "$DEPLOY_RPC" --sender "$DEPLOYER" \
  --compute-units-per-second 50 --fork-retries 10 --fork-retry-backoff 3000
#    expect "every check passed on the simulated deployment", the addresses of section 2,
#    and "SIMULATION COMPLETE"
```

Stop on any other answer. If the gas report in step 1 shows an L1 component above a quarter of a transaction's execution gas, add `--gas-estimate-multiplier 200` to step 8.2.

### 8.2 Broadcast

This is the irreversible step.

```
( set +x
  DEPLOYER_KEY="$(cat ~/.sleeve-keys/deployer.key)"
  forge script script/Deploy.s.sol --rpc-url "$DEPLOY_RPC" --broadcast --slow \
    --private-key "$DEPLOYER_KEY" \
    --compute-units-per-second 50 --fork-retries 10 --fork-retry-backoff 3000 )
```

forge first runs the script against live state: every check of 8.1 steps 5 and 6, and that the key's address is DEPLOYER (BroadcasterNotDeployer) with nonce 0 on chain (DeployerNonceMismatch). Then it sends the seven transactions one at a time, each after the previous one is confirmed and succeeded. Expect "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL". forge writes broadcast/Deploy.s.sol/4663/run-latest.json, which .gitignore keeps as evidence, and the RPC URL to the cache folder's sensitive file.

The key is loaded from the file by shell substitution into a variable that lives only in the parenthesized subshell and is not exported; forge reads no environment variable for a raw key, so the variable goes to `--private-key`. The key never appears in the command text, the output, the broadcast file or the sensitive file, and `set +x` keeps a shell trace from printing it, but other processes of the same user can read forge's arguments while it runs. The dry run passed its test key the same way. To avoid the arguments, the owner can import the key once into a keystore with `cast wallet import sleeve-deployer --interactive`, typing it at the prompt, and replace the `--private-key` line with `--account sleeve-deployer --password-file ~/.sleeve-keys/deployer.password`.

### 8.3 Record

```
python3 script/record_deployment.py --broadcast broadcast/Deploy.s.sol/4663/run-latest.json \
  --out-dir out-deploy --record deployments/4663.json --network robinhood-mainnet
```

It refuses a pending or failed transaction, a broadcast for another chain or with other transactions than the seven, creation code that differs from this checkout's build, and an address that does not follow from CREATE2 or the nonce, and it never overwrites a record. contracts/deployments/4663.json then holds, per contract: the address, kind, artifact, how it was created (CREATE2 factory and salt, or nonce), the constructor signature and arguments decoded and encoded, the library links, the transaction hash, the block number and hash, the gas limit and gas used, gasUsedForL1 and l1BlockNumber from the Arbitrum receipt, the effective gas price and cost, and the runtime and init code sizes. It also holds the deployer, the commit and whether the tree was clean, the compiler settings, the library map and the totals. Deploy.s.sol cannot write this file itself: forge sends the transactions only after the script body returns, and foundry.toml gives scripts read access only.

### 8.4 Read back from chain

```
forge script script/ReadBack.s.sol --rpc-url "$DEPLOY_RPC" \
  --compute-units-per-second 50 --fork-retries 10 --fork-retry-backoff 3000
#    expect "ReadBack: every check passed" and the seven runtime sizes
forge script script/ReadBack.s.sol --rpc-url "$PUBLIC_RPC" --compute-units-per-second 20
#    the same through a second provider; wait and retry if Cloudflare challenges it
```

ReadBack reads the record, then checks the constants table, the code at all seven addresses against this checkout's build with the immutables masked and every library link compared, the timelock's delay, roles and event history, the calendar, every TokenSource ticker, feed, session type and pool, the excluded pools, and the module's immutables, guard limits, owner ranges and module type. It reverts with a named error on the first mismatch.

### 8.5 Verify

```
# Every command's input, compiled locally and compared with the chain: expect "exact" for every
# contract without --libraries, and "outside the metadata hash" for the two linked ones with it.
python3 script/verify.py check --record deployments/4663.json --rpc "$DEPLOY_RPC" \
  --report deployments/4663.verify.json

# The commands, with the record's addresses, transaction hashes and constructor arguments.
python3 script/verify.py commands --record deployments/4663.json
```

Run them in this order:

1. Sourcify, no key. Then confirm each address with `curl -sS "https://sourcify.dev/server/v2/contract/4663/<address>"`, which should show a `runtimeMatch` of `exact_match`, the metadata hash included. A `creationMatch` needs Sourcify to find the creation code, which for the libraries sits inside a call to the CREATE2 deployer.
2. Blockscout through its PRO API with `BLOCKSCOUT_API_KEY` set, a free key from dev.blockscout.com. Without a key, verify in a browser at https://robinhoodchain.blockscout.com/address/<address>, "Verify & publish", method "Solidity (Standard JSON input)", with the input file from `forge verify-contract <address> <artifact> --chain 4663 --show-standard-json-input` and the constructor arguments from the record. For SleeveSell and SleeveModule, if the explorer refuses that input, use the one printed with the `--libraries` flags of the fallback below. The explorer may also pick up Sourcify's result.
3. Etherscan's robin.etherscan.io, optional, with `ETHERSCAN_API_KEY` set.

The commands pass no `--libraries`. Forge's build links libraries after compiling, so the standard JSON input without them reproduces the deployed code byte for byte once the verifier fills the link placeholders from the chain, as Sourcify does. If a verifier refuses unlinked placeholders, `verify.py commands --libraries` prints the fallback for SleeveSell and SleeveModule. That build writes the libraries into the metadata, so it matches every byte except the metadata hash.

What `verify.py check` proved on the dry run's node: it ran every printed command for all four verifier entries with `--show-standard-json-input`, which makes forge parse the whole command and print the input it would send, found the inputs equal across verifiers, compiled them with solc 0.8.28+commit.7893614a, and compared the result with the node's code and with each creation transaction's input, constructor arguments included. Nine checks: seven exact without `--libraries`, and SleeveSell and SleeveModule outside the metadata hash with it. On a second fork deploy, copies of the record with one wrong value each failed the check: another default keeper in the module's constructor arguments ("SleeveModule: creation input differs at byte 19951"), another SleeveBuy address ("SleeveModule: runtime code differs at byte 4135") and 201 optimizer runs ("the standard JSON input sets optimizerRuns 200, the deploy's build 201").

The commands, with the predicted addresses; `verify.py commands` fills in the transaction hashes and prints the same lines from the record. Each line starts with `FOUNDRY_OUT=out-deploy FOUNDRY_CACHE_PATH=cache-deploy forge verify-contract`.

```
# Sourcify
0xDF3e060D64086ec3309265Ce83B34813eE45F81A src/libraries/SleeveBuy.sol:SleeveBuy --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 1> --watch
0x3757964A25C94040e81a215Dd85B748f6bB9ca84 src/libraries/SleeveTrade.sol:SleeveTrade --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 2> --watch
0xC0003635086E51aC0c19c40c193043D58d86c987 src/libraries/SleeveSell.sol:SleeveSell --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 3> --watch
0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D src/SleeveTimelock.sol:SleeveTimelock --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 4> --watch
0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D src/SessionCalendarExtension.sol:SessionCalendarExtension --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 5> --watch
0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F src/TokenSource.sol:TokenSource --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 6> --watch
0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9 src/SleeveModule.sol:SleeveModule --chain 4663 --compiler-version 0.8.28 --verifier sourcify --creation-transaction-hash <tx 7> --watch

# Blockscout PRO API; <args> are Appendix A's
0xDF3e060D64086ec3309265Ce83B34813eE45F81A src/libraries/SleeveBuy.sol:SleeveBuy --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --watch
0x3757964A25C94040e81a215Dd85B748f6bB9ca84 src/libraries/SleeveTrade.sol:SleeveTrade --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --watch
0xC0003635086E51aC0c19c40c193043D58d86c987 src/libraries/SleeveSell.sol:SleeveSell --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --watch
0x0088C481C56b7B2407C6a981BAc3da0CC0Fc5b2D src/SleeveTimelock.sol:SleeveTimelock --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --constructor-args <SleeveTimelock args> --watch
0xa7a3C55309E5FB2Fb61eeA6F6e2318CF927b247D src/SessionCalendarExtension.sol:SessionCalendarExtension --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --constructor-args <SessionCalendarExtension args> --watch
0x6643a2F99534c90a68E6eCE707c7bFA6D5b0975F src/TokenSource.sol:TokenSource --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --constructor-args <TokenSource args> --watch
0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9 src/SleeveModule.sol:SleeveModule --chain 4663 --compiler-version 0.8.28 --verifier blockscout --verifier-url 'https://api.blockscout.com/v2/api?chain_id=4663' --etherscan-api-key "$BLOCKSCOUT_API_KEY" --constructor-args <SleeveModule args> --watch

# Fallback with library links, for a verifier that refuses placeholders
0xC0003635086E51aC0c19c40c193043D58d86c987 src/libraries/SleeveSell.sol:SleeveSell ... --libraries src/libraries/SleeveTrade.sol:SleeveTrade:0x3757964A25C94040e81a215Dd85B748f6bB9ca84
0x15FA6775fCdB5904aA673967461dc1fA3c6E7Ac9 src/SleeveModule.sol:SleeveModule ... --libraries src/libraries/SleeveBuy.sol:SleeveBuy:0xDF3e060D64086ec3309265Ce83B34813eE45F81A --libraries src/libraries/SleeveSell.sol:SleeveSell:0xC0003635086E51aC0c19c40c193043D58d86c987 --libraries src/libraries/SleeveTrade.sol:SleeveTrade:0x3757964A25C94040e81a215Dd85B748f6bB9ca84
```

The explorer's own API, `--verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/`, is the command docs.robinhood.com gives; `verify.py commands --verifier blockscout-instance` prints it. On 3 October it answered curl and forge with a Cloudflare challenge (section 11), so it works only if that changes.

### 8.6 After

1. The orchestrator commits contracts/deployments/4663.json, contracts/deployments/4663.verify.json and contracts/broadcast/Deploy.s.sol/4663/run-latest.json, and records the deploy in docs/GATES.md and docs/PROGRESS.md with the date, the blocks and the read-back result.
2. packages/core, the keeper, the app and the verifier take their addresses from the record.
3. The first live account and split follow the live test plan (docs/FUNDING.md, TEST_PAYER), not this one.
4. AUDIT_R1's A1-26 row can move to done.

### 8.7 If something fails

- A check fails in 8.1 or at the start of 8.2: nothing was sent. Read the named error, fix the cause, start again at 8.1.
- The broadcast stops part way, from an RPC error, a timeout or a lack of funds: some transactions landed. Do not start a new run, which Deploy.run refuses anyway with DeployerNonceMismatch because DEPLOYER's nonce is no longer 0. Fund DEPLOYER if needed and finish the same run, which sends only what is left of broadcast/Deploy.s.sol/4663/run-latest.json and does not run the script again:

```
( set +x
  DEPLOYER_KEY="$(cat ~/.sleeve-keys/deployer.key)"
  forge script script/Deploy.s.sol --rpc-url "$DEPLOY_RPC" --resume --slow \
    --private-key "$DEPLOYER_KEY" \
    --compute-units-per-second 50 --fork-retries 10 --fork-retry-backoff 3000 )
```

- A transaction is mined but reverts: `--slow` stops forge there. Stop and report. The later transactions need the earlier ones, so neither `--resume` nor a new run is safe without a decision.
- Someone deploys the libraries first: forge sends four transactions, the addresses move down three nonces, and record_deployment.py stops. Stop and report; the record script needs to accept libraries it did not deploy.

## 9. What is irreversible

- The seven transactions and the ETH they cost, and DEPLOYER's nonces 0 to 6.
- SleeveModule is immutable and not upgradeable. USDG, TokenSource, the calendar, SwapRouter02, the USDG/USD feed, the default keeper, the disclosure hash, the guard limits (25 hours, 25 hours, 50 bps, 24 hours) and the 3,600-second grace are constructor values with no setter, and the three library addresses are part of its code. The pending owner decisions of section 10 are code in it too. Changing any of them means a new module that every account installs; lots stay in the module that bought them (audit A1-28).
- TokenSource is bound for good to this timelock, USDG and the v3 factory. Its four ticker ids, tokens, feeds and session types never change, no ticker can be added, and a removal is final. Only the pool lists can change, through the timelock.
- SessionCalendarExtension is bound to this timelock. Its writes add years, closures and early closes and replace future switches; a wrong closure cannot be removed (D-017).
- SleeveTimelock has no admin. DEPLOYER's roles change only through the timelock's own 48-hour operation, and its delay never goes under 48 hours or over 30 days. If the DEPLOYER key is lost, the allowlist and the calendar freeze for good; no funds are affected, and 2028 cannot be appended (D-017).
- The module checks at construction that TokenSource and the calendar share this timelock (A1-26), so the admin set is fixed for this module.
- The libraries' CREATE2 addresses are permanent, and anyone can deploy the same code at them on any chain with the deployer.
- Verification publishes the full source of the seven contracts, with every file they import.
- contracts/deployments/4663.json: record_deployment.py never overwrites it and Deploy.run refuses to run while it exists.

Nothing else can be undone later: a mistake found after the deploy is fixed by a new deploy and new installs, which is why every check runs before the broadcast.

## 10. Open before the go

For the owner:

1. The go. The build contract makes a ready mainnet deploy a stop condition.
2. 0.0025 ETH to DEPLOYER (docs/FUNDING.md). It holds 0 ETH now.
3. Decisions that become code in the immutable module: overrideCapBps widening the sale cap without overrideClosed (B2-14, D-027); both caps at zero for a sell without a rule (D-027); I1 as a delta (D-026, A1-01); the per-account lock in place of ReentrancyGuardTransient (D-026, A1-21); PoolNotAllowed as a revert where PRD 7.4 reads REFUSED_TICKER (A1-17); whether an ACTIVE rule may invest nothing (A1-14); merging a split's equity with its bucket (A1-15); the disclosure text whose hash the module carries (D-014). Answering after the deploy means a second module.
4. Optional keys for verification: `BLOCKSCOUT_API_KEY` from dev.blockscout.com for the explorer through Blockscout's PRO API, and `ETHERSCAN_API_KEY` for robin.etherscan.io. Without them Sourcify verifies, and the Blockscout explorer takes the standard JSON input in a browser.
5. Optional: the Alchemy app's URL for DEPLOY_RPC. The dRPC endpoint and the public RPC both worked for the read-only steps.

For the orchestrator: commit the tooling and this plan, rerun static analysis and the suite (8.0), and keep agents off contracts/ until the record is committed.

## 11. Explorer and verification APIs

Checked on 3 October 2026 between 18:01 and 18:12 UTC.

| Service | URL | From scripts | Key | Use |
| --- | --- | --- | --- | --- |
| Blockscout explorer, the official one | https://robinhoodchain.blockscout.com, APIs at /api/ and /api/v2/ | No. HTTP 403 with `cf-mitigated: challenge` to curl, and a Cloudflare managed challenge page to `forge verify-check` | none | browser verification; the target of Robinhood's docs command |
| Blockscout PRO API | https://api.blockscout.com/v2/api?chain_id=4663 | Yes. forge got HTTP 402 "Proceed with API key or make a X402 payment to continue" | free key from dev.blockscout.com | `--verifier blockscout` with `--etherscan-api-key` |
| Sourcify | https://sourcify.dev/server | Yes. `/server/chains` lists 4663 as supported with trace-capable RPCs, and v2 lookups answer, for example the SPY feed proxy as `exact_match` | none | `--verifier sourcify` |
| Etherscan v2, robin.etherscan.io | https://api.etherscan.io/v2/api?chainid=4663 | Yes. forge got "Invalid API Key" with a dummy key. forge has no built-in URL for 4663, so the command passes `--verifier-url` | Etherscan key | optional |

Sources: docs.robinhood.com/chain/deploy-smart-contracts gives the mainnet verify command with `--verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/` and the explorer robinhoodchain.blockscout.com. Blockscout's chain registry, https://chains.blockscout.com/api/chains, lists chain 4663 "Robinhood Chain" with that explorer, hosted by Blockscout. docs.blockscout.com/devs/verification/foundry-verification gives the PRO API URL form and the free key. Etherscan's https://api.etherscan.io/v2/chainlist lists chain 4663 with explorer https://robin.etherscan.io/, whose site also answers scripts with a Cloudflare challenge. A third-party guide (smithii.io) says Etherscan v2 does not support 4663; Etherscan's own chain list now says it does. 4663scan.io is a third-party explorer and not used.

## Appendix A. Encoded constructor arguments

For the addresses of section 2, taken from the live simulation's transactions (section 7.3); the creation code before them equals this checkout's build. After the deploy, contracts/deployments/4663.json holds the actual ones.

SleeveTimelock, `constructor(uint256,address[],address[],address)`:

```
0x000000000000000000000000000000000000000000000000000000000002a300000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e23e8c58371468a98206f07b571cf7e6194abbc10000000000000000000000000000000000000000000000000000000000000001000000000000000000000000e23e8c58371468a98206f07b571cf7e6194abbc1
```

SessionCalendarExtension, `constructor(address)`:

```
0x0000000000000000000000000088c481c56b7b2407c6a981bac3da0cc0fc5b2d
```

TokenSource, `constructor(address,address,address,(address,address,uint8,address[])[])`:

```
0x0000000000000000000000000088c481c56b7b2407c6a981bac3da0cc0fc5b2d0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d1680000000000000000000000001f7d7550b1b028f7571e69a784071f0205fd2efa0000000000000000000000000000000000000000000000000000000000000080000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000140000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002c0000000000000000000000000117cc2133c37b721f49de2a7a74833232b3b4c0c000000000000000000000000319724394d3a0e3669269846abe664cd621f9f6a000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000a7bb1ac63bbab0c44316e6c8c455213441689167000000000000000000000000d5f3879160bc7c32ebb4dc785f8a4f505888de6800000000000000000000000080901d846d5d7b030f26b480776ee3b29374c2ae000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000d60a5d14db690b7afad71f76b108071d7175597d000000000000000000000000d0601ce157db5bdc3162bbac2a2c8af5320d9eec000000000000000000000000379ec4f7c378f34a1b47e4f3cbebcbac3e8e9f15000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000001000000000000000000000000d4eb21209c4d6093f80b5b84f5c45cc093ea14a3000000000000000000000000af3d76f1834a1d425780943c99ea8a608f8a93f90000000000000000000000006b22a786baa607d76728168703a39ea9c99f2cd0000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000002000000000000000000000000aae0d815ee56e4092a5e5c2911e676fea50b2d6d000000000000000000000000783c9bbb765047cfdd2b84b92b2ca9f11d34b7ed
```

SleeveModule, `constructor((address,address,address,address,address,address,bytes32,(uint256,uint256,uint16,uint256),uint256))`:

```
0x0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d1680000000000000000000000006643a2f99534c90a68e6ece707c7bfa6d5b0975f000000000000000000000000a7a3c55309e5fb2fb61eea6f6e2318cf927b247d000000000000000000000000caf681a66d020601342297493863e78c959e5cb200000000000000000000000061b7e5650328764b076a108eff5fa7282a1b9ad20000000000000000000000008649275ca7ce63d2f9e6487570ec0dce14b6bf468408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e890000000000000000000000000000000000000000000000000000000000015f900000000000000000000000000000000000000000000000000000000000015f90000000000000000000000000000000000000000000000000000000000000003200000000000000000000000000000000000000000000000000000000000151800000000000000000000000000000000000000000000000000000000000000e10
```

## Appendix B. Files

| File | What it is |
| --- | --- |
| contracts/script/Deploy.s.sol | the deploy: guards, the four contracts, the checks on the simulated deployment |
| contracts/script/DeployConfig.sol | every value the deploy writes and every outside address it checks |
| contracts/script/DeployChecks.sol | the checks Deploy.s.sol, ReadBack.s.sol and the tests share, with the pinned code hashes |
| contracts/script/ReadBack.s.sol | the read-back of a record from chain, and `constants()` |
| contracts/script/record_deployment.py | writes deployments/4663.json from forge's broadcast file |
| contracts/script/gas_report.py | prices a dry run at the live gas price with the live L1 component |
| contracts/script/verify.py | prints the verification commands and checks their inputs against a chain |
| contracts/script/dry-run.sh | the fork rehearsal of steps 8.2 to 8.5 |
| contracts/test/fork/DeployForkBase.t.sol, DeployScript.t.sol, DeploySmoke.t.sol | the pinned-block tests and the smoke test |
| contracts/deployments/dry-run/4663-anvil-79304056.json, .gas.json, .verify.json | the dry run's record, gas report and verification check |
