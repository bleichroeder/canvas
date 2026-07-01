import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser, getUser, getUserByLabel, listUsers, deleteUser, countAdmins, setPasswordHash, getPasswordHash } from './users';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
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

  test('setPasswordHash + getPasswordHash round trip', () => {
    const u = createUser(db, { label: 'X', role: 'member' });
    expect(getPasswordHash(db, u.id)).toBeNull();
    setPasswordHash(db, u.id, 'argon2-hash-here');
    expect(getPasswordHash(db, u.id)).toBe('argon2-hash-here');
  });
});
