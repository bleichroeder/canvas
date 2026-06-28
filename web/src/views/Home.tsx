import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import { api } from '../api';
import { getSources } from '../storage';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Rail } from '../components/Rail';
import { SourcePickerCard } from '../components/SourcePickerCard';
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
  const [state, setState] = useState<State>({ kind: 'loading' });
  const sources = getSources();
  const sourceCount = Object.keys(sources).length;

  useEffect(() => {
    if (sourceCount === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors, libraryCounts }) => setState({ kind: 'ok', rows, errors, libraryCounts }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueRow = state.kind === 'ok'
    ? state.rows.find((r) => r.kind === 'continue')
    : undefined;
  const heroItem = continueRow?.items[0] as (Item & { backdrop?: string; source?: string }) | undefined;

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        {state.kind === 'loading' && (
          <>
            <Box sx={{ mx: 2.5, mb: 3 }}>
              <Skeleton variant="rounded" height={320} />
            </Box>
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={180} height={28} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 1.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={180} height={270} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
          </>
        )}
        {state.kind === 'empty' && (
          <EmptyState
            icon={<LibraryAddOutlinedIcon />}
            title="No sources paired yet"
            body="Pair a Plex server to get started."
            actionLabel="Pair your first source"
            onAction={() => navigate('/settings/pair')}
          />
        )}
        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5 }}>Error: {state.message}</Alert>
        )}
        {state.kind === 'ok' && (
          <>
            {heroItem && heroItem.source && (
              <Box
                className="canvas-hero"
                sx={{
                  height: 320,
                  mx: 2.5, mb: 3, borderRadius: 2,
                  position: 'relative', overflow: 'hidden',
                  backgroundImage: heroItem.poster ? `url(${heroItem.poster})` : 'linear-gradient(135deg, #1a2030, #0e0f12)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, rgba(14,15,18,0.95) 0%, rgba(14,15,18,0.6) 50%, transparent 100%)',
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute', left: 32, top: 0, bottom: 0,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    maxWidth: 480,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">Continue Watching</Typography>
                  <Typography variant="h1" sx={{ mt: 0.5, mb: 1 }}>{heroItem.title}</Typography>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    {[heroItem.year, formatRuntime(heroItem.durationSec)].filter(Boolean).join(' · ')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<PlayArrowIcon />}
                      onClick={() => navigate(`/play/${heroItem.source}/${heroItem.id}`)}
                    >
                      {heroItem.viewOffsetSec && heroItem.viewOffsetSec > 60
                        ? `Resume ${formatPos(heroItem.viewOffsetSec)}`
                        : 'Play'}
                    </Button>
                    {heroItem.viewOffsetSec && heroItem.viewOffsetSec > 60 && (
                      <Button
                        variant="text"
                        onClick={() => navigate(`/play/${heroItem.source}/${heroItem.id}?from=0`)}
                      >
                        Start over
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            )}

            {state.errors.length > 0 && (
              <Box sx={{ px: 2.5, pb: 2 }}>
                {state.errors.map((err) => (
                  <Alert key={err.source} severity="warning" sx={{ my: 0.5 }}>
                    {err.source}: {err.message}
                  </Alert>
                ))}
              </Box>
            )}

            {(() => {
              // Aggregate rows by kind across sources.
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
                    <Rail
                      title="Continue Watching"
                      items={continueItems}
                      cardWidth={180}
                      showSourceBadge
                    />
                  )}
                  {recentItems.length > 0 && (
                    <Rail
                      title="Recently Added"
                      items={recentItems}
                      cardWidth={180}
                      showSourceBadge
                    />
                  )}
                </>
              );
            })()}

            {sourceCount > 1 && (
              <Box component="section" sx={{ mt: 4 }}>
                <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>Your sources</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 200px)',
                    gap: 2.5,
                    px: 2.5,
                  }}
                >
                  {Object.entries(sources).map(([key, src]) => (
                    <SourcePickerCard
                      key={key}
                      srcKey={key}
                      label={src.label}
                      type={src.type}
                      libraryCount={state.libraryCounts[key]}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {state.rows.length === 0 && state.errors.length === 0 && (
              <Typography color="text.secondary" sx={{ px: 2.5 }}>
                Your sources are paired but returned nothing yet.
              </Typography>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
