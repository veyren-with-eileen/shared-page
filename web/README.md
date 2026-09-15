# shared-page Web — Checkpoint 3A

Faithful PWA port for the existing shared-page calendar. Standard single-day events are writable; spans and the remaining layers stay read-only.

This directory is independent from `server/` and `ios/`. It contains no OpenAI API client and no MCP client. The PWA reads the existing REST API; official ChatGPT continues to use the existing MCP entry point.

## Requirements

- Node.js 20.19 or newer
- The existing FastAPI backend, normally on `http://127.0.0.1:8787`
- A valid `CALENDAR_TOKEN`

## Start

```bash
cd web
cp .env.example .env.local
npm ci
npm run dev
```

On Windows PowerShell, use:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

The dev server proxies `/api/*` to `CALENDAR_PROXY_TARGET`. Keep the API base URL in the connection screen as `/api/v1/calendar`, then enter the existing calendar token. Values entered in the UI are stored in `sessionStorage` only: they disappear when the tab session ends and are never written into Git.

For a managed runtime, use `public/runtime-config.example.js` as the template and serve the populated file as `/runtime-config.js` after the app build. It is loaded optionally and excluded from the service-worker precache. Never commit the real token.

The Web product timezone is intentionally a single `Asia/Taipei` constant in `src/domain/calendar.ts`. It is not a runtime connection setting. Generalizing the entire client to arbitrary product timezones is a separate future change.

For production, serve the PWA and proxy `/api/v1/calendar/*` to the existing backend on the same origin. Direct cross-origin browser access requires backend CORS support and is not assumed by this checkpoint.

## Routes

- Month: `/?month=2026-09`
- Day: `/day/2026-09-15`
- Month cells, including gray leading/trailing dates, navigate using their true date.
- Browser Back and Forward restore Month and Day URL state.
- Opening a Day route marks that date seen through the existing idempotent receipt endpoint.

## Checkpoint 3A event writes

- The Day View FAB exposes only the available event action.
- Standard single-day events support create, edit, date/time moves, all-day conversion, and two-step delete confirmation.
- Writes are optimistic and never persisted in browser storage. Failure restores the last canonical event and shows an in-page error.
- Per-event writes are serialized; stale GETs and older mutation responses cannot overwrite newer intent.
- Multi-day all-day spans and cross-day timed events remain read-only for the Checkpoint 3B boundary.

## Commands

```bash
npm ci
npm test
npm run build
npm run preview
```

In production preview, verify that `/manifest.webmanifest` loads and that DevTools → Application reports an active service worker. The app shell and static assets are precached; authenticated REST calendar responses are not cached.

PWA installation requires a secure context. `localhost` is treated as trustworthy by supported browsers, but a phone opening a development machine's plain `http://192.168.x.x:5173` address is not. This checkpoint does not add hosting or TLS solely for an install test.

## Checkpoint boundary

Implemented: PWA shell, iOS theme tokens, calendar DTO/materialization, REST loading, unseen visuals and mark-seen, Month View, URL-addressable Day View, 06:00–23:00 timeline, all-day/span rows, read-only event details, and standard single-day event CRUD.

Not included: SpanEditor mutations, comments or notes, scrapbook decorations, snapshots/pageSync, Web Push, widgets, or any server/MCP change.

## License and required notice

The repository root `LICENSE` remains authoritative (PolyForm Noncommercial 1.0.0).

Required Notice: Copyright 2026 KKarsyline

Bundled font licenses are reproduced in `public/licenses/`.
