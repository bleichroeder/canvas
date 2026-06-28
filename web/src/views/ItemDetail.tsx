import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { navigate, Link } from '../router';
import { setItemTitle } from '../storage';
import type { ItemDetail } from '../types';

interface Props { source: string; id: string }

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

export function ItemDetailView({ source, id }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; item: ItemDetail }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    api.item(source, id).then(
      (item) => {
        setItemTitle(source, id, item.title);
        setState({ kind: 'ok', item });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, id]);

  if (state.kind === 'loading') {
    return <AppShell><Typography sx={{ p: 2.5 }} color="text.secondary">Loading…</Typography></AppShell>;
  }
  if (state.kind === 'error') {
    return <AppShell><Alert severity="error" sx={{ m: 2.5 }}>{state.message}</Alert></AppShell>;
  }

  const { item } = state;
  const resume = (item.viewOffsetSec ?? 0) > 60;

  return (
    <AppShell>
      {item.backdrop && (
        <Box
          sx={{
            height: 320,
            backgroundImage: `url(${item.backdrop})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            position: 'relative',
          }}
        >
          <Box
            sx={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 50%, var(--mui-palette-background-default, #0e0f12) 100%)',
            }}
          />
        </Box>
      )}
      <Box sx={{ px: 2.5, mt: item.backdrop ? -10 : 2.5, position: 'relative' }}>
        <Box sx={{ display: 'flex', gap: 3 }}>
          {item.poster && (
            <Box
              component="img"
              src={item.poster}
              alt=""
              sx={{ width: 200, height: 300, borderRadius: 1, objectFit: 'cover' }}
            />
          )}
          <Box sx={{ flex: 1, pt: item.backdrop ? 7.5 : 0 }}>
            <Typography variant="h1" sx={{ mb: 1 }}>{item.title}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {[item.year, formatRuntime(item.durationSec), item.rating ? `★ ${item.rating}` : null]
                .filter(Boolean).join(' · ')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<PlayArrowIcon />}
                onClick={() => navigate(`/play/${source}/${item.id}`)}
              >
                {resume ? `Resume ${formatPos(item.viewOffsetSec!)}` : 'Play'}
              </Button>
              {resume && (
                <Button
                  variant="text"
                  onClick={() => navigate(`/play/${source}/${item.id}?from=0`)}
                >
                  Start over
                </Button>
              )}
            </Box>
            {item.synopsis && (
              <Typography variant="body1" sx={{ maxWidth: 720, lineHeight: 1.5 }}>
                {item.synopsis}
              </Typography>
            )}
          </Box>
        </Box>

        {item.episodes && item.episodes.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h3" sx={{ mb: 1.5 }}>Episodes</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {item.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/play/${source}/${ep.id}`}
                  style={{
                    display: 'flex', gap: 16, padding: 12,
                    backgroundColor: 'var(--mui-palette-background-paper, #181a1f)',
                    border: '1px solid var(--mui-palette-divider, #2a2d36)',
                    borderRadius: 8,
                    color: 'inherit',
                  }}
                >
                  {ep.poster && (
                    <Box
                      component="img"
                      src={ep.poster}
                      alt=""
                      sx={{ width: 160, height: 90, borderRadius: 0.5, objectFit: 'cover' }}
                    />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      S{ep.season}·E{ep.episode} · {ep.title}
                    </Typography>
                    {ep.synopsis && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {ep.synopsis}
                      </Typography>
                    )}
                  </Box>
                </Link>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
