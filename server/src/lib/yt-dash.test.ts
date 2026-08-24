import { describe, expect, test } from 'bun:test';
import { makeYtDash } from './yt-dash';
import type { YtDlp } from './ytdlp';

// Minimal ftyp+moov+sidx head (2 segments) for the fake ranged fetch.
function head(): Uint8Array {
  const box = (type: string, payload: Buffer) => {
    const b = Buffer.alloc(8 + payload.length);
    b.writeUInt32BE(8 + payload.length, 0); b.write(type, 4, 'ascii'); payload.copy(b, 8);
    return b;
  };
  const p = Buffer.alloc(4 + 4 + 4 + 4 + 4 + 2 + 2 + 2 * 12);
  let o = 0;
  p.writeUInt32BE(0, o); o += 4;       // version+flags
  p.writeUInt32BE(1, o); o += 4;       // ref id
  p.writeUInt32BE(1000, o); o += 4;    // timescale
  p.writeUInt32BE(0, o); o += 4; p.writeUInt32BE(0, o); o += 4; // ept, first_offset
  p.writeUInt16BE(0, o); o += 2; p.writeUInt16BE(2, o); o += 2; // reserved, refCount
  for (const [sz, dur] of [[500, 2000], [700, 2000]]) {
    p.writeUInt32BE(sz!, o); o += 4; p.writeUInt32BE(dur!, o); o += 4; p.writeUInt32BE(0, o); o += 4;
  }
  return new Uint8Array(Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', Buffer.alloc(8)), box('sidx', p)]));
}

const fakeYt = (text: string): YtDlp => ({ json: async () => ({}), text: async () => text });
const fakeFetch = (() => new Response(head())) as unknown as typeof fetch;

describe('makeYtDash.resolve', () => {
  test('returns video+audio streams with parsed indexes', async () => {
    const d = makeYtDash(fakeYt('https://gv/video\nhttps://gv/audio'), { fetchImpl: fakeFetch, now: () => 1 });
    const r = await d.resolve('vid');
    expect(r).not.toBeNull();
    expect(r!.video.url).toBe('https://gv/video');
    expect(r!.audio.url).toBe('https://gv/audio');
    expect(r!.video.index.timescale).toBe(1000);
    expect(r!.video.index.references).toHaveLength(2);
  });

  test('returns null when the video has no separate DASH (only 1 url)', async () => {
    const d = makeYtDash(fakeYt('https://gv/muxed'), { fetchImpl: fakeFetch });
    expect(await d.resolve('vid')).toBeNull();
  });

  test('keeps the init range under googlevideo per-stream prefix cap', async () => {
    // googlevideo refuses (403) an init request reaching past the prefix it will
    // serve — measured at ~1.08MiB on audio. Asking for more fails outright.
    let range = '';
    const spy = ((_u: string, init: { headers: Record<string, string> }) => {
      range = init.headers.Range ?? '';
      return new Response(head());
    }) as unknown as typeof fetch;
    const d = makeYtDash(fakeYt('https://gv/v\nhttps://gv/a'), { fetchImpl: spy, now: () => 1 });
    await d.resolve('vid');
    const end = Number(range.match(/^bytes=0-(\d+)$/)![1]);
    expect(end).toBeLessThan(1_048_576);
  });

  test('returns null (not a parse error) when the init fetch is rejected', async () => {
    // googlevideo intermittently 403s freshly-signed URLs. The body is empty, so
    // parsing it as an init segment threw 'no sidx box found' -> HTTP 500.
    let calls = 0;
    const yt: YtDlp = { json: async () => ({}), text: async () => { calls++; return 'https://gv/v\nhttps://gv/a'; } };
    const deny = (() => new Response(null, { status: 403 })) as unknown as typeof fetch;
    const d = makeYtDash(yt, { fetchImpl: deny, now: () => 1 });
    expect(await d.resolve('vid')).toBeNull();
    expect(calls).toBe(2); // re-extracted once for fresh URLs before giving up
  });

  test('re-extracts and succeeds when only the first set of URLs is poisoned', async () => {
    let calls = 0;
    const yt: YtDlp = { json: async () => ({}), text: async () => `https://gv/v${++calls}\nhttps://gv/a${calls}` };
    const flaky = ((url: string) =>
      url.endsWith('1') ? new Response(null, { status: 403 }) : new Response(head())) as unknown as typeof fetch;
    const d = makeYtDash(yt, { fetchImpl: flaky, now: () => 1 });
    const r = await d.resolve('vid');
    expect(r).not.toBeNull();
    expect(r!.video.url).toBe('https://gv/v2');
    expect(calls).toBe(2);
  });

  test('does not cache a failed resolve', async () => {
    let calls = 0;
    const yt: YtDlp = { json: async () => ({}), text: async () => { calls++; return 'https://gv/v\nhttps://gv/a'; } };
    let deny = true;
    const f = (() => (deny ? new Response(null, { status: 403 }) : new Response(head()))) as unknown as typeof fetch;
    const d = makeYtDash(yt, { fetchImpl: f, now: () => 1 });
    expect(await d.resolve('vid')).toBeNull();
    deny = false;
    expect(await d.resolve('vid')).not.toBeNull(); // retried, not served from a poisoned cache
    expect(calls).toBe(3);
  });

  test('caches within TTL (no repeat yt-dlp call)', async () => {
    let calls = 0;
    const yt: YtDlp = { json: async () => ({}), text: async () => { calls++; return 'https://gv/v\nhttps://gv/a'; } };
    let t = 0;
    const d = makeYtDash(yt, { fetchImpl: fakeFetch, now: () => t });
    await d.resolve('vid');
    t = 1000; // within TTL
    await d.resolve('vid');
    expect(calls).toBe(1);
  });
});
