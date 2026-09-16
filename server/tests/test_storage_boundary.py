from __future__ import annotations

import asyncio
import unittest

import calendar_core as cal
from storage import Statement, StorageConflict
from tests.support import MemoryStorage


class StorageBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.storage = MemoryStorage()
        await self.storage.connect()
        await cal.ensure_calendar_schema(self.storage)

    async def asyncTearDown(self) -> None:
        await self.storage.close()

    async def test_failed_batch_rolls_back_every_statement(self):
        with self.assertRaises(StorageConflict):
            await self.storage.batch([
                Statement(
                    "INSERT INTO calendar_consumer_state"
                    "(consumer,conversation_id,last_now_signature,updated_at) VALUES(?,?,?,?)",
                    ("master", "same", "one", "2026-01-01T00:00:00+00:00"),
                ),
                Statement(
                    "INSERT INTO calendar_consumer_state"
                    "(consumer,conversation_id,last_now_signature,updated_at) VALUES(?,?,?,?)",
                    ("master", "same", "two", "2026-01-01T00:00:00+00:00"),
                ),
            ])
        row = await self.storage.fetch_one(
            "SELECT * FROM calendar_consumer_state WHERE conversation_id='same'"
        )
        self.assertIsNone(row)

    async def test_duplicate_explicit_create_has_one_change_and_receipt(self):
        payload = {"title": "唯一", "starts_at": "2026-09-15T10:00:00+08:00"}
        first, second = await asyncio.gather(
            cal.create_event(self.storage, payload, actor="kitty", event_id="cal_fixed"),
            cal.create_event(self.storage, payload, actor="kitty", event_id="cal_fixed"),
        )
        self.assertEqual(sorted([first["created"], second["created"]]), [False, True])
        changes = await self.storage.fetch_all(
            "SELECT * FROM calendar_event_changes WHERE event_id='cal_fixed'"
        )
        receipts = await self.storage.fetch_all(
            "SELECT * FROM calendar_change_receipts"
        )
        self.assertEqual(len(changes), 1)
        self.assertEqual(len(receipts), 1)

    async def test_concurrent_updates_do_not_lose_revision(self):
        event = await cal.create_event(
            self.storage,
            {"title": "before", "starts_at": "2026-09-15T10:00:00+08:00"},
            actor="kitty",
        )
        await asyncio.gather(
            cal.update_event(self.storage, event["id"], {"title": "first"}, actor="kitty"),
            cal.update_event(self.storage, event["id"], {"description": "second"}, actor="kitty"),
        )
        current = await cal.get_event(self.storage, event["id"])
        self.assertEqual(current["revision"], 3)
        self.assertEqual(current["description"], "second")
        changes = await self.storage.fetch_all(
            "SELECT * FROM calendar_event_changes WHERE event_id=? ORDER BY id",
            (event["id"],),
        )
        self.assertEqual([row["event_revision"] for row in changes], [1, 2, 3])

    async def test_concurrent_like_true_records_one_transition(self):
        note = await cal.add_note(
            self.storage, body="hello", author="master", anchor_date="2026-09-15"
        )
        await asyncio.gather(
            cal.update_note(self.storage, note["id"], {"liked": True}, actor="kitty"),
            cal.update_note(self.storage, note["id"], {"liked": True}, actor="kitty"),
        )
        rows = await self.storage.fetch_all(
            "SELECT * FROM calendar_event_changes WHERE action='like'"
        )
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main()
