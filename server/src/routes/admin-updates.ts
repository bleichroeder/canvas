import { Hono } from 'hono';
import type { Db } from '../db';
import { config } from '../config';
import { getUpdateStatus } from '../lib/update-checker';
import { getUpdatePreferences, setUpdatePreferences, type UpdatePreferences } from '../storage/update-preferences';
import type { WatchtowerClient } from '../lib/watchtower-client';

export function makeAdminUpdatesRoutes(getDb: () => Db, wtClient: WatchtowerClient) {
  const r = new Hono();

  r.get('/updates/status', async (c) => {
    const status = await getUpdateStatus(config.CANVAS_VERSION);
    return c.json(status);
  });

  r.get('/updates/preferences', async (c) => {
    const db = getDb();
    const prefs = getUpdatePreferences(db);
    const watchtowerReachable = await wtClient.isReachable();
    return c.json({ ...prefs, watchtowerReachable });
  });

  r.patch('/updates/preferences', async (c) => {
    const body = await c.req.json().catch(() => ({})) as { autoUpdate?: unknown };
    const patch: Partial<UpdatePreferences> = {};
    if (body.autoUpdate !== undefined) {
      if (typeof body.autoUpdate !== 'boolean') {
        return c.json({ error: 'autoUpdate must be a boolean' }, 400);
      }
      patch.autoUpdate = body.autoUpdate;
    }
    if (Object.keys(patch).length === 0) {
      return c.json({ error: 'no fields to update' }, 400);
    }
    const db = getDb();
    const updated = setUpdatePreferences(db, patch);
    const watchtowerReachable = await wtClient.isReachable();
    return c.json({ ...updated, watchtowerReachable });
  });

  r.post('/updates/apply', async (c) => {
    const reachable = await wtClient.isReachable();
    if (!reachable) {
      return c.json({ error: 'watchtower unreachable — see docs/updates.md' }, 409);
    }
    try {
      await wtClient.triggerUpdate();
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
    return c.body(null, 202);
  });

  return r;
}
