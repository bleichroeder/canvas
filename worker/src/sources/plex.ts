import { plexFetch, mapMetadata, transcodeImage, PLEX_BACKDROP_WIDTH, PLEX_POSTER_WIDTH, type PlexMetadata, type PlexSection } from './plex-api';
import type { SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

const NOT_IMPLEMENTED = 'plex method not implemented yet';

interface MediaContainer<T> {
  MediaContainer: {
    size: number;
    Metadata?: T[];
    Directory?: T[];
  };
}

export const plexAdapter: SourceAdapter = {
  type: 'plex',

  async startPair(code: string) {
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=plex`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(ctx: SourceContext): Promise<HomeRow[]> {
    const [onDeck, recent] = await Promise.all([
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/onDeck?X-Plex-Container-Size=20&includeStreams=1'),
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/recentlyAdded?X-Plex-Container-Size=20&includeStreams=1'),
    ]);
    const rows: HomeRow[] = [];
    const onDeckItems = (onDeck.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (onDeckItems.length) rows.push({ kind: 'continue', title: 'Continue Watching', items: onDeckItems });
    const recentItems = (recent.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (recentItems.length) rows.push({ kind: 'recent', title: 'Recently Added', items: recentItems });
    return rows;
  },

  async search(ctx: SourceContext, query: string): Promise<Item[]> {
    const res = await plexFetch<MediaContainer<{ Metadata?: PlexMetadata[] } & PlexMetadata>>(
      ctx,
      `/hubs/search?query=${encodeURIComponent(query)}&limit=20&includeStreams=1`,
    );
    // hubs/search returns a Hub[] each containing Metadata. The shape: MediaContainer.Hub[].Metadata[]
    const hubs = (res.MediaContainer as unknown as { Hub?: { Metadata?: PlexMetadata[]; type?: string }[] }).Hub ?? [];
    const items: Item[] = [];
    for (const hub of hubs) {
      if (!hub.Metadata) continue;
      for (const m of hub.Metadata) {
        if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') {
          items.push(mapMetadata(ctx, m));
        }
      }
    }
    return items;
  },

  async library(ctx: SourceContext, libraryId?: string, _path?: string, page?: { offset: number; limit: number }): Promise<BrowseResult> {
    if (!libraryId) {
      // List sections as folder items.
      const sections = await plexFetch<MediaContainer<PlexSection>>(ctx, '/library/sections');
      const items: Item[] = (sections.MediaContainer.Directory ?? []).map((s) => ({
        id: s.key,
        type: 'folder',
        title: s.title,
        poster: transcodeImage(ctx, s.composite, PLEX_POSTER_WIDTH),
        librarySectionType: s.type,
      }));
      return { breadcrumbs: [{ name: 'Libraries' }], items, totalSize: items.length };
    }
    // Browse one section, paged.
    const offset = page?.offset ?? 0;
    const limit = page?.limit ?? 60;
    const baseParams: Record<string, string> = {
      'X-Plex-Container-Start': String(offset),
      'X-Plex-Container-Size': String(limit),
    };
    const sectionPath = `/library/sections/${encodeURIComponent(libraryId)}/all`;
    type AllResponse = MediaContainer<PlexMetadata & { librarySectionTitle?: string }> & {
      MediaContainer: { totalSize?: number };
    };
    // Try with includeStreams=1 first — required so video posters can show
    // a CC badge. Some Plex builds 404 this for music sections, so fall back
    // to the bare path without that param.
    let all: AllResponse;
    try {
      const params = new URLSearchParams({ ...baseParams, includeStreams: '1' });
      all = await plexFetch<AllResponse>(ctx, `${sectionPath}?${params.toString()}`);
    } catch (e) {
      const msg = (e as Error).message;
      if (!msg.includes(' 404 ')) throw e;
      const params = new URLSearchParams(baseParams);
      all = await plexFetch<AllResponse>(ctx, `${sectionPath}?${params.toString()}`);
    }
    const items = (all.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    const sectionTitle = all.MediaContainer.Metadata?.[0]?.librarySectionTitle ?? 'Library';
    const totalSize = all.MediaContainer.totalSize ?? items.length;
    return {
      breadcrumbs: [
        { name: 'Libraries' },
        { name: sectionTitle, libraryId },
      ],
      items,
      totalSize,
    };
  },

  async item(ctx: SourceContext, id: string): Promise<ItemDetail> {
    const res = await plexFetch<MediaContainer<PlexMetadata>>(
      ctx,
      `/library/metadata/${encodeURIComponent(id)}`,
    );
    const m = res.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const base = mapMetadata(ctx, m);
    const detail: ItemDetail = {
      ...base,
      backdrop: transcodeImage(ctx, m.art, PLEX_BACKDROP_WIDTH),
      synopsis: m.summary,
      rating: m.rating,
    };
    if (m.type === 'show') {
      const leaves = await plexFetch<MediaContainer<PlexMetadata & {
        parentIndex?: number; index?: number;
      }>>(ctx, `/library/metadata/${encodeURIComponent(id)}/allLeaves`);
      detail.episodes = (leaves.MediaContainer.Metadata ?? []).map((e) => ({
        id: e.ratingKey,
        title: e.title,
        season: (e as any).parentIndex ?? 0,
        episode: (e as any).index ?? 0,
        durationSec: e.duration ? Math.round(e.duration / 1000) : undefined,
        viewOffsetSec: e.viewOffset ? Math.round(e.viewOffset / 1000) : undefined,
        synopsis: e.summary,
        poster: transcodeImage(ctx, e.thumb, PLEX_POSTER_WIDTH),
      }));
    }
    return detail;
  },

  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    // Plex's direct-play hands us the original container — typically MKV with
    // arbitrary codecs (HEVC, AC3, DTS). The canvas pipeline only handles
    // H.264 + AAC|MP3. Route through Plex's transcoder forcing those codecs.
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: {
        id?: number;
        key: string;
        Stream?: {
          id?: number;
          streamType?: number;
          format?: string;
          codec?: string;
          language?: string;
          languageTag?: string;
          displayTitle?: string;
          title?: string;
          selected?: boolean;
        }[];
      }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const durationMs = m.duration ?? m.Media?.[0]?.duration ?? 0;
    const partId = m.Media?.[0]?.Part?.[0]?.id;
    const streams = m.Media?.[0]?.Part?.[0]?.Stream ?? [];
    const subtitleTracks = partId !== undefined
      ? streams
          .filter((s) => s.streamType === 3 && s.id !== undefined)
          .map((s) => ({
            id: String(s.id),
            language: s.languageTag ?? s.language,
            label: s.displayTitle ?? s.title ?? s.language ?? `Subtitle ${s.id}`,
            // Relative path; frontend prefixes with API_BASE. Worker proxies
            // the actual Plex VTT fetch (Plex doesn't send CORS headers).
            url: `/api/subtitles?partId=${partId}&streamId=${s.id}`,
            format: 'vtt' as const,
          }))
      : [];

    const session = crypto.randomUUID();
    const params = new URLSearchParams({
      'protocol': 'http',
      'path': `/library/metadata/${id}`,
      'mediaIndex': '0',
      'partIndex': '0',
      'directPlay': '0',
      'directStream': '0',
      'videoCodec': 'h264',
      'audioCodec': 'aac',
      'videoQuality': '80',
      'videoResolution': '1920x1080',
      'maxVideoBitrate': '8000',
      'fastSeek': '1',
      'session': session,
      'X-Plex-Token': ctx.token,
      'X-Plex-Client-Identifier': 'canvas',
      'X-Plex-Product': 'Canvas',
      'X-Plex-Platform': 'Web',
    });
    if (typeof fromSec === 'number' && fromSec > 0) {
      params.set('offset', String(Math.floor(fromSec)));
    }
    const url = `${ctx.baseUrl}/video/:/transcode/universal/start.mp4?${params.toString()}`;

    const thumbnailUrlTemplate = partId !== undefined
      ? `${ctx.baseUrl}/library/parts/${partId}/indexes/sd/{ms}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
      : undefined;

    return {
      url,
      durationSec: Math.round(durationMs / 1000),
      ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
    };
  },

  async saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void> {
    const state = completed ? 'stopped' : 'playing';
    const timeMs = Math.round(posSec * 1000);
    // Plex /:/timeline requires `duration` and `identifier` query params plus the
    // X-Plex-Client-Identifier header (the latter is set globally in plexFetch).
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    const durationMs = m?.duration ?? m?.Media?.[0]?.duration ?? 0;
    const url =
      `/:/timeline` +
      `?ratingKey=${encodeURIComponent(id)}` +
      `&key=/library/metadata/${encodeURIComponent(id)}` +
      `&identifier=com.plexapp.plugins.library` +
      `&state=${state}` +
      `&time=${timeMs}` +
      `&duration=${durationMs}`;
    await plexFetch(ctx, url);
  },
};
