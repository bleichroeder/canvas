import { afterEach, describe, expect, it, vi } from 'vitest';
import { plexAdapter } from './plex';

afterEach(() => { vi.restoreAllMocks(); });

function mockMetadataResponse(durationMs: number, partId: number) {
  return new Response(
    JSON.stringify({
      MediaContainer: {
        size: 1,
        Metadata: [
          {
            ratingKey: '42',
            type: 'movie',
            title: 'Test',
            duration: durationMs,
            Media: [
              {
                duration: durationMs,
                Part: [{ id: partId, key: `/library/parts/${partId}/x/file.mkv` }],
              },
            ],
          },
        ],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('plexAdapter.resolveStream', () => {
  it('returns a transcoder URL with videoCodec=h264 and audioCodec=aac', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.url).toContain('/video/:/transcode/universal/start.mp4');
    expect(res.url).toContain('videoCodec=h264');
    expect(res.url).toContain('audioCodec=aac');
    expect(res.durationSec).toBe(6499);
  });

  it('appends offset=<seconds> when fromSec is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
      300,
    );
    expect(res.url).toMatch(/[?&]offset=300(&|$)/);
  });

  it('omits offset when fromSec is undefined or 0', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockMetadataResponse(6_499_000, 7))
      .mockResolvedValueOnce(mockMetadataResponse(6_499_000, 7));
    const a = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42');
    expect(a.url).not.toContain('offset=');
    const b = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42', 0);
    expect(b.url).not.toContain('offset=');
  });

  it('populates thumbnailUrlTemplate with the BIF endpoint and {ms} placeholder', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.thumbnailUrlTemplate).toBe(
      'https://plex.example/library/parts/7/indexes/sd/{ms}?X-Plex-Token=tok',
    );
  });
});
