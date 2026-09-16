from __future__ import annotations

import asyncio
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any


class FakePrepared:
    def __init__(self, database: "FakeD1", sql: str, params: tuple[Any, ...] = ()) -> None:
        self.database = database
        self.sql = sql
        self.params = params

    def bind(self, *params: Any) -> "FakePrepared":
        return FakePrepared(self.database, self.sql, tuple(params))

    async def first(self):
        row = self.database.conn.execute(self.sql, self.params).fetchone()
        return dict(row) if row is not None else None

    async def run(self):
        cursor = self.database.conn.execute(self.sql, self.params)
        rows = [dict(row) for row in cursor.fetchall()] if cursor.description else []
        self.database.conn.commit()
        return SimpleNamespace(
            results=rows,
            meta={"changes": max(0, cursor.rowcount), "last_row_id": cursor.lastrowid},
        )


class FakeD1:
    def __init__(self) -> None:
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.lock = asyncio.Lock()

    def prepare(self, sql: str) -> FakePrepared:
        return FakePrepared(self, sql)

    async def batch(self, prepared: list[FakePrepared]):
        async with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            results = []
            try:
                for statement in prepared:
                    cursor = self.conn.execute(statement.sql, statement.params)
                    rows = ([dict(row) for row in cursor.fetchall()]
                            if cursor.description else [])
                    results.append(SimpleNamespace(
                        results=rows,
                        meta={
                            "changes": max(0, cursor.rowcount),
                            "last_row_id": cursor.lastrowid,
                        },
                    ))
                self.conn.execute("COMMIT")
                return results
            except Exception:
                self.conn.execute("ROLLBACK")
                raise


class FakeArrayBuffer(bytes):
    def to_bytes(self) -> bytes:
        return bytes(self)


@dataclass
class FakeR2Object:
    data: bytes
    customMetadata: dict[str, str]
    uploaded: datetime

    async def arrayBuffer(self) -> FakeArrayBuffer:
        return FakeArrayBuffer(self.data)


class FakeR2:
    def __init__(self) -> None:
        self.objects: dict[str, FakeR2Object] = {}

    async def put(self, key: str, data: bytes, options: Any = None):
        if not isinstance(options, dict):
            options = options.to_py() if hasattr(options, "to_py") else {}
        metadata = dict((options or {}).get("customMetadata") or {})
        self.objects[key] = FakeR2Object(bytes(data), metadata, datetime.now(timezone.utc))

    async def get(self, key: str):
        return self.objects.get(key)
