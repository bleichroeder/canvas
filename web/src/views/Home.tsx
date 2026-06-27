import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../api';
import { getSources } from '../storage';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { Link, navigate } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[] }
  | { kind: 'error'; message: string };

export function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const sources = getSources();
    if (Object.keys(sources).length === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors }) => setState({ kind: 'ok', rows, errors }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, []);

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        {state.kind === 'loading' && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>Loading…</Typography>
        )}
        {state.kind === 'empty' && (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ mb: 2 }}>No sources paired yet.</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/settings/pair')}
            >
              Pair your first source
            </Button>
          </Box>
        )}
        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5 }}>Error: {state.message}</Alert>
        )}
        {state.kind === 'ok' && state.errors.length > 0 && (
          <Box sx={{ px: 2.5, pb: 2 }}>
            {state.errors.map((err) => (
              <Alert key={err.source} severity="warning" sx={{ my: 0.5 }}>
                {err.source}: {err.message}
              </Alert>
            ))}
          </Box>
        )}
        {state.kind === 'ok' && state.rows.map((row) => (
          <Rail
            key={`${row.source}:${row.kind}:${row.title}`}
            title={row.source ? `${row.title} · ${row.source}` : row.title}
            items={row.items.map((i: Item) => ({ ...i, source: row.source }))}
            cardWidth={row.items[0]?.type === 'episode' ? 260 : 180}
          />
        ))}
        {state.kind === 'ok' && state.rows.length === 0 && state.errors.length === 0 && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>
            Your sources are paired but returned nothing yet.
          </Typography>
        )}
      </Box>
    </AppShell>
  );
}
