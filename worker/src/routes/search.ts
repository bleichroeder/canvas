import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleSearch(req: Request, url: URL): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  if (!q) {
    return withCors(req, new Response(JSON.stringify({ hits: [], errors: [] }), {
      headers: { 'content-type': 'application/json' },
    }));
  }
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    return adapter.search({ baseUrl: src.baseUrl, token: src.token }, q);
  });
  const hits = Object.entries(results).flatMap(([key, items]) =>
    items.map((i) => ({ ...i, source: key })),
  );
  return withCors(req, new Response(JSON.stringify({ hits, errors }), {
    headers: { 'content-type': 'application/json' },
  }));
}
