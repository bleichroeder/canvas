import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler';
import { playRoutes, parseFromSecParam } from './play';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function stubAdapter(type: 'plex' | 'flixify', overrides: Partial<SourceAdapter>): SourceAdapter {
  return {
    type,
    startPair: async () => ({ pairUrl: '', expiresAt: 0 }),
    home: async () => [],
    search: async () => [],
    library: async () => ({ breadcrumbs: [], items: [] }),
    item: async () => { throw new Error('not implemented'); },
    resolveStream: async () => { throw new Error('not implemented'); },
    saveProgress: async () => {},
    ...overrides,
  };
}

function makeApp(): Hono {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/api/play', playRoutes);
  return app;
}

describe('parseFromSecParam', () => {
  test('null and empty → undefined', () => {
    expect(parseFromSecParam(null)).toBeUndefined();
    expect(parseFromSecParam('')).toBeUndefined();
  });
  test('positive integer pass-through', () => {
    expect(parseFromSecParam('42')).toBe(42);
  });
  test('floor for fractional', () => {
    expect(parseFromSecParam('42.7')).toBe(42);
  });
  test('negative → undefined', () => {
    expect(parseFromSecParam('-1')).toBeUndefined();
  });
  test('NaN → undefined', () => {
    expect(parseFromSecParam('abc')).toBeUndefined();
  });
});

describe('play route', () => {
  test('502 when srcKey is not in x-sources', async () => {
    const res = await makeApp().fetch(new Request('http://test/api/play/unknown/123', {
      method: 'POST',
    }));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/source not paired/);
  });

  test('subtitleTracks URLs are tagged with ?src=<srcKey>', async () => {
    registerAdapter(stubAdapter('plex', {
      resolveStream: async () => ({
        url: 'http://stream/url',
        durationSec: 100,
        subtitleTracks: [
          { id: 's1', url: '/api/subtitles?partId=1&streamId=2', format: 'vtt' },
          { id: 's2', url: '/api/subtitles', format: 'vtt' },
        ],
      }),
    }));
    const xs = JSON.stringify({ s1: { type: 'plex', baseUrl: 'http://x', token: 't' } });
    const res = await makeApp().fetch(new Request('http://test/api/play/s1/abc', {
      method: 'POST',
      headers: { 'x-sources': xs },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as { subtitleTracks: { url: string }[] };
    const [t0, t1] = body.subtitleTracks;
    expect(t0!.url).toBe('/api/subtitles?partId=1&streamId=2&src=s1');
    expect(t1!.url).toBe('/api/subtitles?src=s1');
  });
});
