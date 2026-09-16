from __future__ import annotations

import asyncio
import unittest
from pathlib import Path

import calendar_core as cal
from cloudflare_storage import D1Storage
from tests.cloudflare_fakes import FakeD1, FakeR2


MIGRATION = (Path(__file__).parents[2] / "cloudflare/application/migrations/0001_calendar.sql")


class CloudflareStorageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.db = FakeD1()
        self.db.conn.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.r2 = FakeR2()
        self.storage = D1Storage(self.db, self.r2)

    async def test_event_change_and_receipt_are_atomic(self):
        event = await cal.create_event(
            self.storage,
            {"title": "D1", "starts_at": "2026-09-15T10:00:00+08:00"},
            actor="kitty",
        )
        self.assertTrue(event["created"])
        self.assertEqual(len(await self.storage.fetch_all(
            "SELECT * FROM calendar_event_changes"
        )), 1)
        self.assertEqual(len(await self.storage.fetch_all(
            "SELECT * FROM calendar_change_receipts"
        )), 1)

    async def test_concurrent_event_updates_preserve_revisions(self):
        event = await cal.create_event(
            self.storage,
            {"title": "D1", "starts_at": "2026-09-15T10:00:00+08:00"},
            actor="kitty",
        )
        await asyncio.gather(
            cal.update_event(self.storage, event["id"], {"title": "one"}, actor="kitty"),
            cal.update_event(self.storage, event["id"], {"description": "two"}, actor="kitty"),
        )
        current = await cal.get_event(self.storage, event["id"])
        self.assertEqual(current["revision"], 3)
        self.assertEqual(current["description"], "two")

    async def test_concurrent_like_transition_is_logged_once(self):
        note = await cal.add_note(
            self.storage, body="hello", author="master", anchor_date="2026-09-15"
        )
        await asyncio.gather(
            cal.update_note(self.storage, note["id"], {"liked": True}, actor="kitty"),
            cal.update_note(self.storage, note["id"], {"liked": True}, actor="kitty"),
        )
        likes = await self.storage.fetch_all(
            "SELECT * FROM calendar_event_changes WHERE action='like'"
        )
        self.assertEqual(len(likes), 1)

    async def test_r2_uses_exact_page_key_and_preserves_timestamp(self):
        png = b"\x89PNG\r\n\x1a\nhello"
        written = await self.storage.pages.put("2026-09-15", png)
        self.assertIn("pages/2026-09-15.png", self.r2.objects)
        read = await self.storage.pages.get("2026-09-15")
        self.assertEqual(read.data, png)
        self.assertEqual(read.uploaded_at, written.uploaded_at)

    async def test_see_reads_r2_and_reports_later_master_change(self):
        await cal.create_event(
            self.storage,
            {"title": "before", "starts_at": "2026-09-15T10:00:00+08:00"},
            actor="master",
        )
        await self.storage.pages.put("2026-09-15", b"\x89PNG\r\n\x1a\nold")
        await cal.create_event(
            self.storage,
            {"title": "after", "starts_at": "2026-09-15T11:00:00+08:00"},
            actor="master",
        )
        result = await cal.execute_calendar_see(self.storage, {"date": "2026-09-15"})
        self.assertEqual(result.image_bytes(), b"\x89PNG\r\n\x1a\nold")
        self.assertIn("图之后你又动过", result.text)


if __name__ == "__main__":
    unittest.main()
