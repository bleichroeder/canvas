import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSourceStatus } from './source-status';

interface FakeKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function fakeKV(): FakeKV {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeReq(sources: Record<string, { type: string; baseUrl: string; token: string }>) {
  return new Request('https://api.test/api/source-status', {
    headers: { 'x-sources': JSON.stringify(sources) },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleSourceStatus', () => {
  it('returns 404 for unknown source key', async () => {
    const url = new URL('https://api.test/api/source-status?key=missing');
    const res = await handleSourceStatus(makeReq({}), { KV: fakeKV() } as never, url);
    expect(res.status).toBe(404);
  });

  it('returns lan-only when source baseUrl is RFC1918', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'http://192.168.1.5:32400', token: 't' },
    });
    const kv = fakeKV();
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'lan-only', lastSeenAt: null });
  });

  it('returns lan-only for plex.direct LAN subdomain', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://192-168-1-100.abc.plex.direct:32400', token: 't' },
    });
    const res = await handleSourceStatus(req, { KV: fakeKV() } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'lan-only', lastSeenAt: null });
  });

  it('returns cached value when KV has a fresh entry', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    kv.get.mockResolvedValueOnce(JSON.stringify({ status: 'ok', lastSeenAt: 1234 }));
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', lastSeenAt: 1234 });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('probes Plex /identity and returns ok on 200', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; lastSeenAt: unknown };
    expect(body.status).toBe('ok');
    expect(typeof body.lastSeenAt).toBe('number');
    expect(fetchMock).toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalled();
  });

  it('returns unreachable when probe fetch fails', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; lastSeenAt: unknown };
    expect(body.status).toBe('unreachable');
    expect(body.lastSeenAt).toBeNull();
  });

  it('returns 400 when key query param is missing', async () => {
    const url = new URL('https://api.test/api/source-status');
    const req = makeReq({});
    const res = await handleSourceStatus(req, { KV: fakeKV() } as never, url);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing key' });
  });

  it('returns degraded when probe resolves with non-ok status', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 503 }),
    );
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; lastSeenAt: unknown };
    expect(body.status).toBe('degraded');
    expect(typeof body.lastSeenAt).toBe('number');
  });
});
