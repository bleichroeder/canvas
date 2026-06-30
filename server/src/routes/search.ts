import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callPerSource } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export const searchRoutes = new Hono();

searchRoutes.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  if (!q) return c.json({ hits: [], errors: [] });
  const sources = parseXSources(c.req.raw);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    return adapter.search({ baseUrl: src.baseUrl, token: src.token }, q);
  });
  const hits = Object.entries(results).flatMap(([key, items]) =>
    items.map((i) => ({ ...i, source: key })),
  );
  return c.json({ hits, errors });
});
