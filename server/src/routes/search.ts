import { Hono } from 'hono';
import type { Db } from '../db';
import { getUserSources } from '../lib/user-sources';
import { getAuthContext } from '../middleware/auth';
import { callPerSource } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function makeSearchRoutes(getDb: () => Db) {
  const r = new Hono();

  r.get('/', async (c) => {
    const q = c.req.query('q') ?? '';
    if (!q) return c.json({ hits: [], errors: [] });
    const sources = getUserSources(getDb(), getAuthContext(c));
    const { results, errors } = await callPerSource(sources, async (_key, src) => {
      const adapter = getAdapter(src.type);
      return adapter.search({ baseUrl: src.baseUrl, token: src.token }, q);
    });
    const hits = Object.entries(results).flatMap(([key, items]) =>
      items.map((i) => ({ ...i, source: key })),
    );
    return c.json({ hits, errors });
  });

  return r;
}
