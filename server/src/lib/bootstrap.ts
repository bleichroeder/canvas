import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db';
import { countAdmins, createUser, getUserByLabel } from '../storage/users';
import { createClaimToken, regenerateClaimToken } from '../storage/claim-tokens';
import { listUserDevices } from '../storage/device-sessions';
import { logger } from '../log';
import { eq, and, isNull, gte } from 'drizzle-orm';
import { claimTokens } from '../db/schema';
import { nowSec } from './time';

export interface BootstrapConfig {
  dbPath: string;          // e.g. ./data/canvas.db; sentinel goes next to it
  claimTokenTtlSec: number;
}

const ADMIN_LABEL = 'Admin';
const DEFAULT_TTL_SEC = 24 * 60 * 60;

/**
 * On first boot (no admin yet): create the admin user, mint a claim token,
 * print + write sentinel file.
 *
 * On subsequent boots, the recovery path:
 *   - Admin user exists.
 *   - Zero device sessions for admin.
 *   - Zero unused, unexpired claim tokens for admin.
 *   → Re-emit a fresh claim token so the operator can recover after losing
 *     their bearer or letting the original token expire.
 *
 * Otherwise: no-op.
 */
export function bootstrapAdminIfNeeded(db: Db, cfg: BootstrapConfig): { created: boolean; token?: string; recovered?: boolean } {
  const adminCount = countAdmins(db);
  let adminUserId: number;
  let recovered = false;

  if (adminCount === 0) {
    const admin = createUser(db, { label: ADMIN_LABEL, role: 'admin' });
    adminUserId = admin.id;
  } else {
    const admin = getUserByLabel(db, ADMIN_LABEL);
    if (!admin) {
      // Singleton invariant guarantees the admin row, but its label could differ
      // if a future flow lets the admin rename themselves. Look up by role instead.
      throw new Error('bootstrap: admin user exists but could not be located by label');
    }
    adminUserId = admin.id;

    // Recovery check: if admin has no devices AND no active claim tokens, emit fresh.
    const devices = listUserDevices(db, adminUserId);
    if (devices.length > 0) {
      return { created: false };
    }
    const now = nowSec();
    const active = db
      .select()
      .from(claimTokens)
      .where(and(
        eq(claimTokens.userId, adminUserId),
        isNull(claimTokens.usedAt),
        gte(claimTokens.expiresAt, now),
      ))
      .all();
    if (active.length > 0) {
      return { created: false };
    }
    recovered = true;
  }

  const token = adminCount === 0
    ? createClaimToken(db, adminUserId, cfg.claimTokenTtlSec ?? DEFAULT_TTL_SEC).token
    : regenerateClaimToken(db, adminUserId, cfg.claimTokenTtlSec ?? DEFAULT_TTL_SEC).token;

  const dbDir = dirname(cfg.dbPath);
  const sentinelPath = join(dbDir, 'admin-claim-token.txt');
  try {
    mkdirSync(dbDir, { recursive: true });
    writeFileSync(sentinelPath, `${token}\n`, { mode: 0o600 });
  } catch (e) {
    logger.warn({ err: (e as Error).message, sentinelPath }, 'bootstrap: sentinel write failed (continuing)');
  }

  const banner = [
    '',
    '┌──────────────────────────────────────────────────────────┐',
    `│  ${recovered ? 'ADMIN CLAIM TOKEN RE-EMITTED (recovery mode):' : 'FIRST-RUN ADMIN CLAIM TOKEN (expires 24h):  '}    │`,
    '│                                                          │',
    `│      ${token.padEnd(50)}│`,
    '│                                                          │',
    '│  Enter this token on your first device to become admin.  │',
    `│  Also written to: ${sentinelPath.padEnd(38).slice(0, 38)}│`,
    '└──────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
  process.stdout.write(banner);

  return { created: adminCount === 0, token, recovered };
}
