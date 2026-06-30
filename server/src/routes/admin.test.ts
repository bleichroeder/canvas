import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeAdminRoutes } from './admin';
import { requireUser, requireAdmin } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';

async function makeAuthedFixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'Admin', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'A', tokenHash: await hashBearer(adminBearer) });
  const member = createUser(db, { label: 'M', role: 'member' });
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: member.id, deviceLabel: 'M', tokenHash: await hashBearer(memberBearer) });

  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminRoutes(() => db));
  return { app, db, admin, member, adminBearer, memberBearer };
}

function jsonReq(path: string, method: string, body: unknown, bearer: string): Request {
  return new Request(`http://test${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('admin routes', () => {
  test('GET /users lists admin + member with counts', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'GET', undefined, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { label: string; role: string; deviceCount: number }[];
    expect(body.length).toBe(2);
    expect(body.find((u) => u.role === 'admin')?.deviceCount).toBe(1);
  });

  test('GET /users from a member returns 403', async () => {
    const { app, memberBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'GET', undefined, memberBearer));
    expect(res.status).toBe(403);
  });

  test('POST /users creates a member + claim token', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: 'Kid' }, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { label: string; role: string }; claimToken: string };
    expect(body.user.label).toBe('Kid');
    expect(body.user.role).toBe('member');
    expect(body.claimToken).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
  });

  test('POST /users rejects empty label', async () => {
    const { app, adminBearer } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq('/api/admin/users', 'POST', { label: '' }, adminBearer));
    expect(res.status).toBe(400);
  });

  test('DELETE /users/:id refuses to delete self (admin)', async () => {
    const { app, adminBearer, admin } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${admin.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(409);
  });

  test('DELETE /users/:id removes a member', async () => {
    const { app, adminBearer, member } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(204);
  });

  test('POST /users/:id/claim-token regenerates', async () => {
    const { app, adminBearer, member } = await makeAuthedFixture();
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/claim-token`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(200);
    const body = await res.json() as { claimToken: string };
    expect(body.claimToken).toMatch(/^[A-Z0-9]{4}-/);
  });

  test('POST /users/:userId/sources/:sourceId grants access', async () => {
    const { app, adminBearer, member, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(204);
  });

  test('POST grant on admin returns 409 (implicit access)', async () => {
    const { app, adminBearer, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    const res = await app.fetch(jsonReq(`/api/admin/users/${admin.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    expect(res.status).toBe(409);
  });

  test('DELETE grant revokes access', async () => {
    const { app, adminBearer, member, admin, db } = await makeAuthedFixture();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    // Grant first.
    await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'POST', undefined, adminBearer));
    const res = await app.fetch(jsonReq(`/api/admin/users/${member.id}/sources/${s.id}`, 'DELETE', undefined, adminBearer));
    expect(res.status).toBe(204);
  });
});
