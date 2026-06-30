import { Hono } from 'hono';
import type { Db } from '../db';
import { parseXSources } from '../lib/x-sources';
import { isRfc1918Host } from '../lib/rfc1918';
import { getSourceStatus, putSourceStatus } from '../storage/source-status';
import { nowSec } from '../lib/time';
import { FLIXIFY_API_BASE, parseFlixifyAuth } from '../sources/flixify';
import { logger } from '../log';

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

export function makeSourceStatusRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const key = c.req.query('key');
    if (!key) return c.json({ error: 'missing key' }, 400);

    const sources = parseXSources(c.req.raw);
    const src = sources[key];
    if (!src) return c.json({ error: 'unknown source key' }, 404);

    let host = '';
    try { host = new URL(src.baseUrl).hostname; } catch { host = ''; }
    if (isRfc1918Host(host)) {
      const body: StatusResponse = { status: 'lan-only', lastSeenAt: null };
      return c.json(body);
    }

    const cached = getSourceStatus(getDb(), key);
    if (cached && cached.expiresAt > nowSec()) {
      return c.json(cached.payload);
    }

    const result = await probe(src.type, src.baseUrl, src.token);
    try {
      putSourceStatus(getDb(), {
        sourceKey: key,
        status: result.status,
        lastSeenAt: result.lastSeenAt,
        expiresAt: nowSec() + CACHE_TTL_SEC,
        payload: result as unknown as Record<string, unknown>,
      });
    } catch (e) {
      // Cache write is best-effort; never let a storage failure mask a real probe result.
      logger.warn({ err: (e as Error).message, key }, 'source-status cache write failed');
    }
    return c.json(result);
  });

  return r;
}
