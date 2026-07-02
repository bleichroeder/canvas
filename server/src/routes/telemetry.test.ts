import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { countErrorReports, insertErrorReport } from '../storage/error-reports';
import { makeTelemetryRoutes } from './telemetry';

function makeApp(enabled = true, retentionDays = 30, maxRows = 1000) {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);

  const app = new Hono();
  app.route('/api', makeTelemetryRoutes(() => db, { enabled, retentionDays, maxRows }));
  return { app, db };
}

function validPayload() {
  return {
    events: [{ tsMs: 0, kind: 'session_start', data: { sourceType: 'Plex' } }],
    session: {
      userAgent: 'test-ua',
      viewport: { w: 1200, h: 800 },
      screen: { w: 1920, h: 1080 },
      canvasVersion: '0.2.0',
      sourceType: 'Plex',
    },
    error: { message: 'boom', kind: 'video' },
  };
}

async function post(app: Hono, body: unknown, headers: Record<string, string> = {}) {
  return app.fetch(
    new Request('http://test/api/telemetry/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

describe('POST /api/telemetry/error', () => {
  test('accepts valid payload, inserts row, returns id', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validPayload());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(countErrorReports(db)).toBe(1);
  });

  test('rejects malformed body with 400', async () => {
    const { app } = makeApp();
    const res = await post(app, { events: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('rejects payload exceeding 256KB with 413', async () => {
    const { app } = makeApp();
    const big = { ...validPayload(), events: Array(1).fill({ tsMs: 0, kind: 'x', data: { blob: 'x'.repeat(300_000) } }) };
    const res = await post(app, big);
    expect(res.status).toBe(413);
  });

  test('rejects events.length > 1000 with 400', async () => {
    const { app } = makeApp();
    const p = validPayload();
    (p as unknown as { events: unknown[] }).events = Array(1001).fill({ tsMs: 0, kind: 'x', data: {} });
    const res = await post(app, p);
    expect(res.status).toBe(400);
  });

  test('does NOT require auth', async () => {
    const { app } = makeApp();
    const res = await post(app, validPayload()); // no authorization header
    expect(res.status).toBe(200);
  });

  test('rate-limits 11th request from same IP within 60s to 429', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      const res = await post(app, validPayload());
      expect(res.status).toBe(200);
    }
    const res11 = await post(app, validPayload());
    expect(res11.status).toBe(429);
  });

  test('separate IPs get separate rate limits', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) await post(app, validPayload(), { 'x-forwarded-for': '10.0.0.1' });
    const res = await post(app, validPayload(), { 'x-forwarded-for': '10.0.0.2' });
    expect(res.status).toBe(200);
  });

  test('TELEMETRY_ENABLED=false returns 204 without inserting', async () => {
    const { app, db } = makeApp(false);
    const res = await post(app, validPayload());
    expect(res.status).toBe(204);
    expect(countErrorReports(db)).toBe(0);
  });

  test('retention prunes to maxRows on insert', async () => {
    const { app, db } = makeApp(true, 30, 3);
    for (let i = 0; i < 5; i++) {
      const res = await post(app, validPayload(), { 'x-forwarded-for': `10.0.0.${i}` });
      expect(res.status).toBe(200);
    }
    expect(countErrorReports(db)).toBe(3);
  });

  test('column mapping: writes error.kind → error_kind, error.message → error_message, session.sourceType → source_type', async () => {
    const { app, db } = makeApp();
    const res = await post(app, validPayload());
    expect(res.status).toBe(200);
    const rows = db.select().from(schema.errorReports).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.errorKind).toBe('video');
    expect(rows[0]!.errorMessage).toBe('boom');
    expect(rows[0]!.sourceType).toBe('Plex');
    expect(rows[0]!.canvasVersion).toBe('0.2.0');
    expect(rows[0]!.userAgent).toBe('test-ua');
    expect(rows[0]!.userId).toBeNull();
  });

  test('user_id is opportunistic: not set when no auth', async () => {
    const { app, db } = makeApp();
    await post(app, validPayload());
    const rows = db.select().from(schema.errorReports).all();
    expect(rows[0]!.userId).toBeNull();
  });
});
