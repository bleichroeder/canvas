import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export const progressRoutes = new Hono();

progressRoutes.post('/:srcKey/:id{.+}', async (c) => {
  const srcKey = c.req.param('srcKey');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as { posSec?: unknown; completed?: unknown } | null;
  if (!body || typeof body.posSec !== 'number') {
    return c.json({ error: 'posSec required' }, 400);
  }
  const posSec = body.posSec;
  const completed = body.completed === true;
  const sources = parseXSources(c.req.raw);
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
