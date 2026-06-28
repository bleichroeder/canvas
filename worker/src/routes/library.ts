import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 60;

export async function handleLibrary(req: Request, url: URL, srcKey: string, libId?: string): Promise<Response> {
  const path = url.searchParams.get('path') ?? undefined;
  const offsetRaw = url.searchParams.get('offset');
  const limitRaw = url.searchParams.get('limit');
  const offset = offsetRaw !== null && Number.isFinite(Number(offsetRaw))
    ? Math.max(0, Math.floor(Number(offsetRaw)))
    : 0;
  const limit = limitRaw !== null && Number.isFinite(Number(limitRaw))
    ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(limitRaw))))
    : DEFAULT_LIMIT;
  const page = libId ? { offset, limit } : undefined;
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.library({ baseUrl: src.baseUrl, token: src.token }, libId, path, page);
    });
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
