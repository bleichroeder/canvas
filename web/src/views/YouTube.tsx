import { useEffect, useRef, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import SubscriptionsOutlinedIcon from '@mui/icons-material/SubscriptionsOutlined';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { YouTubeCard } from '../components/YouTubeCard';
import { SectionHeading } from '../components/SectionHeading';
import { EmptyState } from '../components/EmptyState';
import type { Item } from '../types';

interface Props { source: string }

const YT_CARD_W = 300;
const gridSx = { display: 'grid', gridTemplateColumns: `repeat(auto-fill, ${YT_CARD_W}px)`, gap: 3, px: 2.5 } as const;

// Round-robin interleave so the subscriptions grid mixes channels instead of
// showing all of channel A, then all of B (there's no cross-channel date to
// sort by, so interleaving reads better than concatenation).
function interleave(lists: Item[][]): Item[] {
  const out: Item[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]!);
  return out;
}

export function YouTube({ source }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  const [subs, setSubs] = useState<Item[] | null>(null); // null = loading

  const loadSubs = useCallback(async () => {
    const follows = await api.youtubeFollows.list();
    if (follows.length === 0) { setSubs([]); return; }
    const lists = await Promise.all(
      follows.map((f) =>
        api.library(source, `${f.kind === 'channel' ? 'c' : 'p'}:${f.ytId}`)
          .then((r) => r.items.slice(0, 8))
          .catch(() => [] as Item[]),
      ),
    );
    setSubs(interleave(lists));
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
      <Box sx={{ py: 2.5 }}>
        <Typography variant="h1" sx={{ px: 2.5, mb: 2 }}>YouTube</Typography>

        <Box sx={{ px: 2.5, maxWidth: 640 }}>
          <TextField
            fullWidth placeholder="Search YouTube…"
            value={q} onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
              endAdornment: searching ? <CircularProgress size={18} /> : undefined,
            }}
          />
        </Box>

        {isSearching ? (
          <Box sx={{ mt: 2.5, opacity: searching ? 0.5 : 1, transition: 'opacity 120ms' }}>
            {results.length === 0 && !searching ? (
              <EmptyState icon={<SearchOffOutlinedIcon />} title={`No results for "${q.trim()}"`} />
            ) : (
              <Box sx={gridSx}>
                {results.map((it) => <YouTubeCard key={it.id} item={it} source={source} width={YT_CARD_W} />)}
              </Box>
            )}
          </Box>
        ) : (
          <>
            <SectionHeading title="Subscriptions" sx={{ mt: 3, mb: 1.5 }} />
            {subs === null ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>
            ) : subs.length === 0 ? (
              <EmptyState
                icon={<SubscriptionsOutlinedIcon />}
                title="You haven't subscribed to any channels yet"
                body="Search for something to watch, then open a channel and hit Subscribe — its latest videos show up here."
              />
            ) : (
              <Box sx={gridSx}>
                {subs.map((it) => <YouTubeCard key={it.id} item={it} source={source} width={YT_CARD_W} />)}
              </Box>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
