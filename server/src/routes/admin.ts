import { Hono } from 'hono';
import type { Db } from '../db';
import { createUser, deleteUser, getUser, listUsers } from '../storage/users';
import { createClaimToken, regenerateClaimToken } from '../storage/claim-tokens';
import { listUserDevices } from '../storage/device-sessions';
import { grantSourceAccess, revokeSourceAccess, listAccessibleSources, getSource } from '../storage/sources';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

const CLAIM_TTL_SEC = 24 * 60 * 60;

export function makeAdminRoutes(getDb: () => Db) {
  const r = new Hono();

  // GET /users → [{ id, label, role, createdAt, deviceCount, sourceAccessCount }]
  r.get('/users', async (c) => {
    const db = getDb();
    const users = listUsers(db);
    const enriched = users.map((u) => ({
      id: u.id,
      label: u.label,
      role: u.role,
      createdAt: u.createdAt,
      deviceCount: listUserDevices(db, u.id).length,
      sourceAccessCount: u.role === 'admin' ? null : listAccessibleSources(db, u.id).length,
    }));
    return c.json(enriched);
  });

  // POST /users  body: { label }  → { user, claimToken }
  r.post('/users', async (c) => {
    const body = await c.req.json().catch(() => null) as { label?: unknown } | null;
    if (!body || typeof body.label !== 'string' || body.label.length === 0 || body.label.length > 64) {
      return c.json({ error: 'invalid label' }, 400);
    }
    const db = getDb();
    const user = createUser(db, { label: body.label, role: 'member' });
    const claim = createClaimToken(db, user.id, CLAIM_TTL_SEC);
    logger.info({ userId: user.id, label: user.label }, 'admin created user');
    return c.json({
      user: { id: user.id, label: user.label, role: user.role, createdAt: user.createdAt },
      claimToken: claim.token,
    });
  });

  // DELETE /users/:id → 204
  r.delete('/users/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    if (id === auth.userId) return c.json({ error: 'admin cannot delete themselves' }, 409);
    const db = getDb();
    const target = getUser(db, id);
    if (!target) return c.json({ error: 'user not found' }, 404);
    if (target.role === 'admin') return c.json({ error: 'admin cannot be deleted' }, 409);
    // FK cascade handles claim_tokens, device_sessions, user_source_access.
    // Sources paired by this user get pairedByUserId set to null (ON DELETE SET NULL).
    deleteUser(db, id);
    logger.info({ userId: id }, 'admin deleted user');
    return c.body(null, 204);
  });

  // POST /users/:id/claim-token → { claimToken }
  r.post('/users/:id/claim-token', async (c) => {
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const db = getDb();
    const target = getUser(db, id);
    if (!target) return c.json({ error: 'user not found' }, 404);
    const claim = regenerateClaimToken(db, id, CLAIM_TTL_SEC);
    logger.info({ userId: id }, 'admin regenerated claim token');
    return c.json({ claimToken: claim.token });
  });

  // POST /users/:id/sources/:sourceId → 204 (grant)
  r.post('/users/:id/sources/:sourceId', async (c) => {
    const userId = Number(c.req.param('id'));
    const sourceId = Number(c.req.param('sourceId'));
    if (!Number.isFinite(userId) || !Number.isFinite(sourceId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const db = getDb();
    const target = getUser(db, userId);
    if (!target) return c.json({ error: 'user not found' }, 404);
    if (target.role === 'admin') return c.json({ error: 'admin access is implicit' }, 409);
    const source = getSource(db, sourceId);
    if (!source) return c.json({ error: 'source not found' }, 404);
    grantSourceAccess(db, userId, sourceId);
    return c.body(null, 204);
  });

  // DELETE /users/:id/sources/:sourceId → 204 (revoke)
  r.delete('/users/:id/sources/:sourceId', async (c) => {
    const userId = Number(c.req.param('id'));
    const sourceId = Number(c.req.param('sourceId'));
    if (!Number.isFinite(userId) || !Number.isFinite(sourceId)) {
      return c.json({ error: 'invalid id' }, 400);
    }
    const db = getDb();
    revokeSourceAccess(db, userId, sourceId);
    return c.body(null, 204);
  });

  return r;
}
