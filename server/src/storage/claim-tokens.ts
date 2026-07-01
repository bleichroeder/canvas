import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db';
import { claimTokens, type ClaimToken } from '../db/schema';
import { nowSec } from '../lib/time';
import { generateBearer } from '../lib/bearer';

export function createClaimToken(db: Db, userId: number, ttlSec: number): ClaimToken {
  const now = nowSec();
  const token = generateBearer();
  const inserted = db
    .insert(claimTokens)
    .values({ token, userId, createdAt: now, expiresAt: now + ttlSec })
    .returning()
    .get();
  if (!inserted) throw new Error('createClaimToken: insert returned no row');
  return inserted;
}

export function getClaimToken(db: Db, token: string): ClaimToken | null {
  return db.select().from(claimTokens).where(eq(claimTokens.token, token)).get() ?? null;
}

/**
 * Atomically mark a token as used. Returns the token row if the update applied
 * (token was valid, not expired, not previously used); null otherwise.
 */
export function consumeClaimToken(db: Db, token: string, now: number = nowSec()): ClaimToken | null {
  // Use raw SQL so we can express "update only if not yet used and not expired".
  const stmt = db.$client.prepare(
    `UPDATE claim_tokens
        SET used_at = ?
      WHERE token = ?
        AND used_at IS NULL
        AND expires_at >= ?
      RETURNING token, user_id, created_at, expires_at, used_at`,
  );
  const row = stmt.get(now, token, now) as
    | { token: string; user_id: number; created_at: number; expires_at: number; used_at: number }
    | null;
  if (!row) return null;
  return {
    token: row.token,
    userId: row.user_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
  };
}

/**
 * Invalidate any active claim tokens for this user and emit a fresh one.
 * Used by admin "regenerate claim token" action and by the bootstrap recovery
 * path.
 */
export function regenerateClaimToken(db: Db, userId: number, ttlSec: number): ClaimToken {
  // Invalidate by marking expired. Don't delete — keeps audit trail until user is deleted.
  db.update(claimTokens)
    .set({ expiresAt: nowSec() - 1 })
    .where(and(eq(claimTokens.userId, userId), isNull(claimTokens.usedAt)))
    .run();
  return createClaimToken(db, userId, ttlSec);
}

export function reapClaimTokens(db: Db, now: number = nowSec()): number {
  // Reap only fully-expired UNUSED tokens; used tokens stay for the audit trail
  // (they get garbage-collected via FK cascade when the user is deleted).
  const stmt = db.$client.prepare(
    `DELETE FROM claim_tokens WHERE expires_at < ? AND used_at IS NULL`,
  );
  const result = stmt.run(now);
  return result.changes;
}
