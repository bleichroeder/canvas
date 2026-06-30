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
  sqlite.exec('PRAGMA foreign_keys = ON');
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
