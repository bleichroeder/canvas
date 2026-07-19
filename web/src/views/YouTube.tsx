import { useEffect, useState, useCallback } from 'react';
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
import { api, type YoutubeFollow } from '../api';
import { AppShell } from '../components/AppShell';
import { YouTubeCard } from '../components/YouTubeCard';
import { SectionHeading } from '../components/SectionHeading';
import { EmptyState } from '../components/EmptyState';
import SubscriptionsOutlinedIcon from '@mui/icons-material/SubscriptionsOutlined';
import type { Item } from '../types';

interface Props { source: string }

const followLibId = (f: YoutubeFollow) => `${f.kind === 'channel' ? 'c' : 'p'}:${f.ytId}`;

// Horizontal scroller of YouTube (16:9) cards — the app's Rail is hardcoded to
// the 2:3 PosterCard, so YouTube rows use their own scroller.
function CardRow({ items, source }: { items: Item[]; source: string }) {
  if (items.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', px: 2.5, py: 1, '&::-webkit-scrollbar': { display: 'none' } }}>
      {items.map((it) => <YouTubeCard key={it.id} item={it} source={source} />)}
    </Box>
  );
}

export function YouTube({ source }: Props) {
  const [follows, setFollows] = useState<YoutubeFollow[]>([]);
  const [railItems, setRailItems] = useState<Record<number, Item[]>>({});
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [addUrl, setAddUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const loadFollows = useCallback(async () => {
    const list = await api.youtubeFollows.list();
    setFollows(list);
    for (const f of list) {
      api.library(source, followLibId(f))
        .then((res) => setRailItems((prev) => ({ ...prev, [f.id]: res.items })))
        .catch(() => { /* a single rail failing is non-fatal */ });
    }
  }, [source]);

  useEffect(() => { void loadFollows(); }, [loadFollows]);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    setError('');
    try {
      const { hits } = await api.search(q);
      setResults(hits.filter((h) => h.source === source));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

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

        {/* Search */}
        <Box component="form" onSubmit={onSearch} sx={{ px: 2.5, mb: 1, maxWidth: 620 }}>
          <TextField
            fullWidth size="small" placeholder="Search YouTube…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
              endAdornment: searching ? <CircularProgress size={18} /> : undefined,
            }}
          />
        </Box>

        {error && <Alert severity="error" sx={{ mx: 2.5, my: 1 }}>{error}</Alert>}

        {results !== null && (
          <Box component="section" sx={{ mb: 3 }}>
            <SectionHeading title={`Results for "${query.trim()}"`} sx={{ mt: 2, mb: 1 }} />
            {results.length === 0
              ? <Typography color="text.secondary" sx={{ px: 2.5 }}>No results.</Typography>
              : <CardRow items={results} source={source} />}
          </Box>
        )}

        {/* Followed channels & playlists */}
        <SectionHeading title="Your channels & playlists" sx={{ mt: 3, mb: 1 }} />
        <Box component="form" onSubmit={onAdd} sx={{ px: 2.5, mb: 2, display: 'flex', gap: 1, maxWidth: 620 }}>
          <TextField
            fullWidth size="small" placeholder="Paste a channel or playlist URL to follow…"
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
            <Box component="section" key={f.id} sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', px: 2.5, mt: 3, mb: 0.5 }}>
                <Typography variant="h3" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.title}
                </Typography>
                <IconButton size="small" aria-label={`Unfollow ${f.title}`} onClick={() => onUnfollow(f.id)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              <CardRow items={railItems[f.id] ?? []} source={source} />
            </Box>
          ))
        )}
      </Box>
    </AppShell>
  );
}
