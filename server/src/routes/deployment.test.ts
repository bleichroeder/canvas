import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeDeploymentRoutes } from './deployment';
import { makeAdminRoutes } from './admin';
import { requireUser, requireAdmin } from '../middleware/auth';
import { errorHandler } from '../middleware/error-handler';
import { createUser } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { config } from '../config';

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

async function makeFixture() {
  const db = makeDb();
  const admin = createUser(db, { label: 'Admin', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'A', tokenHash: await hashBearer(adminBearer) });

  const app = new Hono();
  app.onError(errorHandler);
  // Admin middleware for /api/admin/* routes
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  // Mount deployment routes at /api (they contain /admin/deployment and /deployment/status)
  app.route('/api', makeDeploymentRoutes(() => db));
  // Also mount unrelated admin routes for completeness
  app.route('/api/admin', makeAdminRoutes(() => db));

  return { app, db, admin, adminBearer };
}

async function authedGet(app: Hono, path: string, bearer: string): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    headers: { authorization: `Bearer ${bearer}` },
  }));
}

async function authedPost(app: Hono, path: string, body: unknown, bearer: string): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  }));
}

async function anonGet(app: Hono, path: string): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`));
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('GET /api/deployment/status (public)', () => {
  test('returns mode + status + publicUrl without auth', async () => {
    const { app } = await makeFixture();
    const res = await anonGet(app, '/api/deployment/status');
    expect(res.status).toBe(200);
    const body = await res.json() as { mode: string; status: string; publicUrl: null; externallyManaged: boolean };
    expect(body.mode).toBe('local');
    expect(body.status).toBe('ready');
    expect(body.publicUrl).toBeNull();
    expect(body.externallyManaged).toBe(false);
  });

  test('does not expose cfNamedToken', async () => {
    const { app } = await makeFixture();
    const res = await anonGet(app, '/api/deployment/status');
    const body = await res.json() as Record<string, unknown>;
    expect(body.cfNamedToken).toBeUndefined();
    expect(body.hasCfNamedToken).toBeUndefined();
  });
});

describe('GET /api/admin/deployment (auth required)', () => {
  test('returns full config (minus token) for admin', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedGet(app, '/api/admin/deployment', adminBearer);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.mode).toBe('local');
    expect(body.status).toBe('ready');
    expect(body.hasCfNamedToken).toBe(false);
    expect(body.externallyManaged).toBe(false);
    // Token itself must not be included
    expect(body.cfNamedToken).toBeUndefined();
  });

  test('returns 401 without auth', async () => {
    const { app } = await makeFixture();
    const res = await anonGet(app, '/api/admin/deployment');
    expect(res.status).toBe(401);
  });

  test('hasCfNamedToken is true when token is set', async () => {
    const { app, db, adminBearer } = await makeFixture();
    const { updateDeploymentConfig } = await import('../storage/deployment-config');
    updateDeploymentConfig(db, { cfNamedToken: 'a'.repeat(40) });
    const res = await authedGet(app, '/api/admin/deployment', adminBearer);
    const body = await res.json() as { hasCfNamedToken: boolean };
    expect(body.hasCfNamedToken).toBe(true);
  });
});

describe('POST /api/admin/deployment', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'canvas-dep-test-'));
    // Point sidecar writes to a temp dir so they don't fail
    (config as Record<string, unknown>).CANVAS_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Reset to default
    (config as Record<string, unknown>).CANVAS_DATA_DIR = '/data';
    (config as Record<string, unknown>).CANVAS_EXTERNAL_PROXY = false;
    mock.restore();
  });

  test('mode=local is accepted and returns 204', async () => {
    const killSpy = spyOn(process, 'kill').mockImplementation(() => true);
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'local' }, adminBearer);
    expect(res.status).toBe(204);
    killSpy.mockRestore();
  });

  test('mode=domain with domain is accepted', async () => {
    spyOn(process, 'kill').mockImplementation(() => true);
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'domain', domain: 'canvas.example.com' }, adminBearer);
    expect(res.status).toBe(204);
  });

  test('mode=domain without domain returns 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'domain' }, adminBearer);
    expect(res.status).toBe(400);
  });

  test('mode=cf-named without token returns 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'cf-named' }, adminBearer);
    expect(res.status).toBe(400);
  });

  test('mode=cf-named with short token returns 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'cf-named', cfNamedToken: 'short' }, adminBearer);
    expect(res.status).toBe(400);
  });

  test('mode=cf-named with valid token accepted', async () => {
    spyOn(process, 'kill').mockImplementation(() => true);
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'cf-named', cfNamedToken: 'a'.repeat(25) }, adminBearer);
    expect(res.status).toBe(204);
  });

  test('mode=cf-quick is accepted', async () => {
    spyOn(process, 'kill').mockImplementation(() => true);
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'cf-quick' }, adminBearer);
    expect(res.status).toBe(204);
  });

  test('invalid mode returns 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'banana' }, adminBearer);
    expect(res.status).toBe(400);
  });

  test('missing mode returns 400', async () => {
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', {}, adminBearer);
    expect(res.status).toBe(400);
  });

  test('returns 409 when CANVAS_EXTERNAL_PROXY is set', async () => {
    (config as Record<string, unknown>).CANVAS_EXTERNAL_PROXY = true;
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'local' }, adminBearer);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/externally managed/);
  });

  test('schedules process.kill(1, SIGTERM) after successful update', async () => {
    const killSpy = spyOn(process, 'kill').mockImplementation(() => true);

    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment', { mode: 'cf-quick' }, adminBearer);
    expect(res.status).toBe(204);

    // SIGTERM is scheduled 2s later — wait for it
    await new Promise<void>((resolve) => setTimeout(resolve, 2200));
    // At least one kill(1, 'SIGTERM') must have fired (other tests' pending timers
    // may also fire during the wait, but we only care that our call happened).
    expect(killSpy).toHaveBeenCalledWith(1, 'SIGTERM');
  }, 5000);

  test('returns 401 without auth', async () => {
    const { app } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/admin/deployment', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'local' }),
    }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/deployment/apply', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'canvas-dep-apply-'));
    (config as Record<string, unknown>).CANVAS_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    (config as Record<string, unknown>).CANVAS_DATA_DIR = '/data';
    mock.restore();
  });

  test('returns 204 and schedules restart', async () => {
    const killSpy = spyOn(process, 'kill').mockImplementation(() => true);
    const { app, adminBearer } = await makeFixture();
    const res = await authedPost(app, '/api/admin/deployment/apply', {}, adminBearer);
    expect(res.status).toBe(204);

    await new Promise<void>((resolve) => setTimeout(resolve, 2200));
    expect(killSpy).toHaveBeenCalledWith(1, 'SIGTERM');
  }, 5000);

  test('returns 401 without auth', async () => {
    const { app } = await makeFixture();
    const res = await app.fetch(new Request('http://test/api/admin/deployment/apply', { method: 'POST' }));
    expect(res.status).toBe(401);
  });
});
