import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { addSource, makeSourceKey } from '../storage';
import { navigate } from '../router';
import type { StoredSource } from '../storage';

type SourceType = StoredSource['type'];

type State =
  | { kind: 'choose' }
  | { kind: 'pairing'; type: SourceType; code: string; expiresAt: number }
  | { kind: 'paired'; label: string }
  | { kind: 'error'; message: string };

const SOURCE_TYPES: Array<{ type: SourceType; label: string; available: boolean }> = [
  { type: 'plex', label: 'Plex Media Server', available: true },
  { type: 'jellyfin', label: 'Jellyfin', available: false },
  { type: 'flixify', label: 'thecalm.site (Flixify)', available: false },
  { type: 'generic', label: 'Direct URL', available: false },
];

export function Pair() {
  const [state, setState] = useState<State>({ kind: 'choose' });

  async function startPair(type: SourceType) {
    try {
      const { code, expiresAt } = await api.pairStart(type);
      setState({ kind: 'pairing', type, code, expiresAt });
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
          const key = makeSourceKey(res.source.label || res.source.baseUrl);
          addSource(key, res.source);
          await api.pairDelete(state.code).catch(() => {});
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

  return (
    <AppShell>
      <Box sx={{ p: 5, maxWidth: 600, mx: 'auto', textAlign: 'center' }}>
        {state.kind === 'choose' && (
          <>
            <Typography variant="h3" sx={{ mb: 1 }}>Pair a new source</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Choose what kind of source you want to add.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {SOURCE_TYPES.map((s) => (
                <Button
                  key={s.type}
                  variant="outlined"
                  disabled={!s.available}
                  onClick={() => startPair(s.type)}
                  sx={{ py: 2, justifyContent: 'flex-start', px: 2.5 }}
                >
                  {s.label}{!s.available && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      (coming soon)
                    </Typography>
                  )}
                </Button>
              ))}
            </Box>
          </>
        )}
        {state.kind === 'pairing' && (
          <>
            <Typography variant="h3" sx={{ mb: 2 }}>On your phone, go to:</Typography>
            <Typography sx={{ fontSize: 20, mb: 2 }}>{window.location.host}/#/pair</Typography>
            <Typography>Enter this code:</Typography>
            <Typography
              variant="h1"
              sx={{
                fontSize: 80, fontWeight: 700, letterSpacing: '16px',
                backgroundColor: 'background.paper',
                border: '1px solid', borderColor: 'divider',
                py: 3, px: 4, borderRadius: 2,
                display: 'inline-block', my: 2,
              }}
            >
              {state.code}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Waiting for approval…</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Code expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </Typography>
          </>
        )}
        {state.kind === 'paired' && (
          <>
            <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Paired</Typography>
            <Typography>{state.label} is now linked. Redirecting…</Typography>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>{state.message}</Alert>
            <Button variant="text" onClick={() => setState({ kind: 'choose' })}>Try again</Button>
          </>
        )}
      </Box>
    </AppShell>
  );
}
