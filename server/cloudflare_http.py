"""Cloudflare Application Worker: REST API, internal MCP service, and PWA."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import Response

import calendar_core
import config
import routes
from cloudflare_storage import D1Storage


app = FastAPI(title="shared-page-cloudflare")
app.include_router(routes.router, prefix="/api/v1")


def _env_value(env: Any, name: str, default: Any = None) -> Any:
    if isinstance(env, dict):
        return env.get(name, default)
    return getattr(env, name, default)


@app.middleware("http")
async def bind_cloudflare(request: Request, call_next):
    env = request.scope.get("env")
    if env is None:
        raise RuntimeError("Cloudflare bindings are unavailable")
    app.state.storage = D1Storage(_env_value(env, "DB"), _env_value(env, "PAGES"))
    app.state.calendar_token = str(_env_value(env, "CALENDAR_TOKEN", ""))
    app.state.internal_mcp_token = str(_env_value(env, "MCP_INTERNAL_TOKEN", ""))
    app.state.assets = _env_value(env, "ASSETS")
    config.USER_NAME = str(_env_value(env, "CALENDAR_USER_NAME", "USER"))
    config.ASSISTANT_NAME = str(_env_value(env, "CALENDAR_ASSISTANT_NAME", "ASSISTANT"))
    return await call_next(request)


@app.post("/internal/mcp/calendar")
async def internal_calendar(
    request: Request,
    arguments: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    supplied = request.headers.get("Authorization", "")
    expected = f"Bearer {request.app.state.internal_mcp_token}"
    if not request.app.state.internal_mcp_token or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="invalid internal token")
    result = await calendar_core.execute_calendar_tool(
        request.app.state.storage, arguments, push_to_kitty=False,
    )
    if hasattr(result, "as_mcp_content"):
        return {"content": result.as_mcp_content(), "isError": False}
    if isinstance(result, str):
        return {"content": [{"type": "text", "text": result}], "isError": False}
    return {
        "content": [{"type": "text", "text": calendar_core._json(result)}],
        "isError": not bool(result.get("ok", True)) if isinstance(result, dict) else False,
    }


@app.get("/{asset_path:path}", include_in_schema=False)
async def static_assets(request: Request, asset_path: str) -> Response:
    assets = request.app.state.assets
    if assets is None:
        raise HTTPException(status_code=404, detail="asset binding unavailable")
    path = asset_path or "index.html"
    upstream = await assets.fetch(f"https://assets.local/{path}")
    data = await upstream.bytes()
    headers: dict[str, str] = {}
    for name in ("content-type", "cache-control", "etag", "last-modified"):
        value = upstream.headers.get(name)
        if value:
            headers[name] = str(value)
    return Response(data, status_code=int(upstream.status), headers=headers)
