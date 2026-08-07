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
  // mediaEnd for SOURCES.video = firstSegmentByte(10) + Σ ref.size(100+200) = 310.
  // A seek to 3s lands on segment 1 → byteOffset 10+100 = 110, so the served
  // media is the byte range [110, 310) prefixed with the init segment.
  const MEDIA_END = 310;

  /** A fake seekable byte server over a synthetic file (byte i === i & 0xff). */
  function byteServer(opts: { cap?: number; failFirst?: number } = {}) {
    const len = MEDIA_END;
    const file = new Uint8Array(len);
    for (let i = 0; i < len; i++) file[i] = i & 0xff;
    let calls = 0;
    let firstRange: string | undefined;
    const fn = mock(async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      const range = (init?.headers as Record<string, string>)?.Range;
      if (firstRange === undefined) firstRange = range;
      if (opts.failFirst && calls <= opts.failFirst) throw new Error('network fail');
      const m = /bytes=(\d+)-(\d+)/.exec(range ?? '');
      if (!m) return new Response(file, { status: 200 });
      const start = Number(m[1]);
      if (start >= len) return new Response(null, { status: 416 });
      const reqEnd = Math.min(Number(m[2]), len - 1);
      // Optionally cap the response short of what was asked (a legit partial 206).
      const sliceEnd = opts.cap ? Math.min(reqEnd + 1, start + opts.cap) : reqEnd + 1;
      return new Response(file.slice(start, sliceEnd), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${sliceEnd - 1}/${len}` },
      });
    }) as unknown as typeof fetch;
    return { fn, file, calls: () => calls, firstRange: () => firstRange };
  }

  async function dashBody(fetchImpl: typeof fetch): Promise<number[]> {
    const original = globalThis.fetch;
    globalThis.fetch = fetchImpl;
    try {
      const r = makeYtStreamRoutes({ ...base, ytDash: fakeDash(SOURCES), maxConcurrent: 2, spawnFfmpeg: fakeSpawn().spawn });
      const res = await r.request(`/_dash/vid?stream=v&${await signer.signQuery('vid', 3)}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('video/mp4');
      return Array.from(new Uint8Array(await res.arrayBuffer()));
    } finally {
      globalThis.fetch = original;
    }
  }

  test('serves init bytes + the full media range [byteOffset, mediaEnd)', async () => {
    const srv = byteServer();
    const body = await dashBody(srv.fn);
    const expected = [1, 2, 3, ...Array.from(srv.file.slice(110, MEDIA_END))];
    expect(body).toEqual(expected);
    // Bounded chunk, clamped to mediaEnd (never open-ended, never past EOF).
    expect(srv.firstRange()).toBe('bytes=110-309');
  });

  test('short reads do NOT end the stream — the full range is reconstructed', async () => {
    // Each response returns at most 50 bytes, well under the requested range.
    const srv = byteServer({ cap: 50 });
    const body = await dashBody(srv.fn);
    const expected = [1, 2, 3, ...Array.from(srv.file.slice(110, MEDIA_END))];
    expect(body).toEqual(expected);
    expect(srv.calls()).toBeGreaterThan(1); // took several ranged reads
  });

  test('a transient fetch error is retried, not fatal', async () => {
    const srv = byteServer({ failFirst: 1 }); // first fetch throws, then serves
    const body = await dashBody(srv.fn);
    const expected = [1, 2, 3, ...Array.from(srv.file.slice(110, MEDIA_END))];
    expect(body).toEqual(expected);
  });

  test('re-resolves fresh URLs when googlevideo 403s a media URL', async () => {
    const len = MEDIA_END;
    const file = new Uint8Array(len);
    for (let i = 0; i < len; i++) file[i] = i & 0xff;
    const original = globalThis.fetch;
    // Original url (https://gv/v) is poisoned (403); the re-resolved url (…/v2) serves.
    globalThis.fetch = mock(async (u: string | URL, init?: RequestInit) => {
      if (!String(u).includes('/v2')) return new Response(null, { status: 403 });
      const m = /bytes=(\d+)-(\d+)/.exec((init?.headers as Record<string, string>)?.Range ?? '');
      const start = Number(m![1]);
      const end = Math.min(Number(m![2]), len - 1);
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: { 'content-range': `bytes ${start}-${end}/${len}` },
      });
    }) as unknown as typeof fetch;
    try {
      let refreshed = false;
      const dash: YtDash = {
        resolve: async (_id: string, o?: { forceRefresh?: boolean }) => {
          if (o?.forceRefresh) { refreshed = true; return { ...SOURCES, video: { ...SOURCES.video, url: 'https://gv/v2' } }; }
          return SOURCES;
        },
        clearCache() {},
      };
      const r = makeYtStreamRoutes({ ...base, ytDash: dash, maxConcurrent: 2, spawnFfmpeg: fakeSpawn().spawn });
      const res = await r.request(`/_dash/vid?stream=v&${await signer.signQuery('vid', 3)}`);
      expect(res.status).toBe(200);
      const body = Array.from(new Uint8Array(await res.arrayBuffer()));
      expect(body).toEqual([1, 2, 3, ...Array.from(file.slice(110, MEDIA_END))]);
      expect(refreshed).toBe(true);
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
