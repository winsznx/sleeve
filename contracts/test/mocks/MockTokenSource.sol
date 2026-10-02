// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";

/// @notice TokenSource's views with an open setter, for ticker states the real TokenSource refuses to list, such as
/// a feed with session type NONE.
contract MockTokenSource {
    struct Entry {
        address token;
        address feed;
        SessionCalendar.SessionType sessionType;
        bool active;
    }

    address public immutable usdg;

    Entry[] private _tickers;

    error UnknownTicker(uint8 id);

    constructor(address usdg_) {
        usdg = usdg_;
    }

    function list(address token, address feed, SessionCalendar.SessionType sessionType, bool active) external {
        _tickers.push(Entry({token: token, feed: feed, sessionType: sessionType, active: active}));
    }

    function tickerCount() external view returns (uint256) {
        return _tickers.length;
    }

    function ticker(uint8 id) external view returns (address, address, SessionCalendar.SessionType, bool) {
        if (id >= _tickers.length) revert UnknownTicker(id);
        Entry storage entry = _tickers[id];
        return (entry.token, entry.feed, entry.sessionType, entry.active);
    }
}
