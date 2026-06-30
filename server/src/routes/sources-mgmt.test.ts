import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeSourcesMgmtRoutes } from './sources-mgmt';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource, grantSourceAccess } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';

async function makeFixture() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'A', role: 'admin' });
  const member = createUser(db, { label: 'M', role: 'member' });
  const adminBearer = generateBearer();
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'a', tokenHash: await hashBearer(adminBearer) });
  createDeviceSession(db, { userId: member.id, deviceLabel: 'm', tokenHash: await hashBearer(memberBearer) });
  const s1 = createSource(db, { type: 'plex', baseUrl: 'http://1', token: 't', label: 'S1', pairedByUserId: admin.id });
  const s2 = createSource(db, { type: 'plex', baseUrl: 'http://2', token: 't', label: 'S2', pairedByUserId: member.id });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/sources/*', requireUser(() => db));
  app.use('/api/sources', requireUser(() => db));
  app.route('/api/sources', makeSourcesMgmtRoutes(() => db));
  return { app, db, admin, member, adminBearer, memberBearer, s1, s2 };
}

describe('sources-mgmt routes', () => {
  test('GET / for admin sees both sources', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${adminBearer}` } }));
    const body = await res.json() as { label: string }[];
    expect(body.length).toBe(2);
  });

  test('GET / for member sees only their accessible (s2 was paired by them, but not yet granted)', async () => {
    const { app, memberBearer } = await makeFixture();
    // member paired s2 but no grant exists yet — they don't see s2 (the pair flow in T7 will auto-grant).
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await res.json() as unknown[];
    expect(body.length).toBe(0);
  });

  test('GET / for member sees s1 after grant', async () => {
    const { app, db, member, s1, memberBearer } = await makeFixture();
    grantSourceAccess(db, member.id, s1.id);
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await res.json() as { label: string }[];
    expect(body.map((b) => b.label)).toEqual(['S1']);
  });

  test('DELETE /:id by admin removes any source', async () => {
    const { app, adminBearer, s2 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s2.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${adminBearer}` } }));
    expect(res.status).toBe(204);
  });

  test('DELETE /:id by member on someone else\'s source returns 403', async () => {
    const { app, memberBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberBearer}` } }));
    expect(res.status).toBe(403);
  });

  test('DELETE /:id by member on their own paired source returns 204', async () => {
    const { app, memberBearer, s2 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s2.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${memberBearer}` } }));
    expect(res.status).toBe(204);
  });

  test('DELETE /:id on unknown returns 404', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources/9999', { method: 'DELETE', headers: { authorization: `Bearer ${adminBearer}` } }));
    expect(res.status).toBe(404);
  });

  test('source.token is NEVER returned in GET listing', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${adminBearer}` } }));
    const body = await res.json() as Record<string, unknown>[];
    for (const row of body) {
      expect('token' in row).toBe(false);
    }
  });

  test('GET / for admin includes usersWithAccess on each source', async () => {
    const { app, db, member, s1, adminBearer } = await makeFixture();
    grantSourceAccess(db, member.id, s1.id);
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${adminBearer}` } }));
    const body = await res.json() as { id: number; usersWithAccess?: number[] }[];
    const s1Row = body.find((r) => r.id === s1.id);
    expect(s1Row).toBeDefined();
    expect(Array.isArray(s1Row!.usersWithAccess)).toBe(true);
    expect(s1Row!.usersWithAccess).toContain(member.id);
  });

  test('GET / for member does NOT include usersWithAccess', async () => {
    const { app, db, member, s1, memberBearer } = await makeFixture();
    grantSourceAccess(db, member.id, s1.id);
    const res = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await res.json() as Record<string, unknown>[];
    for (const row of body) {
      expect('usersWithAccess' in row).toBe(false);
    }
  });
});
