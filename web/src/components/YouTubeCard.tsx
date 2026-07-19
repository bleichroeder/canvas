import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

// YouTube thumbnails are 16:9, not the 2:3 poster the rest of the app uses.
// This card renders them natively with a duration badge, a channel avatar +
// name (tap → channel page), and a view count — the info a YouTube user expects.
export interface YouTubeCardProps {
  item: Item;
  source: string;
  width?: number;
  /** Hide the channel avatar/name (e.g. on a channel page, where it's redundant). */
  showChannel?: boolean;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return h > 0 ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

function formatViews(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

function channelInitials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·';
}

// Deterministic avatar hue from the channel name.
function channelHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function YouTubeCard({ item, source, width = 300, showChannel = true }: YouTubeCardProps) {
  const href = item.type === 'folder' ? `/lib/${source}/${item.id}` : `/item/${source}/${item.id}`;
  const hasChannel = showChannel && !!item.channelTitle;

  const openChannel = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.channelId) return;
    const t = item.channelTitle ? `?t=${encodeURIComponent(item.channelTitle)}` : '';
    navigate(`/yt/${source}/channel/${encodeURIComponent(item.channelId)}${t}`);
  };

  return (
    <Box sx={{ flexShrink: 0, width }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
        <Box sx={{
          position: 'relative', width, aspectRatio: '16 / 9',
          backgroundColor: 'background.paper', borderRadius: 1,
          border: '1px solid', borderColor: 'divider', overflow: 'hidden',
        }}>
          {item.poster && (
            <Box component="img" src={item.poster} loading="lazy" decoding="async" alt=""
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
          {item.durationSec !== undefined && item.durationSec > 0 && (
            <Box sx={{
              position: 'absolute', bottom: 6, right: 6, px: 0.625, height: 18,
              borderRadius: 0.5, backgroundColor: 'rgba(0,0,0,0.82)', color: '#fff',
              fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatDuration(item.durationSec)}
            </Box>
          )}
        </Box>
      </CardActionArea>

      <Box sx={{ display: 'flex', gap: 1.25, mt: 1 }}>
        {hasChannel && (
          <Box
            onClick={openChannel}
            role={item.channelId ? 'button' : undefined}
            aria-label={item.channelId ? `Open ${item.channelTitle}` : undefined}
            sx={{
              flexShrink: 0, width: 34, height: 34, mt: 0.25, borderRadius: '50%',
              display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#fff',
              cursor: item.channelId ? 'pointer' : 'default',
              background: `linear-gradient(135deg, hsl(${channelHue(item.channelTitle!)},55%,45%), hsl(${channelHue(item.channelTitle!)},55%,28%))`,
            }}
          >
            {channelInitials(item.channelTitle!)}
          </Box>
        )}
        <Box sx={{ minWidth: 0 }}>
          <Typography
            onClick={() => navigate(href)}
            sx={{
              fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: 'text.primary', cursor: 'pointer',
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}
          >
            {item.title}
          </Typography>
          {hasChannel && (
            <Typography
              onClick={openChannel}
              sx={{
                mt: 0.25, fontSize: 12.5, color: 'text.secondary',
                cursor: item.channelId ? 'pointer' : 'default',
                '&:hover': item.channelId ? { color: 'text.primary' } : {},
              }}
            >
              {item.channelTitle}
            </Typography>
          )}
          {item.viewCount !== undefined && item.viewCount > 0 && (
            <Typography sx={{ fontSize: 12.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
              {formatViews(item.viewCount)} views
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
