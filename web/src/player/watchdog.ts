import { emit } from './diagnostics';

export interface StallWatchdogOpts {
  getAudioClockSec: () => number;
  /** Injectable clock for tests; defaults to performance.now(). */
  nowMs?: () => number;
}

const TICK_INTERVAL_MS = 2000;
/** Number of consecutive silent ticks before a stall is declared (5 × 2s = 10s). */
const SILENT_TICKS_FOR_STALL = 5;
/** Minimum clock advance (seconds) required to count a tick as "progressing". */
const MIN_ADVANCE_SEC = 1;

export function createStallWatchdog(opts: StallWatchdogOpts): {
  start(): void;
  stop(): void;
  tick(): void;
} {
  const nowMs = opts.nowMs ?? (() => performance.now());
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastClockSec = opts.getAudioClockSec();
  let silentSince: number | null = null;
  let consecutiveSilent = 0;

  function tick(): void {
    const currentClock = opts.getAudioClockSec();
    const advanced = currentClock - lastClockSec >= MIN_ADVANCE_SEC;
    if (advanced) {
      lastClockSec = currentClock;
      silentSince = null;
      consecutiveSilent = 0;
      return;
    }
    // Mark the start of the silent window using the *previous* tick's timestamp
    // so that the accumulated silent duration equals ticks × interval.
    if (silentSince === null) silentSince = nowMs() - TICK_INTERVAL_MS;
    consecutiveSilent += 1;
    if (consecutiveSilent >= SILENT_TICKS_FOR_STALL) {
      const silentDurationSec = Math.round((nowMs() - silentSince) / 1000);
      emit('stall_detected', { silentDurationSec });
      // Reset window so we can emit again if the stall continues.
      consecutiveSilent = 0;
      silentSince = nowMs();
    }
  }

  return {
    start(): void {
      if (intervalId !== null) return;
      intervalId = setInterval(tick, TICK_INTERVAL_MS);
    },
    stop(): void {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    tick, // exposed for tests
  };
}
