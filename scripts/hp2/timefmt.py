"""UTC ISO strings for unix instants."""

from datetime import UTC, datetime


def iso(ts: float) -> str:
    moment = datetime.fromtimestamp(ts, tz=UTC)
    if float(ts).is_integer():
        return moment.strftime("%Y-%m-%dT%H:%M:%SZ")
    return moment.strftime("%Y-%m-%dT%H:%M:%S.%fZ")
