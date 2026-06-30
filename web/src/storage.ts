/**
 * StoredSource — kept for type-compatibility with legacy import sites while
 * the migration is in progress, but local source persistence is removed.
 * Sources now live on the server and are fetched via api.listSources() /
 * SourcesContext. The `token` field is intentionally absent from the server
 * response (server-side only).
 *
 * @deprecated Use ApiSource from lib/SourcesContext instead.
 */
export interface StoredSource {
  type: 'plex' | 'jellyfin' | 'flixify' | 'generic';
  baseUrl: string;
  token: string;
  label: string;
}

export interface Prefs {
  autoplayNext: boolean;
  defaultSubLang: string;
  defaultAudioLang: string;
  skipIntro: boolean;
}

const PREFS_KEY = 'canvas.prefs';

const DEFAULT_PREFS: Prefs = {
  autoplayNext: true,
  defaultSubLang: '',
  defaultAudioLang: '',
  skipIntro: false,
};

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setPrefs(p: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

const LIBRARY_NAMES_KEY = 'canvas.libraryNames';

export function getLibraryName(srcKey: string, libId: string): string | undefined {
  try {
    const raw = localStorage.getItem(LIBRARY_NAMES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const k = `${srcKey}:${libId}`;
    const v = (parsed as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setLibraryName(srcKey: string, libId: string, name: string): void {
  try {
    const raw = localStorage.getItem(LIBRARY_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === 'object' && parsed !== null) {
      (parsed as Record<string, string>)[`${srcKey}:${libId}`] = name;
      localStorage.setItem(LIBRARY_NAMES_KEY, JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
}

const ITEM_TITLES_KEY = 'canvas.itemTitles';

export function getItemTitle(srcKey: string, itemId: string): string | undefined {
  try {
    const raw = localStorage.getItem(ITEM_TITLES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const k = `${srcKey}:${itemId}`;
    const v = (parsed as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setItemTitle(srcKey: string, itemId: string, title: string): void {
  try {
    const raw = localStorage.getItem(ITEM_TITLES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === 'object' && parsed !== null) {
      (parsed as Record<string, string>)[`${srcKey}:${itemId}`] = title;
      localStorage.setItem(ITEM_TITLES_KEY, JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
}

// Now-playing — most-recently-played item, surfaced by the persistent footer.
export interface NowPlaying {
  src: string;
  id: string;
  title: string;
  poster?: string;
  posSec: number;
  durationSec: number;
  ts: number;
}

const NOW_PLAYING_KEY = 'canvas.nowPlaying';
export const NOW_PLAYING_EVENT = 'canvas:nowPlayingUpdated';

export function getNowPlaying(): NowPlaying | undefined {
  try {
    const raw = localStorage.getItem(NOW_PLAYING_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const np = parsed as NowPlaying;
    if (typeof np.src !== 'string' || typeof np.id !== 'string') return undefined;
    if (Date.now() - np.ts > 7 * 24 * 60 * 60 * 1000) return undefined;
    return np;
  } catch {
    return undefined;
  }
}

export function setNowPlaying(np: NowPlaying): void {
  try {
    localStorage.setItem(NOW_PLAYING_KEY, JSON.stringify(np));
    window.dispatchEvent(new Event(NOW_PLAYING_EVENT));
  } catch { /* ignore */ }
}

export function updateNowPlayingProgress(src: string, id: string, posSec: number): void {
  const cur = getNowPlaying();
  if (!cur || cur.src !== src || cur.id !== id) return;
  setNowPlaying({ ...cur, posSec, ts: Date.now() });
}

export function clearNowPlaying(): void {
  try {
    localStorage.removeItem(NOW_PLAYING_KEY);
    window.dispatchEvent(new Event(NOW_PLAYING_EVENT));
  } catch { /* ignore */ }
}

// Caption timing offset — global pref persisted across sessions. Range
// roughly ±5000ms covers typical Plex-transcoder drift.
const CAPTIONS_OFFSET_KEY = 'canvas.captionsOffsetMs';

export function getCaptionsOffsetMs(): number {
  try {
    const raw = localStorage.getItem(CAPTIONS_OFFSET_KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function setCaptionsOffsetMs(ms: number): void {
  try {
    localStorage.setItem(CAPTIONS_OFFSET_KEY, String(Math.round(ms)));
  } catch { /* ignore */ }
}
