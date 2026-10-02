"""The market reference of a fill (docs/HP2_PROTOCOL.md, Market reference).

Primary: the round in force when the session is open and that round is newer than the session's opening instant.
Otherwise the first round at or after the next session open. For a fill while the session is open but before its
first round lands, the next session open is the one the fill sits in, so the reference is that session's first round:
the live price the protocol asks for, not a price from the following week. A round counts as newer than the opening
instant when updated_at is at or after it, the test the module's guard applies, so a round updated at the opening
second is live under both.

Secondary: the round in force at the fill instant, the reading that matches receipts. On a weekend it is Friday's
held price.
"""

from dataclasses import dataclass

from hp2.engine.calendar import SessionTest
from hp2.engine.market import Feed, Round

IN_FORCE = "round in force"
FIRST_AFTER_OPEN = "first round at or after the session open"


class NoReference(LookupError):
    """The feed has no round the reference rule asks for."""


@dataclass(frozen=True)
class Reference:
    round: Round
    rule: str
    session_open: int | None
    """For FIRST_AFTER_OPEN, the opening instant whose first round is the reference."""


def primary_reference(instant: int, calendar: SessionTest, feed: Feed) -> Reference:
    is_open, opened_at = calendar.session_state(instant)
    in_force = feed.in_force(instant)
    if is_open and in_force is not None and in_force.updated_at >= opened_at:
        return Reference(in_force, IN_FORCE, None)
    session_open = opened_at if is_open else calendar.next_open(instant)
    first = feed.first_at_or_after(session_open)
    if first is None:
        raise NoReference(f"{feed.name} has no round at or after the session open {session_open}")
    return Reference(first, FIRST_AFTER_OPEN, session_open)


def secondary_reference(instant: int, feed: Feed) -> Reference:
    in_force = feed.in_force(instant)
    if in_force is None:
        raise NoReference(f"{feed.name} has no round in force at {instant}")
    return Reference(in_force, IN_FORCE, None)
