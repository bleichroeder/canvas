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
import { makeSetupRoutes, isTrustedSetupClient } from './setup';
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

// ── isTrustedSetupClient unit tests ────────────────────────────────────────────

describe('isTrustedSetupClient', () => {
  test('127.0.0.1 is trusted', () => { expect(isTrustedSetupClient('127.0.0.1')).toBe(true); });
  test('127.5.10.20 (127/8 loopback) is trusted', () => { expect(isTrustedSetupClient('127.5.10.20')).toBe(true); });
  test('::1 is trusted', () => { expect(isTrustedSetupClient('::1')).toBe(true); });
  test('::ffff:127.0.0.1 is trusted', () => { expect(isTrustedSetupClient('::ffff:127.0.0.1')).toBe(true); });
  test('10.0.0.5 (10/8 private) is trusted', () => { expect(isTrustedSetupClient('10.0.0.5')).toBe(true); });
  test('192.168.1.1 (192.168/16 private) is trusted', () => { expect(isTrustedSetupClient('192.168.1.1')).toBe(true); });
  test('172.17.0.1 (Docker bridge, 172.16/12 private) is trusted', () => { expect(isTrustedSetupClient('172.17.0.1')).toBe(true); });
  test('172.31.255.255 (edge of 172.16/12) is trusted', () => { expect(isTrustedSetupClient('172.31.255.255')).toBe(true); });
  test('172.32.0.1 (outside 172.16/12) is NOT trusted', () => { expect(isTrustedSetupClient('172.32.0.1')).toBe(false); });
  test('8.8.8.8 (public IP) is NOT trusted', () => { expect(isTrustedSetupClient('8.8.8.8')).toBe(false); });
  test('null is not trusted', () => { expect(isTrustedSetupClient(null)).toBe(false); });
  test('undefined is not trusted', () => { expect(isTrustedSetupClient(undefined)).toBe(false); });
  test('empty string is not trusted', () => { expect(isTrustedSetupClient('')).toBe(false); });
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

  test('192.168.1.100 (LAN) is accepted', async () => {
    const db = makeDb();
    const app = makeApp(db, '192.168.1.100');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('172.17.0.1 (Docker bridge) is accepted', async () => {
    const db = makeDb();
    const app = makeApp(db, '172.17.0.1');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('returns 403 for public IP', async () => {
    const db = makeDb();
    const app = makeApp(db, '8.8.8.8');
    const res = await jsonPost(app, '/api/setup', VALID_BODY);
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/trusted host/);
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
  // Probe is intentionally public (no host restriction) — it reveals no
  // secrets, just whether the wizard should fire. Frontend uses it on load.

  test('returns setupRequired=true when no admin exists', async () => {
    const db = makeDb();
    const app = makeApp(db, '127.0.0.1');
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(200);
    const body = await res.json() as { setupRequired: boolean };
    expect(body.setupRequired).toBe(true);
  });

  test('returns setupRequired=false when admin exists', async () => {
    const db = makeDb();
    createUser(db, { label: 'admin', role: 'admin' });
    const app = makeApp(db, '127.0.0.1');
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(200);
    const body = await res.json() as { setupRequired: boolean };
    expect(body.setupRequired).toBe(false);
  });

  test('probe is reachable from any host (no host restriction)', async () => {
    const db = makeDb();
    const app = makeApp(db, '8.8.8.8');  // public IP
    const res = await app.fetch(new Request('http://test/api/setup/probe'));
    expect(res.status).toBe(200);
  });
});
