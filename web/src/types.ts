export type ItemKind = 'movie' | 'show' | 'episode' | 'folder';

export interface Item {
  id: string;
  type: ItemKind;
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

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
}
