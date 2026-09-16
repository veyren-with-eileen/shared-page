# Cloudflare-native deployment

This deployment moves only runtime and storage. The PWA product behavior and its
REST/MCP contracts remain unchanged.

```text
shared-page-app Worker
├─ /                         PWA static assets (same origin)
├─ /api/v1/calendar/*        existing REST contract
├─ D1 DB                     calendar tables
└─ R2 PAGES                  pages/YYYY-MM-DD.png

shared-page-mcp Worker
├─ /mcp                      OAuth-protected Streamable HTTP MCP
├─ KV OAUTH_KV               clients, grants, and tokens
└─ Service Binding           shared-page-app /internal/mcp/calendar
```

The MCP Worker owns no calendar data and contains no duplicate calendar business
rules. It authenticates the official client, exposes the single `calendar` tool,
and forwards its arguments through the private Service Binding.

## Prerequisites

- Node.js 20.19 or newer
- Python 3.13+ for the Cloudflare Python Worker toolchain
- a Cloudflare account with Workers, D1, R2, and KV enabled
- Wrangler authenticated locally (`npx wrangler login`)

Never commit `.dev.vars`, a token, a password, or a real resource ID intended to
remain private.

## 1. Create resources

```bash
cd cloudflare/application
npm ci
npx wrangler d1 create shared-page-calendar
npx wrangler r2 bucket create shared-page-pages

cd ../mcp
npm ci
npx wrangler kv namespace create OAUTH_KV
```

Copy the returned D1 `database_id` into `application/wrangler.jsonc`, and the KV
`id` into `mcp/wrangler.jsonc`. The Service Binding name must continue to match
the Application Worker name `shared-page-app`.

## 2. Configure secrets

Generate two independent high-entropy values locally. Use the same
`MCP_INTERNAL_TOKEN` value in both Workers.

```bash
cd cloudflare/application
npx wrangler secret put CALENDAR_TOKEN
npx wrangler secret put MCP_INTERNAL_TOKEN

cd ../mcp
npx wrangler secret put MCP_INTERNAL_TOKEN
npx wrangler secret put MCP_OWNER_PASSWORD
```

- `CALENDAR_TOKEN` preserves the existing `X-Calendar-Token` REST contract.
- `MCP_INTERNAL_TOKEN` authenticates private Worker-to-Worker forwarding.
- `MCP_OWNER_PASSWORD` is entered only on the OAuth authorization page. It is
  never put in a query string or log.

Change `CALENDAR_USER_NAME` / `CALENDAR_ASSISTANT_NAME` in the Application
Worker variables if desired. The Phase 1 product timezone is `Asia/Taipei`.

## 3. Build the PWA and apply migrations

```bash
cd web
npm ci
npm test
npm run build

cd ../cloudflare/application
npm run migrate:remote
```

Fresh D1 databases use `migrations/0001_calendar.sql`, the final current schema.
Production startup does not execute DDL or legacy SQLite migrations.

## 4. Deploy

Deploy the Application Worker first so the MCP Service Binding has a target.

```bash
cd cloudflare/application
npm run deploy

cd ../mcp
npm test
npm run build
npm run deploy
```

The PWA and REST API are served together over HTTPS by `shared-page-app`. Leave
the PWA API base at `/api/v1/calendar`; enter `CALENDAR_TOKEN` in its connection
screen. It remains in `sessionStorage` only and is not in static assets or the
service-worker precache.

Connect official ChatGPT to:

```text
https://shared-page-mcp.<your-workers-subdomain>.workers.dev/mcp
```

The OAuth flow uses S256 PKCE and supports Client ID Metadata Documents plus DCR
compatibility. Enter `MCP_OWNER_PASSWORD` on the authorization page; access and
refresh tokens are managed by the OAuth Provider in KV.

## Existing data cutover

Stop local REST/MCP writes during cutover so the export has a clear boundary.

```bash
python cloudflare/tools/export_sqlite_to_d1.py \
  server/data/calendar.db migration-output/calendar.sql

cd cloudflare/application
npx wrangler d1 execute DB --remote \
  --file ../../migration-output/calendar.sql
```

The deterministic export retains soft-deleted rows and explicit change IDs,
generates mutation keys for legacy changes, and adapts the old comments shape.
It emits parent-before-child inserts without explicit `BEGIN` / `COMMIT` or
foreign-key pragmas so the file is directly compatible with D1 bulk import.

Preview page uploads first, then explicitly execute them:

```bash
cd cloudflare/application
python ../tools/upload_pages_to_r2.py ../../server/data/pages
python ../tools/upload_pages_to_r2.py ../../server/data/pages --execute
```

The uploader invokes the Application project's installed Wrangler JavaScript
entrypoint through Node, avoiding the Windows-only `npx.cmd` subprocess shim.

Only exact `YYYY-MM-DD.png` files with PNG magic and size at most 4 MiB are
accepted. Objects use `pages/YYYY-MM-DD.png`. Migrated objects use the R2 upload
timestamp for stale detection; new uploads also store microsecond metadata.

## Verification

```bash
cd server
python -m unittest discover -s tests

cd ../web
npm ci
npm test
npm run build

cd ../cloudflare/mcp
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
```

Exercise real local D1 migration state with:

```bash
cd cloudflare/application
npm run migrate:local
```

Local tests and MCP Inspector are diagnostics, not final acceptance. After
deployment, use official ChatGPT Web/mobile to verify MCP ↔ D1/R2 ↔ PWA events,
spans, comments, likes, receipts, latest image, and stale-image behavior.

APNs, extractor, and recurring seed JSON remain optional local modules. They are
not enabled by this Cloudflare production runtime and do not block the calendar.
