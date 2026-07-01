import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { makeSetupRoutes, isLoopback } from './setup';
import { errorHandler } from '../middleware/error-handler';
import { createUser, setPasswordHash, countAdmins } from '../storage/users';
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

/** Build a stub "server" whose requestIP() returns the given address. */
function stubServer(address: string | null): ReturnType<typeof Bun.serve> {
  return {
    requestIP: (_req: Request) => (address ? { address, family: 'IPv4', port: 12345 } : null),
  } as unknown as ReturnType<typeof Bun.serve>;
}

function makeApp(db: Db, remoteAddress: string | null) {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api', makeSetupRoutes(() => db, () => stubServer(remoteAddress)));
  return app;
}

async function jsonPost(app: Hono, path: string, body: unknown): Promise<Response> {
  return app.fetch(new Request(`http://test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

const VALID_BODY = {
  adminUsername: 'admin',
  adminPassword: 'securepassword',
  deviceLabel: 'My Tesla',
};

// ── isLoopback unit tests ──────────────────────────────────────────────────────

describe('isLoopback', () => {
  test('127.0.0.1 is loopback', () => { expect(isLoopback('127.0.0.1')).toBe(true); });
  test('::1 is loopback', () => { expect(isLoopback('::1')).toBe(true); });
  test('::ffff:127.0.0.1 is loopback', () => { expect(isLoopback('::ffff:127.0.0.1')).toBe(true); });
  test('192.168.1.1 is not loopback', () => { expect(isLoopback('192.168.1.1')).toBe(false); });
  test('null is not loopback', () => { expect(isLoopback(null)).toBe(false); });
  test('undefined is not loopback', () => { expect(isLoopback(undefined)).toBe(false); });
  test('empty string is not loopback', () => { expect(isLoopback('')).toBe(false); });
});

// ── POST /api/setup ────────────────────────────────────────────────────────────

describe('POST /api/setup', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'canvas-setup-test-'));
    (config as Record<string, unknown>).CANVAS_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    (config as Record<string, unknown>).CANVAS_DATA_DIR = '/data';
    mock.restore();
  });

  test('creates admin + returns bearer when called from loopback', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(200);
    const body = await res.json() as { bearer: string; user: { label: string; role: string; hasPassword: boolean } };
    expect(body.bearer).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(body.user.label).toBe('admin');
    expect(body.user.role).toBe('admin');
    expect(body.user.hasPassword).toBe(true);
    // Admin was actually created
    expect(countAdmins(db)).toBe(1);
  });

  test('::1 (IPv6 loopback) is accepted', async () => {
    const db = makeDb();
    const app = makeApp(db, '::1');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('::ffff:127.0.0.1 (IPv4-mapped loopback) is accepted', async () => {
    const db = makeDb();
    const app = makeApp(db, '::ffff:127.0.0.1');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('returns 403 for non-loopback address', async () => {
    const db = makeDb();
    const app = makeApp(db, '192.168.1.100');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/localhost/);
  });

  test('returns 403 when server returns null IP', async () => {
    const db = makeDb();
    const app = makeApp(db, null);
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(403);
  });

  test('returns 409 when admin already exists', async () => {
    const db = makeDb();
    // Pre-create an admin
    const existing = createUser(db, { label: 'existingadmin', role: 'admin' });
    setPasswordHash(db, existing.id, await Bun.password.hash('somepassword'));
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/already complete/);
  });

  test('returns 400 for short username', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', { ...VALID_BODY, adminUsername: 'a' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for username exceeding 32 chars', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', { ...VALID_BODY, adminUsername: 'a'.repeat(33) });
    expect(res.status).toBe(400);
  });

  test('returns 400 for password shorter than 8 chars', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', { ...VALID_BODY, adminPassword: 'short' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for empty deviceLabel', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', { ...VALID_BODY, deviceLabel: '' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for missing body fields', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await jsonPost(app, '/api/setup', {});
    expect(res.status).toBe(400);
  });
});

// ── GET /api/setup/probe ───────────────────────────────────────────────────────

describe('GET /api/setup/probe', () => {
  test('returns setupRequired=true from loopback when no admin', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(200);
    const body = await res.json() as { setupRequired: boolean };
    expect(body.setupRequired).toBe(true);
  });

  test('returns setupRequired=false from loopback when admin exists', async () => {
    const db = makeDb();
    createUser(db, { label: 'admin', role: 'admin' });
    const app = makeApp(db, '127.0.0.1');
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(200);
    const body = await res.json() as { setupRequired: boolean };
    expect(body.setupRequired).toBe(false);
  });

  test('returns 403 from non-loopback', async () => {
    const db = makeDb();
    const app = makeApp(db, '10.0.0.5');
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(403);
  });
});
