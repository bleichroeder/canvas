import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeProgressRoutes } from './progress';
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
  app.use('/api/progress/*', requireUser(() => db));
  app.route('/api/progress', makeProgressRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('progress route', () => {
  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/progress/1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ posSec: 30 }),
    }));
    expect(res.status).toBe(401);
  });

  test('400 when posSec missing', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/progress/1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  test('400 when body is malformed JSON', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/progress/1/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: 'not-json',
    }));
    expect(res.status).toBe(400);
  });

  test('502 when srcKey not in DB sources', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/progress/999/abc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ posSec: 30 }),
    }));
    expect(res.status).toBe(502);
  });
});
