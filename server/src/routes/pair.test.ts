import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { makePairRoutes } from './pair';
import { errorHandler } from '../middleware/error-handler';

function makeApp(): { app: Hono; db: Db } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  // Drizzle's $client is the bun:sqlite Database — surface it so reapers / raw SQL work.
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/pair', makePairRoutes(() => db));
  return { app, db };
}

async function jsonPost(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('pair routes', () => {
  let app: Hono;

  beforeEach(() => { ({ app } = makeApp()); });

  test('POST /start (plex) returns a pin-shape code and ms expiresAt', async () => {
    const res = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    expect(res.status).toBe(200);
    const body = await res.json() as { code: string; expiresAt: number };
    expect(body.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    // expiresAt is ms-since-epoch, should be ~now + 10min.
    expect(body.expiresAt).toBeGreaterThan(Date.now());
    expect(body.expiresAt).toBeLessThan(Date.now() + 11 * 60 * 1000);
  });

  test('POST /start rejects invalid sourceType', async () => {
    const res = await jsonPost(app, '/api/pair/start', { sourceType: 'jellyfin' });
    expect(res.status).toBe(400);
  });

  test('POST /start rejects missing sourceType', async () => {
    const res = await jsonPost(app, '/api/pair/start', {});
    expect(res.status).toBe(400);
  });

  test('POST /poll returns pending + sourceType for a fresh plex session', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/poll', { code });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; sourceType?: string };
    expect(body.status).toBe('pending');
    expect(body.sourceType).toBe('plex');
  });

  test('POST /poll returns { status: "expired" } for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/poll', { code: 'XXX-YYY' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('expired');
  });

  test('POST /poll rejects malformed code (400)', async () => {
    const res = await jsonPost(app, '/api/pair/poll', { code: 'not-a-pin' });
    expect(res.status).toBe(400);
  });

  test('POST /approve returns 204 and /poll reflects approved source', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    const { code } = await startRes.json() as { code: string };

    const apprRes = await jsonPost(app, '/api/pair/approve', {
      code, type: 'plex', baseUrl: 'http://server.local', token: 'tkn', label: 'My Plex',
    });
    expect(apprRes.status).toBe(204);
    // 204 has no body — don't try to .json() it.
    expect(await apprRes.text()).toBe('');

    const pollRes = await jsonPost(app, '/api/pair/poll', { code });
    const pollBody = await pollRes.json() as { status: string; source: { label: string; type: string; baseUrl: string } };
    expect(pollBody.status).toBe('approved');
    expect(pollBody.source.label).toBe('My Plex');
    expect(pollBody.source.type).toBe('plex');
    expect(pollBody.source.baseUrl).toBe('http://server.local');
  });

  test('POST /approve rejects invalid payload (missing label)', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/approve', {
      code, type: 'plex', baseUrl: 'http://server.local', token: 'tkn',
    });
    expect(res.status).toBe(400);
  });

  test('POST /approve returns 410 for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/approve', {
      code: 'XXX-YYY', type: 'plex', baseUrl: 'http://x', token: 't', label: 'l',
    });
    expect(res.status).toBe(410);
  });

  test('DELETE /:code returns 204 and removes the row', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    const { code } = await startRes.json() as { code: string };
    const delRes = await app.fetch(new Request(`http://test/api/pair/${code}`, { method: 'DELETE' }));
    expect(delRes.status).toBe(204);
    const pollRes = await jsonPost(app, '/api/pair/poll', { code });
    const pollBody = await pollRes.json() as { status: string };
    expect(pollBody.status).toBe('expired');
  });

  test('DELETE /:code rejects malformed code (400)', async () => {
    const res = await app.fetch(new Request('http://test/api/pair/not-a-pin', { method: 'DELETE' }));
    expect(res.status).toBe(400);
  });

  test('POST /flixify-start returns 410 for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/flixify-start', { code: 'XXX-YYY' });
    expect(res.status).toBe(410);
  });

  test('POST /flixify-start returns 400 when session sourceType is plex', async () => {
    const startRes = await jsonPost(app, '/api/pair/start', { sourceType: 'plex' });
    const { code } = await startRes.json() as { code: string };
    const res = await jsonPost(app, '/api/pair/flixify-start', { code });
    expect(res.status).toBe(400);
  });

  test('POST /flixify-poll returns { status: "expired" } for unknown code', async () => {
    const res = await jsonPost(app, '/api/pair/flixify-poll', { code: 'XXX-YYY' });
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('expired');
  });
});
