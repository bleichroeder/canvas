import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { ElevatedCard } from '../../components/ElevatedCard';
import { api } from '../../api';
import { reportFatal } from '../../player/diagnostics';

type Row = {
  id: string;
  created_at: number;
  error_kind: string | null;
  error_message: string | null;
  source_type: string | null;
  canvas_version: string | null;
  user_agent: string | null;
};

type Detail = {
  id: string;
  created_at: number;
  error_message: string | null;
  error_kind: string | null;
  source_type: string | null;
  canvas_version: string | null;
  user_agent: string | null;
  report_json: string;
};

const KINDS = ['fetch', 'video', 'audio', 'demux', 'browser'] as const;

export function DiagnosticsTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function load(reset: boolean) {
    setLoading(true);
    try {
      const res = await api.adminTelemetry.list({
        cursor: reset ? undefined : nextCursor ?? undefined,
        kind: kind ?? undefined,
        since: since ?? undefined,
      });
      setRows((prev) => (reset ? res.rows : [...prev, ...res.rows]));
      setNextCursor(res.nextCursor);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, since]);

  function testTelemetry() {
    // Call reportFatal directly so the button exercises the full end-to-end
    // pipeline: ring snapshot → POST /api/telemetry/error → stored in DB →
    // visible in this list after a refresh.
    void reportFatal(
      { message: 'canvas: test telemetry ping', kind: 'browser' },
      'test',
    );
  }

  async function del(id: string) {
    if (!confirm('Delete this report?')) return;
    await api.adminTelemetry.delete(id);
    setDetail(null);
    void load(true);
  }

  const openDetail = async (id: string) => {
    const d = await api.adminTelemetry.get(id);
    setDetail(d);
  };

  return (
    <ElevatedCard>
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">Diagnostics</Typography>
          <Button size="small" variant="outlined" onClick={testTelemetry}>Test telemetry</Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Chip
            label="All"
            onClick={() => setKind(null)}
            color={kind === null ? 'primary' : 'default'}
            size="small"
          />
          {KINDS.map((k) => (
            <Chip
              key={k}
              label={k}
              onClick={() => setKind(k)}
              color={kind === k ? 'primary' : 'default'}
              size="small"
            />
          ))}
          <Box sx={{ ml: 2 }}>Since:</Box>
          {[
            { label: '24h', ms: 86_400_000 },
            { label: '7d', ms: 7 * 86_400_000 },
            { label: '30d', ms: 30 * 86_400_000 },
            { label: 'All', ms: null },
          ].map((s) => (
            <Chip
              key={s.label}
              label={s.label}
              size="small"
              onClick={() => setSince(s.ms == null ? null : Date.now() - s.ms)}
              color={
                (s.ms == null && since === null) ||
                (s.ms != null && since != null && Math.abs(since - (Date.now() - s.ms)) < 60_000)
                  ? 'primary'
                  : 'default'
              }
            />
          ))}
        </Box>

        {rows.length === 0 ? (
          <Typography color="text.secondary">
            No error reports yet. The player emits one on any fatal — try the Test telemetry button.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>UA</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id} hover onClick={() => void openDetail(r.id)} sx={{ cursor: 'pointer' }}>
                  <TableCell>{new Date(r.created_at).toLocaleString()}</TableCell>
                  <TableCell><Chip size="small" label={r.error_kind ?? 'unknown'} /></TableCell>
                  <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.error_message}
                  </TableCell>
                  <TableCell>{r.source_type ?? '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.user_agent ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {nextCursor && (
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
            <Button onClick={() => void load(false)} disabled={loading}>Load more</Button>
          </Box>
        )}

        <Drawer
          anchor="right"
          open={detail !== null}
          onClose={() => setDetail(null)}
          PaperProps={{ sx: { width: 600, p: 3 } }}
        >
          {detail && (() => {
            let parsed: { events: Array<{ tsMs: number; kind: string; data: unknown }>; session: Record<string, unknown> } | null = null;
            try { parsed = JSON.parse(detail.report_json); } catch { /* ignore */ }
            const events = parsed?.events ?? [];
            const session = parsed?.session ?? {};
            return (
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6">{detail.error_message}</Typography>
                    <Typography variant="caption">
                      {detail.error_kind} · {new Date(detail.created_at).toLocaleString()}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => void navigator.clipboard.writeText(detail.report_json)}
                  >
                    Copy JSON
                  </Button>
                </Box>

                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Session</Typography>
                <Box sx={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.9 }}>
                  {Object.entries(session).map(([k, v]) => (
                    <div key={k}>{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                  ))}
                </Box>

                <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Events</Typography>
                <Box sx={{ fontFamily: 'monospace', fontSize: 11 }}>
                  {events.slice().reverse().map((e, i) => (
                    <Box key={i} sx={{ py: 0.25 }}>
                      <span style={{ opacity: 0.7 }}>[+{(e.tsMs / 1000).toFixed(2)}s]</span>{' '}
                      <strong>{e.kind}</strong>{' '}
                      <span style={{ opacity: 0.8 }}>{JSON.stringify(e.data)}</span>
                    </Box>
                  ))}
                </Box>

                <Button
                  size="small"
                  color="error"
                  onClick={() => void del(detail.id)}
                  sx={{ mt: 3 }}
                >
                  Delete report
                </Button>
              </Box>
            );
          })()}
        </Drawer>
      </Box>
    </ElevatedCard>
  );
}
