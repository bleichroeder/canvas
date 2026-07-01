import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { makePairRoutes } from './pair';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { getSource, listAllSources, userHasSourceAccess } from '../storage/sources';

async function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  // Drizzle's $client is the bun:sqlite Database — surface it so reapers / raw SQL work.
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'A', role: 'admin' });
  const bearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(bearer) });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/pair/*', requireUser(() => db));
  app.route('/api/pair', makePairRoutes(() => db));
  return { app, db, admin, bearer };
}

async function jsonPost(app: Hono, path: string, body: unknown, bearer?: string): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (bearer) headers['authorization'] = `Bearer ${bearer}`;
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }));
}

describe('pair routes', () => {
  let app: Hono;
  let db: Db;
  let admin: { id: number };
  let bearer: string;

  beforeEach(async () => { ({ app, db, admin, bearer } = await makeApp()); });

  test('returns 401 without authorization header', async () => {
    const res = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    expect(res.status).toBe(401);
  });

  test('POST /start (plex) returns a pin-shape code and ms expiresAt', async () => {
    const res = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    expect(res.status).toBe(200);
    const body = await res.json() as { code: string; expiresAt: number };
    expect(body.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    // expiresAt is ms-since-epoch, should be ~now + 10min.
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.expiresAt).toBeLessThan(Date.now() + 11 * 60 * 1000);
  });

  test('POST /start rejects invalid sourceType', async () => {
    const res = await jsonPost(app, '/api/pair/start', { sourceType: 'jellyfin' }, bearer);
    expect(res.status).toBe(400);
  });

  test('POST /start rejects missing sourceType', async () => {
    const res = await jsonPost(app, '/api/pair/start', {}, bearer);
    expect(res.status).toBe(400);
  });

  test('POST /poll returns pending + sourceType for a fresh plex session', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/poll', { code }, bearer);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; sourceType?: string };
    expect(body.status).toBe('pending');
    expect(body.sourceType).toBe('plex');
  });

  test('POST /poll returns { status: "expired" } for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/poll', { code: 'XXX-YYY' }, bearer);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('expired');
  });

  test('POST /poll rejects malformed code (400)', async () => {
    const res = await jsonPost(app, '/api/pair/poll', { code: 'not-a-pin' }, bearer);
    expect(res.status).toBe(400);
  });

  test('POST /approve returns 204, inserts source row, grants access, and /poll returns source.id', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };

    const apprRes = await jsonPost(app, '/api/pair/approve', {
      code, type: 'plex', baseUrl: 'http://server.local', token: 'tkn', label: 'My Plex',
    }, bearer);
    expect(apprRes.status).toBe(204);
    // 204 has no body — don't try to .json() it.
    expect(await apprRes.text()).toBe('');

    // Verify source row was inserted.
    // The DB increments from 1, so the first source should be id=1.
    const src = getSource(db, 1);
    expect(src).not.toBeNull();
    expect(src!.label).toBe('My Plex');
    expect(src!.type).toBe('plex');
    expect(src!.baseUrl).toBe('http://server.local');
    expect(src!.pairedByUserId).toBe(admin.id);

    // Verify access grant.
    expect(userHasSourceAccess(db, admin.id, 1)).toBe(true);

    // /poll returns approved source with id — token must be omitted.
    const pollRes = await jsonPost(app, '/api/pair/poll', { code }, bearer);
    const pollBody = await pollRes.json() as { status: string; source: Record<string, unknown> };
    expect(pollBody.status).toBe('approved');
    expect(pollBody.source.id).toBe(1);
    expect(pollBody.source.label).toBe('My Plex');
    expect(pollBody.source.type).toBe('plex');
    expect(pollBody.source.baseUrl).toBe('http://server.local');
    expect('token' in pollBody.source).toBe(false);
  });

  test('POST /poll approved response never exposes token', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    await jsonPost(app, '/api/pair/approve', {
      code, type: 'plex', baseUrl: 'http://server.local', token: 'secret-token', label: 'My Plex',
    }, bearer);
    const pollRes = await jsonPost(app, '/api/pair/poll', { code }, bearer);
    const pollBody = await pollRes.json() as { status: string; source: Record<string, unknown> };
    expect(pollBody.status).toBe('approved');
    expect('token' in pollBody.source).toBe(false);
    expect(pollBody.source.id).toBeDefined();
    expect(pollBody.source.label).toBe('My Plex');
  });

  test('POST /approve rejects invalid payload (missing label)', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/approve', {
      code, type: 'plex', baseUrl: 'http://server.local', token: 'tkn',
    }, bearer);
    expect(res.status).toBe(400);
  });

  test('POST /approve returns 410 for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/approve', {
      code: 'XXX-YYY', type: 'plex', baseUrl: 'http://x', token: 't', label: 'l',
    }, bearer);
    expect(res.status).toBe(410);
  });

  test('POST /approve is idempotent — second call is a 204 no-op with no extra source row', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    const approveBody = { code, type: 'plex', baseUrl: 'http://server.local', token: 'tkn', label: 'My Plex' };

    // First approve — should succeed.
    const first = await jsonPost(app, '/api/pair/approve', approveBody, bearer);
    expect(first.status).toBe(204);

    // Second approve with the same code — must also return 204 without creating a second source.
    const second = await jsonPost(app, '/api/pair/approve', approveBody, bearer);
    expect(second.status).toBe(204);

    // Only ONE source row must exist.
    const allSources = listAllSources(db);
    expect(allSources).toHaveLength(1);
    const onlySource = allSources[0];
    if (!onlySource) throw new Error('expected exactly one source row');

    // /poll must return the original source id.
    const pollRes = await jsonPost(app, '/api/pair/poll', { code }, bearer);
    const pollBody = await pollRes.json() as { status: string; source: { id: number } };
    expect(pollBody.status).toBe('approved');
    expect(pollBody.source.id).toBe(onlySource.id);
  });

  test('DELETE /:code returns 204 and removes the row', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    const delRes = await app.fetch(new Request(`http://test/api/pair/${code}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(delRes.status).toBe(204);
    const pollRes = await jsonPost(app, '/api/pair/poll', { code }, bearer);
    const pollBody = await pollRes.json() as { status: string };
    expect(pollBody.status).toBe('expired');
  });

  test('DELETE /:code rejects malformed code (400)', async () => {
    const res = await app.fetch(new Request('http://test/api/pair/not-a-pin', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(400);
  });

  test('POST /flixify-start returns 410 for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/flixify-start', { code: 'XXX-YYY' }, bearer);
    expect(res.status).toBe(410);
  });

  test('POST /flixify-start returns 400 when session sourceType is plex', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' }, bearer);
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/flixify-start', { code }, bearer);
    expect(res.status).toBe(400);
  });

  test('POST /flixify-poll returns { status: "expired" } for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/flixify-poll', { code: 'XXX-YYY' }, bearer);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('expired');
  });
});
