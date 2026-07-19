import { describe, expect, test, mock } from 'bun:test';
import { makeYtStreamRoutes, type SpawnFfmpeg, type FfmpegProc } from './yt-stream';
import { makeStreamSigner } from '../lib/yt-stream-sign';
import type { YtDlp } from '../lib/ytdlp';
import type { YtDash, DashSources } from '../lib/yt-dash';
import type { DashIndex } from '../lib/dash-sidx';

const signer = makeStreamSigner('test-secret', { now: () => 1000 });
const fakeYt = (json: unknown = {}, text = 'https://gv/progressive'): YtDlp => ({ json: async () => json, text: async () => text });

const idx: DashIndex = { initEnd: 10, timescale: 1000, firstSegmentByte: 10, references: [{ size: 100, durationTs: 2000 }, { size: 200, durationTs: 2000 }] };
const SOURCES: DashSources = {
  video: { url: 'https://gv/v', index: idx, initBytes: new Uint8Array([1, 2, 3]) },
  audio: { url: 'https://gv/a', index: idx, initBytes: new Uint8Array([4, 5]) },
  at: 0,
};
const fakeDash = (sources: DashSources | null): YtDash => ({ resolve: async () => sources, clearCache() {} });

function bytesStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0])); c.close(); } });
}
function fakeSpawn(exited: Promise<number> = Promise.resolve(0)) {
  let args: string[] | undefined; let killed = false;
  const spawn: SpawnFfmpeg = (a) => {
    args = a;
    const p: FfmpegProc = { stdout: bytesStream(), exited, errText: async () => '', kill: () => { killed = true; } };
    return p;
  };
  return { spawn, args: () => args, killed: () => killed };
}

const base = { yt: fakeYt(), signer, ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg', internalBase: 'http://127.0.0.1:8787' };

describe('GET /stream/:videoId', () => {
  test('403 on bad signature; never spawns', async () => {
    const fs = fakeSpawn();
    const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 2, spawnFfmpeg: fs.spawn });
    expect((await r.request('/stream/vid?from=0&exp=9999999999&sig=bad')).status).toBe(403);
    expect(fs.args()).toBeUndefined();
  });

  test('DASH path: ffmpeg muxes the two internal /_dash inputs, rebasing timestamps', async () => {
    const fs = fakeSpawn();
    const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 2, spawnFfmpeg: fs.spawn });
    const res = await r.request(`/stream/vid?${await signer.signQuery('vid', 1800)}`);
    expect(res.status).toBe(200);
    const a = fs.args()!.join(' ');
    expect(a).toContain('/api/yt/_dash/vid?stream=v');
    expect(a).toContain('/api/yt/_dash/vid?stream=a');
    expect(a).toContain('-avoid_negative_ts make_zero');
  });

  test('fallback path: no DASH → progressive single file with -ss', async () => {
    const fs = fakeSpawn();
    const r = makeYtStreamRoutes({ ...base, yt: fakeYt({}, 'https://gv/prog'), ytDash: fakeDash(null), maxConcurrent: 2, spawnFfmpeg: fs.spawn });
    const res = await r.request(`/stream/vid?${await signer.signQuery('vid', 120)}`);
    expect(res.status).toBe(200);
    const a = fs.args()!;
    expect(a).toContain('https://gv/prog');
    expect(a[a.indexOf('-ss') + 1]).toBe('120');
  });

  test('429 over the concurrency cap', async () => {
    const fs = fakeSpawn(new Promise<number>(() => {}));
    const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 1, spawnFfmpeg: fs.spawn });
    const q = await signer.signQuery('vid', 0);
    expect((await r.request(`/stream/vid?${q}`)).status).toBe(200);
    expect((await r.request(`/stream/vid?${q}`)).status).toBe(429);
  });

  test('abort kills ffmpeg and frees the slot', async () => {
    const fs = fakeSpawn(new Promise<number>(() => {}));
    const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 1, spawnFfmpeg: fs.spawn });
    const ac = new AbortController();
    expect((await r.request(`/stream/vid?${await signer.signQuery('vid', 0)}`, { signal: ac.signal })).status).toBe(200);
    ac.abort();
    await Promise.resolve();
    expect(fs.killed()).toBe(true);
    expect((await r.request(`/stream/vid?${await signer.signQuery('vid', 0)}`)).status).toBe(200);
  });
});

describe('GET /_dash/:videoId (internal assembly)', () => {
  test('serves init bytes + ranged fetch from the seek offset', async () => {
    let capturedRange: string | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = mock(async (_url: string | URL, init?: RequestInit) => {
      capturedRange = (init?.headers as Record<string, string>)?.Range;
      return new Response(new Uint8Array([7, 7, 7]), { status: 206 });
    }) as unknown as typeof fetch;
    try {
      const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 2, spawnFfmpeg: fakeSpawn().spawn });
      // seek to 3s → segment 1 → byteOffset firstSegmentByte(10)+100 = 110
      const res = await r.request(`/_dash/vid?stream=v&${await signer.signQuery('vid', 3)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp4');
      const body = new Uint8Array(await res.arrayBuffer());
      expect(Array.from(body)).toEqual([1, 2, 3, 7, 7, 7]); // initBytes ++ fetched
      expect(capturedRange).toBe('bytes=110-4000109'); // bounded chunk, not open-ended
    } finally {
      globalThis.fetch = original;
    }
  });

  test('403 on bad signature', async () => {
    const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 2, spawnFfmpeg: fakeSpawn().spawn });
    expect((await r.request('/_dash/vid?stream=v&from=0&exp=9999999999&sig=bad')).status).toBe(403);
  });
});

describe('GET /subs/:videoId', () => {
  const withSubs = { ...base, ytDash: fakeDash(SOURCES), yt: fakeYt({ subtitles: { en: [{ ext: 'vtt', url: 'https://cc/en.vtt' }] } }), maxConcurrent: 2 };
  test('proxies a VTT caption track', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response('WEBVTT', { status: 200 })) as unknown as typeof fetch;
    try {
      const res = await makeYtStreamRoutes(withSubs).request('/subs/vid?lang=en');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('WEBVTT');
    } finally { globalThis.fetch = original; }
  });
  test('400 without lang', async () => {
    expect((await makeYtStreamRoutes(withSubs).request('/subs/vid')).status).toBe(400);
  });
});
