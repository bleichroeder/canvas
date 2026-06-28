import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleHome(req: Request): Promise<Response> {
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    const ctx = { baseUrl: src.baseUrl, token: src.token };
    const [home, libs] = await Promise.all([
      adapter.home(ctx),
      adapter.library(ctx).then((r) => r.items.filter((i) => i.type === 'folder').length).catch(() => 0),
    ]);
    return { home, libCount: libs };
  });
  const rows = Object.entries(results).flatMap(([key, rs]) =>
    rs.home.map((r) => ({ ...r, source: key })),
  );
  const libraryCounts: Record<string, number> = {};
  for (const [key, rs] of Object.entries(results)) libraryCounts[key] = rs.libCount;
  return withCors(
    req,
    new Response(JSON.stringify({ rows, errors, libraryCounts }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}
