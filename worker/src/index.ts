export interface Env {
  PASSENGER_TOKEN: string;
  QUEUE: KVNamespace;
}

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('not found', { status: 404 });
  },
};
