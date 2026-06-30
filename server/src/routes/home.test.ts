import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler';
import { homeRoutes } from './home';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function makeStubAdapter(type: 'plex' | 'flixify', impl: Partial<SourceAdapter>): SourceAdapter {
  return {
    type,
    startPair: impl.startPair ?? (async () => ({ pairUrl: '', expiresAt: 0 })),
    home: impl.home ?? (async () => []),
    library: impl.library ?? (async () => ({ breadcrumbs: [], items: [] })),
    item: impl.item ?? (async () => { throw new Error('not implemented'); }),
    search: impl.search ?? (async () => []),
    resolveStream: impl.resolveStream ?? (async () => { throw new Error('not implemented'); }),
    saveProgress: impl.saveProgress ?? (async () => {}),
  } as SourceAdapter;
}

function makeApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/home', homeRoutes);
  return app;
}

describe('home route', () => {
  test('with no x-sources header, returns empty rows + no errors', async () => {
    const app = makeApp();
    const res = await app.fetch(new Request('http://test/api/home'));
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: unknown[]; errors: unknown[]; libraryCounts: Record<string, number> };
    expect(body.rows).toEqual([]);
    expect(body.errors).toEqual([]);
    expect(body.libraryCounts).toEqual({});
  });

  test('injects source key into each row and computes libraryCounts (folders only)', async () => {
    // Registry uses Map.set — re-registering overwrites in place (idempotent).
    registerAdapter(makeStubAdapter('plex', {
      home: async () => [{ kind: 'continue', title: 'Continue', items: [] }],
      library: async () => ({
        breadcrumbs: [],
        items: [
          { id: '1', type: 'folder', title: 'Movies' },
          { id: '2', type: 'folder', title: 'Shows' },
          { id: '3', type: 'item',   title: 'Stray' }, // not a folder; must be excluded
        ] as any,
      }),
    }));
    const app = makeApp();
    const xs = JSON.stringify({ src1: { type: 'plex', baseUrl: 'http://x', token: 't' } });
    const res = await app.fetch(new Request('http://test/api/home', {
      headers: { 'x-sources': xs },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: any[]; libraryCounts: Record<string, number> };
    expect(body.libraryCounts.src1).toBe(2);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0].source).toBe('src1');
  });
});
