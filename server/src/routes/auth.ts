import { Hono } from 'hono';
import type { Db } from '../db';
import { consumeClaimToken } from '../storage/claim-tokens';
import { createDeviceSession, deleteDeviceSession, getDeviceSession, listUserDevices } from '../storage/device-sessions';
import { getUser, getUserByLabel, getPasswordHash, setPasswordHash } from '../storage/users';
import { generateBearer, hashBearer } from '../lib/bearer';
import { getAuthContext, requireUser } from '../middleware/auth';
import { logger } from '../log';

export function makeAuthRoutes(getDb: () => Db) {
  const r = new Hono();

  // POST /login  body: { label, password, deviceLabel }  → { bearer, user }
  // Public — no auth required.
  r.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null) as { label?: unknown; password?: unknown; deviceLabel?: unknown } | null;
    if (!body || typeof body.label !== 'string' || typeof body.password !== 'string' || typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0) {
      return c.json({ error: 'label, password, deviceLabel required' }, 400);
    }
    // Look up user by label — return same error for unknown label and wrong password
    const targetUser = getUserByLabel(getDb(), body.label);
    if (!targetUser) return c.json({ error: 'invalid credentials' }, 401);
    const hash = getPasswordHash(getDb(), targetUser.id);
    if (hash === null) return c.json({ error: 'password not set for this user' }, 400);
    const ok = await Bun.password.verify(body.password, hash);
    if (!ok) return c.json({ error: 'invalid credentials' }, 401);
    const bearer = generateBearer();
    const tokenHash = await hashBearer(bearer);
    createDeviceSession(getDb(), { userId: targetUser.id, deviceLabel: body.deviceLabel, tokenHash });
    logger.info({ userId: targetUser.id, deviceLabel: body.deviceLabel }, 'user logged in');
    return c.json({
      bearer,
      user: { id: targetUser.id, label: targetUser.label, role: targetUser.role, hasPassword: true },
    });
  });

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
    const passwordHash = getPasswordHash(getDb(), user.id);
    return c.json({ bearer, user: { id: user.id, label: user.label, role: user.role, hasPassword: passwordHash !== null } });
  });

  // The remaining endpoints require a valid bearer token.
  const authed = new Hono();
  authed.use('*', requireUser(getDb));

  // GET /me  → { user, devices }
  authed.get('/me', async (c) => {
    const auth = getAuthContext(c);
    const user = getUser(getDb(), auth.userId);
    if (!user) return c.json({ error: 'user not found' }, 404);
    const passwordHash = getPasswordHash(getDb(), auth.userId);
    const devices = listUserDevices(getDb(), auth.userId).map((d) => ({
      id: d.tokenHash,           // opaque to the client; suitable as a delete key
      label: d.deviceLabel,
      lastSeenAt: d.lastSeenAt,
      current: d.tokenHash === auth.deviceTokenHash,
    }));
    return c.json({ user: { id: user.id, label: user.label, role: user.role, hasPassword: passwordHash !== null }, devices });
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

  // POST /set-password  body: { newPassword }  → 204
  authed.post('/set-password', async (c) => {
    const body = await c.req.json().catch(() => null) as { newPassword?: unknown } | null;
    if (!body || typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
      return c.json({ error: 'password must be at least 8 characters' }, 400);
    }
    const auth = getAuthContext(c);
    const existing = getPasswordHash(getDb(), auth.userId);
    if (existing !== null) {
      return c.json({ error: 'password already set; use /change-password' }, 409);
    }
    const hash = await Bun.password.hash(body.newPassword);
    setPasswordHash(getDb(), auth.userId, hash);
    logger.info({ userId: auth.userId }, 'password set (first-time)');
    return c.body(null, 204);
  });

  // POST /change-password  body: { currentPassword, newPassword }  → 204
  // Revokes all OTHER device_sessions; keeps current.
  authed.post('/change-password', async (c) => {
    const body = await c.req.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
    if (!body || typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string' || body.newPassword.length < 8) {
      return c.json({ error: 'currentPassword required and newPassword must be at least 8 characters' }, 400);
    }
    const auth = getAuthContext(c);
    const currentHash = getPasswordHash(getDb(), auth.userId);
    if (currentHash === null) {
      return c.json({ error: 'no password set; use /set-password' }, 409);
    }
    const ok = await Bun.password.verify(body.currentPassword, currentHash);
    if (!ok) return c.json({ error: 'incorrect current password' }, 401);
    const newHash = await Bun.password.hash(body.newPassword);
    setPasswordHash(getDb(), auth.userId, newHash);
    // Revoke all OTHER device sessions — delete where user_id matches but token_hash differs from current.
    const currentTokenHash = auth.deviceTokenHash;
    (getDb() as unknown as { $client: { prepare(sql: string): { run(...args: unknown[]): void } } })
      .$client.prepare('DELETE FROM device_sessions WHERE user_id = ? AND token_hash != ?')
      .run(auth.userId, currentTokenHash);
    logger.info({ userId: auth.userId }, 'password changed; other devices revoked');
    return c.body(null, 204);
  });

  r.route('/', authed);
  return r;
}
