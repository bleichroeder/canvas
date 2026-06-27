import { withCors } from '../cors';
import { log } from '../log';
import { generatePin, isPinShape, pinKvKey } from '../pin';
import type { SourceType } from '../sources/types';

const PAIR_TTL_SEC = 10 * 60;
const SUPPORTED_TYPES: SourceType[] = ['plex', 'jellyfin', 'flixify', 'generic'];

interface PairSessionPending {
  status: 'pending';
  sourceType: SourceType;
  createdAt: number;
}

interface PairSessionApproved {
  status: 'approved';
  source: { type: SourceType; baseUrl: string; token: string; label: string };
  createdAt: number;
}

type PairSession = PairSessionPending | PairSessionApproved;

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(
    req,
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export async function handlePairStart(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const sourceType = (body as { sourceType?: unknown }).sourceType;
  if (typeof sourceType !== 'string' || !SUPPORTED_TYPES.includes(sourceType as SourceType)) {
    return json(req, { error: 'invalid sourceType' }, 400);
  }
  const pin = generatePin();
  const session: PairSessionPending = {
    status: 'pending',
    sourceType: sourceType as SourceType,
    createdAt: Date.now(),
  };
  await kv.put(pinKvKey(pin), JSON.stringify(session), { expirationTtl: PAIR_TTL_SEC });
  log.info('pair start', pin, sourceType);
  return json(req, { code: pin, expiresAt: Date.now() + PAIR_TTL_SEC * 1000 });
}

export async function handlePairPoll(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const code = (body as { code?: unknown }).code;
  if (typeof code !== 'string' || !isPinShape(code)) {
    return json(req, { error: 'invalid code' }, 400);
  }
  const raw = await kv.get(pinKvKey(code), 'json');
  if (raw === null) return json(req, { status: 'expired' });
  const session = raw as PairSession;
  if (session.status === 'approved') {
    return json(req, { status: 'approved', source: session.source });
  }
  return json(req, { status: 'pending' });
}

export async function handlePairApprove(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const b = body as {
    code?: unknown;
    type?: unknown;
    baseUrl?: unknown;
    token?: unknown;
    label?: unknown;
  };
  if (
    typeof b.code !== 'string' || !isPinShape(b.code) ||
    typeof b.type !== 'string' || !SUPPORTED_TYPES.includes(b.type as SourceType) ||
    typeof b.baseUrl !== 'string' || !b.baseUrl.startsWith('http') ||
    typeof b.token !== 'string' || b.token.length === 0 ||
    typeof b.label !== 'string'
  ) {
    return json(req, { error: 'invalid approve payload' }, 400);
  }
  const key = pinKvKey(b.code);
  const existing = await kv.get(key, 'json');
  if (existing === null) return json(req, { error: 'code expired' }, 410);
  const approved: PairSessionApproved = {
    status: 'approved',
    source: { type: b.type as SourceType, baseUrl: b.baseUrl, token: b.token, label: b.label },
    createdAt: (existing as PairSession).createdAt,
  };
  await kv.put(key, JSON.stringify(approved), { expirationTtl: PAIR_TTL_SEC });
  log.info('pair approve', b.code);
  return withCors(req, new Response(null, { status: 204 }));
}

export async function handlePairDelete(req: Request, kv: KVNamespace, code: string): Promise<Response> {
  if (!isPinShape(code)) return json(req, { error: 'invalid code' }, 400);
  await kv.delete(pinKvKey(code));
  return withCors(req, new Response(null, { status: 204 }));
}
