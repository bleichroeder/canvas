import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db';
import { getDeploymentConfig, updateDeploymentConfig } from '../storage/deployment-config';
import type { DeploymentConfig } from '../db/schema';
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
  let patch: Partial<{ status: DeploymentConfig['status']; publicUrl: string | null }> = {};

  // Status: pending/applying -> ready. If entrypoint failed to spawn something
  // it would have exit(1)'d and Bun wouldn't have booted at all.
  if (dc.status === 'pending' || dc.status === 'applying') {
    patch.status = 'ready';
  }

  // Compute publicUrl.
  let nextUrl: string | null | undefined = undefined;
  switch (dc.mode) {
    case 'local':
      nextUrl = null;
      break;
    case 'domain':
      nextUrl = dc.domain ? `https://${dc.domain}/` : null;
      break;
    case 'cf-named':
      // Named tunnels expose the URL the user configured in CF dashboard;
      // we don't know the exact hostname unless the user saved it into
      // `domain`. Fall back to null when no domain is stored.
      nextUrl = dc.domain ? `https://${dc.domain}/` : null;
      break;
    case 'cf-quick': {
      const p = join(dataDir, '.deployment-public-url');
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, 'utf8').trim();
          nextUrl = raw.length > 0 ? raw : null;
        } catch (e) {
          logger.warn({ err: (e as Error).message, path: p }, 'deployment-sync: sidecar read failed');
          nextUrl = null;
        }
      } else {
        // File may appear soon (cloudflared still connecting); leave whatever
        // is in DB and let the next poll try again.
        nextUrl = undefined;
      }
      break;
    }
  }

  if (nextUrl !== undefined && nextUrl !== dc.publicUrl) {
    patch.publicUrl = nextUrl;
  }

  if (Object.keys(patch).length === 0) return dc;
  return updateDeploymentConfig(db, patch);
}
