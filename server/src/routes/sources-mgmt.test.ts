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

  test('POST / adds a tokenless YouTube source and grants the creator', async () => {
    const { app, memberBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', {
      method: 'POST',
      headers: { authorization: `Bearer ${memberBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'youtube' }),
    }));
    expect(res.status).toBe(201);
    const created = await res.json() as { id: number; type: string; label: string; baseUrl: string };
    expect(created).toMatchObject({ type: 'youtube', label: 'YouTube', baseUrl: '' });
    // Creator was granted access, so it now shows in their listing.
    const list = await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }));
    const body = await list.json() as { type: string }[];
    expect(body.some((b) => b.type === 'youtube')).toBe(true);
  });

  test('POST / is idempotent — a second YouTube add returns the existing source', async () => {
    const { app, memberBearer } = await makeFixture();
    const first = await app.fetch(new Request('http://test/api/sources', {
      method: 'POST', headers: { authorization: `Bearer ${memberBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'youtube' }),
    }));
    expect(first.status).toBe(201);
    const a = await first.json() as { id: number };
    const second = await app.fetch(new Request('http://test/api/sources', {
      method: 'POST', headers: { authorization: `Bearer ${memberBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'youtube' }),
    }));
    expect(second.status).toBe(200);
    const b = await second.json() as { id: number };
    expect(b.id).toBe(a.id);
    // Only one YouTube source in the member's listing.
    const list = await (await app.fetch(new Request('http://test/api/sources', { headers: { authorization: `Bearer ${memberBearer}` } }))).json() as { type: string }[];
    expect(list.filter((s) => s.type === 'youtube')).toHaveLength(1);
  });

  test('POST / with a custom label uses it', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'youtube', label: 'Family YouTube' }),
    }));
    const created = await res.json() as { label: string };
    expect(created.label).toBe('Family YouTube');
  });

  test('POST / rejects pairing-based types (plex) with 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'plex', baseUrl: 'http://x', token: 't' }),
    }));
    expect(res.status).toBe(400);
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

  test('PATCH /:id by admin updates label and baseUrl', async () => {
    const { app, adminBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'renamed', baseUrl: 'http://plex:32400' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { label: string; baseUrl: string };
    expect(body.label).toBe('renamed');
    expect(body.baseUrl).toBe('http://plex:32400');
  });

  test('PATCH /:id strips trailing slash from baseUrl', async () => {
    const { app, adminBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'http://plex:32400///' }),
    }));
    const body = await res.json() as { baseUrl: string };
    expect(body.baseUrl).toBe('http://plex:32400');
  });

  test('PATCH /:id by member on their own paired source succeeds', async () => {
    const { app, memberBearer, s2 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s2.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${memberBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'my rename' }),
    }));
    expect(res.status).toBe(200);
  });

  test('PATCH /:id by member on someone else\'s source returns 403', async () => {
    const { app, memberBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${memberBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'nope' }),
    }));
    expect(res.status).toBe(403);
  });

  test('PATCH /:id with invalid baseUrl returns 400', async () => {
    const { app, adminBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'not a url' }),
    }));
    expect(res.status).toBe(400);
  });

  test('PATCH /:id with empty body returns 400', async () => {
    const { app, adminBearer, s1 } = await makeFixture();
    const res = await app.fetch(new Request(`http://test/api/sources/${s1.id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  test('PATCH /:id on unknown returns 404', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/sources/9999', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'x' }),
    }));
    expect(res.status).toBe(404);
  });
});
