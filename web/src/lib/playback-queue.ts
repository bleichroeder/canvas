import type { Episode } from '../types';

export interface PlaybackQueue {
  showId: string;
  showTitle: string;
  sourceId: string;
  episodes: Episode[];
  currentIndex: number;
}

let currentQueue: PlaybackQueue | null = null;

export function setQueue(q: PlaybackQueue): void {
  currentQueue = q;
}

export function getQueue(): PlaybackQueue | null {
  return currentQueue;
}

export function clearQueue(): void {
  currentQueue = null;
}

/** Build a queue from the show's episode list, sorted (season asc, episode asc). */
export function buildQueue(params: {
  showId: string;
  showTitle: string;
  sourceId: string;
  episodes: Episode[];
  playingEpisodeId: string;
}): PlaybackQueue {
  const sorted = [...params.episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
  const idx = sorted.findIndex((e) => e.id === params.playingEpisodeId);
  return {
    showId: params.showId,
    showTitle: params.showTitle,
    sourceId: params.sourceId,
    episodes: sorted,
    currentIndex: idx < 0 ? 0 : idx,
  };
}
