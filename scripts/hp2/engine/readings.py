"""How the engine reads details docs/HP2_PROTOCOL.md leaves open. None of them changes a definition. The summary
carries this list and the report prints it, so a reader can check each one against the protocol."""

READINGS = (
    (
        "Evaluation instants",
        (
            "A payment is evaluated at its arrival, at every later update of the ticker's own feed, and at every "
            "point of a 15-minute grid at which the session is open. The grid is every multiple of 900 seconds since "
            "the epoch, so each 20:00 New York open is a point, and the first fresh round after each open is one of "
            "the feed updates. USDG/USD rounds are not evaluation instants, because the protocol's 'feed round' is "
            "the ticker's feed, as in 'a feed round newer than the session's opening instant'."
        ),
    ),
    (
        "Arrival instant and delay",
        (
            "The arrival is the float draw t. The chain is read at floor(t), which has the same block, session and "
            "rounds because every block timestamp and session boundary is a whole second. A fill at the arrival has "
            "delay 0 and a later fill at instant e has delay e - t."
        ),
    ),
    (
        "Fresh round",
        (
            "A round is newer than the session's opening instant when its updated_at is at or after that instant. "
            "This is the module's readStockFeed test, where equality passes, and the primary reference uses the same "
            "test."
        ),
    ),
    (
        "Primary reference inside a session",
        (
            "When the session is open but its first round has not landed, the 'next session open' is the open the "
            "fill sits in, so the reference is that session's first round, the live price the protocol asks for."
        ),
    ),
    (
        "Best quote and reverts",
        (
            "The best quote is the largest amount_out among the successful quotes of the ticker's allowlisted pools "
            "for the payment size, ties going to the first pool in allowlist order. An instant at which every pool "
            "reverts has no price: the arrival policy falls back to the first later evaluation instant with a working "
            "quote, and the calendar-only and guarded policies keep waiting. A quote that ran to the swap's price "
            "limit does not price the full payment, and the run stops if one is ever the best quote at an evaluated "
            "instant."
        ),
    ),
    (
        "Calendar only",
        (
            "The calendar-only policy buys at the first evaluation instant at which the session is open and some pool "
            "quotes. It runs none of the guard's other checks, as the protocol defines it."
        ),
    ),
    (
        "Guard checks",
        (
            "The guarded policy runs the module's checks in the module's order with the protocol's parameters: "
            "paused, oracle paused, session, multiplier change within 24 hours, stale feed (no round, answer not "
            "positive, older than 25 hours, or older than the session's opening instant), USDG/USD outside 1 plus or "
            "minus 50 bps or older than 25 hours, then the buy: no working quote, or a premium above 100 bps over the "
            "round in force by the exact integer test. The blocklist is not one of the protocol's checks, and the "
            "clip never binds at 100 or 1,000 USDG."
        ),
    ),
    (
        "Token state",
        (
            "paused(), oraclePaused() and the multiplier views at an instant are rebuilt from the token's and the "
            "registry's events. A pause flag before its first event is the opposite of what that event sets, because "
            "Pausable emits its events alternately. A scheduled multiplier change is pending while effectiveAt is in "
            "the future and at most 24 hours away."
        ),
    ),
    (
        "Premiums",
        (
            "Statistics use the exact premium, (execution price - reference price) / reference price * 10,000 with "
            "the execution price USDG in over tokens out. Rows also show the receipt figure, the exact premium "
            "rounded up against the owner, which never decides anything."
        ),
    ),
    (
        "Medians and percentiles",
        (
            "The median of an even count is the mean of the middle two values. The 90th percentile and the bootstrap "
            "interval ends interpolate linearly between order statistics at position q * (n - 1), numpy's default."
        ),
    ),
    (
        "Bootstrap",
        (
            "One random.Random(4663202610 + 100). Each resample draws n payment indices with rng.choices(range(n), "
            "k=n), which is floor(random() * n) per draw. The pooled 1,000 payments draw their 10,000 resamples "
            "first, then SPY, QQQ, NVDA and AAPL draw theirs, 250 payments each, in that order. Within a scope every "
            "size, reference and comparison shares the resamples. Payments are in protocol ticker order, then draw "
            "order. The interval is the 2.5th and 97.5th percentile of the resampled means."
        ),
    ),
    (
        "Verdict",
        (
            "The verdict is the protocol's rule on the pooled payments at 100 USDG against the primary reference. "
            "Fail is checked first: the mean of arrival minus guarded premium at or below zero, or a guarded median "
            "delay above 72 hours. Otherwise Pass when the interval excludes zero, otherwise Null. The protocol's "
            "Null and Fail conditions can both hold, and each Fail condition withdraws the claim on its own, so Fail "
            "wins. The same rule on the 1,000 USDG run and the secondary reference is shown for information only."
        ),
    ),
)
