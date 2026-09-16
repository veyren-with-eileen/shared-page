"""Test storage backed by an isolated in-memory SQLite database."""

from __future__ import annotations

import tempfile

from storage import SQLiteStorage


class MemoryStorage(SQLiteStorage):
    def __init__(self) -> None:
        self._pages_tmp = tempfile.TemporaryDirectory()
        super().__init__(":memory:", self._pages_tmp.name)
        self.settings: dict = {}

    async def close(self) -> None:
        await super().close()
        self._pages_tmp.cleanup()

    async def get_setting(self, key):
        return self.settings.get(key)

    async def set_setting(self, key, value) -> None:
        self.settings[key] = value
