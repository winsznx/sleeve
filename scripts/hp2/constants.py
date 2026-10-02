"""Pinned inputs of the HP2 replay (docs/HP2_PROTOCOL.md) and the chain facts the fetch relies on.

Addresses come from the protocol's input table, docs/DECISIONS.md D-010 and docs/research/chain-constants.md.
Selectors and topics were computed with `cast sig` and `cast sig-event`; tests/test_constants.py recomputes them.
"""

from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "contracts"
RESULTS = REPO / "results" / "hp2"
DATA_DIR = RESULTS / "data"
CACHE_DIR = RESULTS / "cache"
CALENDAR_PORT = REPO / "scripts" / "calendar_vectors.py"
CALENDAR_LIBRARY = CONTRACTS / "src" / "libraries" / "SessionCalendar.sol"
SESSION_SCRIPT = Path(__file__).resolve().parent / "SessionOracle.s.sol"

CHAIN_ID = 4663
END_BLOCK = 78_312_136

ARCHIVE_RPC = "https://robinhood.drpc.org"
PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com"

USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
QUOTER_V2 = "0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7"
V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"
REGISTRY = "0xe10b6f6B275de231345c20D14Ab812db62151b00"
MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11"
USDG_USD_FEED = "0x61B7e5650328764B076A108EFF5fa7282a1B9aD2"

USDG_DECIMALS = 6
TOKEN_DECIMALS = 18
FEED_DECIMALS = 8


@dataclass(frozen=True)
class Pool:
    address: str
    fee: int


@dataclass(frozen=True)
class Ticker:
    symbol: str
    index: int
    token: str
    feed: str
    pools: tuple[Pool, ...]

    @property
    def anchor_pool(self) -> Pool:
        """The fee-500 pool whose creation starts the window."""
        (pool,) = [p for p in self.pools if p.fee == 500]
        return pool


TICKERS = (
    Ticker(
        "SPY",
        0,
        "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C",
        "0x319724394D3A0e3669269846abE664Cd621f9f6A",
        (Pool("0xa7Bb1AC63BBaB0C44316E6c8C455213441689167", 500),),
    ),
    Ticker(
        "QQQ",
        1,
        "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68",
        "0x80901d846d5D7B030F26B480776EE3b29374C2ae",
        (Pool("0xD60A5d14dB690B7Afad71F76B108071D7175597d", 500),),
    ),
    Ticker(
        "NVDA",
        2,
        "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
        "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
        (Pool("0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3", 500),),
    ),
    Ticker(
        "AAPL",
        3,
        "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9",
        "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0",
        (
            Pool("0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D", 500),
            Pool("0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed", 3000),
        ),
    ),
)
TICKER_BY_SYMBOL = {t.symbol: t for t in TICKERS}

SEED = 4663202610
ARRIVALS_PER_TICKER = 250
SIZES_USDG = (100, 1000)
WINDOW_AFTER_CREATION = 24 * 3600
WINDOW_BEFORE_END = 96 * 3600

DROP_FACTOR = 10
DROP_EXPECTED_BEFORE = 1_782_222_780  # 2026-06-23T13:53:00Z

GRID_SECONDS = 900

# The module's guard limits (docs/HP2_PROTOCOL.md, docs/SPEC.md section 4). The fetch only uses them to decide how
# far each payment's quotes must reach; the replay engine evaluates the policies.
FEED_MAX_AGE = 25 * 3600
MULTIPLIER_WINDOW = 24 * 3600
USDG_TOLERANCE_BPS = 50
USDG_MAX_AGE = 25 * 3600
PREMIUM_CAP_BPS = 100

# Safety margins for the stopping rule, so an engine that reads a threshold or a boundary slightly differently still
# finds every instant it evaluates already fetched.
STOP_PREMIUM_MARGIN_BPS = 5
STOP_AGE_MARGIN = 900
STOP_USDG_MARGIN_BPS = 5
STOP_EVENT_MARGIN = 900
BOUNDARY_MARGIN = 3600

LOG_CHUNK_BLOCKS = 10_000_000

SELECTOR = {
    "decimals": "0x313ce567",
    "getRoundData": "0x9a6fc8f5",
    "latestRoundData": "0xfeaf968c",
    "phaseId": "0x58303b10",
    "aggregator": "0x245a7bfc",
    "description": "0x7284e416",
    "quoteExactInputSingle": "0xc6a5026a",
    "aggregate3": "0x82ad56cb",
    "token0": "0x0dfe1681",
    "token1": "0xd21220a7",
    "fee": "0xddca3f43",
    "getPool": "0x1698ee82",
    "paused": "0x5c975abb",
    "oraclePaused": "0x7706ba52",
    "uiMultiplier": "0xa60bf13d",
    "newUIMultiplier": "0xdc767007",
    "effectiveAt": "0x97a4064f",
}
SIGNATURE = {
    "decimals": "decimals()",
    "getRoundData": "getRoundData(uint80)",
    "latestRoundData": "latestRoundData()",
    "phaseId": "phaseId()",
    "aggregator": "aggregator()",
    "description": "description()",
    "quoteExactInputSingle": "quoteExactInputSingle((address,address,uint256,uint24,uint160))",
    "aggregate3": "aggregate3((address,bool,bytes)[])",
    "token0": "token0()",
    "token1": "token1()",
    "fee": "fee()",
    "getPool": "getPool(address,address,uint24)",
    "paused": "paused()",
    "oraclePaused": "oraclePaused()",
    "uiMultiplier": "uiMultiplier()",
    "newUIMultiplier": "newUIMultiplier()",
    "effectiveAt": "effectiveAt()",
}

TOPIC = {
    "PoolCreated": "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118",
    "UIMultiplierUpdated": "0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055",
    "Paused": "0x9e87fac88ff661f02d44f95383c817fece4bce600a3dab7a54406878b965e752",
    "Unpaused": "0xa45f47fdea8a1efdd9029a5691c7f759c32b7c698632b563573e155625d16933",
    "OraclePaused": "0xe28b7053f432ae5400c6168140cbe15638399715519a0a39b16b505fb9fc9d9a",
    "OracleUnpaused": "0xa274116fec684497d55e11cc9516edaa8d206c8b5f84c4603e32572c37f8e6dd",
    "AnswerUpdated": "0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f",
}
EVENT_SIGNATURE = {
    "PoolCreated": "PoolCreated(address,address,uint24,int24,address)",
    "UIMultiplierUpdated": "UIMultiplierUpdated(uint256,uint256,uint256)",
    "Paused": "Paused()",
    "Unpaused": "Unpaused()",
    "OraclePaused": "OraclePaused()",
    "OracleUnpaused": "OracleUnpaused()",
    "AnswerUpdated": "AnswerUpdated(int256,uint256,uint256)",
}
STATE_EVENTS = ("UIMultiplierUpdated", "Paused", "Unpaused", "OraclePaused", "OracleUnpaused")
