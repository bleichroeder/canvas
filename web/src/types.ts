export type ItemKind = 'movie' | 'show' | 'episode' | 'folder';

export interface Item {
  id: string;
  type: ItemKind;
  title: string;
  year?: number;
  poster?: string;
  durationSec?: number;
  viewOffsetSec?: number;
  /** Numeric 0-10 rating from the source's metadata agent. */
  rating?: number;
  /** True when the source advertises at least one embedded subtitle stream. */
  hasCC?: boolean;
  /** Episode-only: parent show name. */
  showTitle?: string;
  /** Episode-only: season number. */
  season?: number;
  /** Episode-only: episode number within the season. */
  episode?: number;
  /** Section type for library-list entries (e.g. 'movie', 'show', 'artist', 'photo'). */
  librarySectionType?: string;
}

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  durationSec?: number;
  viewOffsetSec?: number;
  synopsis?: string;
  poster?: string;
}

export interface ItemDetail extends Item {
  backdrop?: string;
  synopsis?: string;
  rating?: number;
  episodes?: Episode[];
  intro?: { startSec: number; endSec: number };
  credits?: { startSec: number; endSec: number };
}

export interface HomeRow {
  kind: 'continue' | 'recent' | 'libraries';
  title: string;
  items: Item[];
}

export interface BrowseResult {
  breadcrumbs: { name: string; libraryId?: string; path?: string }[];
  items: Item[];
  totalSize?: number;
}

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
}

export interface SourceHomeResponse {
  continueWatching: Item[];
  recentlyAdded: Item[];
  libraries: Item[];
}
