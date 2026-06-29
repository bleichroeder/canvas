import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import CircularProgress from '@mui/material/CircularProgress';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { api } from '../api';
import { navigate } from '../router';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { PosterCard } from '../components/PosterCard';
import { AlbumDetail } from '../components/AlbumDetail';
import { setLibraryName } from '../storage';
import type { Item, BrowseResult } from '../types';

interface Props {
  source: string;
  libraryId?: string;
}

const PAGE_SIZE = 60;

type State =
  | { kind: 'loading' }
  | {
      kind: 'ok';
      items: Item[];
      totalSize: number;
      breadcrumbs: { name: string; libraryId?: string; path?: string }[];
      albumDetail?: BrowseResult['albumDetail'];
      loadingMore: boolean;
    }
  | { kind: 'error'; message: string };

export function Library({ source, libraryId }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const sentinelRef = useRef<HTMLDivElement>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!libraryId) {
      navigate(`/source/${source}`);
      return;
    }
    setState({ kind: 'loading' });
    inFlightRef.current = false;
    api.library(source, libraryId, undefined, { offset: 0, limit: PAGE_SIZE }).then(
      (data) => {
        const last = data.breadcrumbs[data.breadcrumbs.length - 1];
        if (libraryId && last && last.libraryId === libraryId && last.name) {
          setLibraryName(source, libraryId, last.name);
        }
        setState({
          kind: 'ok',
          items: data.items,
          totalSize: data.totalSize ?? data.items.length,
          breadcrumbs: data.breadcrumbs,
          albumDetail: data.albumDetail,
          loadingMore: false,
        });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  // Infinite-scroll loader: fetch next page when sentinel approaches viewport.
  useEffect(() => {
    if (state.kind !== 'ok') return;
    if (state.items.length >= state.totalSize) return;
    const el = sentinelRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (inFlightRef.current) return;
        if (state.kind !== 'ok') return;
        if (state.items.length >= state.totalSize) return;

        inFlightRef.current = true;
        setState((s) => (s.kind === 'ok' ? { ...s, loadingMore: true } : s));
        api.library(source, libraryId, undefined, { offset: state.items.length, limit: PAGE_SIZE })
          .then((data) => {
            setState((s) => {
              if (s.kind !== 'ok') return s;
              return {
                ...s,
                items: [...s.items, ...data.items],
                totalSize: data.totalSize ?? s.totalSize,
                loadingMore: false,
              };
            });
          })
          .catch(() => {
            setState((s) => (s.kind === 'ok' ? { ...s, loadingMore: false } : s));
          })
          .finally(() => {
            inFlightRef.current = false;
          });
      },
      { rootMargin: '400px' },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [source, libraryId, state]);

  if (!libraryId) return null;

  return (
    <AppShell>
      <Box sx={{ p: 2.5 }}>
        {state.kind === 'loading' && (
          <>
            <Skeleton variant="text" width={300} height={48} sx={{ mb: 3 }} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 220px)',
                gap: 3,
              }}
            >
              {[...Array(12)].map((_, i) => (
                <Skeleton key={i} variant="rectangular" width={220} height={330} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          </>
        )}
        {state.kind === 'error' && <Alert severity="error">Error: {state.message}</Alert>}
        {state.kind === 'ok' && state.albumDetail && (
          <AlbumDetail source={source} album={state.albumDetail} tracks={state.items} />
        )}
        {state.kind === 'ok' && !state.albumDetail && (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h1">
                {state.breadcrumbs[state.breadcrumbs.length - 1]?.name ?? 'Library'}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                  · {state.totalSize} {state.totalSize === 1 ? 'item' : 'items'}
                </Typography>
              </Typography>
            </Box>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 220px)',
                gap: 3,
              }}
            >
              {state.items.map((it) => (
                <PosterCard key={it.id} item={it} source={source} />
              ))}
            </Box>
            {state.totalSize === 0 && (
              <EmptyState
                icon={<InboxOutlinedIcon />}
                title="This library is empty"
                actionLabel="Back to source"
                onAction={() => navigate(`/source/${source}`)}
              />
            )}
            {/* Sentinel + loading indicator for infinite scroll. */}
            {state.items.length < state.totalSize && (
              <Box ref={sentinelRef} sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                {state.loadingMore && <CircularProgress size={28} />}
              </Box>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
