import { Hono } from 'hono';
import { parseXSources } from '../lib/x-sources';
import { parseFlixifyAuth } from '../sources/flixify';

export const subtitlesRoutes = new Hono();

subtitlesRoutes.get('/', async (c) => {
  const srcKey = c.req.query('src');
  if (!srcKey) return c.json({ error: 'missing src' }, 400);

  const sources = parseXSources(c.req.raw);
  const src = sources[srcKey];
  if (!src) return c.json({ error: 'unknown source key' }, 404);

  let upstreamUrl: string;
  const headers: Record<string, string> = { Accept: 'text/vtt' };

  if (src.type === 'plex') {
    const partId = c.req.query('partId');
    const streamId = c.req.query('streamId');
    if (!partId || !streamId) {
      return c.json({ error: 'missing partId/streamId for plex source' }, 400);
    }
    upstreamUrl = `${src.baseUrl}/library/parts/${encodeURIComponent(partId)}/${encodeURIComponent(streamId)}/subtitles.vtt?X-Plex-Token=${encodeURIComponent(src.token)}`;
  } else if (src.type === 'flixify') {
    const path = c.req.query('path');
    if (!path) return c.json({ error: 'missing path for flixify source' }, 400);
    const auth = parseFlixifyAuth(src.token);
    if (!auth.asset_host) {
      return c.json({ error: 'flixify source has no asset_host' }, 500);
    }
    upstreamUrl = `https://${auth.asset_host}${path}`;
    const cookieParts: string[] = [];
    if (auth.pip) cookieParts.push(`pip=${auth.pip}`);
    if (auth.session) cookieParts.push(`session=${auth.session}`);
    if (auth.profile_id) cookieParts.push(`profile_id=${auth.profile_id}`);
    if (cookieParts.length) headers.Cookie = cookieParts.join('; ');
  } else {
    return c.json({ error: `subtitles not supported for source type ${src.type}` }, 501);
  }

  try {
    const res = await fetch(upstreamUrl, { headers });
    if (!res.ok) {
      return c.json({ error: `upstream returned ${res.status}` }, 502);
    }
    const body = await res.text();
    return new Response(body, {
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ error: msg }, 502);
  }
});
