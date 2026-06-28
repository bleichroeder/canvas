import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export function parseFromSecParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export async function handlePlay(req: Request, srcKey: string, id: string): Promise<Response> {
  const url = new URL(req.url);
  const fromSec = parseFromSecParam(url.searchParams.get('fromSec'));
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id, fromSec);
    });
    // Adapter-emitted subtitle URLs are relative and source-agnostic; tag
    // them with the resolved srcKey so the subtitle proxy knows which source
    // to fetch from.
    if (result.subtitleTracks) {
      result.subtitleTracks = result.subtitleTracks.map((t) => ({
        ...t,
        url: t.url.includes('?')
          ? `${t.url}&src=${encodeURIComponent(srcKey)}`
          : `${t.url}?src=${encodeURIComponent(srcKey)}`,
      }));
    }
    return withCors(req, new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
