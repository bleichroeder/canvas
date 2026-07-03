import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import { useSources } from '../lib/SourcesContext';
import { SOURCE_TYPE_COLOR, sourceGlyph } from '../lib/source-style';
import type { Item } from '../types';

export interface PosterCardProps {
  item: Item;
  source: string;
  width?: number;
  showSourceBadge?: boolean;
}

function formatEpisodeSubtitle(item: Item): string | undefined {
  if (item.type !== 'episode') return undefined;
  if (item.season !== undefined && item.episode !== undefined) {
    const tag = `S${item.season}·E${item.episode}`;
    return item.title ? `${tag} · ${item.title}` : tag;
  }
  return item.title;
}

export function PosterCard({ item, source, width = 220, showSourceBadge = false }: PosterCardProps) {
  const { sources } = useSources();
  const isFolder = item.type === 'folder';
  // Episode home-row items carry a showId — route to the show's tabbed
  // ItemDetail with ?ep=... so ItemDetail can point the season tab at (and
  // scroll to) the specific episode the user clicked. Non-home cards leave
  // showId unset and route to item.id as before.
  const detailId = item.showId ?? item.id;
  const detailQuery = item.showId ? `?ep=${encodeURIComponent(item.id)}` : '';
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${detailId}${detailQuery}`;
  // Music items use 1:1 (album covers are square); everything else is 2:3
  // poster. Episodes carry the show's poster, so they're visually uniform
  // with movies/shows.
  const isMusic = item.kind === 'music-artist' || item.kind === 'music-album' || item.kind === 'music-track';
  const aspectRatio = isMusic ? 1 : 2 / 3;
  const src = showSourceBadge ? sources[source] : undefined;
  const displayTitle = item.type === 'episode' && item.showTitle ? item.showTitle : item.title;
  const subtitle =
    item.type === 'episode' ? formatEpisodeSubtitle(item)
    : item.kind === 'music-album' ? item.artistName
    : item.kind === 'music-artist' ? (item.year ? String(item.year) : undefined)
    : item.kind === 'music-track' ? item.albumTitle
    : (item.year ? String(item.year) : undefined);
  return (
    // MUI Card defaults to overflow:hidden which clips the CardActionArea's
    // scale(1.03) hover at the card bounds. Use a plain Box so the scaled
    // content stays visible — the inner poster wrapper keeps its own
    // overflow:hidden for rounded-corner clipping of the image.
    <Box sx={{ flexShrink: 0, width }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
        <Box
          sx={{
            position: 'relative',
            width,
            aspectRatio: String(aspectRatio),
            backgroundColor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {item.poster && (
            <Box
              component="img"
              src={item.poster}
              loading="lazy"
              decoding="async"
              alt=""
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          )}
          {src && (
            <Box
              sx={{
                position: 'absolute',
                top: 6, right: 6,
                minWidth: 28, height: 24, px: 0.75,
                borderRadius: 0.5,
                backgroundColor: SOURCE_TYPE_COLOR[src.type],
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 11,
                letterSpacing: 0.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              {sourceGlyph(src.label)}
            </Box>
          )}
          {item.hasCC && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 6, left: 6,
                height: 20, px: 0.625,
                borderRadius: 0.5,
                backgroundColor: 'rgba(0,0,0,0.78)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 10,
                letterSpacing: 0.5,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              CC
            </Box>
          )}
          {item.rating !== undefined && item.rating > 0 && (
            <Box
              sx={{
                position: 'absolute',
                bottom: 6, right: 6,
                height: 20, px: 0.75,
                borderRadius: 0.5,
                backgroundColor: 'rgba(0,0,0,0.78)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                gap: 0.25,
                fontWeight: 600,
                fontSize: 10,
                boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
              }}
            >
              <Box component="span" sx={{ color: '#f5a623', fontSize: 11, lineHeight: 1 }}>★</Box>
              {item.rating.toFixed(1)}
            </Box>
          )}
        </Box>
        <Box sx={{ mt: 1.25 }}>
          <Typography
            sx={{
              fontWeight: 600,
              fontSize: 14,
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: 'text.primary',
            }}
          >
            {displayTitle}
          </Typography>
          {subtitle && (
            <Typography
              sx={{
                mt: 0.25,
                fontSize: 12,
                fontWeight: 500,
                lineHeight: 1.3,
                color: 'text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>
      </CardActionArea>
    </Box>
  );
}
