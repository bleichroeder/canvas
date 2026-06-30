import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeHomeRoutes } from './home';
import { requireUser } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { createSource } from '../storage/sources';
import { generateBearer, hashBearer } from '../lib/bearer';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function makeStubAdapter(type: 'plex' | 'flixify', impl: Partial<SourceAdapter>): SourceAdapter {
  return {
    type,
    startPair: impl.startPair ?? (async () => ({ pairUrl: '', expiresAt: 0 })),
    home: impl.home ?? (async () => []),
    library: impl.library ?? (async () => ({ breadcrumbs: [], items: [] })),
    item: impl.item ?? (async () => { throw new Error('not implemented'); }),
    search: impl.search ?? (async () => []),
    resolveStream: impl.resolveStream ?? (async () => { throw new Error('not implemented'); }),
    saveProgress: impl.saveProgress ?? (async () => {}),
  } as SourceAdapter;
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
  app.use('/api/home', requireUser(() => db));
  app.route('/api/home', makeHomeRoutes(() => db));
  return { app, db, admin, bearer };
}

describe('home route', () => {
  test('with no sources in DB, returns empty rows + no errors', async () => {
    const { app, bearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/home', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: unknown[]; errors: unknown[]; libraryCounts: Record<string, number> };
    expect(body.rows).toEqual([]);
    expect(body.errors).toEqual([]);
    expect(body.libraryCounts).toEqual({});
  });

  test('injects source key into each row and computes libraryCounts (folders only)', async () => {
    // Registry uses Map.set — re-registering overwrites in place (idempotent).
    registerAdapter(makeStubAdapter('plex', {
      home: async () => [{ kind: 'continue', title: 'Continue', items: [] }],
      library: async () => ({
        breadcrumbs: [],
        items: [
          { id: '1', type: 'folder', title: 'Movies' },
          { id: '2', type: 'folder', title: 'Shows' },
          { id: '3', type: 'item',   title: 'Stray' }, // not a folder; must be excluded
        ] as any,
      }),
    }));
    const { app, db, admin, bearer } = await makeApp();
    const s = createSource(db, { type: 'plex', baseUrl: 'http://x', token: 't', label: 'L', pairedByUserId: admin.id });
    const res = await app.fetch(new Request('http://test/api/home', {
      headers: { authorization: `Bearer ${bearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: any[]; libraryCounts: Record<string, number> };
    expect(body.libraryCounts[String(s.id)]).toBe(2);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].source).toBe(String(s.id));
  });

  test('returns 401 without authorization header', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/home'));
    expect(res.status).toBe(401);
  });
});
