import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeLibraryRoutes } from './library';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
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
  app.use('/api/library/*', requireUser(() => db));
  app.route('/api/library', makeLibraryRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('library route', () => {
  test('returns 502 when srcKey is not in DB sources', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/library/999', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/source not paired/);
  });

  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/library/1'));
    expect(res.status).toBe(401);
  });
});
