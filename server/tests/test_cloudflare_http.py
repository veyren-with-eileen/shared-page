from __future__ import annotations

import json
import unittest
from pathlib import Path
from types import SimpleNamespace

import httpx

from cloudflare_http import app
from tests.cloudflare_fakes import FakeArrayBuffer, FakeD1, FakeR2


MIGRATION = Path(__file__).parents[2] / "cloudflare/application/migrations/0001_calendar.sql"


class FakeHeaders:
    def __init__(self, values: dict[str, str]) -> None:
        self.values = values

    def get(self, name: str):
        return self.values.get(name)


class FakeAssetResponse:
    def __init__(self, data: bytes, content_type: str = "text/html") -> None:
        self.data = data
        self.status = 200
        self.headers = FakeHeaders({"content-type": content_type})

    async def arrayBuffer(self):
        return FakeArrayBuffer(self.data)


class FakeAssets:
    async def fetch(self, url: str):
        return FakeAssetResponse(f"asset:{url}".encode())


class BoundApplication:
    def __init__(self, application, env) -> None:
        self.application = application
        self.env = env

    async def __call__(self, scope, receive, send):
        scope = dict(scope)
        scope["env"] = self.env
        await self.application(scope, receive, send)


class CloudflareHttpTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        database = FakeD1()
        database.conn.executescript(MIGRATION.read_text(encoding="utf-8"))
        self.r2 = FakeR2()
        self.env = SimpleNamespace(
            DB=database,
            PAGES=self.r2,
            ASSETS=FakeAssets(),
            CALENDAR_TOKEN="calendar-secret",
            MCP_INTERNAL_TOKEN="mcp-secret",
            CALENDAR_USER_NAME="Eileen",
            CALENDAR_ASSISTANT_NAME="Veyren",
        )
        transport = httpx.ASGITransport(app=BoundApplication(app, self.env))
        self.client = httpx.AsyncClient(transport=transport, base_url="https://app.test")

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    @property
    def headers(self):
        return {"X-Calendar-Token": "calendar-secret"}

    async def test_ping_is_public_and_calendar_data_is_authenticated(self):
        ping = await self.client.get("/api/v1/calendar/ping")
        self.assertEqual(ping.status_code, 200)
        denied = await self.client.get("/api/v1/calendar/events")
        self.assertEqual(denied.status_code, 401)

    async def test_event_crud_uses_existing_rest_shape(self):
        made = await self.client.post(
            "/api/v1/calendar/events", headers=self.headers,
            json={"title": "REST", "starts_at": "2026-09-15T10:00:00+08:00"},
        )
        self.assertEqual(made.status_code, 200)
        event_id = made.json()["id"]
        edited = await self.client.patch(
            f"/api/v1/calendar/events/{event_id}", headers=self.headers,
            json={"title": "REST edited"},
        )
        self.assertEqual(edited.json()["revision"], 2)
        listed = await self.client.get(
            "/api/v1/calendar/events?date=2026-09-15", headers=self.headers,
        )
        self.assertEqual(listed.json()["events"][0]["title"], "REST edited")
        deleted = await self.client.delete(
            f"/api/v1/calendar/events/{event_id}", headers=self.headers,
        )
        self.assertEqual(deleted.json()["status"], "deleted")

    async def test_notes_unseen_and_idempotent_seen(self):
        internal = await self.client.post(
            "/internal/mcp/calendar",
            headers={"Authorization": "Bearer mcp-secret"},
            json={"action": "comment", "date": "2026-09-15", "comment": "MCP note"},
        )
        self.assertEqual(internal.status_code, 200)
        notes = await self.client.get(
            "/api/v1/calendar/notes?date=2026-09-15", headers=self.headers,
        )
        self.assertEqual(notes.json()["notes"][0]["author"], "master")
        unseen = await self.client.get("/api/v1/calendar/unseen", headers=self.headers)
        self.assertEqual(unseen.json()["days"], ["2026-09-15"])
        first = await self.client.post(
            "/api/v1/calendar/unseen/seen", headers=self.headers,
            json={"date": "2026-09-15"},
        )
        second = await self.client.post(
            "/api/v1/calendar/unseen/seen", headers=self.headers,
            json={"date": "2026-09-15"},
        )
        self.assertGreater(first.json()["cleared"], 0)
        self.assertEqual(second.json()["cleared"], 0)

    async def test_page_upload_and_get_keep_contract(self):
        png = b"\x89PNG\r\n\x1a\ncloudflare"
        uploaded = await self.client.post(
            "/api/v1/calendar/pages/2026-09-15/render", headers=self.headers,
            files={"file": ("2026-09-15.png", png, "image/png")},
        )
        self.assertEqual(uploaded.status_code, 200)
        self.assertIn("pages/2026-09-15.png", self.r2.objects)
        fetched = await self.client.get(
            "/api/v1/calendar/pages/2026-09-15/render", headers=self.headers,
        )
        self.assertEqual(fetched.content, png)
        self.assertEqual(fetched.headers["cache-control"], "no-store")

    async def test_internal_mcp_requires_service_secret_and_returns_image(self):
        denied = await self.client.post("/internal/mcp/calendar", json={"action": "list"})
        self.assertEqual(denied.status_code, 401)
        await self.client.post(
            "/api/v1/calendar/pages/2026-09-15/render", headers=self.headers,
            files={"file": ("page.png", b"\x89PNG\r\n\x1a\nimage", "image/png")},
        )
        seen = await self.client.post(
            "/internal/mcp/calendar",
            headers={"Authorization": "Bearer mcp-secret"},
            json={"action": "see", "date": "2026-09-15"},
        )
        self.assertEqual(seen.status_code, 200)
        self.assertEqual([part["type"] for part in seen.json()["content"]], ["text", "image"])

    async def test_static_assets_are_served_by_binding(self):
        response = await self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://assets.local/index.html", response.text)


if __name__ == "__main__":
    unittest.main()
