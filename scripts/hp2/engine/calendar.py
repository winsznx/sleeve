"""The session test: session_state(ts) -> (open, opened_at), the module's SessionCalendar for the ALL_DAY session of the
four launch tickers.

Two implementations answer it, both in scripts/hp2/session.py. ForgeSession runs the compiled library through
scripts/hp2/SessionOracle.s.sol, and PortSession runs the Python port in scripts/calendar_vectors.py. module_calendar
answers with forge and requires the port to agree on every instant it is asked. When forge cannot answer (forge
missing, the library not compiling, the script failing) or the two disagree on any instant, it answers with the port
alone and records why, which keeps the run provisional.

Forge answers come from the committed cache in results/hp2/cache/session, keyed by the sha256 of the library, the
oracle script and foundry.toml, so a changed calendar is evaluated afresh. The cache is copied to a temporary
directory first: forge answers whatever the cache lacks there, and the committed file never changes.
"""

import shutil
import subprocess
import tempfile
import weakref
from collections.abc import Iterable
from pathlib import Path
from typing import Protocol

from hp2.constants import CACHE_DIR, GRID_SECONDS
from hp2.session import CheckedSession, ForgeSession, PortSession, SessionDisagreement, SessionState

FORGE_ORACLE = (
    "forge: SessionCalendar through scripts/hp2/SessionOracle.s.sol, every instant checked by the Python port"
)
PORT_ORACLE = "python port: scripts/calendar_vectors.py"
FORGE_FAILURES = (OSError, RuntimeError, ValueError, LookupError, subprocess.SubprocessError, SessionDisagreement)

SCAN_CHUNK = 96 * GRID_SECONDS
SCAN_LIMIT = 14 * 86_400


class SessionTest(Protocol):
    def session_state(self, ts: int) -> tuple[bool, int]:
        """Whether the session is open at ts and, when it is, the instant the open stretch began (else 0)."""
        ...

    def next_open(self, ts: int) -> int:
        """For a closed instant, the opening instant of the next session, found with session_state."""
        ...


class ModuleCalendar:
    """session_state(ts) over a backend whose states(timestamps) returns {ts: SessionState}, with answers kept."""

    def __init__(
        self,
        backend,
        oracle: str,
        *,
        provisional_reason: str | None = None,
        forge: ForgeSession | None = None,
        port: PortSession | None = None,
        workdir: Path | None = None,
    ):
        self.backend = backend
        self.oracle = oracle
        self.provisional_reason = provisional_reason
        self.forge = forge
        self.port = port
        self._states: dict[int, SessionState] = {}
        if workdir is not None:
            weakref.finalize(self, shutil.rmtree, workdir, ignore_errors=True)

    def prefetch(self, instants: Iterable[int]) -> None:
        missing = {int(ts) for ts in instants} - self._states.keys()
        if missing:
            self._states.update(self.backend.states(missing))

    def state(self, ts: int) -> SessionState:
        ts = int(ts)
        if ts not in self._states:
            self.prefetch([ts])
        return self._states[ts]

    def session_state(self, ts: int) -> tuple[bool, int]:
        state = self.state(ts)
        return state.open, state.opened_at

    def next_open(self, ts: int) -> int:
        """The opening instant of the first session to open after ts, a closed instant: the opened_at of the first
        open point on the 900 s grid after ts. Every ALL_DAY session lasts far longer than one grid step."""
        if self.state(ts).open:
            raise ValueError(f"{ts} is inside an open session")
        first = ts - ts % GRID_SECONDS + GRID_SECONDS
        for chunk in range(first, ts + SCAN_LIMIT, SCAN_CHUNK):
            grid = range(chunk, chunk + SCAN_CHUNK, GRID_SECONDS)
            self.prefetch(grid)
            for point in grid:
                state = self._states[point]
                if state.open:
                    if not ts < state.opened_at <= point:
                        raise ValueError(f"session open at {point} reports opened_at {state.opened_at} before {ts}")
                    return state.opened_at
        raise LookupError(f"no session opens within {SCAN_LIMIT} s after {ts}")

    def describe(self) -> dict:
        port = self.port or self.backend
        info = {
            "oracle": self.oracle,
            "instants_answered": len(self._states),
            "port_sha256": port.source_sha256,
            "provisional_reason": self.provisional_reason,
        }
        if self.forge is not None:
            info["instants_checked_against_port"] = len(self.backend.checked)
            info["disagreements"] = 0
            info["forge_runs_this_run"] = self.forge.forge_runs
            info["forge_sources_sha256"] = self.forge.source_hashes
        return info


def module_calendar(instants: Iterable[int], cache_dir: Path = CACHE_DIR / "session") -> ModuleCalendar:
    """The session test the run uses, with every instant in `instants` answered and, under forge, checked."""
    wanted = sorted({int(ts) for ts in instants})
    port = PortSession()
    workdir = Path(tempfile.mkdtemp(prefix="hp2-session-"))
    try:
        for cached in cache_dir.glob("forge-*.json.gz"):
            shutil.copy2(cached, workdir / cached.name)
        forge = ForgeSession(workdir)
        calendar = ModuleCalendar(CheckedSession(forge, port), FORGE_ORACLE, forge=forge, port=port, workdir=workdir)
        calendar.prefetch(wanted)
        return calendar
    except FORGE_FAILURES as exc:
        shutil.rmtree(workdir, ignore_errors=True)
        reason = (
            "The forge calendar failed or disagreed with the Python port, so the port answered alone. "
            f"{type(exc).__name__}: {exc}"
        )
        calendar = ModuleCalendar(port, PORT_ORACLE, provisional_reason=reason[:2000], port=port)
        calendar.prefetch(wanted)
        return calendar
