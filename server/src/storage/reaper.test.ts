import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { startReaper } from './reaper';
import { createPairSession, getPairSession } from './pair-sessions';
import { createUser } from './users';
import { createClaimToken, getClaimToken } from './claim-tokens';
import { nowSec } from '../lib/time';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('startReaper', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('immediate tick sweeps already-expired rows', () => {
    createPairSession(db, {
      code: 'EXPIRED',
      type: 'plex',
      status: 'pending',
      payload: {},
      createdAt: 0,
      expiresAt: 1, // expired ages ago
    });
    const stop = startReaper(db);
    try {
      expect(getPairSession(db, 'EXPIRED')).toBeNull();
    } finally {
      stop();
    }
  });

  test('returned stop function clears the interval', () => {
    const stop = startReaper(db);
    expect(typeof stop).toBe('function');
    stop();
    // No assertion needed — clearInterval is silent. The test passes if it
    // doesn't hang on shutdown.
  });

  test('immediate tick sweeps expired unused claim tokens', () => {
    const userId = createUser(db, { label: 'A', role: 'admin' }).id;
    const t = createClaimToken(db, userId, 3600);
    // Force-expire the token in the past.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = ? WHERE token = ?')
      .run(nowSec() - 100, t.token);
    const stop = startReaper(db);
    try {
      expect(getClaimToken(db, t.token)).toBeNull();
    } finally {
      stop();
    }
  });
});
