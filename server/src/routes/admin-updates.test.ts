import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { requireUser, requireAdmin } from '../middleware/auth';
import { makeAdminUpdatesRoutes } from './admin-updates';
import { __resetForTests as resetUpdateCache } from '../lib/update-checker';

async function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);

  const admin = createUser(db, { label: 'A', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(adminBearer) });

  const member = createUser(db, { label: 'M', role: 'member' });
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: member.id, deviceLabel: 'D2', tokenHash: await hashBearer(memberBearer) });

  const app = new Hono();
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminUpdatesRoutes(() => db));

  return { app, adminBearer, memberBearer };
}

describe('admin-updates', () => {
  test('unauthenticated request → 401', async () => {
    resetUpdateCache();
    // Stub fetch to prevent real network call.
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status'));
    expect(res.status).toBe(401);
  });

  test('non-admin request → 403', async () => {
    resetUpdateCache();
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app, memberBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status', {
      headers: { authorization: `Bearer ${memberBearer}` },
    }));
    expect(res.status).toBe(403);
  });

  test('admin request returns UpdateStatus shape', async () => {
    resetUpdateCache();
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response(JSON.stringify({
        tag_name: 'v0.8.0',
        published_at: '2026-07-02T12:00:00Z',
        body: 'notes',
        html_url: 'https://example',
      }), { status: 200 }) as unknown as Response;
    const { app, adminBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
      releaseNotes: string;
    };
    expect(body.currentVersion).toBeDefined();
    expect(body.latestVersion).toBe('v0.8.0');
    expect(body.updateAvailable).toBe(true);
    expect(body.releaseNotes).toBe('notes');
  });
});
