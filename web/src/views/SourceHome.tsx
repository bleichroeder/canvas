import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { LibraryCard } from '../components/LibraryCard';
import { getSourceLabel } from '../storage';
import type { SourceHomeResponse } from '../types';

interface Props { source: string }

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SourceHomeResponse }
  | { kind: 'error'; message: string };

export function SourceHome({ source }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const label = getSourceLabel(source) ?? source;

  useEffect(() => {
    setState({ kind: 'loading' });
    api.sourceHome(source).then(
      (data) => setState({ kind: 'ok', data }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source]);

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        {state.kind === 'loading' && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>Loading…</Typography>
        )}
        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5 }}>Error: {state.message}</Alert>
        )}
        {state.kind === 'ok' && (
          <>
            <Typography variant="h1" sx={{ px: 2.5, mb: 3 }}>{label}</Typography>
            <Rail
              title="Continue Watching"
              items={state.data.continueWatching.map((i) => ({ ...i, source }))}
              cardWidth={state.data.continueWatching[0]?.type === 'episode' ? 260 : 180}
            />
            <Rail
              title="Recently Added"
              items={state.data.recentlyAdded.map((i) => ({ ...i, source }))}
              cardWidth={state.data.recentlyAdded[0]?.type === 'episode' ? 260 : 180}
            />
            {state.data.libraries.length > 0 && (
              <Box component="section" sx={{ mb: 4 }}>
                <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>Libraries</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 200px)',
                    gap: 2.5,
                    px: 2.5,
                  }}
                >
                  {state.data.libraries.map((lib) => (
                    <LibraryCard key={lib.id} library={lib} source={source} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
