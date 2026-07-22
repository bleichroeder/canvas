import { useSyncExternalStore } from 'react';
import { api, type YoutubeHistoryEntry } from '../api';

// Global cache of the user's YouTube watch history + resume positions. Mirrors
// the likes store: the server is the source of truth, this mirrors it and
// applies optimistic updates so the "Continue watching" rail and resume-on-click
// stay fresh without a refetch after a video plays.

let history: YoutubeHistoryEntry[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function emitChange(): void { for (const l of listeners) l(); }
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Fetch the history once (idempotent). Safe to call from any mount. */
export function ensureHistoryLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = api.youtubeHistory.list().then(
    (rows) => { history = rows; loaded = true; loading = null; emitChange(); },
    () => { loading = null; /* leave unloaded so a later call retries */ },
  );
  return loading;
}

export function getHistory(): YoutubeHistoryEntry[] { return history; }

export function useHistory(): YoutubeHistoryEntry[] {
  return useSyncExternalStore(subscribe, getHistory, getHistory);
}

/** Resume position (seconds) for a video id — 0 if not watched / not loaded. */
export function getResumeSec(ytId: string): number {
  return history.find((h) => h.ytId === ytId)?.posSec ?? 0;
}

export interface WatchedVideo {
  ytId: string;
  title: string;
  thumbnail?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  durationSec?: number | null;
}

/**
 * Record/refresh a watched video at `posSec`. Optimistically moves it to the
 * top of the local store so returning to the YouTube page reflects it without a
 * refetch; reconciles with the server row when it comes back.
 */
export async function recordWatch(v: WatchedVideo, posSec: number): Promise<void> {
  const pos = Math.max(0, Math.floor(posSec));
  const existing = history.find((h) => h.ytId === v.ytId);
  const optimistic: YoutubeHistoryEntry = {
    id: existing?.id ?? -1,
    ytId: v.ytId,
    title: v.title,
    thumbnail: v.thumbnail ?? null,
    channelId: v.channelId ?? null,
    channelTitle: v.channelTitle ?? null,
    durationSec: v.durationSec ?? null,
    posSec: pos,
    updatedAt: existing?.updatedAt ?? 0,
  };
  history = [optimistic, ...history.filter((h) => h.ytId !== v.ytId)];
  emitChange();
  try {
    const row = await api.youtubeHistory.record({ ...v, posSec: pos });
    history = [row, ...history.filter((h) => h.ytId !== v.ytId)];
    emitChange();
  } catch { /* keep the optimistic row; the next tick re-records */ }
}

/** Remove one video from history (owner-scoped, optimistic). */
export async function removeFromHistory(ytId: string): Promise<void> {
  const prev = history;
  history = history.filter((h) => h.ytId !== ytId);
  emitChange();
  try { await api.youtubeHistory.remove(ytId); }
  catch { history = prev; emitChange(); }
}
