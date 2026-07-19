import { describe, expect, test, mock } from 'bun:test';
import { makeYtStreamRoutes, buildFfmpegArgs, type Spawn, type Spawned } from './yt-stream';
import { makeStreamSigner } from '../lib/yt-stream-sign';
import { pickFormats, type YtDlp } from '../lib/ytdlp';

const signer = makeStreamSigner('test-secret', { now: () => 1000 });

// Formats yt-dlp would return: an avc1 video-only + m4a audio-only pair.
const FORMATS = {
  formats: [
    { format_id: '137', url: 'https://gv/video', vcodec: 'avc1.640028', acodec: 'none', height: 1080, tbr: 4000 },
    { format_id: '140', url: 'https://gv/audio', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 },
  ],
};

// The stream route uses text() (`-g` direct URLs); the subs route uses json() (`-J`).
const STREAM_URLS = 'https://gv/video\nhttps://gv/audio';
function fakeYt(over: { text?: string; json?: unknown } = {}): YtDlp {
  return { json: async () => over.json ?? {}, text: async () => over.text ?? STREAM_URLS };
}

function closedStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.close(); } });
}
function bytesStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0, 1, 2])); c.close(); } });
}

interface FakeSpawn {
  spawn: Spawn;
  killed: () => boolean;
  cmd: () => string[] | undefined;
}
function makeFakeSpawn(exited: Promise<number> = Promise.resolve(0)): FakeSpawn {
  let killed = false;
  let cmd: string[] | undefined;
  const spawn: Spawn = (c) => {
    cmd = c;
    const s: Spawned = { stdout: bytesStream(), stderr: closedStream(), exited, kill: () => { killed = true; } };
    return s;
  };
  return { spawn, killed: () => killed, cmd: () => cmd };
}

describe('GET /stream/:videoId', () => {
  test('rejects a bad signature with 403 and never spawns', async () => {
    const fs = makeFakeSpawn();
    const r = makeYtStreamRoutes({ yt: fakeYt(), signer, ffmpegPath: 'ffmpeg', maxConcurrent: 2, spawn: fs.spawn });
    const res = await r.request('/stream/vid?from=0&exp=9999999999&sig=deadbeef');
    expect(res.status).toBe(403);
    expect(fs.cmd()).toBeUndefined();
  });

  test('streams video/mp4 and spawns ffmpeg with the picked inputs', async () => {
    const fs = makeFakeSpawn();
    const r = makeYtStreamRoutes({ yt: fakeYt(), signer, ffmpegPath: '/bin/ffmpeg', maxConcurrent: 2, spawn: fs.spawn });
    const q = await signer.signQuery('vid', 0);
    const res = await r.request(`/stream/vid?${q}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    const cmd = fs.cmd()!;
    expect(cmd[0]).toBe('/bin/ffmpeg');
    expect(cmd).toContain('https://gv/video');
    expect(cmd).toContain('https://gv/audio');
    expect(cmd).toContain('pipe:1');
  });

  test('returns 429 when the concurrency cap is reached', async () => {
    const neverExits = new Promise<number>(() => {});
    const fs = makeFakeSpawn(neverExits);
    const r = makeYtStreamRoutes({ yt: fakeYt(), signer, ffmpegPath: 'ffmpeg', maxConcurrent: 1, spawn: fs.spawn });
    const q = await signer.signQuery('vid', 0);
    const first = await r.request(`/stream/vid?${q}`);
    expect(first.status).toBe(200);      // holds the only slot (never exits)
    const second = await r.request(`/stream/vid?${q}`);
    expect(second.status).toBe(429);
  });

  test('kills the child and frees the slot on client abort', async () => {
    const neverExits = new Promise<number>(() => {});
    const fs = makeFakeSpawn(neverExits);
    const r = makeYtStreamRoutes({ yt: fakeYt(), signer, ffmpegPath: 'ffmpeg', maxConcurrent: 1, spawn: fs.spawn });
    const q = await signer.signQuery('vid', 0);

    const ac = new AbortController();
    const res = await r.request(`/stream/vid?${q}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    ac.abort();
    await Promise.resolve();
    expect(fs.killed()).toBe(true);

    // Slot was released, so a fresh request succeeds despite maxConcurrent=1.
    const again = await r.request(`/stream/vid?${await signer.signQuery('vid', 0)}`);
    expect(again.status).toBe(200);
  });
});

describe('GET /subs/:videoId', () => {
  const withSubs = fakeYt({ json: { subtitles: { en: [{ ext: 'vtt', url: 'https://cc/en.vtt' }] }, automatic_captions: {} } });

  test('proxies a VTT caption track as text/vtt', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nhi', { status: 200 })) as unknown as typeof fetch;
    try {
      const r = makeYtStreamRoutes({ yt: withSubs, signer, ffmpegPath: 'ffmpeg', maxConcurrent: 2 });
      const res = await r.request('/subs/vid?lang=en');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/vtt');
      expect(await res.text()).toContain('WEBVTT');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('400 when lang is missing', async () => {
    const r = makeYtStreamRoutes({ yt: withSubs, signer, ffmpegPath: 'ffmpeg', maxConcurrent: 2 });
    expect((await r.request('/subs/vid')).status).toBe(400);
  });

  test('404 when the language has no captions', async () => {
    const r = makeYtStreamRoutes({ yt: withSubs, signer, ffmpegPath: 'ffmpeg', maxConcurrent: 2 });
    expect((await r.request('/subs/vid?lang=zz')).status).toBe(404);
  });
});

describe('buildFfmpegArgs', () => {
  test('remuxes (copy) a two-input avc1+m4a pick and fragments the MP4', () => {
    const picked = pickFormats(FORMATS.formats);
    const args = buildFfmpegArgs(picked, 0);
    expect(args).toContain('-c');
    expect(args[args.indexOf('-c') + 1]).toBe('copy');
    expect(args).toContain('frag_keyframe+empty_moov+default_base_moof');
    expect(args.at(-1)).toBe('pipe:1');
  });

  test('adds -ss for a non-zero start and transcodes when needed', () => {
    const args = buildFfmpegArgs({ videoUrl: 'v', audioUrl: 'a', needsTranscode: true }, 42, 'out.mp4');
    expect(args).toContain('-ss');
    expect(args[args.indexOf('-ss') + 1]).toBe('42');
    expect(args).toContain('libx264');
    expect(args.at(-1)).toBe('out.mp4');
  });
});
