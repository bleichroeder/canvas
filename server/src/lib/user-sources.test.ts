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
  sqlite.exec('PRAGMA foreign_keys = ON');
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
    const _s2 = createSource(db, { type: 'plex', baseUrl: 'http://2', token: 't', label: 'S2', pairedByUserId: admin.id });
    grantSourceAccess(db, member.id, s1.id);
    const map = getUserSources(db, { userId: member.id, role: 'member', deviceTokenHash: '' });
    expect(Object.keys(map)).toEqual([String(s1.id)]);
  });
});
