import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import QRCode from 'qrcode';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { useSources } from '../lib/SourcesContext';
import { navigate } from '../router';
import type { StoredSource } from '../storage';

type SourceType = StoredSource['type'];

type State =
  | { kind: 'choose' }
  | { kind: 'pairing'; type: SourceType; code: string; expiresAt: number }
  | { kind: 'paired'; label: string }
  | { kind: 'error'; message: string };

const SOURCE_TYPES: Array<{ type: SourceType; label: string; available: boolean; note?: string }> = [
  { type: 'plex', label: 'Plex Media Server', available: true },
  { type: 'jellyfin', label: 'Jellyfin', available: false },
  { type: 'flixify', label: 'Flixify (thecalm.site)', available: true },
  { type: 'youtube', label: 'YouTube', available: true, note: 'public • no sign-in' },
  { type: 'generic', label: 'Direct URL', available: false },
];

export function Pair() {
  const [state, setState] = useState<State>({ kind: 'choose' });
  const [qrSvg, setQrSvg] = useState<string>('');
  const [qrUrl, setQrUrl] = useState<string>('');
  const { refresh: refreshSources } = useSources();

  useEffect(() => {
    if (state.kind !== 'pairing') return;
    const url = `${window.location.protocol}//${window.location.host}/#/pair?code=${encodeURIComponent(state.code)}&type=${state.type}`;
    setQrUrl(url);
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 })
      .then(setQrSvg)
      .catch(() => setQrSvg(''));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind, state.kind === 'pairing' ? state.code : null, state.kind === 'pairing' ? state.type : null]);

  async function startPair(type: SourceType) {
    try {
      const { code, expiresAt } = await api.pairStart(type);
      setState({ kind: 'pairing', type, code, expiresAt });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }

  // Public sources (YouTube) have no credential and no QR flow — create directly.
  async function addPublic(type: 'youtube') {
    try {
      const src = await api.addPublicSource(type);
      await refreshSources();
      setState({ kind: 'paired', label: src.label });
      setTimeout(() => navigate('/settings?tab=sources'), 1200);
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }

  useEffect(() => {
    if (state.kind !== 'pairing') return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.pairPoll(state.code);
        if (cancelled) return;
        if (res.status === 'approved' && res.source) {
          await api.pairDelete(state.code).catch(() => {});
          // Refresh sources from the server so the new source appears immediately.
          await refreshSources();
          setState({ kind: 'paired', label: res.source.label });
          setTimeout(() => navigate('/settings'), 1200);
          return;
        }
        if (res.status === 'expired') {
          setState({ kind: 'error', message: 'Pair code expired. Try again.' });
          return;
        }
        setTimeout(poll, 3000);
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    };
    void poll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === 'pairing' ? state.code : null]);

  // The pairing (QR) state renders full-screen without AppShell chrome so the
  // QR is the star and there is no branded top bar competing for attention.
  if (state.kind === 'pairing') {
    // QR URL inherits window.location.protocol — if the car is on http://
    // (LAN IP, no tunnel), the phone will land on http:// too, where the
    // Web Crypto APIs pairing needs are unavailable. Warn the car user so
    // they can switch to their tunnel URL before scanning.
    const insecureContext = typeof window !== 'undefined'
      && window.isSecureContext === false;
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 3, textAlign: 'center' }}>
        {insecureContext && (
          <Alert severity="warning" sx={{ mb: 3, maxWidth: 560, textAlign: 'left' }}>
            <strong>Non-secure context.</strong> Canvas is being accessed over <code>http://</code>{' '}
            (typically a LAN IP). Phone pairing needs <code>https://</code> to work — reload
            this page from your public tunnel URL before scanning the QR.
          </Alert>
        )}
        <Typography variant="h2" sx={{ mb: 3 }}>Scan with your phone to pair</Typography>
        {qrSvg ? (
          <Box
            sx={{
              display: 'inline-block', p: 2.5,
              backgroundColor: '#ffffff',
              borderRadius: 2,
              mb: 3,
            }}
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : (
          <Box sx={{ width: 280, height: 280, mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Or enter <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{state.code}</Box> at:
        </Typography>
        <Typography
          component="a"
          href={qrUrl}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          sx={{ display: 'block', mb: 2, fontFamily: 'monospace', color: 'primary.main', textDecoration: 'underline', wordBreak: 'break-all', maxWidth: 480 }}
        >
          {qrUrl}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 2 }}>
          <CircularProgress size={20} />
          <Typography color="text.secondary">Waiting for approval…</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Expires {new Date(state.expiresAt).toLocaleTimeString()}.
        </Typography>
        <Button variant="text" size="small" onClick={() => setState({ kind: 'choose' })} sx={{ mt: 3 }}>Cancel</Button>
      </Box>
    );
  }

  return (
    <AppShell>
      <Box sx={{ p: 4, maxWidth: 720, mx: 'auto' }}>
        {state.kind === 'choose' && (
          <>
            <Typography variant="h1" sx={{ mb: 1 }}>Pair a new source</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Choose what kind of source you want to add.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 3 }}>
              You can unpair any source later in Settings → Sources.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {SOURCE_TYPES.map((s) => (
                <Card key={s.type} sx={{ opacity: s.available ? 1 : 0.5 }}>
                  <CardActionArea
                    disabled={!s.available}
                    onClick={() => (s.type === 'youtube' ? addPublic('youtube') : startPair(s.type))}
                    sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>{s.label}</Typography>
                    {!s.available && (
                      <Typography variant="caption" color="text.secondary">(coming soon)</Typography>
                    )}
                    {s.available && s.note && (
                      <Typography variant="caption" color="text.secondary">{s.note}</Typography>
                    )}
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </>
        )}
        {state.kind === 'paired' && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Paired</Typography>
            <Typography>{state.label} is now linked. Redirecting…</Typography>
          </Box>
        )}
        {state.kind === 'error' && (
          <Box sx={{ textAlign: 'center' }}>
            <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>{state.message}</Alert>
            <Button variant="text" onClick={() => setState({ kind: 'choose' })}>Try again</Button>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
