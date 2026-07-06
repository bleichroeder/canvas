import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { deploymentConfig } from '../db/schema';
import { updateDeploymentConfig } from '../storage/deployment-config';
import { refreshDeploymentSync } from './deployment-sync';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

function getRow(db: Db) {
  return db.select().from(deploymentConfig).where(eq(deploymentConfig.id, 1)).get()!;
}

describe('refreshDeploymentSync — cf-quick baseline seed', () => {
  test('null→non-null publicUrl with lastKnownPublicUrl=null: seeds lastKnownPublicUrl, does NOT set publicUrlChangedAt or previousPublicUrl', () => {
    const db = makeDb();
    const dir = mkdtempSync(join(tmpdir(), 'canvas-sync-'));
    try {
      // Set mode to cf-quick with no URL yet
      updateDeploymentConfig(db, { mode: 'cf-quick', status: 'ready' });
      // Verify baseline: lastKnownPublicUrl is null
      expect(getRow(db).lastKnownPublicUrl).toBeNull();

      // Write the sidecar file (simulating cloudflared connecting late)
      const sidecarPath = join(dir, '.deployment-public-url');
      writeFileSync(sidecarPath, 'https://late.trycloudflare.com\n', 'utf8');

      refreshDeploymentSync(db, dir);

      const row = getRow(db);
      // publicUrl should be updated
      expect(row.publicUrl).toBe('https://late.trycloudflare.com');
      // lastKnownPublicUrl should be seeded to match publicUrl
      expect(row.lastKnownPublicUrl).toBe('https://late.trycloudflare.com');
      // No drift event: publicUrlChangedAt and previousPublicUrl remain null
      expect(row.publicUrlChangedAt).toBeNull();
      expect(row.previousPublicUrl).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('non-null lastKnownPublicUrl: refreshDeploymentSync does NOT overwrite lastKnownPublicUrl when writing a new publicUrl', () => {
    const db = makeDb();
    const dir = mkdtempSync(join(tmpdir(), 'canvas-sync-'));
    try {
      // Simulate a second boot: lastKnownPublicUrl already seeded from prior run
      updateDeploymentConfig(db, {
        mode: 'cf-quick',
        status: 'ready',
        publicUrl: null,
        lastKnownPublicUrl: 'https://old.example',
      });

      // Write a new (different) URL sidecar — simulating a URL change
      const sidecarPath = join(dir, '.deployment-public-url');
      writeFileSync(sidecarPath, 'https://new.trycloudflare.com\n', 'utf8');

      refreshDeploymentSync(db, dir);

      const row = getRow(db);
      // publicUrl updated
      expect(row.publicUrl).toBe('https://new.trycloudflare.com');
      // lastKnownPublicUrl NOT touched by refreshDeploymentSync — boot-time
      // detectPublicUrlDrift handles this case
      expect(row.lastKnownPublicUrl).toBe('https://old.example');
      // No drift fields written by refreshDeploymentSync
      expect(row.publicUrlChangedAt).toBeNull();
      expect(row.previousPublicUrl).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
