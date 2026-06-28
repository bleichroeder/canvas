import { withCors } from '../cors';
import { parseXSources } from '../x-sources';
import { isRfc1918Host } from '../lib/rfc1918';
import type { Env } from '../index';

const CACHE_TTL_SEC = 30;
const PROBE_TIMEOUT_MS = 3000;

interface StatusResponse {
  status: 'ok' | 'degraded' | 'unreachable' | 'lan-only';
  lastSeenAt: number | null;
}

function probePath(type: string): string {
  switch (type) {
    case 'plex': return '/identity';
    case 'jellyfin': return '/System/Info/Public';
    default: return '/';
  }
}

async function probe(type: string, baseUrl: string, token: string): Promise<StatusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let url = `${baseUrl}${probePath(type)}`;
    if (type === 'plex') {
      url += `?X-Plex-Token=${encodeURIComponent(token)}`;
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    if (res.ok) return { status: 'ok', lastSeenAt: Date.now() };
    return { status: 'degraded', lastSeenAt: Date.now() };
  } catch {
    return { status: 'unreachable', lastSeenAt: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSourceStatus(req: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get('key');
  if (!key) {
    return withCors(req, new Response(JSON.stringify({ error: 'missing key' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }

  const sources = parseXSources(req);
  const src = sources[key];
  if (!src) {
    return withCors(req, new Response(JSON.stringify({ error: 'unknown source key' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
  }

  let host = '';
  try { host = new URL(src.baseUrl).hostname; } catch { host = ''; }

  if (isRfc1918Host(host)) {
    const body: StatusResponse = { status: 'lan-only', lastSeenAt: null };
    return withCors(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    }));
  }

  const cacheKey = `status:${key}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    return withCors(req, new Response(cached, {
      headers: { 'content-type': 'application/json' },
    }));
  }

  const result = await probe(src.type, src.baseUrl, src.token);
  const payload = JSON.stringify(result);
  await env.KV.put(cacheKey, payload, { expirationTtl: CACHE_TTL_SEC });
  return withCors(req, new Response(payload, {
    headers: { 'content-type': 'application/json' },
  }));
}
