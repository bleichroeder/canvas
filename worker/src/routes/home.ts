import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleHome(req: Request): Promise<Response> {
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    return adapter.home({ baseUrl: src.baseUrl, token: src.token });
  });
  const rows = Object.entries(results).flatMap(([key, rs]) =>
    rs.map((r) => ({ ...r, source: key })),
  );
  return withCors(
    req,
    new Response(JSON.stringify({ rows, errors }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}
