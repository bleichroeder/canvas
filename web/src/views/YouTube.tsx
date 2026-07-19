import { useEffect, useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import SubscriptionsOutlinedIcon from '@mui/icons-material/SubscriptionsOutlined';
import { api, type YoutubeFollow } from '../api';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { YouTubeCard } from '../components/YouTubeCard';
import { SectionHeading } from '../components/SectionHeading';
import { EmptyState } from '../components/EmptyState';
import type { Item } from '../types';

interface Props { source: string }

const YT_CARD_W = 300;
const followLibId = (f: YoutubeFollow) => `${f.kind === 'channel' ? 'c' : 'p'}:${f.ytId}`;

export function YouTube({ source }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  const [follows, setFollows] = useState<YoutubeFollow[]>([]);
  const [railItems, setRailItems] = useState<Record<number, (Item & { source: string })[]>>({});
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const loadFollows = useCallback(async () => {
    const list = await api.youtubeFollows.list();
    setFollows(list);
    for (const f of list) {
      api.library(source, followLibId(f))
        .then((res) => setRailItems((prev) => ({ ...prev, [f.id]: res.items.map((i) => ({ ...i, source })) })))
        .catch(() => { /* a single rail failing is non-fatal */ });
    }
  }, [source]);

  useEffect(() => { void loadFollows(); }, [loadFollows]);

  // Debounced live search — no submit/ENTER (there's no good Enter key in the car).
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
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q, source]);

  const isSearching = q.trim().length >= 2;

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const url = addUrl.trim();
    if (!url) return;
    setAdding(true);
    setError('');
    try {
      await api.youtubeFollows.add({ url });
      setAddUrl('');
      await loadFollows();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function onUnfollow(id: number) {
    await api.youtubeFollows.remove(id).catch(() => {});
    setFollows((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        <Typography variant="h1" sx={{ px: 2.5, mb: 2 }}>YouTube</Typography>

        <Box sx={{ px: 2.5, maxWidth: 620 }}>
          <TextField
            fullWidth placeholder="Search YouTube…"
            value={q} onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
              endAdornment: searching ? <CircularProgress size={18} /> : undefined,
            }}
          />
        </Box>

        {error && <Alert severity="error" sx={{ mx: 2.5, mt: 2 }}>{error}</Alert>}

        {isSearching ? (
          <Box sx={{ mt: 2.5, px: 2.5, opacity: searching ? 0.5 : 1, transition: 'opacity 100ms' }}>
            {results.length === 0 && !searching ? (
              <EmptyState icon={<SearchOffOutlinedIcon />} title={`No results for "${q.trim()}"`} />
            ) : (
              <Box sx={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${YT_CARD_W}px)`, gap: 3 }}>
                {results.map((it) => <YouTubeCard key={it.id} item={it} source={source} width={YT_CARD_W} />)}
              </Box>
            )}
          </Box>
        ) : (
          <>
            <SectionHeading title="Your channels & playlists" sx={{ mt: 3, mb: 1 }} />
            <Box component="form" onSubmit={onAdd} sx={{ px: 2.5, mb: 1, display: 'flex', gap: 1, maxWidth: 620 }}>
              <TextField
                fullWidth size="small" placeholder="Paste a channel or playlist URL…"
                value={addUrl} onChange={(e) => setAddUrl(e.target.value)}
              />
              <Button type="submit" variant="contained" disabled={adding || !addUrl.trim()}>
                {adding ? <CircularProgress size={18} /> : 'Follow'}
              </Button>
            </Box>

            {follows.length === 0 ? (
              <EmptyState
                icon={<SubscriptionsOutlinedIcon />}
                title="No channels followed yet"
                body="Paste a YouTube channel or playlist URL above, or search to find something to play."
              />
            ) : (
              follows.map((f) => (
                <Rail
                  key={f.id}
                  title={f.title}
                  items={railItems[f.id] ?? []}
                  cardWidth={YT_CARD_W}
                  renderItem={(it) => <YouTubeCard item={it} source={source} width={YT_CARD_W} />}
                  action={
                    <IconButton size="small" aria-label={`Unfollow ${f.title}`} onClick={() => onUnfollow(f.id)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                />
              ))
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
