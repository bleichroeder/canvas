import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { bootstrapAdminIfNeeded } from './bootstrap';
import { countAdmins } from '../storage/users';
import { createDeviceSession } from '../storage/device-sessions';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('bootstrapAdminIfNeeded', () => {
  let tmpDir: string;
  let dbPath: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'canvas-boot-'));
    dbPath = join(tmpDir, 'canvas.db');
  });

  test('first run: creates admin, mints token, writes sentinel file', () => {
    const db = makeDb();
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(true);
    expect(r.token).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{3}$/);
    expect(countAdmins(db)).toBe(1);
    const sentinel = join(tmpDir, 'admin-claim-token.txt');
    expect(existsSync(sentinel)).toBe(true);
    expect(readFileSync(sentinel, 'utf8').trim()).toBe(r.token!);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('second run with paired admin device: no-op', () => {
    const db = makeDb();
    const r1 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    createDeviceSession(db, { userId: 1, deviceLabel: 'X', tokenHash: 'h1' });
    const r2 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r2.created).toBe(false);
    expect(r2.token).toBeUndefined();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('recovery: admin exists, no devices, no active token → emit fresh token', () => {
    const db = makeDb();
    const r1 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    // Force-expire the first token.
    db.$client.prepare('UPDATE claim_tokens SET expires_at = expires_at - 100000').run();
    const r2 = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r2.created).toBe(false);
    expect(r2.recovered).toBe(true);
    expect(r2.token).toBeDefined();
    expect(r2.token).not.toBe(r1.token!);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
