import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { navigate } from '../router';
import type { Item } from '../types';

interface AlbumDetailProps {
  source: string;
  album: { title: string; artist?: string; cover?: string; year?: number };
  tracks: Item[];
}

function formatTrackDuration(sec?: number): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function totalDuration(tracks: Item[]): string {
  const totalSec = tracks.reduce((acc, t) => acc + (t.durationSec ?? 0), 0);
  if (totalSec === 0) return '';
  const h = Math.floor(totalSec / 3600);
  const m = Math.round((totalSec % 3600) / 60);
  return h > 0 ? `${h} hr ${m} min` : `${m} min`;
}

/**
 * Apple Music-style album detail view. Renders when the library response's
 * children are all tracks for a single album (the worker populates
 * `BrowseResult.albumDetail` with the album-level metadata).
 */
export function AlbumDetail({ source, album, tracks }: AlbumDetailProps) {
  const trackCount = tracks.length;
  const duration = totalDuration(tracks);
  const meta = [
    album.year ? String(album.year) : null,
    `${trackCount} ${trackCount === 1 ? 'track' : 'tracks'}`,
    duration || null,
  ].filter(Boolean).join(' · ');

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', px: { xs: 2, sm: 0 } }}>
      {/* Header: cover + title + artist + meta. Side-by-side on wide screens,
          stacked on narrow ones. */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          alignItems: { xs: 'center', sm: 'flex-end' },
          gap: { xs: 2.5, sm: 4 },
          mb: 4,
        }}
      >
        <Box
          sx={{
            width: { xs: 220, sm: 260 },
            height: { xs: 220, sm: 260 },
            flexShrink: 0,
            backgroundColor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
            backgroundImage: album.cover ? `url(${album.cover})` : 'none',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            boxShadow: '0 20px 50px rgba(0,0,0,0.55)',
          }}
        />
        <Box sx={{ minWidth: 0, textAlign: { xs: 'center', sm: 'left' }, flex: 1 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', letterSpacing: '1.5px', textTransform: 'uppercase' }}
          >
            Album
          </Typography>
          <Typography
            variant="h1"
            sx={{ fontSize: { xs: 32, sm: 44 }, fontWeight: 700, lineHeight: 1.1, mt: 0.5, mb: 1 }}
          >
            {album.title}
          </Typography>
          {album.artist && (
            <Typography
              sx={{ fontSize: 18, fontWeight: 500, color: 'primary.main', mb: 0.5 }}
            >
              {album.artist}
            </Typography>
          )}
          {meta && (
            <Typography variant="body2" color="text.secondary">{meta}</Typography>
          )}
        </Box>
      </Box>

      {/* Track list. Each row: number, title, duration. Tap row to play. */}
      <Box>
        {tracks.map((t) => (
          <ButtonBase
            key={t.id}
            onClick={() => navigate(`/play/${source}/${t.id}`)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              gap: 2,
              py: 1.5,
              px: 2,
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 0,
              transition: 'background-color 150ms cubic-bezier(0.2,0,0,1)',
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.04)',
                '& .track-number': { display: 'none' },
                '& .track-play-icon': { display: 'flex' },
              },
              '&:last-child': { borderBottom: 'none' },
            }}
          >
            <Box
              sx={{
                width: 32, flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Typography
                className="track-number"
                sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums', fontSize: 14 }}
              >
                {t.trackNumber ?? ''}
              </Typography>
              <Box className="track-play-icon" sx={{ display: 'none', color: 'primary.main' }}>
                <PlayArrowIcon sx={{ fontSize: 20 }} />
              </Box>
            </Box>
            <Typography
              sx={{
                flex: 1,
                minWidth: 0,
                textAlign: 'left',
                fontSize: 15,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {t.title}
            </Typography>
            <Typography
              sx={{
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {formatTrackDuration(t.durationSec)}
            </Typography>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}
