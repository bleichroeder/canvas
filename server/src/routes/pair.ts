import { Hono } from 'hono';
import type { Db } from '../db';
import {
  createPairSession,
  getPairSession,
  setPairSessionStatus,
  updatePairSessionPayload,
  deletePairSession,
} from '../storage/pair-sessions';
import type { PairPayload } from '../db/schema';
import { generatePin, isPinShape } from '../lib/pin';
import { nowSec } from '../lib/time';
import { logger } from '../log';
import { getAuthContext } from '../middleware/auth';
import { createSource, grantSourceAccess } from '../storage/sources';
import {
  FLIXIFY_API_BASE,
  harvestCookies,
  serializeFlixifyAuth,
  type FlixifyAuth,
} from '../sources/flixify';

const PAIR_TTL_SEC = 10 * 60;

// Schema-narrowing: the worker accepts 'plex' | 'jellyfin' | 'flixify' | 'generic',
// but the DB schema's pair_sessions.type column is enum('plex', 'flixify') only.
// The frontend's Pair.tsx marks jellyfin and generic as available: false, so no
// live pair flow ever produces them. We narrow at the route layer and return 400
// for jellyfin or generic.
const SUPPORTED_TYPES = ['plex', 'flixify'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

// Flixify-specific shared bits (ported from the pre-self-host Cloudflare Worker).
const FLIXIFY_USER_AGENT = 'PP-base Kodi plugin 2.1.17';
const FLIXIFY_DEFAULT_MIRROR = 'thecalm.site';

interface FlixifyPinState {
  pin_id: string;
  auth: FlixifyAuth;
  mirror: string;
}

interface PinGenerateResp { id: string; pin: string }
interface PinLoginResp { state?: 'waiting' | 'success'; user_id?: string | number }

function formatPin(raw: string): string {
  const m = raw.match(/.{1,2}/g);
  return m ? m.join('-') : raw;
}

async function flixifyPinGenerate(): Promise<{ id: string; pin: string; cookies: FlixifyAuth }> {
  const res = await fetch(`${FLIXIFY_API_BASE}/pin/generate?_=${Date.now()}`, {
    method: 'GET',
    headers: { 'User-Agent': FLIXIFY_USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`flixify pin/generate ${res.status}`);
  const data = await res.json() as PinGenerateResp;
  const cookies = harvestCookies(res, { pip: '', session: '' });
  if (!data?.id || !data?.pin) throw new Error('flixify pin/generate: malformed response');
  return { id: String(data.id), pin: String(data.pin), cookies };
}

async function flixifyPinCheck(pinId: string, baseAuth: FlixifyAuth): Promise<{ state: string; auth: FlixifyAuth }> {
  const url = new URL(`${FLIXIFY_API_BASE}/pin/login`);
  url.searchParams.set('pin_id', pinId);
  url.searchParams.set('_', String(Date.now()));
  const cookieParts: string[] = [];
  if (baseAuth.pip) cookieParts.push(`pip=${baseAuth.pip}`);
  if (baseAuth.session) cookieParts.push(`session=${baseAuth.session}`);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': FLIXIFY_USER_AGENT,
      Accept: 'application/json',
      ...(cookieParts.length ? { Cookie: cookieParts.join('; ') } : {}),
    },
  });
  if (!res.ok) throw new Error(`flixify pin/login ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as PinLoginResp;
  const next = harvestCookies(res, baseAuth);
  return { state: data?.state ?? 'waiting', auth: next };
}

async function flixifySiteSettings(auth: FlixifyAuth): Promise<{ asset_host?: string }> {
  const url = `${FLIXIFY_API_BASE}/api/site_settings?_=${Date.now()}`;
  const cookieParts: string[] = [];
  if (auth.pip) cookieParts.push(`pip=${auth.pip}`);
  if (auth.session) cookieParts.push(`session=${auth.session}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': FLIXIFY_USER_AGENT,
      Accept: 'application/json',
      ...(cookieParts.length ? { Cookie: cookieParts.join('; ') } : {}),
    },
  });
  if (!res.ok) return {};
  return (await res.json().catch(() => ({}))) as { asset_host?: string };
}

// /plex-servers helpers (ported from the pre-self-host Cloudflare Worker).
interface PlexConnection { protocol: string; uri: string; local: boolean; relay: boolean }
interface PlexResource {
  name: string;
  clientIdentifier: string;
  provides: string;
  accessToken: string;
  connections: PlexConnection[];
}

function isPrivatePlexUri(uri: string): boolean {
  const m = uri.match(/\/\/(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\./);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

const isHttps = (c: PlexConnection) => c.protocol === 'https';

export function makePairRoutes(getDb: () => Db) {
  const r = new Hono();

  // POST /start  body: { sourceType }
  // Response: { code, expiresAt }  (expiresAt is ms-since-epoch)
  // Schema-narrowing: only 'plex' and 'flixify' accepted; jellyfin/generic return 400.
  r.post('/start', async (c) => {
    const body = await c.req.json().catch(() => null) as { sourceType?: unknown } | null;
    const sourceType = body?.sourceType;
    if (typeof sourceType !== 'string' || !SUPPORTED_TYPES.includes(sourceType as SupportedType)) {
      return c.json({ error: 'invalid sourceType' }, 400);
    }
    const code = generatePin();
    const now = nowSec();
    createPairSession(getDb(), {
      code,
      type: sourceType as SupportedType,
      status: 'pending',
      payload: {},
      createdAt: now,
      expiresAt: now + PAIR_TTL_SEC,
    });
    logger.info({ code, sourceType }, 'pair start');
    return c.json({ code, expiresAt: (now + PAIR_TTL_SEC) * 1000 });
  });

  // POST /poll  body: { code }
  // Response shapes:
  //   { status: 'expired' }                                 (missing or expired session)
  //   { status: 'approved', source: {...} }                  (approved)
  //   { status: 'pending', sourceType }                      (pending)
  // NOTE: Never returns 404 — mirrors worker behavior exactly.
  r.post('/poll', async (c) => {
    const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
    const code = body?.code;
    if (typeof code !== 'string' || !isPinShape(code)) {
      return c.json({ error: 'invalid code' }, 400);
    }
    const session = getPairSession(getDb(), code);
    if (!session) return c.json({ status: 'expired' });
    if (session.expiresAt < nowSec() || session.status === 'expired') {
      return c.json({ status: 'expired' });
    }
    if (session.status === 'approved') {
      const payload = session.payload as { source?: { id: number; type: string; baseUrl: string; token: string; label: string } };
      const src = payload.source;
      if (!src) return c.json({ status: 'approved' });
      const { token: _omit, ...safeSource } = src;
      return c.json({ status: 'approved', source: safeSource });
    }
    return c.json({ status: 'pending', sourceType: session.type });
  });

  // POST /approve  body: { code, type, baseUrl, token, label }
  // Response: 204 (no body) — matches worker behavior.
  // Validation: baseUrl must start with 'http', token must be non-empty, type ∈ SUPPORTED_TYPES.
  r.post('/approve', async (c) => {
    const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return c.json({ error: 'invalid json' }, 400);
    const { code, type, baseUrl, token, label } = body;
    if (
      typeof code !== 'string' || !isPinShape(code) ||
      typeof type !== 'string' || !SUPPORTED_TYPES.includes(type as SupportedType) ||
      typeof baseUrl !== 'string' || !baseUrl.startsWith('http') ||
      typeof token !== 'string' || token.length === 0 ||
      typeof label !== 'string'
    ) {
      return c.json({ error: 'invalid approve payload' }, 400);
    }
    const session = getPairSession(getDb(), code);
    if (!session) return c.json({ error: 'code expired' }, 410);
    if (session.expiresAt < nowSec()) return c.json({ error: 'code expired' }, 410);
    if (session.status === 'approved') return c.body(null, 204);
    const existingPayload = (session.payload ?? {}) as PairPayload;
    const auth = getAuthContext(c);
    const created = createSource(getDb(), {
      type: type as 'plex' | 'flixify',
      baseUrl: baseUrl as string,
      token: token as string,
      label: label as string,
      pairedByUserId: auth.userId,
    });
    grantSourceAccess(getDb(), auth.userId, created.id);
    updatePairSessionPayload(getDb(), code, {
      ...existingPayload,
      source: { id: created.id, type, baseUrl, token, label },
    });
    setPairSessionStatus(getDb(), code, 'approved');
    logger.info({ code, sourceId: created.id, by: auth.userId }, 'source created from pair approve');
    return c.body(null, 204);
  });

  // DELETE /:code   -> 204 (no body) — matches worker behavior.
  r.delete('/:code', async (c) => {
    const code = c.req.param('code');
    if (!isPinShape(code)) return c.json({ error: 'invalid code' }, 400);
    deletePairSession(getDb(), code);
    return c.body(null, 204);
  });

  // POST /flixify-start  body: { code, mirror? }
  // Operates on an EXISTING pending session (created by /start with sourceType='flixify').
  // Does NOT create a new session.
  // Response: { pin: 'XX-XX-XX', pinRaw, mirror, pinUrl }
  r.post('/flixify-start', async (c) => {
    const body = await c.req.json().catch(() => null) as { code?: unknown; mirror?: unknown } | null;
    const code = body?.code;
    if (typeof code !== 'string' || !isPinShape(code)) {
      return c.json({ error: 'invalid code' }, 400);
    }
    const mirrorRaw = typeof body?.mirror === 'string' ? body.mirror.trim() : '';
    const mirror = mirrorRaw || FLIXIFY_DEFAULT_MIRROR;

    const existing = getPairSession(getDb(), code);
    if (!existing) return c.json({ error: 'code expired' }, 410);
    if (existing.status === 'approved') return c.json({ error: 'already approved' }, 409);
    if (existing.type !== 'flixify') {
      return c.json({ error: 'pair code is not a flixify session' }, 400);
    }

    let pinId: string;
    let pin: string;
    let initialAuth: FlixifyAuth;
    try {
      const result = await flixifyPinGenerate();
      pinId = result.id;
      pin = result.pin;
      initialAuth = { ...result.cookies, mirror };
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'flixify pin generate failed');
      return c.json({ error: 'pin_generate failed' }, 502);
    }

    const existingPayload = (existing.payload ?? {}) as PairPayload;
    const updatedFlixify: FlixifyPinState = { pin_id: pinId, auth: initialAuth, mirror };
    updatePairSessionPayload(getDb(), code, { ...existingPayload, flixify: updatedFlixify });

    return c.json({
      pin: formatPin(pin),
      pinRaw: pin,
      mirror,
      pinUrl: `https://${mirror}/account/pin`,
    });
  });

  // POST /flixify-poll  body: { code }
  // Response: { status: 'expired' | 'waiting' | 'approved' }
  // NOTE: NO `source` field in the response — mirrors worker behavior exactly.
  //       The source is persisted into the session row; the frontend retrieves
  //       it via /poll once this returns 'approved'.
  r.post('/flixify-poll', async (c) => {
    const body = await c.req.json().catch(() => null) as { code?: unknown } | null;
    const code = body?.code;
    if (typeof code !== 'string' || !isPinShape(code)) {
      return c.json({ error: 'invalid code' }, 400);
    }
    const existing = getPairSession(getDb(), code);
    if (!existing) return c.json({ status: 'expired' });
    if (existing.expiresAt < nowSec()) return c.json({ status: 'expired' });
    if (existing.status === 'approved') return c.json({ status: 'approved' });
    if (existing.type !== 'flixify') {
      return c.json({ error: 'no flixify session for this code' }, 400);
    }
    const payload = (existing.payload ?? {}) as PairPayload & { flixify?: FlixifyPinState };
    if (!payload.flixify) {
      return c.json({ error: 'no flixify session for this code' }, 400);
    }
    const { pin_id, auth: prevAuth, mirror } = payload.flixify;

    let pollResult: { state: string; auth: FlixifyAuth };
    try {
      pollResult = await flixifyPinCheck(pin_id, prevAuth);
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'flixify pin/login error');
      return c.json({ status: 'waiting' });
    }

    if (pollResult.state !== 'success') {
      if (pollResult.auth !== prevAuth) {
        updatePairSessionPayload(getDb(), code, {
          ...payload,
          flixify: { pin_id, auth: pollResult.auth, mirror },
        });
      }
      return c.json({ status: 'waiting' });
    }

    // Success — fetch asset_host so the adapter builds absolute image URLs.
    let assetHost: string | undefined;
    try {
      const settings = await flixifySiteSettings(pollResult.auth);
      assetHost = settings.asset_host;
    } catch (e) {
      logger.warn({ err: (e as Error).message }, 'flixify site_settings fetch failed');
    }

    const finalAuth: FlixifyAuth = {
      ...pollResult.auth,
      ...(assetHost !== undefined ? { asset_host: assetHost } : {}),
      mirror,
    };
    const flixifyAuth = getAuthContext(c);
    const flixifyCreated = createSource(getDb(), {
      type: 'flixify',
      baseUrl: `https://${mirror}`,
      token: serializeFlixifyAuth(finalAuth),
      label: mirror,
      pairedByUserId: flixifyAuth.userId,
    });
    grantSourceAccess(getDb(), flixifyAuth.userId, flixifyCreated.id);
    updatePairSessionPayload(getDb(), code, {
      ...payload,
      flixify: { pin_id, auth: finalAuth, mirror },
      source: {
        id: flixifyCreated.id,
        type: 'flixify',
        baseUrl: `https://${mirror}`,
        token: serializeFlixifyAuth(finalAuth),
        label: mirror,
      },
    });
    setPairSessionStatus(getDb(), code, 'approved');
    logger.info({ code, mirror, sourceId: flixifyCreated.id, by: flixifyAuth.userId }, 'flixify pair approved');
    return c.json({ status: 'approved' });
  });

  // POST /plex-servers  body: { authToken, clientId }
  // Note: field is 'authToken' (not 'token') — matches worker behavior.
  // Response: { servers: ResolvedServer[] }
  r.post('/plex-servers', async (c) => {
    const body = await c.req.json().catch(() => null) as { authToken?: unknown; clientId?: unknown } | null;
    if (!body) return c.json({ error: 'invalid json' }, 400);
    if (typeof body.authToken !== 'string' || typeof body.clientId !== 'string') {
      return c.json({ error: 'authToken and clientId required' }, 400);
    }
    const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': body.authToken,
        'X-Plex-Client-Identifier': body.clientId,
      },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return c.json({ error: `plex.tv ${res.status}`, detail: detail.slice(0, 200) }, 502);
    }
    const resources = (await res.json()) as PlexResource[];
    const servers = resources
      .filter((r) => r.provides.split(',').includes('server'))
      .map((r) => {
        const conn =
          r.connections.find((c) => isHttps(c) && !isPrivatePlexUri(c.uri)) ??
          r.connections.find((c) => isHttps(c)) ??
          r.connections[0];
        const baseUrl = conn?.uri ?? '';
        return {
          name: r.name,
          clientIdentifier: r.clientIdentifier,
          baseUrl,
          accessToken: r.accessToken,
          publiclyReachable: !!conn && !isPrivatePlexUri(conn.uri),
        };
      })
      .filter((s) => s.baseUrl !== '');
    return c.json({ servers });
  });

  return r;
}
