import { Hono } from 'hono';
import type { Db } from '../db';
import { getUserSources } from '../lib/user-sources';
import { getAuthContext } from '../middleware/auth';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function makeItemRoutes(getDb: () => Db) {
  const r = new Hono();

  // :id can contain slashes (encoded IDs from Flixify, Plex compound paths), so
  // use `{.+}` to capture greedily.
  r.get('/:srcKey/:id{.+}', async (c) => {
    const srcKey = c.req.param('srcKey');
    const id = c.req.param('id');
    const sources = getUserSources(getDb(), getAuthContext(c));
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

  return r;
}
