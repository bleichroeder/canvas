import type { Item } from '../types';

// A lightweight, non-reactive queue capturing the ordered list a YouTube video
// was launched from (search results, a channel, a rail). YouTube has no real
// "up next" recommendations available through yt-dlp, so "next" means the next
// item in that browsing context. Set on card click; read by the player to drive
// Next/Prev and end-of-video autoplay. `next`/`prev` are resolved by the current
// video's id, so a video opened outside any list (id not found) never advances.

interface YouTubeQueue { source: string; items: Item[] }
let queue: YouTubeQueue | null = null;

export function setYouTubeQueue(source: string, items: Item[]): void {
  const playable = items.filter((it) => it.type !== 'folder');
  queue = playable.length > 0 ? { source, items: playable } : null;
}

export function clearYouTubeQueue(): void {
  queue = null;
}

export function getYouTubeNext(source: string, currentId: string): Item | null {
  if (!queue || queue.source !== source) return null;
  const i = queue.items.findIndex((it) => it.id === currentId);
  if (i < 0 || i + 1 >= queue.items.length) return null;
  return queue.items[i + 1] ?? null;
}

export function getYouTubePrev(source: string, currentId: string): Item | null {
  if (!queue || queue.source !== source) return null;
  const i = queue.items.findIndex((it) => it.id === currentId);
  if (i <= 0) return null;
  return queue.items[i - 1] ?? null;
}
