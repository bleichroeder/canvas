import type { Item } from '../types';

// The YouTube page's search is local component state, so navigating into the
// player unmounts it and a back-navigation would otherwise remount it empty.
// This module-level cache (keyed by source) lets the page restore the query,
// results, paging cursor, and scroll position instantly on return — no re-fetch.

export interface YouTubeSearchState {
  q: string;
  results: (Item & { source: string })[];
  offset: number;
  hasMore: boolean;
  scrollY: number;
}

const cache = new Map<string, YouTubeSearchState>();

/** Persist the current search for `source`. An empty query clears the entry. */
export function saveYouTubeSearch(source: string, state: YouTubeSearchState): void {
  if (!state.q.trim()) { cache.delete(source); return; }
  cache.set(source, state);
}

export function loadYouTubeSearch(source: string): YouTubeSearchState | undefined {
  return cache.get(source);
}
