"""D1 and R2 adapters for the Cloudflare Python Worker runtime."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Sequence

from storage_types import (
    CalendarStorage,
    PageObject,
    PageStorage,
    Statement,
    StorageConflict,
    WriteResult,
)


def _to_python(value: Any) -> Any:
    """Convert Workers JS proxies without making tests depend on Pyodide."""
    if value is None or isinstance(value, (str, int, float, bool, bytes, bytearray)):
        return value
    if isinstance(value, dict):
        return {str(key): _to_python(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_python(item) for item in value]
    to_py = getattr(value, "to_py", None)
    if callable(to_py):
        try:
            return _to_python(to_py())
        except TypeError:
            return _to_python(to_py(dict_converter=dict))
    try:
        return {str(key): _to_python(value[key]) for key in value.keys()}
    except (AttributeError, TypeError):
        return value


def _to_javascript(value: Any) -> Any:
    try:
        from pyodide.ffi import to_js
    except ImportError:
        return value
    return to_js(value)


class R2PageStorage(PageStorage):
    def __init__(self, bucket: Any) -> None:
        self.bucket = bucket

    @staticmethod
    def key(day: str) -> str:
        return f"pages/{day}.png"

    async def get(self, day: str) -> Optional[PageObject]:
        obj = await self.bucket.get(self.key(day))
        if obj is None:
            return None
        raw = await obj.arrayBuffer()
        try:
            data = raw.to_bytes()
        except AttributeError:
            data = bytes(raw)
        metadata = _to_python(getattr(obj, "customMetadata", None)) or {}
        stamp = metadata.get("snapshot_uploaded_at")
        if stamp:
            uploaded_at = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        else:
            uploaded = getattr(obj, "uploaded", None)
            if hasattr(uploaded, "toISOString"):
                uploaded = uploaded.toISOString()
            uploaded_at = datetime.fromisoformat(str(uploaded).replace("Z", "+00:00"))
        if uploaded_at.tzinfo is None:
            uploaded_at = uploaded_at.replace(tzinfo=timezone.utc)
        return PageObject(data=data, uploaded_at=uploaded_at.astimezone(timezone.utc))

    async def put(self, day: str, data: bytes) -> PageObject:
        uploaded_at = datetime.now(timezone.utc)
        options = {
            "httpMetadata": {"contentType": "image/png"},
            "customMetadata": {
                "snapshot_uploaded_at": uploaded_at.isoformat(timespec="microseconds")
            },
        }
        await self.bucket.put(self.key(day), data, _to_javascript(options))
        return PageObject(data=data, uploaded_at=uploaded_at)


class D1Storage(CalendarStorage):
    """Production calendar adapter. Schema is managed only by D1 migrations."""

    def __init__(self, database: Any, pages_bucket: Any) -> None:
        self.database = database
        self.pages: PageStorage = R2PageStorage(pages_bucket)

    async def ensure_schema(self, ddl: str) -> None:
        # Cloudflare production schema is applied by `wrangler d1 migrations apply`.
        return None

    def _prepared(self, statement: Statement) -> Any:
        prepared = self.database.prepare(statement.sql)
        return prepared.bind(*statement.params) if statement.params else prepared

    async def fetch_one(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        value = await self._prepared(Statement(sql, params)).first()
        return _to_python(value)

    async def fetch_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[Any]:
        result = await self._prepared(Statement(sql, params)).run()
        converted = _to_python(getattr(result, "results", None))
        if converted is None and isinstance(result, dict):
            converted = _to_python(result.get("results"))
        return list(converted or [])

    async def batch(self, statements: Sequence[Statement]) -> list[WriteResult]:
        if not statements:
            return []
        prepared = [self._prepared(statement) for statement in statements]
        try:
            raw_results = await self.database.batch(prepared)
        except Exception as exc:
            message = str(exc).lower()
            if "constraint" in message or "unique" in message:
                raise StorageConflict(str(exc)) from exc
            raise
        results: list[WriteResult] = []
        for raw in raw_results:
            meta = _to_python(getattr(raw, "meta", None)) or {}
            results.append(WriteResult(
                changes=int(meta.get("changes") or 0),
                last_row_id=(int(meta["last_row_id"])
                             if meta.get("last_row_id") is not None else None),
            ))
        return results
