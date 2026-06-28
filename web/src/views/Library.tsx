import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import { navigate } from '../router';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { PosterCard } from '../components/PosterCard';
import { setLibraryName } from '../storage';
import type { BrowseResult } from '../types';

interface Props {
  source: string;
  libraryId?: string;
}

export function Library({ source, libraryId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; data: BrowseResult }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!libraryId) {
      navigate(`/source/${source}`);
      return;
    }
    setState({ kind: 'loading' });
    api.library(source, libraryId).then(
      (data) => {
        // Cache library name for breadcrumbs on subsequent visits.
        const last = data.breadcrumbs[data.breadcrumbs.length - 1];
        if (libraryId && last && last.libraryId === libraryId && last.name) {
          setLibraryName(source, libraryId, last.name);
        }
        setState({ kind: 'ok', data });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  if (!libraryId) return null;

  return (
    <AppShell>
      <Box sx={{ p: 2.5 }}>
        {state.kind === 'loading' && <Typography color="text.secondary">Loading…</Typography>}
        {state.kind === 'error' && <Alert severity="error">Error: {state.message}</Alert>}
        {state.kind === 'ok' && (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h1">
                {state.data.breadcrumbs[state.data.breadcrumbs.length - 1]?.name ?? 'Library'}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                  · {state.data.items.length} {state.data.items.length === 1 ? 'item' : 'items'}
                </Typography>
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 180px)',
                gap: 2.5,
              }}
            >
              {state.data.items.map((it) => (
                <PosterCard key={it.id} item={it} source={source} />
              ))}
            </Box>
            {state.data.items.length === 0 && (
              <EmptyState
                icon={<InboxOutlinedIcon />}
                title="This library is empty"
                actionLabel="Back to source"
                onAction={() => navigate(`/source/${source}`)}
              />
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
