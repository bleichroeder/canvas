import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { PosterCard } from '../components/PosterCard';
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
        />
        {loading && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>Searching…</Typography>
        )}
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>No results.</Typography>
        )}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 180px)',
            gap: 2.5,
            mt: 2.5,
          }}
        >
          {results.map((it) => (
            <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
          ))}
        </Box>
      </Box>
    </AppShell>
  );
}
