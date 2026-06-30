import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export const sourceHomeRoutes = new Hono();

sourceHomeRoutes.get('/', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'missing key' }, 400);
  const sources = parseXSources(c.req.raw);
  try {
    const data = await callOneSource(sources, key, async (src) => {
      const adapter = getAdapter(src.type);
      const ctx = { baseUrl: src.baseUrl, token: src.token };
      const [rows, libsResult] = await Promise.all([
        adapter.home(ctx),
        adapter.library(ctx).catch(() => ({ breadcrumbs: [], items: [] })),
      ]);
      const continueWatching = rows.find((r) => r.kind === 'continue')?.items ?? [];
      const recentlyAdded = rows.find((r) => r.kind === 'recent')?.items ?? [];
      const libraries = libsResult.items.filter((i) => i.type === 'folder');
      return { continueWatching, recentlyAdded, libraries };
    });
    return c.json(data);
  } catch (e) {
    const { status, message } = explain(e);
    const httpStatus = String(message).startsWith('source not paired:') ? 404 : status;
    return c.json({ error: message }, httpStatus as 404 | 502);
  }
});
