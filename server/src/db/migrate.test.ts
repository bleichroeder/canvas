import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { runMigrations } from './migrate';
import * as schema from './schema';

describe('migrate', () => {
  test('applies cleanly to a fresh in-memory DB and creates tables', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as any;
    runMigrations(db);
    // Both tables should be queryable.
    expect(() => db.select().from(schema.pairSessions).all()).not.toThrow();
    expect(() => db.select().from(schema.sourceStatusCache).all()).not.toThrow();
  });

  test('is idempotent — running twice on the same DB is a no-op', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as any;
    runMigrations(db);
    expect(() => runMigrations(db)).not.toThrow();
  });
});
