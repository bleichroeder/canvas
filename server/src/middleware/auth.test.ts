import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { errorHandler } from './error-handler';
import { requireUser, requireAdmin, getAuthContext } from './auth';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { hashBearer, generateBearer } from '../lib/bearer';

async function makeFixture(role: 'admin' | 'member') {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const user = createUser(db, { label: 'U', role });
  const bearer = generateBearer();
  const tokenHash = await hashBearer(bearer);
  createDeviceSession(db, { userId: user.id, deviceLabel: 'D', tokenHash });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', requireUser(() => db));
  app.get('/echo', (c) => c.json(getAuthContext(c)));
  app.get('/admin', requireAdmin, (c) => c.json({ ok: true }));
  return { app, bearer };
}

describe('auth middleware', () => {
  test('401 when Authorization header missing', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo'));
    expect(res.status).toBe(401);
  });

  test('401 when Bearer scheme is wrong', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: 'Basic abc' } }));
    expect(res.status).toBe(401);
  });

  test('401 when token unknown', async () => {
    const { app } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: 'Bearer unknown' } }));
    expect(res.status).toBe(401);
  });

  test('200 + attaches auth context for valid bearer', async () => {
    const { app, bearer } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/echo', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { userId: number; role: string };
    expect(body.role).toBe('admin');
  });

  test('requireAdmin returns 403 for member', async () => {
    const { app, bearer } = await makeFixture('member');
    const res = await app.fetch(new Request('http://test/admin', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(403);
  });

  test('requireAdmin passes for admin', async () => {
    const { app, bearer } = await makeFixture('admin');
    const res = await app.fetch(new Request('http://test/admin', { headers: { authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(200);
  });
});
