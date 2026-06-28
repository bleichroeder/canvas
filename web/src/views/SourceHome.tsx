import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
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
          <>
            <Skeleton variant="text" width={240} height={48} sx={{ mx: 2.5, mb: 3 }} />
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={180} height={28} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 1.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={180} height={270} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 2.5, px: 2.5 }}>
              {[1, 2, 3, 4].map((j) => (
                <Skeleton key={j} variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          </>
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
              cardWidth={180}
            />
            <Rail
              title="Recently Added"
              items={state.data.recentlyAdded.map((i) => ({ ...i, source }))}
              cardWidth={180}
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
            {state.data.continueWatching.length === 0 &&
             state.data.recentlyAdded.length === 0 &&
             state.data.libraries.length === 0 && (
              <EmptyState
                icon={<InboxOutlinedIcon />}
                title="This source returned nothing"
                body="The source is reachable but has no content to show right now."
              />
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
