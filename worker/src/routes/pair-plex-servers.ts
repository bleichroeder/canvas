import { withCors } from '../cors';

interface PlexConnection {
  protocol: string;
  uri: string;
  local: boolean;
  relay: boolean;
}

interface PlexResource {
  name: string;
  clientIdentifier: string;
  provides: string;
  accessToken: string;
  connections: PlexConnection[];
}

function isPrivatePlexUri(uri: string): boolean {
  // plex.direct hostnames encode IPv4: "10-0-15-100.<hash>.plex.direct"
  const m = uri.match(/\/\/(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\./);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function isHttps(c: PlexConnection): boolean {
  return c.protocol === 'https';
}

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(
    req,
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/**
 * POST /api/pair/plex-servers
 * Body: { authToken, clientId }
 *
 * Calls plex.tv/api/v2/resources from the Worker (Cloudflare edge) so the
 * returned connections aren't filtered by the user's home-network perspective.
 * Picks the most publicly-routable https connection per server and returns
 * a flat list the phone picker consumes.
 */
export async function handlePairPlexServers(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const b = body as { authToken?: unknown; clientId?: unknown };
  if (typeof b.authToken !== 'string' || typeof b.clientId !== 'string') {
    return json(req, { error: 'authToken and clientId required' }, 400);
  }

  const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': b.authToken,
      'X-Plex-Client-Identifier': b.clientId,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json(req, { error: `plex.tv ${res.status}`, detail: detail.slice(0, 200) }, 502);
  }

  const resources = (await res.json()) as PlexResource[];

  const servers = resources
    .filter((r) => r.provides.split(',').includes('server'))
    .map((r) => {
      const conn =
        r.connections.find((c) => isHttps(c) && !isPrivatePlexUri(c.uri)) ??
        r.connections.find((c) => isHttps(c)) ??
        r.connections[0];
      const baseUrl = conn?.uri ?? '';
      return {
        name: r.name,
        clientIdentifier: r.clientIdentifier,
        baseUrl,
        accessToken: r.accessToken,
        publiclyReachable: !!conn && !isPrivatePlexUri(conn.uri),
      };
    })
    .filter((s) => s.baseUrl !== '');

  return json(req, { servers });
}
