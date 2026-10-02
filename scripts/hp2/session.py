"""The session test: session_state(ts) -> (open, opened_at), for the ALL_DAY session of the four launch tickers.

Two implementations answer it. ForgeSession runs the compiled SessionCalendar library through
scripts/hp2/SessionOracle.s.sol in batches; PortSession runs the Python port in scripts/calendar_vectors.py.
CheckedSession answers with forge and stops the run if the port disagrees on any instant, reason included. Answers are
cached on disk per hash of the library, the script and foundry.toml, so a changed calendar is evaluated afresh.
"""

import gzip
import hashlib
import importlib.util
import json
import os
import subprocess
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from hp2.constants import CALENDAR_LIBRARY, CALENDAR_PORT, CONTRACTS, SESSION_SCRIPT

OPEN_REASON = 1
TIMESTAMP_BYTES = 5
ANSWER_BYTES = 6
FORGE_ENV = {"FOUNDRY_OUT": "out-hp2", "FOUNDRY_CACHE_PATH": "cache-hp2"}


@dataclass(frozen=True)
class SessionState:
    open: bool
    opened_at: int
    reason: int


class SessionDisagreement(Exception):
    """The forge library and the Python port answered an instant differently."""


class PortSession:
    name = "python-port"

    def __init__(self, port_path: Path = CALENDAR_PORT):
        spec = importlib.util.spec_from_file_location("calendar_vectors", port_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.module = module
        self.calendar = module.Calendar(
            date(2026, 1, 1), date(2028, 1, 1), frozenset(module.HOLIDAYS), frozenset(module.EARLY_CLOSES)
        )
        self.intervals = module.Intervals(self.calendar.all_day_intervals())
        self.source_sha256 = hashlib.sha256(port_path.read_bytes()).hexdigest()

    def states(self, timestamps) -> dict[int, SessionState]:
        out = {}
        for ts in timestamps:
            ts = int(ts)
            is_open, reason = self.calendar.all_day(ts)
            opened_at = self.intervals.opened_at(ts)
            if is_open != (opened_at != 0):
                raise SessionDisagreement(f"the port's point and interval forms disagree at {ts}")
            out[ts] = SessionState(bool(is_open), opened_at, int(reason))
        return out

    def open_intervals(self) -> list[tuple[int, int]]:
        return list(self.intervals.intervals)


def _sources_digest() -> tuple[str, dict]:
    files = {
        "library": CALENDAR_LIBRARY,
        "script": SESSION_SCRIPT,
        "foundry_toml": CONTRACTS / "foundry.toml",
    }
    hashes = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()}
    digest = hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest()
    return digest, hashes


class ForgeSession:
    name = "forge"

    def __init__(self, cache_dir: Path, *, chunk: int = 15_000, offline_only: bool = False):
        self.digest, self.source_hashes = _sources_digest()
        self.path = cache_dir / f"forge-{self.digest[:16]}.json.gz"
        self.chunk = chunk
        self.offline_only = offline_only
        self.forge_runs = 0
        self._answers: dict[int, tuple[int, int]] = {}
        if self.path.exists():
            with gzip.open(self.path, "rt") as fh:
                stored = json.load(fh)
            if stored["digest"] != self.digest:
                raise ValueError(f"{self.path} holds answers for another calendar build")
            self._answers = {int(k): (v[0], v[1]) for k, v in stored["answers"].items()}

    def states(self, timestamps) -> dict[int, SessionState]:
        wanted = sorted({int(ts) for ts in timestamps})
        missing = [ts for ts in wanted if ts not in self._answers]
        if missing:
            if self.offline_only:
                raise LookupError(f"{len(missing)} instants have no cached forge answer, first {missing[0]}")
            for i in range(0, len(missing), self.chunk):
                self._run(missing[i : i + self.chunk])
            self._save()
        return {ts: self._state(*self._answers[ts]) for ts in wanted}

    @staticmethod
    def _state(reason: int, opened_at: int) -> SessionState:
        return SessionState(reason == OPEN_REASON, opened_at, reason)

    def _run(self, timestamps: list[int]) -> None:
        packed = b"".join(ts.to_bytes(TIMESTAMP_BYTES, "big") for ts in timestamps)
        script = os.path.relpath(SESSION_SCRIPT, CONTRACTS)
        command = ["forge", "script", script, "--sig", "run(bytes)", "0x" + packed.hex(), "--json"]
        proc = subprocess.run(
            command, cwd=CONTRACTS, env={**os.environ, **FORGE_ENV}, capture_output=True, text=True, timeout=900
        )
        if proc.returncode != 0:
            raise RuntimeError(f"forge script failed ({proc.returncode}): {proc.stderr[-2000:] or proc.stdout[-2000:]}")
        self.forge_runs += 1
        if _sources_digest()[0] != self.digest:
            raise RuntimeError("the calendar library or the oracle script changed while forge ran; rerun the fetch")
        answer = None
        for line in proc.stdout.splitlines():
            line = line.strip()
            if line.startswith("{") and '"returns"' in line:
                answer = json.loads(line)["returns"]["answers"]["value"]
        if answer is None:
            raise RuntimeError(f"forge script printed no return value: {proc.stdout[-2000:]}")
        data = bytes.fromhex(answer.removeprefix("0x"))
        if len(data) != len(timestamps) * ANSWER_BYTES:
            raise RuntimeError(f"forge answered {len(data)} bytes for {len(timestamps)} instants")
        for i, ts in enumerate(timestamps):
            chunk = data[i * ANSWER_BYTES : (i + 1) * ANSWER_BYTES]
            self._answers[ts] = (chunk[0], int.from_bytes(chunk[1:], "big"))

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "digest": self.digest,
            "sources": self.source_hashes,
            "answers": {str(ts): list(v) for ts, v in sorted(self._answers.items())},
        }
        tmp = self.path.with_suffix(".tmp")
        with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
            gz.write(json.dumps(payload, separators=(",", ":")).encode())
        tmp.replace(self.path)


class CheckedSession:
    """Forge answers; the port must agree on every instant ever asked."""

    def __init__(self, forge: ForgeSession, port: PortSession):
        self.forge = forge
        self.port = port
        self.checked: set[int] = set()
        self._states: dict[int, SessionState] = {}

    def states(self, timestamps) -> dict[int, SessionState]:
        wanted = {int(ts) for ts in timestamps}
        new = wanted - self.checked
        if new:
            by_forge = self.forge.states(new)
            by_port = self.port.states(new)
            bad = [ts for ts in sorted(new) if by_forge[ts] != by_port[ts]]
            if bad:
                ts = bad[0]
                raise SessionDisagreement(
                    f"{len(bad)} instants disagree, first {ts}: forge {by_forge[ts]}, port {by_port[ts]}"
                )
            self._states.update(by_forge)
            self.checked |= new
        return {ts: self._states[ts] for ts in wanted}

    def session_state(self, ts: int) -> tuple[bool, int]:
        state = self.states([ts])[int(ts)]
        return state.open, state.opened_at


def open_intervals(session: CheckedSession, first: int, last: int, step: int = 900) -> list[tuple[int, int]]:
    """Open intervals [opens, closes) that meet [first, last], found by scanning a step grid with the session test and
    then every second where the answer changes between two grid points. Assumes no open or closed stretch is shorter
    than a step; the caller checks the result against the port's own intervals."""
    grid = list(range(first - first % step, last + step, step))
    states = session.states(grid)
    changes = [g for g in grid[:-1] if states[g] != states[g + step] and (states[g].open or states[g + step].open)]
    seconds = [s for g in changes for s in range(g + 1, g + step + 1)]
    fine = session.states(seconds)
    boundaries = []
    for g in changes:
        previous = states[g]
        for s in range(g + 1, g + step + 1):
            if fine[s].open != previous.open:
                boundaries.append((s, fine[s].open))
                previous = fine[s]
            elif fine[s].open and fine[s].opened_at != previous.opened_at:
                raise SessionDisagreement(f"opened_at changes inside an open stretch at {s}")
    intervals = []
    start = grid[0] if states[grid[0]].open else None
    if start is not None:
        start = states[grid[0]].opened_at
    for instant, opens in boundaries:
        if opens:
            start = instant
        else:
            if start is None:
                raise SessionDisagreement(f"a close at {instant} with no open before it in the scan")
            intervals.append((start, instant))
            start = None
    if start is not None:
        intervals.append((start, None))
    return intervals
