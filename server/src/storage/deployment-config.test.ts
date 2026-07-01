import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { getDeploymentConfig, updateDeploymentConfig } from './deployment-config';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('deployment-config storage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('singleton row is seeded on migration', () => {
    const config = getDeploymentConfig(db);
    expect(config.id).toBe(1);
    expect(config.mode).toBe('local');
    expect(config.status).toBe('ready');
  });

  test('updateDeploymentConfig patches the singleton and bumps lastAppliedAt', () => {
    const before = getDeploymentConfig(db);
    expect(before.lastAppliedAt).toBeNull();
    const updated = updateDeploymentConfig(db, { mode: 'cf-quick', publicUrl: 'https://foo.trycloudflare.com' });
    expect(updated.mode).toBe('cf-quick');
    expect(updated.publicUrl).toBe('https://foo.trycloudflare.com');
    expect(updated.lastAppliedAt).toBeGreaterThan(0);
  });

  test('cf-named token round-trip', () => {
    updateDeploymentConfig(db, { mode: 'cf-named', cfNamedToken: 'tunnel-token-abc' });
    expect(getDeploymentConfig(db).cfNamedToken).toBe('tunnel-token-abc');
  });
});
