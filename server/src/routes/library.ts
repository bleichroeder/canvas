import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;

export const libraryRoutes = new Hono();

libraryRoutes.get('/:srcKey/:libId?', async (c) => {
  const srcKey = c.req.param('srcKey');
  const libId = c.req.param('libId');
  const path = c.req.query('path');
  const offsetRaw = c.req.query('offset');
  const limitRaw = c.req.query('limit');
  const offset = offsetRaw !== undefined && Number.isFinite(Number(offsetRaw))
    ? Math.max(0, Math.floor(Number(offsetRaw)))
    : 0;
  const limit = limitRaw !== undefined && Number.isFinite(Number(limitRaw))
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limitRaw))))
    : DEFAULT_LIMIT;
  const page = libId ? { offset, limit } : undefined;
  const sources = parseXSources(c.req.raw);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.library({ baseUrl: src.baseUrl, token: src.token }, libId, path, page);
    });
    return c.json(result);
  } catch (e) {
    const { status, message } = explain(e);
    return c.json({ error: message }, status as 502);
  }
});
