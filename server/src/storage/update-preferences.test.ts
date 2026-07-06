import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { getUpdatePreferences, setUpdatePreferences } from './update-preferences';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('update-preferences storage', () => {
  test('first read seeds the singleton with defaults', () => {
    const db = makeDb();
    const prefs = getUpdatePreferences(db);
    expect(prefs.autoUpdate).toBe(false);
    expect(prefs.lastAutoCheckAt).toBeNull();
  });

  test('set autoUpdate persists', () => {
    const db = makeDb();
    setUpdatePreferences(db, { autoUpdate: true });
    expect(getUpdatePreferences(db).autoUpdate).toBe(true);
  });

  test('set lastAutoCheckAt persists', () => {
    const db = makeDb();
    setUpdatePreferences(db, { lastAutoCheckAt: 12345 });
    expect(getUpdatePreferences(db).lastAutoCheckAt).toBe(12345);
  });

  test('partial patch leaves other fields alone', () => {
    const db = makeDb();
    setUpdatePreferences(db, { autoUpdate: true, lastAutoCheckAt: 100 });
    setUpdatePreferences(db, { autoUpdate: false });
    const prefs = getUpdatePreferences(db);
    expect(prefs.autoUpdate).toBe(false);
    expect(prefs.lastAutoCheckAt).toBe(100);
  });

  test('empty patch is a no-op', () => {
    const db = makeDb();
    setUpdatePreferences(db, { autoUpdate: true });
    setUpdatePreferences(db, {});
    expect(getUpdatePreferences(db).autoUpdate).toBe(true);
  });
});
