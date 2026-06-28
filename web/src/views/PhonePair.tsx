import { useState, useRef, useEffect } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { useRoute } from '../router';
import { api } from '../api';
import { stripPin, formatPin } from '../lib/pin-format';

const PLEX_PRODUCT = 'Canvas';
const CLIENT_ID_KEY = 'canvas.plex.clientId';

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

interface ResolvedServer {
  name: string;
  clientIdentifier: string;
  baseUrl: string;
  accessToken: string;
  publiclyReachable: boolean;
}

export function PhonePair() {
  const route = useRoute();
  const codeFromUrl = route.query.code ?? '';
  const typeFromUrl = route.query.type ?? '';
  const [code, setCode] = useState(formatPin(stripPin(codeFromUrl)));
  const [stage, setStage] = useState<
    | { kind: 'enter-code' }
    | { kind: 'plex-pin'; pin: PlexPin }
    | { kind: 'plex-servers'; servers: ResolvedServer[] }
    | { kind: 'done' }
    | { kind: 'error'; message: string }
  >({ kind: 'enter-code' });

  const signInBtnRef = useRef<HTMLButtonElement>(null);
  const prefilled = stripPin(codeFromUrl).length === 6 && typeFromUrl === 'plex';

  useEffect(() => {
    // When arriving from a QR scan with a valid pre-filled code, draw attention
    // to the sign-in button. We don't auto-click it — mobile browsers block
    // window.open() that isn't triggered by a direct user gesture, which silently
    // breaks the popup-based Plex OAuth flow. The user's tap is the gesture.
    if (prefilled && stage.kind === 'enter-code') {
      signInBtnRef.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl, typeFromUrl]);

  async function startPlex() {
    try {
      const pin = await plexCreatePin();
      setStage({ kind: 'plex-pin', pin });
      const authUrl = `https://app.plex.tv/auth#?clientID=${plexClientId()}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`;
      window.open(authUrl, '_blank');
      const start = Date.now();
      while (Date.now() - start < 10 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await plexPollPin(pin.id);
        if (polled.authToken) {
          const { servers } = await api.pairPlexServers(polled.authToken, plexClientId());
          setStage({ kind: 'plex-servers', servers });
          return;
        }
      }
      setStage({ kind: 'error', message: 'Plex sign-in timed out' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  async function approveWithServer(server: ResolvedServer) {
    try {
      if (!server.baseUrl) throw new Error('No connection URL for this server');
      await api.pairApprove({
        code,
        type: 'plex',
        baseUrl: server.baseUrl,
        token: server.accessToken,
        label: server.name,
      });
      setStage({ kind: 'done' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 500, mx: 'auto', fontFamily: 'system-ui' }}>
      <Typography variant="h2" sx={{ mb: 2 }}>canvas · phone pair</Typography>
      {stage.kind === 'enter-code' && (
        <Box>
          <Typography sx={{ mb: 1 }}>Enter the code shown on your Tesla:</Typography>
          <TextField
            fullWidth
            value={code}
            onChange={(e) => setCode(formatPin(stripPin(e.target.value)))}
            placeholder="XXX-XXX"
            inputProps={{ style: { fontSize: 24, textAlign: 'center', letterSpacing: 4 } }}
            sx={{ mb: 2 }}
          />
          {prefilled && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, textAlign: 'center' }}>
              Tap below to continue to Plex sign-in.
            </Typography>
          )}
          {(typeFromUrl === 'plex' || code) && (
            <Button
              ref={signInBtnRef}
              fullWidth
              variant="contained"
              size="large"
              disabled={stripPin(code).length < 6}
              onClick={() => { if (typeFromUrl === 'plex' || code) startPlex(); }}
              sx={prefilled ? {
                animation: 'canvas-pulse 1.4s ease-in-out infinite',
                '@keyframes canvas-pulse': {
                  '0%, 100%': { boxShadow: '0 0 0 0 rgba(79, 142, 247, 0.5)' },
                  '50%':      { boxShadow: '0 0 0 10px rgba(79, 142, 247, 0)' },
                },
              } : undefined}
            >
              Sign in to Plex →
            </Button>
          )}
        </Box>
      )}
      {stage.kind === 'plex-pin' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography>Waiting for Plex sign-in in the popup window…</Typography>
        </Box>
      )}
      {stage.kind === 'plex-servers' && (
        <Box>
          <Typography sx={{ mb: 1.5 }}>Pick your Plex server:</Typography>
          {stage.servers.length === 0 && (
            <Alert severity="warning">No servers found for this account.</Alert>
          )}
          {stage.servers.map((s) => (
            <Button
              key={s.clientIdentifier}
              fullWidth
              variant="outlined"
              onClick={() => approveWithServer(s)}
              sx={{
                py: 1.75, mb: 1, justifyContent: 'flex-start',
                opacity: s.publiclyReachable ? 1 : 0.6,
              }}
            >
              {s.name}
              {!s.publiclyReachable && (
                <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                  (no public access)
                </Typography>
              )}
            </Button>
          ))}
        </Box>
      )}
      {stage.kind === 'done' && (
        <Box>
          <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Linked</Typography>
          <Typography>Return to your Tesla — it should pick up the source within a few seconds.</Typography>
        </Box>
      )}
      {stage.kind === 'error' && (
        <Box>
          <Alert severity="error" sx={{ mb: 1.5 }}>{stage.message}</Alert>
          <Button variant="text" onClick={() => setStage({ kind: 'enter-code' })}>Try again</Button>
        </Box>
      )}
    </Box>
  );
}
