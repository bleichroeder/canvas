import { Hono } from 'hono';
import type { Db } from '../db';
import { getUserSources } from '../lib/user-sources';
import { getAuthContext } from '../middleware/auth';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function parseFromSecParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export function makePlayRoutes(getDb: () => Db) {
  const r = new Hono();

  r.post('/:srcKey/:id{.+}', async (c) => {
    const srcKey = c.req.param('srcKey');
    const id = c.req.param('id');
    const fromSec = parseFromSecParam(c.req.query('fromSec') ?? null);
    const sources = getUserSources(getDb(), getAuthContext(c));
    try {
      const result = await callOneSource(sources, srcKey, (src) => {
        const adapter = getAdapter(src.type);
        return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id, fromSec);
      });
      // Tag each subtitle URL with ?src=<srcKey> so the subtitle proxy knows
      // which source to look up by DB id. The adapter doesn't know the
      // srcKey — only the route does.
      if (result.subtitleTracks) {
        result.subtitleTracks = result.subtitleTracks.map((t) => ({
          ...t,
          url: t.url.includes('?')
            ? `${t.url}&src=${encodeURIComponent(srcKey)}`
            : `${t.url}?src=${encodeURIComponent(srcKey)}`,
        }));
      }
      return c.json(result);
    } catch (e) {
      const { status, message } = explain(e);
      return c.json({ error: message }, status as 502);
    }
  });

  return r;
}
