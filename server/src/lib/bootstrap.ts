import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Db } from '../db';
import { countAdmins, getUserByLabel } from '../storage/users';
import { regenerateClaimToken } from '../storage/claim-tokens';
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
 * Bootstrap logic that runs on every server start.
 *
 * Fresh installs (no admin yet): does NOT auto-create an admin — the browser
 * setup wizard at /#/setup is the sanctioned first-run path. Prints a big
 * banner pointing there.
 *
 * Recovery path (admin exists but has no active session + no active claim
 * token — e.g. lost credentials): emits a fresh one-time claim token via the
 * legacy claim-flow so the operator can re-authenticate. This is the escape
 * hatch when someone's locked themselves out post-setup.
 *
 * Steady state (admin exists AND has an active session or claim token): no-op.
 */
export function bootstrapAdminIfNeeded(db: Db, cfg: BootstrapConfig): { created: boolean; token?: string; recovered?: boolean } {
  const adminCount = countAdmins(db);

  if (adminCount === 0) {
    // Fresh install — sub-project F's /#/setup wizard creates the admin.
    // No auto-create, no auto-claim-token here. Just point the operator at
    // the wizard so they don't miss it in the logs.
    const banner = [
      '',
      '┌──────────────────────────────────────────────────────────┐',
      '│  FIRST-RUN — no admin configured yet.                    │',
      '│                                                          │',
      '│  Open http://<this-host>:8787/  in a browser and         │',
      '│  follow the setup wizard to create your admin account    │',
      '│  and choose how canvas is exposed.                       │',
      '│                                                          │',
      '│  (Only accessible from localhost / your LAN until you    │',
      '│  finish setup and pick a public-access mode.)            │',
      '└──────────────────────────────────────────────────────────┘',
      '',
    ].join('\n');
    process.stdout.write(banner);
    return { created: false };
  }

  // Admin exists. Look up + check recovery conditions.
  const admin = getUserByLabel(db, ADMIN_LABEL);
  if (!admin) {
    // Sub-project F's wizard may create the admin with any label the user
    // picks — the "Admin" label lookup fails. Skip recovery (no way to
    // regenerate a claim token for a user we can't identify by role via
    // this legacy code path). Not a real problem: users who lose access
    // after F-flow setup use the DB-manipulation recovery documented in
    // deployment-modes.md.
    return { created: false };
  }
  const adminUserId = admin.id;

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

  // Recovery: emit a fresh claim token for admin re-authentication.
  const token = regenerateClaimToken(db, adminUserId, cfg.claimTokenTtlSec ?? DEFAULT_TTL_SEC).token;
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
    '│  ADMIN CLAIM TOKEN RE-EMITTED (recovery mode):           │',
    '│                                                          │',
    `│      ${token.padEnd(50)}│`,
    '│                                                          │',
    '│  Your admin account has no active sessions — use this    │',
    '│  token via /#/claim to sign back in.                     │',
    `│  Also written to: ${sentinelPath.padEnd(38).slice(0, 38)}│`,
    '└──────────────────────────────────────────────────────────┘',
    '',
  ].join('\n');
  process.stdout.write(banner);

  return { created: false, token, recovered: true };
}
