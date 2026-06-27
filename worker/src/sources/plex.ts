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

  async resolveStream(ctx: SourceContext, id: string): Promise<PlayResolution> {
    const res = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: { key: string; container?: string }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = res.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const part = m.Media?.[0]?.Part?.[0];
    if (!part) throw new Error(`Plex item ${id} has no playable Part`);
    const url = `${ctx.baseUrl}${part.key}?X-Plex-Token=${encodeURIComponent(ctx.token)}`;
    return {
      url,
      durationSec: m.duration ? Math.round(m.duration / 1000) : (m.Media?.[0]?.duration ?? 0) / 1000,
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
