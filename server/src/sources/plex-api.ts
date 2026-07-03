import { PlexHttpError } from '../errors';
import type { SourceContext, Item } from './types';

export async function plexFetch<T = unknown>(
  ctx: SourceContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${ctx.baseUrl}${path}`;
  // Build a plain-object headers map so tests can assert on named keys.
  const existingHeaders: Record<string, string> =
    init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : (init.headers as Record<string, string> | undefined) ?? {};
  const headers: Record<string, string> = {
    ...existingHeaders,
    'X-Plex-Token': ctx.token,
    'Accept': 'application/json',
    'X-Plex-Client-Identifier': 'canvas',
  };
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new PlexHttpError(res.status, path, body);
  }
  return res.json() as Promise<T>;
}

export interface PlexStream {
  id?: number;
  streamType?: number;
  format?: string;
  codec?: string;
  language?: string;
  languageTag?: string;
  displayTitle?: string;
  title?: string;
  selected?: boolean;
}

export interface PlexMetadata {
  ratingKey: string;
  type: string;
  title: string;
  year?: number;
  thumb?: string;
  art?: string;
  duration?: number;
  viewOffset?: number;
  summary?: string;
  rating?: number;
  Genre?: { tag: string }[];
  Media?: { duration?: number; Part?: { id?: number; key: string; Stream?: PlexStream[] }[] }[];
  // Episode-only fields:
  grandparentTitle?: string;  // show name (also: artist name for music tracks)
  grandparentThumb?: string;  // show 2:3 poster (also: artist image for music)
  parentIndex?: number;       // season number (also: disc number for music)
  index?: number;             // episode number (also: track number for music)
  // Music-only / shared fields:
  parentTitle?: string;       // album title (for tracks) / artist name (for albums)
  parentThumb?: string;       // album cover (for tracks) / artist image (for albums)
  parentYear?: number;
  parentRatingKey?: string;   // parent id (season's show, track's album, etc.)
}

/**
 * Wrap a Plex relative image path through Plex's photo-transcoder endpoint to
 * serve a width-bounded variant. Plex preserves aspect ratio. Reduces poster
 * thumbnail bytes by an order of magnitude vs. the original 1000+ px source.
 */
export function transcodeImage(ctx: SourceContext, path: string | undefined, width: number): string | undefined {
  if (!path) return undefined;
  const params = new URLSearchParams({
    width: String(width),
    height: String(width),
    minSize: '1',
    upscale: '1',
    url: path,
    'X-Plex-Token': ctx.token,
  });
  return `${ctx.baseUrl}/photo/:/transcode?${params.toString()}`;
}

// Default sizes that comfortably cover every poster surface we render.
const POSTER_WIDTH = 400;
const BACKDROP_WIDTH = 1280;

export function mapMetadata(
  ctx: SourceContext,
  m: PlexMetadata,
  typeOverride?: 'movie' | 'show' | 'episode' | 'folder',
): Item {
  let type: Item['type'];
  if (typeOverride) type = typeOverride;
  else if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') type = m.type;
  // Music tracks are playable leaves — route them to /item/<src>/<id> like a
  // movie. Artists and albums stay as 'folder' so /lib/<src>/<id> drills into
  // their children via /library/metadata/<id>/children.
  else if (m.type === 'track') type = 'movie';
  else type = 'folder';
  // Derive hasCC only when the bulk request was made with includeStreams=1
  // (otherwise Stream entries are absent and we can't claim either way).
  const streams = m.Media?.[0]?.Part?.[0]?.Stream;
  const hasCC = streams ? streams.some((s) => s.streamType === 3) : undefined;

  // For episodes, render in mixed rails using the show's 2:3 poster (so it's
  // visually uniform with movies/shows) and surface season/episode details so
  // the card subtitle can show "S2·E5 · {episode title}" while the title is
  // the show name.
  const isEpisode = type === 'episode';
  // Music covers come from the album thumb (or, for tracks, the parent
  // album's thumb). Plex serves them at 1:1 aspect.
  let posterPath: string | undefined;
  if (isEpisode && m.grandparentThumb) posterPath = m.grandparentThumb;
  else if (m.type === 'track' && m.parentThumb) posterPath = m.parentThumb;
  else posterPath = m.thumb;
  const kind: Item['kind'] | undefined =
    m.type === 'artist' ? 'music-artist'
    : m.type === 'album' ? 'music-album'
    : m.type === 'track' ? 'music-track'
    : undefined;
  const year = m.year ?? (m.type === 'album' ? m.parentYear : undefined);
  const poster = transcodeImage(ctx, posterPath, POSTER_WIDTH);
  const durationSec = m.duration ? Math.round(m.duration / 1000) : undefined;
  const viewOffsetSec = m.viewOffset ? Math.round(m.viewOffset / 1000) : undefined;
  return {
    id: m.ratingKey,
    type,
    title: m.title,
    ...(year !== undefined ? { year } : {}),
    ...(poster !== undefined ? { poster } : {}),
    ...(durationSec !== undefined ? { durationSec } : {}),
    ...(viewOffsetSec !== undefined ? { viewOffsetSec } : {}),
    ...(m.rating !== undefined ? { rating: m.rating } : {}),
    ...(hasCC ? { hasCC: true } : {}),
    ...(isEpisode && m.grandparentTitle ? { showTitle: m.grandparentTitle } : {}),
    ...(isEpisode && m.parentIndex !== undefined ? { season: m.parentIndex } : {}),
    ...(isEpisode && m.index !== undefined ? { episode: m.index } : {}),
    ...(kind ? { kind } : {}),
    ...(m.type === 'track' && m.parentTitle ? { albumTitle: m.parentTitle } : {}),
    ...(m.type === 'album' && m.parentTitle ? { artistName: m.parentTitle } : {}),
    ...(m.type === 'track' && m.grandparentTitle ? { artistName: m.grandparentTitle } : {}),
    ...(m.type === 'track' && m.index !== undefined ? { trackNumber: m.index } : {}),
  };
}

export const PLEX_BACKDROP_WIDTH = BACKDROP_WIDTH;
export const PLEX_POSTER_WIDTH = POSTER_WIDTH;

export interface PlexSection {
  key: string;
  type: string;
  title: string;
  art?: string;
  composite?: string;
}
