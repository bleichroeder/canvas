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
  /** Episode-only: parent show's id. When set, PosterCard navigates to the
   *  show's ItemDetail instead of the episode's, so home-row clicks land on
   *  the tabbed show view with queue-building on episode click. */
  showId?: string;
  /** Episode-only: season number. */
  season?: number;
  /** Episode-only: episode number within the season. */
  episode?: number;
  /** Section type for library-list entries (e.g. 'movie', 'show', 'artist', 'photo'). */
  librarySectionType?: string;
  /**
   * Music-content hint. PosterCard renders 1:1 square covers for these; the
   * Library view switches to an album-detail layout when it sees a page of
   * music-track items together with a `BrowseResult.albumDetail`.
   */
  kind?: 'music-artist' | 'music-album' | 'music-track';
  /** Music: album title (set on tracks). */
  albumTitle?: string;
  /** Music: artist name (set on tracks and albums). */
  artistName?: string;
  /** Music: 1-indexed track number within the album. */
  trackNumber?: number;
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
  /**
   * Present when the items being browsed are tracks of a single album. The
   * Library view uses this to switch from a grid to an album-detail layout
   * (cover + title + artist at top, vertical track list below).
   */
  albumDetail?: {
    title: string;
    artist?: string;
    cover?: string;
    year?: number;
  };
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
