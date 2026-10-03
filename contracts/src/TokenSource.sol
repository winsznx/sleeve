// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IUniswapV3Factory} from "./interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "./interfaces/IUniswapV3Pool.sol";
import {SessionCalendar} from "./libraries/SessionCalendar.sol";

/// @title TokenSource
/// @notice Sleeve's mirror of the official stock token list (gate G3 is open, so there is no onchain registry read):
/// each ticker's token, Chainlink feed, session type and Uniswap v3 pool allowlist. The constructor sets every launch
/// value. Afterwards the timelock can only remove a ticker, one way, and add or remove a canonical pool, never an active
/// ticker's last one (D-014, B2-8, audit A1-18). No function adds a ticker and no function moves funds (I10). Removed
/// tickers keep their pools, so owners can still sell lots they hold.
/// @dev A pool is canonical for a ticker when the v3 factory's getPool(USDG, token, pool.fee()) returns it, and it is
/// accepted when its fee is 100, 500 or 3,000. The 1 percent tier is refused because its fee alone uses the whole
/// default premium cap (docs/research/pools.md). Ticker ids are indexes into the launch list and never change.
contract TokenSource {
    /// @notice A launch ticker as the deploy script passes it.
    /// @param token The canonical stock token.
    /// @param feed Its Chainlink feed proxy, or zero for a ticker without a feed.
    /// @param sessionType ALL_DAY or REGULAR for a ticker with a feed, NONE for one without.
    /// @param pools The ticker's first allowlisted pools.
    struct TickerInit {
        address token;
        address feed;
        SessionCalendar.SessionType sessionType;
        address[] pools;
    }

    struct Ticker {
        address token;
        SessionCalendar.SessionType sessionType;
        bool active;
        address feed;
    }

    uint8 private constant USDG_DECIMALS = 6;
    uint8 private constant TOKEN_DECIMALS = 18;
    uint8 private constant FEED_DECIMALS = 8;

    /// @notice The only address that can write: an OpenZeppelin TimelockController.
    address public immutable timelock;

    /// @notice USDG, the other side of every allowlisted pool.
    address public immutable usdg;

    /// @notice The Uniswap v3 factory that decides which pools are canonical.
    address public immutable v3Factory;

    Ticker[] private _tickers;

    /// @dev Allowlisted pools per ticker id, in the order they were added.
    mapping(uint8 id => address[] pools) private _pools;

    /// @dev Fee tier of each allowlisted pool. Zero means not allowlisted, since no accepted tier is zero.
    mapping(uint8 id => mapping(address pool => uint24 fee)) private _poolFee;

    /// @dev Ticker id plus one, so zero means the token is not listed.
    mapping(address token => uint256 idPlusOne) private _idPlusOne;

    /// @notice The constructor listed a launch ticker.
    /// @param id Its ticker id.
    /// @param token The stock token.
    /// @param feed The feed proxy, or zero.
    /// @param sessionType Its session type.
    event TickerListed(uint8 indexed id, address indexed token, address feed, SessionCalendar.SessionType sessionType);

    /// @notice A ticker was removed. It can no longer be bought; existing lots stay sellable.
    /// @param id The ticker id.
    /// @param token The stock token.
    event TickerRemoved(uint8 indexed id, address indexed token);

    /// @notice A pool was added to or removed from a ticker's allowlist.
    /// @param id The ticker id.
    /// @param pool The pool.
    /// @param fee The pool's fee tier.
    /// @param allowed True when added, false when removed.
    event PoolSet(uint8 indexed id, address indexed pool, uint24 fee, bool allowed);

    /// @notice Only the timelock can write.
    /// @param caller The address that called.
    error CallerNotTimelock(address caller);

    /// @notice The timelock given at deploy has no code, so it cannot be a TimelockController.
    /// @param timelock The address given.
    error TimelockNotContract(address timelock);

    /// @notice The USDG address given at deploy has no code.
    /// @param usdg The address given.
    error UsdgNotContract(address usdg);

    /// @notice The Uniswap v3 factory given at deploy has no code.
    /// @param factory The address given.
    error FactoryNotContract(address factory);

    /// @notice A launch ticker's token or feed has no code.
    /// @param account The address given.
    error NotContract(address account);

    /// @notice USDG, a stock token or a feed reports decimals other than 6, 18 or 8.
    /// @param source The token or feed.
    /// @param decimals What it reported.
    /// @param expected What Sleeve requires of it.
    error UnexpectedDecimals(address source, uint8 decimals, uint8 expected);

    /// @notice The launch list is empty.
    error NoTickers();

    /// @notice The launch list has more tickers than a uint8 id can name.
    /// @param count The number given.
    error TooManyTickers(uint256 count);

    /// @notice A token appears twice in the launch list.
    /// @param token The repeated token.
    error DuplicateToken(address token);

    /// @notice A ticker with a feed has session type NONE, or one without a feed has a session.
    /// @param token The ticker's token.
    /// @param feed Its feed, or zero.
    /// @param sessionType The session type given.
    error SessionTypeMismatch(address token, address feed, SessionCalendar.SessionType sessionType);

    /// @notice The pool is not the factory's USDG pool for the token at the pool's own fee, or it is not a pool.
    /// @param token The ticker's token.
    /// @param pool The pool given.
    error PoolNotCanonical(address token, address pool);

    /// @notice The pool is canonical but its fee tier is not 100, 500 or 3,000.
    /// @param pool The pool given.
    /// @param fee Its fee.
    error FeeNotAllowed(address pool, uint24 fee);

    /// @notice The pool is already on the ticker's allowlist.
    /// @param id The ticker id.
    /// @param pool The pool given.
    error PoolAlreadyAllowed(uint8 id, address pool);

    /// @notice The pool is not on the ticker's allowlist.
    /// @param id The ticker id.
    /// @param pool The pool given.
    error PoolNotAllowed(uint8 id, address pool);

    /// @notice No ticker has this id.
    /// @param id The id given.
    error UnknownTicker(uint8 id);

    /// @notice The ticker was already removed. Removal is one way.
    /// @param id The id given.
    error TickerAlreadyRemoved(uint8 id);

    /// @notice No ticker has this token.
    /// @param token The token given.
    error UnknownToken(address token);

    /// @notice Removing the pool would leave an active ticker with no allowlisted pool, which the module reads as a
    /// refusal of the ticker, sending every equity part and bucket of it to spend (audit A1-18). Add the replacement
    /// first, in the same batch, or remove the ticker.
    /// @param id The ticker id.
    /// @param pool The pool given.
    error LastPoolOfActiveTicker(uint8 id, address pool);

    /// @notice A launch ticker with a feed has no pool, so every buy on it would be refused.
    /// @param token The ticker's token.
    error NoPools(address token);

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert CallerNotTimelock(msg.sender);
        _;
    }

    /// @param timelock_ The only address that will be able to write: the TimelockController.
    /// @param usdg_ USDG. Must report 6 decimals.
    /// @param v3Factory_ The Uniswap v3 factory.
    /// @param tickers The launch tickers, given ids 0, 1, 2 and on in this order.
    constructor(address timelock_, address usdg_, address v3Factory_, TickerInit[] memory tickers) {
        if (timelock_.code.length == 0) revert TimelockNotContract(timelock_);
        if (usdg_.code.length == 0) revert UsdgNotContract(usdg_);
        if (v3Factory_.code.length == 0) revert FactoryNotContract(v3Factory_);
        _requireDecimals(usdg_, IERC20Metadata(usdg_).decimals(), USDG_DECIMALS);
        if (tickers.length == 0) revert NoTickers();
        if (tickers.length > uint256(type(uint8).max) + 1) revert TooManyTickers(tickers.length);
        timelock = timelock_;
        usdg = usdg_;
        v3Factory = v3Factory_;
        for (uint256 i; i < tickers.length; ++i) {
            _list(SafeCast.toUint8(i), tickers[i]);
        }
    }

    /// @notice Removes a ticker for good: it can no longer be bought. Its pools stay so existing lots can be sold.
    /// @param id The ticker id.
    function removeTicker(uint8 id) external onlyTimelock {
        Ticker storage entry = _ticker(id);
        if (!entry.active) revert TickerAlreadyRemoved(id);
        entry.active = false;
        emit TickerRemoved(id, entry.token);
    }

    /// @notice Adds a canonical pool to a ticker's allowlist, or removes an allowlisted one. An active ticker's last
    /// pool cannot be removed: a rotation adds the new pool first, in one scheduleBatch.
    /// @dev Caller: the timelock. Works on removed tickers too, so a drained pool can be swapped out while owners still
    /// sell, and a removed ticker may empty its list.
    /// @param id The ticker id.
    /// @param pool The pool.
    /// @param allowed True to add, false to remove.
    function setPool(uint8 id, address pool, bool allowed) external onlyTimelock {
        Ticker storage entry = _ticker(id);
        if (allowed) {
            _allowPool(id, entry.token, pool);
        } else {
            _disallowPool(id, pool, entry.active);
        }
    }

    /// @notice Number of tickers ever listed, removed ones included. It never grows after deploy.
    function tickerCount() external view returns (uint256) {
        return _tickers.length;
    }

    /// @notice A ticker's configuration.
    /// @param id The ticker id.
    /// @return token The stock token.
    /// @return feed The feed proxy, or zero.
    /// @return sessionType The calendar session type.
    /// @return active False once removed.
    function ticker(uint8 id)
        external
        view
        returns (address token, address feed, SessionCalendar.SessionType sessionType, bool active)
    {
        Ticker storage entry = _ticker(id);
        return (entry.token, entry.feed, entry.sessionType, entry.active);
    }

    /// @notice Whether a pool is on a ticker's allowlist.
    /// @param id The ticker id. An unknown id gives false.
    /// @param pool The pool.
    function isPoolAllowed(uint8 id, address pool) external view returns (bool) {
        return _poolFee[id][pool] != 0;
    }

    /// @notice A ticker's allowlisted pools, in the order they were added.
    /// @param id The ticker id.
    function poolsOf(uint8 id) external view returns (address[] memory) {
        _ticker(id);
        return _pools[id];
    }

    /// @notice The ticker id of a listed token, removed or not.
    /// @param token The stock token.
    function idOf(address token) external view returns (uint8) {
        uint256 idPlusOne = _idPlusOne[token];
        if (idPlusOne == 0) revert UnknownToken(token);
        return SafeCast.toUint8(idPlusOne - 1);
    }

    function _list(uint8 id, TickerInit memory init) private {
        _requireContract(init.token);
        _requireDecimals(init.token, IERC20Metadata(init.token).decimals(), TOKEN_DECIMALS);
        if (_idPlusOne[init.token] != 0) revert DuplicateToken(init.token);
        bool hasFeed = init.feed != address(0);
        if (hasFeed) {
            _requireContract(init.feed);
            _requireDecimals(init.feed, IAggregatorV3(init.feed).decimals(), FEED_DECIMALS);
        }
        if (hasFeed == (init.sessionType == SessionCalendar.SessionType.NONE)) {
            revert SessionTypeMismatch(init.token, init.feed, init.sessionType);
        }
        if (hasFeed && init.pools.length == 0) revert NoPools(init.token);
        _tickers.push(Ticker({token: init.token, sessionType: init.sessionType, active: true, feed: init.feed}));
        _idPlusOne[init.token] = uint256(id) + 1;
        emit TickerListed(id, init.token, init.feed, init.sessionType);
        for (uint256 i; i < init.pools.length; ++i) {
            _allowPool(id, init.token, init.pools[i]);
        }
    }

    function _allowPool(uint8 id, address token, address pool) private {
        if (_poolFee[id][pool] != 0) revert PoolAlreadyAllowed(id, pool);
        uint24 fee = _canonicalFee(token, pool);
        if (fee != 100 && fee != 500 && fee != 3000) revert FeeNotAllowed(pool, fee);
        _poolFee[id][pool] = fee;
        _pools[id].push(pool);
        emit PoolSet(id, pool, fee, true);
    }

    function _disallowPool(uint8 id, address pool, bool active) private {
        uint24 fee = _poolFee[id][pool];
        if (fee == 0) revert PoolNotAllowed(id, pool);
        address[] storage pools = _pools[id];
        if (active && pools.length == 1) revert LastPoolOfActiveTicker(id, pool);
        delete _poolFee[id][pool];
        uint256 index;
        while (pools[index] != pool) {
            ++index;
        }
        for (uint256 last = pools.length - 1; index < last; ++index) {
            pools[index] = pools[index + 1];
        }
        pools.pop();
        emit PoolSet(id, pool, fee, false);
    }

    /// @dev The pool's fee once the factory confirms the pool is its USDG pool for the token at that fee. The fee is
    /// read with a checked staticcall, so an address that is not a pool fails with PoolNotCanonical, not a bare revert.
    function _canonicalFee(address token, address pool) private view returns (uint24 fee) {
        if (pool.code.length == 0) revert PoolNotCanonical(token, pool);
        (bool ok, bytes memory returned) = pool.staticcall(abi.encodeCall(IUniswapV3Pool.fee, ()));
        if (!ok || returned.length != 32) revert PoolNotCanonical(token, pool);
        uint256 rawFee = abi.decode(returned, (uint256));
        if (rawFee > type(uint24).max) revert PoolNotCanonical(token, pool);
        // forge-lint: disable-next-line(unsafe-typecast)
        fee = uint24(rawFee);
        if (IUniswapV3Factory(v3Factory).getPool(usdg, token, fee) != pool) revert PoolNotCanonical(token, pool);
    }

    function _requireContract(address account) private view {
        if (account.code.length == 0) revert NotContract(account);
    }

    function _requireDecimals(address source, uint8 decimals, uint8 expected) private pure {
        if (decimals != expected) revert UnexpectedDecimals(source, decimals, expected);
    }

    function _ticker(uint8 id) private view returns (Ticker storage) {
        if (id >= _tickers.length) revert UnknownTicker(id);
        return _tickers[id];
    }
}
