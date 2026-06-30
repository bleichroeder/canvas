import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import { runMigrations } from '../db/migrate';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { errorHandler } from '../middleware/error-handler';
import { makeSourceStatusRoutes } from './source-status';

function makeApp(): { app: Hono; db: Db } {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/source-status', makeSourceStatusRoutes(() => db));
  return { app, db };
}

describe('source-status route', () => {
  let app: Hono;
  beforeEach(() => { ({ app } = makeApp()); });

  test('400 when ?key missing', async () => {
    const res = await app.fetch(new Request('http://test/api/source-status'));
    expect(res.status).toBe(400);
  });

  test('404 when key not in x-sources', async () => {
    const res = await app.fetch(new Request('http://test/api/source-status?key=missing'));
    expect(res.status).toBe(404);
  });

  test('returns { status: "lan-only" } for an RFC1918 baseUrl', async () => {
    const xs = JSON.stringify({ s1: { type: 'plex', baseUrl: 'http://192.168.1.10:32400', token: 't' } });
    const res = await app.fetch(new Request('http://test/api/source-status?key=s1', {
      headers: { 'x-sources': xs },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; lastSeenAt: null };
    expect(body.status).toBe('lan-only');
    expect(body.lastSeenAt).toBeNull();
  });

  test('returns { status: "lan-only" } for plex.direct LAN encoding', async () => {
    const xs = JSON.stringify({ s1: { type: 'plex', baseUrl: 'https://10-0-15-100.deadbeef.plex.direct:32400', token: 't' } });
    const res = await app.fetch(new Request('http://test/api/source-status?key=s1', {
      headers: { 'x-sources': xs },
    }));
    const body = await res.json() as { status: string };
    expect(body.status).toBe('lan-only');
  });
});
