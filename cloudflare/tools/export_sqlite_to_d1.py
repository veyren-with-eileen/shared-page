#!/usr/bin/env python3
"""Export the five calendar tables as deterministic D1-compatible SQL."""

from __future__ import annotations

import argparse
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo


TABLE_COLUMNS = {
    "calendar_events": (
        "id", "title", "description", "starts_at", "ends_at", "timezone",
        "precision", "event_type", "source", "created_by", "source_message_id",
        "revision", "status", "metadata", "created_at", "updated_at", "deleted_at",
    ),
    "calendar_event_changes": (
        "id", "event_id", "event_revision", "action", "actor", "source", "snapshot",
        "notify_master", "mutation_key", "created_at",
    ),
    "calendar_change_receipts": (
        "change_id", "consumer", "state", "seen_at", "channel",
    ),
    "calendar_comments": (
        "id", "event_id", "anchor_date", "author", "body", "y", "liked",
        "row_version", "created_at", "updated_at", "deleted_at",
    ),
    "calendar_consumer_state": (
        "consumer", "conversation_id", "last_now_signature", "updated_at",
    ),
}

ORDER_BY = {
    "calendar_events": "id",
    "calendar_event_changes": "id",
    "calendar_change_receipts": "change_id, consumer",
    "calendar_comments": "id",
    "calendar_consumer_state": "consumer, conversation_id",
}


def sql_literal(value: Any) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return f"X'{value.hex()}'"
    return "'" + str(value).replace("'", "''") + "'"


def _table_columns(connection: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in connection.execute(f"PRAGMA table_info({table})")}


def _anchor(raw: Any, timezone_name: str) -> str:
    try:
        value = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(ZoneInfo(timezone_name)).date().isoformat()
    except (TypeError, ValueError):
        return datetime.now(ZoneInfo(timezone_name)).date().isoformat()


def _rows(connection: sqlite3.Connection, table: str,
          timezone_name: str) -> Iterable[tuple[Any, ...]]:
    available = _table_columns(connection, table)
    if not available:
        return []
    columns = TABLE_COLUMNS[table]
    select = [column for column in columns if column in available]
    source_rows = connection.execute(
        f"SELECT {','.join(select)} FROM {table} ORDER BY {ORDER_BY[table]}"
    ).fetchall()
    output = []
    for raw_row in source_rows:
        source = dict(zip(select, raw_row))
        if table == "calendar_event_changes" and not source.get("mutation_key"):
            source["mutation_key"] = f"legacy-change:{source['id']}"
        if table == "calendar_comments":
            if not source.get("anchor_date"):
                event = None
                if source.get("event_id"):
                    event = connection.execute(
                        "SELECT starts_at FROM calendar_events WHERE id=?",
                        (source["event_id"],),
                    ).fetchone()
                source["anchor_date"] = _anchor(
                    event[0] if event else source.get("created_at"), timezone_name,
                )
            source.setdefault("y", None)
            source.setdefault("liked", 0)
            source.setdefault("row_version", 1)
        output.append(tuple(source.get(column) for column in columns))
    return output


def export_sqlite(source: Path, destination: Path,
                  timezone_name: str = "Asia/Taipei") -> dict[str, int]:
    if not source.is_file():
        raise FileNotFoundError(source)
    connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    counts: dict[str, int] = {}
    # D1's bulk import path rejects explicit BEGIN/COMMIT statements.  The
    # tables are already emitted in parent-before-child order, so the export
    # can keep foreign-key enforcement enabled and remain directly consumable
    # by `wrangler d1 execute --file`.
    lines: list[str] = []
    try:
        for table, columns in TABLE_COLUMNS.items():
            rows = list(_rows(connection, table, timezone_name))
            counts[table] = len(rows)
            for row in rows:
                values = ",".join(sql_literal(value) for value in row)
                lines.append(
                    f"INSERT INTO {table} ({','.join(columns)}) VALUES ({values});"
                )
        lines.append("")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text("\n".join(lines), encoding="utf-8", newline="\n")
        return counts
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="legacy calendar.db")
    parser.add_argument("output", type=Path, help="D1 import SQL file")
    parser.add_argument("--timezone", default="Asia/Taipei")
    args = parser.parse_args()
    counts = export_sqlite(args.source, args.output, args.timezone)
    print(f"wrote {args.output}")
    for table, count in counts.items():
        print(f"  {table}: {count}")


if __name__ == "__main__":
    main()
