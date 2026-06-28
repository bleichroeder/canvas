import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Avatar from '@mui/material/Avatar';
import LinearProgress from '@mui/material/LinearProgress';
import Skeleton from '@mui/material/Skeleton';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StarIcon from '@mui/icons-material/Star';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { navigate } from '../router';
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

function Dot() {
  return <Box component="span" sx={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: 'text.secondary' }} />;
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
    return (
      <AppShell>
        <Skeleton variant="rectangular" height={320} />
        <Box sx={{ px: 2.5, mt: -10, position: 'relative' }}>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Skeleton variant="rectangular" width={200} height={300} sx={{ borderRadius: 1, flexShrink: 0 }} />
            <Box sx={{ flex: 1, pt: 7.5 }}>
              <Skeleton variant="text" width="60%" height={56} sx={{ mb: 1 }} />
              <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2 }} />
              <Skeleton variant="rounded" width={180} height={42} sx={{ mb: 2 }} />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="80%" />
            </Box>
          </Box>
        </Box>
      </AppShell>
    );
  }
  if (state.kind === 'error') {
    return <AppShell><Alert severity="error" sx={{ m: 2.5 }}>{state.message}</Alert></AppShell>;
  }

  const { item } = state;
  const resume = (item.viewOffsetSec ?? 0) > 60;
  const genres: string[] = []; // TODO: when adapter exposes genres on ItemDetail, wire here. (no genres for v1)

  return (
    <AppShell>
      {item.backdrop && (
        <Box
          className="canvas-hero"
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
              background: 'linear-gradient(to bottom, transparent 40%, var(--mui-palette-background-default) 100%)',
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
              sx={{ width: 200, height: 300, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <Box sx={{ flex: 1, pt: item.backdrop ? 7.5 : 0 }}>
            <Typography variant="h1" sx={{ mb: 1 }}>{item.title}</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" divider={<Dot />} sx={{ mb: 1, color: 'text.secondary' }}>
              {item.year && <Typography variant="body2">{item.year}</Typography>}
              {item.durationSec && <Typography variant="body2">{formatRuntime(item.durationSec)}</Typography>}
              {item.rating !== undefined && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <StarIcon fontSize="small" sx={{ color: '#f5a623' }} />
                  <Typography variant="body2">{item.rating.toFixed(1)}</Typography>
                </Stack>
              )}
            </Stack>
            {genres.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                {genres.map((g) => <Chip key={g} label={g} size="small" variant="outlined" />)}
              </Stack>
            )}
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
            <List sx={{ p: 0 }}>
              {item.episodes.map((ep) => {
                const pct = ep.durationSec && ep.viewOffsetSec
                  ? Math.min(100, Math.round((ep.viewOffsetSec / ep.durationSec) * 100))
                  : 0;
                const resumeEp = (ep.viewOffsetSec ?? 0) > 60;
                return (
                  <ListItemButton
                    key={ep.id}
                    onClick={() => navigate(`/play/${source}/${ep.id}`)}
                    sx={{
                      position: 'relative',
                      mb: 1, p: 1.5,
                      backgroundColor: 'background.paper',
                      border: '1px solid', borderColor: 'divider',
                      borderRadius: 1,
                      gap: 2, alignItems: 'flex-start',
                    }}
                  >
                    {ep.poster && (
                      <Avatar
                        variant="rounded"
                        src={ep.poster}
                        sx={{ width: 160, height: 90, flexShrink: 0 }}
                      />
                    )}
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        S{ep.season}·E{ep.episode} · {ep.title}
                      </Typography>
                      <Stack direction="row" spacing={1.5} divider={<Dot />} sx={{ mt: 0.5, color: 'text.secondary' }}>
                        {ep.durationSec && <Typography variant="caption">{formatRuntime(ep.durationSec)}</Typography>}
                        {resumeEp && <Typography variant="caption">Resume {formatPos(ep.viewOffsetSec!)}</Typography>}
                      </Stack>
                      {ep.synopsis && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {ep.synopsis}
                        </Typography>
                      )}
                    </Box>
                    {resumeEp && (
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: 0 }}
                      />
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
