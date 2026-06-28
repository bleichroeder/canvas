import { withCors } from '../cors';
import { parseXSources } from '../x-sources';

/**
 * Proxy fetch a Plex subtitle stream as WebVTT. Plex's subtitle endpoint
 * doesn't emit CORS headers, and the canvas player has no `<video>` element
 * to attach a `<track>` to, so we fetch text via the worker and serve it
 * with our normal CORS surface.
 *
 * Query: ?src=<srcKey>&partId=<N>&streamId=<N>
 */
export async function handleSubtitles(req: Request, url: URL): Promise<Response> {
  const srcKey = url.searchParams.get('src');
  const partId = url.searchParams.get('partId');
  const streamId = url.searchParams.get('streamId');
  if (!srcKey || !partId || !streamId) {
    return withCors(req, new Response(JSON.stringify({ error: 'missing src/partId/streamId' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }

  const sources = parseXSources(req);
  const src = sources[srcKey];
  if (!src) {
    return withCors(req, new Response(JSON.stringify({ error: 'unknown source key' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
  }
  if (src.type !== 'plex') {
    return withCors(req, new Response(JSON.stringify({ error: 'subtitles only supported for plex sources' }), {
      status: 501, headers: { 'content-type': 'application/json' },
    }));
  }

  // Plex serves VTT directly from this endpoint; for non-VTT originals it
  // converts on the fly.
  const plexUrl = `${src.baseUrl}/library/parts/${encodeURIComponent(partId)}/${encodeURIComponent(streamId)}/subtitles.vtt?X-Plex-Token=${encodeURIComponent(src.token)}`;

  try {
    const res = await fetch(plexUrl, { headers: { Accept: 'text/vtt' } });
    if (!res.ok) {
      return withCors(req, new Response(JSON.stringify({
        error: `plex returned ${res.status} for subtitle ${streamId}`,
      }), { status: 502, headers: { 'content-type': 'application/json' } }));
    }
    const body = await res.text();
    return withCors(req, new Response(body, {
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return withCors(req, new Response(JSON.stringify({ error: msg }), {
      status: 502, headers: { 'content-type': 'application/json' },
    }));
  }
}
