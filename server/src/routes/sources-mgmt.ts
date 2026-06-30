import { Hono } from 'hono';
import type { Db } from '../db';
import { getSource, listAllSources, listAccessibleSources, deleteSource } from '../storage/sources';
import { getAuthContext } from '../middleware/auth';
import { logger } from '../log';

export function makeSourcesMgmtRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const auth = getAuthContext(c);
    const db = getDb();
    const rows = auth.role === 'admin' ? listAllSources(db) : listAccessibleSources(db, auth.userId);
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

  return r;
}
