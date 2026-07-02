import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import { ring, getSessionContext } from '../player/diagnostics';
import type { DiagEvent } from '../player/diagnostics';

interface Props {
  open: boolean;
  onClose: () => void;
  sourceType: string;
}

const KIND_COLOR: Record<string, string> = {
  fetch_start: 'info',
  fetch_chunk: 'default',
  fetch_end: 'info',
  fetch_error: 'error',
  demux_ready: 'success',
  demux_error: 'error',
  video_configure: 'success',
  video_frame: 'default',
  video_error: 'error',
  audio_configure: 'success',
  audio_error: 'error',
  backpressure: 'default',
  queue_snapshot: 'default',
  session_start: 'success',
  user_gesture: 'default',
  stall_detected: 'warning',
  browser_error: 'error',
};

export function DiagnosticsOverlay({ open, onClose, sourceType }: Props) {
  const [snapshot, setSnapshot] = useState<DiagEvent[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!open) return;
    setSnapshot(ring.snapshot());
    const id = setInterval(() => {
      setSnapshot(ring.snapshot());
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  if (!open) return null;

  const ctx = getSessionContext(sourceType);

  const copyJson = async () => {
    const payload = JSON.stringify({ events: snapshot, session: ctx }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Fallback for Tesla / restricted clipboard: create a textarea, select + copy.
      const ta = document.createElement('textarea');
      ta.value = payload;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* nothing else to try */ }
      document.body.removeChild(ta);
    }
  };

  const reversed = snapshot.slice().reverse();

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0,0,0,0.92)',
        color: '#e0e0e0',
        display: 'flex',
        flexDirection: 'column',
        p: 2,
        overflowY: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ color: '#fff' }}>canvas diagnostics</Typography>
        <Box>
          <Button size="small" variant="outlined" onClick={() => void copyJson()} sx={{ mr: 1 }}>Copy JSON</Button>
          <Button size="small" variant="outlined" onClick={onClose}>Dismiss</Button>
        </Box>
      </Box>

      <Box sx={{ mb: 2, opacity: 0.8 }}>
        <div>source: {ctx.sourceType}</div>
        <div>version: {ctx.canvasVersion}</div>
        <div>UA: {ctx.userAgent}</div>
        <div>viewport: {ctx.viewport.w}×{ctx.viewport.h}</div>
        <div>screen: {ctx.screen.w}×{ctx.screen.h}</div>
        <div>network: {ctx.connectionType ?? '?'}</div>
        <div>events buffered: {snapshot.length} (tick {tick})</div>
      </Box>

      <Box sx={{ borderTop: '1px solid #333', pt: 1 }}>
        {reversed.map((e, i) => (
          <Box key={`${e.tsMs}-${i}`} sx={{ display: 'flex', gap: 1, py: 0.25 }}>
            <span style={{ minWidth: 70, opacity: 0.7 }}>[+{(e.tsMs / 1000).toFixed(2)}s]</span>
            <Chip
              size="small"
              label={e.kind}
              color={(KIND_COLOR[e.kind] as never) ?? 'default'}
              sx={{ mr: 1, fontFamily: 'monospace' }}
            />
            <span style={{ opacity: 0.9 }}>{JSON.stringify(e.data)}</span>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
