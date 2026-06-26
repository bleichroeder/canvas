const ALLOWED_ORIGINS = new Set<string>([
  'https://thecalm.site',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const PAGES_SUFFIXES = ['.pages.dev'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return PAGES_SUFFIXES.some((s) => url.hostname.endsWith(s));
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin!,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-passenger-token',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

export function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
