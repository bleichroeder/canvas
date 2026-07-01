import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeSubtitlesRoutes } from './subtitles';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource, grantSourceAccess } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';

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
  app.use('/api/subtitles', requireUser(() => db));
  app.route('/api/subtitles', makeSubtitlesRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('subtitles route', () => {
  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/subtitles'));
    expect(res.status).toBe(401);
  });

  test('400 when ?src missing', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/subtitles', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(400);
  });

  test('404 when srcKey not in DB sources', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/subtitles?src=999', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(404);
  });

  test('400 when plex source is missing partId', async () => {
    const { app, db, admin, bearer } = await makeApp();
    const source = createSource(db, {
      type: 'plex',
      baseUrl: 'http://x',
      token: 't',
      label: 'Test Plex',
      pairedByUserId: admin.id,
    });
    grantSourceAccess(db, admin.id, source.id);
    const res = await app.fetch(new Request(`http://test/api/subtitles?src=${source.id}&streamId=2`, {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(400);
  });
});
