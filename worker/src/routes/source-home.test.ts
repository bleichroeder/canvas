import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSourceHome } from './source-home';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function makeReq(sources: Record<string, { type: string; baseUrl: string; token: string }>) {
  return new Request('https://api.test/api/source-home', {
    headers: { 'x-sources': JSON.stringify(sources) },
  });
}

const fakeAdapter: SourceAdapter = {
  type: 'plex',
  startPair: async () => ({ pairUrl: '', expiresAt: 0 }),
  home: async () => [
    { kind: 'continue', title: 'Continue Watching', items: [{ id: '1', type: 'movie', title: 'Item 1' }] },
    { kind: 'recent', title: 'Recently Added', items: [{ id: '2', type: 'movie', title: 'Item 2' }] },
  ],
  search: async () => [],
  library: async (_ctx, libraryId) => {
    if (!libraryId) {
      return {
        breadcrumbs: [{ name: 'Libraries' }],
        items: [
          { id: 'lib1', type: 'folder', title: 'Movies' },
          { id: 'lib2', type: 'folder', title: 'Shows' },
        ],
      };
    }
    return { breadcrumbs: [], items: [] };
  },
  item: async () => ({ id: '1', type: 'movie', title: 'X' }),
  resolveStream: async () => ({ url: '', durationSec: 0 }),
  saveProgress: async () => undefined,
};

beforeEach(() => {
  registerAdapter(fakeAdapter);
  vi.restoreAllMocks();
});

describe('handleSourceHome', () => {
  it('returns continue/recent/libraries for a known source', async () => {
    const url = new URL('https://api.test/api/source-home?key=plex1');
    const req = makeReq({ plex1: { type: 'plex', baseUrl: 'https://x', token: 't' } });
    const res = await handleSourceHome(req, url, 'plex1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.continueWatching).toHaveLength(1);
    expect(body.continueWatching[0].id).toBe('1');
    expect(body.recentlyAdded).toHaveLength(1);
    expect(body.recentlyAdded[0].id).toBe('2');
    expect(body.libraries).toHaveLength(2);
    expect(body.libraries[0].title).toBe('Movies');
  });

  it('returns 404 for unknown source', async () => {
    const url = new URL('https://api.test/api/source-home?key=missing');
    const req = makeReq({});
    const res = await handleSourceHome(req, url, 'missing');
    expect(res.status).toBe(404);
  });

  it('returns empty arrays when source returns nothing', async () => {
    registerAdapter({
      ...fakeAdapter,
      home: async () => [],
      library: async () => ({ breadcrumbs: [], items: [] }),
    });
    const url = new URL('https://api.test/api/source-home?key=plex1');
    const req = makeReq({ plex1: { type: 'plex', baseUrl: 'https://x', token: 't' } });
    const res = await handleSourceHome(req, url, 'plex1');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.continueWatching).toEqual([]);
    expect(body.recentlyAdded).toEqual([]);
    expect(body.libraries).toEqual([]);
  });
});
