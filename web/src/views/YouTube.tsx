import { useEffect, useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import SubscriptionsOutlinedIcon from '@mui/icons-material/SubscriptionsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FavoriteIcon from '@mui/icons-material/Favorite';
import { api } from '../api';
import { navigate } from '../router';
import { AppShell } from '../components/AppShell';
import { YouTubeCard } from '../components/YouTubeCard';
import { Rail } from '../components/Rail';
import { EmptyState } from '../components/EmptyState';
import { ensureLikesLoaded, useLikes } from '../lib/youtube-likes';
import type { Item } from '../types';

interface Props { source: string }

interface SubGroup { title: string; ytId: string; kind: 'channel' | 'playlist'; thumbnail?: string | null; videos: Item[] }

const YT_CARD_W = 300;
const ROW_CARD_W = 260;
const gridSx = { display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${YT_CARD_W}px)`, gap: 3, px: 2.5, justifyContent: 'center' } as const;

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·';
}
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function YouTube({ source }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  const [groups, setGroups] = useState<SubGroup[] | null>(null); // null = loading

  const likes = useLikes();
  useEffect(() => { void ensureLikesLoaded(); }, []);
  const likedItems: (Item & { source: string })[] = likes.map((l) => ({
    id: l.ytId,
    type: 'movie',
    title: l.title,
    source,
    ...(l.thumbnail ? { poster: l.thumbnail } : {}),
    ...(l.durationSec != null ? { durationSec: l.durationSec } : {}),
    ...(l.channelId ? { channelId: l.channelId } : {}),
    ...(l.channelTitle ? { channelTitle: l.channelTitle } : {}),
  }));

  const loadSubs = useCallback(async () => {
    const follows = await api.youtubeFollows.list();
    if (follows.length === 0) { setGroups([]); return; }
    const loaded = await Promise.all(
      follows.map(async (f): Promise<SubGroup> => {
        const kind = f.kind === 'channel' ? 'c' : 'p';
        const videos = await api.library(source, `${kind}:${f.ytId}`)
          // Channel-browse entries don't repeat the channel per-video, so stamp
          // the follow's identity on so cards still show the channel.
          .then((r) => r.items.slice(0, 12).map((it) => ({
            ...it,
            ...(it.channelTitle ? {} : { channelTitle: f.title }),
            ...(it.channelId || f.kind !== 'channel' ? {} : { channelId: f.ytId }),
          })))
          .catch(() => [] as Item[]);
        return { title: f.title, ytId: f.ytId, kind: f.kind, thumbnail: f.thumbnail, videos };
      }),
    );
    setGroups(loaded.filter((g) => g.videos.length > 0));
  }, [source]);

  useEffect(() => { void loadSubs(); }, [loadSubs]);

  // Debounced live search — no ENTER (no good Enter key in the car). 700ms is
  // deliberately long: you're typing on a 16" touchscreen.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const { hits } = await api.search(q.trim());
        setResults(hits.filter((h) => h.source === source));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 700);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, source]);

  const isSearching = q.trim().length >= 2;

  return (
    <AppShell>
      {/* Red accent rising from the bottom of the viewport, behind the content,
          so it doesn't clash with the blue/white nav at the top. */}
      <Box sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0, height: '48vh', pointerEvents: 'none', zIndex: 0,
        background: 'linear-gradient(0deg, rgba(255,0,0,0.15) 0%, rgba(255,0,0,0.05) 32%, transparent 72%)',
      }} />
      <Box sx={{ position: 'relative', zIndex: 1 }}>
      {/* Hero: centered YouTube logo + search. */}
      <Box sx={{ textAlign: 'center', pt: { xs: 4, sm: 6 }, pb: 3.5, px: 2 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 3 }}>
          <Box sx={{
            width: 54, height: 38, borderRadius: 2, backgroundColor: '#ff0000',
            display: 'grid', placeItems: 'center', boxShadow: '0 6px 18px rgba(255,0,0,0.45)',
          }}>
            <Box component="svg" viewBox="0 0 24 24" aria-hidden sx={{ width: 26, height: 26 }}>
              <path d="M8 5.5v13l11-6.5z" fill="#fff" />
            </Box>
          </Box>
          <Typography variant="h1" sx={{ m: 0, fontWeight: 800, letterSpacing: '-0.5px' }}>YouTube</Typography>
        </Box>
        <Box sx={{ maxWidth: 640, mx: 'auto' }}>
          <TextField
            fullWidth placeholder="Search YouTube…"
            value={q} onChange={(e) => setQ(e.target.value)}
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)',
              },
            }}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
              endAdornment: searching ? <CircularProgress size={18} /> : undefined,
            }}
          />
        </Box>
      </Box>

      {isSearching ? (
        <Box sx={{ mt: 1, opacity: searching ? 0.5 : 1, transition: 'opacity 120ms' }}>
          {results.length === 0 && !searching ? (
            <EmptyState icon={<SearchOffOutlinedIcon />} title={`No results for "${q.trim()}"`} />
          ) : (
            <Box sx={gridSx}>
              {results.map((it) => <YouTubeCard key={it.id} item={it} source={source} width={YT_CARD_W} />)}
            </Box>
          )}
        </Box>
      ) : groups === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
      ) : groups.length === 0 && likedItems.length === 0 ? (
        <EmptyState
          icon={<SubscriptionsOutlinedIcon />}
          title="You haven't subscribed to any channels yet"
          body="Search for something to watch, then open a channel and hit Subscribe — its latest videos show up here. Tap the ♥ on any video to keep it in Liked."
        />
      ) : (
        <Box sx={{ pb: 4 }}>
          {likedItems.length > 0 && (
            <Rail
              title="Liked"
              cardWidth={ROW_CARD_W}
              items={likedItems}
              renderItem={(it) => <YouTubeCard item={it} source={source} width={ROW_CARD_W} />}
              titlePrefix={
                <Box sx={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  display: 'grid', placeItems: 'center', backgroundColor: 'rgba(255,59,59,0.16)',
                }}>
                  <FavoriteIcon sx={{ fontSize: 20, color: '#ff3b3b' }} />
                </Box>
              }
            />
          )}
          {groups.map((g) => {
            const viewAll = () =>
              g.kind === 'channel'
                ? navigate(`/yt/${source}/channel/${encodeURIComponent(g.ytId)}?t=${encodeURIComponent(g.title)}`)
                : navigate(`/lib/${source}/p:${encodeURIComponent(g.ytId)}`);
            return (
              <Rail
                key={`${g.kind}:${g.ytId}`}
                title={g.title}
                cardWidth={ROW_CARD_W}
                items={g.videos.map((v) => ({ ...v, source }))}
                renderItem={(it) => <YouTubeCard item={it} source={source} width={ROW_CARD_W} showChannel={false} />}
                titlePrefix={
                  g.thumbnail ? (
                    <Box component="img" src={g.thumbnail} alt="" loading="lazy"
                      sx={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }} />
                  ) : (
                    <Box sx={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, color: '#fff',
                      background: `linear-gradient(135deg, hsl(${hue(g.title)},55%,45%), hsl(${hue(g.title)},55%,28%))`,
                    }}>{initials(g.title)}</Box>
                  )
                }
                action={
                  <Box onClick={viewAll} sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
                    <Typography sx={{ fontSize: 13, fontWeight: 600 }}>View all</Typography>
                    <ChevronRightIcon sx={{ fontSize: 20 }} />
                  </Box>
                }
              />
            );
          })}
        </Box>
      )}
      </Box>
    </AppShell>
  );
}
