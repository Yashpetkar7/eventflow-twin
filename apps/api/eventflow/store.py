"""Durable state for the product layer: event chains, users and sessions (docs/15 §8, decision #132).

One small interface over two back ends, chosen at start-up:

    DATABASE_URL=postgresql://…   Postgres (needs `psycopg`, installed with `pip install -r requirements-saas.txt`)
    otherwise                     SQLite in EVENTFLOW_DATA_DIR (or data/) — no server, works offline at the booth

The booth and the tests use SQLite; nothing here needs the internet. Values are JSON documents keyed by an id, with
the timestamps kept as columns so lists can be ordered. On the hosted site (Vercel) the SQLite file lives in /tmp and
does not survive a restart: set DATABASE_URL to keep chains and users.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .config import ROOT

_TABLES = ("chains", "users", "sessions")
_LOCK = threading.Lock()


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Store:
    """Key → JSON document per table. `put` inserts or replaces; `list` is newest first."""

    def __init__(self, url: str | None = None):
        self.url = url if url is not None else os.environ.get("DATABASE_URL", "")
        self.kind = "postgres" if self.url.startswith(("postgres://", "postgresql://")) else "sqlite"
        if self.kind == "sqlite":
            folder = Path(os.environ.get("EVENTFLOW_DATA_DIR") or ROOT / "data") / "processed"
            folder.mkdir(parents=True, exist_ok=True)
            self.path = Path(self.url) if self.url else folder / "eventflow.db"
            self._conn = sqlite3.connect(self.path, check_same_thread=False)
            self._ph = "?"
        else:
            import psycopg                                   # imported only when Postgres is configured
            self.path = None
            self._conn = psycopg.connect(self.url, autocommit=True)
            self._ph = "%s"
        with _LOCK:
            cur = self._conn.cursor()
            for t in _TABLES:
                cur.execute(f"CREATE TABLE IF NOT EXISTS {t} (id TEXT PRIMARY KEY, created TEXT NOT NULL, updated TEXT NOT NULL, "
                            f"owner TEXT, doc TEXT NOT NULL)")
            if self.kind == "sqlite":
                self._conn.commit()

    def _q(self, sql: str, args: tuple = ()) -> list[tuple]:
        with _LOCK:
            cur = self._conn.cursor()
            cur.execute(sql.replace("?", self._ph), args)
            rows = cur.fetchall() if cur.description else []
            if self.kind == "sqlite":
                self._conn.commit()
            return rows

    def put(self, table: str, key: str, doc: dict, owner: str | None = None) -> None:
        assert table in _TABLES
        now = _now()
        old = self._q(f"SELECT created FROM {table} WHERE id = ?", (key,))
        created = old[0][0] if old else now
        body = json.dumps(doc, ensure_ascii=False, default=str)
        if old:
            self._q(f"UPDATE {table} SET updated = ?, owner = ?, doc = ? WHERE id = ?", (now, owner, body, key))
        else:
            self._q(f"INSERT INTO {table} (id, created, updated, owner, doc) VALUES (?, ?, ?, ?, ?)", (key, created, now, owner, body))

    def get(self, table: str, key: str) -> dict | None:
        assert table in _TABLES
        rows = self._q(f"SELECT doc FROM {table} WHERE id = ?", (key,))
        return json.loads(rows[0][0]) if rows else None

    def list(self, table: str, owner: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
        assert table in _TABLES
        limit = max(1, min(int(limit), 500))
        if owner is None:
            rows = self._q(f"SELECT id, created, updated, owner FROM {table} ORDER BY updated DESC LIMIT {limit}")
        else:
            rows = self._q(f"SELECT id, created, updated, owner FROM {table} WHERE owner = ? ORDER BY updated DESC LIMIT {limit}", (owner,))
        return [{"id": r[0], "created": r[1], "updated": r[2], "owner": r[3]} for r in rows]

    def delete(self, table: str, key: str) -> None:
        assert table in _TABLES
        self._q(f"DELETE FROM {table} WHERE id = ?", (key,))


_STORE: Store | None = None


def store() -> Store:
    """The process-wide store (created on first use, so importing the API never touches the disk)."""
    global _STORE
    if _STORE is None:
        _STORE = Store()
    return _STORE


def reset_store(s: Store | None = None) -> None:
    """Tests point the API at a fresh store."""
    global _STORE
    _STORE = s
