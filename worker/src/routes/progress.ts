import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleProgress(req: Request, srcKey: string, id: string): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return withCors(req, new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }
  const b = body as { posSec?: unknown; completed?: unknown };
  if (typeof b.posSec !== 'number') {
    return withCors(req, new Response(JSON.stringify({ error: 'posSec required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }
  const sources = parseXSources(req);
  try {
    await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.saveProgress({ baseUrl: src.baseUrl, token: src.token }, id, b.posSec as number, b.completed === true);
    });
    return withCors(req, new Response(null, { status: 204 }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
