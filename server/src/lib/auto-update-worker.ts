import type { Db } from '../db';
import type { WatchtowerClient } from './watchtower-client';
import { getUpdatePreferences, setUpdatePreferences } from '../storage/update-preferences';
import { getUpdateStatus } from './update-checker';
import { logger } from '../log';
import { nowSec } from './time';

export interface AutoUpdateWorkerOptions {
  getDb: () => Db;
  watchtowerClient: WatchtowerClient;
  currentVersion: string;
  intervalMs?: number;
}

/**
 * Periodic worker (default: every 15 minutes) that checks GitHub Releases
 * (via sub-project M's cached helper) and, when `autoUpdate` is on in the
 * preferences singleton, calls Watchtower's /v1/update. Failures are
 * caught and logged; the interval keeps ticking.
 *
 * First tick is deferred by intervalMs (not immediate) to give canvas boot
 * time to finish before we start hitting external services.
 */
export function startAutoUpdateWorker(opts: AutoUpdateWorkerOptions): { stop(): void } {
  const intervalMs = opts.intervalMs ?? 15 * 60 * 1000;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const db = opts.getDb();
      setUpdatePreferences(db, { lastAutoCheckAt: nowSec() });
      const prefs = getUpdatePreferences(db);
      if (!prefs.autoUpdate) return;
      const status = await getUpdateStatus(opts.currentVersion);
      if (!status.updateAvailable) return;
      logger.info(
        { latestVersion: status.latestVersion, currentVersion: opts.currentVersion },
        'auto-update: triggering watchtower',
      );
      await opts.watchtowerClient.triggerUpdate();
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'auto-update worker tick failed');
    }
  };

  const handle = setInterval(tick, intervalMs);
  return {
    stop(): void {
      stopped = true;
      clearInterval(handle);
    },
  };
}
