import { corsHeaders, withCors } from './cors';
import { handlePairStart, handlePairPoll, handlePairApprove, handlePairDelete } from './routes/pair';
import { handlePairPlexServers } from './routes/pair-plex-servers';
import { handleHome } from './routes/home';
import { handleSearch } from './routes/search';
import { handleSourceStatus } from './routes/source-status';
import { handleLibrary } from './routes/library';
import { handleItem } from './routes/item';
import { handlePlay } from './routes/play';
import { handleProgress } from './routes/progress';
import { registerAdapter } from './sources/registry';
import { plexAdapter } from './sources/plex';

registerAdapter(plexAdapter);

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

  // Pair
  if (url.pathname === '/api/pair/start' && req.method === 'POST') return handlePairStart(req, env.KV);
  if (url.pathname === '/api/pair/poll' && req.method === 'POST') return handlePairPoll(req, env.KV);
  if (url.pathname === '/api/pair/approve' && req.method === 'POST') return handlePairApprove(req, env.KV);
  if (url.pathname === '/api/pair/plex-servers' && req.method === 'POST') return handlePairPlexServers(req);
  const delMatch = url.pathname.match(/^\/api\/pair\/([A-Z0-9-]+)$/);
  if (delMatch && req.method === 'DELETE') return handlePairDelete(req, env.KV, delMatch[1]!);

  // Federated
  if (url.pathname === '/api/home' && req.method === 'GET') return handleHome(req);
  if (url.pathname === '/api/search' && req.method === 'GET') return handleSearch(req, url);
  if (url.pathname === '/api/source-status' && req.method === 'GET') return handleSourceStatus(req, env, url);

  // Per-source
  const libMatch = url.pathname.match(/^\/api\/library\/([^/]+)(?:\/([^/]+))?$/);
  if (libMatch && req.method === 'GET') return handleLibrary(req, url, libMatch[1]!, libMatch[2]);

  const itemMatch = url.pathname.match(/^\/api\/item\/([^/]+)\/(.+)$/);
  if (itemMatch && req.method === 'GET') return handleItem(req, itemMatch[1]!, itemMatch[2]!);

  const playMatch = url.pathname.match(/^\/api\/play\/([^/]+)\/(.+)$/);
  if (playMatch && req.method === 'POST') return handlePlay(req, playMatch[1]!, playMatch[2]!);

  const progMatch = url.pathname.match(/^\/api\/progress\/([^/]+)\/(.+)$/);
  if (progMatch && req.method === 'POST') return handleProgress(req, progMatch[1]!, progMatch[2]!);

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
