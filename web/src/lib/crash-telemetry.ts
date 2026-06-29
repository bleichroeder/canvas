// Player crash telemetry.
//
// The Tesla MCU3 browser kills the renderer process under memory pressure
// without any JS observable beyond "page reload". To diagnose, we drop a
// session marker into localStorage at Player mount, refresh it periodically
// during playback, and remove it on a clean unmount. On the next cold app
// load, if the marker is still there, we know the previous session was killed
// mid-playback — we append a crash record to the log so it shows up in
// Settings → About → Diagnostics.
//
// Everything is best-effort; localStorage failures are swallowed silently.

const KEY_SESSION = 'canvas.playerSession';
const KEY_LOG = 'canvas.crashLog';
const MAX_LOG_ENTRIES = 10;
// If the marker hasn't been refreshed for this long, treat it as stale (browser
// closed cleanly between sessions) rather than a crash.
const STALE_THRESHOLD_MS = 5 * 60_000;

export interface SessionInfo {
  source: string;
  id: string;
  startedAt: number;
  lastUpdate: number;
  posSec: number;
  heapMB?: number;
  droppedFrames?: number;
}

export interface CrashRecord {
  source: string;
  id: string;
  startedAt: number;
  crashedAt: number;
  posSec: number;
  heapMB?: number;
  droppedFrames?: number;
}

export function startSession(info: Omit<SessionInfo, 'lastUpdate'>): void {
  try {
    localStorage.setItem(
      KEY_SESSION,
      JSON.stringify({ ...info, lastUpdate: info.startedAt }),
    );
  } catch { /* ignore */ }
}

export function updateSession(
  patch: Partial<Omit<SessionInfo, 'source' | 'id' | 'startedAt'>>,
): void {
  try {
    const raw = localStorage.getItem(KEY_SESSION);
    if (!raw) return;
    const cur = JSON.parse(raw) as SessionInfo;
    const next: SessionInfo = { ...cur, ...patch, lastUpdate: Date.now() };
    localStorage.setItem(KEY_SESSION, JSON.stringify(next));
  } catch { /* ignore */ }
}

export function endSession(): void {
  try { localStorage.removeItem(KEY_SESSION); } catch { /* ignore */ }
}

/**
 * Call once at app boot. If a session marker exists from a previous run,
 * treat it as a crash (renderer was killed mid-playback), append to the log,
 * and clear the marker. Returns the crash record if one was detected.
 */
export function checkForPreviousCrash(): CrashRecord | null {
  try {
    const raw = localStorage.getItem(KEY_SESSION);
    if (!raw) return null;
    const info = JSON.parse(raw) as SessionInfo;
    if (Date.now() - info.lastUpdate > STALE_THRESHOLD_MS) {
      localStorage.removeItem(KEY_SESSION);
      return null;
    }
    const record: CrashRecord = {
      source: info.source,
      id: info.id,
      startedAt: info.startedAt,
      crashedAt: info.lastUpdate,
      posSec: info.posSec,
      heapMB: info.heapMB,
      droppedFrames: info.droppedFrames,
    };
    const log = getCrashLog();
    log.unshift(record);
    if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
    localStorage.setItem(KEY_LOG, JSON.stringify(log));
    localStorage.removeItem(KEY_SESSION);
    return record;
  } catch {
    return null;
  }
}

export function getCrashLog(): CrashRecord[] {
  try {
    const raw = localStorage.getItem(KEY_LOG);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CrashRecord[]) : [];
  } catch {
    return [];
  }
}

export function clearCrashLog(): void {
  try { localStorage.removeItem(KEY_LOG); } catch { /* ignore */ }
}

/** Returns current JS heap usage in MB, or undefined when not available. */
export function currentHeapMB(): number | undefined {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  if (!mem?.usedJSHeapSize) return undefined;
  return Math.round(mem.usedJSHeapSize / 1_000_000);
}
