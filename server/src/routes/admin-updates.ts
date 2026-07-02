import { Hono } from 'hono';
import type { Db } from '../db';
import { config } from '../config';
import { getUpdateStatus } from '../lib/update-checker';

export function makeAdminUpdatesRoutes(_getDb: () => Db) {
  const r = new Hono();

  r.get('/updates/status', async (c) => {
    const status = await getUpdateStatus(config.CANVAS_VERSION);
    return c.json(status);
  });

  return r;
}
