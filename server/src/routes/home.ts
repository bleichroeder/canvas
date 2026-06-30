import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callPerSource } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export const homeRoutes = new Hono();

homeRoutes.get('/', async (c) => {
  const sources = parseXSources(c.req.raw);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    const ctx = { baseUrl: src.baseUrl, token: src.token };
    const [home, libCount] = await Promise.all([
      adapter.home(ctx),
      adapter.library(ctx)
        .then((r) => r.items.filter((i) => i.type === 'folder').length)
        .catch(() => 0),
    ]);
    return { home, libCount };
  });
  const rows = Object.entries(results).flatMap(([key, rs]) =>
    rs.home.map((r) => ({ ...r, source: key })),
  );
  const libraryCounts: Record<string, number> = {};
  for (const [key, rs] of Object.entries(results)) libraryCounts[key] = rs.libCount;
  return c.json({ rows, errors, libraryCounts });
});
