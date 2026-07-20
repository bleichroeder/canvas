import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { YouTubeCard } from '../components/YouTubeCard';
import { EmptyState } from '../components/EmptyState';
import VideocamOffOutlinedIcon from '@mui/icons-material/VideocamOffOutlined';
import { useRoute } from '../router';
import type { Item } from '../types';

interface Props { source: string; channelId: string }

function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '·';
}
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function YouTubeChannel({ source, channelId }: Props) {
  const { query } = useRoute();
  const [title, setTitle] = useState(query.t ?? 'Channel');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [subId, setSubId] = useState<number | null>(null); // follow id when subscribed
  const [avatar, setAvatar] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.library(source, `c:${channelId}`), api.youtubeFollows.list()])
      .then(([lib, follows]) => {
        if (cancelled) return;
        setItems(lib.items);
        const last = lib.breadcrumbs?.[lib.breadcrumbs.length - 1];
        if (last?.name) setTitle(last.name);
        const sub = follows.find((f) => f.kind === 'channel' && f.ytId === channelId);
        setSubId(sub ? sub.id : null);
        setAvatar(sub?.thumbnail ?? null);
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source, channelId]);

  async function toggleSubscribe() {
    setBusy(true);
    setError('');
    try {
      if (subId != null) {
        await api.youtubeFollows.remove(subId);
        setSubId(null);
      } else {
        const f = await api.youtubeFollows.add({ kind: 'channel', ytId: channelId });
        setSubId(f.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const subscribed = subId != null;

  return (
    <AppShell>
      <Box sx={{ py: 2.5, px: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap', mb: 3 }}>
          {avatar ? (
            <Box component="img" src={avatar} alt="" sx={{ width: 88, height: 88, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
          ) : (
            <Box sx={{
              width: 88, height: 88, borderRadius: '50%', display: 'grid', placeItems: 'center',
              fontWeight: 800, fontSize: 32, color: '#fff', flexShrink: 0,
              background: `linear-gradient(135deg, hsl(${hue(title)},55%,45%), hsl(${hue(title)},55%,28%))`,
            }}>
              {initials(title)}
            </Box>
          )}
          <Typography variant="h1" sx={{ m: 0 }}>{title}</Typography>
          <Button
            onClick={toggleSubscribe}
            disabled={busy}
            variant={subscribed ? 'outlined' : 'contained'}
            sx={{
              ml: 'auto', borderRadius: 999, px: 2.75, fontWeight: 700,
              ...(subscribed ? {} : { backgroundColor: '#ff3b3b', '&:hover': { backgroundColor: '#e63535' } }),
            }}
          >
            {busy ? <CircularProgress size={18} color="inherit" /> : subscribed ? 'Subscribed ✓' : 'Subscribe'}
          </Button>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
        ) : items.length === 0 ? (
          <EmptyState icon={<VideocamOffOutlinedIcon />} title="No videos found for this channel" />
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 300px)', gap: 3 }}>
            {items.map((it) => <YouTubeCard key={it.id} item={it} source={source} width={300} showChannel={false} />)}
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
