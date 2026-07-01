import type { Db } from '../db';
import { logger } from '../log';
import { reapPairSessions } from './pair-sessions';
import { reapSourceStatus } from './source-status';
import { reapClaimTokens } from './claim-tokens';
import { nowSec } from '../lib/time';

const REAP_INTERVAL_MS = 5 * 60_000;

export function startReaper(db: Db): () => void {
  const tick = () => {
    try {
      const now = nowSec();
      const pair = reapPairSessions(db, now);
      const status = reapSourceStatus(db, now);
      const claims = reapClaimTokens(db, now);
      if (pair + status + claims > 0) {
        logger.debug({ pair, status, claims }, 'reaped expired rows');
      }
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'reaper sweep failed');
    }
  };
  tick(); // sweep immediately on startup
  const handle = setInterval(tick, REAP_INTERVAL_MS);
  return () => clearInterval(handle);
}
