import { useSyncExternalStore } from 'react';
import { api, type YoutubeLike } from '../api';

// Global cache of the user's liked YouTube videos, kept OUTSIDE the router so a
// heart tapped on a card, in the player, or on the YouTube page stays in sync
// everywhere at once. The server is the source of truth; this mirrors it and
// applies optimistic updates so the heart flips instantly.

let likes: YoutubeLike[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
function emitChange(): void { for (const l of listeners) l(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Fetch the liked list once (idempotent). Safe to call from any mount. */
export function ensureLikesLoaded(): Promise<void> {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = api.youtubeLikes.list().then(
    (rows) => { likes = rows; loaded = true; loading = null; emitChange(); },
    () => { loading = null; /* leave unloaded so a later call retries */ },
  );
  return loading;
}

export function getLikes(): YoutubeLike[] { return likes; }

export function useLikes(): YoutubeLike[] {
  return useSyncExternalStore(subscribe, getLikes, getLikes);
}

/** Reactive membership check for a single video id. */
export function useIsLiked(ytId: string): boolean {
  const all = useLikes();
  return all.some((l) => l.ytId === ytId);
}

export interface LikeableVideo {
  ytId: string;
  title: string;
  thumbnail?: string | null;
  channelId?: string | null;
  channelTitle?: string | null;
  durationSec?: number | null;
}

/**
 * Toggle a video's liked state, updating the local cache optimistically and
 * reverting if the server rejects it.
 */
export async function toggleLike(v: LikeableVideo): Promise<void> {
  const wasLiked = likes.some((l) => l.ytId === v.ytId);
  const prev = likes;
  if (wasLiked) {
    likes = likes.filter((l) => l.ytId !== v.ytId);
    emitChange();
    try {
      await api.youtubeLikes.remove(v.ytId);
    } catch {
      likes = prev; emitChange();
    }
  } else {
    // Optimistic placeholder (negative id) until the server row comes back.
    const optimistic: YoutubeLike = {
      id: -1,
      ytId: v.ytId,
      title: v.title,
      thumbnail: v.thumbnail ?? null,
      channelId: v.channelId ?? null,
      channelTitle: v.channelTitle ?? null,
      durationSec: v.durationSec ?? null,
      createdAt: 0,
    };
    likes = [optimistic, ...likes];
    emitChange();
    try {
      const row = await api.youtubeLikes.add({
        ytId: v.ytId,
        title: v.title,
        thumbnail: v.thumbnail ?? null,
        channelId: v.channelId ?? null,
        channelTitle: v.channelTitle ?? null,
        durationSec: v.durationSec ?? null,
      });
      likes = [row, ...likes.filter((l) => l.ytId !== v.ytId)];
      emitChange();
    } catch {
      likes = prev; emitChange();
    }
  }
}
