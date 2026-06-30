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
  sqlite.exec('PRAGMA foreign_keys = ON');
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
    // Consume t2 while still valid (now it has used_at set).
    const consumed = consumeClaimToken(db, t2.token);
    expect(consumed).not.toBeNull();
    // Now expire both tokens.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = ?')
      .run(nowSec() - 100);
    // Reap: t1 (expired, unused) should be deleted; t2 (expired, used) should be kept.
    const deleted = reapClaimTokens(db);
    expect(deleted).toBe(1);
    expect(getClaimToken(db, t1.token)).toBeNull();
    expect(getClaimToken(db, t2.token)).not.toBeNull();
  });
});
