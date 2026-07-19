import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { api } from '../api';
import { navigate } from '../router';
import { YouTubeCard } from '../components/YouTubeCard';
import { openPlayer, setPlayerMode, setEmbedRect } from '../lib/player-session';
import type { Item, ItemDetail } from '../types';

interface Props { source: string; id: string }

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·';
}
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
function formatViews(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}
function formatRelative(iso: string): string {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return months <= 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.floor(days / 365.25);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

// Dedicated YouTube watch page: the persistent player floats over the slot
// (embed mode) with the title / channel / date / description and a "more from
// this channel" rail below — a YouTube-shaped experience for that source.
export function YouTubeWatch({ source, id }: Props) {
  const slotRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<ItemDetail | null>(null);
  const [related, setRelated] = useState<Item[]>([]);
  const [subId, setSubId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState('');

  // Drive the persistent player: embed on entry, dock to mini on exit so it
  // keeps playing when the user navigates away.
  useEffect(() => {
    openPlayer(source, id, { mode: 'embed' });
    return () => {
      // Leaving the watch page: release the slot and dock the player so it
      // keeps playing. (When navigating to another watch page, the new mount's
      // openPlayer immediately re-takes it in embed mode.)
      setEmbedRect(null);
      setPlayerMode('mini');
    };
  }, [source, id]);

  // Publish the player's slot rectangle (stable — the slot doesn't scroll).
  useEffect(() => {
    const measure = () => {
      const el = slotRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setEmbedRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (slotRef.current) ro.observe(slotRef.current);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  // Metadata + related videos + subscription state.
  useEffect(() => {
    let cancelled = false;
    setMeta(null); setRelated([]); setExpanded(false); setError('');
    api.item(source, id).then(async (item) => {
      if (cancelled) return;
      setMeta(item);
      if (item.channelId) {
        try {
          const [lib, follows] = await Promise.all([
            api.library(source, `c:${item.channelId}`),
            api.youtubeFollows.list(),
          ]);
          if (cancelled) return;
          setRelated(lib.items.filter((v) => v.id !== id));
          const sub = follows.find((f) => f.kind === 'channel' && f.ytId === item.channelId);
          setSubId(sub ? sub.id : null);
        } catch { /* related/subscribe are best-effort */ }
      }
    }).catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [source, id]);

  async function toggleSubscribe() {
    if (!meta?.channelId) return;
    setBusy(true);
    try {
      if (subId != null) { await api.youtubeFollows.remove(subId); setSubId(null); }
      else { const f = await api.youtubeFollows.add({ kind: 'channel', ytId: meta.channelId }); setSubId(f.id); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else navigate(`/source/${source}`);
  }

  const channel = meta?.channelTitle ?? '';
  const stats = [
    meta?.viewCount ? `${formatViews(meta.viewCount)} views` : null,
    meta?.uploadDate ? formatRelative(meta.uploadDate) : null,
  ].filter(Boolean).join(' · ');
  const subscribed = subId != null;

  return (
    <Box sx={{ position: 'fixed', inset: 0, bgcolor: '#0e0f12', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, flexShrink: 0 }}>
        <IconButton onClick={goBack} aria-label="back" sx={{ color: 'text.primary' }}>
          <ArrowBackIcon />
        </IconButton>
      </Box>

      {/* Player slot — the persistent player floats over this rect (embed mode). */}
      <Box sx={{ display: 'flex', justifyContent: 'center', bgcolor: '#000', flexShrink: 0 }}>
        <Box ref={slotRef} sx={{ width: '100%', maxWidth: 'calc(56vh * 16 / 9)', aspectRatio: '16 / 9' }} />
      </Box>

      {/* Details + related, scrollable below the pinned player. */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, sm: 3 }, py: 2 }}>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography sx={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3 }}>
          {meta?.title ?? ' '}
        </Typography>
        {(stats || meta?.isLive) && (
          <Typography sx={{ mt: 0.5, fontSize: 13.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}>
            {meta?.isLive && (
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#f00', fontWeight: 700 }}>
                <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: '#f00' }} /> LIVE
              </Box>
            )}
            {stats}
          </Typography>
        )}

        {/* Channel + subscribe */}
        {channel && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
            <Box
              onClick={() => meta?.channelId && navigate(`/yt/${source}/channel/${encodeURIComponent(meta.channelId)}?t=${encodeURIComponent(channel)}`)}
              role={meta?.channelId ? 'button' : undefined}
              sx={{
                width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
                display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 15, color: '#fff',
                cursor: meta?.channelId ? 'pointer' : 'default',
                background: `linear-gradient(135deg, hsl(${hue(channel)},55%,45%), hsl(${hue(channel)},55%,28%))`,
              }}
            >
              {initials(channel)}
            </Box>
            <Typography
              onClick={() => meta?.channelId && navigate(`/yt/${source}/channel/${encodeURIComponent(meta.channelId)}?t=${encodeURIComponent(channel)}`)}
              sx={{ fontWeight: 600, fontSize: 15, cursor: meta?.channelId ? 'pointer' : 'default' }}
            >
              {channel}
            </Typography>
            {meta?.channelId && (
              <Button
                onClick={toggleSubscribe}
                disabled={busy}
                variant={subscribed ? 'outlined' : 'contained'}
                sx={{
                  ml: 'auto', borderRadius: 999, px: 2.5, fontWeight: 700,
                  ...(subscribed ? {} : { backgroundColor: '#ff3b3b', '&:hover': { backgroundColor: '#e63535' } }),
                }}
              >
                {busy ? <CircularProgress size={16} color="inherit" /> : subscribed ? 'Subscribed ✓' : 'Subscribe'}
              </Button>
            )}
          </Box>
        )}

        {/* Description */}
        {meta?.synopsis && (
          <Box
            onClick={() => setExpanded((v) => !v)}
            sx={{
              mt: 2, p: 1.5, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.04)', cursor: 'pointer',
              fontSize: 13.5, color: 'text.secondary', whiteSpace: 'pre-wrap',
              ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
            }}
          >
            {meta.synopsis}
          </Box>
        )}

        {/* More from this channel */}
        {related.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 15, mb: 1.5 }}>
              More from {channel || 'this channel'}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2.5 }}>
              {related.map((it) => (
                <YouTubeCard key={it.id} item={it} source={source} width={260} showChannel={false} />
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}
