export type SourceType = 'plex' | 'jellyfin' | 'flixify' | 'generic';

export interface SourceContext {
  baseUrl: string;
  token: string;
}

export interface Item {
  id: string;
  type: 'movie' | 'show' | 'episode' | 'folder';
  title: string;
  year?: number;
  poster?: string;
  durationSec?: number;
  viewOffsetSec?: number;
  /** Numeric 0-10 rating from the source's metadata agent (TMDB / IMDb / etc.). */
  rating?: number;
  /** True when the source advertises at least one embedded subtitle stream. */
  hasCC?: boolean;
  /** Episode-only: parent show name. */
  showTitle?: string;
  /** Episode-only: season number. */
  season?: number;
  /** Episode-only: episode number within the season. */
  episode?: number;
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

export interface BrowsePage {
  offset: number;
  limit: number;
}

export interface AudioTrack { id: string; language?: string; label?: string }
export interface SubtitleTrack { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  /**
   * Optional URL template for scrub-bar preview thumbnails. Contains the literal
   * substring "{ms}" the client replaces with a rounded millisecond offset.
   */
  thumbnailUrlTemplate?: string;
}

export interface SourceAdapter {
  readonly type: SourceType;
  startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }>;
  home(ctx: SourceContext): Promise<HomeRow[]>;
  search(ctx: SourceContext, query: string): Promise<Item[]>;
  library(ctx: SourceContext, libraryId?: string, path?: string, page?: BrowsePage): Promise<BrowseResult>;
  item(ctx: SourceContext, id: string): Promise<ItemDetail>;
  /**
   * Resolve a playable URL.
   * @param fromSec If provided, the stream should start at this position in seconds.
   *                Adapters that don't support seek can ignore the param (player will
   *                still call this on each seek but the URL won't change).
   */
  resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution>;
  saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void>;
}
