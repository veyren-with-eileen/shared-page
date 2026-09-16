from __future__ import annotations

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2]))

from cloudflare.tools.export_sqlite_to_d1 import export_sqlite
from cloudflare.tools.upload_pages_to_r2 import page_files, upload


MIGRATION = Path(__file__).parents[2] / "cloudflare/application/migrations/0001_calendar.sql"


class MigrationToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_export_preserves_all_current_calendar_tables_and_soft_deletes(self):
        source = self.root / "calendar.db"
        connection = sqlite3.connect(source)
        connection.executescript(MIGRATION.read_text(encoding="utf-8"))
        connection.execute(
            "INSERT INTO calendar_events(id,title,starts_at,ends_at,timezone,precision,"
            "source,created_by,revision,status,metadata,created_at,updated_at,deleted_at) "
            "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ("cal_1", "deleted", "2026-09-15T02:00:00+00:00",
             "2026-09-15T03:00:00+00:00", "Asia/Taipei", "hour", "manual",
             "kitty", 2, "deleted", "{}", "created", "updated", "deleted-at"),
        )
        connection.execute(
            "INSERT INTO calendar_event_changes"
            "(id,event_id,event_revision,action,actor,source,snapshot,notify_master,created_at) "
            "VALUES(1,'cal_1',2,'delete','kitty','manual','{}',1,'changed')"
        )
        connection.execute(
            "INSERT INTO calendar_change_receipts(change_id,consumer,state) "
            "VALUES(1,'master','unseen')"
        )
        connection.execute(
            "INSERT INTO calendar_comments"
            "(id,event_id,anchor_date,author,body,liked,row_version,created_at,updated_at) "
            "VALUES('cmt_1',NULL,'2026-09-15','kitty','note',1,3,'created','updated')"
        )
        connection.execute(
            "INSERT INTO calendar_consumer_state"
            "(consumer,conversation_id,last_now_signature,updated_at) "
            "VALUES('master','conversation','sig','updated')"
        )
        connection.commit()
        connection.close()

        output = self.root / "import.sql"
        counts = export_sqlite(source, output)
        self.assertEqual(set(counts.values()), {1})
        sql = output.read_text(encoding="utf-8")
        self.assertIn("legacy-change:1", sql)
        self.assertNotIn("BEGIN TRANSACTION", sql)
        self.assertNotIn("COMMIT;", sql)
        self.assertNotIn("PRAGMA foreign_keys", sql)

        target = sqlite3.connect(":memory:")
        target.executescript(MIGRATION.read_text(encoding="utf-8"))
        target.execute("PRAGMA foreign_keys=ON")
        target.executescript(sql)
        event = target.execute("SELECT status,revision,deleted_at FROM calendar_events").fetchone()
        self.assertEqual(event, ("deleted", 2, "deleted-at"))
        self.assertEqual(target.execute("SELECT COUNT(*) FROM calendar_comments").fetchone()[0], 1)

    def test_page_migration_only_accepts_exact_valid_pngs(self):
        pages = self.root / "pages"
        pages.mkdir()
        valid = pages / "2026-09-15.png"
        valid.write_bytes(b"\x89PNG\r\n\x1a\npage")
        (pages / "ignore.txt").write_text("no")
        self.assertEqual(page_files(pages), [valid])
        commands = upload(pages, "bucket", self.root / "wrangler.jsonc", False)
        self.assertEqual(len(commands), 1)
        self.assertIn("bucket/pages/2026-09-15.png", commands[0])

    def test_invalid_page_is_rejected_before_upload(self):
        pages = self.root / "pages"
        pages.mkdir()
        (pages / "2026-09-15.png").write_bytes(b"not-png")
        with self.assertRaises(ValueError):
            page_files(pages)


if __name__ == "__main__":
    unittest.main()
