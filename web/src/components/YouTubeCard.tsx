import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

// YouTube thumbnails are 16:9, not the 2:3 poster the rest of the app uses —
// PosterCard squashes them. This card renders them at their native ratio with a
// duration badge and a 2-line title.
export interface YouTubeCardProps {
  item: Item;
  source: string;
  width?: number;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

export function YouTubeCard({ item, source, width = 300 }: YouTubeCardProps) {
  const href = item.type === 'folder' ? `/lib/${source}/${item.id}` : `/item/${source}/${item.id}`;
  return (
    <Box sx={{ flexShrink: 0, width }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
        <Box
          sx={{
            position: 'relative', width, aspectRatio: '16 / 9',
            backgroundColor: 'background.paper', borderRadius: 1,
            border: '1px solid', borderColor: 'divider', overflow: 'hidden',
          }}
        >
          {item.poster && (
            <Box component="img" src={item.poster} loading="lazy" decoding="async" alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
          {item.durationSec !== undefined && item.durationSec > 0 && (
            <Box sx={{
              position: 'absolute', bottom: 6, right: 6, px: 0.625, height: 18,
              borderRadius: 0.5, backgroundColor: 'rgba(0,0,0,0.82)', color: '#fff',
              fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
            }}>
              {formatDuration(item.durationSec)}
            </Box>
          )}
        </Box>
        <Typography sx={{
          mt: 1, fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: 'text.primary',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {item.title}
        </Typography>
      </CardActionArea>
    </Box>
  );
}
