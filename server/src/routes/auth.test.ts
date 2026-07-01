import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeAuthRoutes } from './auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser, setPasswordHash } from '../storage/users';
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

  test('POST /login with correct credentials returns bearer', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    setPasswordHash(db, u.id, await Bun.password.hash('correct-horse'));
    const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'correct-horse', deviceLabel: 'Desk' });
    expect(res.status).toBe(200);
    const body = await res.json() as { bearer: string; user: { hasPassword: boolean } };
    expect(body.bearer).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-/);
    expect(body.user.hasPassword).toBe(true);
  });

  test('POST /login with wrong password returns 401', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    setPasswordHash(db, u.id, await Bun.password.hash('correct-horse'));
    const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'nope', deviceLabel: 'Desk' });
    expect(res.status).toBe(401);
  });

  test('POST /login with unknown label returns 401', async () => {
    const res = await jsonPost(app, '/api/auth/login', { label: 'nobody', password: 'x', deviceLabel: 'Desk' });
    expect(res.status).toBe(401);
  });

  test('POST /login when user has no password returns 400', async () => {
    createUser(db, { label: 'Alice', role: 'admin' });
    const res = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'x', deviceLabel: 'Desk' });
    expect(res.status).toBe(400);
  });

  test('POST /set-password sets initial password; second call returns 409', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
    const res1 = await jsonPost(app, '/api/auth/set-password', { newPassword: 'longenough' }, { authorization: `Bearer ${claim.bearer}` });
    expect(res1.status).toBe(204);
    const res2 = await jsonPost(app, '/api/auth/set-password', { newPassword: 'anotherlongone' }, { authorization: `Bearer ${claim.bearer}` });
    expect(res2.status).toBe(409);
  });

  test('POST /set-password rejects short passwords', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
    const res = await jsonPost(app, '/api/auth/set-password', { newPassword: 'short' }, { authorization: `Bearer ${claim.bearer}` });
    expect(res.status).toBe(400);
  });

  test('POST /change-password verifies current + revokes other devices', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    setPasswordHash(db, u.id, await Bun.password.hash('oldpassword'));

    // Sign in twice — two different bearers on two "devices"
    const loginA = await (await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'A' })).json() as { bearer: string };
    const loginB = await (await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'B' })).json() as { bearer: string };

    // Change password from device A
    const chRes = await jsonPost(app, '/api/auth/change-password', { currentPassword: 'oldpassword', newPassword: 'newerpassword' }, { authorization: `Bearer ${loginA.bearer}` });
    expect(chRes.status).toBe(204);

    // Device A's bearer still works
    const meA = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${loginA.bearer}` } }));
    expect(meA.status).toBe(200);
    // Device B is revoked
    const meB = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${loginB.bearer}` } }));
    expect(meB.status).toBe(401);

    // Old password no longer works
    const loginOld = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'oldpassword', deviceLabel: 'C' });
    expect(loginOld.status).toBe(401);
    // New password works
    const loginNew = await jsonPost(app, '/api/auth/login', { label: 'Alice', password: 'newerpassword', deviceLabel: 'C' });
    expect(loginNew.status).toBe(200);
  });

  test('GET /me includes hasPassword', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const claim = await (await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' })).json() as { bearer: string };
    const meRes1 = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    const me1 = await meRes1.json() as { user: { hasPassword: boolean } };
    expect(me1.user.hasPassword).toBe(false);
    await jsonPost(app, '/api/auth/set-password', { newPassword: 'longenough' }, { authorization: `Bearer ${claim.bearer}` });
    const meRes2 = await app.fetch(new Request('http://test/api/auth/me', { headers: { authorization: `Bearer ${claim.bearer}` } }));
    const me2 = await meRes2.json() as { user: { hasPassword: boolean } };
    expect(me2.user.hasPassword).toBe(true);
  });

  test('POST /claim includes hasPassword in response', async () => {
    const u = createUser(db, { label: 'Alice', role: 'admin' });
    const t = createClaimToken(db, u.id, 3600);
    const res = await jsonPost(app, '/api/auth/claim', { token: t.token, deviceLabel: 'D' });
    const body = await res.json() as { bearer: string; user: { hasPassword: boolean } };
    expect(body.user.hasPassword).toBe(false);
  });
});
