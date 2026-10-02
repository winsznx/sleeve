"""Response cache keyed by JSON-RPC method and params, which carry the block. A rerun reads it instead of the network.

The working cache is SQLite, so every response is on disk the moment it arrives and an interrupted fetch resumes where
it stopped. export_compact writes the committed form, gzip JSONL sorted by key with a fixed gzip header, and
import_compact rebuilds the SQLite file from it.
"""

import gzip
import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

KEY_VERSION = 2


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def normalize(value):
    """Lowercase every hex string, so checksummed and lowercase addresses share one key."""
    if isinstance(value, str) and value.startswith("0x"):
        return value.lower()
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    return value


def request_key(endpoint: str, method: str, params) -> str:
    """The endpoint is part of the key: the same request to two providers is two observations."""
    return hashlib.sha256(canonical([endpoint, method, normalize(params)]).encode()).hexdigest()


class Entry:
    __slots__ = ("result", "error")

    def __init__(self, result, error):
        self.result = result
        self.error = error


class ResponseCache:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._lock = threading.Lock()
        self._db = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA synchronous=NORMAL")
        self._db.execute(
            "CREATE TABLE IF NOT EXISTS responses (key TEXT PRIMARY KEY, endpoint TEXT NOT NULL, method TEXT NOT NULL,"
            " params TEXT NOT NULL, result TEXT, error TEXT, fetched_at REAL NOT NULL)"
        )
        self._db.execute("CREATE INDEX IF NOT EXISTS responses_method ON responses (method)")
        self._db.execute("CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
        self._rekey()

    def _rekey(self) -> None:
        """Version 1 keys left the endpoint out; recompute them once."""
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE name = 'key_version'").fetchone()
            if row is not None and json.loads(row[0]) == KEY_VERSION:
                return
            rows = self._db.execute("SELECT key, endpoint, method, params FROM responses").fetchall()
            self._db.execute("BEGIN")
            for key, endpoint, method, params in rows:
                new = request_key(endpoint, method, json.loads(params))
                if new != key:
                    self._db.execute("UPDATE responses SET key = ? WHERE key = ?", (new, key))
            self._db.execute("INSERT OR REPLACE INTO meta VALUES ('key_version', ?)", (canonical(KEY_VERSION),))
            self._db.execute("COMMIT")

    def get(self, endpoint: str, method: str, params) -> Entry | None:
        with self._lock:
            row = self._db.execute(
                "SELECT result, error FROM responses WHERE key = ?", (request_key(endpoint, method, params),)
            ).fetchone()
        if row is None:
            return None
        return Entry(None if row[0] is None else json.loads(row[0]), None if row[1] is None else json.loads(row[1]))

    def put(self, endpoint: str, method: str, params, result=None, error=None) -> None:
        params = normalize(params)
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    request_key(endpoint, method, params),
                    endpoint,
                    method,
                    canonical(params),
                    None if result is None else canonical(result),
                    None if error is None else canonical(error),
                    time.time(),
                ),
            )

    def put_many(self, rows: list[tuple[str, str, object, object, object]]) -> None:
        """rows of (endpoint, method, params, result, error), written in one transaction."""
        now = time.time()
        with self._lock:
            self._db.execute("BEGIN")
            self._db.executemany(
                "INSERT OR REPLACE INTO responses VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        request_key(endpoint, method, params),
                        endpoint,
                        method,
                        canonical(normalize(params)),
                        None if result is None else canonical(result),
                        None if error is None else canonical(error),
                        now,
                    )
                    for endpoint, method, params, result, error in rows
                ],
            )
            self._db.execute("COMMIT")

    def by_method(self, endpoint: str, method: str):
        with self._lock:
            rows = self._db.execute(
                "SELECT params, result FROM responses WHERE endpoint = ? AND method = ? AND result IS NOT NULL",
                (endpoint, method),
            ).fetchall()
        return [(json.loads(p), json.loads(r)) for p, r in rows]

    def meta(self, name: str):
        with self._lock:
            row = self._db.execute("SELECT value FROM meta WHERE name = ?", (name,)).fetchone()
        return None if row is None else json.loads(row[0])

    def set_meta(self, name: str, value) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (name, canonical(value)))

    def delete_meta(self, name: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM meta WHERE name = ?", (name,))

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM responses").fetchone()[0]

    def export_compact(self, path: Path, keep_headers: set[int] | None = None) -> int:
        """Every response and pin as gzip JSONL, byte for byte the same for the same contents. With keep_headers,
        block headers outside that set are left out: the search headers a lookup read on its way are not needed once
        each instant's answer and its proof pair are kept."""
        with self._lock:
            rows = self._db.execute(
                "SELECT key, endpoint, method, params, result, error FROM responses ORDER BY key"
            ).fetchall()
            metas = self._db.execute("SELECT name, value FROM meta ORDER BY name").fetchall()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        written = 0
        with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
            for name, value in metas:
                gz.write((canonical({"meta": name, "v": json.loads(value)}) + "\n").encode())
            for key, endpoint, method, params, result, error in rows:
                pruned = keep_headers is not None and method == "eth_getBlockByNumber"
                if pruned and int(json.loads(params)[0], 16) not in keep_headers:
                    continue
                written += 1
                line = {"k": key, "e": endpoint, "m": method, "p": json.loads(params)}
                if result is not None:
                    line["r"] = json.loads(result)
                if error is not None:
                    line["x"] = json.loads(error)
                gz.write((canonical(line) + "\n").encode())
        tmp.replace(path)
        return written

    def import_compact(self, path: Path) -> int:
        rows = []
        with gzip.open(path, "rt") as fh:
            for line in fh:
                item = json.loads(line)
                if "meta" in item:
                    self.set_meta(item["meta"], item["v"])
                    continue
                if request_key(item["e"], item["m"], item["p"]) != item["k"]:
                    raise ValueError(f"compact cache line has a key that does not match its request: {item['k']}")
                rows.append((item["e"], item["m"], item["p"], item.get("r"), item.get("x")))
        self.put_many(rows)
        return len(rows)

    def close(self) -> None:
        with self._lock:
            self._db.close()
