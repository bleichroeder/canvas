import { plexFetch, mapMetadata, type PlexMetadata, type PlexSection } from './plex-api';
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
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/onDeck?X-Plex-Container-Size=20'),
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/recentlyAdded?X-Plex-Container-Size=20'),
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
      `/hubs/search?query=${encodeURIComponent(query)}&limit=20`,
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

  async library(ctx: SourceContext, libraryId?: string): Promise<BrowseResult> {
    if (!libraryId) {
      // List sections as folder items.
      const sections = await plexFetch<MediaContainer<PlexSection>>(ctx, '/library/sections');
      const items: Item[] = (sections.MediaContainer.Directory ?? []).map((s) => ({
        id: s.key,
        type: 'folder',
        title: s.title,
      }));
      return { breadcrumbs: [{ name: 'Libraries' }], items };
    }
    // Browse one section.
    const all = await plexFetch<MediaContainer<PlexMetadata & { librarySectionTitle?: string }>>(
      ctx,
      `/library/sections/${encodeURIComponent(libraryId)}/all?X-Plex-Container-Size=200`,
    );
    const items = (all.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    const sectionTitle = all.MediaContainer.Metadata?.[0]?.librarySectionTitle ?? 'Library';
    return {
      breadcrumbs: [
        { name: 'Libraries' },
        { name: sectionTitle, libraryId },
      ],
      items,
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
      backdrop: m.art ? `${ctx.baseUrl}${m.art}?X-Plex-Token=${encodeURIComponent(ctx.token)}` : undefined,
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
        poster: e.thumb
          ? `${ctx.baseUrl}${e.thumb}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
          : undefined,
      }));
    }
    return detail;
  },

  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    // Plex's direct-play hands us the original container — typically MKV with
    // arbitrary codecs (HEVC, AC3, DTS). The canvas pipeline only handles
    // H.264 + AAC|MP3. Route through Plex's transcoder forcing those codecs.
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: { id?: number; key: string }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const durationMs = m.duration ?? m.Media?.[0]?.duration ?? 0;
    const partId = m.Media?.[0]?.Part?.[0]?.id;

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
      'X-Plex-Client-Identifier': 'passenger',
      'X-Plex-Product': 'Passenger',
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
