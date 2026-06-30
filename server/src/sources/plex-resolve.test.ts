import { afterEach, describe, expect, it, spyOn, mock } from 'bun:test';
import { plexAdapter } from './plex';

afterEach(() => { mock.restore(); });

interface MockStream {
  id: number;
  streamType: number;
  codec?: string;
  language?: string;
  languageTag?: string;
  displayTitle?: string;
  title?: string;
  selected?: boolean;
}

function mockMetadataResponse(durationMs: number, partId: number, streams?: MockStream[]) {
  const Part: Record<string, unknown>[] = [{ id: partId, key: `/library/parts/${partId}/x/file.mkv` }];
  if (streams && streams.length > 0) {
    Part[0] = { ...Part[0], Stream: streams };
  }
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
                Part,
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
    spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
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
    spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
      300,
    );
    expect(res.url).toMatch(/[?&]offset=300(&|$)/);
  });

  it('omits offset when fromSec is undefined or 0', async () => {
    spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(mockMetadataResponse(6_499_000, 7))
      .mockResolvedValueOnce(mockMetadataResponse(6_499_000, 7));
    const a = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42');
    expect(a.url).not.toContain('offset=');
    const b = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42', 0);
    expect(b.url).not.toContain('offset=');
  });

  it('populates thumbnailUrlTemplate with the BIF endpoint and {ms} placeholder', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.thumbnailUrlTemplate).toBe(
      'https://plex.example/library/parts/7/indexes/sd/{ms}?X-Plex-Token=tok',
    );
  });

  it('returns subtitleTracks when the metadata includes streamType 3 subtitle streams', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      mockMetadataResponse(6_499_000, 7, [
        {
          id: 101,
          streamType: 1, // video — must be excluded
          codec: 'h264',
        },
        {
          id: 202,
          streamType: 3, // subtitle — must be included
          languageTag: 'en',
          displayTitle: 'English (SRT)',
        },
        {
          id: 303,
          streamType: 3, // subtitle — must be included
          languageTag: 'fr',
          displayTitle: 'French (SRT)',
        },
      ]),
    );
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.subtitleTracks).toBeDefined();
    expect(res.subtitleTracks!.length).toBe(2);
    const en = res.subtitleTracks![0]!;
    expect(en.id).toBe('202');
    expect(en.language).toBe('en');
    expect(en.label).toBe('English (SRT)');
    expect(en.format).toBe('vtt');
    expect(en.url).toContain('partId=7');
    expect(en.url).toContain('streamId=202');
  });

  it('omits subtitleTracks from result when there are no streamType 3 streams', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValue(
      mockMetadataResponse(6_499_000, 7, [
        { id: 101, streamType: 1, codec: 'h264' },
        { id: 102, streamType: 2, codec: 'aac' },
      ]),
    );
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.subtitleTracks).toBeUndefined();
  });
});
