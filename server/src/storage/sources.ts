import { eq, and } from 'drizzle-orm';
import type { Db } from '../db';
import { sources, userSourceAccess, type Source, type NewSource } from '../db/schema';
import { nowSec } from '../lib/time';

export function createSource(db: Db, input: { type: 'plex' | 'flixify'; baseUrl: string; token: string; label: string; pairedByUserId: number }): Source {
  const row: NewSource = {
    type: input.type,
    baseUrl: input.baseUrl,
    token: input.token,
    label: input.label,
    pairedByUserId: input.pairedByUserId,
    createdAt: nowSec(),
  };
  const inserted = db.insert(sources).values(row).returning().get();
  if (!inserted) throw new Error('createSource: insert returned no row');
  return inserted;
}

export function getSource(db: Db, id: number): Source | null {
  return db.select().from(sources).where(eq(sources.id, id)).get() ?? null;
}

export function listAllSources(db: Db): Source[] {
  return db.select().from(sources).all();
}

/**
 * Sources the user can browse: ACL-filtered for members, full pool for admins.
 * Admin status MUST be checked by caller (this function trusts its `userId` is
 * a member; pass the full pool path explicitly via listAllSources for admins).
 */
export function listAccessibleSources(db: Db, userId: number): Source[] {
  // INNER JOIN sources → user_source_access on source_id = sources.id WHERE user_id = ?
  const rows = db
    .select({
      id: sources.id,
      type: sources.type,
      baseUrl: sources.baseUrl,
      token: sources.token,
      label: sources.label,
      pairedByUserId: sources.pairedByUserId,
      createdAt: sources.createdAt,
    })
    .from(sources)
    .innerJoin(userSourceAccess, eq(userSourceAccess.sourceId, sources.id))
    .where(eq(userSourceAccess.userId, userId))
    .all();
  return rows;
}

export function deleteSource(db: Db, id: number): void {
  db.delete(sources).where(eq(sources.id, id)).run();
}

export function grantSourceAccess(db: Db, userId: number, sourceId: number): void {
  // INSERT OR IGNORE so re-grant is a no-op.
  db.$client.prepare(
    `INSERT OR IGNORE INTO user_source_access (user_id, source_id) VALUES (?, ?)`,
  ).run(userId, sourceId);
}

export function revokeSourceAccess(db: Db, userId: number, sourceId: number): void {
  db.delete(userSourceAccess)
    .where(and(eq(userSourceAccess.userId, userId), eq(userSourceAccess.sourceId, sourceId)))
    .run();
}

export function userHasSourceAccess(db: Db, userId: number, sourceId: number): boolean {
  const row = db
    .select()
    .from(userSourceAccess)
    .where(and(eq(userSourceAccess.userId, userId), eq(userSourceAccess.sourceId, sourceId)))
    .get();
  return !!row;
}
