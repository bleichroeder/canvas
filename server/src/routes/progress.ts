import { Hono } from 'hono';
import type { Db } from '../db';
import { getUserSources } from '../lib/user-sources';
import { getAuthContext } from '../middleware/auth';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function makeProgressRoutes(getDb: () => Db) {
  const r = new Hono();

  r.post('/:srcKey/:id{.+}', async (c) => {
    const srcKey = c.req.param('srcKey');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => null) as { posSec?: unknown; completed?: unknown } | null;
    if (!body || typeof body.posSec !== 'number') {
      return c.json({ error: 'posSec required' }, 400);
    }
    const posSec = body.posSec;
    const completed = body.completed === true;
    const sources = getUserSources(getDb(), getAuthContext(c));
    try {
      await callOneSource(sources, srcKey, (src) => {
        const adapter = getAdapter(src.type);
        return adapter.saveProgress({ baseUrl: src.baseUrl, token: src.token }, id, posSec, completed);
      });
      return c.body(null, 204);
    } catch (e) {
      const { status, message } = explain(e);
      return c.json({ error: message }, status as 502);
    }
  });

  return r;
}
