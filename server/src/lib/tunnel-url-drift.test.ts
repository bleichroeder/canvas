import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { deploymentConfig } from '../db/schema';
import { updateDeploymentConfig } from '../storage/deployment-config';
import { detectPublicUrlDrift } from './tunnel-url-drift';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

function getRow(db: Db) {
  return db.select().from(deploymentConfig).where(eq(deploymentConfig.id, 1)).get()!;
}

describe('detectPublicUrlDrift', () => {
  test('first boot: seeds lastKnownPublicUrl, does NOT set changed-at', () => {
    const db = makeDb();
    // deploymentConfig row is seeded by migration 0003 with publicUrl=null,
    // lastKnownPublicUrl=null (new column, nullable default).
    updateDeploymentConfig(db, { publicUrl: 'https://a.example.com' });
    detectPublicUrlDrift(db, 'https://a.example.com');
    const row = getRow(db);
    expect(row.lastKnownPublicUrl).toBe('https://a.example.com');
    expect(row.publicUrlChangedAt).toBeNull();
    expect(row.previousPublicUrl).toBeNull();
  });

  test('same URL across boots: no drift, no changes', () => {
    const db = makeDb();
    updateDeploymentConfig(db, { publicUrl: 'https://a.example.com', lastKnownPublicUrl: 'https://a.example.com' });
    detectPublicUrlDrift(db, 'https://a.example.com');
    const row = getRow(db);
    expect(row.lastKnownPublicUrl).toBe('https://a.example.com');
    expect(row.publicUrlChangedAt).toBeNull();
    expect(row.previousPublicUrl).toBeNull();
  });

  test('URL changed: records previousPublicUrl + publicUrlChangedAt, updates lastKnownPublicUrl', () => {
    const db = makeDb();
    updateDeploymentConfig(db, { publicUrl: 'https://b.example.com', lastKnownPublicUrl: 'https://a.example.com' });
    const before = Math.floor(Date.now() / 1000);
    detectPublicUrlDrift(db, 'https://b.example.com');
    const after = Math.floor(Date.now() / 1000);
    const row = getRow(db);
    expect(row.lastKnownPublicUrl).toBe('https://b.example.com');
    expect(row.previousPublicUrl).toBe('https://a.example.com');
    expect(row.publicUrlChangedAt).toBeGreaterThanOrEqual(before);
    expect(row.publicUrlChangedAt).toBeLessThanOrEqual(after);
  });

  test('current URL is null: no-op even if lastKnown was set', () => {
    const db = makeDb();
    updateDeploymentConfig(db, { publicUrl: null, lastKnownPublicUrl: 'https://a.example.com' });
    detectPublicUrlDrift(db, null);
    const row = getRow(db);
    // We don't want to record "drifted to null" — that's just canvas not
    // having a URL yet on this boot (e.g., cf-quick hasn't produced one).
    expect(row.lastKnownPublicUrl).toBe('https://a.example.com');
    expect(row.publicUrlChangedAt).toBeNull();
  });
});
