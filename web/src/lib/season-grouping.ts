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
 * Return the season number to select by default. Prefers the season of the
 * furthest-along in-progress episode (highest index in the whole-show queue
 * with viewOffsetSec > 0). If nothing is in progress, returns the lowest
 * season number present. Returns 0 for an empty list.
 */
export function pickDefaultSeason(episodes: Episode[]): number {
  if (episodes.length === 0) return 0;
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
