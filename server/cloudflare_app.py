"""Pywrangler entry point."""

from workers import asgi

from cloudflare_http import app


Default = asgi.entrypoint(app)
