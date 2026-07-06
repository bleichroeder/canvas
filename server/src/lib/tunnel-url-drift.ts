import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { deploymentConfig } from '../db/schema';
import { nowSec } from './time';

/**
 * Called once at canvas boot after deployment config has been populated
 * with the current tunnel URL. Compares against `lastKnownPublicUrl`
 * (persisted from the previous boot) and records drift if the two differ.
 *
 *   - First boot after migration (`lastKnownPublicUrl === null`): seed the
 *     baseline, do NOT set changed-at (no false positive).
 *   - Same URL: no-op.
 *   - Different URL: record `previousPublicUrl`, `publicUrlChangedAt = now`,
 *     and update `lastKnownPublicUrl` to the current URL.
 *   - Current URL is null (canvas doesn't have one on this boot, e.g., cf-quick
 *     not yet produced one): no-op. Avoids recording spurious "drift to nothing."
 */
export function detectPublicUrlDrift(db: Db, currentPublicUrl: string | null): void {
  const row = db.select().from(deploymentConfig).where(eq(deploymentConfig.id, 1)).get();
  if (!row) return;
  if (currentPublicUrl === null) return;

  const last = row.lastKnownPublicUrl;
  if (last === null) {
    db.update(deploymentConfig)
      .set({ lastKnownPublicUrl: currentPublicUrl })
      .where(eq(deploymentConfig.id, 1))
      .run();
    return;
  }
  if (last === currentPublicUrl) return;

  db.update(deploymentConfig)
    .set({
      previousPublicUrl: last,
      publicUrlChangedAt: nowSec(),
      lastKnownPublicUrl: currentPublicUrl,
    })
    .where(eq(deploymentConfig.id, 1))
    .run();
}
