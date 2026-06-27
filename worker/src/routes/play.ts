import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handlePlay(req: Request, srcKey: string, id: string): Promise<Response> {
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id);
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
