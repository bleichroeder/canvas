import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export const itemRoutes = new Hono();

// :id can contain slashes (encoded IDs from Flixify, Plex compound paths), so
// use `{.+}` to capture greedily.
itemRoutes.get('/:srcKey/:id{.+}', async (c) => {
  const srcKey = c.req.param('srcKey');
  const id = c.req.param('id');
  const sources = parseXSources(c.req.raw);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.item({ baseUrl: src.baseUrl, token: src.token }, id);
    });
    return c.json(result);
  } catch (e) {
    const { status, message } = explain(e);
    return c.json({ error: message }, status as 502);
  }
});
