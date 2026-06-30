import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Fab from '@mui/material/Fab';
import Badge from '@mui/material/Badge';
import Tooltip from '@mui/material/Tooltip';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTheme } from '@mui/material/styles';
import { api } from '../api';
import { useSources } from '../lib/SourcesContext';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Hero } from '../components/Hero';
import { Rail } from '../components/Rail';
import { SectionHeading } from '../components/SectionHeading';
import { SourcePickerCard } from '../components/SourcePickerCard';
import { LibraryCard } from '../components/LibraryCard';
import { useNowPlaying } from '../components/NowPlayingStrip';
import { navigate } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[]; libraryCounts: Record<string, number> }
  | { kind: 'error'; message: string };

function formatRuntime(sec?: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPos(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Home() {
  const theme = useTheme();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [singleSourceLibraries, setSingleSourceLibraries] = useState<Item[]>([]);
  const [heroH, setHeroH] = useState<number | undefined>(undefined);
  // Sources from the app-level context — fetched once at mount, refetched on focus.
  const { sources, loading: sourcesLoading } = useSources();

  const sourceCount = Object.keys(sources).length;
  const singleSourceKey = sourceCount === 1 ? Object.keys(sources)[0] : undefined;

  useEffect(() => {
    // While the sources context is still loading we can't tell whether there
    // are 0 sources (genuine empty state) or just haven't fetched yet.
    if (sourcesLoading) return;
    if (sourceCount === 0) {
      setState({ kind: 'empty' });
      return;
    }
    let cancelled = false;
    setState({ kind: 'loading' });
    api.home().then(
      ({ rows, errors, libraryCounts }) => { if (!cancelled) setState({ kind: 'ok', rows, errors, libraryCounts }); },
      (e: Error) => { if (!cancelled) setState({ kind: 'error', message: e.message }); },
    );
    return () => { cancelled = true; };
  }, [sourceCount, sourcesLoading]);

  useEffect(() => {
    if (!singleSourceKey) { setSingleSourceLibraries([]); return; }
    let cancelled = false;
    api.sourceHome(singleSourceKey).then(
      (data) => { if (!cancelled) setSingleSourceLibraries(data.libraries); },
      () => { /* libraries are nice-to-have; ignore failures */ },
    );
    return () => { cancelled = true; };
  }, [singleSourceKey]);

  const nowPlaying = useNowPlaying();

  // Hero source ladder: first Continue Watching with a backdrop, else first
  // Recently Added with a backdrop, else brand hero.
  const heroPick = (() => {
    if (state.kind !== 'ok') return undefined;
    for (const row of state.rows) {
      if (row.kind !== 'continue') continue;
      const it = row.items.find((i) => i.poster);
      if (it) return { item: { ...it, source: row.source }, eyebrow: 'Continue Watching' };
    }
    for (const row of state.rows) {
      if (row.kind !== 'recent') continue;
      const it = row.items.find((i) => i.poster);
      if (it) return { item: { ...it, source: row.source }, eyebrow: 'Recently Added' };
    }
    return undefined;
  })();

  return (
    <AppShell heroHeight={heroH}>
      <Box
        sx={{
          minHeight: '100vh',
          backgroundImage: theme.canvasAmbient,
          // Pull content up so the hero extends beneath the (transparent) top bar.
          mt: '-56px',
          pt: '56px',
        }}
      >
        {state.kind === 'loading' && (
          <Box sx={{ pt: 2.5 }}>
            <Box sx={{ mx: 2.5, mb: 3 }}>
              <Skeleton variant="rounded" sx={{ height: 'min(55vh, 720px)', minHeight: 360 }} />
            </Box>
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={220} height={36} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 2.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={220} height={330} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {state.kind === 'empty' && (
          <Box sx={{ pt: 8 }}>
            <EmptyState
              icon={<LibraryAddOutlinedIcon />}
              title="No sources paired yet"
              body="Pair a Plex server to get started."
              actionLabel="Pair your first source"
              onAction={() => navigate('/settings/pair')}
            />
          </Box>
        )}

        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5, mt: 10 }}>Error: {state.message}</Alert>
        )}

        {state.kind === 'ok' && (
          <>
            {heroPick ? (
              <Hero
                backdropUrl={heroPick.item.poster}
                eyebrow={heroPick.eyebrow}
                title={heroPick.item.title}
                meta={[heroPick.item.year, formatRuntime(heroPick.item.durationSec)].filter(Boolean).join(' · ') || undefined}
                primaryAction={{
                  label: heroPick.item.viewOffsetSec && heroPick.item.viewOffsetSec > 60
                    ? `Resume ${formatPos(heroPick.item.viewOffsetSec)}`
                    : 'Play',
                  onClick: () => navigate(`/play/${heroPick.item.source}/${heroPick.item.id}`),
                }}
                secondaryAction={heroPick.item.viewOffsetSec && heroPick.item.viewOffsetSec > 60
                  ? { label: 'Start over', onClick: () => navigate(`/play/${heroPick.item.source}/${heroPick.item.id}?from=0`) }
                  : undefined}
                onHeightChange={setHeroH}
              />
            ) : (
              <Hero
                eyebrow="canvas"
                title="Your library, on every screen."
                primaryAction={{ label: 'Pair a source', onClick: () => navigate('/settings/pair') }}
                onHeightChange={setHeroH}
              />
            )}

            {/* Inline alerts removed in favour of the floating warning FAB at
                the bottom-right. Errors don't elbow into the layout below
                the hero; the FAB taps through to Settings → Sources. */}

            {(() => {
              const continueItems: (Item & { source: string })[] = [];
              const recentItems: (Item & { source: string })[] = [];
              for (const row of state.rows) {
                const tagged = row.items.map((i: Item) => ({ ...i, source: row.source }));
                if (row.kind === 'continue') continueItems.push(...tagged);
                else if (row.kind === 'recent') recentItems.push(...tagged);
              }
              return (
                <>
                  {continueItems.length > 0 && (
                    <Rail title="Continue Watching" items={continueItems} showSourceBadge />
                  )}
                  {recentItems.length > 0 && (
                    <Rail title="Recently Added" items={recentItems} showSourceBadge />
                  )}
                </>
              );
            })()}

            {sourceCount === 1 && singleSourceKey && singleSourceLibraries.length > 0 && (
              <Box component="section">
                <SectionHeading title="Libraries" />
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 240px)',
                    gap: 3,
                    px: 2.5,
                    pb: 4,
                  }}
                >
                  {singleSourceLibraries.map((lib) => (
                    <LibraryCard key={lib.id} library={lib} source={singleSourceKey} />
                  ))}
                </Box>
              </Box>
            )}

            {sourceCount > 1 && (() => {
              const backdrops: Record<string, string | undefined> = {};
              for (const row of state.rows) {
                if (row.kind !== 'recent') continue;
                if (backdrops[row.source]) continue;
                const firstWithPoster = row.items.find((i) => i.poster);
                if (firstWithPoster?.poster) backdrops[row.source] = firstWithPoster.poster;
              }
              return (
                <Box component="section">
                  <SectionHeading title="Your sources" />
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, 240px)',
                      gap: 3,
                      px: 2.5,
                      pb: 4,
                    }}
                  >
                    {Object.entries(sources).map(([key, src]) => (
                      <SourcePickerCard
                        key={key}
                        srcKey={key}
                        label={src.label}
                        type={src.type}
                        libraryCount={state.libraryCounts[key]}
                        backdropUrl={backdrops[key]}
                      />
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {state.rows.length === 0 && state.errors.length === 0 && (
              <Typography color="text.secondary" sx={{ px: 2.5 }}>
                Your sources are paired but returned nothing yet.
              </Typography>
            )}
          </>
        )}
      </Box>
      {state.kind === 'ok' && state.errors.length > 0 && (
        <Tooltip
          title={
            state.errors.length === 1
              ? `${state.errors[0]!.source} unavailable — tap for Settings`
              : `${state.errors.length} sources unavailable — tap for Settings`
          }
          placement="left"
          arrow
        >
          <Fab
            size="medium"
            onClick={() => navigate('/settings?tab=sources')}
            aria-label={`${state.errors.length} source${state.errors.length > 1 ? 's' : ''} unavailable`}
            sx={{
              position: 'fixed',
              right: 24,
              bottom: nowPlaying ? 124 : 24,
              backgroundColor: 'rgba(14,15,18,0.92)',
              color: 'secondary.main',
              border: '1px solid rgba(245,166,35,0.4)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              transition: 'background-color 220ms cubic-bezier(0.2,0,0,1), transform 220ms cubic-bezier(0.2,0,0,1), bottom 220ms cubic-bezier(0.2,0,0,1)',
              '&:hover': {
                backgroundColor: 'rgba(14,15,18,0.98)',
                transform: 'scale(1.05)',
              },
              zIndex: 9,
            }}
          >
            <Badge
              badgeContent={state.errors.length}
              color="error"
              max={9}
              invisible={state.errors.length <= 1}
            >
              <WarningAmberIcon />
            </Badge>
          </Fab>
        </Tooltip>
      )}
    </AppShell>
  );
}
