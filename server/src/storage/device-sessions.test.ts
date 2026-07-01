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
  sqlite.exec('PRAGMA foreign_keys = ON');
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

  test('touchDeviceSession bumps lastSeenAt', () => {
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
