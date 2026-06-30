import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { getSourceStatus, putSourceStatus, reapSourceStatus } from './source-status';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  runMigrations(db);
  return db;
}

describe('source-status storage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('upserts and reads back', () => {
    putSourceStatus(db, {
      sourceKey: 'plex1',
      status: 'ok',
      lastSeenAt: 500,
      expiresAt: 1000,
      payload: { reachable: true },
    });
    const row = getSourceStatus(db, 'plex1');
    expect(row?.status).toBe('ok');
    expect(row?.payload).toEqual({ reachable: true });
  });

  test('upsert replaces existing row', () => {
    putSourceStatus(db, {
      sourceKey: 'k', status: 'ok', expiresAt: 1, payload: {},
    });
    putSourceStatus(db, {
      sourceKey: 'k', status: 'degraded', expiresAt: 999, payload: { x: 1 },
    });
    const row = getSourceStatus(db, 'k');
    expect(row?.status).toBe('degraded');
    expect(row?.expiresAt).toBe(999);
  });

  test('reaper removes only expired rows', () => {
    putSourceStatus(db, { sourceKey: 'old', status: 'ok', expiresAt: 100, payload: {} });
    putSourceStatus(db, { sourceKey: 'new', status: 'ok', expiresAt: 10_000, payload: {} });
    expect(reapSourceStatus(db, 500)).toBe(1);
    expect(getSourceStatus(db, 'old')).toBeNull();
    expect(getSourceStatus(db, 'new')).not.toBeNull();
  });
});
