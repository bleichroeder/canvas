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
    throw new Error(`Plex ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
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
}

function imageUrl(ctx: SourceContext, path: string | undefined): string | undefined {
  if (!path) return undefined;
  // thumb/art are relative Plex paths; suffix with auth token.
  const sep = path.includes('?') ? '&' : '?';
  return `${ctx.baseUrl}${path}${sep}X-Plex-Token=${encodeURIComponent(ctx.token)}`;
}

export function mapMetadata(
  ctx: SourceContext,
  m: PlexMetadata,
  typeOverride?: 'movie' | 'show' | 'episode' | 'folder',
): Item {
  let type: Item['type'];
  if (typeOverride) type = typeOverride;
  else if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') type = m.type;
  else type = 'folder';
  return {
    id: m.ratingKey,
    type,
    title: m.title,
    year: m.year,
    poster: imageUrl(ctx, m.thumb),
    durationSec: m.duration ? Math.round(m.duration / 1000) : undefined,
    viewOffsetSec: m.viewOffset ? Math.round(m.viewOffset / 1000) : undefined,
  };
}

export interface PlexSection {
  key: string;
  type: string;
  title: string;
}
