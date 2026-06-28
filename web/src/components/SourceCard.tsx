import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { api } from '../api';
import type { StoredSource } from '../storage';

export interface SourceCardProps {
  srcKey: string;
  label: string;
  type: StoredSource['type'];
  baseUrl: string;
  onUnpair(): void;
}

const TYPE_COLOR: Record<StoredSource['type'], string> = {
  plex: '#e5a00d',
  jellyfin: '#aa5cc3',
  flixify: '#cc3333',
  generic: '#6b7280',
};

const TYPE_GLYPH: Record<StoredSource['type'], string> = {
  plex: 'P',
  jellyfin: 'J',
  flixify: 'F',
  generic: '·',
};

const DOT_COLOR: Record<string, string> = {
  ok: '#67d391',
  degraded: '#f5a623',
  unreachable: '#ef5350',
  'lan-only': '#6b7280',
  loading: '#6b7280',
};

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SourceCard({ srcKey, label, type, baseUrl, onUnpair }: SourceCardProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'degraded' | 'unreachable' | 'lan-only'>('loading');
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.sourceStatus(srcKey).then(
      (res) => {
        if (cancelled) return;
        setStatus(res.status);
        setLastSeenAt(res.lastSeenAt);
      },
      () => { if (!cancelled) setStatus('unreachable'); },
    );
    return () => { cancelled = true; };
  }, [srcKey]);

  const statusText =
    status === 'loading' ? 'Checking…' :
    status === 'ok' ? `Last seen: ${timeAgo(lastSeenAt)}` :
    status === 'degraded' ? 'Degraded' :
    status === 'unreachable' ? 'Unreachable' :
    'LAN-only — health check unavailable';

  return (
    <>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 2, p: 2,
          backgroundColor: 'background.paper',
          border: '1px solid', borderColor: 'divider',
          borderRadius: 1, mb: 1,
        }}
      >
        <Box
          sx={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: DOT_COLOR[status] ?? DOT_COLOR.loading,
            flexShrink: 0,
          }}
        />
        <Box
          sx={{
            width: 40, height: 40, borderRadius: 1,
            backgroundColor: TYPE_COLOR[type],
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22,
            flexShrink: 0,
          }}
        >
          {TYPE_GLYPH[type]}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {type} · {baseUrl}
          </Typography>
          <Typography variant="caption" color="text.secondary">{statusText}</Typography>
        </Box>
        <Button variant="text" color="error" onClick={() => setConfirmOpen(true)}>Unpair</Button>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Unpair {label}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes {label} from canvas. You can pair again later. Existing playback progress on the source itself is not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" onClick={() => { setConfirmOpen(false); onUnpair(); }}>Unpair</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
