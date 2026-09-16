"""Pywrangler entry point."""

import asgi

from cloudflare_http import app


Default = asgi.entrypoint(app)
