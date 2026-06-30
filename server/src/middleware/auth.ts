import type { Context, Next } from 'hono';
import type { Db } from '../db';
import { hashBearer } from '../lib/bearer';
import { getDeviceSession, touchDeviceSession } from '../storage/device-sessions';
import { getUser } from '../storage/users';
import { nowSec } from '../lib/time';

export interface AuthContext {
  userId: number;
  role: 'admin' | 'member';
  deviceTokenHash: string;
}

const AUTH_VAR = 'auth' as const;

export function requireUser(getDb: () => Db) {
  return async (c: Context, next: Next) => {
    const header = c.req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const bearer = header.slice('Bearer '.length).trim();
    if (!bearer) return c.json({ error: 'unauthorized' }, 401);
    const tokenHash = await hashBearer(bearer);
    const session = getDeviceSession(getDb(), tokenHash);
    if (!session) return c.json({ error: 'unauthorized' }, 401);
    const user = getUser(getDb(), session.userId);
    if (!user) return c.json({ error: 'unauthorized' }, 401);
    // Fire-and-forget last-seen bump. SQLite is serial; this is fast.
    try { touchDeviceSession(getDb(), tokenHash, nowSec()); } catch { /* ignore */ }
    c.set(AUTH_VAR, { userId: user.id, role: user.role, deviceTokenHash: tokenHash } satisfies AuthContext);
    await next();
  };
}

export async function requireAdmin(c: Context, next: Next) {
  const auth = c.get(AUTH_VAR) as AuthContext | undefined;
  if (!auth) return c.json({ error: 'unauthorized' }, 401);
  if (auth.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
}

export function getAuthContext(c: Context): AuthContext {
  const auth = c.get(AUTH_VAR) as AuthContext | undefined;
  if (!auth) throw new Error('getAuthContext: no auth context (requireUser middleware missing)');
  return auth;
}
