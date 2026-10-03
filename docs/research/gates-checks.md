# Gate checks, 3 October 2026

Raw evidence behind docs/GATES.md for gates G1, G2, G3, G4, G5, G7 and G8. Every call here is read only. No transaction was signed or sent, no key was loaded and nothing was spent. Times are UTC on 3 October 2026.

| Item | Value |
| --- | --- |
| Public RPC | https://rpc.mainnet.chain.robinhood.com. One request at a time with 1 to 2 second pauses. One address and one topic per `eth_getLogs` call. |
| Archive RPC | https://robinhood.drpc.org. One request at a time with 0.4 to 0.5 second pauses. Its free plan answers `eth_getLogs` over more than 10,000 blocks with "ranges over 10000 blocks are not supported on free plan", so every log query ran on the public RPC. |
| G1 log scan | Blocks 286 to 78,652,671. 78,652,671 was the public RPC's latest block at 00:15:53Z. |
| G1 market state | Block 78,653,690, 2026-10-03T00:17:33Z, hash 0x93da8440b1e9a7b1d7a0dfd699a5a06865479e9bed563319c1f8cd65e01277a7. |
| Block for G3, G4, G5, G7 and G8 | 78,660,590, 2026-10-03T00:29:09Z, hash 0xbb4b4e0b8c52c5f9268eb0af5b5e386b0b4c9a776ed87e1a3642c337fa929bd4, header l1BlockNumber 26,108,225, ArbSys `arbBlockNumber()` 78,660,590. That is Friday 2 October 20:29 New York time, after the 20:00 close, so the stock feeds hold Friday prices. |
| Tools | cast 1.7.1, curl, jq, Python 3.11.7 with eth_abi and pycryptodome. |

## 1. G1 Morpho Blue markets

### 1.1 Deploy block

```
$ cast codesize --rpc-url https://robinhood.drpc.org --block 285 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
0
$ cast codesize --rpc-url https://robinhood.drpc.org --block 286 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
15582
$ cast block 286 --rpc-url https://rpc.mainnet.chain.robinhood.com --json | jq -c '{number, timestamp, hash, transactions}'
{"number":"0x11e","timestamp":"0x6a019968","hash":"0x5511b56f67b198c46ba010c9521096446769bd683e2e9a50f435489a04979c45","transactions":["0x01654f131729b3451e0dbfc5d51d4f9a41488f92ff2086084744072251800b8c","0xe1927e1ab342ba2ce16b2e2796745741fac71fc7db70011f9710a45b64f74d20"]}
$ cast receipt 0xe1927e1ab342ba2ce16b2e2796745741fac71fc7db70011f9710a45b64f74d20 --rpc-url https://rpc.mainnet.chain.robinhood.com --json
```

Block 286 is 2026-05-11T08:55:04Z. Its first transaction, 0x01654f131729b3451e0dbfc5d51d4f9a41488f92ff2086084744072251800b8c, is sent from and to 0x00000000000000000000000000000000000a4b05 and has no logs (`cast receipt` on the public RPC). Its second transaction, 0xe1927e1ab342ba2ce16b2e2796745741fac71fc7db70011f9710a45b64f74d20, is a contract creation sent by 0x88337ed70b82994ccda1426f961e69a3b68f5026 (status 1, created contract 0x23c879a3bb8e8ca1f155f14b9f34b8bdbbe34e37). Its receipt holds the first events Morpho Blue emitted, in this order: `SetOwner` (topic 0x167d3e9c1016ab80e58802ca9da10ce5c6a0f4debc46a2e7a2cd9e56899a4fb5) naming 0xc67335d90eb297407f998bfb75dbaac8bebddd2b, `EnableIrm` (topic 0x590e04cdebeccba40f566186b9746ad295a4cd358ea4fefaaea6ce79630d96c0) for 0x0 and for 0x2bd3d5965b26b51814ac95127b2b80dd6ccc0fa1, nine `EnableLltv` (topic 0x297b80e7a896fad470c630f6575072d609bde997260ff3db851939405ec29139), and a last `SetOwner` naming 0x060595638692de6ccd47ca04094f1772d3d39728, the `owner()` recorded in docs/research/chain-constants.md section 2. Sourcify's record of the contract also gives deploy block 286 (chain-constants.md Appendix A.7). The scan starts there.

### 1.2 CreateMarket scan

```
RPC=https://rpc.mainnet.chain.robinhood.com
MORPHO=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
TOPIC=$(cast sig-event 'CreateMarket(bytes32 indexed id, (address,address,address,address,uint256) marketParams)')
# TOPIC = 0xac4b2400f169220b0c0afdde7a0b32e775ba727ea1cb30b35f935cdaab8683ac
END=$(cast block-number --rpc-url $RPC)   # 78652671 at 00:15:53Z
for from in 286 10000286 20000286 30000286 40000286 50000286 60000286 70000286; do
  to=$((from + 9999999)); [ $to -gt $END ] && to=$END
  cast logs --rpc-url $RPC --address $MORPHO --from-block $from --to-block $to $TOPIC --json > createmarket_$from.json
  echo "$from..$to -> $(jq length createmarket_$from.json) logs"
  sleep 2
done
```

Output:

```
286..10000285 -> 21 logs
10000286..20000285 -> 21 logs
20000286..30000285 -> 29 logs
30000286..40000285 -> 23 logs
40000286..50000285 -> 37 logs
50000286..60000285 -> 84 logs
60000286..70000285 -> 60 logs
70000286..78652671 -> 30 logs
```

305 logs. The public RPC allows 10,000,000 blocks per request with one address and one topic (chain-constants.md section 8), so each window is one request. The logs come from this one provider. Each decoded market was then confirmed through `idToMarketParams` on two providers (section 1.4).

### 1.3 Decode and filter

`decode_g1.py`, run in the folder that holds the window files. It checks that keccak256 of each log's 160 data bytes equals the indexed market id, which is how Morpho Blue derives the id, so the decoded `(loanToken, collateralToken, oracle, irm, lltv)` is the exact tuple Morpho hashed.

```python
import glob
import json
from collections import Counter

from Crypto.Hash import keccak

USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
TICKERS = {
    "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": "SPY",
    "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": "QQQ",
    "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "NVDA",
    "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL",
}


def keccak256(data: bytes) -> str:
    h = keccak.new(digest_bits=256)
    h.update(data)
    return "0x" + h.hexdigest()


logs = []
for path in sorted(glob.glob("createmarket_*.json"), key=lambda p: int(p.split("_")[1].split(".")[0])):
    logs.extend(json.load(open(path)))

markets = []
for log in logs:
    data = bytes.fromhex(log["data"][2:])
    assert len(data) == 160, len(data)
    words = [data[i : i + 32] for i in range(0, 160, 32)]
    params = {
        "loanToken": "0x" + words[0][12:].hex(),
        "collateralToken": "0x" + words[1][12:].hex(),
        "oracle": "0x" + words[2][12:].hex(),
        "irm": "0x" + words[3][12:].hex(),
        "lltv": int.from_bytes(words[4], "big"),
    }
    market_id = log["topics"][1]
    assert keccak256(data) == market_id, (market_id, keccak256(data))
    markets.append(
        {
            "id": market_id,
            "block": int(log["blockNumber"], 16),
            "tx": log["transactionHash"],
            **params,
        }
    )

ids = [m["id"] for m in markets]
assert len(ids) == len(set(ids))
print("CreateMarket logs:", len(markets), "unique ids:", len(set(ids)))
print("first block", min(m["block"] for m in markets), "last block", max(m["block"] for m in markets))

json.dump(markets, open("g1_markets.json", "w"), indent=1)

touch = [m for m in markets if m["loanToken"] in TICKERS or m["collateralToken"] in TICKERS]
print("markets touching SPY/QQQ/NVDA/AAPL as loan or collateral:", len(touch))
for m in touch:
    loan = TICKERS.get(m["loanToken"], "USDG" if m["loanToken"] == USDG else m["loanToken"])
    coll = TICKERS.get(m["collateralToken"], "USDG" if m["collateralToken"] == USDG else m["collateralToken"])
    print(f'{m["id"]} block {m["block"]} loan {loan} collateral {coll} oracle {m["oracle"]} irm {m["irm"]} lltv {m["lltv"]}')

target = [m for m in markets if m["loanToken"] == USDG and m["collateralToken"] in TICKERS]
print("TARGET (loan USDG, collateral launch ticker):", len(target))
for m in target:
    print(json.dumps(m))

usdg_any = [m for m in markets if USDG in (m["loanToken"], m["collateralToken"])]
print("markets with USDG on either side:", len(usdg_any))
print("loan tokens, top 10:", Counter(m["loanToken"] for m in markets).most_common(10))
print("irms:", Counter(m["irm"] for m in markets).most_common())
print("lltvs:", Counter(m["lltv"] for m in markets).most_common())
```

Its output without the per-market rows:

```
CreateMarket logs: 305 unique ids: 305
first block 287 last block 78294333
markets touching SPY/QQQ/NVDA/AAPL as loan or collateral: 62
TARGET (loan USDG, collateral launch ticker): 47
markets with USDG on either side: 268
loan tokens, top 10: [('0x5fc5360d0400a0fd4f2af552add042d716f1d168', 255), ('0x0bd7d308f8e1639fab988df18a8011f41eacad73', 13), ('0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea', 8), ('0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec', 6), ('0x117cc2133c37b721f49de2a7a74833232b3b4c0c', 6), ('0x67240805b8477a514c3f9707f20fc05f34145505', 5), ('0xab7c5de616fe66ce2ca8592889a0deb992b8b7d3', 3), ('0x322f0929c4625ed5bad873c95208d54e1c003b2d', 2), ('0x0000000000000000000000000000000000000000', 1), ('0x0dd4364136cf704479d8509795730b5d16f24e5c', 1)]
irms: [('0x2bd3d5965b26b51814ac95127b2b80dd6ccc0fa1', 302), ('0x0000000000000000000000000000000000000000', 3)]
lltvs: [(625000000000000000, 143), (385000000000000000, 72), (770000000000000000, 36), (860000000000000000, 32), (915000000000000000, 17), (0, 2), (980000000000000000, 1), (945000000000000000, 1), (965000000000000000, 1)]
```

The 62 markets that touch a launch Stock Token are 47 with USDG as loan token (the gate's question), 8 with the Stock Token as loan token and USDG as collateral (section 1.6), 2 with WETH as loan token and SPY or NVDA as collateral, and 5 with SPY as loan token whose collateral and oracle are the same unidentified contract. 255 of the 305 markets have USDG as loan token. All 47 target markets use the IRM 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1, a verified `AdaptiveCurveIrm` (chain-constants.md Appendix A.7).

### 1.4 Market state at block 78,653,690

`g1_supply.py` reads `market(bytes32)` and `idToMarketParams(bytes32)` for the 47 target markets and the 8 reverse markets in two Multicall3 `aggregate3` calls, so the RPC sees two requests. It asserts that `idToMarketParams` equals the decoded log tuple for every market.

```python
import json
import sys
import time
import urllib.request

from eth_abi import decode, encode

RPC = "https://rpc.mainnet.chain.robinhood.com"
MORPHO = "0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010"
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168"
TICKERS = {
    "0x117cc2133c37b721f49de2a7a74833232b3b4c0c": "SPY",
    "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68": "QQQ",
    "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec": "NVDA",
    "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9": "AAPL",
}
MARKET_SELECTOR = bytes.fromhex("5c60e39a")  # market(bytes32)
PARAMS_SELECTOR = bytes.fromhex("2c3c9157")  # idToMarketParams(bytes32)
AGGREGATE3 = bytes.fromhex("82ad56cb")  # aggregate3((address,bool,bytes)[])


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(RPC, data=body, headers={"content-type": "application/json", "user-agent": "curl/8"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        out = json.load(resp)
    if "error" in out:
        raise RuntimeError(out["error"])
    return out["result"]


def multicall(calls, block_hex):
    data = AGGREGATE3 + encode(["(address,bool,bytes)[]"], [[(MORPHO, False, c) for c in calls]])
    raw = rpc("eth_call", [{"to": MULTICALL3, "data": "0x" + data.hex()}, block_hex])
    (results,) = decode(["(bool,bytes)[]"], bytes.fromhex(raw[2:]))
    return results


markets = json.load(open("g1_markets.json"))
target = [m for m in markets if m["loanToken"] == USDG and m["collateralToken"] in TICKERS]
reverse = [m for m in markets if m["collateralToken"] == USDG and m["loanToken"] in TICKERS]
rows = target + reverse

block = int(sys.argv[1])
block_hex = hex(block)

market_calls = [MARKET_SELECTOR + bytes.fromhex(m["id"][2:]) for m in rows]
market_results = multicall(market_calls, block_hex)
time.sleep(2)
param_calls = [PARAMS_SELECTOR + bytes.fromhex(m["id"][2:]) for m in rows]
param_results = multicall(param_calls, block_hex)

out = []
for m, (ok_m, ret_m), (ok_p, ret_p) in zip(rows, market_results, param_results):
    assert ok_m and ok_p
    tsa, tss, tba, tbs, last, fee = decode(["uint128"] * 6, ret_m)
    loan, coll, oracle, irm, lltv = decode(["address", "address", "address", "address", "uint256"], ret_p)
    assert loan.lower() == m["loanToken"] and coll.lower() == m["collateralToken"]
    assert oracle.lower() == m["oracle"] and irm.lower() == m["irm"] and lltv == m["lltv"]
    out.append(
        {
            **m,
            "side": "USDG loan" if m in target else "reverse",
            "totalSupplyAssets": tsa,
            "totalSupplyShares": tss,
            "totalBorrowAssets": tba,
            "totalBorrowShares": tbs,
            "lastUpdate": last,
            "fee": fee,
        }
    )

json.dump({"block": block, "markets": out}, open(f"g1_supply_{block}.json", "w"), indent=1)
for r in out:
    name_loan = "USDG" if r["loanToken"] == USDG else TICKERS[r["loanToken"]]
    name_coll = "USDG" if r["collateralToken"] == USDG else TICKERS[r["collateralToken"]]
    print(
        r["side"],
        r["id"],
        "loan",
        name_loan,
        "coll",
        name_coll,
        "lltv",
        r["lltv"],
        "supplyAssets",
        r["totalSupplyAssets"],
        "borrowAssets",
        r["totalBorrowAssets"],
        "lastUpdate",
        r["lastUpdate"],
    )
```

```
$ B=$(cast block-number --rpc-url https://rpc.mainnet.chain.robinhood.com)   # 78653690 at 00:17:35Z
$ python3 g1_supply.py $B
```

The same script with `RPC` set to https://robinhood.drpc.org, run for block 78653690, returned identical values for all 55 markets in all six `market()` fields and all five `idToMarketParams()` fields.

Spot checks in the PRD's command form, through the archive RPC so anyone can rerun them at this block:

```
ARC=https://robinhood.drpc.org; M=0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010
for id in 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45 0x50bc39b5722fb5634c436d74c6787f3c125b879e7b73cf9e9ecc01bbb57b8e55 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc; do
  echo "== $id"
  cast call --rpc-url $ARC --block 78653690 $M 'market(bytes32)(uint128,uint128,uint128,uint128,uint128,uint128)' $id | awk '{print $1}' | tr '\n' ' '; echo; sleep 0.5
  cast call --rpc-url $ARC --block 78653690 $M 'idToMarketParams(bytes32)(address,address,address,address,uint256)' $id | awk '{print $1}' | tr '\n' ' '; echo; sleep 0.5
done
```

```
== 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e
623355491337 621571719005195024 613930491337 611978497939891963 1790963757 0
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0xED29D310cfa91778A5850538DA28ed42234Cb78c 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1 625000000000000000
== 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45
197198740295 196865396114507711 197174571120 196784538696361361 1790963042 0
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 0xD625d488D552775D2867194C618B945E5dDfE097 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1 625000000000000000
== 0x50bc39b5722fb5634c436d74c6787f3c125b879e7b73cf9e9ecc01bbb57b8e55
11228949922 11227402817379136 4742724727 4741797255677079 1790929495 0
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 0xe8dAb19184f72b5a5a9d51A6C50A1b04b0669ce7 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1 625000000000000000
== 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc
6578772161 3288760945026825 31313085 31302025260868 1790707454 0
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC 0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a 0x2BD3d5965B26B51814AC95127b2b80dD6CcC0fa1 625000000000000000
```

The six `market()` fields are totalSupplyAssets, totalSupplyShares, totalBorrowAssets, totalBorrowShares, lastUpdate and fee. They are the totals stored at `lastUpdate`. Interest accrued since then is added at the market's next interaction, so a live supply can be slightly higher than these figures.

### 1.5 The 47 markets with USDG as loan token

Raw values at block 78,653,690. USDG amounts are in base units (6 decimals), `lltv` in 1e18 units, `lastUpdate` in Unix seconds. The row numbers match docs/GATES.md.

| # | Collateral | Market id | Created at block | lltv | Oracle | totalSupplyAssets | totalSupplyShares | totalBorrowAssets | totalBorrowShares | lastUpdate | fee |
| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| 1 | SPY | 0xc000f9a159a0701664cbebb99dc746f8c456e92fc720e797bd445124704c009d | 10874082 | 770000000000000000 | 0xeb3a281fd7d4a375f3332805c02b2c84cc2dbec1 | 0 | 0 | 0 | 0 | 1784667642 | 0 |
| 2 | SPY | 0x50bc39b5722fb5634c436d74c6787f3c125b879e7b73cf9e9ecc01bbb57b8e55 | 18584009 | 625000000000000000 | 0xe8dab19184f72b5a5a9d51a6c50a1b04b0669ce7 | 11228949922 | 11227402817379136 | 4742724727 | 4741797255677079 | 1790929495 | 0 |
| 3 | SPY | 0xe4f745e6620e169ee2664111e61e448d2e0d58ea0129fd5fb0db940f5e0f801b | 22808538 | 860000000000000000 | 0xc5b5e605bf6c8a1371e0cb0e348a0dfde9e0c889 | 1000 | 1000000000 | 0 | 0 | 1785365908 | 0 |
| 4 | SPY | 0xc78a7b86f102a8a5ead69355beecaa20f726de9530c6fe193429bd4ee29300f6 | 24443593 | 860000000000000000 | 0xacb27de3bd18fe20ce36fa498c142f4f354338b9 | 1 | 999227 | 0 | 0 | 1787861412 | 0 |
| 5 | SPY | 0xc40e93b78f25c887d184c4f5c8797db157752f79948a6a51d747147a22531e9b | 32350226 | 625000000000000000 | 0xe22f21ec30d5725446c3b6f645e3e46fcb4ba526 | 0 | 0 | 0 | 0 | 1786319986 | 0 |
| 6 | SPY | 0x90b439eeec826e243629556331f016ad85cb3addf558c0bff76f3a52b3266545 | 40894255 | 770000000000000000 | 0x11de06b53f9b976e21384e9b374086aec7b7e585 | 0 | 0 | 0 | 0 | 1787176137 | 0 |
| 7 | SPY | 0x077088f9ae5f5c1d35439ee68f4bdbb176368a1a73fd4c8cb8e004143d0c5c30 | 45975493 | 770000000000000000 | 0x3697e6e149b8f080a753d3f624600a3a3c9cc72c | 33334276 | 33333329500000 | 942 | 941970391 | 1788077256 | 0 |
| 8 | SPY | 0x34e22aabcc39112dafb870cd7626a3d7f6ebdfbb3436eba34c23e4f26604b783 | 53344334 | 625000000000000000 | 0xa6aaebae5833776dad374dbb4a3cabb9f2a39c22 | 0 | 0 | 0 | 0 | 1789548427 | 0 |
| 9 | SPY | 0xf95832e36d9d8baf35eb78ce80cbed92d20198ba639659b3f9a2ab00ced0a0c1 | 54454039 | 625000000000000000 | 0x1bb6b9792e9852cb7bfeb14a5951394d07817b7d | 0 | 0 | 0 | 0 | 1788544007 | 0 |
| 10 | SPY | 0x1c20e013bc6bf7e356a3b7fe0ed8a92deecce8e56680900d32e466a86f356b15 | 62365785 | 625000000000000000 | 0xc53793f920182835532bc7e69eaab0ed455d0558 | 0 | 0 | 0 | 0 | 1789344029 | 0 |
| 11 | SPY | 0x9c54e02182f7d53d062675674bdab30aa01bf8e4616838ee8fc2f6acccb05401 | 65231746 | 625000000000000000 | 0x9c3c7a4d4107c73de1e2741b909fba066b76e3da | 0 | 0 | 0 | 0 | 1789634501 | 0 |
| 12 | QQQ | 0x3d487a03ed905fd38ccd80ada05730f3ea7745e7dd51c08fdeb4bb0f45c3c0cb | 10874090 | 770000000000000000 | 0xc2eedbe68687c5e45ea9532a0d5516f2ec78e3b6 | 0 | 0 | 0 | 0 | 1784667643 | 0 |
| 13 | QQQ | 0x315b99abb698487891243a84afd28a5ff56fe02143f203c03edd3f103936bf60 | 18584385 | 625000000000000000 | 0x6126e6aec4139c660ab0e467ff392c125e3fdf70 | 10000950 | 10000588773980 | 0 | 0 | 1789042344 | 0 |
| 14 | QQQ | 0xb6befab1632196d5c55ccf320cca0e56f6331548ace2bd8ae11b5130d7db52c5 | 53344246 | 625000000000000000 | 0x10ac7506227bd990c898b9bf59afaf0e04e1568b | 0 | 0 | 0 | 0 | 1789548424 | 0 |
| 15 | QQQ | 0xdcb03716ad496e58390fb5c5d8b1f0a196f0b923482f17a3c231390a39e9fb67 | 54573643 | 625000000000000000 | 0x886b223772133b2df2ce8974ef37f8079b80482b | 0 | 0 | 0 | 0 | 1788556109 | 0 |
| 16 | QQQ | 0x1b8b34fd794924dcbd8c92f5efc54ccb1e977ad4ff2386f7be6d4d26a2fbdecb | 62365980 | 625000000000000000 | 0xead960d619a70eefb5d76a25895f8e0423cc6c4a | 0 | 0 | 0 | 0 | 1789344049 | 0 |
| 17 | QQQ | 0xad21de31ad13b7c221565206b10490864f2be1fd0514523ae56bd6575a616d23 | 65231835 | 625000000000000000 | 0x5e27992cc92b388dff0e2f9c5d0f99df82fe8841 | 0 | 0 | 0 | 0 | 1789634510 | 0 |
| 18 | NVDA | 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc | 18052573 | 625000000000000000 | 0xc5b8a6c5fdf14f9744db1c8595f49e42ce23031a | 6578772161 | 3288760945026825 | 31313085 | 31302025260868 | 1790707454 | 0 |
| 19 | NVDA | 0x3ce44383b860237d3a78a88caf9edcbec36b040d7be2998ef8222eec8719bd48 | 22808420 | 860000000000000000 | 0xc7b219c58ff4cc70f46ef39cb40a6bcc84155077 | 1000 | 1000000000 | 0 | 0 | 1785365867 | 0 |
| 20 | NVDA | 0xba2956531697f0c0b0b9db7b2d3148581ae69610c136287ba84bf519621a22dd | 24443591 | 860000000000000000 | 0xf6b30ac053bc52f185eac143ac357730b2d40939 | 0 | 0 | 0 | 0 | 1785527574 | 0 |
| 21 | NVDA | 0xb74600c27a3424eac0a9288f539d5165a125a5102d08b5313c303e29c0eaf8bf | 32350110 | 625000000000000000 | 0x91b93178448d0769163ec59ba7b01566013b45d4 | 0 | 0 | 0 | 0 | 1786319974 | 0 |
| 22 | NVDA | 0xd780a699a2022b90fd14e89b61523e6b6b6fdd3833158fcb701b878a5902255f | 40894247 | 770000000000000000 | 0x5df8d763c1ffb2dda49ffa3ca7906a24b8797eac | 0 | 0 | 0 | 0 | 1787176136 | 0 |
| 23 | NVDA | 0x21539fb91cac5c218508f89d6bd946eabaeed3b4ff185e802bbb73c2f77c25de | 45975493 | 770000000000000000 | 0x94d7d2f6790c676a2d3133b4d7dd689526b7c4e5 | 0 | 0 | 0 | 0 | 1787685690 | 0 |
| 24 | NVDA | 0xbe3a53552a5600381ca1d858cc425a2601becbd77c43c753698890a22adbbb0d | 50134057 | 385000000000000000 | 0xcf29960266420a42f12061699ec2dabd7eea8d6e | 100000000 | 100000000000000 | 0 | 0 | 1788109793 | 0 |
| 25 | NVDA | 0xf54d700dd3fe889872bfc868788de849e8a5b1adfd73bb3d983c8e264e970604 | 53344156 | 385000000000000000 | 0xfa6e814ab26b459c909f86c9650d433d5330b86d | 0 | 0 | 0 | 0 | 1789548421 | 0 |
| 26 | NVDA | 0x639f19732ce4cd54b9f3509f3acee6e8d5d20ff5e75b7c94c20808f48196d826 | 54453980 | 625000000000000000 | 0xb5736a58ce6370dad1888d8996cf64a22e622bb8 | 500004 | 500000327817 | 40002 | 40000000000 | 1789597801 | 0 |
| 27 | NVDA | 0x3ac6e757d6d8ac808dc7f00a389b07b18645d3cbd198a353e6b877194ddda6dc | 56849258 | 625000000000000000 | 0xf31147989da4c19c060a1a6fc425981f499ee2b7 | 0 | 0 | 0 | 0 | 1788785627 | 0 |
| 28 | NVDA | 0x95312f02c1dae8407b2c80468a5657a9bd19c45ac277f1a61aa52c11444c5314 | 58487863 | 625000000000000000 | 0x418da8be2d981f152fd9fc64ed42be2cdea52c5a | 2002371 | 1999632244315 | 911371 | 910000000000 | 1789835452 | 0 |
| 29 | NVDA | 0x8b16891f032a93b771347c9cb470a780e6699dd701553d3402aa3cdba6189c3e | 58919124 | 625000000000000000 | 0xed29d310cfa91778a5850538da28ed42234cb78c | 623355491337 | 621571719005195024 | 613930491337 | 611978497939891963 | 1790963757 | 0 |
| 30 | NVDA | 0xdb33e1291a096be5b9c52aeefec7c8b46cd349d3b8294fcac80bb02b7e2bf5fe | 65230895 | 625000000000000000 | 0x13879886ff32a2ed8a59b203eac46695bc0145ae | 0 | 0 | 0 | 0 | 1789634416 | 0 |
| 31 | NVDA | 0xf5ff7d546af5e72f3912d2aa723088fd0bf66fddc158714995637714d9db6e4c | 66554173 | 625000000000000000 | 0x37cf511fa79b8446f1c23d6a81df117f28240be0 | 1100 | 1100000000 | 1000 | 1000000000 | 1790014169 | 0 |
| 32 | NVDA | 0x1484485e9ebcd3c5b70c18ab30369ace2a2807e36962fd46f6c19be79a84a2c4 | 70441454 | 770000000000000000 | 0xc65d284efa6a3df34540cbc8ba7c7fcbd0258604 | 0 | 0 | 0 | 0 | 1790159269 | 0 |
| 33 | AAPL | 0x0d6e009807341aae5d0ccc3fbdc506fce77012603e96aec3fc44785942e7cf65 | 18053475 | 625000000000000000 | 0x83b04e51d7db41928475272097cdb5f9bb0a48cf | 2 | 0 | 0 | 0 | 1788332952 | 0 |
| 34 | AAPL | 0xd621b5373890ce0be9b20ca17a75c57944e8dbb997172fd61e1ea48af63fad96 | 22808465 | 860000000000000000 | 0xdb7b3f39178e8b1ce48424047557c023b54f0c64 | 1001 | 1000901392 | 0 | 0 | 1785516604 | 0 |
| 35 | AAPL | 0x01ab931866f6753d9246d451284c03d2b9cdf7f351120bc2e79045941777e7aa | 24443591 | 860000000000000000 | 0xd209b6d73f7c1d196f768f419f500161ebd437e6 | 85386 | 85321888384 | 76847 | 76782899408 | 1786378810 | 0 |
| 36 | AAPL | 0x63c71d3a1afd71c674be55f07a27ad783edf20d63372111ae5b2e7162963b7ac | 32350325 | 625000000000000000 | 0xbe230340e497e87b546f334711d8aaf82e48b853 | 0 | 0 | 0 | 0 | 1786319996 | 0 |
| 37 | AAPL | 0x30a2a5f1a098b23ed91eadc4529a8d1c967f2cdc2e40a709f3a5992004b01ac0 | 39456051 | 625000000000000000 | 0xa88e71306db8f5d8ccb8ebcc95f8033caef8f7a2 | 25000771 | 25000658147506 | 0 | 0 | 1789105244 | 0 |
| 38 | AAPL | 0xe3813a231ef3c073d21615ab0a8788ebfae23e95e7e5571880c7619d5b05f404 | 40894298 | 770000000000000000 | 0xff1d77a191a338674ccf17af48f7f9384587e457 | 0 | 0 | 0 | 0 | 1787176141 | 0 |
| 39 | AAPL | 0x6641d1333a00edf42f79b931554f1c81971656f18d881245f9547b471d5a49fb | 45975493 | 770000000000000000 | 0xce96f48ee4404f06174e46f0d2020d2bc5d705c2 | 0 | 0 | 0 | 0 | 1787685690 | 0 |
| 40 | AAPL | 0x3b788195cc0f5eb987e14d91d9b8875cf742c55faf9822ae25701f71a3ed7133 | 53089335 | 385000000000000000 | 0x4f6185269ebcad4cfa0371d63b29d923956e60ac | 0 | 0 | 0 | 0 | 1790402012 | 0 |
| 41 | AAPL | 0x349f46c4c49ff76074e27a21fe49fd86511b06c764a6d46589ced02a40dc40d2 | 54573451 | 625000000000000000 | 0xb5034a0167655415ca08eb255f3b6c7e47c72ed2 | 0 | 0 | 0 | 0 | 1788556089 | 0 |
| 42 | AAPL | 0x947ae981cc823024ea00b602f6ea72d049cac05d66ef096198ceeb998651c175 | 58489230 | 625000000000000000 | 0xc03399c6b3179859f0104be26aee6f20f83589f3 | 1001000 | 1001000000000 | 910000 | 910000000000 | 1788954871 | 0 |
| 43 | AAPL | 0xdeb4782d012d5fd3b24962538c2f6559049d70bda4dabd2e4212dacb96c28d45 | 58919124 | 625000000000000000 | 0xd625d488d552775d2867194c618b945e5ddfe097 | 197198740295 | 196865396114507711 | 197174571120 | 196784538696361361 | 1790963042 | 0 |
| 44 | AAPL | 0x47baa250d10b6969d3177dfac9b1235f1fb32e35a0d52609d438c800bf3f09da | 65231063 | 625000000000000000 | 0x68c24d810ae6480c8c2e9b0d98d4fdeb35dc4a90 | 0 | 0 | 0 | 0 | 1789634433 | 0 |
| 45 | AAPL | 0xcaa167af7ba0422c76424fae56167b7db25bf19f4f435215e6dd7d06a943bdac | 66586535 | 625000000000000000 | 0xa39f2c101bcc19ad5d0c7b83281f94a5ade2a344 | 1100 | 1100000000 | 1000 | 1000000000 | 1790014169 | 0 |
| 46 | AAPL | 0x516829adb04c8351c09747755eed21f4514370e2df11a73c89054fef7de316bc | 72601542 | 625000000000000000 | 0x69190621e300cd2bc4cbb80777b517691ee80f65 | 0 | 0 | 0 | 0 | 1790376983 | 0 |
| 47 | AAPL | 0x3d9b0c04e374f7b50fa7a635393d2ecae23f45289e4e23f83793a6a611010918 | 73454024 | 625000000000000000 | 0x88b628472e595725178cc3e5e2ec70ada67f80f0 | 0 | 0 | 0 | 0 | 1790463054 | 0 |

### 1.6 Markets with a launch Stock Token as loan token and USDG as collateral

| Loan token | Market id | Created at block | lltv | Oracle | totalSupplyAssets | totalBorrowAssets | lastUpdate |
| --- | --- | --- | --- | --- | ---: | ---: | --- |
| NVDA | 0x2fdd5af0a36ab05917ea93b1266b15f655b920d83a497adbfadcf4fcd9b28324 | 32350176 | 625000000000000000 | 0x548196c5a7d2127ae69fbc69e2fed9686fdd7a10 | 0 | 0 | 1786319981 |
| SPY | 0xf670348a152ced94c8dd240645d7bef7abd83049a7ae1f2e13949cee638a2ecc | 32350275 | 625000000000000000 | 0x0ca840cdaf5aa6066817ccd31ca2cc7647991135 | 0 | 0 | 1786319991 |
| AAPL | 0xb257b94f5fc1b69d1960d0a43684f7fc39c8f8c3748b84b51d6dfbbc0e362915 | 32350374 | 625000000000000000 | 0x7bf2558fbc0f48d54ba9a4f55d09a3d258024125 | 0 | 0 | 1786320001 |
| NVDA | 0xfa02b9d58bb338ea1ac14d89c2586683bf7c209b60073662a7c0dfaa72078be1 | 54573688 | 625000000000000000 | 0x2e72230da46b888bb71d419d4e194577e43bf881 | 0 | 0 | 1788556113 |
| NVDA | 0x99b038b2578a5f9fc142f5fedbd24c6de0e8a4bc81e51e8d8016d0621145a0e5 | 77088944 | 625000000000000000 | 0xac4a29515e0c2407ce0f4093c9143753f1b069f5 | 0 | 0 | 1790828941 |
| NVDA | 0x3a8f9ccf25583b6216f553d5d8b1a2c981818b2df61febf48d60080e6850c4cc | 77156190 | 625000000000000000 | 0x52fb7d121e576d8b0b06dd6fca6c3d7454e7bf5c | 0 | 0 | 1790835725 |
| NVDA | 0xb2f1e172da1fc454a25f9405b0d145cccd603fe56c719d0d5f4ddaf5017b91dc | 77349849 | 625000000000000000 | 0x4fafd0c44fb2757703f9e3f7b28564666edfd860 | 0 | 0 | 1790855227 |
| NVDA | 0x10b972d007b83b91ac0846339f829ccdbe06eb03aebe99eef661748e23843af6 | 77371499 | 625000000000000000 | 0xade3788c6bd7531dd3c424c3a09527175d4f7f82 | 0 | 0 | 1790857405 |

None has supply at block 78,653,690.

### 1.7 Oracles of the four markets with more than 1,000 USDG supplied

All reads at block 78,653,690 through the archive RPC:

```
for o in 0xed29d310cfa91778a5850538da28ed42234cb78c 0xd625d488d552775d2867194c618b945e5ddfe097 0xe8dab19184f72b5a5a9d51a6c50a1b04b0669ce7 0xc5b8a6c5fdf14f9744db1c8595f49e42ce23031a; do
  cast codesize --rpc-url https://robinhood.drpc.org --block 78653690 $o; sleep 0.4
  for f in 'price()(uint256)' 'BASE_FEED_1()(address)' 'BASE_FEED_2()(address)' 'QUOTE_FEED_1()(address)' 'QUOTE_FEED_2()(address)' 'BASE_VAULT()(address)' 'QUOTE_VAULT()(address)' 'SCALE_FACTOR()(uint256)'; do
    cast call --rpc-url https://robinhood.drpc.org --block 78653690 $o "$f"; sleep 0.4
  done
done
```

| Market | Oracle | Code size | `price()` | `BASE_FEED_1()` | `QUOTE_FEED_1()` | `SCALE_FACTOR()` | `BASE_FEED_2`, `QUOTE_FEED_2`, `BASE_VAULT`, `QUOTE_VAULT` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2, SPY | 0xe8dAb19184f72b5a5a9d51A6C50A1b04b0669ce7 | 2557 | 770673572071396430178491075 | 0xa68CA83408bE3f78d1c58a82081c619e9d21486d | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | 1000000000000000000000000 | all 0x0000000000000000000000000000000000000000 |
| 18, NVDA | 0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a | 2557 | 234985369801509924503774811 | 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 | 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 | 1000000000000000000000000 | all 0x0000000000000000000000000000000000000000 |
| 29, NVDA | 0xED29D310cfa91778A5850538DA28ed42234Cb78c | 2563 | 235167520864465674381280935 | reverts, data "0x" | reverts, data "0x" | 1000000000000000000000000 | all revert, data "0x" |
| 43, AAPL | 0xD625d488D552775D2867194C618B945E5dDfE097 | 2563 | 333996135346627831262436878 | reverts, data "0x" | reverts, data "0x" | 1000000000000000000000000 | all revert, data "0x" |

0xa68CA83408bE3f78d1c58a82081c619e9d21486d is the SPY feed's "Shared SVR" secondary proxy in Chainlink's directory (chain-constants.md section 1), not the primary proxy in the build's constants table. 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 is the NVDA primary proxy and 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 the USDG/USD proxy. None of the four oracles has a Sourcify record: `curl -sS "https://sourcify.dev/server/v2/contract/4663/<oracle>?fields=compilation,deployment"` returned `"match":null` for each, read between 00:17Z and 00:23Z.

The two 2,563-byte oracles have no feed getters, so their runtime code (`cast code --rpc-url https://robinhood.drpc.org --block 78653690 <oracle> > oracle_<oracle>.hex`) was scanned for known addresses and PUSH4 operands with `scan_oracle_code.py`:

```python
import sys

KNOWN = {
    "SPY feed": "319724394d3a0e3669269846abe664cd621f9f6a",
    "QQQ feed": "80901d846d5d7b030f26b480776ee3b29374c2ae",
    "NVDA feed": "379ec4f7c378f34a1b47e4f3cbebcbac3e8e9f15",
    "AAPL feed": "6b22a786baa607d76728168703a39ea9c99f2cd0",
    "USDG/USD feed": "61b7e5650328764b076a108eff5fa7282a1b9ad2",
    "NVDA SVR proxy": "cf169363636d73dbbf77733629cb38919d14232d",
    "AAPL SVR proxy": "4bdbb3150014c6ab2c6d9347b0779c49015a2f3f",
    "NVDA Stock Token": "d0601ce157db5bdc3162bbac2a2c8af5320d9eec",
    "AAPL Stock Token": "af3d76f1834a1d425780943c99ea8a608f8a93f9",
    "USDG": "5fc5360d0400a0fd4f2af552add042d716f1d168",
}


def push4_operands(code: bytes):
    out, i = set(), 0
    while i < len(code):
        op = code[i]
        if 0x60 <= op <= 0x7F:
            n = op - 0x5F
            if n == 4:
                out.add(code[i + 1 : i + 5].hex())
            i += 1 + n
        else:
            i += 1
    return sorted(out)


for path in sys.argv[1:]:
    hexcode = open(path).read().strip().lower().removeprefix("0x")
    print(path, len(hexcode) // 2, "bytes")
    print("  known addresses in code:", [k for k, v in KNOWN.items() if v in hexcode])
    print("  PUSH4 operands:", " ".join(push4_operands(bytes.fromhex(hexcode))))
```

```
$ python3 scan_oracle_code.py oracle_0xED29D310.hex oracle_0xD625d488.hex
oracle_0xED29D310.hex 2563 bytes
  known addresses in code: ['NVDA feed', 'USDG/USD feed', 'NVDA Stock Token', 'USDG']
  PUSH4 operands: 06d37817 08bb9633 0b8ad9f6 150e89cb 19f0bbc1 1ab5b41a 1b1043c8 282d9ac9 2fd4a61b 49248f77 4e487b71 73acf237 7706ba52 89a71afe 8b09578d a035b1fe a60bf13d bcf0cc61 ce4b5bbe d526c355 e28b7053 e4955b3d fc0c546a feaf968c fed0f855 ffffffff
oracle_0xD625d488.hex 2563 bytes
  known addresses in code: ['AAPL feed', 'USDG/USD feed', 'AAPL Stock Token', 'USDG']
  PUSH4 operands: 06d37817 08bb9633 0b8ad9f6 150e89cb 19f0bbc1 1ab5b41a 1b1043c8 282d9ac9 2fd4a61b 49248f77 4e487b71 73acf237 7706ba52 89a71afe 8b09578d a035b1fe a60bf13d bcf0cc61 ce4b5bbe d526c355 e28b7053 e4955b3d fc0c546a feaf968c fed0f855 ffffffff
```

Among the PUSH4 operands are 0xa60bf13d `uiMultiplier()`, 0x7706ba52 `oraclePaused()`, 0xfeaf968c `latestRoundData()`, 0xfc0c546a `token()` and 0xa035b1fe `price()`, checked with `cast sig`.

Feed answers and multipliers at the same block:

```
for pair in nvda_feed:0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 aapl_feed:0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 spy_svr:0xa68CA83408bE3f78d1c58a82081c619e9d21486d spy_feed:0x319724394D3A0e3669269846abE664Cd621f9f6A usdg_usd:0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; do
  echo "${pair%%:*} $(cast call --rpc-url https://robinhood.drpc.org --block 78653690 ${pair##*:} 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' | awk '{print $1}' | tr '\n' ' ')"; sleep 0.4
done
for pair in nvda:0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC aapl:0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 spy:0x117cc2133c37B721F49dE2A7a74833232B3B4C0C; do
  echo "${pair%%:*} uiMultiplier $(cast call --rpc-url https://robinhood.drpc.org --block 78653690 ${pair##*:} 'uiMultiplier()(uint256)' | awk '{print $1}')"; sleep 0.4
done
```

```
nvda_feed 18446744073709552778 23499711907 1790960839 1790960852 18446744073709552778
aapl_feed 18446744073709552316 33382386412 1790959167 1790959180 18446744073709552316
spy_svr 36893488147419103386 77071210575 1790944226 1790944238 36893488147419103386
spy_feed 18446744073709551770 77071210575 1790944226 1790944238 18446744073709551770
usdg_usd 18446744073709551736 100005000 1790955562 1790955574 18446744073709551736
nvda uiMultiplier 1000775159164630595
aapl uiMultiplier 1000566080061092436
spy uiMultiplier 1001717991187472003
```

Exact integer replay of all four `price()` values:

```python
nvda, aapl, spy, usdg = 23499711907, 33382386412, 77071210575, 100005000
m_nvda, m_aapl = 1000775159164630595, 1000566080061092436
plain = lambda a: 10**24 * a // usdg
with_mult = lambda a, m: ((a * 10**10 * m // 10**18) * 10**36 // (usdg * 10**10)) // 10**12
assert plain(spy) == 770673572071396430178491075                # market 2, oracle 0xe8dAb191
assert plain(nvda) == 234985369801509924503774811               # market 18, oracle 0xC5b8A6C5
assert with_mult(nvda, m_nvda) == 235167520864465674381280935   # market 29, oracle 0xED29D310
assert with_mult(aapl, m_aapl) == 333996135346627831262436878   # market 43, oracle 0xD625d488
```

All four assertions hold. Markets 2 and 18 price collateral as the feed over USDG/USD. Markets 29 and 43 first multiply the feed by the Stock Token's `uiMultiplier()`. Without the multiplier, market 43's oracle would return 333807173761311934403279836. Robinhood's oracle page, https://docs.robinhood.com/chain/oracles-and-price-feeds/, fetched at 00:23:18Z, says: "The feed returns the price of one token, which is the underlying share price times the multiplier." and "latestRoundData() returns this directly, so you don't apply the multiplier yourself." Read against that page, the oracles of markets 29 and 43 apply the multiplier a second time: a factor of 1.000775159164630595 for NVDA and 1.000566080061092436 for AAPL at this block.

### 1.8 Who created the four markets

```
$ cast tx --rpc-url https://rpc.mainnet.chain.robinhood.com <tx> from
```

| Market | Creation transaction | Block, time | Sender |
| --- | --- | --- | --- |
| 29, NVDA | 0xb54296b45b40bbd281816c8b4032b6f935d480f4a54347740b9273ef875350b1 | 58,919,124, 2026-09-09T22:54:20Z | 0xCfBd7e12A0f154a45576a73C1E409200068507B9 |
| 43, AAPL | 0xd1c95891e5748e5a18d5ad0369f9bee649720f819d8a7a78c38d83dd4c6bea2b | 58,919,124, 2026-09-09T22:54:20Z | 0xCfBd7e12A0f154a45576a73C1E409200068507B9 |
| 2, SPY | 0x388d258b0a252b6ae4e3bd51ac8a6eab0c1287c7a6ddd578f0cb173592a2eabc | 18,584,009, 2026-07-25T00:35:20Z | 0x1bf704707e9F3f407EbC9364fDAeD08C39893770 |
| 18, NVDA | 0x42a4210a8681ac64d0512394190bb4c63e6d8da214f68e6c7ebd98874cb38a2b | 18,052,573, 2026-07-24T09:47:24Z | 0x1bf704707e9F3f407EbC9364fDAeD08C39893770 |

The senders were not identified further. Who supplies the USDG in each market was not read.

## 2. G2 Relay quotes

Endpoint. Relay's API reference page "Get Quote" (https://docs.relay.link/references/api/get-quote-v2.md, fetched 00:25:37Z) is an OpenAPI block for `post /quote/v2` with server `https://api.relay.link`. Its request body takes `user`, `recipient`, `originChainId`, `destinationChainId`, `originCurrency`, `destinationCurrency`, `amount`, `tradeType` and `txs`, an array of `{to, value, data}` calls. Relay's call guide (https://docs.relay.link/references/api/api_guides/calling-integration-guide.md, fetched 00:25:37Z) says: "This works by specifying the transaction data you wish to execute on the destination chain as part of the initial quoting process."

Chains, fetched 00:26:29Z and saved as relay_chains.json:

```
$ curl -sS https://api.relay.link/chains -o relay_chains.json
$ jq -c '.chains[] | select(.id==4663) | {id, displayName, depositEnabled, disabled, tokenSupport, contracts, erc20Currencies: [.erc20Currencies[] | {symbol, address, supportsBridging}], solverCurrencies: [.solverCurrencies[] | .symbol]}' relay_chains.json
{"id":4663,"displayName":"Robinhood Chain","depositEnabled":true,"disabled":false,"tokenSupport":"All","contracts":{"multicall3":"0xcA11bde05977b3631167028862bE2a173976CA11","multicaller":"","onlyOwnerMulticaller":"","relayReceiver":"","erc20Router":"0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f","approvalProxy":"0xccc88a9d1b4ed6b0eaba998850414b24f1c315be","v3":{"erc20Router":"0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f","approvalProxy":"0xccc88a9d1b4ed6b0eaba998850414b24f1c315be"}},"erc20Currencies":[{"symbol":"USDG","address":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","supportsBridging":true}],"solverCurrencies":["USDG","ETH"]}
$ jq -c '.chains[] | select(.id==42161) | {id, multicaller: .contracts.multicaller, relayReceiver: .contracts.relayReceiver, erc20Currencies: [.erc20Currencies[] | select(.symbol=="USDC" or .symbol=="USDT") | {symbol, address, supportsBridging}]}' relay_chains.json
{"id":42161,"multicaller":"0x0000000000002bdbf1bf3279983603ec279cc6df","relayReceiver":"0xa5f565650890fba1824ee0f21ebbbf660a179934","erc20Currencies":[{"symbol":"USDC","address":"0xaf88d065e77c8cc2239327c5edb3a432268e5831","supportsBridging":true},{"symbol":"USDT","address":"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9","supportsBridging":true}]}
```

Robinhood Chain's `multicaller` and `relayReceiver` are empty strings. Arbitrum One lists both.

Requests. User and recipient are the dummy address 0x000000000000000000000000000000000000dEaD. Each request was sent once:

```
$ curl -sS -X POST https://api.relay.link/quote/v2 -H 'content-type: application/json' --data @relay_req_<x>.json -o relay_resp_<x>.json
```

```
relay_req_a.json  {"user":"0x000000000000000000000000000000000000dEaD","recipient":"0x000000000000000000000000000000000000dEaD","originChainId":42161,"destinationChainId":4663,"originCurrency":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","destinationCurrency":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","amount":"10000000","tradeType":"EXACT_INPUT"}
relay_req_b.json  {"user":"0x000000000000000000000000000000000000dEaD","recipient":"0x000000000000000000000000000000000000dEaD","originChainId":42161,"destinationChainId":4663,"originCurrency":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","destinationCurrency":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","amount":"10000000","tradeType":"EXACT_INPUT","txs":[{"to":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","value":"0","data":"0xa9059cbb000000000000000000000000000000000000000000000000000000000000dead0000000000000000000000000000000000000000000000000000000000895440"}]}
relay_req_c.json  {"user":"0x000000000000000000000000000000000000dEaD","recipient":"0x000000000000000000000000000000000000dEaD","originChainId":42161,"destinationChainId":4663,"originCurrency":"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9","destinationCurrency":"0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","amount":"10000000","tradeType":"EXACT_INPUT"}
```

The `data` in request b is the output of `cast calldata 'transfer(address,uint256)' 0x000000000000000000000000000000000000dEaD 9000000`, a 9 USDG transfer on Robinhood Chain. 9 USDG is below every minimum output Relay quoted.

Responses a (00:26:52Z), b (00:27:31Z) and c (00:28:37Z), all HTTP 200:

```
$ for x in a b c; do jq -c --arg q $x '{quote: $q, requestId, steps: [.steps[] | {id, items: [.items[] | {chainId: .data.chainId, to: .data.to, selector: .data.data[0:10]}]}], currencyIn: {chainId: .details.currencyIn.currency.chainId, address: .details.currencyIn.currency.address, amount: .details.currencyIn.amount}, currencyOut: {chainId: .details.currencyOut.currency.chainId, address: .details.currencyOut.currency.address, amount: .details.currencyOut.amount, minimumAmount: .details.currencyOut.minimumAmount}, slippageTotal: .details.slippageTolerance.total, timeEstimate: .details.timeEstimate, fees: (.fees | with_entries(.value = .value.amount)), output: .protocol.v2.orderData.output | {chainId, payments, calls}}' relay_resp_$x.json; done
{"quote":"a","requestId":"0x179098721167eb41f8f2d6b456fc837682c960c73cb4d61e0c6e7126e99ca505","steps":[{"id":"approve","items":[{"chainId":42161,"to":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","selector":"0x095ea7b3"}]},{"id":"deposit","items":[{"chainId":42161,"to":"0x4cd00e387622c35bddb9b4c962c136462338bc31","selector":"0xe8017952"}]}],"currencyIn":{"chainId":42161,"address":"0xaf88d065e77c8cc2239327c5edb3a432268e5831","amount":"10000000"},"currencyOut":{"chainId":4663,"address":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","amount":"9968832","minimumAmount":"9769455"},"slippageTotal":"200","timeEstimate":1,"fees":{"gas":"1680272000000","relayer":"29721","relayerGas":"7723","relayerService":"21998","app":"0","subsidized":"0"},"output":{"chainId":"robinhood","payments":[{"recipient":"0x000000000000000000000000000000000000dEaD","currency":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","minimumAmount":"9769455","expectedAmount":"9968832"}],"calls":[]}}
{"quote":"b","requestId":"0x17909872502ec0dbb2b89d29b21bc65041929574fa591c93f91b58d47d4be596","steps":[{"id":"approve","items":[{"chainId":42161,"to":"0xaf88d065e77c8cC2239327C5EDb3A432268e5831","selector":"0x095ea7b3"}]},{"id":"deposit","items":[{"chainId":42161,"to":"0x4cd00e387622c35bddb9b4c962c136462338bc31","selector":"0xe8017952"}]}],"currencyIn":{"chainId":42161,"address":"0xaf88d065e77c8cc2239327c5edb3a432268e5831","amount":"10000000"},"currencyOut":{"chainId":4663,"address":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","amount":"9933422","minimumAmount":"9734753"},"slippageTotal":"200","timeEstimate":1,"fees":{"gas":"1680608054400","relayer":"65129","relayerGas":"43132","relayerService":"21997","app":"0","subsidized":"0"},"output":{"chainId":"robinhood","payments":[{"recipient":"0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f","currency":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","minimumAmount":"9734753","expectedAmount":"9933422"}],"calls":["0x0000000000000000000000005fc5360d0400a0fd4f2af552add042d716f1d1680000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000000000000000000000000000000000000000dead000000000000000000000000000000000000000000000000000000000089544000000000000000000000000000000000000000000000000000000000"]}}
{"quote":"c","requestId":"0x17909873168b7fd24eb1c31fe6b59b4eb22868e20b7d0c40e71c087a30a8e7b9","steps":[{"id":"approve","items":[{"chainId":42161,"to":"0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9","selector":"0x095ea7b3"}]},{"id":"deposit","items":[{"chainId":42161,"to":"0x4cd00e387622c35bddb9b4c962c136462338bc31","selector":"0xe8017952"}]}],"currencyIn":{"chainId":42161,"address":"0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9","amount":"10000000"},"currencyOut":{"chainId":4663,"address":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","amount":"9957869","minimumAmount":"9758712"},"slippageTotal":"200","timeEstimate":1,"fees":{"gas":"1757489861600","relayer":"29702","relayerGas":"7735","relayerService":"21967","app":"0","subsidized":"0"},"output":{"chainId":"robinhood","payments":[{"recipient":"0x000000000000000000000000000000000000dEaD","currency":"0x5fc5360d0400a0fd4f2af552add042d716f1d168","minimumAmount":"9758712","expectedAmount":"9957869"}],"calls":[]}}
```

Reading the responses:

- a: two steps, both on Arbitrum One. A USDC `approve` (selector 0x095ea7b3) and a deposit to Relay's depository 0x4cd00e387622c35bddb9b4c962c136462338bc31 (selector 0xe8017952). Output 9968832 USDG base units on Robinhood Chain, minimum 9769455. Fees: relayer 29721 USDC base units (relayerGas 7723 plus relayerService 21998) and origin gas 1680272000000 wei. `slippageTotal` "200". `timeEstimate` 1, which the OpenAPI block defines as "Estimated swap time in seconds". The order pays the recipient directly and has no calls.
- b: the same two steps. Output 9933422, minimum 9734753. The order now pays the USDG to Relay's `erc20Router` 0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f on Robinhood Chain and carries one call entry. Its first word is the target 0x5fc5360d0400a0fd4f2af552add042d716f1d168 (USDG), its third word is value 0, and its tail holds the `transfer` calldata from the request. relayerGas rose from 7723 to 43132.
- c: USDT from Arbitrum One gets the same two-step route. Output 9957869, minimum 9758712.

Relay's contracts on Robinhood Chain at block 78,660,590:

```
$ cast codesize --rpc-url https://robinhood.drpc.org --block 78660590 0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f
4720
$ cast codesize --rpc-url https://robinhood.drpc.org --block 78660590 0xccc88a9d1b4ed6b0eaba998850414b24f1c315be
7746
$ cast codesize --rpc-url https://robinhood.drpc.org --block 78660590 0x4cd00e387622c35bddb9b4c962c136462338bc31
8628
```

None of the returned steps was signed or sent.

## 3. G3 Registry

```
for pair in SPY:0x117cc2133c37B721F49dE2A7a74833232B3B4C0C QQQ:0xD5f3879160bc7c32ebb4dC785F8a4F505888de68 NVDA:0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC AAPL:0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9; do
  echo "${pair%%:*} uid $(cast call --rpc-url https://robinhood.drpc.org --block 78660590 ${pair##*:} 'uid()(bytes32)')"; sleep 0.4
done
```

```
SPY uid 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1
QQQ uid 0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed
NVDA uid 0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5
AAPL uid 0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649
```

Issuer assets API, 00:32:04Z:

```
$ curl -sS -A 'Mozilla/5.0' -H 'accept: application/json' https://api.robinhood.com/rhj/assets -o rhj_assets.json   # HTTP 200, 162,103 bytes
$ shasum -a 256 rhj_assets.json
3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c  rhj_assets.json
$ jq '.assets | length' rhj_assets.json
194
$ jq -c '[.assets[].status] | group_by(.) | map({(.[0]): length}) | add' rhj_assets.json
{"ASSET_STATUS_ACTIVE":194}
$ jq -c '[.assets[] | (.deployments | length)] | group_by(.) | map({(.[0]|tostring): length}) | add' rhj_assets.json
{"1":194}
$ jq -c '.assets[] | select(.tokenSymbol=="SPY" or .tokenSymbol=="QQQ" or .tokenSymbol=="NVDA" or .tokenSymbol=="AAPL") | {tokenSymbol, id, contractAddress: .deployments[0].contractAddress, chainId: .deployments[0].chainId, tokenDecimals, pendingMultiplier}' rhj_assets.json
{"tokenSymbol":"SPY","id":"0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1","contractAddress":"0x117cc2133c37B721F49dE2A7a74833232B3B4C0C","chainId":4663,"tokenDecimals":18,"pendingMultiplier":""}
{"tokenSymbol":"QQQ","id":"0x000000000000000000000000000000002470b933c52d47ccad017ed9ee80c9ed","contractAddress":"0xD5f3879160bc7c32ebb4dC785F8a4F505888de68","chainId":4663,"tokenDecimals":18,"pendingMultiplier":""}
{"tokenSymbol":"NVDA","id":"0x00000000000000000000000000000000915f477416294f5099a5e0e09f327ce5","contractAddress":"0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC","chainId":4663,"tokenDecimals":18,"pendingMultiplier":""}
{"tokenSymbol":"AAPL","id":"0x00000000000000000000000000000000c2425be3658540dd8e2424cbf3c5c649","contractAddress":"0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9","chainId":4663,"tokenDecimals":18,"pendingMultiplier":""}
```

The sha256 equals the copy read on 2 October at 14:55:08Z (chain-constants.md Appendix A.10), so the response has not changed since.

Docs page, 00:32:20Z:

```
$ curl -sSL -A 'Mozilla/5.0' https://docs.robinhood.com/chain/contracts -o rh_contracts.html   # HTTP 200 after a redirect to /chain/contracts/, 23,364 bytes
$ shasum -a 256 rh_contracts.html
fd31420cf2e89c8bab6a36446ad066672e8827b0c5dd3307c6d0f65320c292a3  rh_contracts.html
```

With tags stripped, the page text has one sentence on the registry, "The table below is generated live from the on-chain asset registry.", and only two addresses, WETH 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73 and USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168. The page loads the bundle index-BQ4e_aJN.js (1,397,448 bytes, sha256 134904335e37cd7f184806fc33d05f6eae1ce2ea51b9946371d08a6cd3ad67bd), whose route entry for /chain/contracts loads the chunk index-DhgXFtCP.js:

```
$ curl -sS https://cdn.robinhood.com/assets/generated_assets/hoodchain_docsite/assets/index-DhgXFtCP.js -o rh_chunk_contracts.js   # 00:33:23Z, HTTP 200, 5,168 bytes
$ shasum -a 256 rh_chunk_contracts.js
2fd17f26cf6bbc72daa945415b90e51d141893a89ddfba0c30f8aa6beaf3a986  rh_chunk_contracts.js
$ grep -o 'https://api[^"`]*' rh_chunk_contracts.js | sort -u; grep -o '0x[0-9a-fA-F]\{40\}' rh_chunk_contracts.js | sort -u
https://api.robinhood.com/rhj/assets
0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
```

The chunk declares `const b="https://api.robinhood.com/rhj/assets"` and builds the table from that API. It names no registry contract. The 2 October reading of the older bundle found the same (docs/research/issuer-docs.md sections 1 and 3).

## 4. G4 Feeds

Public RPC, block 78,660,590, read after the block was pinned at 00:29Z and before the directory fetch at 00:31:12Z:

```
for pair in SPY:0x319724394D3A0e3669269846abE664Cd621f9f6A QQQ:0x80901d846d5D7B030F26B480776EE3b29374C2ae NVDA:0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 AAPL:0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 USDG_USD:0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; do
  d=$(cast call --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78660590 ${pair##*:} 'decimals()(uint8)'); sleep 1.5
  r=$(cast call --rpc-url https://rpc.mainnet.chain.robinhood.com --block 78660590 ${pair##*:} 'latestRoundData()(uint80,int256,uint256,uint256,uint80)' | awk '{print $1}' | tr '\n' ' ')
  echo "${pair%%:*} ${pair##*:} decimals=$d latestRoundData=$r"; sleep 1.5
done
```

```
SPY 0x319724394D3A0e3669269846abE664Cd621f9f6A decimals=8 latestRoundData=18446744073709551770 77071210575 1790944226 1790944238 18446744073709551770
QQQ 0x80901d846d5D7B030F26B480776EE3b29374C2ae decimals=8 latestRoundData=18446744073709552017 75199912534 1790945820 1790945832 18446744073709552017
NVDA 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 decimals=8 latestRoundData=18446744073709552778 23499711907 1790960839 1790960852 18446744073709552778
AAPL 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 decimals=8 latestRoundData=18446744073709552316 33382386412 1790959167 1790959180 18446744073709552316
USDG_USD 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2 decimals=8 latestRoundData=18446744073709551736 100005000 1790955562 1790955574 18446744073709551736
```

`aggregator()` on each proxy at the same block, archive RPC:

```
for pair in SPY:0x319724394D3A0e3669269846abE664Cd621f9f6A QQQ:0x80901d846d5D7B030F26B480776EE3b29374C2ae NVDA:0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 AAPL:0x6B22A786bAa607d76728168703a39Ea9C99f2cD0 USDG_USD:0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; do
  echo "${pair%%:*} aggregator $(cast call --rpc-url https://robinhood.drpc.org --block 78660590 ${pair##*:} 'aggregator()(address)')"; sleep 0.4
done
SPY aggregator 0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc
QQQ aggregator 0x25e996ce8b3529885D429241156e83e7b7744049
NVDA aggregator 0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2
AAPL aggregator 0xBb11A21267cFDb63d4935d99a499133DD1744ACb
USDG_USD aggregator 0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e
```

Chainlink's directory, the `rddUrl` that Chainlink's docs repo lists for Robinhood Chain Mainnet (chain-constants.md Appendix A.10), fetched 00:31:12Z:

```
$ curl -sS https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json -o rdd.json   # HTTP 200, 84,653 bytes
$ shasum -a 256 rdd.json
714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776  rdd.json
$ jq 'length' rdd.json
58
$ jq -c '.[] | select((.proxyAddress // "" | ascii_downcase) as $p | ["0x319724394d3a0e3669269846abe664cd621f9f6a","0x80901d846d5d7b030f26b480776ee3b29374c2ae","0x379ec4f7c378f34a1b47e4f3cbebcbac3e8e9f15","0x6b22a786baa607d76728168703a39ea9c99f2cd0","0x61b7e5650328764b076a108eff5fa7282a1b9ad2"] | index($p)) | {name, proxyAddress, contractAddress, decimals, heartbeat, threshold, marketHours: (.docs.marketHours // null), path}' rdd.json
{"name":"Robinhood QQQ / USD","proxyAddress":"0x80901d846d5D7B030F26B480776EE3b29374C2ae","contractAddress":"0x25e996ce8b3529885D429241156e83e7b7744049","decimals":8,"heartbeat":86400,"threshold":0.5,"marketHours":"us_equities_24/5","path":"robinhood-qqq-usd-shared-svr"}
{"name":"Robinhood SPY / USD","proxyAddress":"0x319724394D3A0e3669269846abE664Cd621f9f6A","contractAddress":"0x78BCB218fA04B9b3a278eBc865Ed320BF8DEFBAc","decimals":8,"heartbeat":86400,"threshold":0.5,"marketHours":"us_equities_24/5","path":"robinhood-spy-usd-shared-svr"}
{"name":"USDG / USD","proxyAddress":"0x61B7e5650328764B076A108EFF5fa7282a1B9aD2","contractAddress":"0x8bEeE3503F6860D5dac4cE26b5eEe92982951c2e","decimals":8,"heartbeat":86400,"threshold":0.5,"marketHours":"Crypto","path":"usdg-usd-shared-svr"}
{"name":"Robinhood AAPL / USD","proxyAddress":"0x6B22A786bAa607d76728168703a39Ea9C99f2cD0","contractAddress":"0xBb11A21267cFDb63d4935d99a499133DD1744ACb","decimals":8,"heartbeat":86400,"threshold":0.5,"marketHours":"us_equities_24/5","path":"robinhood-aapl-usd-shared-svr"}
{"name":"Robinhood NVDA / USD","proxyAddress":"0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15","contractAddress":"0xC9d16E4f2569b9E3ea0468fD85844953713DC2a2","decimals":8,"heartbeat":86400,"threshold":0.5,"marketHours":"us_equities_24/5","path":"robinhood-nvda-usd-shared-svr"}
```

The sha256 equals the file read on 2 October at 14:55:33Z (chain-constants.md section 4).

## 5. G5 Pools

Archive RPC, block 78,660,590. USDG goes first in `getPool`, as in docs/research/pools.md.

```
ARC=https://robinhood.drpc.org; P=78660590; USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
F=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA; Q=0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7
for row in SPY:0x117cc2133c37B721F49dE2A7a74833232B3B4C0C:500:0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 QQQ:0xD5f3879160bc7c32ebb4dC785F8a4F505888de68:500:0xD60A5d14dB690B7Afad71F76B108071D7175597d NVDA:0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC:500:0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 AAPL:0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9:500:0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D AAPL:0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9:3000:0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed; do
  IFS=: read n tok fee pool <<< "$row"
  gp=$(cast call --rpc-url $ARC --block $P $F 'getPool(address,address,uint24)(address)' $USDG $tok $fee); sleep 0.4
  liq=$(cast call --rpc-url $ARC --block $P $pool 'liquidity()(uint128)' | awk '{print $1}'); sleep 0.4
  ub=$(cast call --rpc-url $ARC --block $P $USDG 'balanceOf(address)(uint256)' $pool | awk '{print $1}'); sleep 0.4
  tb=$(cast call --rpc-url $ARC --block $P $tok 'balanceOf(address)(uint256)' $pool | awk '{print $1}'); sleep 0.4
  qt=$(cast call --rpc-url $ARC --block $P $Q 'quoteExactInputSingle((address,address,uint256,uint24,uint160))(uint256,uint160,uint32,uint256)' "($USDG,$tok,100000000,$fee,0)" | awk '{print $1}' | tr '\n' ' '); sleep 0.4
  echo "$n fee=$fee pool=$pool getPool=$gp liquidity=$liq usdgHeld=$ub tokenHeld=$tb quote100=$qt"
done
```

```
SPY fee=500 pool=0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 getPool=0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 liquidity=492723019407771402 usdgHeld=231109002269 tokenHeld=165617362830057977639 quote100=129662084478969058 2199713245618637781943070 1 108550
QQQ fee=500 pool=0xD60A5d14dB690B7Afad71F76B108071D7175597d getPool=0xD60A5d14dB690B7Afad71F76B108071D7175597d liquidity=1200653771262130638 usdgHeld=714969803955 tokenHeld=708969532996368548186 quote100=133292575027853574 2893280256039776169523892870241902 1 109002
NVDA fee=500 pool=0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 getPool=0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 liquidity=19356687274306262182 usdgHeld=2247588915663 tokenHeld=3736927408457147744752 quote100=426073802090257126 5172857647033478190511030232146619 1 109332
AAPL fee=500 pool=0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D getPool=0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D liquidity=521568212096508523 usdgHeld=152250360930 tokenHeld=569877723729459479427 quote100=299738093341331616 4338672567937884397249976659595574 1 117741
AAPL fee=3000 pool=0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed getPool=0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed liquidity=100551201152888351 usdgHeld=91206858311 tokenHeld=111513364599027622532 quote100=299241238389098265 4340411750316803722869646999847436 1 117724
```

`quote100` lists amountOut, sqrtPriceX96After, initializedTicksCrossed and gasEstimate. Premium against the feed round in force at the same block (section 4), computed as in pools.md "Method": execution price = 100 USDG over the tokens out, premium = (execution price minus feed price) over feed price, times 10,000.

| Ticker | Fee | Execution price, USDG per token | Feed price | Premium, bps |
| --- | --- | --- | --- | --- |
| SPY | 500 | 771.2354803012581 | 770.71210575 | +6.79 |
| QQQ | 500 | 750.2293355732938 | 751.99912534 | -23.53 |
| NVDA | 500 | 234.701123395558 | 234.99711907 | -12.60 |
| AAPL | 500 | 333.624595009762 | 333.82386412 | -5.97 |
| AAPL | 3000 | 334.1785394898403 | 333.82386412 | +10.62 |

The session was closed at this block, so the module would queue rather than buy. The premiums only show that each pool still quotes close to the feed.

## 6. G7 USDG decimals and permit

Archive RPC, block 78,660,590 unless marked:

```
$ U=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; ARC=https://robinhood.drpc.org
$ cast call --rpc-url $ARC --block 78660590 $U 'decimals()(uint8)'
6
$ cast call --rpc-url $ARC --block 78660590 $U 'getFacet(bytes4)(address)' 0xd505accf
0x780d30b6a89BC9Eef953a543aA288c3B05b01309
$ cast call --rpc-url $ARC --block 78660590 $U 'PERMIT_TYPEHASH()(bytes32)'
0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9
$ cast call --rpc-url $ARC --block 78660590 $U 'DOMAIN_SEPARATOR()(bytes32)'
0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036
$ cast storage --rpc-url $ARC --block 78660590 $U 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc
0x00000000000000000000000068184c449e1a8f34fa18d289737129fd27b66f8f
```

Both hashes equal values computed locally with eth_hash and eth_abi: keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"), and the EIP-712 domain separator for name "Global Dollar", version "1", chain id 4663 and the USDG address.

Replay of the permit signature committed in chain-constants.md Appendix A.2, signed on 2 October by a throwaway key, at that research's block. No new signature was made.

```
$ cast call --rpc-url $ARC --block 78327113 $U 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3 0x000000000000000000000000000000000000dEaD 1000000 1790957370 28 0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e 0x63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d2
0x
$ cast call --rpc-url $ARC --block 78327113 $U 'permit(address,address,uint256,uint256,uint8,bytes32,bytes32)' 0xFD42D4d3c2d7823F4172a700E6364Cb30C0933c3 0x000000000000000000000000000000000000dEaD 1000001 1790957370 28 0xef43727ac1d76f57de3cf2839a7fe47588eb6b6b7df57ceaf4a7b4a88b78ce3e 0x63fd9823ae87c5e463abfeebe621dee37acffaf56dbc27985dcc4e2523dd33d2
Error: server returned an error response: error code 3: execution reverted, data: "0x8baa579f"
```

0x8baa579f is `InvalidSignature()`.

Sourcify, 00:36:37Z:

```
$ curl -sS 'https://sourcify.dev/server/v2/contract/4663/0x68184C449E1a8f34fA18d289737129FD27B66f8F?fields=compilation' | jq -c '{match, compilation: .compilation | {fullyQualifiedName, compilerVersion}}'
{"match":"match","compilation":{"fullyQualifiedName":"contracts/stablecoins/USDG.sol:USDG","compilerVersion":"0.8.28+commit.7893614a"}}
$ curl -sS 'https://sourcify.dev/server/v2/contract/4663/0x780d30b6a89BC9Eef953a543aA288c3B05b01309?fields=compilation' | jq -c '{match}'
{"match":null}
```

## 7. G8 Data Streams

| Source | Fetched | Exact text |
| --- | --- | --- |
| Chainlink, "Fetch and decode reports" Go SDK tutorial, https://docs.chain.link/data-streams/tutorials/go-sdk-fetch | 00:39Z | "Access to Data Streams requires API credentials. If you haven't already, contact us to request mainnet or testnet access." |
| Chainlink, sign-up page, https://docs.chain.link/data-streams/sign-up | 00:39Z | "You must generate credentials before making API requests." |
| Chainlink, 24/5 US Equities user guide, https://docs.chain.link/data-streams/rwa-streams/24-5-us-equities-user-guide (PRD source S38) | 00:38Z | "Market status 5 indicates the market is closed, which includes weekends, public holidays, and unexpected market closures." |
| Robinhood, Data Streams, https://docs.robinhood.com/chain/data-streams/ | 00:40:10Z | "For the Robinhood Chain Mainnet (chain ID 4663), the verifier proxy is located at the following address:", followed by the table row "Robinhood Chain 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7" |

Quotes are from the page text with tags stripped. The guide's source file, https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/content/data-streams/rwa-streams/24-5-us-equities-user-guide.mdx (fetched 00:37:52Z, sha256 e014dbc04e9e5a18405f64c0fc9202da40f9361ee0637486482db8dcd75ff137), has the same sentence with the 5 in code formatting.

```
$ cast codesize --rpc-url https://robinhood.drpc.org --block 78660590 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7
7009
$ cast call --rpc-url https://robinhood.drpc.org --block 78660590 0xcE73c8ad08CBDEaCa6078BF0627C8fe0a9a536E7 'typeAndVersion()(string)'
"VerifierProxy 2.0.0"
```

## 8. Recheck for the accuracy review, 3 October 2026

Between 08:20 and 08:45 UTC a sample of the values above was read again with the same commands, one request at a time. Pinned-block reads went to the archive RPC and the receipt read to the public RPC, whose head was block 78,941,137 at 08:25Z. Every value matched the earlier read.

| Gate | Read again | Result |
| --- | --- | --- |
| G1 | `cast codesize` of Morpho Blue at blocks 285 and 286 | 0 and 15582 |
| G1 | `cast receipt` of 0xe1927e1ab342ba2ce16b2e2796745741fac71fc7db70011f9710a45b64f74d20, Morpho Blue's own logs in order | SetOwner 0xc67335d9..., EnableIrm for 0x0 and 0x2bd3d596..., nine EnableLltv, SetOwner 0x06059563..., status 1, block 286 |
| G1 | `market(bytes32)` of market 29 at block 78,653,690 | 623355491337 621571719005195024 613930491337 611978497939891963 1790963757 0 |
| G1 | `price()` of the market 43 oracle at block 78,687,842, the block of CONTRIBUTIONS.md M1 | 333996135346627831262436878. The four replay assertions in section 1.7 hold |
| G2 | `GET https://api.relay.link/chains`, chain 4663 | "Robinhood Chain", depositEnabled true, erc20Router 0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f, multicaller and relayReceiver empty, USDG supportsBridging true |
| G2 | `cast codesize` of the erc20Router at block 78,660,590 | 4720 |
| G3 | `https://api.robinhood.com/rhj/assets` at 08:20:22Z | HTTP 200, 162,103 bytes, sha256 3e378f9cef46a42503496caa35d130a5590072d1be7801d109de64b998e3e78c, 194 assets, the same four ids and token addresses |
| G3 | `uid()` of SPY and AAPL at block 78,660,590 | the ids in section 3 |
| G3 | https://docs.robinhood.com/chain/contracts, its bundle index-BQ4e_aJN.js and chunk index-DhgXFtCP.js | sha256 fd31420c..., 134904335e..., 2fd17f26... as in section 3, the registry sentence, `const b="https://api.robinhood.com/rhj/assets"` and only the WETH and USDG addresses |
| G4 | `decimals()` and `latestRoundData()` of the SPY and USDG/USD proxies at block 78,660,590 | 8, round 154 answer 77071210575 updatedAt 1790944238, and 8, round 120 answer 100005000 updatedAt 1790955574 |
| G4 | Chainlink's directory feeds-robinhood-mainnet.json | sha256 714038abef5e6290ce09d4f02279382ff0dcd36e573b8d745ba38d9d316bf776, 58 rows, no uptime or sequencer row |
| G5 | `getPool(USDG, QQQ, 500)`, the QQQ pool's `liquidity()`, a 100 USDG QuoterV2 quote, and USDG held by the AAPL fee-3000 pool, at block 78,660,590 | 0xD60A5d14dB690B7Afad71F76B108071D7175597d, 1200653771262130638, 133292575027853574, 91206858311 |
| G7 | `decimals()`, `getFacet(0xd505accf)`, `PERMIT_TYPEHASH()`, `DOMAIN_SEPARATOR()` and the EIP-1967 slot at block 78,660,590 | 6, 0x780d30b6a89BC9Eef953a543aA288c3B05b01309, both hashes as in section 6 and equal to values computed locally with `cast keccak` and `cast abi-encode`, 0x68184c449e1a8f34fa18d289737129fd27b66f8f |
| G7 | The permit replay at block 78,327,113, value 1000000 and value 1000001 | `0x`, and a revert with 0x8baa579f |
| G7 | Sourcify for the permit facet and for the implementation | HTTP 404 and HTTP 200 |
| G8 | `cast codesize` and `typeAndVersion()` of the verifier proxy at block 78,660,590 | 7009 and "VerifierProxy 2.0.0" |
| G8 | The four quotes in section 7, from the Chainlink sources on GitHub main and Robinhood's docs bundle | each present as quoted. The user guide's source still has sha256 e014dbc0... |
