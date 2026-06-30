# Self-Host Auth + Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase (auth + cloud-sync) with native claim-token auth + server-pool sources with per-user ACL. After this lands, a self-hosted canvas instance has zero third-party identity/sync dependencies.

**Architecture:** Five new SQLite tables (users, claim_tokens, device_sessions, sources, user_source_access). New `requireUser` + `requireAdmin` Hono middleware. The `x-sources` header from sub-project A goes away — routes load the authenticated user's sources from DB. Bootstrap flow generates an admin claim token on first run, prints to stdout + writes to a sentinel file. Frontend gets a new claim-token sign-in screen, Settings → Users admin UI, and a Devices section; the Supabase package is removed from `web/package.json`.

**Tech Stack:** Same as sub-project A — Bun 1.1+, Hono, Drizzle ORM (bun-sqlite driver), `bun:sqlite`, Pino, Zod. No new dependencies; bearer token generation uses `crypto.getRandomValues`, hashing uses Bun's built-in `crypto.subtle.digest('SHA-256', ...)`. Frontend drops `@supabase/supabase-js`.

## Global Constraints

- **Branch:** All work lands on `self-host-auth` (already current). Do NOT merge into `self-host-server-port` until the whole branch passes its final review.
- **Sub-project-A behavior preserved.** Every existing API response shape stays identical; only the data source changes (DB rows instead of x-sources header). Every test from sub-project A continues passing as new tasks land.
- **Spec is authoritative.** When a step here conflicts with `docs/superpowers/specs/2026-06-30-self-host-auth-sync-design.md`, the spec wins. Flag the conflict in the implementer report.
- **No new server-side dependencies.** Anything you reach for outside `package.json`'s current set requires escalation.
- **Bearer tokens are never persisted.** Only `sha256(bearer)` lands in the DB. The implementer must verify this in every code path that mints or compares a bearer.
- **Admin singleton.** Enforced both in DB (partial unique index) and at the API layer (admin endpoints reject 2nd-admin creation, role mutation, and self-deletion with 409).
- **No `pinKvKey` use in new code.** Carries over from sub-project A's review findings.
- **Tests:** Co-located `*.test.ts`, run with `bun test`. Server tests use `:memory:` SQLite. Frontend tests are NOT required by this plan (the existing frontend has no test infra and adding one is out of scope).
- **Commit cadence:** One commit per task at the end. Squash any in-progress WIP locally before the final commit.
- **`web/` edits:** Tasks 9-11 touch the frontend. Use the existing patterns (Inter font, MUI v6, hand-rolled hash router, PKCE-style flow for OAuth-callback is being removed). No CSS modules, no styled-components — MUI's `sx` prop only.

---

## File Structure

**Server (`server/`):**

- Create:
  - `src/db/schema.ts` — extended with 5 new tables
  - `drizzle/0001_*.sql` — generated migration
  - `src/storage/users.ts` (+ test)
  - `src/storage/claim-tokens.ts` (+ test)
  - `src/storage/device-sessions.ts` (+ test)
  - `src/storage/sources.ts` (+ test)
  - `src/lib/bearer.ts` (+ test) — random bearer generation, hashing helpers
  - `src/lib/bootstrap.ts` (+ test) — first-run admin creation
  - `src/lib/user-sources.ts` (+ test) — `getUserSources(db, userId)` replaces `parseXSources`
  - `src/middleware/auth.ts` (+ test) — `requireUser`, `requireAdmin`
  - `src/routes/auth.ts` (+ test)
  - `src/routes/admin.ts` (+ test)
  - `src/routes/sources-mgmt.ts` (+ test) — to avoid colliding with the future filename `sources.ts`, use a distinguishing name
- Modify:
  - `src/storage/reaper.ts` — add claim-tokens sweep
  - `src/index.ts` — call `bootstrapAdminIfNeeded` between migrations and reaper
  - `src/app.ts` — mount new routes, add auth middleware where appropriate
  - `src/routes/pair.ts` — `/approve` and `/flixify-poll` now persist sources + grant access
  - `src/routes/home.ts`, `source-home.ts`, `library.ts`, `item.ts`, `search.ts`, `play.ts`, `progress.ts`, `source-status.ts`, `subtitles.ts` — swap `parseXSources` for `getUserSources`
  - `README.md` — new "First run" section

**Frontend (`web/`):**

- Create:
  - `src/views/Claim.tsx` — claim-token redemption screen
  - `src/views/Users.tsx` — admin's user-management screen
  - `src/views/Devices.tsx` — current user's device list
  - `src/lib/session.ts` — bearer + user payload accessors over localStorage
- Modify:
  - `src/api.ts` — drop `x-sources` header construction, add `Authorization: Bearer`
  - `src/views/SignIn.tsx` — replaced wholesale with redirect to `/claim` (or merge into Claim.tsx and delete SignIn.tsx)
  - `src/App.tsx` (or routes file) — wire Claim/Users/Devices, remove AuthCallback
  - `src/storage.ts` — remove the `user_sources` shape; sources come from server now
  - `package.json` — remove `@supabase/supabase-js`
  - `.env.example` — remove Supabase vars
- Delete:
  - `src/views/AuthCallback.tsx`
  - `src/lib/auth.ts`
  - `src/lib/cloud-sync.ts`
  - Any Supabase-specific config files

---

## Task 1: Schema + bearer helpers + storage modules + reaper extension

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0001_*.sql` (generated)
- Create: `server/src/lib/bearer.ts` (+ `bearer.test.ts`) — `generateBearer()` is needed by `claim-tokens.ts` below
- Create: `server/src/storage/users.ts` (+ `users.test.ts`)
- Create: `server/src/storage/claim-tokens.ts` (+ `claim-tokens.test.ts`)
- Create: `server/src/storage/device-sessions.ts` (+ `device-sessions.test.ts`)
- Create: `server/src/storage/sources.ts` (+ `sources.test.ts`)
- Modify: `server/src/storage/reaper.ts` (+ extend `reaper.test.ts`)

**Interfaces:**
- Consumes: existing `Db` type, `nowSec`, Drizzle helpers
- Produces (consumed by every later task):
  - From `users.ts`: `getUser(db, id)`, `getUserByLabel(db, label)`, `listUsers(db)`, `createUser(db, { label, role })`, `deleteUser(db, id)`, `countAdmins(db)`
  - From `claim-tokens.ts`: `createClaimToken(db, userId, ttlSec)`, `getClaimToken(db, token)`, `consumeClaimToken(db, token, now)`, `regenerateClaimToken(db, userId, ttlSec)`, `reapClaimTokens(db, now)`
  - From `device-sessions.ts`: `createDeviceSession(db, { userId, deviceLabel, tokenHash })`, `getDeviceSession(db, tokenHash)`, `touchDeviceSession(db, tokenHash, now)`, `listUserDevices(db, userId)`, `deleteDeviceSession(db, id)`, `deleteUserDeviceSessions(db, userId)`
  - From `sources.ts`: `createSource(db, { type, baseUrl, token, label, pairedByUserId })`, `getSource(db, id)`, `listAllSources(db)`, `listAccessibleSources(db, userId)`, `deleteSource(db, id)`, `grantSourceAccess(db, userId, sourceId)`, `revokeSourceAccess(db, userId, sourceId)`, `userHasSourceAccess(db, userId, sourceId)`
  - From `reaper.ts`: extended sweep that also calls `reapClaimTokens`

- [ ] **Step 1: Extend `server/src/db/schema.ts`** with five new tables.

Open `server/src/db/schema.ts` and append:

```ts
import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
// (^ make sure `uniqueIndex` and `primaryKey` are in the imports if not already)

export const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    label: text('label').notNull(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    // DB-enforced singleton: at most one admin row.
    adminSingleton: uniqueIndex('users_admin_singleton')
      .on(t.role)
      .where(sql`${t.role} = 'admin'`),
  }),
);

export const claimTokens = sqliteTable(
  'claim_tokens',
  {
    token: text('token').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
  },
  (t) => ({
    expiresIdx: index('claim_tokens_expires').on(t.expiresAt),
  }),
);

export const deviceSessions = sqliteTable(
  'device_sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    deviceLabel: text('device_label').notNull(),
    createdAt: integer('created_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => ({
    userIdx: index('device_sessions_user').on(t.userId),
  }),
);

export const sources = sqliteTable(
  'sources',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    type: text('type', { enum: ['plex', 'flixify'] }).notNull(),
    baseUrl: text('base_url').notNull(),
    token: text('token').notNull(),
    label: text('label').notNull(),
    pairedByUserId: integer('paired_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at').notNull(),
  },
);

export const userSourceAccess = sqliteTable(
  'user_source_access',
  {
    userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    sourceId: integer('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.sourceId] }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ClaimToken = typeof claimTokens.$inferSelect;
export type NewClaimToken = typeof claimTokens.$inferInsert;
export type DeviceSession = typeof deviceSessions.$inferSelect;
export type NewDeviceSession = typeof deviceSessions.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type UserSourceAccess = typeof userSourceAccess.$inferSelect;
```

The `sql` template tag in the `where` clause requires importing `sql` from `drizzle-orm` at the top of the file:
```ts
import { sql } from 'drizzle-orm';
```

- [ ] **Step 1b: Create `server/src/lib/bearer.ts` and its test**

(`claim-tokens.ts` in Step 5 imports `generateBearer` from this file. Land both files in this task to keep tests green.)

`server/src/lib/bearer.ts`:
```ts
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RAW_LEN = 19;

export function generateBearer(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RAW_LEN));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}-${chars.slice(16, 19)}`;
}

export async function hashBearer(bearer: string): Promise<string> {
  const buf = new TextEncoder().encode(bearer);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

`server/src/lib/bearer.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { generateBearer, hashBearer } from './bearer';

describe('bearer', () => {
  test('generateBearer produces XXXX-XXXX-XXXX-XXXX-XXX shape', () => {
    expect(generateBearer()).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
  });
  test('generateBearer is unique across many calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(generateBearer());
    expect(seen.size).toBe(1000);
  });
  test('hashBearer is 64 hex and deterministic', async () => {
    const a = await hashBearer('hello'); const b = await hashBearer('hello');
    expect(a).toMatch(/^[0-9a-f]{64}$/); expect(a).toBe(b);
  });
  test('hashBearer differs for different inputs', async () => {
    expect(await hashBearer('a')).not.toBe(await hashBearer('b'));
  });
});
```

- [ ] **Step 2: Generate the migration**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun run db:generate
```

Drizzle-kit writes a new file under `server/drizzle/0001_*.sql`. Open it, verify it contains CREATE TABLE for users, claim_tokens, device_sessions, sources, user_source_access plus the partial unique index, the expires index, and the user index. If anything is missing or malformed, fix the schema and re-run.

- [ ] **Step 3: Write `users.ts` storage**

`server/src/storage/users.ts`:
```ts
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { users, type User, type NewUser } from '../db/schema';
import { nowSec } from '../lib/time';

export function getUser(db: Db, id: number): User | null {
  return db.select().from(users).where(eq(users.id, id)).get() ?? null;
}

export function getUserByLabel(db: Db, label: string): User | null {
  return db.select().from(users).where(eq(users.label, label)).get() ?? null;
}

export function listUsers(db: Db): User[] {
  return db.select().from(users).all();
}

export function createUser(db: Db, input: { label: string; role: 'admin' | 'member' }): User {
  const row: NewUser = {
    label: input.label,
    role: input.role,
    createdAt: nowSec(),
  };
  const inserted = db.insert(users).values(row).returning().get();
  if (!inserted) throw new Error(`createUser: insert returned no row (label=${input.label})`);
  return inserted;
}

export function deleteUser(db: Db, id: number): void {
  db.delete(users).where(eq(users.id, id)).run();
}

export function countAdmins(db: Db): number {
  const r = db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.role, 'admin')).get();
  return r?.c ?? 0;
}
```

- [ ] **Step 4: Write `users.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser, getUser, getUserByLabel, listUsers, deleteUser, countAdmins } from './users';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('users storage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('createUser returns the inserted row with auto id', () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    expect(u.id).toBeGreaterThan(0);
    expect(u.label).toBe('Alice');
    expect(u.role).toBe('admin');
  });

  test('admin singleton: second admin insert throws', () => {
    createUser(db, { label: 'A', role: 'admin' });
    expect(() => createUser(db, { label: 'B', role: 'admin' })).toThrow();
  });

  test('multiple members are fine', () => {
    createUser(db, { label: 'A', role: 'admin' });
    createUser(db, { label: 'B', role: 'member' });
    createUser(db, { label: 'C', role: 'member' });
    expect(listUsers(db).length).toBe(3);
  });

  test('getUser returns null for missing id', () => {
    expect(getUser(db, 999)).toBeNull();
  });

  test('getUserByLabel finds by exact match', () => {
    const u = createUser(db, { label: 'Bob', role: 'member' });
    expect(getUserByLabel(db, 'Bob')?.id).toBe(u.id);
    expect(getUserByLabel(db, 'bob')).toBeNull();
  });

  test('deleteUser removes the row', () => {
    const u = createUser(db, { label: 'X', role: 'member' });
    deleteUser(db, u.id);
    expect(getUser(db, u.id)).toBeNull();
  });

  test('countAdmins reflects admin count', () => {
    expect(countAdmins(db)).toBe(0);
    createUser(db, { label: 'A', role: 'admin' });
    expect(countAdmins(db)).toBe(1);
    createUser(db, { label: 'B', role: 'member' });
    expect(countAdmins(db)).toBe(1);
  });
});
```

Run: `bun test src/storage/users.test.ts`. Expected: 7 pass.

- [ ] **Step 5: Write `claim-tokens.ts` storage**

`server/src/storage/claim-tokens.ts`:
```ts
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { claimTokens, type ClaimToken } from '../db/schema';
import { nowSec } from '../lib/time';
import { generateBearer } from '../lib/bearer';

export function createClaimToken(db: Db, userId: number, ttlSec: number): ClaimToken {
  const now = nowSec();
  const token = generateBearer();
  const inserted = db
    .insert(claimTokens)
    .values({ token, userId, createdAt: now, expiresAt: now + ttlSec })
    .returning()
    .get();
  if (!inserted) throw new Error('createClaimToken: insert returned no row');
  return inserted;
}

export function getClaimToken(db: Db, token: string): ClaimToken | null {
  return db.select().from(claimTokens).where(eq(claimTokens.token, token)).get() ?? null;
}

/**
 * Atomically mark a token as used. Returns the token row if the update applied
 * (token was valid, not expired, not previously used); null otherwise.
 */
export function consumeClaimToken(db: Db, token: string, now: number = nowSec()): ClaimToken | null {
  // Use raw SQL so we can express "update only if not yet used and not expired".
  const stmt = db.$client.prepare(
    `UPDATE claim_tokens
        SET used_at = ?
      WHERE token = ?
        AND used_at IS NULL
        AND expires_at >= ?
      RETURNING token, user_id, created_at, expires_at, used_at`,
  );
  const row = stmt.get(now, token, now) as
    | { token: string; user_id: number; created_at: number; expires_at: number; used_at: number }
    | null;
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

/**
 * Invalidate any active claim tokens for this user and emit a fresh one.
 * Used by admin "regenerate claim token" action and by the bootstrap recovery
 * path.
 */
export function regenerateClaimToken(db: Db, userId: number, ttlSec: number): ClaimToken {
  // Invalidate by marking expired. Don't delete — keeps audit trail until user is deleted.
  db.update(claimTokens)
    .set({ expiresAt: nowSec() - 1 })
    .where(and(eq(claimTokens.userId, userId), isNull(claimTokens.usedAt)))
    .run();
  return createClaimToken(db, userId, ttlSec);
}

export function reapClaimTokens(db: Db, now: number = nowSec()): number {
  // Reap only fully-expired UNUSED tokens; used tokens stay for the audit trail
  // (they get garbage-collected via FK cascade when the user is deleted).
  const stmt = db.$client.prepare(
    `DELETE FROM claim_tokens WHERE expires_at < ? AND used_at IS NULL`,
  );
  const result = stmt.run(now);
  return result.changes;
}
```

- [ ] **Step 6: Write `claim-tokens.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from './users';
import { createClaimToken, getClaimToken, consumeClaimToken, regenerateClaimToken, reapClaimTokens } from './claim-tokens';
import { nowSec } from '../lib/time';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('claim-tokens storage', () => {
  let db: Db;
  let userId: number;
  beforeEach(() => {
    db = makeDb();
    userId = createUser(db, { label: 'A', role: 'admin' }).id;
  });

  test('createClaimToken returns a unique token', () => {
    const a = createClaimToken(db, userId, 3600);
    const b = createClaimToken(db, userId, 3600);
    expect(a.token).not.toBe(b.token);
    expect(a.userId).toBe(userId);
    expect(a.expiresAt).toBeGreaterThan(nowSec());
  });

  test('consumeClaimToken on a valid unused token returns the row and marks it used', () => {
    const t = createClaimToken(db, userId, 3600);
    const c = consumeClaimToken(db, t.token);
    expect(c).not.toBeNull();
    expect(c!.usedAt).toBeGreaterThan(0);
    // Second consume returns null.
    expect(consumeClaimToken(db, t.token)).toBeNull();
  });

  test('consumeClaimToken returns null for unknown token', () => {
    expect(consumeClaimToken(db, 'bogus')).toBeNull();
  });

  test('consumeClaimToken returns null for expired token', () => {
    const t = createClaimToken(db, userId, 3600);
    // Force-expire via the test seam.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = ? WHERE token = ?')
      .run(nowSec() - 100, t.token);
    expect(consumeClaimToken(db, t.token)).toBeNull();
  });

  test('regenerateClaimToken invalidates prior unused tokens and emits a fresh one', () => {
    const a = createClaimToken(db, userId, 3600);
    const b = regenerateClaimToken(db, userId, 3600);
    expect(b.token).not.toBe(a.token);
    // The prior one is now invalid (expired in the past).
    expect(consumeClaimToken(db, a.token)).toBeNull();
    // The new one works.
    expect(consumeClaimToken(db, b.token)).not.toBeNull();
  });

  test('reapClaimTokens deletes expired unused tokens, keeps used ones', () => {
    const t1 = createClaimToken(db, userId, 3600);
    const t2 = createClaimToken(db, userId, 3600);
    // Expire both.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = ?')
      .run(nowSec() - 100);
    // Mark t2 used so it's preserved.
    consumeClaimToken(db, t2.token, nowSec() - 50);
    const deleted = reapClaimTokens(db);
    expect(deleted).toBe(1);
    expect(getClaimToken(db, t1.token)).toBeNull();
    expect(getClaimToken(db, t2.token)).not.toBeNull();
  });
});
```

- [ ] **Step 7: Write `device-sessions.ts` storage**

`server/src/storage/device-sessions.ts`:
```ts
import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db';
import { deviceSessions, type DeviceSession, type NewDeviceSession } from '../db/schema';
import { nowSec } from '../lib/time';

export function createDeviceSession(db: Db, input: { userId: number; deviceLabel: string; tokenHash: string }): DeviceSession {
  const now = nowSec();
  const row: NewDeviceSession = {
    tokenHash: input.tokenHash,
    userId: input.userId,
    deviceLabel: input.deviceLabel,
    createdAt: now,
    lastSeenAt: now,
  };
  const inserted = db.insert(deviceSessions).values(row).returning().get();
  if (!inserted) throw new Error('createDeviceSession: insert returned no row');
  return inserted;
}

export function getDeviceSession(db: Db, tokenHash: string): DeviceSession | null {
  return db.select().from(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).get() ?? null;
}

export function touchDeviceSession(db: Db, tokenHash: string, now: number = nowSec()): void {
  db.update(deviceSessions).set({ lastSeenAt: now }).where(eq(deviceSessions.tokenHash, tokenHash)).run();
}

export function listUserDevices(db: Db, userId: number): DeviceSession[] {
  return db
    .select()
    .from(deviceSessions)
    .where(eq(deviceSessions.userId, userId))
    .orderBy(desc(deviceSessions.lastSeenAt))
    .all();
}

export function deleteDeviceSession(db: Db, tokenHash: string): void {
  db.delete(deviceSessions).where(eq(deviceSessions.tokenHash, tokenHash)).run();
}

export function deleteUserDeviceSessions(db: Db, userId: number): void {
  db.delete(deviceSessions).where(eq(deviceSessions.userId, userId)).run();
}
```

- [ ] **Step 8: Write `device-sessions.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from './users';
import {
  createDeviceSession, getDeviceSession, touchDeviceSession,
  listUserDevices, deleteDeviceSession, deleteUserDeviceSessions,
} from './device-sessions';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('device-sessions storage', () => {
  let db: Db;
  let userId: number;
  beforeEach(() => {
    db = makeDb();
    userId = createUser(db, { label: 'A', role: 'admin' }).id;
  });

  test('create + get round trip', () => {
    const s = createDeviceSession(db, { userId, deviceLabel: 'Tesla', tokenHash: 'h1' });
    expect(s.userId).toBe(userId);
    expect(s.deviceLabel).toBe('Tesla');
    const got = getDeviceSession(db, 'h1');
    expect(got?.tokenHash).toBe('h1');
  });

  test('touchDeviceSession bumps lastSeenAt', async () => {
    const s = createDeviceSession(db, { userId, deviceLabel: 'D', tokenHash: 'h2' });
    const before = s.lastSeenAt;
    // Pass an explicit future time so we don't depend on nowSec changing.
    touchDeviceSession(db, 'h2', before + 100);
    expect(getDeviceSession(db, 'h2')?.lastSeenAt).toBe(before + 100);
  });

  test('listUserDevices returns most-recently-seen first', () => {
    createDeviceSession(db, { userId, deviceLabel: 'a', tokenHash: 'ha' });
    createDeviceSession(db, { userId, deviceLabel: 'b', tokenHash: 'hb' });
    touchDeviceSession(db, 'ha', 9999999999);   // make 'a' most recent
    const list = listUserDevices(db, userId);
    expect(list.map((d) => d.deviceLabel)).toEqual(['a', 'b']);
  });

  test('deleteDeviceSession removes the row', () => {
    createDeviceSession(db, { userId, deviceLabel: 'x', tokenHash: 'hx' });
    deleteDeviceSession(db, 'hx');
    expect(getDeviceSession(db, 'hx')).toBeNull();
  });

  test('deleteUserDeviceSessions clears all of a user\'s rows', () => {
    createDeviceSession(db, { userId, deviceLabel: 'a', tokenHash: 'ha' });
    createDeviceSession(db, { userId, deviceLabel: 'b', tokenHash: 'hb' });
    deleteUserDeviceSessions(db, userId);
    expect(listUserDevices(db, userId).length).toBe(0);
  });
});
```

- [ ] **Step 9: Write `sources.ts` storage**

`server/src/storage/sources.ts`:
```ts
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db';
import { sources, userSourceAccess, type Source, type NewSource } from '../db/schema';
import { nowSec } from '../lib/time';

export function createSource(db: Db, input: { type: 'plex' | 'flixify'; baseUrl: string; token: string; label: string; pairedByUserId: number }): Source {
  const row: NewSource = {
    type: input.type,
    baseUrl: input.baseUrl,
    token: input.token,
    label: input.label,
    pairedByUserId: input.pairedByUserId,
    createdAt: nowSec(),
  };
  const inserted = db.insert(sources).values(row).returning().get();
  if (!inserted) throw new Error('createSource: insert returned no row');
  return inserted;
}

export function getSource(db: Db, id: number): Source | null {
  return db.select().from(sources).where(eq(sources.id, id)).get() ?? null;
}

export function listAllSources(db: Db): Source[] {
  return db.select().from(sources).all();
}

/**
 * Sources the user can browse: ACL-filtered for members, full pool for admins.
 * Admin status MUST be checked by caller (this function trusts its `userId` is
 * a member; pass the full pool path explicitly via listAllSources for admins).
 */
export function listAccessibleSources(db: Db, userId: number): Source[] {
  // INNER JOIN sources → user_source_access on source_id = sources.id WHERE user_id = ?
  // Drizzle's bun-sqlite driver supports innerJoin().
  const rows = db
    .select({
      id: sources.id,
      type: sources.type,
      baseUrl: sources.baseUrl,
      token: sources.token,
      label: sources.label,
      pairedByUserId: sources.pairedByUserId,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .innerJoin(userSourceAccess, eq(userSourceAccess.sourceId, sources.id))
    .where(eq(userSourceAccess.userId, userId))
    .all();
  return rows;
}

export function deleteSource(db: Db, id: number): void {
  db.delete(sources).where(eq(sources.id, id)).run();
}

export function grantSourceAccess(db: Db, userId: number, sourceId: number): void {
  // INSERT OR IGNORE so re-grant is a no-op.
  db.$client.prepare(
    `INSERT OR IGNORE INTO user_source_access (user_id, source_id) VALUES (?, ?)`,
  ).run(userId, sourceId);
}

export function revokeSourceAccess(db: Db, userId: number, sourceId: number): void {
  db.delete(userSourceAccess)
    .where(and(eq(userSourceAccess.userId, userId), eq(userSourceAccess.sourceId, sourceId)))
    .run();
}

export function userHasSourceAccess(db: Db, userId: number, sourceId: number): boolean {
  const row = db
    .select()
    .from(userSourceAccess)
    .where(and(eq(userSourceAccess.userId, userId), eq(userSourceAccess.sourceId, sourceId)))
    .get();
  return !!row;
}
```

- [ ] **Step 10: Write `sources.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from './users';
import {
  createSource, getSource, listAllSources, listAccessibleSources, deleteSource,
  grantSourceAccess, revokeSourceAccess, userHasSourceAccess,
} from './sources';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('sources storage', () => {
  let db: Db;
  let adminId: number;
  let memberId: number;
  beforeEach(() => {
    db = makeDb();
    adminId = createUser(db, { label: 'Admin', role: 'admin' }).id;
    memberId = createUser(db, { label: 'M', role: 'member' }).id;
  });

  test('createSource + getSource round trip', () => {
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'Home Plex', pairedByUserId: adminId });
    expect(getSource(db, s.id)?.label).toBe('Home Plex');
  });

  test('listAccessibleSources is empty until access is granted', () => {
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: adminId });
    expect(listAccessibleSources(db, memberId).length).toBe(0);
    grantSourceAccess(db, memberId, s.id);
    const got = listAccessibleSources(db, memberId);
    expect(got.length).toBe(1);
    expect(got[0]!.id).toBe(s.id);
  });

  test('grantSourceAccess is idempotent', () => {
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: adminId });
    grantSourceAccess(db, memberId, s.id);
    grantSourceAccess(db, memberId, s.id);
    expect(listAccessibleSources(db, memberId).length).toBe(1);
  });

  test('revokeSourceAccess removes the row', () => {
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: adminId });
    grantSourceAccess(db, memberId, s.id);
    revokeSourceAccess(db, memberId, s.id);
    expect(userHasSourceAccess(db, memberId, s.id)).toBe(false);
  });

  test('deleting a source cascades to user_source_access', () => {
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: adminId });
    grantSourceAccess(db, memberId, s.id);
    deleteSource(db, s.id);
    expect(userHasSourceAccess(db, memberId, s.id)).toBe(false);
  });

  test('listAllSources returns everything regardless of access', () => {
    createSource(db, { type: 'plex',    baseUrl: 'http://a', token: 't', label: 'A', pairedByUserId: adminId });
    createSource(db, { type: 'flixify', baseUrl: 'http://b', token: 't', label: 'B', pairedByUserId: adminId });
    expect(listAllSources(db).length).toBe(2);
  });
});
```

- [ ] **Step 11: Extend `server/src/storage/reaper.ts`**

Open `server/src/storage/reaper.ts`. The current sweep calls `reapPairSessions` and `reapSourceStatus`. Add `reapClaimTokens`:

```ts
import { reapPairSessions } from './pair-sessions';
import { reapSourceStatus } from './source-status';
import { reapClaimTokens } from './claim-tokens';
import type { Db } from '../db';
import { nowSec } from '../lib/time';
import { logger } from '../log';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export function startReaper(db: Db): () => void {
  const tick = () => {
    try {
      const now = nowSec();
      const pairs = reapPairSessions(db, now);
      const statuses = reapSourceStatus(db, now);
      const claims = reapClaimTokens(db, now);
      if (pairs + statuses + claims > 0) {
        logger.info({ pairs, statuses, claims }, 'reaper sweep');
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'reaper sweep failed');
    }
  };
  tick();
  const handle = setInterval(tick, SWEEP_INTERVAL_MS);
  return () => clearInterval(handle);
}
```

Update `reaper.test.ts` to add a claim-token sweep test alongside the existing pair-sessions + source-status sweep tests. Use the same pattern as the existing tests.

- [ ] **Step 12: Run + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck
```

Expected: all sub-project-A tests pass (100) + new tests for users (7) + claim-tokens (6) + device-sessions (5) + sources (6) + reaper (+1 for claims) = ~125 total. Typecheck clean.

```bash
cd /c/github/passenger
git add server/drizzle/ server/src/db/schema.ts \
        server/src/storage/users.ts server/src/storage/users.test.ts \
        server/src/storage/claim-tokens.ts server/src/storage/claim-tokens.test.ts \
        server/src/storage/device-sessions.ts server/src/storage/device-sessions.test.ts \
        server/src/storage/sources.ts server/src/storage/sources.test.ts \
        server/src/storage/reaper.ts server/src/storage/reaper.test.ts
git commit -m "server: schema + storage for users, claim tokens, device sessions, source pool with ACL"
```

---

## Task 2: Bootstrap flow + boot wiring

**Files:**
- Create: `server/src/lib/bootstrap.ts` (+ test)
- Modify: `server/src/index.ts`

**Interfaces produced:**
- `bootstrapAdminIfNeeded(db, config): { created: boolean; token?: string; recovered?: boolean }` — on first run creates admin user + claim token, writes sentinel file, returns the token; on subsequent runs returns `{ created: false }`. Also handles the recovery case (admin exists, no devices, no active token).

(`bearer.ts` already exists from T1.)

- [ ] **Step 1: Write `bootstrap.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db';
import { countAdmins, createUser, getUserByLabel } from '../storage/users';
import { createClaimToken, regenerateClaimToken } from '../storage/claim-tokens';
import { listUserDevices } from '../storage/device-sessions';
import { logger } from '../log';
import { eq, and, isNull, gte } from 'drizzle-orm';
import { claimTokens } from '../db/schema';
import { nowSec } from './time';

export interface BootstrapConfig {
  dbPath: string;          // e.g. ./data/canvas.db; sentinel goes next to it
  claimTokenTtlSec: number;
}

const ADMIN_LABEL = 'Admin';
const DEFAULT_TTL_SEC = 24 * 60 * 60;

/**
 * On first boot (no admin yet): create the admin user, mint a claim token,
 * print + write sentinel file.
 *
 * On subsequent boots, the recovery path:
 *   - Admin user exists.
 *   - Zero device sessions for admin.
 *   - Zero unused, unexpired claim tokens for admin.
 *   → Re-emit a fresh claim token so the operator can recover after losing
 *     their bearer or letting the original token expire.
 *
 * Otherwise: no-op.
 */
export function bootstrapAdminIfNeeded(db: Db, cfg: BootstrapConfig): { created: boolean; token?: string; recovered?: boolean } {
  const adminCount = countAdmins(db);
  let adminUserId: number;
  let recovered = false;

  if (adminCount === 0) {
    const admin = createUser(db, { label: ADMIN_LABEL, role: 'admin' });
    adminUserId = admin.id;
  } else {
    const admin = getUserByLabel(db, ADMIN_LABEL);
    if (!admin) {
      // Singleton invariant guarantees the admin row, but its label could differ
      // if a future flow lets the admin rename themselves. Look up by role instead.
      throw new Error('bootstrap: admin user exists but could not be located by label');
    }
    adminUserId = admin.id;

    // Recovery check: if admin has no devices AND no active claim tokens, emit fresh.
    const devices = listUserDevices(db, adminUserId);
    if (devices.length > 0) {
      return { created: false };
    }
    const now = nowSec();
    const active = db
      .select()
      .from(claimTokens)
      .where(and(
        eq(claimTokens.userId, adminUserId),
        isNull(claimTokens.usedAt),
        gte(claimTokens.expiresAt, now),
      ))
      .all();
    if (active.length > 0) {
      return { created: false };
    }
    recovered = true;
  }

  const token = adminCount === 0
    ? createClaimToken(db, adminUserId, cfg.claimTokenTtlSec ?? DEFAULT_TTL_SEC).token
    : regenerateClaimToken(db, adminUserId, cfg.claimTokenTtlSec ?? DEFAULT_TTL_SEC).token;

  const dbDir = dirname(cfg.dbPath);
  const sentinelPath = join(dbDir, 'admin-claim-token.txt');
  try {
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(sentinelPath, `${token}\n`, { mode: 0o600 });
  } catch (e) {
    logger.warn({ err: (e as Error).message, sentinelPath }, 'bootstrap: sentinel write failed (continuing)');
  }

  const banner = [
    '',
    '┌──────────────────────────────────────────────────────────┐',
    `│  ${recovered ? 'ADMIN CLAIM TOKEN RE-EMITTED (recovery mode):' : 'FIRST-RUN ADMIN CLAIM TOKEN (expires 24h):  '}    │`,
    '│                                                          │',
    `│      ${token.padEnd(50)}│`,
    '│                                                          │',
    '│  Enter this token on your first device to become admin.  │',
    `│  Also written to: ${sentinelPath.padEnd(38).slice(0, 38)}│`,
    '└──────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
  process.stdout.write(banner);

  return { created: adminCount === 0, token, recovered };
}
```

The Drizzle imports (`eq`, `and`, `isNull`, `gte`) for the recovery check are necessary; verify they're in the imports at the top.

- [ ] **Step 2: Write `bootstrap.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { bootstrapAdminIfNeeded } from './bootstrap';
import { countAdmins } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('bootstrapAdminIfNeeded', () => {
  let tmpDir: string;
  let dbPath: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'canvas-boot-'));
    dbPath = join(tmpDir, 'canvas.db');
  });

  test('first run: creates admin, mints token, writes sentinel file', () => {
    const db = makeDb();
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(true);
    expect(r.token).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(countAdmins(db)).toBe(1);
    const sentinel = join(tmpDir, 'admin-claim-token.txt');
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, 'utf8').trim()).toBe(r.token);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('second run with paired admin device: no-op', () => {
    const db = makeDb();
    const r1 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    createDeviceSession(db, { userId: 1, deviceLabel: 'X', tokenHash: 'h1' });
    const r2 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r2.created).toBe(false);
    expect(r2.token).toBeUndefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recovery: admin exists, no devices, no active token → emit fresh token', () => {
    const db = makeDb();
    const r1 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    // Force-expire the first token.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = expires_at - 100000').run();
    const r2 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r2.created).toBe(false);
    expect(r2.recovered).toBe(true);
    expect(r2.token).toBeDefined();
    expect(r2.token).not.toBe(r1.token);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 3: Wire `bootstrapAdminIfNeeded` into `server/src/index.ts`**

Open `server/src/index.ts`. Currently:

```ts
const db = initDb(config.CANVAS_DB_PATH);
runMigrations(db);
const stopReaper = startReaper(db);
const app = buildApp(db);
```

Insert bootstrap after migrations, before the reaper:

```ts
import { bootstrapAdminIfNeeded } from './lib/bootstrap';

// ... (existing imports + config load)

const db = initDb(config.CANVAS_DB_PATH);
runMigrations(db);
bootstrapAdminIfNeeded(db, { dbPath: config.CANVAS_DB_PATH, claimTokenTtlSec: 24 * 60 * 60 });
const stopReaper = startReaper(db);
const app = buildApp(db);
```

- [ ] **Step 4: Run + typecheck**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck
```

All previously-passing tests still pass plus +3 for bootstrap. Typecheck clean.

- [ ] **Step 5: Smoke test the boot**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
rm -rf data/
bun start &
SERVER_PID=$!
sleep 2
kill $SERVER_PID
sleep 1
test -f data/admin-claim-token.txt && cat data/admin-claim-token.txt
```

Expected: stdout shows the boxed claim token banner; `data/admin-claim-token.txt` exists with the token in it.

- [ ] **Step 6: Commit**

```bash
cd /c/github/passenger
git add server/src/lib/bootstrap.ts server/src/lib/bootstrap.test.ts \
        server/src/index.ts
git commit -m "server: first-run admin bootstrap with claim-token sentinel file"
```

---

## Task 3: Auth middleware + auth routes

**Files:**
- Create: `server/src/middleware/auth.ts` (+ test)
- Create: `server/src/routes/auth.ts` (+ test)
- Modify: `server/src/app.ts` — mount auth routes at `/api/auth`, apply `requireUser` middleware to everything else under `/api/*` except `/api/auth/claim`

**Interfaces:**
- Produces:
  - `requireUser(getDb): Hono middleware` — verifies bearer, attaches `{ userId: number; role: 'admin' | 'member'; deviceTokenHash: string }` to context via `c.set('user', …)`.
  - `requireAdmin: Hono middleware` — assumes `requireUser` ran; 403s if role !== 'admin'.
  - `getAuthContext(c): { userId; role; deviceTokenHash }` — typed accessor for route handlers.
  - `makeAuthRoutes(getDb): Hono` — sub-app with POST /claim, GET /me, POST /logout, DELETE /devices/:id

- [ ] **Step 1: Write `auth.ts` middleware**

`server/src/middleware/auth.ts`:
```ts
import type { Context, Next } from 'hono';
import type { Db } from '../db';
import { hashBearer } from '../lib/bearer';
import { getDeviceSession, touchDeviceSession } from '../storage/device-sessions';
import { getUser } from '../storage/users';
import { nowSec } from '../lib/time';

export interface AuthContext {
  userId: number;
  role: 'admin' | 'member';
  deviceTokenHash: string;
}

const AUTH_VAR = 'auth' as const;

export function requireUser(getDb: () => Db) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const bearer = header.slice('Bearer '.length).trim();
    if (!bearer) return c.json({ error: 'unauthorized' }, 401);
    const tokenHash = await hashBearer(bearer);
    const session = getDeviceSession(getDb(), tokenHash);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    const user = getUser(getDb(), session.userId);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    // Fire-and-forget last-seen bump. SQLite is serial; this is fast.
    try { touchDeviceSession(getDb(), tokenHash, nowSec()); } catch { /* ignore */ }
    c.set(AUTH_VAR, { userId: user.id, role: user.role, deviceTokenHash: tokenHash } satisfies AuthContext);
    await next();
  };
}

export async function requireAdmin(c: Context, next: Next) {
  const auth = c.get(AUTH_VAR) as AuthContext | undefined;
  if (!auth) return c.json({ error: 'unauthorized' }, 401);
  if (auth.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
}

export function getAuthContext(c: Context): AuthContext {
  const auth = c.get(AUTH_VAR) as AuthContext | undefined;
  if (!auth) throw new Error('getAuthContext: no auth context (requireUser middleware missing)');
  return auth;
}
```

- [ ] **Step 2: Write `auth.test.ts` middleware tests**

```ts
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { errorHandler } from './error-handler';
import { requireUser, requireAdmin, getAuthContext } from './auth';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { hashBearer, generateBearer } from '../lib/bearer';

async function makeFixture(role: 'admin' | 'member') {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const user = createUser(db, { label: 'U', role });
  const bearer = generateBearer();
  const tokenHash = await hashBearer(bearer);
  createDeviceSession(db, { userId: user.id, deviceLabel: 'D', tokenHash });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', requireUser(() => db));
  app.get('/echo', (c) => c.json(getAuthContext(c)));
  app.get('/admin', requireAdmin, (c) => c.json({ ok: true }));
  return { app, bearer };
}

describe('auth middleware', () => {
  test('401 when Authorization header missing', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo'));
    expect(res.status).toBe(401);
  });

  test('401 when Bearer scheme is wrong', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: 'Basic abc' } }));
    expect(res.status).toBe(401);
  });

  test('401 when token unknown', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: 'Bearer unknown' } }));
    expect(res.status).toBe(401);
  });

  test('200 + attaches auth context for valid bearer', async () => {
    const { app, bearer } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { userId: number; role: string };
    expect(body.role).toBe('admin');
  });

  test('requireAdmin returns 403 for member', async () => {
    const { app, bearer } = await makeFixture('member');
    const res = await app.fetch(new Request('http://test/admin', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(403);
  });

  test('requireAdmin passes for admin', async () => {
    const { app, bearer } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/admin', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Write `routes/auth.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { consumeClaimToken } from '../storage/claim-tokens';
import { createDeviceSession, deleteDeviceSession, getDeviceSession, listUserDevices } from '../storage/device-sessions';
import { getUser } from '../storage/users';
import { generateBearer, hashBearer } from '../lib/bearer';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

export function makeAuthRoutes(getDb: () => Db) {
  const r = new Hono();

  // POST /claim  body: { token, deviceLabel }  → { bearer, user }
  r.post('/claim', async (c) => {
    const body = await c.req.json().catch(() => null) as { token?: unknown; deviceLabel?: unknown } | null;
    if (!body || typeof body.token !== 'string' || typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0) {
      return c.json({ error: 'invalid claim payload' }, 400);
    }
    const claim = consumeClaimToken(getDb(), body.token);
    if (!claim) return c.json({ error: 'invalid or expired token' }, 410);
    const user = getUser(getDb(), claim.userId);
    if (!user) return c.json({ error: 'user not found' }, 410);
    const bearer = generateBearer();
    const tokenHash = await hashBearer(bearer);
    createDeviceSession(getDb(), { userId: user.id, deviceLabel: body.deviceLabel, tokenHash });
    logger.info({ userId: user.id, deviceLabel: body.deviceLabel }, 'device claimed');
    return c.json({ bearer, user: { id: user.id, label: user.label, role: user.role } });
  });

  // GET /me  → { user, devices }
  r.get('/me', async (c) => {
    const auth = getAuthContext(c);
    const user = getUser(getDb(), auth.userId);
    if (!user) return c.json({ error: 'user not found' }, 404);
    const devices = listUserDevices(getDb(), auth.userId).map((d) => ({
      id: d.tokenHash,           // opaque to the client; suitable as a delete key
      label: d.deviceLabel,
      lastSeenAt: d.lastSeenAt,
      current: d.tokenHash === auth.deviceTokenHash,
    }));
    return c.json({ user: { id: user.id, label: user.label, role: user.role }, devices });
  });

  // POST /logout  → 204  (revokes the calling bearer)
  r.post('/logout', async (c) => {
    const auth = getAuthContext(c);
    deleteDeviceSession(getDb(), auth.deviceTokenHash);
    return c.body(null, 204);
  });

  // DELETE /devices/:id  → 204  (revoke another of MY devices; :id is tokenHash)
  r.delete('/devices/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = c.req.param('id');
    const target = getDeviceSession(getDb(), id);
    if (!target) return c.json({ error: 'device not found' }, 404);
    if (target.userId !== auth.userId) return c.json({ error: 'forbidden' }, 403);
    deleteDeviceSession(getDb(), id);
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 4: Write `auth.test.ts` (route tests)**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeAuthRoutes } from './auth';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createClaimToken } from '../storage/claim-tokens';

function makeApp(): { app: Hono; db: Db } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const app = new Hono();
  app.onError(errorHandler);
  // Mount /claim as public, everything else behind requireUser.
  const r = makeAuthRoutes(() => db);
  // For tests we mount the entire sub-app and rely on each route's own behavior.
  app.use('/api/auth/me', requireUser(() => db));
  app.use('/api/auth/logout', requireUser(() => db));
  app.use('/api/auth/devices/*', requireUser(() => db));
  app.route('/api/auth', r);
  return { app, db };
}

async function jsonPost(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}

describe('auth routes', () => {
  let app: Hono; let db: Db;
  beforeEach(() => { ({ app, db } = makeApp()); });

  test('POST /claim with valid token returns bearer + user', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const res = await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Tesla' });
    expect(res.status).toBe(200);
    const body = await res.json() as { bearer: string; user: { role: string } };
    expect(body.bearer).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(body.user.role).toBe('admin');
  });

  test('POST /claim with invalid token returns 410', async () => {
    const res = await jsonPost(app, '/api/auth/claim', { token: 'bogus', deviceLabel: 'X' });
    expect(res.status).toBe(410);
  });

  test('POST /claim with missing deviceLabel returns 400', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const res = await jsonPost(app, '/api/auth/claim', { token: t.token });
    expect(res.status).toBe(400);
  });

  test('POST /claim token is single-use (second attempt 410)', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'X' });
    const res2 = await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Y' });
    expect(res2.status).toBe(410);
  });

  test('GET /me returns user + devices for an authenticated bearer', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Tesla' })).json() as { bearer: string };
    const res = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { label: string }; devices: { label: string; current: boolean }[] };
    expect(body.user.label).toBe('A');
    expect(body.devices.length).toBe(1);
    expect(body.devices[0]!.current).toBe(true);
  });

  test('POST /logout revokes the calling bearer', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'X' })).json() as { bearer: string };
    const logoutRes = await jsonPost(app, '/api/auth/logout', {}, { authorization: `Bearer ${claim.bearer}` });
    expect(logoutRes.status).toBe(204);
    // /me with the same bearer is now 401.
    const meRes = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    expect(meRes.status).toBe(401);
  });
});
```

- [ ] **Step 5: Wire into `app.ts`**

Open `server/src/app.ts`. The existing `buildApp(db)`:
1. Add `import { makeAuthRoutes } from './routes/auth';` and `import { requireUser } from './middleware/auth';`.
2. Mount `/api/auth/claim` as the FIRST route registered (before any blanket middleware).
3. For everything else under `/api/*`, apply `requireUser(() => db)` as middleware.

The cleanest pattern with Hono:

```ts
export function buildApp(db: Db): Hono {
  const app = new Hono();
  app.use('*', corsMiddleware());
  app.use('*', requestLog());
  app.onError(errorHandler);
  app.get('/health', (c) => c.json({ ok: true, version: config.version }));

  // Auth routes — /claim is public; the rest are mounted with requireUser below.
  app.route('/api/auth', makeAuthRoutes(() => db));

  // Everything else under /api/* requires auth.
  app.use('/api/pair/*',           requireUser(() => db));
  app.use('/api/home',             requireUser(() => db));
  app.use('/api/source-home',      requireUser(() => db));
  app.use('/api/library/*',        requireUser(() => db));
  app.use('/api/item/*',           requireUser(() => db));
  app.use('/api/search',           requireUser(() => db));
  app.use('/api/play/*',           requireUser(() => db));
  app.use('/api/progress/*',       requireUser(() => db));
  app.use('/api/source-status',    requireUser(() => db));
  app.use('/api/subtitles',        requireUser(() => db));
  // (admin, sources management mounts come in Tasks 4-5)

  app.route('/api/pair',           makePairRoutes(() => db));
  // ... (existing route mounts)
  return app;
}
```

But `/api/auth/me`, `/logout`, `/devices/:id` need auth too. The cleanest way: have `makeAuthRoutes` itself apply `requireUser` to those endpoints internally rather than at the app level. Update `makeAuthRoutes`:

```ts
export function makeAuthRoutes(getDb: () => Db) {
  const r = new Hono();

  // /claim is public.
  r.post('/claim', async (c) => { /* … */ });

  // The rest require auth — apply requireUser BEFORE these handlers register.
  const authed = new Hono();
  authed.use('*', requireUser(getDb));
  authed.get('/me', async (c) => { /* … */ });
  authed.post('/logout', async (c) => { /* … */ });
  authed.delete('/devices/:id', async (c) => { /* … */ });

  r.route('/', authed);
  return r;
}
```

Update the test accordingly (drop the explicit `app.use('/api/auth/me', ...)` lines — the sub-app handles it).

- [ ] **Step 6: Update existing pair-route tests for auth**

The pair route tests (`server/src/routes/pair.test.ts` from sub-project A T6) test the routes WITHOUT auth middleware in their test fixtures — they construct a Hono app with `app.route('/api/pair', makePairRoutes(...))` and no auth layer. That's still valid because the tests assert pair-route behavior in isolation. The auth middleware lives in `buildApp` and is exercised by E2E tests; unit tests of the routes themselves are auth-agnostic.

So: the existing pair-route tests stay UNCHANGED. The same applies to home/search/library/etc tests in T6 — they don't need auth wrapping.

Verify after changes: `bun test src/routes/pair.test.ts` still passes (66 → still 66, no regressions).

- [ ] **Step 7: Full test + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck
```

Expected: ~133 tests pass (T1+T2 totals + ~12 new for auth middleware + routes). Typecheck clean.

```bash
cd /c/github/passenger
git add server/src/middleware/auth.ts server/src/middleware/auth.test.ts \
        server/src/routes/auth.ts server/src/routes/auth.test.ts \
        server/src/app.ts
git commit -m "server: auth middleware (requireUser/requireAdmin) + /api/auth/* (claim/me/logout/devices)"
```

---

## Task 4: Admin routes (users CRUD + ACL grants)

**Files:**
- Create: `server/src/routes/admin.ts` (+ test)
- Modify: `server/src/app.ts` — mount `/api/admin` with `requireUser` + `requireAdmin`

**Interfaces produced:** sub-app handling admin user management + ACL grants.

- [ ] **Step 1: Write `routes/admin.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { createUser, deleteUser, getUser, listUsers } from '../storage/users';
import { createClaimToken, regenerateClaimToken } from '../storage/claim-tokens';
import { listUserDevices, deleteUserDeviceSessions } from '../storage/device-sessions';
import { grantSourceAccess, revokeSourceAccess, listAccessibleSources, getSource } from '../storage/sources';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

const CLAIM_TTL_SEC = 24 * 60 * 60;

export function makeAdminRoutes(getDb: () => Db) {
  const r = new Hono();

  // GET /users → [{ id, label, role, deviceCount, sourceAccessCount }]
  r.get('/users', async (c) => {
    const db = getDb();
    const users = listUsers(db);
    const enriched = users.map((u) => ({
      id: u.id,
      label: u.label,
      role: u.role,
      createdAt: u.createdAt,
      deviceCount: listUserDevices(db, u.id).length,
      sourceAccessCount: u.role === 'admin' ? null : listAccessibleSources(db, u.id).length,
    }));
    return c.json(enriched);
  });

  // POST /users  body: { label }  → { user, claimToken }
  r.post('/users', async (c) => {
    const body = await c.req.json().catch(() => null) as { label?: unknown } | null;
    if (!body || typeof body.label !== 'string' || body.label.length === 0 || body.label.length > 64) {
      return c.json({ error: 'invalid label' }, 400);
    }
    const db = getDb();
    const user = createUser(db, { label: body.label, role: 'member' });
    const claim = createClaimToken(db, user.id, CLAIM_TTL_SEC);
    logger.info({ userId: user.id, label: user.label }, 'admin created user');
    return c.json({
      user: { id: user.id, label: user.label, role: user.role, createdAt: user.createdAt },
      claimToken: claim.token,
    });
  });

  // DELETE /users/:id → 204
  r.delete('/users/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    if (id === auth.userId) return c.json({ error: 'admin cannot delete themselves' }, 409);
    const db = getDb();
    const target = getUser(db, id);
    if (!target) return c.json({ error: 'user not found' }, 404);
    if (target.role === 'admin') return c.json({ error: 'admin cannot be deleted' }, 409);
    // FK cascade handles claim_tokens, device_sessions, user_source_access.
    // Sources paired by this user get pairedByUserId set to null (ON DELETE SET NULL).
    deleteUser(db, id);
    logger.info({ userId: id }, 'admin deleted user');
    return c.body(null, 204);
  });

  // POST /users/:id/claim-token → { claimToken }
  r.post('/users/:id/claim-token', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const db = getDb();
    const target = getUser(db, id);
    if (!target) return c.json({ error: 'user not found' }, 404);
    const claim = regenerateClaimToken(db, id, CLAIM_TTL_SEC);
    logger.info({ userId: id }, 'admin regenerated claim token');
    return c.json({ claimToken: claim.token });
  });

  // POST /users/:id/sources/:sourceId → 204 (grant)
  r.post('/users/:id/sources/:sourceId', async (c) => {
    const userId = Number(c.req.param('id'));
    const sourceId = Number(c.req.param('sourceId'));
    if (!Number.isFinite(userId) || !Number.isFinite(sourceId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const db = getDb();
    const target = getUser(db, userId);
    if (!target) return c.json({ error: 'user not found' }, 404);
    if (target.role === 'admin') return c.json({ error: 'admin access is implicit' }, 409);
    const source = getSource(db, sourceId);
    if (!source) return c.json({ error: 'source not found' }, 404);
    grantSourceAccess(db, userId, sourceId);
    return c.body(null, 204);
  });

  // DELETE /users/:id/sources/:sourceId → 204 (revoke)
  r.delete('/users/:id/sources/:sourceId', async (c) => {
    const userId = Number(c.req.param('id'));
    const sourceId = Number(c.req.param('sourceId'));
    if (!Number.isFinite(userId) || !Number.isFinite(sourceId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const db = getDb();
    revokeSourceAccess(db, userId, sourceId);
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 2: Write `admin.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeAdminRoutes } from './admin';
import { requireUser, requireAdmin } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';

async function makeAuthedFixture() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'Admin', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'A', tokenHash: await hashBearer(adminBearer) });
  const member = createUser(db, { label: 'M', role: 'member' });
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: member.id, deviceLabel: 'M', tokenHash: await hashBearer(memberBearer) });

  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminRoutes(() => db));
  return { app, db, admin, member, adminBearer, memberBearer };
}

function jsonReq(path: string, method: string, body: unknown, bearer: string): Request {
  return new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('admin routes', () => {
  test('GET /users lists admin + member with counts', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'GET', undefined, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { label: string; role: string; deviceCount: number }[];
    expect(body.length).toBe(2);
    expect(body.find((u) => u.role === 'admin')?.deviceCount).toBe(1);
  });

  test('GET /users from a member returns 403', async () => {
    const { app, memberBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'GET', undefined, memberBearer));
    expect(res.status).toBe(403);
  });

  test('POST /users creates a member + claim token', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: 'Kid' }, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { label: string; role: string }; claimToken: string };
    expect(body.user.label).toBe('Kid');
    expect(body.user.role).toBe('member');
    expect(body.claimToken).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
  });

  test('POST /users rejects empty label', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: '' }, adminBearer));
    expect(res.status).toBe(400);
  });

  test('DELETE /users/:id refuses to delete self (admin)', async () => {
    const { app, adminBearer, admin } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${admin.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(409);
  });

  test('DELETE /users/:id removes a member', async () => {
    const { app, adminBearer, member } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(204);
  });

  test('POST /users/:id/claim-token regenerates', async () => {
    const { app, adminBearer, member } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/claim-token`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { claimToken: string };
    expect(body.claimToken).toMatch(/^[A-Z0-9]{4}-/);
  });

  test('POST /users/:userId/sources/:sourceId grants access', async () => {
    const { app, adminBearer, member, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(204);
  });

  test('POST grant on admin returns 409 (implicit access)', async () => {
    const { app, adminBearer, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    const res = await app.fetch(jsonReq(`/api/admin/users/${admin.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(409);
  });

  test('DELETE grant revokes access', async () => {
    const { app, adminBearer, member, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    // Grant first.
    await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Step 3: Mount in `app.ts`**

Add to `buildApp(db)`:
```ts
import { makeAdminRoutes } from './routes/admin';

// inside buildApp, after the requireUser mounts:
app.use('/api/admin/*', requireUser(() => db));
app.use('/api/admin/*', requireAdmin);
app.route('/api/admin', makeAdminRoutes(() => db));
```

- [ ] **Step 4: Test + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck

cd /c/github/passenger
git add server/src/routes/admin.ts server/src/routes/admin.test.ts server/src/app.ts
git commit -m "server: admin routes (users CRUD, claim regen, ACL grant/revoke)"
```

---

## Task 5: Sources-management routes

**Files:**
- Create: `server/src/routes/sources-mgmt.ts` (+ test)
- Modify: `server/src/app.ts` — mount `/api/sources`

GET `/api/sources` returns all for admin, ACL-filtered for member. DELETE `/api/sources/:id` allowed for admin OR the original pairer.

- [ ] **Step 1: Write `routes/sources-mgmt.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { getSource, listAllSources, listAccessibleSources, deleteSource } from '../storage/sources';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

export function makeSourcesMgmtRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const auth = getAuthContext(c);
    const db = getDb();
    const rows = auth.role === 'admin' ? listAllSources(db) : listAccessibleSources(db, auth.userId);
    return c.json(rows.map((s) => ({
      id: s.id,
      type: s.type,
      baseUrl: s.baseUrl,
      label: s.label,
      pairedByUserId: s.pairedByUserId,
      createdAt: s.createdAt,
      // NB: s.token (upstream auth) is NEVER returned in the listing — it stays
      // server-side. The frontend never needs to know it post-pair.
    })));
  });

  r.delete('/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const db = getDb();
    const source = getSource(db, id);
    if (!source) return c.json({ error: 'source not found' }, 404);
    if (auth.role !== 'admin' && source.pairedByUserId !== auth.userId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    deleteSource(db, id);
    logger.info({ sourceId: id, by: auth.userId }, 'source deleted');
    return c.body(null, 204);
  });

  return r;
}
```

- [ ] **Step 2: Write `sources-mgmt.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeSourcesMgmtRoutes } from './sources-mgmt';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource, grantSourceAccess } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';

async function makeFixture() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'A', role: 'admin' });
  const member = createUser(db, { label: 'M', role: 'member' });
  const adminBearer = generateBearer();
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'a', tokenHash: await hashBearer(adminBearer) });
  createDeviceSession(db, { userId: member.id, deviceLabel: 'm', tokenHash: await hashBearer(memberBearer) });
  const s1 = createSource(db, { type: 'plex', baseUrl: 'http://1', token: 't', label: 'S1', pairedByUserId: admin.id });
  const s2 = createSource(db, { type: 'plex', baseUrl: 'http://2', token: 't', label: 'S2', pairedByUserId: member.id });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/sources/*', requireUser(() => db));
  app.use('/api/sources', requireUser(() => db));
  app.route('/api/sources', makeSourcesMgmtRoutes(() => db));
  return { app, db, admin, member, adminBearer, memberBearer, s1, s2 };
}

describe('sources-mgmt routes', () => {
  test('GET / for admin sees both sources', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${adminBearer}` } }));
    const body = await res.json() as { label: string }[];
    expect(body.length).toBe(2);
  });

  test('GET / for member sees only their accessible (s2 was paired by them, but not yet granted)', async () => {
    const { app, memberBearer } = await makeFixture();
    // member paired s2 but no grant exists yet — they don't see s2 (the pair flow in T7 will auto-grant).
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await res.json() as unknown[];
    expect(body.length).toBe(0);
  });

  test('GET / for member sees s1 after grant', async () => {
    const { app, db, member, s1, memberBearer } = await makeFixture();
    grantSourceAccess(db, member.id, s1.id);
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await res.json() as { label: string }[];
    expect(body.map((b) => b.label)).toEqual(['S1']);
  });

  test('DELETE /:id by admin removes any source', async () => {
    const { app, adminBearer, s2 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s2.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${adminBearer}` } }));
    expect(res.status).toBe(204);
  });

  test('DELETE /:id by member on someone else\'s source returns 403', async () => {
    const { app, memberBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberBearer}` } }));
    expect(res.status).toBe(403);
  });

  test('DELETE /:id by member on their own paired source returns 204', async () => {
    const { app, memberBearer, s2 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s2.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberBearer}` } }));
    expect(res.status).toBe(204);
  });

  test('DELETE /:id on unknown returns 404', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources/9999', { method: 'DELETE', headers: { authorization: `Bearer ${adminBearer}` } }));
    expect(res.status).toBe(404);
  });

  test('source.token is NEVER returned in GET listing', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${adminBearer}` } }));
    const body = await res.json() as Record<string, unknown>[];
    for (const row of body) {
      expect('token' in row).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Mount in `app.ts`**

```ts
import { makeSourcesMgmtRoutes } from './routes/sources-mgmt';

// inside buildApp:
app.use('/api/sources', requireUser(() => db));
app.use('/api/sources/*', requireUser(() => db));
app.route('/api/sources', makeSourcesMgmtRoutes(() => db));
```

- [ ] **Step 4: Test + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server && bun test && bun run typecheck

cd /c/github/passenger
git add server/src/routes/sources-mgmt.ts server/src/routes/sources-mgmt.test.ts server/src/app.ts
git commit -m "server: /api/sources (list + delete) with admin-sees-all + ACL-filtered for members"
```

---

## Task 6: `getUserSources` helper + migrate browse/search routes to DB sources

**Files:**
- Create: `server/src/lib/user-sources.ts` (+ test)
- Modify: `server/src/routes/home.ts`, `source-home.ts`, `library.ts`, `item.ts`, `search.ts`

**Interfaces:**
- Produces: `getUserSources(db, ctx): Record<srcKey, ParsedSource>` where `srcKey` is `String(source.id)` and `ParsedSource` is `{ type, baseUrl, token }`. For admin: returns ALL sources. For member: returns ACL-filtered.

- [ ] **Step 1: Write `lib/user-sources.ts`**

```ts
import type { Db } from '../db';
import type { ParsedSource } from './x-sources';
import { listAllSources, listAccessibleSources } from '../storage/sources';
import type { AuthContext } from '../middleware/auth';

export function getUserSources(db: Db, auth: AuthContext): Record<string, ParsedSource> {
  const rows = auth.role === 'admin' ? listAllSources(db) : listAccessibleSources(db, auth.userId);
  const out: Record<string, ParsedSource> = {};
  for (const s of rows) {
    out[String(s.id)] = { type: s.type, baseUrl: s.baseUrl, token: s.token };
  }
  return out;
}
```

- [ ] **Step 2: Write `user-sources.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { getUserSources } from './user-sources';
import { createUser } from '../storage/users';
import { createSource, grantSourceAccess } from '../storage/sources';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('getUserSources', () => {
  test('admin sees all sources keyed by id', () => {
    const db = makeDb();
    const admin = createUser(db, { label: 'A', role: 'admin' });
    const s1 = createSource(db, { type: 'plex', baseUrl: 'http://1', token: 't1', label: 'S1', pairedByUserId: admin.id });
    const s2 = createSource(db, { type: 'flixify', baseUrl: 'http://2', token: 't2', label: 'S2', pairedByUserId: admin.id });
    const map = getUserSources(db, { userId: admin.id, role: 'admin', deviceTokenHash: '' });
    expect(Object.keys(map).sort()).toEqual([String(s1.id), String(s2.id)].sort());
    expect(map[String(s1.id)]!.type).toBe('plex');
    expect(map[String(s2.id)]!.type).toBe('flixify');
  });

  test('member sees only granted sources', () => {
    const db = makeDb();
    const admin = createUser(db, { label: 'A', role: 'admin' });
    const member = createUser(db, { label: 'M', role: 'member' });
    const s1 = createSource(db, { type: 'plex', baseUrl: 'http://1', token: 't', label: 'S1', pairedByUserId: admin.id });
    const s2 = createSource(db, { type: 'plex', baseUrl: 'http://2', token: 't', label: 'S2', pairedByUserId: admin.id });
    grantSourceAccess(db, member.id, s1.id);
    const map = getUserSources(db, { userId: member.id, role: 'member', deviceTokenHash: '' });
    expect(Object.keys(map)).toEqual([String(s1.id)]);
  });
});
```

- [ ] **Step 3: Migrate `routes/home.ts`**

Change every route's `parseXSources(c.req.raw)` → `getUserSources(getDb(), getAuthContext(c))`. The home route also needs to accept a `getDb` factory now since it touches the DB. Convert it to a factory pattern:

`server/src/routes/home.ts`:
```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { getUserSources } from '../lib/user-sources';
import { getAuthContext } from '../middleware/auth';
import { callPerSource } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function makeHomeRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const sources = getUserSources(getDb(), getAuthContext(c));
    const { results, errors } = await callPerSource(sources, async (_key, src) => {
      const adapter = getAdapter(src.type);
      const ctx = { baseUrl: src.baseUrl, token: src.token };
      const [home, libCount] = await Promise.all([
        adapter.home(ctx),
        adapter.library(ctx)
          .then((r) => r.items.filter((i) => i.type === 'folder').length)
          .catch(() => 0),
      ]);
      return { home, libCount };
    });
    const rows = Object.entries(results).flatMap(([key, rs]) =>
      rs.home.map((row) => ({ ...row, source: key })),
    );
    const libraryCounts: Record<string, number> = {};
    for (const [key, rs] of Object.entries(results)) libraryCounts[key] = rs.libCount;
    return c.json({ rows, errors, libraryCounts });
  });

  return r;
}
```

Update existing `app.ts` to call `app.route('/api/home', makeHomeRoutes(() => db))` instead of importing the bare `homeRoutes`.

- [ ] **Step 4: Migrate `routes/source-home.ts`, `library.ts`, `item.ts`, `search.ts`** — mechanical, same three edits per file.

For each of those four files, apply exactly three changes:

1. **Convert the sub-app to a factory.** Replace the current `export const xxxRoutes = new Hono()` with `export function makeXxxRoutes(getDb: () => Db)`. Move the route registrations inside the function body and `return r` at the end where `r` is the new `new Hono()`.

2. **Swap the source lookup.** Anywhere the file currently calls `parseXSources(c.req.raw)`, replace with `getUserSources(getDb(), getAuthContext(c))`. The returned `Record<srcKey, ParsedSource>` shape is identical, so the rest of each handler is unchanged.

3. **Update imports.**
   - Remove: `import { parseXSources } from '../lib/x-sources';`
   - Add: `import type { Db } from '../db';`, `import { getUserSources } from '../lib/user-sources';`, `import { getAuthContext } from '../middleware/auth';`

`source-home.ts` is a single-source route — its "source not paired" error (thrown by `callOneSource`) keeps the same shape, so the frontend's existing `/source not paired/i` regex handling continues to work. `search.ts` returns `{ hits: [], errors: [] }` on empty `q` BEFORE doing the source lookup, so an unauthenticated request never reaches `getUserSources` — but `requireUser` middleware bounces unauthed requests with 401 first anyway.

- [ ] **Step 5: Update existing route tests**

Every route test (`home.test.ts`, `source-home.test.ts`, `library.test.ts`, `search.test.ts`) currently sends sources via the `x-sources` header. They now need to:
1. Create a user + device session (so auth middleware passes).
2. Seed sources into the DB instead of the header.
3. Use the factory `makeXxxRoutes(getDb)` to construct the routes.
4. Set up `requireUser` middleware in the test app since the routes now expect `getAuthContext` to find an auth context.

Update pattern (apply to each route test file):

```ts
async function makeApp() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'A', role: 'admin' });
  const bearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(bearer) });
  registerAdapter(...);  // stub as before
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/home', requireUser(() => db));
  app.route('/api/home', makeHomeRoutes(() => db));
  return { app, db, admin, bearer };
}

// In the test: create a source row, then call /api/home with Authorization header.
test('home injects source key and folder count', async () => {
  const { app, db, admin, bearer } = await makeApp();
  const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
  const res = await app.fetch(new Request('http://test/api/home', {
    headers: { authorization: `Bearer ${bearer}` },
  }));
  // ... assert rows[0].source === String(s.id), libraryCounts[String(s.id)] === N
});
```

This is mechanical but applies to every route's test file. Take care: the old tests passed sources via `x-sources` and used arbitrary srcKey strings (like `'s1'`). The new tests use the actual DB-generated source.id stringified.

- [ ] **Step 6: Test + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server && bun test && bun run typecheck

cd /c/github/passenger
git add server/src/lib/user-sources.ts server/src/lib/user-sources.test.ts \
        server/src/routes/home.ts server/src/routes/home.test.ts \
        server/src/routes/source-home.ts server/src/routes/source-home.test.ts \
        server/src/routes/library.ts server/src/routes/library.test.ts \
        server/src/routes/item.ts \
        server/src/routes/search.ts server/src/routes/search.test.ts \
        server/src/app.ts
git commit -m "server: migrate browse + search routes from x-sources header to DB-loaded user sources"
```

---

## Task 7: Migrate stream/status routes + pair-flow persistence

**Files:**
- Modify: `server/src/routes/play.ts`, `progress.ts`, `source-status.ts`, `subtitles.ts`
- Modify: `server/src/routes/pair.ts` — `/approve` and `/flixify-poll` now also insert into `sources` + grant access

- [ ] **Step 1: Migrate `play.ts`, `progress.ts`, `source-status.ts`, `subtitles.ts`** — mechanical, same three edits per file (with one extra for `source-status.ts`).

For each of those four files, apply the same three changes from Task 6 Step 4:

1. Convert the sub-app to a `makeXxxRoutes(getDb)` factory.
2. Replace `parseXSources(c.req.raw)` with `getUserSources(getDb(), getAuthContext(c))`.
3. Update imports to drop `parseXSources` and add `Db`, `getUserSources`, `getAuthContext`.

**`source-status.ts` already uses a factory** (`makeSourceStatusRoutes` from sub-project A T8), so for it: just swap the x-sources call. The handler currently does `const sources = parseXSources(c.req.raw); const src = sources[key]; if (!src) return 404`. Replace with `const sources = getUserSources(getDb(), getAuthContext(c)); const src = sources[key]; if (!src) return 404`. (`key` is the srcKey from `?key=<srcKey>`; with sources now keyed by DB id, the frontend will pass `String(source.id)`.)

**`play.ts`** has subtitle URL tagging: `result.subtitleTracks = result.subtitleTracks.map((t) => ({ ...t, url: t.url.includes('?') ? `${t.url}&src=${encodeURIComponent(srcKey)}` : `${t.url}?src=${encodeURIComponent(srcKey)}` }))`. `srcKey` here is `c.req.param('srcKey')` from the path — that's now `String(source.id)`. The tagging logic is otherwise unchanged.

**`subtitles.ts`** also reads `?src=<srcKey>` from the query string and uses `sources[srcKey]`. Same x-sources → getUserSources swap; the rest is unchanged.

**`progress.ts`** uses `callOneSource(sources, srcKey, ...)`. Same swap; rest unchanged.

- [ ] **Step 2: Modify `pair.ts` to persist sources**

The Plex approval path is `/api/pair/approve`. Currently it updates the `pair_sessions.payload.source`. After this change, in addition to updating the payload, INSERT into `sources` and grant the calling user access. Use `getAuthContext(c)` for the user id.

The flixify path's success branch is inside `r.post('/flixify-poll', ...)` where state === 'success'. Same change.

```ts
// At the top of pair.ts:
import { getAuthContext } from '../middleware/auth';
import { createSource, grantSourceAccess } from '../storage/sources';

// Inside the /approve handler, AFTER the existing updatePairSessionPayload + setPairSessionStatus:
const auth = getAuthContext(c);
const created = createSource(getDb(), {
  type: body.type as 'plex' | 'flixify',
  baseUrl: body.baseUrl,
  token: body.token,
  label: body.label,
  pairedByUserId: auth.userId,
});
grantSourceAccess(getDb(), auth.userId, created.id);
logger.info({ code, sourceId: created.id, by: auth.userId }, 'source created from pair approve');
return c.body(null, 204);

// Inside the /flixify-poll success branch:
const auth = getAuthContext(c);
const created = createSource(getDb(), {
  type: 'flixify',
  baseUrl: `https://${mirror}`,
  token: serializeFlixifyAuth(finalAuth),
  label: mirror,
  pairedByUserId: auth.userId,
});
grantSourceAccess(getDb(), auth.userId, created.id);
// (existing payload update + status flip remain)
return c.json({ status: 'approved' });
```

- [ ] **Step 3: Update `/api/pair/poll` to include the new source id**

The frontend currently reads the source from `/api/pair/poll`'s `source` field. With sources now in the DB, we want the frontend to get the `source.id` (so it can immediately request `/api/library/:id`, etc.). Adjust the poll handler:

```ts
// Inside /api/pair/poll, the approved branch:
if (session.status === 'approved') {
  const payload = session.payload as { source?: { type: string; baseUrl: string; token: string; label: string } };
  const src = payload.source;
  // Look up the source's DB id by matching the unique (pairedByUserId, label) combo OR by carrying the new source.id in payload.
  // Simpler: at the moment of approve, write source.id into payload too.
  return c.json({ status: 'approved', source: src });
}
```

To make this clean, update the `/approve` handler to also persist the new source id in the pair session payload:

```ts
// in /approve, after createSource:
updatePairSessionPayload(getDb(), code, {
  ...existingPayload,
  source: { id: created.id, type: body.type, baseUrl: body.baseUrl, token: body.token, label: body.label },
});
```

And same for flixify success branch:

```ts
updatePairSessionPayload(getDb(), code, {
  ...payload,
  flixify: { pin_id, auth: finalAuth, mirror },
  source: {
    id: created.id,
    type: 'flixify',
    baseUrl: `https://${mirror}`,
    token: serializeFlixifyAuth(finalAuth),
    label: mirror,
  },
});
```

Frontend will use `source.id` going forward; the legacy `source.token`/`baseUrl` fields stay in the response for backward compatibility but aren't needed.

- [ ] **Step 4: Update route tests**

`play.test.ts`, `progress.test.ts`, `source-status.test.ts`, `subtitles.test.ts`, `pair.test.ts` all need the same auth-fixture + DB-seeded-source pattern from Task 6 Step 6. Apply mechanically.

Pair tests need additional assertions:
- After `/approve`, the `sources` table has a new row with `pairedByUserId = admin.id`.
- After `/approve`, `user_source_access` has a row granting admin access.
- `/poll` returns `source.id` in the approved response.

- [ ] **Step 5: Test + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server && bun test && bun run typecheck

cd /c/github/passenger
git add server/src/routes/play.ts server/src/routes/play.test.ts \
        server/src/routes/progress.ts server/src/routes/progress.test.ts \
        server/src/routes/source-status.ts server/src/routes/source-status.test.ts \
        server/src/routes/subtitles.ts server/src/routes/subtitles.test.ts \
        server/src/routes/pair.ts server/src/routes/pair.test.ts \
        server/src/app.ts
git commit -m "server: migrate stream/status routes to DB sources + persist sources on pair approve"
```

---

## Task 8: Frontend — claim sign-in + session storage

**Files:**
- Create: `web/src/views/Claim.tsx`
- Create: `web/src/lib/session.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/App.tsx` (or router file) — replace SignIn with Claim
- Modify: `web/src/views/SignIn.tsx` — either replace contents with Claim or delete (delete preferred)

The implementer working on this task should read `web/src/api.ts`, `web/src/views/SignIn.tsx`, and `web/src/App.tsx` to understand the existing patterns (hash router, MUI sx-prop usage, Inter font, fetch wrapper conventions). Then:

- [ ] **Step 1: Write `lib/session.ts`** — localStorage accessors.

```ts
const BEARER_KEY = 'canvas:bearer';
const USER_KEY = 'canvas:user';

export interface SessionUser {
  id: number;
  label: string;
  role: 'admin' | 'member';
}

export function getBearer(): string | null {
  return localStorage.getItem(BEARER_KEY);
}

export function getUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionUser; } catch { return null; }
}

export function setSession(bearer: string, user: SessionUser): void {
  localStorage.setItem(BEARER_KEY, bearer);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem(BEARER_KEY);
  localStorage.removeItem(USER_KEY);
}
```

- [ ] **Step 2: Rewrite `web/src/api.ts`**

Drop the entire `sourcesHeader()` function. Add Bearer auth. On 401 → clear session + redirect to `/claim`.

```ts
import { API_BASE } from './config';
import { getBearer, clearSession } from './lib/session';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const bearer = getBearer();
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (res.status === 401) {
    clearSession();
    if (location.hash !== '#/claim') location.hash = '#/claim';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

The rest of the `api.*` methods stay the same — they call `request`, which now adds the Bearer header automatically. The `pairPlexServers`, `sourceHome`, etc. methods keep their signatures.

Add NEW methods for the auth + admin endpoints:

```ts
authClaim: (token: string, deviceLabel: string) =>
  request<{ bearer: string; user: { id: number; label: string; role: 'admin' | 'member' } }>('/api/auth/claim', {
    method: 'POST', body: JSON.stringify({ token, deviceLabel }),
  }),
authMe: () => request<{ user: { id: number; label: string; role: 'admin' | 'member' }; devices: { id: string; label: string; lastSeenAt: number; current: boolean }[] }>('/api/auth/me'),
authLogout: () => request<void>('/api/auth/logout', { method: 'POST' }),
authRevokeDevice: (id: string) => request<void>(`/api/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

adminListUsers: () => request<{ id: number; label: string; role: 'admin' | 'member'; deviceCount: number; sourceAccessCount: number | null; createdAt: number }[]>('/api/admin/users'),
adminCreateUser: (label: string) => request<{ user: { id: number; label: string; role: 'admin' | 'member' }; claimToken: string }>('/api/admin/users', { method: 'POST', body: JSON.stringify({ label }) }),
adminDeleteUser: (id: number) => request<void>(`/api/admin/users/${id}`, { method: 'DELETE' }),
adminRegenerateClaim: (userId: number) => request<{ claimToken: string }>(`/api/admin/users/${userId}/claim-token`, { method: 'POST' }),
adminGrantSource: (userId: number, sourceId: number) => request<void>(`/api/admin/users/${userId}/sources/${sourceId}`, { method: 'POST' }),
adminRevokeSource: (userId: number, sourceId: number) => request<void>(`/api/admin/users/${userId}/sources/${sourceId}`, { method: 'DELETE' }),

listSources: () => request<{ id: number; type: 'plex' | 'flixify'; baseUrl: string; label: string; pairedByUserId: number | null; createdAt: number }[]>('/api/sources'),
deleteSource: (id: number) => request<void>(`/api/sources/${id}`, { method: 'DELETE' }),
```

- [ ] **Step 3: Write `views/Claim.tsx`**

A simple two-input form matching the existing canvas SignIn aesthetic (MUI v6, Inter font, dark theme). Two fields: `Claim token` and `Device name`. On submit, calls `api.authClaim(token, deviceLabel)`, calls `setSession(bearer, user)`, then navigates to `#/`.

Reuse the canvas wordmark/logo from SignIn.tsx. Show errors inline (token expired, malformed, etc.). Auto-focus the token field. Pre-fill device name from `navigator.userAgent` heuristic (look for "Tesla" / "iPhone" / "Android" / otherwise default to "Web").

(The implementer should keep this file small — likely 80-120 lines including imports and the MUI layout.)

- [ ] **Step 4: Wire `/claim` route + redirect from root**

In `web/src/App.tsx`, add a route for `#/claim` rendering `Claim`. Replace the existing SignIn handling. On app boot, if `getUser()` is null → redirect to `/claim`. Delete `views/SignIn.tsx`, `views/AuthCallback.tsx`, `lib/auth.ts`, `lib/cloud-sync.ts` (these are Supabase-specific). DO NOT delete `web/src/storage.ts` outright — the `getSources()` / `setSources()` functions in there are used by other views and need to be repurposed (Task 9) to fetch from `/api/sources` instead of localStorage.

- [ ] **Step 5: Smoke**

```bash
# Server should already be running with admin claim token printed.
cd /c/github/passenger/web
npm run dev
```

Open the browser, you should land on `/claim`. Enter the token from `data/admin-claim-token.txt`. Should sign in and show Home (which will likely be empty until you pair a source). Hard refresh — should stay signed in.

- [ ] **Step 6: Commit**

```bash
cd /c/github/passenger
git add web/src/lib/session.ts web/src/views/Claim.tsx web/src/api.ts web/src/App.tsx
git rm web/src/views/SignIn.tsx web/src/views/AuthCallback.tsx web/src/lib/auth.ts web/src/lib/cloud-sync.ts
git commit -m "web: claim-token sign-in replaces Supabase; bearer auth on all API calls; x-sources header gone"
```

---

## Task 9: Frontend — Users admin UI + Devices section + sources refactor

**Files:**
- Create: `web/src/views/Users.tsx` (admin-only)
- Create: `web/src/views/Devices.tsx`
- Modify: `web/src/storage.ts` — drop the local source map; sources come from the server now
- Modify: existing views that read sources from localStorage (Settings → Sources, NowPlayingStrip, etc.) to fetch from `/api/sources`
- Modify: Settings nav to link to Users (admin-only) + Devices (per-user)

This task is the largest frontend touch. The implementer should:
1. Audit every callsite of `getSources()` / `setSources()` / `addSource()` / etc. in `web/src/`
2. Replace each with `api.listSources()` (cached at the app level — e.g., a `useSources()` React Query or simple useState/useEffect hook)
3. Make sure the pair-flow's "approval" path stops calling `setSources` (server now persists)

- [ ] **Step 1: Update `web/src/storage.ts`** — keep the type definitions (they're consumed by views), but replace local source persistence with a thin in-memory cache hydrated by `api.listSources()`. Or, simpler: delete the local source persistence entirely and have each view fetch on mount. Pick the pattern that matches existing conventions in the repo.

- [ ] **Step 2: Refactor every view that reads sources from localStorage**

Likely list (verify in the repo): `views/Pair.tsx`, `views/PhonePair.tsx`, `views/Settings.tsx` (Sources tab), `components/NowPlayingStrip.tsx`. For each, change the `getSources()` call to either:
- A direct `api.listSources()` call in a `useEffect`, OR
- Read from a top-level `<SourcesProvider>` context that calls `api.listSources()` once at app mount and refetches on window focus.

The context approach is cleaner for cross-cutting reads. If the existing app already has a similar provider for `getUser()`, follow that pattern.

- [ ] **Step 3: Write `views/Users.tsx`** — admin-only table of users with:
  - One row per user (label, role, deviceCount, sourceAccessCount, createdAt)
  - "Add user" button → modal with label input → on submit calls `api.adminCreateUser(label)`, shows the returned claim token prominently with a copy button
  - Per-row "Manage" expander showing:
    - Per-source-in-pool checkbox grid: granted (via `api.listSources` filtered to those the user has access to — but you don't have a direct "list user's accessible sources" endpoint; either add one OR include a `usersWithAccess: number[]` field on `GET /api/sources` for admin callers. The latter is simpler — extend the sources-mgmt list response in Task 5 for admin to include accessor user ids.)
    - "Delete user" button (admin row protects against self-delete with a confirm dialog)
    - "Regenerate claim token" button → calls `api.adminRegenerateClaim(userId)`, shows new token

The implementer may decide whether to add the `usersWithAccess` field on the sources list (preferred, minimal new API) OR add a new endpoint `GET /api/admin/users/:id/sources` returning the user's grants. If they go with the new endpoint, the server side needs a 1-line addition (this plan defers that decision to the implementer; either is acceptable).

- [ ] **Step 4: Write `views/Devices.tsx`** — the calling user's device list with revoke buttons. Calls `api.authMe()` to populate; per-row "Revoke" button calls `api.authRevokeDevice(id)` (the current device's revoke logs out and bounces to /claim).

- [ ] **Step 5: Add nav links**

Settings page (or wherever the existing Settings nav lives) gets two new links:
- "Users" — only rendered if `getUser()?.role === 'admin'`
- "Devices" — always rendered

- [ ] **Step 6: Smoke test**

Sign in as admin (using the claim token from data/). Add a user from the Users screen. Copy the claim token. Open an incognito window, navigate to canvas, enter that claim token. Should sign in as the new user. Both sessions visible from their respective Devices screen.

Pair a Plex source as admin. As member, the Sources view should NOT show it. Grant access from Users → Manage. Member's Sources view should now show it; the member can browse Home and play.

- [ ] **Step 7: Commit**

```bash
cd /c/github/passenger
git add web/src/views/Users.tsx web/src/views/Devices.tsx web/src/storage.ts \
        web/src/views/Pair.tsx web/src/views/PhonePair.tsx web/src/views/Settings.tsx \
        web/src/components/NowPlayingStrip.tsx web/src/App.tsx
git commit -m "web: Users admin UI + Devices section + sources fetched from server"
```

---

## Task 10: Frontend — drop Supabase dependency

**Files:**
- Modify: `web/package.json`
- Modify: `web/.env.example`
- Modify: any imports that still reference removed Supabase modules (none should remain after Task 8, but verify)

- [ ] **Step 1: Remove `@supabase/supabase-js`** from `web/package.json` dependencies. Also remove any Supabase-related devDependencies if present.

- [ ] **Step 2: Remove Supabase env vars** from `web/.env.example`:
- `VITE_SUPABASE_URL` → delete
- `VITE_SUPABASE_ANON_KEY` → delete

- [ ] **Step 3: `npm install` to update lockfile**

```bash
cd /c/github/passenger/web
npm install
```

This should remove `@supabase/supabase-js` from `node_modules`.

- [ ] **Step 4: Build + verify**

```bash
cd /c/github/passenger/web
npm run build
```

The build should succeed with no `@supabase/...` import errors. If any remain, find them via `grep -r '@supabase' src/` and remove them (they should have been excised in Task 8).

- [ ] **Step 5: Smoke test the full app**

Server + web both running. Sign in via claim. Pair Plex. Browse. Play. Hard refresh. Open Devices. Open Users (as admin). Add a new user. All should work without any Supabase calls (verify in network tab — only `localhost:8787` URLs).

- [ ] **Step 6: Commit**

```bash
cd /c/github/passenger
git add web/package.json web/package-lock.json web/.env.example
git commit -m "web: drop @supabase/supabase-js dependency and Supabase env vars"
```

---

## Task 11: README + final verification

**Files:**
- Modify: `server/README.md`
- Modify: `web/.env.example` — point at local server by default for self-hosted setups
- Verify: end-to-end success criteria from the spec

- [ ] **Step 1: Add "First run" section to `server/README.md`**

Insert near the top, after "Local dev":

````markdown
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
````

- [ ] **Step 2: Update `web/.env.example`** — recommend `http://localhost:8787` as the default for self-hosters:

```env
# Backend URL. For a self-hosted setup, point at your canvas server:
#   http://localhost:8787  (default when running `bun dev` in server/)
# For the hosted public canvas, your Cloudflare Worker URL:
#   https://canvas-api.<your-account>.workers.dev
VITE_CANVAS_API=http://localhost:8787
```

- [ ] **Step 3: Run full test suite + typecheck**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck

cd /c/github/passenger/web
npm run build
```

All tests pass. Build clean.

- [ ] **Step 4: Spec success-criteria walkthrough**

Manually verify each item from the spec's "Success criteria" section:

1. Fresh server boot → admin claim token in stdout + sentinel file.
2. `POST /api/auth/claim` with the token returns a bearer; auth'd requests succeed.
3. Admin creates a second user; that user's claim token works; member's bearer 403s on admin endpoints.
4. Admin pairs Plex; member doesn't see it until granted; after grant, member's `/api/sources` includes it.
5. Member pairs their own source; immediately sees it; admin sees it too in the admin source list.
6. Sub-project-A behavior preserved — verify by running `bun test` (all originally-passing tests should still pass) AND by running the canvas frontend end-to-end against the new server with a paired Plex.
7. `web/package.json` does not list `@supabase/supabase-js`.
8. Two devices paired to the same user see the same library on `/api/sources` after sign-in.

Mark each criterion DONE in your report. If any FAIL, stop and report instead of patching around.

- [ ] **Step 5: Commit**

```bash
cd /c/github/passenger
git add server/README.md web/.env.example
git commit -m "docs: first-run claim-token instructions + recommend localhost:8787 as default backend"
```

---

## Out of scope (do NOT do as part of this plan)

- Real-time push of source changes between devices (polling on focus is good enough for v1).
- Migrating data out of an existing Supabase user_sources blob (self-host is greenfield per instance).
- Per-library / per-folder access controls within a source.
- Admin rotation / demotion / multi-admin.
- Magic links, OAuth, passkeys.
- Server-side encryption of `sources.token` at rest.
- Production deployment, Docker image, frontend bundling — sub-projects C/D.
- Open-source release prep — sub-project E.
- Switching the deployed canvas to the new backend — that's a post-D decision.

---

## Notes for the SDD controller

- Task 6 and Task 7 both migrate sub-project-A routes; they're split because of size (Task 6 is browse/search, Task 7 is stream/status + pair). The migration pattern is identical (`parseXSources(c.req.raw)` → `getUserSources(getDb(), getAuthContext(c))` + convert the sub-app to a `makeXxxRoutes(getDb)` factory + adopt `requireUser` middleware in tests). The implementer can reuse pattern code freely.
- Tasks 8-10 are frontend. The frontend has no test infrastructure; verification is end-to-end smoke testing in a browser. Implementer reports should include a screencap or transcript of the smoke session.
- After Task 11, the branch's whole-branch review should focus heavily on the auth contract (no bearer leaks in logs, hashing is correct, admin singleton enforced both ways, ACL is honored on every route that returns user-scoped data).
