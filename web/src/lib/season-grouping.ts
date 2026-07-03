import type { Episode } from '../types';

/** Group episodes by season number. Map iteration order is ascending season. */
export function groupBySeason(episodes: Episode[]): Map<number, Episode[]> {
  const seasons = new Map<number, Episode[]>();
  for (const ep of episodes) {
    const list = seasons.get(ep.season);
    if (list) list.push(ep);
    else seasons.set(ep.season, [ep]);
  }
  // Sort each season's episodes by episode number ascending.
  for (const list of seasons.values()) {
    list.sort((a, b) => a.episode - b.episode);
  }
  // Return a new Map with keys in ascending season order.
  const sortedKeys = [...seasons.keys()].sort((a, b) => a - b);
  const out = new Map<number, Episode[]>();
  for (const k of sortedKeys) out.set(k, seasons.get(k)!);
  return out;
}

/**
 * Return the season number to select by default.
 *
 * Priority:
 *   1. If `highlightEpisodeId` is given and matches an episode, that episode's season.
 *      Used when arriving from a Continue Watching / recently-added click that
 *      wants the tab pointed at a specific episode.
 *   2. Otherwise, the season of the furthest-along in-progress episode (highest
 *      index in the whole-show queue with viewOffsetSec > 0).
 *   3. Otherwise, the lowest season number present.
 *
 * Returns 0 for an empty list.
 */
export function pickDefaultSeason(episodes: Episode[], highlightEpisodeId?: string): number {
  if (episodes.length === 0) return 0;
  if (highlightEpisodeId) {
    const target = episodes.find((e) => e.id === highlightEpisodeId);
    if (target) return target.season;
  }
  const sorted = [...episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    if ((sorted[i]!.viewOffsetSec ?? 0) > 0) return sorted[i]!.season;
  }
  return sorted[0]!.season;
}

/** Label for a season tab. Plex uses parentIndex=0 for specials/extras. */
export function seasonLabel(season: number): string {
  return season === 0 ? 'Specials' : `S${season}`;
}
