import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeSearchRoutes } from './search';
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
  app.use('/api/search', requireUser(() => db));
  app.route('/api/search', makeSearchRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('search route', () => {
  test('empty q returns empty hits + errors immediately (no sources call)', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/search?q=', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { hits: unknown[]; errors: unknown[] };
    expect(body.hits).toEqual([]);
    expect(body.errors).toEqual([]);
  });

  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/search?q='));
    expect(res.status).toBe(401);
  });
});
