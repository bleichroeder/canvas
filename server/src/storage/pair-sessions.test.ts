import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import {
  createPairSession, getPairSession, deletePairSession, reapPairSessions,
  setPairSessionStatus, updatePairSessionPayload,
} from './pair-sessions';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  runMigrations(db);
  return db;
}

describe('pair-sessions storage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('round-trips a session', () => {
    const created = createPairSession(db, {
      code: 'ABC-123',
      type: 'plex',
      status: 'pending',
      payload: {},
      createdAt: 1000,
      expiresAt: 1600,
    });
    expect(created.code).toBe('ABC-123');
    expect(getPairSession(db, 'ABC-123')).toEqual(created);
  });

  test('returns null for missing code', () => {
    expect(getPairSession(db, 'NOPE')).toBeNull();
  });

  test('updates payload and status', () => {
    createPairSession(db, {
      code: 'X', type: 'flixify', status: 'pending', payload: { pin: '123' },
      createdAt: 1000, expiresAt: 1600,
    });
    updatePairSessionPayload(db, 'X', { pin: '456', extra: 'hello' });
    setPairSessionStatus(db, 'X', 'approved');
    const row = getPairSession(db, 'X');
    expect(row?.payload).toEqual({ pin: '456', extra: 'hello' });
    expect(row?.status).toBe('approved');
  });

  test('delete removes the row', () => {
    createPairSession(db, {
      code: 'D', type: 'plex', status: 'pending', payload: {},
      createdAt: 1, expiresAt: 2,
    });
    deletePairSession(db, 'D');
    expect(getPairSession(db, 'D')).toBeNull();
  });

  test('reaper removes only expired rows', () => {
    createPairSession(db, {
      code: 'old', type: 'plex', status: 'pending', payload: {},
      createdAt: 1, expiresAt: 100,
    });
    createPairSession(db, {
      code: 'new', type: 'plex', status: 'pending', payload: {},
      createdAt: 1, expiresAt: 10_000,
    });
    const reaped = reapPairSessions(db, 500);
    expect(reaped).toBe(1);
    expect(getPairSession(db, 'old')).toBeNull();
    expect(getPairSession(db, 'new')).not.toBeNull();
  });
});
