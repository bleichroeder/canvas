import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { bootstrapAdminIfNeeded } from './bootstrap';
import { countAdmins, createUser } from '../storage/users';
import { createClaimToken } from '../storage/claim-tokens';
import { createDeviceSession } from '../storage/device-sessions';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
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

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('fresh install (no admin) does NOT auto-create admin — wizard handles it', () => {
    const db = makeDb();
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(false);
    expect(r.token).toBeUndefined();
    expect(countAdmins(db)).toBe(0);
    // No sentinel file written — nothing to claim.
    expect(existsSync(join(tmpDir, 'admin-claim-token.txt'))).toBe(false);
  });

  test('admin exists with active session: no-op (steady state)', () => {
    const db = makeDb();
    const admin = createUser(db, { label: 'Admin', role: 'admin' });
    createDeviceSession(db, { userId: admin.id, deviceLabel: 'X', tokenHash: 'h1' });
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(false);
    expect(r.token).toBeUndefined();
    expect(r.recovered).toBeUndefined();
  });

  test('admin exists with active claim token: no-op', () => {
    const db = makeDb();
    const admin = createUser(db, { label: 'Admin', role: 'admin' });
    createClaimToken(db, admin.id, 3600);
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(false);
    expect(r.token).toBeUndefined();
  });

  test('recovery: admin (labelled "Admin") exists, no devices, no active token → emit fresh token', () => {
    const db = makeDb();
    const admin = createUser(db, { label: 'Admin', role: 'admin' });
    // Simulate a spent/expired claim token from a previous life.
    const oldClaim = createClaimToken(db, admin.id, 3600);
    db.$client.prepare('UPDATE claim_tokens SET expires_at = expires_at - 100000').run();

    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(false);
    expect(r.recovered).toBe(true);
    expect(r.token).toBeDefined();
    expect(r.token).not.toBe(oldClaim.token);
    const sentinel = join(tmpDir, 'admin-claim-token.txt');
    expect(readFileSync(sentinel, 'utf8').trim()).toBe(r.token!);
  });

  test('recovery is skipped when admin has a non-"Admin" label (F-wizard-created admin)', () => {
    const db = makeDb();
    // Wizard-created admin picked their own username.
    createUser(db, { label: 'david', role: 'admin' });
    const r = bootstrapAdminIfNeeded(db, { dbPath, claimTokenTtlSec: 3600 });
    expect(r.created).toBe(false);
    expect(r.recovered).toBeUndefined();
    // No recovery token — users with F-wizard admins recover via direct DB manipulation.
  });
});
