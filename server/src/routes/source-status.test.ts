import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { errorHandler } from '../middleware/error-handler';
import { requireUser } from '../middleware/auth';
import { makeSourceStatusRoutes } from './source-status';
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
  app.use('/api/source-status', requireUser(() => db));
  app.route('/api/source-status', makeSourceStatusRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('source-status route', () => {
  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/source-status'));
    expect(res.status).toBe(401);
  });

  test('400 when ?key missing', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/source-status', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(400);
  });

  test('404 when key not in DB sources', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/source-status?key=999', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(404);
  });

  test('returns { status: "lan-only" } for an RFC1918 baseUrl', async () => {
    const { app, db, admin, bearer } = await makeApp();
    const source = createSource(db, {
      type: 'plex',
      baseUrl: 'http://192.168.1.10:32400',
      token: 't',
      label: 'LAN Plex',
      pairedByUserId: admin.id,
    });
    grantSourceAccess(db, admin.id, source.id);
    const key = String(source.id);
    const res = await app.fetch(new Request(`http://test/api/source-status?key=${key}`, {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; lastSeenAt: null };
    expect(body.status).toBe('lan-only');
    expect(body.lastSeenAt).toBeNull();
  });

  test('returns { status: "lan-only" } for plex.direct LAN encoding', async () => {
    const { app, db, admin, bearer } = await makeApp();
    const source = createSource(db, {
      type: 'plex',
      baseUrl: 'https://10-0-15-100.deadbeef.plex.direct:32400',
      token: 't',
      label: 'LAN Plex Direct',
      pairedByUserId: admin.id,
    });
    grantSourceAccess(db, admin.id, source.id);
    const key = String(source.id);
    const res = await app.fetch(new Request(`http://test/api/source-status?key=${key}`, {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    const body = await res.json() as { status: string };
    expect(body.status).toBe('lan-only');
  });
});
