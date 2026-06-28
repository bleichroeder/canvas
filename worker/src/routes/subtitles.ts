import { withCors } from '../cors';
import { parseXSources } from '../x-sources';
import { parseFlixifyAuth } from '../sources/flixify';

/**
 * Proxy fetch a subtitle file as WebVTT. Two source-type modes:
 *
 *   - Plex:     ?src=<srcKey>&partId=<N>&streamId=<N>
 *               worker fetches `${baseUrl}/library/parts/{partId}/{streamId}/subtitles.vtt?X-Plex-Token=...`
 *
 *   - Flixify:  ?src=<srcKey>&path=<encoded-subtitle-path>
 *               worker fetches `https://${asset_host}${path}` with the source's session cookies
 *
 * The canvas player has no `<video>` to attach a `<track>` to and most
 * upstream subtitle endpoints don't emit CORS headers, so all subtitle bytes
 * flow through the worker.
 */
export async function handleSubtitles(req: Request, url: URL): Promise<Response> {
  const srcKey = url.searchParams.get('src');
  if (!srcKey) {
    return withCors(req, new Response(JSON.stringify({ error: 'missing src' }), {
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

  let upstreamUrl: string;
  const headers: Record<string, string> = { Accept: 'text/vtt' };

  if (src.type === 'plex') {
    const partId = url.searchParams.get('partId');
    const streamId = url.searchParams.get('streamId');
    if (!partId || !streamId) {
      return withCors(req, new Response(JSON.stringify({ error: 'missing partId/streamId for plex source' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }));
    }
    upstreamUrl = `${src.baseUrl}/library/parts/${encodeURIComponent(partId)}/${encodeURIComponent(streamId)}/subtitles.vtt?X-Plex-Token=${encodeURIComponent(src.token)}`;
  } else if (src.type === 'flixify') {
    const path = url.searchParams.get('path');
    if (!path) {
      return withCors(req, new Response(JSON.stringify({ error: 'missing path for flixify source' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }));
    }
    const auth = parseFlixifyAuth(src.token);
    if (!auth.asset_host) {
      return withCors(req, new Response(JSON.stringify({ error: 'flixify source has no asset_host' }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
    }
    upstreamUrl = `https://${auth.asset_host}${path}`;
    const cookieParts: string[] = [];
    if (auth.pip) cookieParts.push(`pip=${auth.pip}`);
    if (auth.session) cookieParts.push(`session=${auth.session}`);
    if (auth.profile_id) cookieParts.push(`profile_id=${auth.profile_id}`);
    if (cookieParts.length) headers.Cookie = cookieParts.join('; ');
  } else {
    return withCors(req, new Response(JSON.stringify({ error: `subtitles not supported for source type ${src.type}` }), {
      status: 501, headers: { 'content-type': 'application/json' },
    }));
  }

  try {
    const res = await fetch(upstreamUrl, { headers });
    if (!res.ok) {
      return withCors(req, new Response(JSON.stringify({
        error: `upstream returned ${res.status}`,
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
