import type {
  SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution,
} from './types';

export const FLIXIFY_API_BASE = 'https://flx-srv.com/kodi/api';
// User-Agent that matches the Kodi plugin so Flixify backend treats us the same.
const PLUGIN_VERSION = '2.1.17';
const USER_AGENT = `PP-base Kodi plugin ${PLUGIN_VERSION}`;

// Auth blob shape — JSON-encoded into StoredSource.token. Opaque to the rest
// of canvas; only this adapter parses it.
export interface FlixifyAuth {
  pip: string;
  session: string;
  profile_id?: string;
  /** CDN host for posters/subtitles, learned from /api/site_settings post-pair. */
  asset_host?: string;
  /** Mirror domain for user-facing references (e.g. thecalm.site). */
  mirror?: string;
}

export function parseFlixifyAuth(token: string): FlixifyAuth {
  try {
    const parsed = JSON.parse(token);
    if (parsed && typeof parsed === 'object') return parsed as FlixifyAuth;
  } catch { /* fall through */ }
  return { pip: '', session: '' };
}

export function serializeFlixifyAuth(auth: FlixifyAuth): string {
  return JSON.stringify(auth);
}

function cookieHeader(auth: FlixifyAuth): string {
  const parts: string[] = [];
  if (auth.pip) parts.push(`pip=${auth.pip}`);
  if (auth.session) parts.push(`session=${auth.session}`);
  if (auth.profile_id) parts.push(`profile_id=${auth.profile_id}`);
  return parts.join('; ');
}

/**
 * Parse Set-Cookie response headers and merge into an existing auth blob.
 * Flixify rotates the `session` cookie on each response, so we need to
 * persist updates. Returns a new auth blob if any tracked cookies changed,
 * else the same reference.
 */
export function harvestCookies(res: Response, auth: FlixifyAuth): FlixifyAuth {
  // Set-Cookie can appear multiple times; CF Workers `res.headers.getSetCookie()`
  // returns the array of values.
  const raws = typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
    : res.headers.get('set-cookie')?.split(/,(?=\s*[^=;,\s]+=)/) ?? [];
  let next: FlixifyAuth | null = null;
  for (const raw of raws) {
    const [pair] = raw.split(';');
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name === 'pip' || name === 'session' || name === 'profile_id') {
      if (!next) next = { ...auth };
      (next as Record<string, string | undefined>)[name] = value;
    }
  }
  return next ?? auth;
}

interface FlixifyImages {
  poster?: string;
  preview?: string;
  preview_large?: string;
}

interface FlixifyMetadata {
  id: string | number;
  type: string;  // 'movie' | 'tvshow' | 'tvseason' | 'tvepisode'
  title: string;
  year?: number;
  description?: string;
  rating?: number;
  duration?: number;            // seconds
  watch_progress?: number;
  parent_seq?: number;          // season number for episodes
  seq?: number;                 // episode number for episodes
  tvshow_title?: string;
  images?: FlixifyImages;
  url?: string;
}

function imageUrl(auth: FlixifyAuth, relPath: string | undefined): string | undefined {
  if (!relPath) return undefined;
  if (relPath.startsWith('http://') || relPath.startsWith('https://')) return relPath;
  if (!auth.asset_host) return undefined;
  return `https://${auth.asset_host}${relPath}`;
}

function pickPoster(auth: FlixifyAuth, m: FlixifyMetadata): string | undefined {
  if (!m.images) return undefined;
  // Episodes display their screenshot as poster in mixed rails; the show poster
  // is preferred via separate mapping (handled by canvas's existing episode UX).
  if (m.type === 'tvepisode' && m.images.preview) {
    return imageUrl(auth, m.images.preview);
  }
  return imageUrl(auth, m.images.poster ?? m.images.preview_large ?? m.images.preview);
}

function flixifyTypeToItemType(t: string): Item['type'] {
  switch (t) {
    case 'movie': return 'movie';
    case 'tvshow': return 'show';
    case 'tvepisode': return 'episode';
    case 'tvseason': return 'folder';
    default: return 'folder';
  }
}

function mapItem(auth: FlixifyAuth, m: FlixifyMetadata): Item {
  const type = flixifyTypeToItemType(m.type);
  const isEpisode = type === 'episode';
  return {
    id: String(m.id),
    type,
    title: m.title,
    year: m.year,
    poster: pickPoster(auth, m),
    durationSec: m.duration,
    viewOffsetSec: m.watch_progress,
    ...(m.rating !== undefined ? { rating: m.rating } : {}),
    ...(isEpisode && m.tvshow_title ? { showTitle: m.tvshow_title } : {}),
    ...(isEpisode && m.parent_seq !== undefined ? { season: m.parent_seq } : {}),
    ...(isEpisode && m.seq !== undefined ? { episode: m.seq } : {}),
  };
}

function log(msg: string): void {
  // Mirror Plex adapter's logging style (no-op for now; console.* works in CF).
  console.log(`FLIXIFY: ${msg}`);
}

interface FlixifyResp<T> {
  status: number;
  data: T | null;
  auth: FlixifyAuth;  // possibly-rotated auth
}

/**
 * GET request to the Flixify API. Sends current cookies, harvests rotated
 * cookies from response. Caller threads the returned `auth` forward if it
 * wants to persist rotations.
 */
export async function flixifyGet<T>(
  ctx: SourceContext,
  path: string,
  params?: Record<string, string | number>,
): Promise<FlixifyResp<T>> {
  const auth = parseFlixifyAuth(ctx.token);
  const url = new URL(FLIXIFY_API_BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('_', String(Date.now()));
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Cookie': cookieHeader(auth),
      'User-Agent': USER_AGENT,
      'Accept': 'application/json',
    },
    redirect: 'manual',
  });
  const nextAuth = harvestCookies(res, auth);
  if (!res.ok) {
    if (res.status === 302) {
      throw new Error(`Flixify auth lost (302) on ${path}`);
    }
    throw new Error(`Flixify ${res.status} ${path}`);
  }
  let data: T | null = null;
  try { data = (await res.json()) as T; } catch { data = null; }
  return { status: res.status, data, auth: nextAuth };
}

// ---------------------------------------------------------------------------
// Home / library helpers
// ---------------------------------------------------------------------------

interface KodiHomeList {
  act?: string;       // 'items' | 'search' | 'favorites' | 'collections' | 'profiles' | ...
  title?: string;
  color?: string;
  url?: string;
}

interface KodiHomeResp {
  items: KodiHomeList[];
}

interface PagedItemsResp {
  items: FlixifyMetadata[];
  total?: number;
  page?: number;
  items_per_page?: number;
}

interface ShowDetailResp {
  item: FlixifyMetadata;
  seasons?: FlixifyMetadata[];
}

interface SeasonDetailResp {
  episodes?: FlixifyMetadata[];
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export const flixifyAdapter: SourceAdapter = {
  type: 'flixify',

  async startPair(code) {
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=flixify`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(ctx: SourceContext): Promise<HomeRow[]> {
    const auth = parseFlixifyAuth(ctx.token);
    const homeResp = await flixifyGet<KodiHomeResp>(ctx, '/api/kodi/home');
    const homeLists = (homeResp.data?.items ?? []).filter((l) => l.act === 'items' && l.url);
    // Take the first two as canvas's "continue" + "recent" rails.
    const top = homeLists.slice(0, 2);
    const fetched = await Promise.all(top.map((l) =>
      flixifyGet<PagedItemsResp>(ctx, l.url!, { postersize: 'poster-big' }).catch(() => null),
    ));
    const rows: HomeRow[] = [];
    fetched.forEach((resp, i) => {
      if (!resp?.data) return;
      const list = top[i]!;
      const items = (resp.data.items ?? []).slice(0, 20).map((m) => mapItem(auth, m));
      if (items.length === 0) return;
      rows.push({
        kind: i === 0 ? 'continue' : 'recent',
        title: list.title ?? (i === 0 ? 'Continue Watching' : 'Recently Added'),
        items,
      });
    });
    return rows;
  },

  async search(ctx: SourceContext, query: string): Promise<Item[]> {
    const auth = parseFlixifyAuth(ctx.token);
    // Find the 'search' list in /api/kodi/home for the canonical search URL.
    const homeResp = await flixifyGet<KodiHomeResp>(ctx, '/api/kodi/home');
    const searchList = (homeResp.data?.items ?? []).find((l) => l.act === 'search' && l.url);
    if (!searchList?.url) return [];
    const resp = await flixifyGet<PagedItemsResp>(ctx, searchList.url, {
      q: query, postersize: 'poster-big',
    });
    return (resp.data?.items ?? []).map((m) => mapItem(auth, m));
  },

  async library(ctx: SourceContext, libraryId?: string, _path?: string, page?: { offset: number; limit: number }): Promise<BrowseResult> {
    const auth = parseFlixifyAuth(ctx.token);
    if (!libraryId) {
      const homeResp = await flixifyGet<KodiHomeResp>(ctx, '/api/kodi/home');
      const sections = (homeResp.data?.items ?? [])
        .filter((l) => l.act === 'items' && l.url)
        .map<Item>((l) => ({
          id: encodeURIComponent(l.url!),
          type: 'folder',
          title: l.title ?? l.url!,
          librarySectionType: 'movie',  // generic; Flixify mixes types per section
        }));
      return { breadcrumbs: [{ name: 'Libraries' }], items: sections, totalSize: sections.length };
    }
    const sectionUrl = decodeURIComponent(libraryId);
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? 60;
    const p = Math.floor(offset / limit) + 1;
    const resp = await flixifyGet<PagedItemsResp>(ctx, sectionUrl, {
      p, postersize: 'poster-big', add_mroot_title: '1',
    });
    const items = (resp.data?.items ?? []).map((m) => mapItem(auth, m));
    return {
      breadcrumbs: [{ name: 'Libraries' }, { name: sectionUrl, libraryId }],
      items,
      totalSize: resp.data?.total ?? items.length,
    };
  },

  async item(ctx: SourceContext, id: string): Promise<ItemDetail> {
    const auth = parseFlixifyAuth(ctx.token);
    // Try as a movie first; on type mismatch or 404, fall through to show.
    let movieResp: FlixifyResp<{ item: FlixifyMetadata }> | null = null;
    try {
      movieResp = await flixifyGet<{ item: FlixifyMetadata }>(ctx, `/movies/${encodeURIComponent(id)}`, {
        skip_redirect: '1', sub: '1', no_media: '1', no_subs: '1',
      });
    } catch (e) {
      log(`movies/${id} fetch failed: ${(e as Error).message}`);
    }
    if (movieResp?.data?.item && movieResp.data.item.type === 'movie') {
      const m = movieResp.data.item;
      const base = mapItem(auth, m);
      return {
        ...base,
        backdrop: imageUrl(auth, m.images?.preview_large),
        synopsis: m.description,
      };
    }
    // Assume show.
    const showResp = await flixifyGet<ShowDetailResp>(ctx, `/shows/${encodeURIComponent(id)}`, {
      postersize: 'poster-big',
    });
    if (!showResp.data?.item) throw new Error(`Flixify show ${id} not found`);
    const show = showResp.data.item;
    const seasons = showResp.data.seasons ?? [];
    // Fan-out fetch each season's episodes in parallel, then flatten + sort.
    const seasonFetches = await Promise.all(seasons.map((s) =>
      s.url
        ? flixifyGet<SeasonDetailResp>(ctx, s.url, { postersize: 'poster-big', add_mroot_title: '1' }).catch(() => null)
        : Promise.resolve(null),
    ));
    const flatEpisodes = seasonFetches.flatMap((resp, idx) => {
      const season = seasons[idx];
      const eps = resp?.data?.episodes ?? [];
      return eps.map((ep) => ({
        id: String(ep.id),
        title: ep.title,
        season: ep.parent_seq ?? season?.parent_seq ?? idx + 1,
        episode: ep.seq ?? 0,
        durationSec: ep.duration,
        viewOffsetSec: ep.watch_progress,
        synopsis: ep.description,
        poster: imageUrl(auth, ep.images?.preview),
      }));
    });
    flatEpisodes.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
    const base = mapItem(auth, show);
    return {
      ...base,
      backdrop: imageUrl(auth, show.images?.preview_large),
      synopsis: show.description,
      episodes: flatEpisodes,
    };
  },

  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    void fromSec;  // Flixify direct-streams are static URLs; Player handles offset via reseek.
    const linksResp = await flixifyGet<{ media: Record<string, string> }>(ctx, `/media/links/${encodeURIComponent(id)}`);
    const media = linksResp.data?.media ?? {};
    const qualities = Object.keys(media).sort((a, b) => Number(b) - Number(a));
    if (qualities.length === 0) throw new Error('Flixify item has no playable media');
    const url = media[qualities[0]!]!;

    // Duration from a follow-up metadata call (links endpoint doesn't include it).
    let durationSec = 0;
    try {
      const itemResp = await flixifyGet<{ item: FlixifyMetadata }>(ctx, `/movies/${encodeURIComponent(id)}`, {
        skip_redirect: '1', no_media: '1', no_subs: '1',
      });
      durationSec = Number(itemResp.data?.item?.duration ?? 0);
    } catch { /* leave 0 */ }

    // Subtitles via the worker proxy. We pass `path` query so the proxy
    // assembles `https://${asset_host}${path}` server-side.
    const subtitleTracks: NonNullable<PlayResolution['subtitleTracks']> = [];
    try {
      const subsResp = await flixifyGet<{ subtitles: Record<string, Array<{ url?: string; title?: string; lang?: string }>> }>(
        ctx, `/media/subs/${encodeURIComponent(id)}`,
      );
      let trackIdx = 0;
      for (const [lang, subs] of Object.entries(subsResp.data?.subtitles ?? {})) {
        for (const s of subs) {
          if (!s.url) continue;
          subtitleTracks.push({
            id: `${id}-${lang}-${trackIdx++}`,
            language: lang,
            label: s.title ?? lang.toUpperCase(),
            url: `/api/subtitles?path=${encodeURIComponent(s.url)}`,
            format: 'vtt',
          });
        }
      }
    } catch { /* no subs is fine */ }

    return {
      url,
      durationSec,
      ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
    };
  },

  async saveProgress(_ctx: SourceContext, _id: string, _posSec: number, _completed: boolean): Promise<void> {
    // Flixify doesn't expose a server-side progress save endpoint; canvas's
    // local NowPlaying entry is the source of truth for resume position.
  },
};
