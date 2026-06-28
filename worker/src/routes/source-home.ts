import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleSourceHome(req: Request, _url: URL, srcKey: string): Promise<Response> {
  const sources = parseXSources(req);
  try {
    const data = await callOneSource(sources, srcKey, async (src) => {
      const adapter = getAdapter(src.type);
      const ctx = { baseUrl: src.baseUrl, token: src.token };
      const [rows, libsResult] = await Promise.all([
        adapter.home(ctx),
        adapter.library(ctx).catch(() => ({ breadcrumbs: [], items: [] })),
      ]);
      const continueWatching = rows.find((r) => r.kind === 'continue')?.items ?? [];
      const recentlyAdded = rows.find((r) => r.kind === 'recent')?.items ?? [];
      const libraries = libsResult.items.filter((i) => i.type === 'folder');
      return { continueWatching, recentlyAdded, libraries };
    });
    return withCors(req, new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    const msg = String(message);
    const httpStatus = msg.startsWith('source not paired:') ? 404 : status;
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status: httpStatus, headers: { 'content-type': 'application/json' },
    }));
  }
}
