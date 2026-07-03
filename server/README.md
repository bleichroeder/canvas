# canvas-server

Self-hosted backend for canvas. Bun + Hono + Drizzle + SQLite. Ported 1:1
from the former Cloudflare Worker implementation, keeping the same URL
contract; the React frontend (`web/`) talks to it by setting
`VITE_CANVAS_API` in dev or via the same-origin Docker image in prod.

## Status

Sub-project A of the self-host roadmap. See
`docs/superpowers/specs/2026-06-30-self-host-server-port-design.md`.

## Requirements

- Bun 1.1+
- A modern Linux/macOS/Windows shell
- Optional: `docker` for the eventual container build (not in scope here)

## Local dev

```bash
cd server
bun install
cp .env.example .env       # customise PORT, DB path, allowed origins
bun dev                     # hot-reload server on :8787
```

Then in another terminal:
```bash
cd ../web
echo 'VITE_CANVAS_API=http://localhost:8787' > .env.local
npm run dev
```

Open <http://localhost:5173/>.

## First run

On first boot with an empty database, the server prints an admin claim token:

```
┌──────────────────────────────────────────────────────────┐
│  FIRST-RUN ADMIN CLAIM TOKEN (expires 24h):              │
│                                                          │
│      ABCD-EFGH-IJKL-MNOP-XYZ                             │
│                                                          │
│  Enter this token on your first device to become admin.  │
│  Also written to: ./data/admin-claim-token.txt           │
└──────────────────────────────────────────────────────────┘
```

Visit the canvas web UI in your browser and enter the token to claim admin.
You can then add additional users from Settings → Users; each new user gets
their own claim token.

If you lose your admin device and the token has expired, restart the server
— it detects the recovery state (admin exists, no devices, no active token)
and emits a fresh token.

## Commands

| Command | Purpose |
|---|---|
| `bun dev`           | Hot-reload server |
| `bun start`         | Production start (no hot-reload) |
| `bun test`          | Run all `*.test.ts` |
| `bun test --watch`  | Watch mode |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run db:generate` | Diff `schema.ts` → emit new SQL migration |
| `bun run db:migrate`  | Apply pending migrations against `CANVAS_DB_PATH` |
| `bun run db:studio`   | Drizzle's web UI on the local DB |

## Environment

Documented in `.env.example`. All have sensible defaults except
`CANVAS_ALLOWED_ORIGINS`, which you usually want to set to the canvas
frontend URL (`http://localhost:5173` in dev).

## Storage

SQLite at `CANVAS_DB_PATH` (default `./data/canvas.db`, WAL mode). Mount
this directory as a Docker volume for persistence. Schema lives in
`src/db/schema.ts`; migrations in `drizzle/`. Sub-project B will add
user accounts + source-sync tables alongside the existing two.

## Tests

Co-located `*.test.ts`. Each test file gets its own in-memory DB. Run
`bun test` to execute all of them; integration tests use `app.fetch()`
directly so no port is bound.

## Production deploy

Out of scope for this sub-project (sub-project D handles Docker + TLS).
Today this server is intended for local development against the
existing hosted canvas frontend.
