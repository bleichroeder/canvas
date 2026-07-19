import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from './users';
import { listFollows, addFollow, removeFollow } from './youtube-follows';

function fixture() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const u1 = createUser(db, { label: 'U1', role: 'admin' });
  const u2 = createUser(db, { label: 'U2', role: 'member' });
  return { db, u1, u2 };
}

describe('youtube-follows storage', () => {
  test('add then list returns the follow', () => {
    const { db, u1 } = fixture();
    const f = addFollow(db, u1.id, { kind: 'channel', ytId: 'UCabc', title: 'A Channel', thumbnail: 't://c' });
    expect(f).toMatchObject({ userId: u1.id, kind: 'channel', ytId: 'UCabc', title: 'A Channel', thumbnail: 't://c' });
    const list = listFollows(db, u1.id);
    expect(list.map((r) => r.ytId)).toEqual(['UCabc']);
  });

  test('is idempotent on (user, kind, ytId)', () => {
    const { db, u1 } = fixture();
    const a = addFollow(db, u1.id, { kind: 'playlist', ytId: 'PL1', title: 'List' });
    const b = addFollow(db, u1.id, { kind: 'playlist', ytId: 'PL1', title: 'List (again)' });
    expect(b.id).toBe(a.id);              // same row
    expect(b.title).toBe('List');         // original title kept, not overwritten
    expect(listFollows(db, u1.id)).toHaveLength(1);
  });

  test('same ytId under a different kind is a distinct follow', () => {
    const { db, u1 } = fixture();
    addFollow(db, u1.id, { kind: 'channel', ytId: 'X', title: 'c' });
    addFollow(db, u1.id, { kind: 'playlist', ytId: 'X', title: 'p' });
    expect(listFollows(db, u1.id)).toHaveLength(2);
  });

  test('follows are per-user isolated', () => {
    const { db, u1, u2 } = fixture();
    addFollow(db, u1.id, { kind: 'channel', ytId: 'UC1', title: 'one' });
    addFollow(db, u2.id, { kind: 'channel', ytId: 'UC2', title: 'two' });
    expect(listFollows(db, u1.id).map((r) => r.ytId)).toEqual(['UC1']);
    expect(listFollows(db, u2.id).map((r) => r.ytId)).toEqual(['UC2']);
  });

  test('remove deletes only the owner\'s follow', () => {
    const { db, u1, u2 } = fixture();
    const f = addFollow(db, u1.id, { kind: 'channel', ytId: 'UC1', title: 'one' });
    expect(removeFollow(db, u2.id, f.id)).toBe(false);   // not u2's
    expect(listFollows(db, u1.id)).toHaveLength(1);
    expect(removeFollow(db, u1.id, f.id)).toBe(true);
    expect(listFollows(db, u1.id)).toHaveLength(0);
    expect(removeFollow(db, u1.id, f.id)).toBe(false);   // already gone
  });
});
