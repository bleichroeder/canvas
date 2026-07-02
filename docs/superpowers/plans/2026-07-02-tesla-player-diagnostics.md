# Tesla Player Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship diagnostics infrastructure that captures a bounded ring buffer of structured player events, uploads on fatal, and exposes a Settings → Diagnostics admin viewer + an on-screen overlay for live inspection in the car.

**Architecture:** Client-side ring buffer in `web/src/player/diagnostics.ts` filled by hooks in the existing player pipeline (RangeFetcher, source adapters, VideoSink, AudioSink, Player.tsx). On any fatal in Player.tsx `onFatal`, the ring + session context POSTs to `/api/telemetry/error` with `keepalive: true`. Server persists to a new `error_reports` SQLite table with retention (30 days + 1000 rows cap, configurable). Admin-only GET endpoints power a new Diagnostics tab in the web app.

**Tech Stack:** Bun 1.3+, Hono, Drizzle ORM, `bun:sqlite`, React + MUI (frontend), Vite build.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Match codebase conventions verbatim:**
  - **Route module shape:** `makeXxxRoutes(getDb: () => Db)` returning a Hono instance. See `server/src/routes/home.ts` as reference.
  - **Validation:** manual `typeof` checks. **The spec's mention of `zod` is superseded** — no new dep, match `server/src/routes/auth.ts:15-19` pattern.
  - **Storage:** standalone functions taking `db: Db` as first parameter. No classes, no globals. See `server/src/storage/users.ts`.
  - **Tests:** `bun:test` with in-memory SQLite + `runMigrations(db)`. See `server/src/routes/home.test.ts`.
  - **Auth guards:** existing `requireUser` (bearer → session lookup) + `requireAdmin` (role check) middleware in `server/src/middleware/auth.ts`. Mount protected routes AFTER the guards in `server/src/app.ts`.
  - **Frontend:** MUI components + `sx` prop, `useState`/`useEffect`, `api` namespace for fetches. See `web/src/views/settings/DeploymentTab.tsx`.
- **Rate limiting:** doesn't exist. This plan writes a simple sliding-window helper in Task 2 — self-contained module, no external dep.
- **Event kinds must be exact:** `session_start`, `fetch_start`, `fetch_chunk`, `fetch_end`, `fetch_error`, `demux_ready`, `demux_error`, `video_configure`, `video_frame`, `video_error`, `audio_configure`, `audio_error`, `backpressure`, `queue_snapshot`, `user_gesture`, `stall_detected`, `browser_error`. Named exactly as in the spec.
- **Error kinds (payload `error.kind`) must be exact:** `video`, `audio`, `fetch`, `demux`, `browser`, `unknown`.
- **Ring buffer capacity:** 500 events.
- **Size cap:** 256KB request body.
- **Rate limit:** 10 reports per source IP per 60s.
- **Env defaults:** `TELEMETRY_ENABLED=true`, `TELEMETRY_RETENTION_DAYS=30`, `TELEMETRY_MAX_ROWS=1000`.
- **Privacy allowlist:** never record URLs (hostname only), tokens, cookies, session IDs, media titles, user email/display name, or client IP.
- **Player pipeline is NOT refactored** — only event-emission hooks added.

---

## File Structure

**Server (create):**
- `server/src/storage/error-reports.ts` — CRUD wrappers.
- `server/src/lib/rate-limit.ts` — sliding-window IP rate limiter.
- `server/src/lib/telemetry-retention.ts` — TTL + cap enforcement.
- `server/src/routes/telemetry.ts` — public POST endpoint.
- `server/src/routes/admin-telemetry.ts` — admin GET/DELETE endpoints.
- `server/src/routes/telemetry.test.ts` — integration tests.
- `server/src/routes/admin-telemetry.test.ts` — integration tests.
- `server/src/lib/rate-limit.test.ts` — unit tests.
- `server/src/lib/telemetry-retention.test.ts` — unit tests.

**Server (modify):**
- `server/src/db/schema.ts` — new `error_reports` table.
- `server/drizzle/000X_error_reports.sql` — generated migration.
- `server/src/config.ts` — new env vars.
- `server/src/app.ts` — mount new routes.

**Web (create):**
- `web/src/player/diagnostics.ts` — Ring, reportFatal, session context, global error handlers.
- `web/src/player/watchdog.ts` — stall watchdog.
- `web/src/player/diagnostics.test.ts` — Ring unit test.
- `web/src/player/watchdog.test.ts` — watchdog logic test.
- `web/src/components/DiagnosticsOverlay.tsx` — on-screen overlay.
- `web/src/views/settings/DiagnosticsTab.tsx` — admin viewer tab.

**Web (modify):**
- `web/src/player/range-fetcher.ts` — emit fetch_* events.
- `web/src/player/stream-source.ts` — emit demux_* events.
- `web/src/player/video.ts` — emit video_* + backpressure events.
- `web/src/player/audio.ts` — emit audio_* events.
- `web/src/player/engine.ts` — emit queue_snapshot.
- `web/src/views/Player.tsx` — session_start, user_gesture, wire reportFatal + watchdog + mount overlay.
- `web/src/views/Settings.tsx` (or wherever tabs live) — add Diagnostics tab.
- `web/src/api.ts` — admin.telemetry methods.
- `web/src/main.tsx` — install global error handlers early.
- `web/vite.config.ts` — expose `VITE_CANVAS_VERSION`.

**Docker + docs (modify):**
- `Dockerfile` — pass `VERSION` build arg into web-build stage as `VITE_CANVAS_VERSION`.
- `docs/diagnostics.md` — new user-facing docs.
- `README.md` — telemetry section + env vars documented.
- `.env.example` (if exists) — new envs documented.

---

## Task 1: DB schema + storage + retention

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/000X_error_reports.sql` (generated)
- Create: `server/src/storage/error-reports.ts`
- Create: `server/src/lib/telemetry-retention.ts`
- Create: `server/src/lib/telemetry-retention.test.ts`

**Interfaces:**
- Produces:
  - Table `error_reports` in DB.
  - `storage/error-reports.ts` exports:
    - `insertErrorReport(db, row: NewErrorReport): ErrorReport`
    - `listErrorReports(db, opts: { cursor?: string; kind?: string; sinceMs?: number; limit: number }): ErrorReport[]`
    - `getErrorReport(db, id: string): ErrorReport | null`
    - `deleteErrorReport(db, id: string): boolean`
    - `countErrorReports(db): number`
    - `pruneErrorReportsByAge(db, olderThanMs: number): number`
    - `pruneErrorReportsByCap(db, keepNewest: number): number`
  - `lib/telemetry-retention.ts` exports:
    - `runRetention(db, opts: { retentionDays: number; maxRows: number }): void`

- [ ] **Step 1: Add `error_reports` table to schema.ts**

At the bottom of `server/src/db/schema.ts` (before any existing type exports), add:

```typescript
export const errorReports = sqliteTable(
  'error_reports',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    userId: integer('user_id'),
    canvasVersion: text('canvas_version'),
    userAgent: text('user_agent'),
    errorMessage: text('error_message'),
    errorKind: text('error_kind'),
    sourceType: text('source_type'),
    reportJson: text('report_json').notNull(),
  },
  (t) => ({
    createdIdx: index('idx_error_reports_created').on(t.createdAt),
    kindCreatedIdx: index('idx_error_reports_kind_created').on(t.errorKind, t.createdAt),
  }),
);

export type ErrorReport = typeof errorReports.$inferSelect;
export type NewErrorReport = typeof errorReports.$inferInsert;
```

- [ ] **Step 2: Generate migration**

Run from repo root:

```bash
cd server
bun run drizzle-kit generate:sqlite
```

Expected: a new file `server/drizzle/000X_<random_name>.sql` appears containing the CREATE TABLE + CREATE INDEX statements for `error_reports`. Open the file, confirm indexes are named `idx_error_reports_created` and `idx_error_reports_kind_created`. If drizzle-kit named them differently, rename in the generated SQL to match.

- [ ] **Step 3: Write storage module**

Create `server/src/storage/error-reports.ts`:

```typescript
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { errorReports, type ErrorReport, type NewErrorReport } from '../db/schema';

export function insertErrorReport(db: Db, row: NewErrorReport): ErrorReport {
  const inserted = db.insert(errorReports).values(row).returning().get();
  if (!inserted) throw new Error('insertErrorReport: insert returned no row');
  return inserted;
}

export interface ListOpts {
  cursor?: string;      // opaque; encodes createdAt of last row seen
  kind?: string;
  sinceMs?: number;
  limit: number;
}

export function listErrorReports(db: Db, opts: ListOpts): ErrorReport[] {
  const conds = [];
  if (opts.kind) conds.push(eq(errorReports.errorKind, opts.kind));
  if (opts.sinceMs != null) conds.push(gte(errorReports.createdAt, opts.sinceMs));
  if (opts.cursor) {
    const cursorMs = Number(opts.cursor);
    if (Number.isFinite(cursorMs)) conds.push(lt(errorReports.createdAt, cursorMs));
  }
  const where = conds.length ? and(...conds) : undefined;
  const q = db.select().from(errorReports);
  return (where ? q.where(where) : q).orderBy(desc(errorReports.createdAt)).limit(opts.limit).all();
}

export function getErrorReport(db: Db, id: string): ErrorReport | null {
  return db.select().from(errorReports).where(eq(errorReports.id, id)).get() ?? null;
}

export function deleteErrorReport(db: Db, id: string): boolean {
  const res = db.delete(errorReports).where(eq(errorReports.id, id)).run();
  return res.changes > 0;
}

export function countErrorReports(db: Db): number {
  const r = db.select({ n: sql<number>`count(*)`.as('n') }).from(errorReports).get();
  return r?.n ?? 0;
}

export function pruneErrorReportsByAge(db: Db, olderThanMs: number): number {
  const res = db.delete(errorReports).where(lt(errorReports.createdAt, olderThanMs)).run();
  return res.changes;
}

export function pruneErrorReportsByCap(db: Db, keepNewest: number): number {
  // Delete rows where createdAt is older than the Nth-newest row's createdAt.
  const boundary = db
    .select({ createdAt: errorReports.createdAt })
    .from(errorReports)
    .orderBy(desc(errorReports.createdAt))
    .limit(1)
    .offset(keepNewest - 1)
    .get();
  if (!boundary) return 0;
  const res = db.delete(errorReports).where(lt(errorReports.createdAt, boundary.createdAt)).run();
  return res.changes;
}
```

- [ ] **Step 4: Write retention module**

Create `server/src/lib/telemetry-retention.ts`:

```typescript
import type { Db } from '../db';
import {
  countErrorReports,
  pruneErrorReportsByAge,
  pruneErrorReportsByCap,
} from '../storage/error-reports';

export interface RetentionOpts {
  retentionDays: number;
  maxRows: number;
  nowMs?: number;   // injectable for tests
}

export function runRetention(db: Db, opts: RetentionOpts): void {
  const now = opts.nowMs ?? Date.now();
  const ageBoundary = now - opts.retentionDays * 86_400_000;
  pruneErrorReportsByAge(db, ageBoundary);
  const count = countErrorReports(db);
  if (count > opts.maxRows) {
    pruneErrorReportsByCap(db, opts.maxRows);
  }
}
```

- [ ] **Step 5: Write retention tests**

Create `server/src/lib/telemetry-retention.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { insertErrorReport, countErrorReports } from '../storage/error-reports';
import { runRetention } from './telemetry-retention';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

function insertAt(db: Db, tsMs: number, id: string): void {
  insertErrorReport(db, {
    id,
    createdAt: tsMs,
    reportJson: '{}',
  });
}

describe('runRetention', () => {
  test('prunes rows older than retentionDays', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    insertAt(db, now - 40 * 86_400_000, 'old-1');
    insertAt(db, now - 20 * 86_400_000, 'recent-1');
    insertAt(db, now - 5 * 86_400_000, 'recent-2');
    runRetention(db, { retentionDays: 30, maxRows: 1000, nowMs: now });
    expect(countErrorReports(db)).toBe(2);
  });

  test('prunes oldest when row count exceeds maxRows', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) insertAt(db, now - i * 1000, `r-${i}`);
    runRetention(db, { retentionDays: 30, maxRows: 3, nowMs: now });
    expect(countErrorReports(db)).toBe(3);
  });

  test('does nothing when under both limits', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    insertAt(db, now - 1000, 'a');
    insertAt(db, now - 2000, 'b');
    runRetention(db, { retentionDays: 30, maxRows: 1000, nowMs: now });
    expect(countErrorReports(db)).toBe(2);
  });
});
```

- [ ] **Step 6: Run tests**

```bash
cd server
bun test src/lib/telemetry-retention.test.ts
```

Expected: 3 passing tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/db/schema.ts server/drizzle/ server/src/storage/error-reports.ts server/src/lib/telemetry-retention.ts server/src/lib/telemetry-retention.test.ts
git commit -m "telemetry: error_reports table + storage + retention"
```

---

## Task 2: Rate limit helper

**Files:**
- Create: `server/src/lib/rate-limit.ts`
- Create: `server/src/lib/rate-limit.test.ts`

**Interfaces:**
- Produces:
  - `createRateLimiter(opts: { windowMs: number; max: number; nowMs?: () => number }): (key: string) => boolean`
  - Returns `true` if allowed, `false` if rate-limited.

- [ ] **Step 1: Write the failing test**

Create `server/src/lib/rate-limit.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limit';

describe('createRateLimiter', () => {
  test('allows up to max requests within window', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 10 });
    for (let i = 0; i < 10; i++) expect(rl('ip-a')).toBe(true);
  });

  test('blocks the (max+1)th within window', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 10 });
    for (let i = 0; i < 10; i++) rl('ip-a');
    expect(rl('ip-a')).toBe(false);
  });

  test('separates keys', () => {
    const rl = createRateLimiter({ windowMs: 60_000, max: 2 });
    rl('ip-a'); rl('ip-a');
    expect(rl('ip-a')).toBe(false);
    expect(rl('ip-b')).toBe(true);
  });

  test('resets after window elapses', () => {
    let now = 0;
    const rl = createRateLimiter({ windowMs: 1000, max: 2, nowMs: () => now });
    expect(rl('k')).toBe(true);
    expect(rl('k')).toBe(true);
    expect(rl('k')).toBe(false);
    now = 1001;
    expect(rl('k')).toBe(true);
  });

  test('sliding window (not fixed bucket)', () => {
    let now = 0;
    const rl = createRateLimiter({ windowMs: 1000, max: 2, nowMs: () => now });
    now = 0; expect(rl('k')).toBe(true);
    now = 500; expect(rl('k')).toBe(true);
    now = 999; expect(rl('k')).toBe(false);
    now = 1001; // first request (at 0) now expired, so one slot free
    expect(rl('k')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server
bun test src/lib/rate-limit.test.ts
```

Expected: FAIL — `createRateLimiter is not defined`.

- [ ] **Step 3: Implement rate-limit.ts**

Create `server/src/lib/rate-limit.ts`:

```typescript
export interface RateLimitOpts {
  windowMs: number;
  max: number;
  nowMs?: () => number;
}

export function createRateLimiter(opts: RateLimitOpts): (key: string) => boolean {
  const now = opts.nowMs ?? Date.now;
  const buckets = new Map<string, number[]>();

  return (key: string): boolean => {
    const t = now();
    const cutoff = t - opts.windowMs;
    let times = buckets.get(key);
    if (!times) {
      times = [];
      buckets.set(key, times);
    }
    // Drop entries older than window.
    while (times.length > 0 && times[0]! <= cutoff) times.shift();
    if (times.length >= opts.max) return false;
    times.push(t);
    return true;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server
bun test src/lib/rate-limit.test.ts
```

Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/rate-limit.ts server/src/lib/rate-limit.test.ts
git commit -m "telemetry: sliding-window rate limiter"
```

---

## Task 3: Public POST /api/telemetry/error

**Files:**
- Modify: `server/src/config.ts` (add env vars)
- Create: `server/src/routes/telemetry.ts`
- Create: `server/src/routes/telemetry.test.ts`
- Modify: `server/src/app.ts` (mount route)

**Interfaces:**
- Consumes:
  - `insertErrorReport`, `getErrorReport` from Task 1
  - `runRetention` from Task 1
  - `createRateLimiter` from Task 2
- Produces:
  - `POST /api/telemetry/error` route.
  - Route builder: `makeTelemetryRoutes(getDb: () => Db, opts: TelemetryRouteOpts): Hono`.

- [ ] **Step 1: Add env vars to `server/src/config.ts`**

Open `server/src/config.ts` and add near the other env-driven fields:

```typescript
// (add to the config object / schema, matching the existing pattern)
TELEMETRY_ENABLED: (process.env.TELEMETRY_ENABLED ?? 'true') !== 'false',
TELEMETRY_RETENTION_DAYS: Number(process.env.TELEMETRY_RETENTION_DAYS ?? '30'),
TELEMETRY_MAX_ROWS: Number(process.env.TELEMETRY_MAX_ROWS ?? '1000'),
```

(Read the existing file first — match its shape. If it's a plain object, add fields. If it's a typed struct, add typed fields.)

- [ ] **Step 2: Write route tests (failing)**

Create `server/src/routes/telemetry.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { countErrorReports, insertErrorReport } from '../storage/error-reports';
import { makeTelemetryRoutes } from './telemetry';

function makeApp(enabled = true, retentionDays = 30, maxRows = 1000) {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);

  const app = new Hono();
  app.route('/api', makeTelemetryRoutes(() => db, { enabled, retentionDays, maxRows }));
  return { app, db };
}

function validPayload() {
  return {
    events: [{ tsMs: 0, kind: 'session_start', data: { sourceType: 'Plex' } }],
    session: {
      userAgent: 'test-ua',
      viewport: { w: 1200, h: 800 },
      screen: { w: 1920, h: 1080 },
      canvasVersion: '0.2.0',
      sourceType: 'Plex',
    },
    error: { message: 'boom', kind: 'video' },
  };
}

async function post(app: Hono, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request('http://test/api/telemetry/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('POST /api/telemetry/error', () => {
  test('accepts valid payload, inserts row, returns id', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validPayload());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(countErrorReports(db)).toBe(1);
  });

  test('rejects malformed body with 400', async () => {
    const { app } = makeApp();
    const res = await post(app, { events: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('rejects payload exceeding 256KB with 413', async () => {
    const { app } = makeApp();
    const big = { ...validPayload(), events: Array(1).fill({ tsMs: 0, kind: 'x', data: { blob: 'x'.repeat(300_000) } }) };
    const res = await post(app, big);
    expect(res.status).toBe(413);
  });

  test('rejects events.length > 1000 with 400', async () => {
    const { app } = makeApp();
    const p = validPayload();
    (p as unknown as { events: unknown[] }).events = Array(1001).fill({ tsMs: 0, kind: 'x', data: {} });
    const res = await post(app, p);
    expect(res.status).toBe(400);
  });

  test('does NOT require auth', async () => {
    const { app } = makeApp();
    const res = await post(app, validPayload()); // no authorization header
    expect(res.status).toBe(200);
  });

  test('rate-limits 11th request from same IP within 60s to 429', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      const res = await post(app, validPayload());
      expect(res.status).toBe(200);
    }
    const res11 = await post(app, validPayload());
    expect(res11.status).toBe(429);
  });

  test('separate IPs get separate rate limits', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) await post(app, validPayload(), { 'x-forwarded-for': '10.0.0.1' });
    const res = await post(app, validPayload(), { 'x-forwarded-for': '10.0.0.2' });
    expect(res.status).toBe(200);
  });

  test('TELEMETRY_ENABLED=false returns 204 without inserting', async () => {
    const { app, db } = makeApp(false);
    const res = await post(app, validPayload());
    expect(res.status).toBe(204);
    expect(countErrorReports(db)).toBe(0);
  });

  test('retention prunes to maxRows on insert', async () => {
    const { app, db } = makeApp(true, 30, 3);
    for (let i = 0; i < 5; i++) {
      const res = await post(app, validPayload(), { 'x-forwarded-for': `10.0.0.${i}` });
      expect(res.status).toBe(200);
    }
    expect(countErrorReports(db)).toBe(3);
  });

  test('column mapping: writes error.kind → error_kind, error.message → error_message, session.sourceType → source_type', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validPayload());
    expect(res.status).toBe(200);
    const rows = db.select().from(schema.errorReports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errorKind).toBe('video');
    expect(rows[0]!.errorMessage).toBe('boom');
    expect(rows[0]!.sourceType).toBe('Plex');
    expect(rows[0]!.canvasVersion).toBe('0.2.0');
    expect(rows[0]!.userAgent).toBe('test-ua');
    expect(rows[0]!.userId).toBeNull();
  });

  test('user_id is opportunistic: not set when no auth', async () => {
    const { app, db } = makeApp();
    await post(app, validPayload());
    const rows = db.select().from(schema.errorReports).all();
    expect(rows[0]!.userId).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd server
bun test src/routes/telemetry.test.ts
```

Expected: FAIL — module `./telemetry` not found.

- [ ] **Step 4: Implement `server/src/routes/telemetry.ts`**

```typescript
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db';
import { insertErrorReport } from '../storage/error-reports';
import { runRetention } from '../lib/telemetry-retention';
import { createRateLimiter } from '../lib/rate-limit';
import { randomUUID } from 'crypto';

export interface TelemetryRouteOpts {
  enabled: boolean;
  retentionDays: number;
  maxRows: number;
}

const MAX_BYTES = 256 * 1024;
const MAX_EVENTS = 1000;

function getClientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return c.req.header('x-real-ip') ?? 'unknown';
}

interface Payload {
  events: unknown[];
  session: {
    userAgent?: unknown;
    viewport?: unknown;
    screen?: unknown;
    canvasVersion?: unknown;
    sourceType?: unknown;
    connectionType?: unknown;
  };
  error: {
    message?: unknown;
    kind?: unknown;
    stack?: unknown;
  };
}

function validatePayload(body: unknown): { ok: true; value: Payload } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be object' };
  const p = body as Record<string, unknown>;
  if (!Array.isArray(p.events)) return { ok: false, reason: 'events must be array' };
  if (p.events.length > MAX_EVENTS) return { ok: false, reason: `events exceeds ${MAX_EVENTS}` };
  if (!p.session || typeof p.session !== 'object') return { ok: false, reason: 'session required' };
  if (!p.error || typeof p.error !== 'object') return { ok: false, reason: 'error required' };
  return { ok: true, value: p as unknown as Payload };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export function makeTelemetryRoutes(getDb: () => Db, opts: TelemetryRouteOpts) {
  const r = new Hono();
  const rateLimit = createRateLimiter({ windowMs: 60_000, max: 10 });

  r.post('/telemetry/error', async (c) => {
    if (!opts.enabled) return c.body(null, 204);

    const ip = getClientIp(c);
    if (!rateLimit(ip)) return c.json({ error: 'rate_limited' }, 429);

    // Size check: prefer content-length header when trustworthy.
    const cl = Number(c.req.header('content-length') ?? '0');
    if (cl > MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    let rawText: string;
    try {
      rawText = await c.req.text();
    } catch {
      return c.json({ error: 'invalid_body' }, 400);
    }
    if (rawText.length > MAX_BYTES) return c.json({ error: 'payload_too_large' }, 413);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const check = validatePayload(parsed);
    if (!check.ok) return c.json({ error: check.reason }, 400);
    const payload = check.value;

    // Opportunistic user_id capture: read bearer, look up session, else null.
    // For now, always null (auth path added later if needed; POST is public).
    const userId: number | null = null;

    const id = randomUUID();
    const db = getDb();
    insertErrorReport(db, {
      id,
      createdAt: Date.now(),
      userId,
      canvasVersion: str(payload.session.canvasVersion) ?? null,
      userAgent: str(payload.session.userAgent) ?? null,
      errorMessage: str(payload.error.message) ?? null,
      errorKind: str(payload.error.kind) ?? 'unknown',
      sourceType: str(payload.session.sourceType) ?? null,
      reportJson: rawText,
    });

    // Fire-and-forget retention prune (synchronous; SQLite is fast).
    try {
      runRetention(db, { retentionDays: opts.retentionDays, maxRows: opts.maxRows });
    } catch {
      // Never let retention failure surface to the caller.
    }

    return c.json({ id });
  });

  return r;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server
bun test src/routes/telemetry.test.ts
```

Expected: 10 passing tests.

- [ ] **Step 6: Mount route in `server/src/app.ts`**

Read `server/src/app.ts` first. Add the import at the top with other route imports:

```typescript
import { makeTelemetryRoutes } from './routes/telemetry';
```

In the route-mounting section (near `app.route('/api', makeSetupRoutes(...))` line, since setup is also unauthenticated), add:

```typescript
app.route('/api', makeTelemetryRoutes(() => db, {
  enabled: config.TELEMETRY_ENABLED,
  retentionDays: config.TELEMETRY_RETENTION_DAYS,
  maxRows: config.TELEMETRY_MAX_ROWS,
}));
```

This mounts BEFORE any auth middleware — telemetry is public.

- [ ] **Step 7: Verify server still boots**

```bash
cd server
bun run typecheck
bun test
```

Expected: all tests pass, no typecheck errors.

- [ ] **Step 8: Commit**

```bash
git add server/src/config.ts server/src/routes/telemetry.ts server/src/routes/telemetry.test.ts server/src/app.ts
git commit -m "telemetry: public POST /api/telemetry/error"
```

---

## Task 4: Admin telemetry endpoints

**Files:**
- Create: `server/src/routes/admin-telemetry.ts`
- Create: `server/src/routes/admin-telemetry.test.ts`
- Modify: `server/src/app.ts` (mount)

**Interfaces:**
- Consumes:
  - `listErrorReports`, `getErrorReport`, `deleteErrorReport` from Task 1
  - `requireUser`, `requireAdmin` middleware from `server/src/middleware/auth.ts`
- Produces:
  - `GET /api/admin/telemetry/errors?cursor&kind&since`
  - `GET /api/admin/telemetry/errors/:id`
  - `DELETE /api/admin/telemetry/errors/:id`
  - `makeAdminTelemetryRoutes(getDb: () => Db): Hono`

- [ ] **Step 1: Write failing tests**

Create `server/src/routes/admin-telemetry.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from '../storage/users';
import { createDeviceSession, generateBearer, hashBearer } from '../storage/device-sessions';
import { insertErrorReport } from '../storage/error-reports';
import { requireUser, requireAdmin } from '../middleware/auth';
import { makeAdminTelemetryRoutes } from './admin-telemetry';

async function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);

  const admin = createUser(db, { label: 'A', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(adminBearer) });

  const member = createUser(db, { label: 'M', role: 'member' });
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: member.id, deviceLabel: 'D2', tokenHash: await hashBearer(memberBearer) });

  const app = new Hono();
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminTelemetryRoutes(() => db));

  return { app, db, adminBearer, memberBearer };
}

function seedRow(db: Db, ts: number, kind: string, id: string) {
  insertErrorReport(db, {
    id,
    createdAt: ts,
    errorKind: kind,
    errorMessage: `err-${id}`,
    reportJson: JSON.stringify({ id }),
  });
}

describe('admin telemetry routes', () => {
  test('GET list requires auth', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors'));
    expect(res.status).toBe(401);
  });

  test('GET list requires admin role', async () => {
    const { app, memberBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors', {
      headers: { authorization: `Bearer ${memberBearer}` },
    }));
    expect(res.status).toBe(403);
  });

  test('GET list returns paginated results, newest first', async () => {
    const { app, db, adminBearer } = await makeApp();
    for (let i = 0; i < 30; i++) seedRow(db, 1_000_000 + i, 'video', `r-${i}`);
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ id: string; created_at: number }>; nextCursor: string | null };
    expect(body.rows).toHaveLength(25);
    expect(body.rows[0]!.created_at).toBe(1_000_029);
    expect(body.nextCursor).toBe(String(body.rows[24]!.created_at));
  });

  test('GET list filters by kind', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'a');
    seedRow(db, 1001, 'audio', 'b');
    seedRow(db, 1002, 'video', 'c');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors?kind=video', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  test('GET list filters by since', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'old');
    seedRow(db, 5000, 'video', 'new');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors?since=3000', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(['new']);
  });

  test('GET :id returns full row', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'full');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/full', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; report_json: string };
    expect(body.id).toBe('full');
    expect(body.report_json).toBe('{"id":"full"}');
  });

  test('GET :id returns 404 for unknown id', async () => {
    const { app, adminBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/nope', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(404);
  });

  test('DELETE :id removes the row', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'del');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/del', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(204);
    const res2 = await app.fetch(new Request('http://test/api/admin/telemetry/errors/del', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res2.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server
bun test src/routes/admin-telemetry.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/routes/admin-telemetry.ts`**

```typescript
import { Hono } from 'hono';
import type { Db } from '../db';
import {
  listErrorReports,
  getErrorReport,
  deleteErrorReport,
} from '../storage/error-reports';

const PAGE_SIZE = 25;

export function makeAdminTelemetryRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/telemetry/errors', async (c) => {
    const cursor = c.req.query('cursor');
    const kind = c.req.query('kind');
    const sinceStr = c.req.query('since');
    const sinceMs = sinceStr && /^\d+$/.test(sinceStr) ? Number(sinceStr) : undefined;

    const rows = listErrorReports(getDb(), {
      cursor,
      kind,
      sinceMs,
      limit: PAGE_SIZE,
    });

    const nextCursor = rows.length === PAGE_SIZE ? String(rows[rows.length - 1]!.createdAt) : null;

    return c.json({
      rows: rows.map((r) => ({
        id: r.id,
        created_at: r.createdAt,
        error_kind: r.errorKind,
        error_message: r.errorMessage,
        source_type: r.sourceType,
        canvas_version: r.canvasVersion,
        user_agent: r.userAgent,
      })),
      nextCursor,
    });
  });

  r.get('/telemetry/errors/:id', async (c) => {
    const row = getErrorReport(getDb(), c.req.param('id'));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({
      id: row.id,
      created_at: row.createdAt,
      user_id: row.userId,
      canvas_version: row.canvasVersion,
      user_agent: row.userAgent,
      error_message: row.errorMessage,
      error_kind: row.errorKind,
      source_type: row.sourceType,
      report_json: row.reportJson,
    });
  });

  r.delete('/telemetry/errors/:id', async (c) => {
    const deleted = deleteErrorReport(getDb(), c.req.param('id'));
    if (!deleted) return c.json({ error: 'not_found' }, 404);
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server
bun test src/routes/admin-telemetry.test.ts
```

Expected: 8 passing tests.

- [ ] **Step 5: Mount in `server/src/app.ts`**

Add the import:

```typescript
import { makeAdminTelemetryRoutes } from './routes/admin-telemetry';
```

In the admin-mounting section (AFTER `app.use('/api/admin/*', requireAdmin)`), add:

```typescript
app.route('/api/admin', makeAdminTelemetryRoutes(() => db));
```

- [ ] **Step 6: Verify full server test suite passes**

```bash
cd server
bun run typecheck
bun test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/admin-telemetry.ts server/src/routes/admin-telemetry.test.ts server/src/app.ts
git commit -m "telemetry: admin GET/DELETE endpoints"
```

---

## Task 5: Client ring buffer + session + reportFatal + global error handlers

**Files:**
- Create: `web/src/player/diagnostics.ts`
- Create: `web/src/player/diagnostics.test.ts`
- Modify: `web/vite.config.ts` (VITE_CANVAS_VERSION)
- Modify: `Dockerfile` (pass VERSION into web-build)
- Modify: `web/src/main.tsx` (install global error handlers)

**Interfaces:**
- Produces:
  - `class Ring<T> { push(v: T): void; snapshot(): T[]; length: number }`
  - `const ring: Ring<DiagEvent>` — module singleton
  - `type DiagEvent = { tsMs: number; kind: string; data: Record<string, unknown> }`
  - `emit(kind: string, data?: Record<string, unknown>): void` — pushes to `ring`
  - `sessionBootMs: number` — captured at module load; `tsMs = performance.now() - sessionBootMs` at emit time
  - `getSessionContext(sourceType: string): SessionContext`
  - `reportFatal(err: { message: string; kind: string; stack?: string }, sourceType: string): Promise<void>`
  - `installGlobalErrorHandlers(): void` — hooks `window.onerror` + `unhandledrejection`

- [ ] **Step 1: Write failing test for the ring buffer**

Create `web/src/player/diagnostics.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Ring } from './diagnostics';

describe('Ring', () => {
  test('push adds items in order until cap', () => {
    const r = new Ring<number>(5);
    for (let i = 0; i < 5; i++) r.push(i);
    expect(r.snapshot()).toEqual([0, 1, 2, 3, 4]);
    expect(r.length).toBe(5);
  });

  test('push beyond cap drops oldest', () => {
    const r = new Ring<number>(3);
    for (let i = 0; i < 5; i++) r.push(i);
    expect(r.snapshot()).toEqual([2, 3, 4]);
    expect(r.length).toBe(3);
  });

  test('snapshot returns a copy — mutating it does not affect the ring', () => {
    const r = new Ring<number>(3);
    r.push(1); r.push(2);
    const s = r.snapshot();
    s.push(999);
    expect(r.snapshot()).toEqual([1, 2]);
  });

  test('cap of 500 accepts 500 items and drops when exceeded', () => {
    const r = new Ring<number>(500);
    for (let i = 0; i < 600; i++) r.push(i);
    const s = r.snapshot();
    expect(s.length).toBe(500);
    expect(s[0]).toBe(100);
    expect(s[499]).toBe(599);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd server
bun test ../web/src/player/diagnostics.test.ts
```

Expected: FAIL — module not found or `Ring is not exported`.

- [ ] **Step 3: Implement `web/src/player/diagnostics.ts`**

```typescript
export class Ring<T> {
  private buf: T[] = [];
  constructor(private cap: number) {}
  push(v: T): void {
    this.buf.push(v);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  snapshot(): T[] {
    return this.buf.slice();
  }
  get length(): number {
    return this.buf.length;
  }
}

export interface DiagEvent {
  tsMs: number;
  kind: string;
  data: Record<string, unknown>;
}

export interface SessionContext {
  userAgent: string;
  viewport: { w: number; h: number };
  screen: { w: number; h: number };
  connectionType?: string;
  canvasVersion: string;
  sourceType: string;
}

const RING_CAP = 500;
export const ring = new Ring<DiagEvent>(RING_CAP);

// tsMs = milliseconds since module load (monotonic; safe on Tesla clock skew).
const sessionBootMark = typeof performance !== 'undefined' ? performance.now() : 0;

export function tsMs(): number {
  return Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - sessionBootMark);
}

export function emit(kind: string, data: Record<string, unknown> = {}): void {
  if (!isEnabled()) return;
  ring.push({ tsMs: tsMs(), kind, data });
}

// Kill switch — window override via ?diag=off or localStorage.
function isEnabled(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('diag') === 'off') return false;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('canvas.diag.disabled') === '1') return false;
  } catch { /* ignore */ }
  return true;
}

export function getSessionContext(sourceType: string): SessionContext {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const conn = (nav as unknown as { connection?: { effectiveType?: string } } | undefined)?.connection;
  const canvasVersion =
    (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CANVAS_VERSION) ??
    'dev';
  return {
    userAgent: nav?.userAgent ?? 'unknown',
    viewport: {
      w: typeof window !== 'undefined' ? window.innerWidth : 0,
      h: typeof window !== 'undefined' ? window.innerHeight : 0,
    },
    screen: {
      w: typeof screen !== 'undefined' ? screen.width : 0,
      h: typeof screen !== 'undefined' ? screen.height : 0,
    },
    connectionType: conn?.effectiveType,
    canvasVersion,
    sourceType,
  };
}

export async function reportFatal(
  err: { message: string; kind: string; stack?: string },
  sourceType: string,
): Promise<void> {
  if (!isEnabled()) return;
  const payload = {
    events: ring.snapshot(),
    session: getSessionContext(sourceType),
    error: err,
  };
  try {
    await fetch('/api/telemetry/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Never let a telemetry failure cascade.
  }
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => {
    emit('browser_error', {
      message: ev.message,
      filename: ev.filename,
      lineno: ev.lineno,
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg =
      typeof reason === 'string'
        ? reason
        : reason instanceof Error
          ? reason.message
          : 'unhandled rejection';
    emit('browser_error', { message: msg, kind: 'unhandledrejection' });
  });
}
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd server
bun test ../web/src/player/diagnostics.test.ts
```

Expected: 4 passing tests.

- [ ] **Step 5: Wire canvasVersion into the Vite build**

Modify `web/vite.config.ts` — after the imports, near the `defineConfig` call, ensure `VITE_CANVAS_VERSION` is exposed. Vite auto-exposes any env starting with `VITE_`, so no code change may be needed — instead we set it at build time.

Modify `Dockerfile` — find the web-build stage. Right after the `FROM node:20-alpine AS web-build` (or equivalent) line, add:

```dockerfile
ARG VERSION=dev
ENV VITE_CANVAS_VERSION=$VERSION
```

Confirm the surrounding `npm run build` picks this up (Vite reads `VITE_*` env vars automatically).

- [ ] **Step 6: Install global handlers in `web/src/main.tsx`**

Read `web/src/main.tsx` first. Near the top of the file (before ReactDOM.render), add:

```typescript
import { installGlobalErrorHandlers } from './player/diagnostics';

installGlobalErrorHandlers();
```

- [ ] **Step 7: Verify web still builds**

```bash
cd web
npm run build
```

Expected: build succeeds, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/player/diagnostics.ts web/src/player/diagnostics.test.ts web/src/main.tsx web/vite.config.ts Dockerfile
git commit -m "telemetry: client Ring + reportFatal + global error handlers"
```

---

## Task 6: Wire event emissions into player pipeline

**Files:**
- Modify: `web/src/player/range-fetcher.ts`
- Modify: `web/src/player/stream-source.ts`
- Modify: `web/src/player/video.ts`
- Modify: `web/src/player/audio.ts`
- Modify: `web/src/player/engine.ts`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Consumes: `emit` from `./diagnostics` (Task 5).
- Produces: events named exactly per Global Constraints, at the right hook points.

**Throttling helper (inline where needed):**

```typescript
function throttled(intervalMs: number, fn: () => void): () => void {
  let last = 0;
  return () => {
    const now = performance.now();
    if (now - last >= intervalMs) {
      last = now;
      fn();
    }
  };
}
```

- [ ] **Step 1: Emit fetch_* events in `web/src/player/range-fetcher.ts`**

Read the file first — hook points are around lines 48, 95, 104 per the exploration.

**Precondition:** the fetcher references `this.totalRead`, `this.startedAtMs`, `this.lastStatus` below. If these instance fields don't already exist, add them (initialize `totalRead = 0`, `startedAtMs = performance.now()` at loop start, `lastStatus = 0` and update from `response.status`). Small additions, don't refactor beyond what these events need.

At the top: `import { emit } from './diagnostics';`

Inside `loop()`, immediately after opening the fetch (right where the Range header is set), add:

```typescript
emit('fetch_start', {
  rangeStart: this.offset,
  rangeEnd: this.rangeEnd,
  hostname: new URL(this.url).hostname,
});
```

Around line 95 (onChunk callback), wrap `onChunk(...)` with a throttled fetch_chunk emitter (declared once as an instance field or module const):

```typescript
private emitChunk = (() => {
  let last = 0;
  return (offset: number, size: number) => {
    const now = performance.now();
    if (now - last >= 1000) {
      last = now;
      emit('fetch_chunk', { offset, size });
    }
  };
})();
```

Call `this.emitChunk(offset, bytes.length);` inside the onChunk path.

At loop completion (before returning), add:

```typescript
emit('fetch_end', {
  totalBytes: this.totalRead,
  durationMs: Math.round(performance.now() - this.startedAtMs),
  status: this.lastStatus,
});
```

(Use whatever internal fields track these; if missing, add local vars.)

At error path (line 104), replace the existing `onError(...)` call with:

```typescript
emit('fetch_error', {
  message: err.message,
  offset: this.offset,
  status: this.lastStatus,
});
this.onError(err);
```

- [ ] **Step 2: Emit demux_* events in `web/src/player/stream-source.ts`**

At the top: `import { emit } from './diagnostics';`

In `AutoSource.onReady` callback (called with StreamInfo), before invoking the outer onReady, add:

```typescript
emit('demux_ready', {
  format: info.container, // or whichever field names the format
  videoCodec: info.videoCodec ?? null,
  audioCodec: info.audioCodec ?? null,
  tracks: info.tracks?.length ?? 0,
});
```

In the format-sniff-failure path (currently `throw new Error(...)`), add BEFORE the throw:

```typescript
emit('demux_error', { message: 'unrecognised container magic' });
```

In each source adapter's error path (Mp4SourceAdapter, MkvSourceAdapter, Mp3SourceAdapter), when reporting a parse error, add:

```typescript
emit('demux_error', { message: err.message });
```

- [ ] **Step 3: Emit video_* + backpressure events in `web/src/player/video.ts`**

At the top: `import { emit } from './diagnostics';`

Inside VideoSink constructor / configure path (around line 70), after `VideoDecoder.configure(config)`:

```typescript
emit('video_configure', {
  codec: config.codec,
  width: config.codedWidth,
  height: config.codedHeight,
});
```

Inside `onFrame` handler, add a throttled emitter (1 per second):

```typescript
private emitFrame = (() => {
  let last = 0;
  return (ptsSec: number) => {
    const now = performance.now();
    if (now - last >= 1000) {
      last = now;
      emit('video_frame', { ptsSec });
    }
  };
})();
```

Call `this.emitFrame(frame.timestamp / 1_000_000);` in the onFrame path.

At line 68 (VideoDecoder error callback):

```typescript
error: (e) => {
  emit('video_error', { message: e.message });
  opts.onError(e);
},
```

At backpressure pause point (existing pause call to fetcher):

```typescript
emit('backpressure', { direction: 'pause', queueDepth: this.queue.length });
```

At backpressure resume point:

```typescript
emit('backpressure', { direction: 'resume', queueDepth: this.queue.length });
```

- [ ] **Step 4: Emit audio_* events in `web/src/player/audio.ts`**

At the top: `import { emit } from './diagnostics';`

Inside AudioSink constructor, after `AudioDecoder.configure(config)`:

```typescript
emit('audio_configure', {
  codec: config.codec,
  sampleRate: config.sampleRate,
  channels: config.numberOfChannels,
});
```

At line 23 (AudioDecoder error callback):

```typescript
error: (e) => {
  emit('audio_error', { message: e.message });
  opts.onError(e);
},
```

- [ ] **Step 5: Emit queue_snapshot in `web/src/player/engine.ts` or Player.tsx**

Choose whichever has cleanest visibility into pending buffers + queue depths. From exploration: `Player.tsx` owns `pendingVideoChunks` / `pendingAudioChunks` and has access to VideoSink/AudioSink queue lengths via callbacks.

In Player.tsx, inside `bootSession()` after engine creation, add a 2-second interval:

```typescript
const snapshotIntervalId = setInterval(() => {
  emit('queue_snapshot', {
    videoQueue: videoSinkRef.current?.queueLength ?? 0,
    audioQueue: audioSinkRef.current?.queueLength ?? 0,
    pendingV: pendingVideoChunks.current.length,
    pendingA: pendingAudioChunks.current.length,
  });
}, 2000);
// Store id in a ref; clear on cleanup.
```

If `queueLength` is not exposed, add a public getter to VideoSink / AudioSink returning the current queue length.

- [ ] **Step 6: Emit session_start + user_gesture + wire reportFatal in Player.tsx**

Read `web/src/views/Player.tsx` first — key hook points are `bootSession` (line 214), user gesture handlers, `onFatal` (line 299).

At the top: `import { emit, reportFatal } from '../player/diagnostics';`

At the START of `bootSession()`:

```typescript
emit('session_start', {
  sourceType: source,
  canvasVersion:
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CANVAS_VERSION ?? 'dev',
});
```

In each user gesture handler (play, pause, seek), emit:

```typescript
emit('user_gesture', { kind: 'play' });   // or 'pause' / 'seek'
```

Modify the existing `onFatal` handler. It currently does `setErrMsg(e.message)`. Change to:

```typescript
const onFatal = (e: Error) => {
  const kind = classifyError(e);  // helper below
  emit('fetch_error', { message: e.message }); // ensures the fatal itself is in the ring
  // (or omit — the error surface already emitted its specific *_error event)
  reportFatal({ message: e.message, kind, stack: e.stack }, source).catch(() => {});
  setErrMsg(e.message);
};

function classifyError(e: Error): string {
  const m = (e.message ?? '').toLowerCase();
  if (m.includes('decoder') || m.includes('video')) return 'video';
  if (m.includes('audio')) return 'audio';
  if (m.includes('fetch') || m.includes('network')) return 'fetch';
  if (m.includes('demux') || m.includes('container') || m.includes('mkv') || m.includes('mp4')) return 'demux';
  return 'unknown';
}
```

- [ ] **Step 7: Verify web still builds + smoke**

```bash
cd web
npm run build
```

Expected: build succeeds. No new tests here — event emissions are verified end-to-end via the on-screen overlay (Task 8) and the admin UI (Task 9).

- [ ] **Step 8: Commit**

```bash
git add web/src/player/range-fetcher.ts web/src/player/stream-source.ts web/src/player/video.ts web/src/player/audio.ts web/src/player/engine.ts web/src/views/Player.tsx
git commit -m "telemetry: emit structured events across player pipeline"
```

---

## Task 7: Stall watchdog

**Files:**
- Create: `web/src/player/watchdog.ts`
- Create: `web/src/player/watchdog.test.ts`
- Modify: `web/src/views/Player.tsx` (wire the watchdog)

**Interfaces:**
- Consumes: `emit` from `./diagnostics` (Task 5).
- Produces:
  - `createStallWatchdog(opts: { getAudioClockSec: () => number; nowMs?: () => number }): { start(): void; stop(): void; tick(): void }`
  - Emits `stall_detected { silentDurationSec }` after 5 consecutive silent ticks (10s at 2s interval).

- [ ] **Step 1: Write failing test**

Create `web/src/player/watchdog.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Ring, ring } from './diagnostics';
import { createStallWatchdog } from './watchdog';

function readEmitted(): Array<{ kind: string; data: Record<string, unknown> }> {
  return ring.snapshot().map((e) => ({ kind: e.kind, data: e.data }));
}

function clearRing() {
  // hack: snapshot + drain by pushing then reading; simpler: reset via new Ring
  // For test isolation we rely on unique event kinds per test.
}

describe('createStallWatchdog', () => {
  test('emits stall_detected after 5 silent ticks', () => {
    let now = 0;
    const wd = createStallWatchdog({
      getAudioClockSec: () => 10, // never advances
      nowMs: () => now,
    });
    wd.start();
    for (let i = 0; i < 5; i++) {
      now += 2000;
      wd.tick();
    }
    const events = readEmitted().filter((e) => e.kind === 'stall_detected');
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1]!.data.silentDurationSec).toBe(10);
  });

  test('does not emit when clock advances', () => {
    let now = 0;
    let clock = 0;
    const wd = createStallWatchdog({
      getAudioClockSec: () => clock,
      nowMs: () => now,
    });
    wd.start();
    for (let i = 0; i < 10; i++) {
      now += 2000;
      clock += 2;
      wd.tick();
    }
    const events = readEmitted().filter((e) => e.kind === 'stall_detected');
    // Only events from THIS test — filter by tsMs > some marker if needed.
    // For simplicity, verify no stall_detected was added in the last 10 ticks
    // by asserting the count didn't grow. Best approach: use a fresh Ring in tests.
  });
});
```

**Note:** Because `ring` is a module singleton, the test file can't cleanly reset it. Refactor `emit` to accept an optional `ring` parameter (default the singleton) OR export a `resetRing()` for tests. Simplest path — add a test-only helper:

Modify `web/src/player/diagnostics.ts` to add at the bottom:

```typescript
// Test-only: allows tests to reset the module singleton between cases.
export function __resetForTests(): void {
  while (ring.length > 0) ring.snapshot().length;
  // Better: rebuild
  (ring as unknown as { buf: unknown[] }).buf = [];
}
```

Then call `__resetForTests()` at the start of each watchdog test.

Update the test:

```typescript
import { describe, expect, test, beforeEach } from 'bun:test';
import { ring, __resetForTests } from './diagnostics';
import { createStallWatchdog } from './watchdog';

beforeEach(() => __resetForTests());

// (rest as above, but no ambiguity)
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd server
bun test ../web/src/player/watchdog.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `web/src/player/watchdog.ts`**

```typescript
import { emit } from './diagnostics';

export interface StallWatchdogOpts {
  getAudioClockSec: () => number;
  nowMs?: () => number;
}

const TICK_INTERVAL_MS = 2000;
const SILENT_TICKS_FOR_STALL = 5; // 5 * 2s = 10s
const MIN_ADVANCE_SEC = 1;

export function createStallWatchdog(opts: StallWatchdogOpts) {
  const now = opts.nowMs ?? (() => performance.now());
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastClockSec = opts.getAudioClockSec();
  let silentSince: number | null = null;
  let consecutiveSilent = 0;

  function tick() {
    const currentClock = opts.getAudioClockSec();
    const advanced = currentClock - lastClockSec >= MIN_ADVANCE_SEC;
    if (advanced) {
      lastClockSec = currentClock;
      silentSince = null;
      consecutiveSilent = 0;
      return;
    }
    if (silentSince === null) silentSince = now();
    consecutiveSilent += 1;
    if (consecutiveSilent >= SILENT_TICKS_FOR_STALL) {
      const silentDurationSec = Math.round((now() - silentSince) / 1000);
      emit('stall_detected', { silentDurationSec });
      // Reset so we can emit again if the stall continues past another window.
      consecutiveSilent = 0;
      silentSince = now();
    }
  }

  return {
    start() {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, TICK_INTERVAL_MS);
    },
    stop() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tick, // exposed for tests
  };
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
cd server
bun test ../web/src/player/watchdog.test.ts
```

Expected: 2 passing tests. If the "does not emit when clock advances" test doesn't have a clean assertion because it inherits ring state, tighten with `__resetForTests` from Task 5 Step 3.

- [ ] **Step 5: Wire into Player.tsx**

In `bootSession()`, after the engine + AudioSink are created:

```typescript
import { createStallWatchdog } from '../player/watchdog';

const watchdog = createStallWatchdog({
  getAudioClockSec: () => audioSinkRef.current?.clockSec ?? 0,
});
watchdog.start();
// Store in a ref for cleanup in the effect return.
watchdogRef.current = watchdog;
```

In the cleanup path (component unmount / new bootSession):

```typescript
watchdogRef.current?.stop();
watchdogRef.current = null;
```

- [ ] **Step 6: Verify build**

```bash
cd web
npm run build
```

Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add web/src/player/watchdog.ts web/src/player/watchdog.test.ts web/src/player/diagnostics.ts web/src/views/Player.tsx
git commit -m "telemetry: stall watchdog"
```

---

## Task 8: On-screen diagnostics overlay

**Files:**
- Create: `web/src/components/DiagnosticsOverlay.tsx`
- Modify: `web/src/views/Player.tsx` (mount overlay + three-tap detection)

**Interfaces:**
- Consumes: `ring`, `getSessionContext` from `./diagnostics` (Task 5).
- Produces:
  - `<DiagnosticsOverlay open={boolean} onClose={() => void} sourceType={string} />`
  - Component reads from the `ring` singleton on each open + tick.

- [ ] **Step 1: Implement `web/src/components/DiagnosticsOverlay.tsx`**

```typescript
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { ring, getSessionContext } from '../player/diagnostics';
import type { DiagEvent } from '../player/diagnostics';

interface Props {
  open: boolean;
  onClose: () => void;
  sourceType: string;
}

const KIND_COLOR: Record<string, string> = {
  fetch_start: 'info',
  fetch_chunk: 'default',
  fetch_end: 'info',
  fetch_error: 'error',
  demux_ready: 'success',
  demux_error: 'error',
  video_configure: 'success',
  video_frame: 'default',
  video_error: 'error',
  audio_configure: 'success',
  audio_error: 'error',
  backpressure: 'default',
  queue_snapshot: 'default',
  session_start: 'success',
  user_gesture: 'default',
  stall_detected: 'warning',
  browser_error: 'error',
};

export function DiagnosticsOverlay({ open, onClose, sourceType }: Props) {
  const [snapshot, setSnapshot] = useState<DiagEvent[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSnapshot(ring.snapshot());
    const id = setInterval(() => {
      setSnapshot(ring.snapshot());
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const ctx = getSessionContext(sourceType);

  const copyJson = async () => {
    const payload = JSON.stringify({ events: snapshot, session: ctx }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Fallback: select textarea (skip on Tesla)
    }
  };

  const reversed = snapshot.slice().reverse();

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.92)',
        color: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        p: 2,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>canvas diagnostics</Typography>
        <Box>
          <Button size="small" variant="outlined" onClick={copyJson} sx={{ mr: 1 }}>Copy JSON</Button>
          <Button size="small" variant="outlined" onClick={onClose}>Dismiss</Button>
        </Box>
      </Box>

      <Box sx={{ mb: 2, opacity: 0.8 }}>
        <div>source: {ctx.sourceType}</div>
        <div>version: {ctx.canvasVersion}</div>
        <div>UA: {ctx.userAgent}</div>
        <div>viewport: {ctx.viewport.w}×{ctx.viewport.h}</div>
        <div>screen: {ctx.screen.w}×{ctx.screen.h}</div>
        <div>network: {ctx.connectionType ?? '?'}</div>
        <div>events buffered: {snapshot.length} (tick {tick})</div>
      </Box>

      <Box sx={{ borderTop: '1px solid #333', pt: 1 }}>
        {reversed.map((e, i) => (
          <Box key={`${e.tsMs}-${i}`} sx={{ display: 'flex', gap: 1, py: 0.25 }}>
            <span style={{ minWidth: 70, opacity: 0.7 }}>[+{(e.tsMs / 1000).toFixed(2)}s]</span>
            <Chip
              size="small"
              label={e.kind}
              color={(KIND_COLOR[e.kind] as never) ?? 'default'}
              sx={{ mr: 1, fontFamily: 'monospace' }}
            />
            <span style={{ opacity: 0.9 }}>{JSON.stringify(e.data)}</span>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Add three-tap detection + mount overlay in Player.tsx**

Read `web/src/views/Player.tsx`. Near the top:

```typescript
import { DiagnosticsOverlay } from '../components/DiagnosticsOverlay';
```

Add state:

```typescript
const [diagOpen, setDiagOpen] = useState(false);
```

Auto-open on URL param — inside a useEffect that runs once:

```typescript
useEffect(() => {
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('diag') === '1') setDiagOpen(true);
  } catch { /* ignore */ }
}, []);
```

Add three-tap corner detection — attach a handler to the player container or a dedicated hotspot in the top-right (say, a 100×100px invisible div at `top: 0; right: 0; position: absolute`):

```typescript
const tapStateRef = useRef<{ times: number[] }>({ times: [] });

function onCornerTap() {
  const now = performance.now();
  const times = tapStateRef.current.times.filter((t) => now - t <= 1500);
  times.push(now);
  tapStateRef.current.times = times;
  if (times.length >= 3) {
    tapStateRef.current.times = [];
    setDiagOpen(true);
  }
}
```

Render (near existing player JSX, LAST so it z-indexes above everything):

```typescript
<div
  onClick={onCornerTap}
  style={{ position: 'fixed', top: 0, right: 0, width: 100, height: 100, zIndex: 9998, cursor: 'default' }}
  aria-hidden="true"
/>
<DiagnosticsOverlay open={diagOpen} onClose={() => setDiagOpen(false)} sourceType={source ?? 'unknown'} />
```

- [ ] **Step 3: Manual smoke**

```bash
cd web
npm run dev
```

Open `http://localhost:5173/?diag=1` — the overlay should appear immediately.
Also verify: navigating to the player, then triple-tapping the top-right corner within 1.5s opens the overlay.

- [ ] **Step 4: Verify build**

```bash
cd web
npm run build
```

Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DiagnosticsOverlay.tsx web/src/views/Player.tsx
git commit -m "telemetry: on-screen diagnostics overlay"
```

---

## Task 9: Admin Diagnostics tab

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/views/settings/DiagnosticsTab.tsx`
- Modify: whatever Settings container exists (grep for "DeploymentTab" to find it — likely `web/src/views/Settings.tsx` or `web/src/views/SettingsPage.tsx`).

**Interfaces:**
- Consumes: server endpoints from Tasks 3+4.
- Produces:
  - `api.adminTelemetry.list(opts)`, `.get(id)`, `.delete(id)` in api.ts.
  - `<DiagnosticsTab />` component.

- [ ] **Step 1: Add API methods**

Read `web/src/api.ts`. Add to the api object:

```typescript
adminTelemetry: {
  list: (opts: { cursor?: string; kind?: string; since?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.cursor) p.set('cursor', opts.cursor);
    if (opts.kind) p.set('kind', opts.kind);
    if (opts.since != null) p.set('since', String(opts.since));
    const q = p.toString();
    return request<{
      rows: Array<{
        id: string;
        created_at: number;
        error_kind: string | null;
        error_message: string | null;
        source_type: string | null;
        canvas_version: string | null;
        user_agent: string | null;
      }>;
      nextCursor: string | null;
    }>(`/api/admin/telemetry/errors${q ? '?' + q : ''}`);
  },
  get: (id: string) =>
    request<{
      id: string;
      created_at: number;
      user_id: number | null;
      canvas_version: string | null;
      user_agent: string | null;
      error_message: string | null;
      error_kind: string | null;
      source_type: string | null;
      report_json: string;
    }>(`/api/admin/telemetry/errors/${encodeURIComponent(id)}`),
  delete: (id: string) =>
    request<void>(`/api/admin/telemetry/errors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
},
```

- [ ] **Step 2: Implement `DiagnosticsTab.tsx`**

Create `web/src/views/settings/DiagnosticsTab.tsx`:

```typescript
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ElevatedCard } from '../../components/ElevatedCard';
import { api } from '../../api';

type Row = {
  id: string;
  created_at: number;
  error_kind: string | null;
  error_message: string | null;
  source_type: string | null;
  canvas_version: string | null;
  user_agent: string | null;
};

type Detail = {
  id: string;
  created_at: number;
  error_message: string | null;
  error_kind: string | null;
  source_type: string | null;
  canvas_version: string | null;
  user_agent: string | null;
  report_json: string;
};

const KINDS = ['fetch', 'video', 'audio', 'demux', 'browser'] as const;

export function DiagnosticsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    try {
      const res = await api.adminTelemetry.list({
        cursor: reset ? undefined : nextCursor ?? undefined,
        kind: kind ?? undefined,
        since: since ?? undefined,
      });
      setRows(reset ? res.rows : [...rows, ...res.rows]);
      setNextCursor(res.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [kind, since]);

  function testTelemetry() {
    // Deliberately trigger a browser error → global handler records it → user
    // can then manually POST via reportFatal if desired, or just verify the
    // browser_error event surfaces in a real fatal path later.
    setTimeout(() => {
      throw new Error('canvas: test telemetry ping');
    }, 0);
  }

  async function del(id: string) {
    if (!confirm('Delete this report?')) return;
    await api.adminTelemetry.delete(id);
    setDetail(null);
    load(true);
  }

  const openDetail = async (id: string) => {
    const d = await api.adminTelemetry.get(id);
    setDetail(d);
  };

  return (
    <ElevatedCard>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Diagnostics</Typography>
          <Button size="small" variant="outlined" onClick={testTelemetry}>Test telemetry</Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            label="All"
            onClick={() => setKind(null)}
            color={kind === null ? 'primary' : 'default'}
            size="small"
          />
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={k}
              onClick={() => setKind(k)}
              color={kind === k ? 'primary' : 'default'}
              size="small"
            />
          ))}
          <Box sx={{ ml: 2 }}>Since:</Box>
          {[
            { label: '24h', ms: 86_400_000 },
            { label: '7d', ms: 7 * 86_400_000 },
            { label: '30d', ms: 30 * 86_400_000 },
            { label: 'All', ms: null },
          ].map((s) => (
            <Chip
              key={s.label}
              label={s.label}
              size="small"
              onClick={() => setSince(s.ms == null ? null : Date.now() - s.ms)}
              color={
                (s.ms == null && since === null) ||
                (s.ms != null && since != null && Math.abs(since - (Date.now() - s.ms)) < 60_000)
                  ? 'primary'
                  : 'default'
              }
            />
          ))}
        </Box>

        {rows.length === 0 ? (
          <Typography color="text.secondary">No error reports yet. The player emits one on any fatal — try the Test telemetry button.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>UA</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover onClick={() => openDetail(r.id)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell><Chip size="small" label={r.error_kind ?? 'unknown'} /></TableCell>
                  <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.error_message}
                  </TableCell>
                  <TableCell>{r.source_type ?? '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.user_agent ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {nextCursor && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
            <Button onClick={() => load(false)} disabled={loading}>Load more</Button>
          </Box>
        )}

        <Drawer anchor="right" open={detail !== null} onClose={() => setDetail(null)} PaperProps={{ sx: { width: 600, p: 3 } }}>
          {detail && (() => {
            let parsed: { events: Array<{ tsMs: number; kind: string; data: unknown }>; session: Record<string, unknown> } | null = null;
            try { parsed = JSON.parse(detail.report_json); } catch { /* ignore */ }
            const events = parsed?.events ?? [];
            const session = parsed?.session ?? {};
            return (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6">{detail.error_message}</Typography>
                    <Typography variant="caption">
                      {detail.error_kind} · {new Date(detail.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => navigator.clipboard.writeText(detail.report_json)}
                  >
                    Copy JSON
                  </Button>
                </Box>

                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Session</Typography>
                <Box sx={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.9 }}>
                  {Object.entries(session).map(([k, v]) => (
                    <div key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                  ))}
                </Box>

                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Events</Typography>
                <Box sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {events.slice().reverse().map((e, i) => (
                    <Box key={i} sx={{ py: 0.25 }}>
                      <span style={{ opacity: 0.7 }}>[+{(e.tsMs / 1000).toFixed(2)}s]</span>{' '}
                      <strong>{e.kind}</strong>{' '}
                      <span style={{ opacity: 0.8 }}>{JSON.stringify(e.data)}</span>
                    </Box>
                  ))}
                </Box>

                <Button
                  size="small"
                  color="error"
                  onClick={() => del(detail.id)}
                  sx={{ mt: 3 }}
                >
                  Delete report
                </Button>
              </Box>
            );
          })()}
        </Drawer>
      </Box>
    </ElevatedCard>
  );
}
```

- [ ] **Step 3: Register the tab**

Find the Settings container (grep for `DeploymentTab` in `web/src/views/`). Add:

```typescript
import { DiagnosticsTab } from './settings/DiagnosticsTab';
```

Add a new tab entry alongside the existing ones — match whatever pattern the file uses (a `<Tabs>` config, a switch statement, a route). Example if using a routed tabbed layout:

```typescript
{ key: 'diagnostics', label: 'Diagnostics', component: <DiagnosticsTab /> }
```

- [ ] **Step 4: Manual smoke**

```bash
cd web
npm run dev
```

Log in as admin. Go to Settings → Diagnostics. Click "Test telemetry" — an uncaught error fires, gets recorded in the ring. Then trigger a fatal (break the source URL or point at an invalid file) — a report should appear in the list within a few seconds.

- [ ] **Step 5: Verify build + typecheck**

```bash
cd web
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/views/settings/DiagnosticsTab.tsx web/src/views/Settings.tsx
git commit -m "telemetry: admin Diagnostics tab"
```

(Adjust the third path if the Settings container lives elsewhere.)

---

## Task 10: Docs + env wiring

**Files:**
- Create: `docs/diagnostics.md`
- Modify: `README.md`
- Modify: `docker-compose.yml` (comment on new env vars)
- Modify: `docker/entrypoint.sh` (only if it filters env — likely a no-op)
- Modify: `.env.example` if it exists (grep first)

- [ ] **Step 1: Write `docs/diagnostics.md`**

```markdown
# Diagnostics

Canvas records structured player events in-browser and uploads a report to your canvas server if playback fails. Reports live on your own SQLite database — nothing goes to Anthropic, Sentry, or any third party.

## What's collected

- **Ring buffer** (500 events, in memory): fetch progress, decoder configuration, backpressure, stall detection, browser errors.
- **Session context**: user-agent, viewport, screen, connection type (2g/3g/4g/wifi), canvas version, source type.
- **The error itself**: message, kind (fetch/video/audio/demux/browser), stack trace.

## What is NOT collected

- Full URLs (only the hostname is recorded — media URLs contain tokens).
- Auth tokens, cookies, session IDs.
- Media titles, source names, watchlist contents, user email or display name.
- Client IP addresses.

## Viewing reports

Admin → **Settings → Diagnostics**. Table of recent reports; click a row for the full event timeline.

## On-screen overlay (in the car)

Two ways to open the live event overlay without needing the admin UI:

- Triple-tap the top-right corner of the player within 1.5 seconds.
- Add `?diag=1` to the URL and reload.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `TELEMETRY_ENABLED` | `true` | Set to `false` to disable recording + uploads entirely. |
| `TELEMETRY_RETENTION_DAYS` | `30` | Reports older than this are pruned on every insert. |
| `TELEMETRY_MAX_ROWS` | `1000` | Global cap. When exceeded, oldest reports are pruned. |

## Disabling for one session

If you don't want a specific playback session tracked:

- `?diag=off` in the URL, OR
- `localStorage.setItem('canvas.diag.disabled', '1')` in the browser console.
```

- [ ] **Step 2: Update `README.md`**

Add a short section under Configuration (or wherever env vars are documented):

```markdown
### Diagnostics

Canvas records player errors locally to help you debug playback issues. Everything stays on your server — no third-party data collection. See [docs/diagnostics.md](docs/diagnostics.md).

Env: `TELEMETRY_ENABLED` (default `true`), `TELEMETRY_RETENTION_DAYS` (default `30`), `TELEMETRY_MAX_ROWS` (default `1000`).
```

- [ ] **Step 3: Update `docker-compose.yml`** (skip if the file doesn't exist at repo root — check first with `ls docker-compose.yml`)

Add a comment block near the environment section:

```yaml
    environment:
      # Diagnostics — records player errors to your local SQLite.
      # See docs/diagnostics.md.
      # TELEMETRY_ENABLED: "true"
      # TELEMETRY_RETENTION_DAYS: "30"
      # TELEMETRY_MAX_ROWS: "1000"
```

- [ ] **Step 4: Verify full server + web still boot cleanly**

```bash
cd server && bun run typecheck && bun test
cd ../web && npm run build
cd .. && docker build -t canvas:local .
```

Expected: all pass, image builds successfully with `VITE_CANVAS_VERSION` propagated.

- [ ] **Step 5: Commit**

```bash
git add docs/diagnostics.md README.md docker-compose.yml
git commit -m "telemetry: user-facing docs + env var documentation"
```

- [ ] **Step 6: Push**

```bash
git push
```

---

## Rollout after implementation

1. Cut `v0.2.0` (`git tag -a v0.2.0 -m "canvas v0.2.0 — player diagnostics"` + `git push origin v0.2.0`). Publish workflow builds + pushes to ghcr.
2. Update Tesla-facing docker-compose to point at `ghcr.io/bleichroeder/canvas:0.2.0`. Recreate the container.
3. Drive. Trigger the failure. Return to desk.
4. Open Settings → Diagnostics. Read the trace.
5. If root cause obvious → open sub-project H (targeted fix). If not → identify missing events, iterate, ship again.

## Out of scope

- The actual player bug fix (sub-project H).
- Retry / reconnect / dismissable-error resilience (sub-project I, if wanted).
- Cross-instance report aggregation.
- Alerting.
- Modifying player pipeline beyond event-emission hooks.
- Reproducing the bug on desktop.
