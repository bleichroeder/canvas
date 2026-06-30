import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makePlayRoutes, parseFromSecParam } from './play';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource, grantSourceAccess } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function stubAdapter(type: 'plex' | 'flixify', overrides: Partial<SourceAdapter>): SourceAdapter {
  return {
    type,
    startPair: async () => ({ pairUrl: '', expiresAt: 0 }),
    home: async () => [],
    search: async () => [],
    library: async () => ({ breadcrumbs: [], items: [] }),
    item: async () => { throw new Error('not implemented'); },
    resolveStream: async () => { throw new Error('not implemented'); },
    saveProgress: async () => {},
    ...overrides,
  };
}

async function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const admin = createUser(db, { label: 'A', role: 'admin' });
  const bearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(bearer) });
  const app = new Hono();
  app.onError(errorHandler);
  app.use('/api/play/*', requireUser(() => db));
  app.route('/api/play', makePlayRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('parseFromSecParam', () => {
  test('null and empty → undefined', () => {
    expect(parseFromSecParam(null)).toBeUndefined();
    expect(parseFromSecParam('')).toBeUndefined();
  });
  test('positive integer pass-through', () => {
    expect(parseFromSecParam('42')).toBe(42);
  });
  test('floor for fractional', () => {
    expect(parseFromSecParam('42.7')).toBe(42);
  });
  test('negative → undefined', () => {
    expect(parseFromSecParam('-1')).toBeUndefined();
  });
  test('NaN → undefined', () => {
    expect(parseFromSecParam('abc')).toBeUndefined();
  });
});

describe('play route', () => {
  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/play/1/abc', { method: 'POST' }));
    expect(res.status).toBe(401);
  });

  test('502 when srcKey is not in DB sources', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/play/999/123', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/source not paired/);
  });

  test('subtitleTracks URLs are tagged with ?src=<srcKey>', async () => {
    const { app, db, admin, bearer } = await makeApp();
    registerAdapter(stubAdapter('plex', {
      resolveStream: async () => ({
        url: 'http://stream/url',
        durationSec: 100,
        subtitleTracks: [
          { id: 's1', url: '/api/subtitles?partId=1&streamId=2', format: 'vtt' },
          { id: 's2', url: '/api/subtitles', format: 'vtt' },
        ],
      }),
    }));
    const source = createSource(db, {
      type: 'plex',
      baseUrl: 'http://x',
      token: 't',
      label: 'Test Plex',
      pairedByUserId: admin.id,
    });
    grantSourceAccess(db, admin.id, source.id);
    const srcKey = String(source.id);
    const res = await app.fetch(new Request(`http://test/api/play/${srcKey}/abc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { subtitleTracks: { url: string }[] };
    const [t0, t1] = body.subtitleTracks;
    expect(t0!.url).toBe(`/api/subtitles?partId=1&streamId=2&src=${srcKey}`);
    expect(t1!.url).toBe(`/api/subtitles?src=${srcKey}`);
  });
});
