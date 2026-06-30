import type { Db } from '../db';
import { logger } from '../log';
import { reapPairSessions } from './pair-sessions';
import { reapSourceStatus } from './source-status';
import { nowSec } from '../lib/time';

const REAP_INTERVAL_MS = 5 * 60_000;

export function startReaper(db: Db): () => void {
  const tick = () => {
    const now = nowSec();
    const pair = reapPairSessions(db, now);
    const status = reapSourceStatus(db, now);
    if (pair + status > 0) {
      logger.debug({ pair, status }, 'reaped expired rows');
    }
  };
  tick(); // sweep immediately on startup
  const handle = setInterval(tick, REAP_INTERVAL_MS);
  return () => clearInterval(handle);
}
