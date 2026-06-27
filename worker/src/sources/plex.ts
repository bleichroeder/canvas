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

  async search(_ctx: SourceContext, _query: string): Promise<Item[]> {
    throw new Error(NOT_IMPLEMENTED);
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

  async item(_ctx: SourceContext, _id: string): Promise<ItemDetail> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async resolveStream(_ctx: SourceContext, _id: string): Promise<PlayResolution> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async saveProgress(_ctx: SourceContext, _id: string, _posSec: number, _completed: boolean): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
