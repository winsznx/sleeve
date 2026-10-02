"""HP2 replay engine: the policies of docs/HP2_PROTOCOL.md on the fetched data, their statistics and the report.

Modules, in the order the data flows through them:
    premium.py    PriceGuard's premium arithmetic: the exact cap test and the receipt figures.
    market.py     what the guard reads at an instant: feed rounds, token flags, the multiplier schedule, the best quote.
    calendar.py   the session test: the module's SessionCalendar through forge, checked against the Python port.
    guard.py      the guarded policy's checks, in the module's order.
    reference.py  the primary and secondary market reference of a fill.
    policies.py   the evaluation instants and the arrival, guarded and calendar-only fills of one payment.
    stats.py      means, medians, quantiles, the paired bootstrap and the verdict rule.
    results.py    per-payment rows and the summary.
    report.py     docs/HP2_RESULTS.md from the summary.

scripts/hp2/run.py runs them offline over results/hp2/data.
"""
