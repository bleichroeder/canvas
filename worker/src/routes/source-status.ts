import { withCors } from '../cors';
import { parseXSources } from '../x-sources';
import { isRfc1918Host } from '../lib/rfc1918';
import { FLIXIFY_API_BASE, parseFlixifyAuth } from '../sources/flixify';
import type { Env } from '../index';

// Cloudflare KV requires expirationTtl >= 60s; using the minimum so status
// stays reasonably fresh while still satisfying the constraint.
const CACHE_TTL_SEC = 60;
const PROBE_TIMEOUT_MS = 3000;

interface StatusResponse {
  status: 'ok' | 'degraded' | 'unreachable' | 'lan-only';
  lastSeenAt: number | null;
}

function buildProbeRequest(type: string, baseUrl: string, token: string): { url: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (type === 'plex') {
    return { url: `${baseUrl}/identity?X-Plex-Token=${encodeURIComponent(token)}`, headers };
  }
  if (type === 'jellyfin') {
    return { url: `${baseUrl}/System/Info/Public`, headers };
  }
  if (type === 'flixify') {
    // Flixify auth lives on flx-srv.com (the API host), not on the mirror.
    // Probe /api/logged_in which returns 200 + JSON when the session cookie
    // is still valid.
    const auth = parseFlixifyAuth(token);
    const cookieParts: string[] = [];
    if (auth.pip) cookieParts.push(`pip=${auth.pip}`);
    if (auth.session) cookieParts.push(`session=${auth.session}`);
    if (cookieParts.length) headers.Cookie = cookieParts.join('; ');
    return { url: `${FLIXIFY_API_BASE}/api/logged_in`, headers };
  }
  return { url: `${baseUrl}/`, headers };
}

async function probe(type: string, baseUrl: string, token: string): Promise<StatusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const { url, headers } = buildProbeRequest(type, baseUrl, token);
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
  // Cache write is best-effort; never let a KV failure mask a real probe result.
  try { await env.KV.put(cacheKey, payload, { expirationTtl: CACHE_TTL_SEC }); }
  catch { /* ignore */ }
  return withCors(req, new Response(payload, {
    headers: { 'content-type': 'application/json' },
  }));
}
