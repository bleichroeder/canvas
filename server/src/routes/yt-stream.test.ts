import { describe, expect, test, mock } from 'bun:test';
import { makeYtStreamRoutes, type StartStream, type StartStreamArgs } from './yt-stream';
import { makeStreamSigner } from '../lib/yt-stream-sign';
import type { YtDlp } from '../lib/ytdlp';

const signer = makeStreamSigner('test-secret', { now: () => 1000 });

// The subs route uses json() (-J); the stream route uses the injected startStream.
function fakeYt(json: unknown = {}): YtDlp {
  return { json: async () => json, text: async () => '' };
}

function bytesStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0, 1, 2])); c.close(); } });
}

interface FakeStart {
  start: StartStream;
  killed: () => boolean;
  args: () => StartStreamArgs | undefined;
}
function makeFakeStart(exited: Promise<number> = Promise.resolve(0)): FakeStart {
  let killed = false;
  let args: StartStreamArgs | undefined;
  const start: StartStream = (a) => {
    args = a;
    return { stdout: bytesStream(), exited, errText: async () => '', kill: () => { killed = true; } };
  };
  return { start, killed: () => killed, args: () => args };
}

const base = { yt: fakeYt(), signer, ytdlpPath: 'yt-dlp', ffmpegPath: 'ffmpeg' };

describe('GET /stream/:videoId', () => {
  test('rejects a bad signature with 403 and never starts a stream', async () => {
    const fs = makeFakeStart();
    const r = makeYtStreamRoutes({ ...base, maxConcurrent: 2, startStream: fs.start });
    const res = await r.request('/stream/vid?from=0&exp=9999999999&sig=deadbeef');
    expect(res.status).toBe(403);
    expect(fs.args()).toBeUndefined();
  });

  test('streams video/mp4 and starts the pipeline at the requested offset', async () => {
    const fs = makeFakeStart();
    const r = makeYtStreamRoutes({ ...base, maxConcurrent: 2, startStream: fs.start });
    const q = await signer.signQuery('vid', 1800);
    const res = await r.request(`/stream/vid?${q}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    expect(fs.args()).toMatchObject({ videoId: 'vid', fromSec: 1800 });
  });

  test('returns 429 when the concurrency cap is reached', async () => {
    const neverExits = new Promise<number>(() => {});
    const fs = makeFakeStart(neverExits);
    const r = makeYtStreamRoutes({ ...base, maxConcurrent: 1, startStream: fs.start });
    const q = await signer.signQuery('vid', 0);
    expect((await r.request(`/stream/vid?${q}`)).status).toBe(200); // holds the only slot
    expect((await r.request(`/stream/vid?${q}`)).status).toBe(429);
  });

  test('kills the pipeline and frees the slot on client abort', async () => {
    const neverExits = new Promise<number>(() => {});
    const fs = makeFakeStart(neverExits);
    const r = makeYtStreamRoutes({ ...base, maxConcurrent: 1, startStream: fs.start });
    const ac = new AbortController();
    const res = await r.request(`/stream/vid?${await signer.signQuery('vid', 0)}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    ac.abort();
    await Promise.resolve();
    expect(fs.killed()).toBe(true);
    // Slot released, so a fresh request succeeds despite maxConcurrent=1.
    expect((await r.request(`/stream/vid?${await signer.signQuery('vid', 0)}`)).status).toBe(200);
  });
});

describe('GET /subs/:videoId', () => {
  const withSubs = { ...base, yt: fakeYt({ subtitles: { en: [{ ext: 'vtt', url: 'https://cc/en.vtt' }] }, automatic_captions: {} }), maxConcurrent: 2 };

  test('proxies a VTT caption track as text/vtt', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response('WEBVTT\n\n00:00.000 --> 00:01.000\nhi', { status: 200 })) as unknown as typeof fetch;
    try {
      const r = makeYtStreamRoutes(withSubs);
      const res = await r.request('/subs/vid?lang=en');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/vtt');
      expect(await res.text()).toContain('WEBVTT');
    } finally {
      globalThis.fetch = original;
    }
  });

  test('400 when lang is missing', async () => {
    expect((await makeYtStreamRoutes(withSubs).request('/subs/vid')).status).toBe(400);
  });

  test('404 when the language has no captions', async () => {
    expect((await makeYtStreamRoutes(withSubs).request('/subs/vid?lang=zz')).status).toBe(404);
  });
});
