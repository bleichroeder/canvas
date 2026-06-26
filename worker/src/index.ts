import { withCors, corsHeaders } from './cors';
import { addItem, listItems, deleteItem } from './queue';

export interface Env {
  PASSENGER_TOKEN: string;
  QUEUE: KVNamespace;
}

function authed(req: Request, env: Env): boolean {
  const token = req.headers.get('x-passenger-token');
  return !!token && token === env.PASSENGER_TOKEN;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (url.pathname === '/health') {
      return withCors(req, new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    }

    if (!authed(req, env)) {
      return withCors(req, json({ error: 'unauthorized' }, 401));
    }

    if (url.pathname === '/api/queue') {
      if (req.method === 'GET') {
        const items = await listItems(env.QUEUE);
        return withCors(req, json(items));
      }
      if (req.method === 'POST') {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return withCors(req, json({ error: 'invalid json' }, 400));
        }
        if (
          typeof body !== 'object' ||
          body === null ||
          typeof (body as { url?: unknown }).url !== 'string'
        ) {
          return withCors(req, json({ error: 'missing url' }, 400));
        }
        const { url: mediaUrl, title } = body as { url: string; title?: string };
        const item = await addItem(env.QUEUE, mediaUrl, title?.trim() || 'Untitled');
        return withCors(req, json(item));
      }
    }

    const deleteMatch = url.pathname.match(/^\/api\/queue\/([\w-]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const id = deleteMatch[1]!;
      const existed = await deleteItem(env.QUEUE, id);
      return withCors(req, json({ ok: existed }, existed ? 200 : 404));
    }

    return withCors(req, json({ error: 'not found' }, 404));
  },
};
