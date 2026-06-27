import type { SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

const NOT_IMPLEMENTED = 'plex method not implemented yet';

export const plexAdapter: SourceAdapter = {
  type: 'plex',

  async startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }> {
    // Pair flow is driven by the phone (Pair.tsx) which talks to plex.tv directly.
    // We just return the pair URL with the code; the phone view handles the rest.
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=plex`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(_ctx: SourceContext): Promise<HomeRow[]> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async search(_ctx: SourceContext, _query: string): Promise<Item[]> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async library(_ctx: SourceContext, _libraryId?: string, _path?: string): Promise<BrowseResult> {
    throw new Error(NOT_IMPLEMENTED);
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
