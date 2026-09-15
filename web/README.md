# shared-page Web — Checkpoint 6

Faithful PWA port for the existing shared-page calendar, including calendar writes, torn notes, the client-local scrapbook layer, and canonical page rendering for MCP `see`.

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

## Calendar and scrapbook writes

- The Day View FAB exposes event, note, sticker/emoji, and photo actions.
- Standard single-day events support create, edit, date/time moves, all-day conversion, and two-step delete confirmation.
- Writes are optimistic and never persisted in browser storage. Failure restores the last canonical event and shows an in-page error.
- Per-event writes are serialized; stale GETs and older mutation responses cannot overwrite newer intent.
- Multi-day spans preserve the iOS create, range edit, whole-delete, remove-day, and split semantics.
- Notes use the existing REST model; scrapbook placements are deliberately separate and persist only in IndexedDB.

## Commands

```bash
npm ci
npm test
npm run build
npm run preview
```

In production preview, verify that `/manifest.webmanifest` loads and that DevTools → Application reports an active service worker. The app shell and static assets are precached; authenticated REST calendar responses are not cached.

PWA installation requires a secure context. `localhost` is treated as trustworthy by supported browsers, but a phone opening a development machine's plain `http://192.168.x.x:5173` address is not. This checkpoint does not add hosting or TLS solely for an install test.

## Scrapbook storage and Web parity

- Scrapbook placements, imported stickers, emoji, and photos are stored only in this browser origin's IndexedDB. They do not sync to iOS, another browser, REST, or MCP in Phase 1.
- Automatic foreground cutout is not available in the Phase 1 PWA port. Transparent PNG/WebP imports keep transparency and receive a light white outline; opaque JPG/PNG files remain rectangular.
- Imported photos are orientation-normalized, bounded to a 1600px long side, and stored as compressed JPEG instead of retaining the original camera file.

## Page render and sync

- A dedicated non-interactive 402px `DayPageSnapshot` renders current calendar, note, and browser-local scrapbook state. It does not capture the visible browser viewport.
- `PageCrop` uses the iOS domain-coordinate algorithm and snaps timeline coverage to hour rows. Output uses a fixed 1.5× scale, so every PNG is 603 physical pixels wide regardless of the device DPR.
- `html-to-image` is used only to rasterize this static DOM surface. Fonts and image assets are awaited before encoding, and the output is flattened onto an opaque white PNG.
- Event, span, note, and scrapbook mutations mark affected days in a memory-only generation map. A successful upload clears a day only when the uploaded generation is still current.
- Dirty pages flush after roughly 1.5 seconds of quiet, when returning from Day View to Month View, and best-effort on `visibilitychange` / `pagehide`. Failed renders or uploads remain dirty without an automatic retry loop.
- Uploads use the existing `POST /pages/{YYYY-MM-DD}/render` multipart contract. Calendar data remains in REST/SQLite; client-local scrapbook content is visible to MCP only through this PNG.

## Checkpoint boundary

Implemented: PWA shell, iOS theme tokens, calendar DTO/materialization, REST loading, unseen visuals and mark-seen, Month and Day Views, event/span CRUD, torn notes, the IndexedDB scrapbook layer, and canonical page render/crop/sync.

Not included: scrapbook cross-device sync, automatic subject cutout, Web Push, widgets, or any server/MCP change.

## License and required notice

The repository root `LICENSE` remains authoritative (PolyForm Noncommercial 1.0.0).

Required Notice: Copyright 2026 KKarsyline

Bundled font licenses are reproduced in `public/licenses/`.
