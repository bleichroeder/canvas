import { useState } from 'preact/hooks';
import { useRoute } from '../router';
import { api } from '../api';

const PLEX_PRODUCT = 'Passenger';
const CLIENT_ID_KEY = 'passenger.plex.clientId';

function plexClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

interface PlexPin { id: number; code: string; authToken: string | null }

async function plexCreatePin(): Promise<PlexPin> {
  const res = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': plexClientId(),
    },
  });
  if (!res.ok) throw new Error(`plex.tv POST /pins failed: ${res.status}`);
  return res.json();
}

async function plexPollPin(id: number): Promise<PlexPin> {
  const res = await fetch(`https://plex.tv/api/v2/pins/${id}?X-Plex-Client-Identifier=${plexClientId()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`plex.tv GET /pins/${id} failed: ${res.status}`);
  return res.json();
}

interface PlexResource {
  name: string;
  clientIdentifier: string;
  product: string;
  provides: string;
  connections: { uri: string; local: boolean; relay: boolean; https: boolean }[];
}

async function plexListServers(authToken: string): Promise<PlexResource[]> {
  const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': authToken,
      'X-Plex-Client-Identifier': plexClientId(),
    },
  });
  if (!res.ok) throw new Error(`plex.tv GET /resources failed: ${res.status}`);
  const all = await res.json() as PlexResource[];
  return all.filter((r) => r.provides.split(',').includes('server'));
}

export function PhonePair() {
  const route = useRoute();
  const codeFromUrl = route.query.code ?? '';
  const typeFromUrl = route.query.type ?? '';
  const [code, setCode] = useState(codeFromUrl);
  const [stage, setStage] = useState<
    | { kind: 'enter-code' }
    | { kind: 'plex-pin'; pin: PlexPin }
    | { kind: 'plex-servers'; authToken: string; servers: PlexResource[] }
    | { kind: 'done' }
    | { kind: 'error'; message: string }
  >({ kind: 'enter-code' });

  async function startPlex() {
    try {
      const pin = await plexCreatePin();
      setStage({ kind: 'plex-pin', pin });
      const authUrl = `https://app.plex.tv/auth#?clientID=${plexClientId()}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`;
      window.open(authUrl, '_blank');
      // Poll the pin until it has an authToken.
      const start = Date.now();
      while (Date.now() - start < 10 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await plexPollPin(pin.id);
        if (polled.authToken) {
          const servers = await plexListServers(polled.authToken);
          setStage({ kind: 'plex-servers', authToken: polled.authToken, servers });
          return;
        }
      }
      setStage({ kind: 'error', message: 'Plex sign-in timed out' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  async function approveWithServer(authToken: string, server: PlexResource) {
    try {
      // Prefer https + local connection; fall back to relay.
      const conn = server.connections.find((c) => c.local && c.https)
        ?? server.connections.find((c) => c.https)
        ?? server.connections[0];
      if (!conn) throw new Error('No connection for this Plex server');
      await api.pairApprove({
        code,
        type: 'plex',
        baseUrl: conn.uri,
        token: authToken,
        label: server.name,
      });
      setStage({ kind: 'done' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 500, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>passenger · phone pair</h1>
      {stage.kind === 'enter-code' && (
        <div>
          <p>Enter the code shown on your Tesla:</p>
          <input
            value={code}
            onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.toUpperCase())}
            placeholder="XXX-XXX"
            style={{ fontSize: 24, textAlign: 'center', letterSpacing: 4, marginBottom: 16 }}
          />
          {(typeFromUrl === 'plex' || code) && (
            <button
              disabled={code.length < 7}
              onClick={() => { if (typeFromUrl === 'plex' || code) startPlex(); }}
              style={{ width: '100%', padding: 14, fontSize: 16 }}
            >
              Sign in to Plex →
            </button>
          )}
        </div>
      )}
      {stage.kind === 'plex-pin' && (
        <p>Waiting for Plex sign-in to complete in the popup window…</p>
      )}
      {stage.kind === 'plex-servers' && (
        <div>
          <p>Pick your Plex server:</p>
          {stage.servers.length === 0 && <p style={{ color: '#c33' }}>No servers found for this account.</p>}
          {stage.servers.map((s) => (
            <button
              key={s.clientIdentifier}
              onClick={() => approveWithServer(stage.authToken, s)}
              style={{ display: 'block', width: '100%', padding: 14, marginBottom: 8, textAlign: 'left' }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
      {stage.kind === 'done' && (
        <div>
          <h2 style={{ color: '#0a7d2c' }}>✓ Linked</h2>
          <p>Return to your Tesla — it should pick up the source within a few seconds.</p>
        </div>
      )}
      {stage.kind === 'error' && (
        <div>
          <h2 style={{ color: '#c33' }}>Pair failed</h2>
          <p>{stage.message}</p>
          <button onClick={() => setStage({ kind: 'enter-code' })} style={{ marginTop: 12 }}>Try again</button>
        </div>
      )}
    </div>
  );
}
