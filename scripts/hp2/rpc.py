"""JSON-RPC endpoints with the run's rate rules, retries and the response cache.

Rules (task brief and docs/HP2_PROTOCOL.md): historical state only from the archive endpoint, at most 2 requests in
flight there with 0.2 to 0.5 s between requests; logs and block headers from the public endpoint, one request at a
time with pauses, because it answers bursts with a Cloudflare challenge. Both back off exponentially on HTTP 429 and
on errors. Every response is cached before it is used, so an interrupted run resumes and a rerun sends nothing.

A JSON-RPC error that says "execution reverted" is a result, not a failure: it is cached and handed back as a Revert.
Any other error is retried, then the run stops.
"""

import json
import random
import threading
import time
from collections import Counter
from dataclasses import dataclass, field

import requests

from hp2.cache import ResponseCache, normalize

_sleep = time.sleep
_now = time.monotonic
USER_AGENT = "sleeve-hp2-fetch/1"
HEADER_FIELDS = ("number", "hash", "parentHash", "timestamp", "l1BlockNumber")
FATAL_CODES = (-32600, -32601, -32602)


class CacheMiss(Exception):
    """Offline mode needed a response that is not in the cache."""


class FetchFailed(Exception):
    """A request kept failing after every retry."""


class StateUnavailable(FetchFailed):
    """The endpoint no longer serves state at the block asked for (the public endpoint keeps minutes of state)."""


@dataclass(frozen=True)
class Revert:
    code: int | None
    message: str
    data: str | None

    def as_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "data": self.data}


@dataclass
class EndpointStats:
    http_requests: int = 0
    rpc_calls: int = 0
    cache_hits: int = 0
    http_429: int = 0
    rate_limited: int = 0
    cloudflare_challenges: int = 0
    retries: int = 0
    reverts: int = 0
    seconds_waiting_on_network: float = 0.0
    errors: Counter = field(default_factory=Counter)

    def as_dict(self) -> dict:
        return {
            "http_requests": self.http_requests,
            "rpc_calls": self.rpc_calls,
            "cache_hits": self.cache_hits,
            "http_429": self.http_429,
            "rate_limited_json_errors": self.rate_limited,
            "cloudflare_challenges": self.cloudflare_challenges,
            "retries": self.retries,
            "reverts": self.reverts,
            "seconds_waiting_on_network": round(self.seconds_waiting_on_network, 1),
            "errors": dict(sorted(self.errors.items())),
        }


def is_revert(error: dict) -> bool:
    return error.get("code") == 3 or "execution reverted" in str(error.get("message", "")).lower()


def trim(method: str, result):
    """Headers keep the fields the fetch reads, so the cache does not hold every transaction hash."""
    if method == "eth_getBlockByNumber" and isinstance(result, dict):
        return {k: result[k] for k in HEADER_FIELDS if k in result}
    return result


class _Transient(Exception):
    def __init__(self, kind: str, detail: str, cooldown: float | None = None):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.cooldown = cooldown


class Endpoint:
    def __init__(
        self,
        name: str,
        url: str,
        cache: ResponseCache,
        *,
        slots: int,
        pause: tuple[float, float],
        calls_per_second: float | None = None,
        burst: int = 60,
        offline: bool = False,
        max_attempts: int = 12,
        timeout: float = 90.0,
    ):
        self.name = name
        self.url = url
        self.cache = cache
        self.offline = offline
        self.pause = pause
        self.max_attempts = max_attempts
        self.timeout = timeout
        self.stats = EndpointStats()
        self._slots = threading.BoundedSemaphore(slots)
        self._rate = calls_per_second
        self._burst = burst
        self._tokens = float(burst)
        self._tokens_at = _now()
        self._bucket_lock = threading.Lock()
        self._stats_lock = threading.Lock()
        self._cooldown_lock = threading.Lock()
        self._cooldown_until = 0.0
        self._local = threading.local()
        self._sessions: list[requests.Session] = []
        self._ids = iter(range(1, 1 << 62))
        self._id_lock = threading.Lock()

    # Public calls

    def call(self, method: str, params: list):
        """A call that must succeed: a revert here is a failure."""
        outcome = self.call_revertible(method, params)
        if isinstance(outcome, Revert):
            raise FetchFailed(f"{self.name} {method} {params} reverted: {outcome.message}")
        return outcome

    def call_uncached(self, method: str, params: list):
        """For moving values such as eth_blockNumber. Never cached; offline mode refuses it."""
        if self.offline:
            raise CacheMiss(f"{self.name} {method} is never cached")
        result, error = self._send_one(method, normalize(params))
        if error is not None:
            raise FetchFailed(f"{self.name} {method} failed: {error}")
        return result

    def call_revertible(self, method: str, params: list):
        """The result, or a Revert for an eth_call that reverted."""
        params = normalize(params)
        cached = self.cache.get(self.name, method, params)
        if cached is not None:
            self._count(cache_hits=1)
            return self._outcome(cached.result, cached.error)
        if self.offline:
            raise CacheMiss(f"{self.name} {method} {json.dumps(params)}")
        result, error = self._send_one(method, params)
        self.cache.put(self.name, method, params, result=result, error=error)
        return self._outcome(result, error)

    def batch(self, calls: list[tuple[str, list]]) -> list:
        """Several calls in one HTTP request; each response is cached under its own key. Reverts raise."""
        calls = [(m, normalize(p)) for m, p in calls]
        out: list = [None] * len(calls)
        missing = []
        for i, (method, params) in enumerate(calls):
            cached = self.cache.get(self.name, method, params)
            if cached is None:
                missing.append(i)
                continue
            self._count(cache_hits=1)
            out[i] = self._outcome(cached.result, cached.error)
        if missing and self.offline:
            raise CacheMiss(f"{self.name} {calls[missing[0]][0]} {json.dumps(calls[missing[0]][1])}")
        if missing:
            fetched = self._send_batch([calls[i] for i in missing])
            self.cache.put_many(
                [
                    (self.name, calls[i][0], calls[i][1], res, err)
                    for i, (res, err) in zip(missing, fetched, strict=True)
                ]
            )
            for i, (res, err) in zip(missing, fetched, strict=True):
                out[i] = self._outcome(res, err)
        for i, item in enumerate(out):
            if isinstance(item, Revert):
                raise FetchFailed(f"{self.name} {calls[i][0]} {calls[i][1]} reverted: {item.message}")
        return out

    # Transport

    def _outcome(self, result, error):
        if error is not None:
            return Revert(error.get("code"), str(error.get("message", "")), error.get("data"))
        return result

    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            session.headers.update({"Content-Type": "application/json", "User-Agent": USER_AGENT})
            self._local.session = session
            with self._stats_lock:
                self._sessions.append(session)
        return session

    def close(self) -> None:
        with self._stats_lock:
            sessions, self._sessions = self._sessions, []
        for session in sessions:
            session.close()

    def _next_id(self) -> int:
        with self._id_lock:
            return next(self._ids)

    def _count(self, **deltas) -> None:
        with self._stats_lock:
            for name, delta in deltas.items():
                setattr(self.stats, name, getattr(self.stats, name) + delta)

    def _count_error(self, kind: str) -> None:
        with self._stats_lock:
            self.stats.errors[kind] += 1

    def _wait_cooldown(self) -> None:
        while True:
            with self._cooldown_lock:
                wait = self._cooldown_until - _now()
            if wait <= 0:
                return
            _sleep(wait)

    def _set_cooldown(self, seconds: float) -> None:
        with self._cooldown_lock:
            self._cooldown_until = max(self._cooldown_until, _now() + seconds)

    def _take_tokens(self, calls: int) -> None:
        """A token bucket on JSON-RPC calls, since a batch of headers counts as many calls to a rate limit."""
        if self._rate is None:
            return
        with self._bucket_lock:
            now = _now()
            self._tokens = min(self._burst, self._tokens + (now - self._tokens_at) * self._rate)
            self._tokens_at = now
            self._tokens -= calls
            wait = -self._tokens / self._rate if self._tokens < 0 else 0.0
        if wait > 0:
            _sleep(wait)

    def _post(self, payload):
        """One HTTP request inside a slot, followed by the endpoint's pause before the slot frees."""
        self._wait_cooldown()
        with self._slots:
            self._take_tokens(len(payload) if isinstance(payload, list) else 1)
            self._wait_cooldown()
            started = _now()
            try:
                response = self._session().post(self.url, data=json.dumps(payload), timeout=self.timeout)
            except requests.RequestException as exc:
                raise _Transient("transport", type(exc).__name__) from exc
            finally:
                elapsed = _now() - started
                calls = len(payload) if isinstance(payload, list) else 1
                self._count(http_requests=1, rpc_calls=calls, seconds_waiting_on_network=elapsed)
                _sleep(random.uniform(*self.pause))
        text = response.text
        if response.status_code == 429:
            self._count(http_429=1)
            raise _Transient("http_429", text[:200], cooldown=15.0)
        if response.status_code == 403 and ("Just a moment" in text or "cf-mitigated" in str(response.headers)):
            self._count(cloudflare_challenges=1)
            raise _Transient("cloudflare_challenge", "403", cooldown=120.0)
        if response.status_code != 200:
            raise _Transient(f"http_{response.status_code}", text[:200])
        try:
            return response.json()
        except ValueError as exc:
            raise _Transient("bad_json", text[:200]) from exc

    def _with_retries(self, attempt_fn):
        delay = 2.0
        for attempt in range(self.max_attempts):
            try:
                return attempt_fn()
            except _Transient as exc:
                self._count_error(exc.kind)
                if attempt == self.max_attempts - 1:
                    raise FetchFailed(f"{self.name}: gave up after {self.max_attempts} attempts, last {exc}") from exc
                self._count(retries=1)
                wait = max(delay, exc.cooldown or 0.0) * random.uniform(0.8, 1.2)
                if exc.cooldown:
                    self._set_cooldown(wait)
                _sleep(wait)
                delay = min(delay * 2, 300.0 if exc.kind == "cloudflare_challenge" else 120.0)
        raise AssertionError("unreachable")

    def _check_error(self, method: str, params, error: dict):
        if is_revert(error):
            self._count(reverts=1)
            return error
        message = str(error.get("message", ""))
        if "historical state" in message or "missing trie node" in message:
            self._count_error("state_unavailable")
            raise StateUnavailable(f"{self.name} {method} {params}: {message}")
        if error.get("code") in FATAL_CODES or "narrow the block range" in message:
            self._count_error(f"rpc_{error.get('code')}")
            raise FetchFailed(f"{self.name} {method} {params}: {message}")
        if error.get("code") in (429, -32005) or "rate limit" in message.lower() or "too many" in message.lower():
            self._count(rate_limited=1)
            raise _Transient("rpc_rate_limited", message[:200], cooldown=15.0)
        raise _Transient(f"rpc_{error.get('code')}", f"{method} {params} {message}")

    def _send_one(self, method: str, params: list):
        def attempt():
            body = self._post({"jsonrpc": "2.0", "id": self._next_id(), "method": method, "params": params})
            if not isinstance(body, dict):
                raise _Transient("bad_shape", str(body)[:200])
            if "error" in body:
                return None, self._check_error(method, params, body["error"])
            if "result" not in body or body["result"] is None:
                raise _Transient("null_result", f"{method} {params}")
            return trim(method, body["result"]), None

        return self._with_retries(attempt)

    def _send_batch(self, calls: list[tuple[str, list]]) -> list[tuple[object, object]]:
        results: dict[int, tuple[object, object]] = {}

        def attempt():
            pending = [i for i in range(len(calls)) if i not in results]
            ids = {self._next_id(): i for i in pending}
            payload = [
                {"jsonrpc": "2.0", "id": rid, "method": calls[i][0], "params": calls[i][1]} for rid, i in ids.items()
            ]
            body = self._post(payload)
            if not isinstance(body, list):
                raise _Transient("bad_batch_shape", str(body)[:200])
            for item in body:
                i = ids.get(item.get("id"))
                if i is None:
                    continue
                method, params = calls[i]
                if "error" in item:
                    if is_revert(item["error"]):
                        self._count(reverts=1)
                        results[i] = (None, item["error"])
                    elif item["error"].get("code") in FATAL_CODES:
                        raise FetchFailed(f"{self.name} {method} {params}: {item['error'].get('message')}")
                    else:
                        self._count_error(f"rpc_{item['error'].get('code')}")
                    continue
                if item.get("result") is None:
                    self._count_error("null_result")
                    continue
                results[i] = (trim(method, item["result"]), None)
            if len(results) < len(calls):
                raise _Transient("batch_incomplete", f"{len(calls) - len(results)} of {len(calls)} missing")
            return [results[i] for i in range(len(calls))]

        return self._with_retries(attempt)


def endpoints(cache: ResponseCache, archive_url: str, public_url: str, offline: bool) -> tuple[Endpoint, Endpoint]:
    archive = Endpoint("archive", archive_url, cache, slots=2, pause=(0.2, 0.5), offline=offline)
    public = Endpoint("public", public_url, cache, slots=1, pause=(0.3, 0.6), calls_per_second=6.0, offline=offline)
    return archive, public
