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
import { insertErrorReport } from '../storage/error-reports';
import { requireUser, requireAdmin } from '../middleware/auth';
import { makeAdminTelemetryRoutes } from './admin-telemetry';

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
  app.route('/api/admin', makeAdminTelemetryRoutes(() => db));

  return { app, db, adminBearer, memberBearer };
}

function seedRow(db: Db, ts: number, kind: string, id: string) {
  insertErrorReport(db, {
    id,
    createdAt: ts,
    errorKind: kind,
    errorMessage: `err-${id}`,
    reportJson: JSON.stringify({ id }),
  });
}

describe('admin telemetry routes', () => {
  test('GET list requires auth', async () => {
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors'));
    expect(res.status).toBe(401);
  });

  test('GET list requires admin role', async () => {
    const { app, memberBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors', {
      headers: { authorization: `Bearer ${memberBearer}` },
    }));
    expect(res.status).toBe(403);
  });

  test('GET list returns paginated results, newest first', async () => {
    const { app, db, adminBearer } = await makeApp();
    for (let i = 0; i < 30; i++) seedRow(db, 1_000_000 + i, 'video', `r-${i}`);
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ id: string; created_at: number }>; nextCursor: string | null };
    expect(body.rows).toHaveLength(25);
    expect(body.rows[0]!.created_at).toBe(1_000_029);
    expect(body.nextCursor).toBe(String(body.rows[24]!.created_at));
  });

  test('GET list filters by kind', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'a');
    seedRow(db, 1001, 'audio', 'b');
    seedRow(db, 1002, 'video', 'c');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors?kind=video', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((r) => r.id).sort()).toEqual(['a', 'c']);
  });

  test('GET list filters by since', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'old');
    seedRow(db, 5000, 'video', 'new');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors?since=3000', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    const body = (await res.json()) as { rows: Array<{ id: string }> };
    expect(body.rows.map((r) => r.id)).toEqual(['new']);
  });

  test('GET :id returns full row', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'full');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/full', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; report_json: string };
    expect(body.id).toBe('full');
    expect(body.report_json).toBe('{"id":"full"}');
  });

  test('GET :id returns 404 for unknown id', async () => {
    const { app, adminBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/nope', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(404);
  });

  test('DELETE :id removes the row', async () => {
    const { app, db, adminBearer } = await makeApp();
    seedRow(db, 1000, 'video', 'del');
    const res = await app.fetch(new Request('http://test/api/admin/telemetry/errors/del', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(204);
    const res2 = await app.fetch(new Request('http://test/api/admin/telemetry/errors/del', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res2.status).toBe(404);
  });
});
