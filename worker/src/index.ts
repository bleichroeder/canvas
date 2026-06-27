import { corsHeaders, withCors } from './cors';
import { handlePairStart, handlePairPoll, handlePairApprove, handlePairDelete } from './routes/pair';

export interface Env {
  KV: KVNamespace;
}

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  }));
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (url.pathname === '/health') {
    return withCors(req, new Response('ok', { headers: { 'content-type': 'text/plain' } }));
  }

  if (url.pathname === '/api/pair/start' && req.method === 'POST') return handlePairStart(req, env.KV);
  if (url.pathname === '/api/pair/poll' && req.method === 'POST') return handlePairPoll(req, env.KV);
  if (url.pathname === '/api/pair/approve' && req.method === 'POST') return handlePairApprove(req, env.KV);

  const delMatch = url.pathname.match(/^\/api\/pair\/([A-Z0-9-]+)$/);
  if (delMatch && req.method === 'DELETE') return handlePairDelete(req, env.KV, delMatch[1]!);

  return json(req, { error: 'not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('worker error:', message);
      return withCors(req, new Response(JSON.stringify({ error: 'internal', message }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
    }
  },
};
