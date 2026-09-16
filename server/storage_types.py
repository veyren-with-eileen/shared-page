"""Runtime-neutral calendar persistence contracts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional, Protocol, Sequence


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
