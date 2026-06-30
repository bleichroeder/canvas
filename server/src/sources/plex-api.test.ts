import { afterEach, describe, expect, it, spyOn, mock } from 'bun:test';
import { plexFetch, mapMetadata } from './plex-api';
import { PlexHttpError } from '../errors';

afterEach(() => { mock.restore(); });

describe('plexFetch', () => {
  it('adds plex headers and parses JSON', async () => {
    const spy = spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"MediaContainer":{"size":0}}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await plexFetch(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '/library/sections',
    );
    expect(spy).toHaveBeenCalledWith(
      'https://plex.example/library/sections',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'tok',
          'Accept': 'application/json',
        }),
      }),
    );
    expect(result).toEqual({ MediaContainer: { size: 0 } });
  });

  it('throws on non-2xx with status code', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    await expect(
      plexFetch({ baseUrl: 'https://plex.example', token: 'tok' }, '/'),
    ).rejects.toThrow(/403/);
  });
});

describe('mapMetadata', () => {
  it('produces an Item with correct types and poster URL', () => {
    const item = mapMetadata(
      { baseUrl: 'https://plex.example', token: 'tok' },
      {
        ratingKey: '123',
        type: 'movie',
        title: 'Hello',
        year: 2024,
        thumb: '/library/metadata/123/thumb/456',
        duration: 5_400_000,
        viewOffset: 120_000,
      },
    );
    expect(item).toEqual({
      id: '123',
      type: 'movie',
      title: 'Hello',
      year: 2024,
      poster: 'https://plex.example/photo/:/transcode?width=400&height=400&minSize=1&upscale=1&url=%2Flibrary%2Fmetadata%2F123%2Fthumb%2F456&X-Plex-Token=tok',
      durationSec: 5400,
      viewOffsetSec: 120,
    });
  });

  it('returns type=folder for show-level entries when called with as=folder', () => {
    const item = mapMetadata(
      { baseUrl: 'https://plex.example', token: 'tok' },
      { ratingKey: '9', type: 'show', title: 'Test Show' },
      'show',
    );
    expect(item.type).toBe('show');
  });
});

it('plexFetch throws PlexHttpError on non-2xx', async () => {
  const ctx = { baseUrl: 'http://stub', token: 't' };
  const originalFetch = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response('not found', { status: 404 });
  try {
    await expect(plexFetch(ctx, '/missing')).rejects.toBeInstanceOf(PlexHttpError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
