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
}

export interface AudioTrack { id: string; language?: string; label?: string }
export interface SubtitleTrack { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

export interface SourceAdapter {
  readonly type: SourceType;
  startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }>;
  home(ctx: SourceContext): Promise<HomeRow[]>;
  search(ctx: SourceContext, query: string): Promise<Item[]>;
  library(ctx: SourceContext, libraryId?: string, path?: string): Promise<BrowseResult>;
  item(ctx: SourceContext, id: string): Promise<ItemDetail>;
  resolveStream(ctx: SourceContext, id: string): Promise<PlayResolution>;
  saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void>;
}
