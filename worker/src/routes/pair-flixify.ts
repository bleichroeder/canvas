import { withCors } from '../cors';
import { log } from '../log';
import { isPinShape, pinKvKey } from '../pin';
import { FLIXIFY_API_BASE, harvestCookies, parseFlixifyAuth, serializeFlixifyAuth } from '../sources/flixify';
import type { FlixifyAuth } from '../sources/flixify';

const USER_AGENT = 'PP-base Kodi plugin 2.1.17';
const DEFAULT_MIRROR = 'thecalm.site';

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  }));
}

// Canvas pair session — must match the shape pair.ts writes/reads.
type PairSession =
  | { status: 'pending'; sourceType: string; createdAt: number; flixify?: { pin_id: string; auth: FlixifyAuth; mirror: string } }
  | { status: 'approved'; source: { type: string; baseUrl: string; token: string; label: string }; createdAt: number };

const PAIR_TTL_SEC = 10 * 60;

interface PinGenerateResp {
  id: string;
  pin: string;
}

interface PinLoginResp {
  state?: 'waiting' | 'success';
  user_id?: string | number;
}

function readBody(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

function formatPin(raw: string): string {
  // Flixify returns a 6-digit string; display formatted as "XX-XX-XX".
  const m = raw.match(/.{1,2}/g);
  return m ? m.join('-') : raw;
}

async function flixifyPinGenerate(): Promise<{ id: string; pin: string; cookies: FlixifyAuth }> {
  const res = await fetch(`${FLIXIFY_API_BASE}/pin/generate?_=${Date.now()}`, {
    method: 'GET',
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
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
      'User-Agent': USER_AGENT,
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
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(cookieParts.length ? { Cookie: cookieParts.join('; ') } : {}),
    },
  });
  if (!res.ok) return {};
  return (await res.json().catch(() => ({}))) as { asset_host?: string };
}

/** POST body: { code }. Starts the flixify PIN flow, mapping the canvas pair
 *  code to a flx-srv.com pin_id. Returns the user-visible Flixify PIN + the
 *  mirror URL where it should be entered. */
export async function handleFlixifyPairStart(req: Request, kv: KVNamespace): Promise<Response> {
  const body = await readBody(req) as { code?: unknown; mirror?: unknown } | null;
  const code = body?.code;
  if (typeof code !== 'string' || !isPinShape(code)) {
    return json(req, { error: 'invalid code' }, 400);
  }
  const mirrorRaw = typeof body?.mirror === 'string' ? body.mirror.trim() : '';
  const mirror = mirrorRaw || DEFAULT_MIRROR;

  const existing = (await kv.get(pinKvKey(code), 'json')) as PairSession | null;
  if (!existing) return json(req, { error: 'code expired' }, 410);
  if (existing.status === 'approved') return json(req, { error: 'already approved' }, 409);
  if (existing.sourceType !== 'flixify') {
    return json(req, { error: 'pair code is not a flixify session' }, 400);
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
    log.warn('flixify pin generate failed', (e as Error).message);
    return json(req, { error: 'pin_generate failed' }, 502);
  }

  const updated: PairSession = {
    ...existing,
    flixify: { pin_id: pinId, auth: initialAuth, mirror },
  };
  await kv.put(pinKvKey(code), JSON.stringify(updated), { expirationTtl: PAIR_TTL_SEC });

  return json(req, {
    pin: formatPin(pin),
    pinRaw: pin,
    mirror,
    pinUrl: `https://${mirror}/account/pin`,
  });
}

/** POST body: { code }. Polls the flixify pin-login endpoint with the
 *  associated pin_id. On success, harvests cookies + asset_host and writes
 *  the approved source into the existing pair session so Tesla's
 *  /api/pair/poll picks it up. */
export async function handleFlixifyPairPoll(req: Request, kv: KVNamespace): Promise<Response> {
  const body = await readBody(req) as { code?: unknown } | null;
  const code = body?.code;
  if (typeof code !== 'string' || !isPinShape(code)) {
    return json(req, { error: 'invalid code' }, 400);
  }
  const existing = (await kv.get(pinKvKey(code), 'json')) as PairSession | null;
  if (!existing) return json(req, { status: 'expired' });
  if (existing.status === 'approved') return json(req, { status: 'approved' });
  if (existing.sourceType !== 'flixify' || !existing.flixify) {
    return json(req, { error: 'no flixify session for this code' }, 400);
  }
  const { pin_id, auth: prevAuth, mirror } = existing.flixify;

  let pollResult: { state: string; auth: FlixifyAuth };
  try {
    pollResult = await flixifyPinCheck(pin_id, prevAuth);
  } catch (e) {
    log.warn('flixify pin/login error', (e as Error).message);
    return json(req, { status: 'waiting' });
  }

  if (pollResult.state !== 'success') {
    // Persist any cookie rotation, keep waiting.
    if (pollResult.auth !== prevAuth) {
      const next: PairSession = {
        ...existing,
        flixify: { pin_id, auth: pollResult.auth, mirror },
      };
      await kv.put(pinKvKey(code), JSON.stringify(next), { expirationTtl: PAIR_TTL_SEC });
    }
    return json(req, { status: 'waiting' });
  }

  // Success — fetch asset_host so the adapter can build absolute image URLs.
  let assetHost: string | undefined;
  try {
    const settings = await flixifySiteSettings(pollResult.auth);
    assetHost = settings.asset_host;
  } catch (e) {
    log.warn('flixify site_settings fetch failed', (e as Error).message);
  }

  const finalAuth: FlixifyAuth = { ...pollResult.auth, asset_host: assetHost, mirror };
  const approved: PairSession = {
    status: 'approved',
    source: {
      type: 'flixify',
      baseUrl: `https://${mirror}`,
      token: serializeFlixifyAuth(finalAuth),
      label: mirror,
    },
    createdAt: existing.createdAt,
  };
  await kv.put(pinKvKey(code), JSON.stringify(approved), { expirationTtl: PAIR_TTL_SEC });
  log.info('flixify pair approved', code, mirror);
  return json(req, { status: 'approved' });
}
