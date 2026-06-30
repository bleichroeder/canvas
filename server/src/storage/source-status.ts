import { eq, lt } from 'drizzle-orm';
import type { Db } from '../db';
import { sourceStatusCache, type NewSourceStatusCacheRow, type SourceStatusCacheRow } from '../db/schema';
import { nowSec } from '../lib/time';

export function getSourceStatus(db: Db, sourceKey: string): SourceStatusCacheRow | null {
  return db.select().from(sourceStatusCache).where(eq(sourceStatusCache.sourceKey, sourceKey)).get() ?? null;
}

export function putSourceStatus(db: Db, row: NewSourceStatusCacheRow): void {
  // INSERT OR REPLACE — same key overwrites.
  db.insert(sourceStatusCache).values(row).onConflictDoUpdate({
    target: sourceStatusCache.sourceKey,
    set: {
      status: row.status,
      lastSeenAt: row.lastSeenAt ?? null,
      expiresAt: row.expiresAt,
      payload: row.payload,
    },
  }).run();
}

export function reapSourceStatus(db: Db, now: number = nowSec()): number {
  const stmt = db.$client.prepare(`DELETE FROM source_status_cache WHERE expires_at < ?`);
  const result = stmt.run(now);
  return result.changes;
}
