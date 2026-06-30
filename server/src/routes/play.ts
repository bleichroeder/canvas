import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { callOneSource, explain } from '../lib/dispatch';
import { getAdapter } from '../sources/registry';

export function parseFromSecParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export const playRoutes = new Hono();

playRoutes.post('/:srcKey/:id{.+}', async (c) => {
  const srcKey = c.req.param('srcKey');
  const id = c.req.param('id');
  const fromSec = parseFromSecParam(c.req.query('fromSec') ?? null);
  const sources = parseXSources(c.req.raw);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id, fromSec);
    });
    // Tag each subtitle URL with ?src=<srcKey> so the subtitle proxy knows
    // which source to look up in x-sources. The adapter doesn't know the
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
