import { Hono } from 'hono';
import type { Db } from '../db';
import { getSource, listAllSources, listAccessibleSources, deleteSource, listAllSourceAccessGrants, updateSource } from '../storage/sources';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

export function makeSourcesMgmtRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const auth = getAuthContext(c);
    const db = getDb();
    if (auth.role === 'admin') {
      const rows = listAllSources(db);
      // Include per-source user-access lists so the admin Users UI can render
      // grant checkboxes without a second round-trip per user.
      const grants = listAllSourceAccessGrants(db);
      return c.json(rows.map((s) => ({
        id: s.id,
        type: s.type,
        baseUrl: s.baseUrl,
        label: s.label,
        pairedByUserId: s.pairedByUserId,
        createdAt: s.createdAt,
        usersWithAccess: grants.get(s.id) ?? [],
        // NB: s.token (upstream auth) is NEVER returned — it stays server-side.
      })));
    }
    const rows = listAccessibleSources(db, auth.userId);
    return c.json(rows.map((s) => ({
      id: s.id,
      type: s.type,
      baseUrl: s.baseUrl,
      label: s.label,
      pairedByUserId: s.pairedByUserId,
      createdAt: s.createdAt,
      // NB: s.token (upstream auth) is NEVER returned in the listing — it stays
      // server-side. The frontend never needs to know it post-pair.
    })));
  });

  r.delete('/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const db = getDb();
    const source = getSource(db, id);
    if (!source) return c.json({ error: 'source not found' }, 404);
    if (auth.role !== 'admin' && source.pairedByUserId !== auth.userId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    deleteSource(db, id);
    logger.info({ sourceId: id, by: auth.userId }, 'source deleted');
    return c.body(null, 204);
  });

  // PATCH — edit label and/or connection URL on an existing source. Motivation:
  // Plex often hands back a plex.direct URL that isn't reachable from same-LAN
  // deployments (NAT hairpin), and users need a way to point canvas at their
  // Plex's local URL without a sqlite3 shell.
  r.patch('/:id', async (c) => {
    const auth = getAuthContext(c);
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'invalid id' }, 400);
    const db = getDb();
    const source = getSource(db, id);
    if (!source) return c.json({ error: 'source not found' }, 404);
    if (auth.role !== 'admin' && source.pairedByUserId !== auth.userId) {
      return c.json({ error: 'forbidden' }, 403);
    }
    const body = await c.req.json().catch(() => ({})) as { baseUrl?: unknown; label?: unknown };
    const patch: { baseUrl?: string; label?: string } = {};
    if (body.baseUrl !== undefined) {
      if (typeof body.baseUrl !== 'string') return c.json({ error: 'baseUrl must be a string' }, 400);
      const trimmed = body.baseUrl.trim().replace(/\/+$/, '');
      try { new URL(trimmed); }
      catch { return c.json({ error: 'baseUrl must be a valid URL' }, 400); }
      patch.baseUrl = trimmed;
    }
    if (body.label !== undefined) {
      if (typeof body.label !== 'string') return c.json({ error: 'label must be a string' }, 400);
      const trimmed = body.label.trim();
      if (!trimmed) return c.json({ error: 'label must be non-empty' }, 400);
      patch.label = trimmed;
    }
    if (Object.keys(patch).length === 0) return c.json({ error: 'no fields to update' }, 400);
    const updated = updateSource(db, id, patch);
    if (!updated) return c.json({ error: 'source not found' }, 404);
    logger.info({ sourceId: id, by: auth.userId, fields: Object.keys(patch) }, 'source updated');
    return c.json({
      id: updated.id,
      type: updated.type,
      baseUrl: updated.baseUrl,
      label: updated.label,
      pairedByUserId: updated.pairedByUserId,
      createdAt: updated.createdAt,
    });
  });

  return r;
}
