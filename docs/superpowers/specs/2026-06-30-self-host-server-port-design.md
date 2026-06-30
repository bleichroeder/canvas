# Self-host server port — sub-project A

**Status:** Approved 2026-06-30
**Driver:** David — canvas is shifting to self-hosted primary product
**Sub-project:** A of A→E (self-host roadmap)
**Out of scope:** Auth migration (B), TLS service (C), Docker packaging (D), open-source release (E)

## Goal

Port the canvas API from Cloudflare Worker to a standalone Bun + Hono server backed by SQLite, as the foundation of the self-hosted canvas product. End state: a `server/` directory in the repo that runs locally via `bun dev`, that the existing React frontend can talk to, with 1:1 endpoint compatibility against the current CF Worker.

This is **sub-project A of a five-part roadmap** (A: server port → B: embedded auth + sync → C: central TLS service → D: Docker packaging → E: open-source release). It's the structural foundation everything else builds on.

Self-hosted is the primary product going forward; the CF Worker is treated as legacy that will retire after the roadmap completes. This spec is the foundation, not a parallel variant.

## Architecture

`server/` is a standalone Bun project parallel to `worker/`. Routes mirror the existing CF Worker 1:1. Storage is SQLite via Drizzle ORM, with proper typed tables per concern (no generic key-value abstraction). Logging is structured (Pino). Config is Zod-validated. Errors are typed and mapped by a single error-handler middleware.

```
canvas/
├── worker/                       # CF Worker — frozen, retired after E
├── web/                          # React frontend — unchanged in A
└── server/                       # NEW Bun-based primary backend
    ├── package.json
    ├── tsconfig.json
    ├── bunfig.toml
    ├── drizzle.config.ts
    ├── drizzle/                  # Generated migration .sql files
    │   ├── 0000_init.sql
    │   └── meta/
    ├── .env.example
    └── src/
        ├── index.ts              # Boot: config → migrate → reaper → Bun.serve
        ├── app.ts                # Hono app + middleware + route mounting
        ├── config.ts             # Zod-validated env var schema
        ├── log.ts                # Pino-based structured logger
        ├── errors.ts             # Typed error classes
        ├── middleware/
        │   ├── cors.ts
        │   ├── error-handler.ts
        │   └── request-log.ts
        ├── db/
        │   ├── index.ts          # initDb(path) → drizzle instance
        │   ├── schema.ts         # Drizzle table definitions
        │   └── migrate.ts
        ├── storage/              # Typed CRUD modules per table
        │   ├── pair-sessions.ts
        │   ├── source-status.ts
        │   └── reaper.ts
        ├── routes/               # Hono sub-app per concern
        │   ├── pair.ts
        │   ├── pair-flixify.ts
        │   ├── pair-plex-servers.ts
        │   ├── home.ts
        │   ├── item.ts
        │   ├── library.ts
        │   ├── play.ts
        │   ├── progress.ts
        │   ├── search.ts
        │   ├── source-home.ts
        │   ├── source-status.ts
        │   └── subtitles.ts
        ├── sources/              # Plex + Flixify HTTP adapters (port from worker/)
        │   ├── plex-api.ts
        │   ├── plex.ts
        │   ├── flixify.ts
        │   ├── registry.ts
        │   └── types.ts
        └── lib/                  # Pure utilities (no I/O)
            ├── pin.ts
            └── x-sources.ts
```

`server/` is a standalone Bun project with its own `package.json`. Source adapters are **copied** from `worker/src/sources/`, not abstracted into a shared package — the copy is temporary (worker retires after E), and the abstraction tax would be ongoing.

Frontend (`web/`) does not change in A. To talk to the new server, set `VITE_CANVAS_API=http://localhost:8787`. Production hosted canvas keeps pointing at the CF Worker URL.

## Tech Stack

- **Runtime**: Bun (TypeScript-native, `bun:sqlite` built-in, no native-module compile)
- **HTTP framework**: Hono (Web Standard request/response, runs unmodified on Bun)
- **Database**: SQLite via Drizzle ORM + Drizzle Kit for migrations
- **Logging**: Pino (`pino-pretty` transport in dev, raw JSON in prod)
- **Config validation**: Zod
- **Request validation**: `@hono/zod-validator`
- **Testing**: `bun test` (built-in, Vitest-compatible API)
- **Type checking**: `tsc --noEmit`

No build step. `bun src/index.ts` runs TypeScript directly in both dev and prod.

## Global Constraints

- **1:1 API compatibility with the current CF Worker.** Same URL paths, same request/response shapes. Frontend must work against either backend by flipping `VITE_CANVAS_API`.
- **No CF-specific abstractions in the new code.** No `KVStore` interface, no `expirationTtl`, no `env.KV` parameter passing. Storage is SQL with proper schemas.
- **Tests are first-class.** Every storage module + every route gets a `*.test.ts` co-located alongside it. Run via `bun test` against an in-memory SQLite per test file.
- **Production hosted canvas is unaffected.** `canvas-8j0.pages.dev` keeps using the CF Worker for the duration of sub-project A.
- **No new env vars on the frontend.** `VITE_CANVAS_API` is the only client-side dial; just point it at the local server.
- **Migrations run idempotently on every boot.** `bun start` against an existing DB is a no-op; against a fresh DB it creates schema from migration files.
- **The fix for the two deferred Plex code-review items lands as part of this port** (typed `PlexHttpError`, music-section error-context wrapping). They live in `errors.ts` and the ported `sources/plex.ts`.

---

## Section 1 — Database layer

**Source of truth:** `db/schema.ts` defines Drizzle table definitions. Drizzle Kit (`bun run db:generate`) diffs the schema against the current migration state and writes a new `.sql` file in `drizzle/`. Generated files are tracked in git so deploys don't need Drizzle Kit installed.

### Schema (sub-project A scope)

```ts
// server/src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const pairSessions = sqliteTable('pair_sessions', {
  code:       text('code').primaryKey(),
  type:       text('type', { enum: ['plex', 'flixify'] }).notNull(),
  status:     text('status', { enum: ['pending', 'approved', 'expired'] }).notNull(),
  payload:    text('payload', { mode: 'json' }).$type<PairPayload>().notNull(),
  createdAt:  integer('created_at').notNull(),  // unix seconds
  expiresAt:  integer('expires_at').notNull(),  // unix seconds
});

export const sourceStatusCache = sqliteTable('source_status_cache', {
  sourceKey:  text('source_key').primaryKey(),
  status:     text('status').notNull(),         // 'ok' | 'degraded' | 'unreachable' | 'lan-only'
  lastSeenAt: integer('last_seen_at'),
  expiresAt:  integer('expires_at').notNull(),
  payload:    text('payload', { mode: 'json' }).$type<SourceStatusPayload>().notNull(),
});

// CREATE INDEX on expires_at for both tables (used by the reaper).
```

### Why typed columns over JSON blobs

- `code`, `type`, `status`, `expiresAt` are queried directly. Keeping them as proper columns means real types + indexing.
- The polymorphic bits (varies per pair type, varies per source) stay in `payload` JSON because they genuinely are opaque to the server.

### Sub-project B compatibility

Sketched (not built in A) so the schema doesn't paint us into a corner:

```ts
export const users          = sqliteTable('users', ...);
export const userSources    = sqliteTable('user_sources', ...);
export const userProgress   = sqliteTable('user_progress', ...);
export const sessions       = sqliteTable('sessions', ...);
```

No foreign keys cross between A's tables and B's. The migration sequence is purely additive: B's `0001_users.sql` lands on top of A's `0000_init.sql`.

### Storage modules

Each table gets a typed module under `storage/` exposing named CRUD functions. No generic interface. Example:

```ts
// server/src/storage/pair-sessions.ts
import { eq, lt } from 'drizzle-orm';
import { db } from '../db';
import { pairSessions } from '../db/schema';
import type { NewPairSession, PairSession } from '../db/schema';

export function getPairSession(code: string): PairSession | null {
  return db.select().from(pairSessions).where(eq(pairSessions.code, code)).get() ?? null;
}

export function createPairSession(input: NewPairSession): PairSession { ... }
export function updatePairSession(code: string, patch: Partial<PairSession>): void { ... }
export function deletePairSession(code: string): void { ... }
export function reapPairSessions(now = nowSec()): number {
  const result = db.delete(pairSessions).where(lt(pairSessions.expiresAt, now)).run();
  return result.changes;
}
```

Route handlers import these named functions directly. No CF KV abstraction anywhere.

### Reaper

```ts
// server/src/storage/reaper.ts
export function startReaper(db: BunSqliteDatabase): () => void {
  const tick = () => {
    const now = Math.floor(Date.now() / 1000);
    const pair = reapPairSessions(now);
    const status = reapSourceStatus(now);
    if (pair + status > 0) logger.debug({ pair, status }, 'reaped expired rows');
  };
  tick();
  const handle = setInterval(tick, 5 * 60_000);
  return () => clearInterval(handle);
}
```

Started by `index.ts` after migrations. The returned `stop` function is called during graceful shutdown.

### Migrations

```ts
// server/src/db/migrate.ts
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { db } from './index';

export function runMigrations() {
  migrate(db, { migrationsFolder: './drizzle' });
}
```

Idempotent. Drizzle tracks applied migrations in a `__drizzle_migrations` meta table. Fresh DB → applies all migrations in order. Existing DB → applies any new ones added since last boot. `bun docker pull && docker compose up` auto-migrates the user's DB on next start (same model Plex uses).

---

## Section 2 — Hono app + routing

### Top-level structure

```ts
// server/src/app.ts
import { Hono } from 'hono';
import { config } from './config';
import { corsMiddleware } from './middleware/cors';
import { requestLog } from './middleware/request-log';
import { errorHandler } from './middleware/error-handler';

import { pairRoutes } from './routes/pair';
import { pairFlixifyRoutes } from './routes/pair-flixify';
// ... (one import per route file)

export const app = new Hono();

app.use('*', corsMiddleware());
app.use('*', requestLog());
app.onError(errorHandler);

app.get('/health', (c) => c.json({ ok: true, version: config.version }));

app.route('/api/pair',                pairRoutes);
app.route('/api/pair/flixify',        pairFlixifyRoutes);
app.route('/api/pair/plex-servers',   pairPlexServersRoutes);
app.route('/api/home',                homeRoutes);
app.route('/api/item',                itemRoutes);
app.route('/api/library',             libraryRoutes);
app.route('/api/play',                playRoutes);
app.route('/api/progress',            progressRoutes);
app.route('/api/search',              searchRoutes);
app.route('/api/source-home',         sourceHomeRoutes);
app.route('/api/source-status',       sourceStatusRoutes);
app.route('/api/subtitles',           subtitlesRoutes);
```

### Sub-app per concern

Each route file exports a Hono sub-app. Example:

```ts
// server/src/routes/pair.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  createPairSession, getPairSession, approvePairSession, deletePairSession,
} from '../storage/pair-sessions';
import { PairExpiredError, PairNotFoundError } from '../errors';
import { nowSec } from '../lib/time';

export const pairRoutes = new Hono();

pairRoutes.post('/start',
  zValidator('json', z.object({ type: z.enum(['plex', 'flixify']) })),
  async (c) => {
    const { type } = c.req.valid('json');
    const session = createPairSession({ type });
    return c.json({ code: session.code, expiresAt: session.expiresAt * 1000 });
  },
);

pairRoutes.post('/poll',
  zValidator('json', z.object({ code: z.string() })),
  async (c) => {
    const { code } = c.req.valid('json');
    const session = getPairSession(code);
    if (!session) throw new PairNotFoundError(code);
    if (session.expiresAt < nowSec()) throw new PairExpiredError(code);
    return c.json({
      status: session.status,
      source: session.status === 'approved' ? session.payload.source : undefined,
      sourceType: session.type,
    });
  },
);

// ... other endpoints
```

Request bodies/queries are Zod-validated. `c.req.valid('json')` is fully typed from the schema — no `any` slipping in.

### Typed errors

```ts
// server/src/errors.ts
export class HttpError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

export class PairNotFoundError extends HttpError {
  constructor(code: string) {
    super(404, `Pair session "${code}" not found`, 'PAIR_NOT_FOUND');
  }
}
export class PairExpiredError extends HttpError { ... }
export class SourceNotFoundError extends HttpError { ... }

export class UpstreamError extends HttpError {
  constructor(public upstreamStatus: number, public upstreamUrl: string, message: string) {
    super(502, message, 'UPSTREAM_ERROR');
  }
}

export class PlexHttpError extends UpstreamError {
  constructor(status: number, path: string, body: string) {
    super(status, path, `Plex ${status} ${path}: ${body.slice(0, 200)}`);
  }
}
```

`PlexHttpError` replaces the stringly-typed `msg.includes(' 404 ')` cascade in `sources/plex.ts`. The fallback chain becomes:

```ts
try {
  return await plexFetch(...);
} catch (e) {
  if (!(e instanceof PlexHttpError) || e.status !== 404) throw e;
  // ... known 404, fall back to next strategy
}
```

### Error handler middleware

```ts
// server/src/middleware/error-handler.ts
import type { ErrorHandler } from 'hono';
import { HttpError } from '../errors';
import { logger } from '../log';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HttpError) {
    logger.warn({ url: c.req.url, code: err.code, status: err.status }, err.message);
    return c.json({ error: { code: err.code, message: err.message } }, err.status);
  }
  logger.error({ url: c.req.url, err }, 'unhandled error');
  return c.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500);
};
```

One consistent error JSON shape: `{ error: { code: string, message: string } }`. Frontend `web/src/api.ts` learns to parse this shape (small change; current shape is similar).

---

## Section 3 — Config + boot

### Env schema

```ts
// server/src/config.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT:                     z.coerce.number().int().min(1).max(65535).default(8787),
  HOST:                     z.string().default('0.0.0.0'),
  LOG_LEVEL:                z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV:                 z.enum(['development', 'production', 'test']).default('production'),
  CANVAS_DB_PATH:           z.string().default('./data/canvas.db'),
  CANVAS_ALLOWED_ORIGINS:   z.string().transform(s => s.split(',').map(t => t.trim())),
});

export type Config = z.infer<typeof ConfigSchema> & { version: string };

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return { ...parsed.data, version: process.env.npm_package_version ?? 'dev' };
}

export const config = loadConfig();
```

If anything's missing or malformed, the process exits with a clear list of issues rather than starting in a broken state.

### Entry point

```ts
// server/src/index.ts
import { config } from './config';
import { logger } from './log';
import { initDb } from './db';
import { runMigrations } from './db/migrate';
import { startReaper } from './storage/reaper';
import { app } from './app';

async function main() {
  logger.info({ version: config.version, env: config.NODE_ENV }, 'canvas server starting');

  const db = initDb(config.CANVAS_DB_PATH);
  runMigrations(db);
  const stopReaper = startReaper(db);

  const server = Bun.serve({
    port: config.PORT,
    hostname: config.HOST,
    fetch: app.fetch,
  });

  logger.info({ url: `http://${config.HOST}:${config.PORT}` }, 'listening');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    stopReaper();
    await server.stop(false);
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
}

void main();
```

Graceful shutdown drains in-flight HTTP, stops the reaper, closes the SQLite handle. Prevents corrupt SQLite on `SIGTERM` and lets users finish playback resume requests cleanly during a `docker compose restart`.

### Logging

Pino. Dev: `pino-pretty` transport, colorised, human-readable. Prod: raw JSON to stdout — Docker captures it, Grafana Loki / Datadog / simple `docker logs` all parse.

### `.env.example`

Committed; documents every var with safe defaults. Users `cp .env.example .env` and tweak.

```env
PORT=8787
HOST=0.0.0.0
LOG_LEVEL=info
NODE_ENV=production
CANVAS_DB_PATH=./data/canvas.db
CANVAS_ALLOWED_ORIGINS=http://localhost:5173,https://canvas-8j0.pages.dev
```

### Health endpoint

`GET /health` → `200 { ok: true, version: "1.7.1" }`. Used by Docker healthchecks. The future canvas.app central service (sub-project C) hits this to verify an instance is alive before issuing certs.

---

## Section 4 — Local dev experience

### Commands (`server/package.json`)

```json
{
  "scripts": {
    "dev":          "bun --hot src/index.ts",
    "start":        "bun src/index.ts",
    "test":         "bun test",
    "test:watch":   "bun test --watch",
    "typecheck":    "tsc --noEmit",
    "db:generate":  "drizzle-kit generate",
    "db:migrate":   "bun src/db/migrate.ts",
    "db:studio":    "drizzle-kit studio"
  }
}
```

### Two-terminal dev loop

```
# Terminal 1
cd canvas/server && bun dev

# Terminal 2
cd canvas/web && npm run dev
```

`web/.env` adds `VITE_CANVAS_API=http://localhost:8787`. All current canvas flows (sign-in, browse, play, pair) work against the local Bun server. Sign-in still uses Supabase — auth migration is sub-project B's problem.

### Tests

Co-located `*.test.ts`. Each test file creates its own in-memory DB:

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../db/migrate';
import { createPairSession, getPairSession } from './pair-sessions';

describe('pair-sessions storage', () => {
  let db: ReturnType<typeof drizzle>;
  beforeEach(() => {
    db = drizzle(new Database(':memory:'));
    runMigrations(db);
  });

  test('round-trips a session', () => {
    const session = createPairSession(db, { type: 'plex' });
    expect(getPairSession(db, session.code)).toEqual(session);
  });
});
```

Integration tests hit `app.fetch(request)` directly — no running server needed.

---

## Section 5 — Scope and success criteria

### In scope

- `server/` Bun + Hono + Drizzle + SQLite project parallel to `worker/`
- Every route ported with 1:1 path compatibility
- Both source adapters (Plex, Flixify) ported with their tests
- `pair_sessions` and `source_status_cache` proper Drizzle tables
- Drizzle Kit migrations workflow + auto-apply on boot
- Pino logging; Zod-validated config + request bodies
- Typed error classes + single error-handler middleware
- 5-minute reaper for expired rows
- CORS middleware reading from `CANVAS_ALLOWED_ORIGINS`
- `GET /health` endpoint
- Tests co-located, `bun test` runs everything
- Fix for the two deferred Plex code-review items (typed `PlexHttpError`, music-section error context)
- Frontend dev points at local server via `VITE_CANVAS_API`
- `server/README.md` documenting env vars + dev commands

### Out of scope (later sub-projects)

| Item | Sub-project |
|---|---|
| Replace Supabase auth + sync with embedded users/sources/progress tables | B |
| Production deployment of the Bun server | D |
| Docker image + compose + install guide | D |
| Central TLS service (canvas.app, *.canvas.direct) | C |
| Open-source release: license, public repo, README, ghcr.io publishing | E |
| Retiring the CF Worker | post-E |
| Migrating production canvas-8j0.pages.dev to the new backend | post-D |
| Frontend bundling into the server | D |

### Non-goals

- Cross-runtime abstraction (same code on Bun *and* CF). Picked fresh-Bun.
- Backwards-compatibility shims for old worker URLs. Paths stay identical.
- ORM alternatives beyond Drizzle (evaluated against raw SQL, Kysely, Prisma).

### Success criteria

1. `cd server && bun install && bun dev` starts cleanly with `LOG_LEVEL=debug` showing: config loaded, migrations applied, reaper started, listening on port.
2. Frontend pointed at `http://localhost:8787` via `VITE_CANVAS_API` exercises every existing flow:
   - Sign in (still Supabase)
   - Home / Library / SourceHome / Search
   - Item detail, video playback, audio-only playback, music browse + album-detail
   - Plex in-car pair, Flixify in-car pair, phone-pair (full E2E)
   - Source-status indicators in Settings
   - Subtitle fetch
3. `bun test` passes every ported test.
4. `bun run typecheck` clean.
5. Production `canvas-8j0.pages.dev` unchanged (still on CF Worker).
6. `server/README.md` ready for handoff to sub-project B.

## Open questions

None at time of writing. Spec was iterated through brainstorming; user approved each section.
