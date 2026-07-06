import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { getDeploymentConfig, updateDeploymentConfig } from '../storage/deployment-config';
import { deploymentConfig, type DeploymentConfig } from '../db/schema';
import { logger } from '../log';

/**
 * Reads sidecar files written by the docker/entrypoint.sh and reconciles
 * the deployment_config row with runtime state:
 *
 *   - status flips from 'pending'/'applying' to 'ready' if the process is up
 *     (we're this deep in Bun's boot — subprocesses were spawned by entrypoint
 *      before us, or they never will be for this mode)
 *
 *   - publicUrl gets populated based on mode:
 *       local     — null
 *       domain    — computed from config.domain
 *       cf-named  — computed from config.domain (user-set in CF dashboard)
 *       cf-quick  — read from /data/.deployment-public-url written by the
 *                    entrypoint's stdout parser once cloudflared connects
 *
 * Called once at Bun boot AND on every GET /api/deployment/status so
 * cf-quick's late-arriving URL gets picked up.
 */
export function refreshDeploymentSync(db: Db, dataDir: string): DeploymentConfig {
  const dc = getDeploymentConfig(db);
  const patch: Partial<{ status: DeploymentConfig['status']; publicUrl: string | null }> = {};

  // Compute publicUrl per mode.
  //   local     — null
  //   domain    — from config.domain (Caddy will hit LE; URL is knowable up front)
  //   cf-named  — from config.domain (user sets it in CF dashboard)
  //   cf-quick  — from the sidecar file written by entrypoint's stdout parser
  //                once cloudflared connects. May be null on early polls.
  let nextUrl: string | null | undefined = undefined;
  let cfQuickUrlReady = false;
  switch (dc.mode) {
    case 'local':
      nextUrl = null;
      break;
    case 'domain':
      nextUrl = dc.domain ? `https://${dc.domain}/` : null;
      break;
    case 'cf-named':
      nextUrl = dc.domain ? `https://${dc.domain}/` : null;
      break;
    case 'cf-quick': {
      const p = join(dataDir, '.deployment-public-url');
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, 'utf8').trim();
          if (raw.length > 0) {
            nextUrl = raw;
            cfQuickUrlReady = true;
          }
        } catch (e) {
          logger.warn({ err: (e as Error).message, path: p }, 'deployment-sync: sidecar read failed');
        }
      }
      // else: cloudflared still connecting; leave whatever is in DB (probably null).
      break;
    }
  }

  if (nextUrl !== undefined && nextUrl !== dc.publicUrl) {
    patch.publicUrl = nextUrl;
  }

  // cf-quick baseline seed: if publicUrl is transitioning null → non-null AND
  // lastKnownPublicUrl is still null, seed lastKnownPublicUrl at the same time.
  // This is a one-shot operation — once lastKnownPublicUrl is set, the boot-time
  // detectPublicUrlDrift call handles all subsequent drift detection.
  // Do NOT set publicUrlChangedAt — this is baseline seeding, not a drift event.
  if (
    patch.publicUrl !== undefined &&
    patch.publicUrl !== null &&
    dc.publicUrl === null &&
    dc.lastKnownPublicUrl === null
  ) {
    db.update(deploymentConfig)
      .set({ lastKnownPublicUrl: patch.publicUrl })
      .where(eq(deploymentConfig.id, 1))
      .run();
  }

  // Status: pending/applying -> ready. Special case for cf-quick — hold in
  // 'applying' until the URL sidecar file lands, so the wizard keeps polling
  // and doesn't advance to step 4 with publicUrl=null.
  if (dc.status === 'pending' || dc.status === 'applying') {
    if (dc.mode === 'cf-quick' && !cfQuickUrlReady) {
      // Force status='applying' if it's still 'pending' — keeps the wizard in
      // its spinner state accurately.
      if (dc.status === 'pending') patch.status = 'applying';
    } else {
      patch.status = 'ready';
    }
  }

  if (Object.keys(patch).length === 0) return dc;
  return updateDeploymentConfig(db, patch);
}
