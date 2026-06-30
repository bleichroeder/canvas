import { Hono } from 'hono';
import type { Db } from '../db';
import { consumeClaimToken } from '../storage/claim-tokens';
import { createDeviceSession, deleteDeviceSession, getDeviceSession, listUserDevices } from '../storage/device-sessions';
import { getUser } from '../storage/users';
import { generateBearer, hashBearer } from '../lib/bearer';
import { getAuthContext, requireUser } from '../middleware/auth';
import { logger } from '../log';

export function makeAuthRoutes(getDb: () => Db) {
  const r = new Hono();

  // POST /claim  body: { token, deviceLabel }  → { bearer, user }
  // Public — no auth required.
  r.post('/claim', async (c) => {
    const body = await c.req.json().catch(() => null) as { token?: unknown; deviceLabel?: unknown } | null;
    if (!body || typeof body.token !== 'string' || typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0) {
      return c.json({ error: 'invalid claim payload' }, 400);
    }
    const claim = consumeClaimToken(getDb(), body.token);
    if (!claim) return c.json({ error: 'invalid or expired token' }, 410);
    const user = getUser(getDb(), claim.userId);
    if (!user) return c.json({ error: 'user not found' }, 410);
    const bearer = generateBearer();
    const tokenHash = await hashBearer(bearer);
    createDeviceSession(getDb(), { userId: user.id, deviceLabel: body.deviceLabel, tokenHash });
    logger.info({ userId: user.id, deviceLabel: body.deviceLabel }, 'device claimed');
    return c.json({ bearer, user: { id: user.id, label: user.label, role: user.role } });
  });

  // The remaining endpoints require a valid bearer token.
  const authed = new Hono();
  authed.use('*', requireUser(getDb));

  // GET /me  → { user, devices }
  authed.get('/me', async (c) => {
    const auth = getAuthContext(c);
    const user = getUser(getDb(), auth.userId);
    if (!user) return c.json({ error: 'user not found' }, 404);
    const devices = listUserDevices(getDb(), auth.userId).map((d) => ({
      id: d.tokenHash,           // opaque to the client; suitable as a delete key
      label: d.deviceLabel,
      lastSeenAt: d.lastSeenAt,
      current: d.tokenHash === auth.deviceTokenHash,
    }));
    return c.json({ user: { id: user.id, label: user.label, role: user.role }, devices });
  });

  // POST /logout  → 204  (revokes the calling bearer)
  authed.post('/logout', async (c) => {
    const auth = getAuthContext(c);
    deleteDeviceSession(getDb(), auth.deviceTokenHash);
    return c.body(null, 204);
  });

  // DELETE /devices/:id  → 204  (revoke another of MY devices; :id is tokenHash)
  authed.delete('/devices/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = c.req.param('id');
    const target = getDeviceSession(getDb(), id);
    if (!target) return c.json({ error: 'device not found' }, 404);
    if (target.userId !== auth.userId) return c.json({ error: 'forbidden' }, 403);
    deleteDeviceSession(getDb(), id);
    return c.body(null, 204);
  });

  r.route('/', authed);
  return r;
}
