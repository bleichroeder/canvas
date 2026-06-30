import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeAuthRoutes } from './auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createClaimToken } from '../storage/claim-tokens';

function makeApp(): { app: Hono; db: Db } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const app = new Hono();
  app.onError(errorHandler);
  // makeAuthRoutes applies requireUser internally to /me, /logout, /devices/*
  app.route('/api/auth', makeAuthRoutes(() => db));
  return { app, db };
}

async function jsonPost(app: Hono, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }));
}

describe('auth routes', () => {
  let app: Hono; let db: Db;
  beforeEach(() => { ({ app, db } = makeApp()); });

  test('POST /claim with valid token returns bearer + user', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const res = await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Tesla' });
    expect(res.status).toBe(200);
    const body = await res.json() as { bearer: string; user: { role: string } };
    expect(body.bearer).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(body.user.role).toBe('admin');
  });

  test('POST /claim with invalid token returns 410', async () => {
    const res = await jsonPost(app, '/api/auth/claim', { token: 'bogus', deviceLabel: 'X' });
    expect(res.status).toBe(410);
  });

  test('POST /claim with missing deviceLabel returns 400', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const res = await jsonPost(app, '/api/auth/claim', { token: t.token });
    expect(res.status).toBe(400);
  });

  test('POST /claim token is single-use (second attempt 410)', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'X' });
    const res2 = await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Y' });
    expect(res2.status).toBe(410);
  });

  test('GET /me returns user + devices for an authenticated bearer', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'Tesla' })).json() as { bearer: string };
    const res = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { label: string }; devices: { label: string; current: boolean }[] };
    expect(body.user.label).toBe('A');
    expect(body.devices.length).toBe(1);
    expect(body.devices[0]!.current).toBe(true);
  });

  test('POST /logout revokes the calling bearer', async () => {
    const u = createUser(db, { label: 'A', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'X' })).json() as { bearer: string };
    const logoutRes = await jsonPost(app, '/api/auth/logout', {}, { authorization: `Bearer ${claim.bearer}` });
    expect(logoutRes.status).toBe(204);
    // /me with the same bearer is now 401.
    const meRes = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    expect(meRes.status).toBe(401);
  });
});
