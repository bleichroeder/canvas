import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { insertErrorReport, countErrorReports } from '../storage/error-reports';
import { runRetention } from './telemetry-retention';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

function insertAt(db: Db, tsMs: number, id: string): void {
  insertErrorReport(db, {
    id,
    createdAt: tsMs,
    reportJson: '{}',
  });
}

describe('runRetention', () => {
  test('prunes rows older than retentionDays', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    insertAt(db, now - 40 * 86_400_000, 'old-1');
    insertAt(db, now - 20 * 86_400_000, 'recent-1');
    insertAt(db, now - 5 * 86_400_000, 'recent-2');
    runRetention(db, { retentionDays: 30, maxRows: 1000, nowMs: now });
    expect(countErrorReports(db)).toBe(2);
  });

  test('prunes oldest when row count exceeds maxRows', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    for (let i = 0; i < 5; i++) insertAt(db, now - i * 1000, `r-${i}`);
    runRetention(db, { retentionDays: 30, maxRows: 3, nowMs: now });
    expect(countErrorReports(db)).toBe(3);
  });

  test('prunes correctly when rows share a createdAt timestamp', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    // 5 rows all at the same timestamp — reproduces the collision case that
    // trips a `createdAt < boundary` filter.
    for (let i = 0; i < 5; i++) insertAt(db, now, `same-${i}`);
    runRetention(db, { retentionDays: 30, maxRows: 3, nowMs: now });
    expect(countErrorReports(db)).toBe(3);
  });

  test('does nothing when under both limits', () => {
    const db = makeDb();
    const now = 1_000_000_000_000;
    insertAt(db, now - 1000, 'a');
    insertAt(db, now - 2000, 'b');
    runRetention(db, { retentionDays: 30, maxRows: 1000, nowMs: now });
    expect(countErrorReports(db)).toBe(2);
  });
});
