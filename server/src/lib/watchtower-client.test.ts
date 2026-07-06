import { describe, expect, test, mock } from 'bun:test';
import { makeWatchtowerClient } from './watchtower-client';

function mockFetch(handler: (input: string | URL, init?: RequestInit) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock(handler) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe('makeWatchtowerClient', () => {
  test('isReachable returns true when Watchtower responds with 2xx', async () => {
    const restore = mockFetch(async () => new Response('ok', { status: 200 }));
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 't', reachableTtlMs: 0 });
    expect(await c.isReachable()).toBe(true);
    restore();
  });

  test('isReachable returns true when Watchtower responds with 401 (still reachable)', async () => {
    const restore = mockFetch(async () => new Response('unauthorized', { status: 401 }));
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: '', reachableTtlMs: 0 });
    expect(await c.isReachable()).toBe(true);
    restore();
  });

  test('isReachable returns true when Watchtower responds with 5xx (still reachable)', async () => {
    const restore = mockFetch(async () => new Response('boom', { status: 503 }));
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 't', reachableTtlMs: 0 });
    expect(await c.isReachable()).toBe(true);
    restore();
  });

  test('isReachable returns false when fetch throws', async () => {
    const restore = mockFetch(async () => { throw new Error('ECONNREFUSED'); });
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 't', reachableTtlMs: 0 });
    expect(await c.isReachable()).toBe(false);
    restore();
  });

  test('isReachable returns false when url is empty', async () => {
    const c = makeWatchtowerClient({ url: '', token: 't', reachableTtlMs: 0 });
    expect(await c.isReachable()).toBe(false);
  });

  test('isReachable caches the probe result within TTL', async () => {
    let calls = 0;
    const restore = mockFetch(async () => { calls++; return new Response('', { status: 200 }); });
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 't', reachableTtlMs: 60_000 });
    await c.isReachable();
    await c.isReachable();
    await c.isReachable();
    expect(calls).toBe(1);
    restore();
  });

  test('triggerUpdate POSTs with bearer token and succeeds on 2xx', async () => {
    let capturedInit: RequestInit | undefined;
    const restore = mockFetch(async (_input, init) => {
      capturedInit = init;
      return new Response('', { status: 200 });
    });
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 'secret' });
    await c.triggerUpdate();
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer secret');
    restore();
  });

  test('triggerUpdate throws on non-2xx', async () => {
    const restore = mockFetch(async () => new Response('nope', { status: 500 }));
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: 't' });
    await expect(c.triggerUpdate()).rejects.toThrow(/500/);
    restore();
  });

  test('triggerUpdate throws when token is empty', async () => {
    const c = makeWatchtowerClient({ url: 'http://wt:8080', token: '' });
    await expect(c.triggerUpdate()).rejects.toThrow(/token/i);
  });
});
