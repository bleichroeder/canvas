import { describe, expect, test } from 'bun:test';
import { RangeFetcher } from './range-fetcher';

// A body that yields one chunk then errors the stream on the next read —
// simulates a connection dropping mid-transfer.
function bodyThenError(chunk: Uint8Array): ReadableStream<Uint8Array> {
  let sent = false;
  return new ReadableStream({
    pull(c) {
      if (!sent) { sent = true; c.enqueue(chunk); }
      else c.error(new Error('network fail'));
    },
  });
}
function cleanBody(chunk: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(c) { c.enqueue(chunk); c.close(); } });
}

describe('RangeFetcher resume behaviour', () => {
  test('live source: sends no Range and routes a drop to onInterrupted (no byte retry)', async () => {
    const original = globalThis.fetch;
    const ranges: (string | undefined)[] = [];
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      ranges.push((init?.headers as Record<string, string> | undefined)?.Range);
      return new Response(bodyThenError(new Uint8Array([1, 2, 3, 4])), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      let interrupted = 0, errored = 0, done = 0;
      const f = new RangeFetcher({
        url: 'http://localhost/stream',
        seekable: false,
        onChunk: () => {},
        onError: () => { errored += 1; },
        onDone: () => { done += 1; },
        onInterrupted: () => { interrupted += 1; },
      });
      f.start();
      await new Promise((r) => setTimeout(r, 100));
      expect(interrupted).toBe(1);            // handed off to time-based recovery
      expect(errored).toBe(0);                // not surfaced as fatal
      expect(done).toBe(0);
      expect(calls).toBe(1);                  // no byte-range retry against a live pipe
      expect(ranges[0]).toBeUndefined();      // never sent a Range header
    } finally {
      globalThis.fetch = original;
    }
  });

  test('seekable source: a drop retries with Range: bytes=<offset>- and completes', async () => {
    const original = globalThis.fetch;
    const ranges: (string | undefined)[] = [];
    let calls = 0;
    globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
      calls += 1;
      ranges.push((init?.headers as Record<string, string> | undefined)?.Range);
      if (calls === 1) return new Response(bodyThenError(new Uint8Array([1, 2, 3, 4])), { status: 200 });
      return new Response(cleanBody(new Uint8Array([5, 6])), { status: 206 });
    }) as unknown as typeof fetch;
    try {
      let interrupted = 0, errored = 0, done = 0;
      const f = new RangeFetcher({
        url: 'http://localhost/file.mp4',
        onChunk: () => {},
        onError: () => { errored += 1; },
        onDone: () => { done += 1; },
        onInterrupted: () => { interrupted += 1; },
      });
      f.start();
      await new Promise((r) => setTimeout(r, 400));   // allow the 200ms retry backoff
      expect(done).toBe(1);
      expect(errored).toBe(0);
      expect(interrupted).toBe(0);            // seekable never uses the interrupt path
      expect(calls).toBe(2);
      expect(ranges[0]).toBeUndefined();      // first request starts at offset 0 → no Range
      expect(ranges[1]).toBe('bytes=4-');     // retry resumes from the byte offset read so far
    } finally {
      globalThis.fetch = original;
    }
  });
});
