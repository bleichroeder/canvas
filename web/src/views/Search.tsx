import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { PosterCard } from '../components/PosterCard';
import { getSourceLabel } from '../storage';
import type { Item } from '../types';

export function SearchView() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { hits } = await api.search(q.trim());
        setResults(hits);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  // Group results by source.
  const grouped = new Map<string, (Item & { source: string })[]>();
  for (const hit of results) {
    const arr = grouped.get(hit.source) ?? [];
    arr.push(hit);
    grouped.set(hit.source, arr);
  }

  return (
    <AppShell>
      <Box sx={{ p: 2.5 }}>
        <TextField
          fullWidth
          autoFocus
          placeholder="Search across your libraries…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
          sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity 100ms' }}
        />
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <EmptyState
            icon={<SearchOffOutlinedIcon />}
            title={`No results for "${q}"`}
          />
        )}
        {q.trim().length < 2 && (
          <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
            Search runs across all paired sources.
          </Typography>
        )}
        <Box sx={{ mt: 2.5, opacity: loading ? 0.5 : 1, transition: 'opacity 100ms' }}>
          {[...grouped.entries()].map(([srcKey, hits]) => (
            <Box key={srcKey} sx={{ mb: 4 }}>
              <Typography variant="h3" sx={{ mb: 1.5 }}>
                {getSourceLabel(srcKey) ?? srcKey}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                  · {hits.length} {hits.length === 1 ? 'result' : 'results'}
                </Typography>
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 180px)',
                  gap: 2.5,
                }}
              >
                {hits.map((it) => (
                  <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </AppShell>
  );
}
