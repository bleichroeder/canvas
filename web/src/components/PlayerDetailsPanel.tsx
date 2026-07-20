import { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import CircularProgress from '@mui/material/CircularProgress';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api';
import { navigate } from '../router';
import { YouTubeCard } from './YouTubeCard';
import { YouTubeLikeButton } from './YouTubeLikeButton';
import type { Item, ItemDetail } from '../types';
import type { PlaybackQueue } from '../lib/playback-queue';

export interface PlayerDetailsPanelProps {
  source: string;
  sourceType: string;
  itemMeta: ItemDetail | null;
  queue: PlaybackQueue | null;
  currentId: string;
  onPlayEpisodeIndex(index: number): void;
  onClose(): void;
}

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

// In-player details, shown as a right-side panel and toggled from the control
// bar. Content is source-aware: YouTube shows channel/subscribe/description +
// a "more from this channel" list; media sources show synopsis + the season's
// episodes. Lives inside the persistent player, so it survives mini↔full.
export function PlayerDetailsPanel(props: PlayerDetailsPanelProps) {
  const { source, sourceType, itemMeta, queue, currentId, onPlayEpisodeIndex, onClose } = props;
  const isYouTube = sourceType === 'youtube';

  return (
    <Box sx={{
      width: 'clamp(300px, 30vw, 440px)', flexShrink: 0, height: '100%',
      bgcolor: '#16171b', borderLeft: '1px solid', borderColor: 'divider',
      display: 'flex', flexDirection: 'column',
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 15 }}>Details</Typography>
        <IconButton onClick={onClose} aria-label="hide details" size="small" sx={{ ml: 'auto', color: 'text.secondary' }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        {itemMeta === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={26} /></Box>
        ) : isYouTube ? (
          <YouTubeDetails source={source} meta={itemMeta} currentId={currentId} />
        ) : (
          <MediaDetails meta={itemMeta} queue={queue} currentId={currentId} onPlayEpisodeIndex={onPlayEpisodeIndex} />
        )}
      </Box>
    </Box>
  );
}

// ── YouTube ──────────────────────────────────────────────────────────────────
function YouTubeDetails({ source, meta, currentId }: {
  source: string; meta: ItemDetail; currentId: string;
}) {
  const [related, setRelated] = useState<Item[]>([]);
  const [subId, setSubId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const channel = meta.channelTitle ?? '';

  useEffect(() => {
    let cancelled = false;
    setRelated([]);
    if (!meta.channelId) return;
    Promise.all([api.library(source, `c:${meta.channelId}`), api.youtubeFollows.list()])
      .then(([lib, follows]) => {
        if (cancelled) return;
        setRelated(lib.items.filter((v) => v.id !== currentId));
        const sub = follows.find((f) => f.kind === 'channel' && f.ytId === meta.channelId);
        setSubId(sub ? sub.id : null);
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, [source, meta.channelId, currentId]);

  async function toggleSubscribe() {
    if (!meta.channelId) return;
    setBusy(true);
    try {
      if (subId != null) { await api.youtubeFollows.remove(subId); setSubId(null); }
      else { const f = await api.youtubeFollows.add({ kind: 'channel', ytId: meta.channelId }); setSubId(f.id); }
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  const stats = [
    meta.viewCount ? `${formatViews(meta.viewCount)} views` : null,
    meta.uploadDate ? formatRelative(meta.uploadDate) : null,
  ].filter(Boolean).join(' · ');
  const subscribed = subId != null;

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{meta.title}</Typography>
        <Box sx={{ flexShrink: 0, mt: -0.5, mr: -0.5 }}>
          <YouTubeLikeButton
            size="medium"
            video={{
              ytId: currentId,
              title: meta.title,
              thumbnail: meta.poster ?? null,
              channelId: meta.channelId ?? null,
              channelTitle: meta.channelTitle ?? null,
              durationSec: meta.durationSec ?? null,
            }}
          />
        </Box>
      </Box>
      {(stats || meta.isLive) && (
        <Typography sx={{ mt: 0.5, fontSize: 12.5, color: 'text.secondary', display: 'flex', alignItems: 'center', gap: 1 }}>
          {meta.isLive && (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#f00', fontWeight: 700 }}>
              <Box component="span" sx={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#f00' }} /> LIVE
            </Box>
          )}
          {stats}
        </Typography>
      )}
      {channel && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 2 }}>
          <Box
            onClick={() => meta.channelId && navigate(`/yt/${source}/channel/${encodeURIComponent(meta.channelId)}?t=${encodeURIComponent(channel)}`)}
            sx={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0, cursor: meta.channelId ? 'pointer' : 'default',
              display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#fff',
              background: `linear-gradient(135deg, hsl(${hue(channel)},55%,45%), hsl(${hue(channel)},55%,28%))`,
            }}
          >{initials(channel)}</Box>
          <Typography sx={{ fontWeight: 600, fontSize: 13.5, minWidth: 0, flex: 1 }} noWrap>{channel}</Typography>
          {meta.channelId && (
            <Button onClick={toggleSubscribe} disabled={busy} size="small"
              variant={subscribed ? 'outlined' : 'contained'}
              sx={{ borderRadius: 999, fontWeight: 700, flexShrink: 0,
                ...(subscribed ? {} : { backgroundColor: '#ff3b3b', '&:hover': { backgroundColor: '#e63535' } }) }}>
              {busy ? <CircularProgress size={14} color="inherit" /> : subscribed ? 'Subscribed ✓' : 'Subscribe'}
            </Button>
          )}
        </Box>
      )}
      {meta.synopsis && (
        <Box
          onClick={() => setExpanded((v) => !v)}
          sx={{
            mt: 2, p: 1.25, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.04)', cursor: 'pointer',
            fontSize: 13, color: 'text.secondary', whiteSpace: 'pre-wrap',
            ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }),
          }}
        >{meta.synopsis}</Box>
      )}
      {related.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13.5, mb: 1.5, color: 'text.secondary' }}>Up next</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {related.slice(0, 20).map((it) => (
              <YouTubeCard key={it.id} item={it} source={source} width={Math.min(360, 400)} showChannel={false} />
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}

// ── Media (Plex / Flixify / etc.) ──────────────────────────────────────────────
function MediaDetails({ meta, queue, currentId, onPlayEpisodeIndex }: {
  meta: ItemDetail; queue: PlaybackQueue | null; currentId: string; onPlayEpisodeIndex(index: number): void;
}) {
  return (
    <>
      <Typography sx={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>
        {queue?.showTitle ?? meta.title}
      </Typography>
      {meta.title && queue?.showTitle && meta.title !== queue.showTitle && (
        <Typography sx={{ mt: 0.25, fontSize: 13, color: 'text.secondary' }}>{meta.title}</Typography>
      )}
      {meta.year && <Typography sx={{ mt: 0.25, fontSize: 12.5, color: 'text.disabled' }}>{meta.year}</Typography>}
      {meta.synopsis && (
        <Typography sx={{ mt: 1.5, fontSize: 13, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
          {meta.synopsis}
        </Typography>
      )}
      {queue && queue.episodes.length > 1 && (
        <SeasonEpisodes queue={queue} currentId={currentId} onPlayEpisodeIndex={onPlayEpisodeIndex} />
      )}
    </>
  );
}

// Episode list scoped to one season, with a season picker for multi-season
// shows — so a long-running series doesn't dump every episode into one list.
function SeasonEpisodes({ queue, currentId, onPlayEpisodeIndex }: {
  queue: PlaybackQueue; currentId: string; onPlayEpisodeIndex(index: number): void;
}) {
  const seasons = useMemo(
    () => [...new Set(queue.episodes.map((e) => e.season))].sort((a, b) => a - b),
    [queue.episodes],
  );
  const currentSeason = queue.episodes.find((e) => e.id === currentId)?.season ?? seasons[0] ?? 1;
  const [selSeason, setSelSeason] = useState(currentSeason);
  // Follow the playing episode's season as it changes (e.g. auto-advance).
  useEffect(() => { setSelSeason(currentSeason); }, [currentSeason]);

  const inSeason = queue.episodes
    .map((ep, i) => ({ ep, i }))
    .filter(({ ep }) => ep.season === selSeason);

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13.5, color: 'text.secondary' }}>Episodes</Typography>
        {seasons.length > 1 && (
          <Select
            size="small"
            value={selSeason}
            onChange={(e) => setSelSeason(Number(e.target.value))}
            sx={{ ml: 'auto', fontSize: 13, '& .MuiSelect-select': { py: 0.5, pl: 1.25 } }}
          >
            {seasons.map((s) => (
              <MenuItem key={s} value={s} sx={{ fontSize: 13 }}>{s === 0 ? 'Specials' : `Season ${s}`}</MenuItem>
            ))}
          </Select>
        )}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {inSeason.map(({ ep, i }) => {
              const current = ep.id === currentId;
              return (
                <Box
                  key={ep.id}
                  onClick={() => !current && onPlayEpisodeIndex(i)}
                  sx={{
                    display: 'flex', gap: 1.25, p: 1, borderRadius: 1.5, cursor: current ? 'default' : 'pointer',
                    backgroundColor: current ? 'rgba(255,255,255,0.09)' : 'transparent',
                    '&:hover': current ? {} : { backgroundColor: 'rgba(255,255,255,0.05)' },
                  }}
                >
                  <Box sx={{
                    position: 'relative', width: 100, aspectRatio: '16 / 9', flexShrink: 0, borderRadius: 1,
                    overflow: 'hidden', backgroundColor: '#000',
                    backgroundImage: ep.poster ? `url(${ep.poster})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center',
                    display: 'grid', placeItems: 'center',
                  }}>
                    {current && <PlayArrowIcon sx={{ color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.8))' }} />}
                  </Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: 11.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}>
                      {ep.season ? `S${ep.season}E${ep.episode}` : `#${ep.episode ?? i + 1}`}
                    </Typography>
                    <Typography sx={{
                      fontSize: 13, fontWeight: current ? 700 : 500, color: current ? 'text.primary' : 'text.secondary',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                    }}>{ep.title}</Typography>
                  </Box>
                </Box>
              );
            })}
      </Box>
    </Box>
  );
}
