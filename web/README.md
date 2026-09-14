# shared-page Web — Checkpoint 1

Faithful PWA baseline for the existing shared-page calendar.

This directory is intentionally independent from `server/` and `ios/`. It contains no OpenAI API client and no MCP client. The PWA reads the existing REST API; official ChatGPT continues to use the existing MCP entry point.

## Requirements

- Node.js 20.19 or newer
- The existing FastAPI backend, normally on `http://127.0.0.1:8787`
- A valid `CALENDAR_TOKEN`

## Start

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Open the Vite URL and enter the calendar token in the connection prompt. The token is kept in browser session storage only and is never written into source files.

The dev server proxies `/api/*` to `CALENDAR_PROXY_TARGET`. For production, serve the PWA and proxy `/api/v1/calendar/*` to the existing backend on the same origin.

## Checkpoint boundary

Implemented here: PWA shell, iOS theme tokens, calendar read DTO/materialization, read-only REST loading, and Month View.

Not part of this checkpoint: event mutations, Day View, notes UI, scrapbook decorations, snapshots, Web Push, widgets, or any server/MCP change.

## License and required notice

The repository root `LICENSE` remains authoritative (PolyForm Noncommercial 1.0.0).

Required Notice: Copyright 2026 KKarsyline

Bundled font licenses are reproduced in `public/licenses/`.
