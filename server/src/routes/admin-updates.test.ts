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

function makeFakeWatchtower(overrides: Partial<{ reachable: boolean; triggerThrows: boolean }> = {}) {
  return {
    isReachable: async () => overrides.reachable ?? true,
    triggerUpdate: async () => {
      if (overrides.triggerThrows) throw new Error('fake failure');
    },
  };
}

async function makeFixture(overrides: Partial<{ reachable: boolean; triggerThrows: boolean }> = {}) {
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

  const fakeWatchtower = makeFakeWatchtower(overrides);

  const app = new Hono();
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminUpdatesRoutes(() => db, fakeWatchtower));

  return { app, adminBearer, memberBearer };
}

describe('admin-updates', () => {
  test('unauthenticated request → 401', async () => {
    resetUpdateCache();
    // Stub fetch to prevent real network call.
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status'));
    expect(res.status).toBe(401);
  });

  test('non-admin request → 403', async () => {
    resetUpdateCache();
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app, memberBearer } = await makeFixture();
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
    const { app, adminBearer } = await makeFixture();
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

  test('GET /updates/preferences returns defaults + watchtowerReachable', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/preferences', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { autoUpdate: boolean; lastAutoCheckAt: number | null; watchtowerReachable: boolean };
    expect(body.autoUpdate).toBe(false);
    expect(body.lastAutoCheckAt).toBeNull();
    expect(body.watchtowerReachable).toBe(true);
  });

  test('PATCH /updates/preferences toggles autoUpdate', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/preferences', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ autoUpdate: true }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { autoUpdate: boolean };
    expect(body.autoUpdate).toBe(true);
  });

  test('PATCH /updates/preferences rejects non-boolean', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/preferences', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({ autoUpdate: 'yes' }),
    }));
    expect(res.status).toBe(400);
  });

  test('PATCH /updates/preferences with empty body returns 400', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/preferences', {
      method: 'PATCH',
      headers: { authorization: `Bearer ${adminBearer}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  test('POST /updates/apply returns 202 when Watchtower reachable', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/apply', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(202);
  });

  test('POST /updates/apply returns 409 when Watchtower unreachable', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: false });
    const res = await app.fetch(new Request('http://test/api/admin/updates/apply', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(409);
  });

  test('POST /updates/apply returns 502 when triggerUpdate throws', async () => {
    const { app, adminBearer } = await makeFixture({ reachable: true, triggerThrows: true });
    const res = await app.fetch(new Request('http://test/api/admin/updates/apply', {
      method: 'POST',
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(502);
  });
});
