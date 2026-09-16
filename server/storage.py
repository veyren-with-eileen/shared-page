"""Persistence boundaries shared by the local and Cloudflare runtimes.

The calendar domain only depends on this small SQL/page interface.  Local
development keeps SQLite and the filesystem; production adapters live in
``cloudflare_storage.py`` and use D1/R2.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Protocol, Sequence

import aiosqlite


@dataclass(frozen=True)
class Statement:
    sql: str
    params: tuple[Any, ...] = ()


@dataclass(frozen=True)
class WriteResult:
    changes: int = 0
    last_row_id: Optional[int] = None


@dataclass(frozen=True)
class PageObject:
    data: bytes
    uploaded_at: datetime


class StorageConflict(RuntimeError):
    """A uniqueness or compare-and-swap write lost a concurrent race."""


class PageStorage(Protocol):
    async def get(self, day: str) -> Optional[PageObject]: ...
    async def put(self, day: str, data: bytes) -> PageObject: ...


class CalendarStorage(Protocol):
    pages: PageStorage

    async def ensure_schema(self, ddl: str) -> None: ...
    async def fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> Any: ...
    async def fetch_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[Any]: ...
    async def batch(self, statements: Sequence[Statement]) -> list[WriteResult]: ...


class LocalPageStorage:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _path(self, day: str) -> Path:
        return self.root / f"{day}.png"

    async def get(self, day: str) -> Optional[PageObject]:
        path = self._path(day)
        if not path.is_file():
            return None
        stat = path.stat()
        return PageObject(
            data=path.read_bytes(),
            uploaded_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        )

    async def put(self, day: str, data: bytes) -> PageObject:
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._path(day)
        temporary = self.root / f".{day}.{os.urandom(8).hex()}.tmp"
        try:
            temporary.write_bytes(data)
            temporary.replace(target)
        except OSError:
            temporary.unlink(missing_ok=True)
            raise
        return PageObject(data=data, uploaded_at=datetime.now(timezone.utc))


class SQLiteStorage:
    """Local reference adapter with serialized atomic write batches."""

    def __init__(self, db_path: str | Path, pages_dir: str | Path) -> None:
        self.db_path = Path(db_path)
        self.pages: PageStorage = LocalPageStorage(pages_dir)
        self._conn: Optional[aiosqlite.Connection] = None
        self._schema_ready = False
        self._write_lock = asyncio.Lock()

    async def connect(self) -> None:
        if str(self.db_path) != ":memory:":
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = await aiosqlite.connect(str(self.db_path))
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA busy_timeout=5000")

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None
            self._schema_ready = False

    def _require_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("storage is not connected")
        return self._conn

    async def ensure_schema(self, ddl: str) -> None:
        if self._schema_ready:
            return
        async with self._write_lock:
            if self._schema_ready:
                return
            conn = self._require_conn()
            await self._migrate_legacy_comments(conn)
            await conn.executescript(ddl)
            await self._add_current_columns(conn)
            await conn.commit()
            self._schema_ready = True

    async def _add_current_columns(self, conn: aiosqlite.Connection) -> None:
        changes = [row[1] for row in await (await conn.execute(
            "PRAGMA table_info(calendar_event_changes)"
        )).fetchall()]
        if changes and "mutation_key" not in changes:
            await conn.execute("ALTER TABLE calendar_event_changes ADD COLUMN mutation_key TEXT")
        comments = [row[1] for row in await (await conn.execute(
            "PRAGMA table_info(calendar_comments)"
        )).fetchall()]
        if comments and "row_version" not in comments:
            await conn.execute(
                "ALTER TABLE calendar_comments ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1"
            )
        await conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_changes_mutation "
            "ON calendar_event_changes(mutation_key) WHERE mutation_key IS NOT NULL"
        )

    async def _migrate_legacy_comments(self, conn: aiosqlite.Connection) -> None:
        cols = [row[1] for row in await (await conn.execute(
            "PRAGMA table_info(calendar_comments)"
        )).fetchall()]
        if not cols or "anchor_date" in cols:
            return
        await conn.execute("BEGIN IMMEDIATE")
        try:
            rows = await (await conn.execute(
                "SELECT c.id,c.event_id,c.author,c.body,c.created_at,c.updated_at,"
                "c.deleted_at,e.starts_at FROM calendar_comments c "
                "LEFT JOIN calendar_events e ON e.id=c.event_id"
            )).fetchall()
            await conn.execute("DROP INDEX IF EXISTS idx_calendar_comments_event")
            await conn.execute("ALTER TABLE calendar_comments RENAME TO calendar_comments_v1")
            await conn.execute("""CREATE TABLE calendar_comments (
              id TEXT PRIMARY KEY, event_id TEXT, anchor_date TEXT NOT NULL,
              author TEXT NOT NULL, body TEXT NOT NULL, y REAL,
              liked INTEGER NOT NULL DEFAULT 0, row_version INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
              FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE SET NULL
            )""")
            for row in rows:
                raw = row[7] or row[4]
                try:
                    value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
                    if value.tzinfo is None:
                        value = value.replace(tzinfo=timezone.utc)
                    anchor = value.date().isoformat()
                except (TypeError, ValueError):
                    anchor = datetime.now(timezone.utc).date().isoformat()
                await conn.execute(
                    "INSERT INTO calendar_comments"
                    "(id,event_id,anchor_date,author,body,y,liked,row_version,created_at,updated_at,deleted_at) "
                    "VALUES(?,?,?,?,?,NULL,0,1,?,?,?)",
                    (row[0], row[1], anchor, row[2], row[3], row[4], row[5], row[6]),
                )
            await conn.execute("COMMIT")
        except Exception:
            await conn.execute("ROLLBACK")
            raise

    async def fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        async with self._require_conn().execute(sql, params) as cursor:
            return await cursor.fetchone()

    async def fetch_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[Any]:
        async with self._require_conn().execute(sql, params) as cursor:
            return list(await cursor.fetchall())

    async def batch(self, statements: Sequence[Statement]) -> list[WriteResult]:
        if not statements:
            return []
        conn = self._require_conn()
        async with self._write_lock:
            await conn.execute("BEGIN IMMEDIATE")
            results: list[WriteResult] = []
            try:
                for statement in statements:
                    cursor = await conn.execute(statement.sql, statement.params)
                    results.append(WriteResult(
                        changes=max(0, cursor.rowcount),
                        last_row_id=cursor.lastrowid,
                    ))
                await conn.execute("COMMIT")
                return results
            except aiosqlite.IntegrityError as exc:
                await conn.execute("ROLLBACK")
                raise StorageConflict(str(exc)) from exc
            except Exception:
                await conn.execute("ROLLBACK")
                raise
