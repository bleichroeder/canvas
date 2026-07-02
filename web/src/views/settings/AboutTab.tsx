import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { getUser } from '../../lib/session';
import { getCrashLog, clearCrashLog } from '../../lib/crash-telemetry';
import { api } from '../../api';
import type { CrashRecord } from '../../lib/crash-telemetry';

// Configure marked once at module load.
marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderReleaseNotes(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function formatTimestamp(ms: number): string {
  try { return new Date(ms).toLocaleString(); } catch { return String(ms); }
}

function CrashRow({ record }: { record: CrashRecord }) {
  const durationSec = Math.max(0, Math.round((record.crashedAt - record.startedAt) / 1000));
  const durationMin = Math.floor(durationSec / 60);
  const durationLabel = durationMin > 0 ? `${durationMin}m ${durationSec % 60}s` : `${durationSec}s`;
  return (
    <Box sx={{ py: 1, borderBottom: '1px solid rgba(255,255,255,0.06)', '&:last-child': { borderBottom: 'none' } }}>
      <Typography sx={{ fontSize: 13, fontWeight: 500 }}>
        {record.source} / {record.id}
      </Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', fontFamily: 'monospace' }}>
        {formatTimestamp(record.crashedAt)} · played {durationLabel}
        {` · pos ${record.posSec}s`}
        {record.heapMB !== undefined && ` · heap ${record.heapMB} MB`}
        {record.droppedFrames !== undefined && record.droppedFrames > 0 && ` · ${record.droppedFrames} frames dropped`}
      </Typography>
    </Box>
  );
}

export function AboutTab() {
  const user = getUser();
  const [diagOpen, setDiagOpen] = useState(false);
  const [crashes, setCrashes] = useState<CrashRecord[]>(() => getCrashLog());
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';
  const canvasVersion = import.meta.env.VITE_CANVAS_VERSION ?? 'dev';

  const [updates, setUpdates] = useState<Awaited<ReturnType<typeof api.adminUpdates.status>> | null>(null);
  const [updatesLoading, setUpdatesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.adminUpdates.status()
      .then((s) => { if (!cancelled) setUpdates(s); })
      .catch(() => { if (!cancelled) setUpdates(null); })
      .finally(() => { if (!cancelled) setUpdatesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <SettingRow label="Version" control={<Typography color="text.secondary">{canvasVersion} · build {buildSha}</Typography>} />
        <SettingRow label="Player engine" control={<Typography color="text.secondary">canvas / WebCodecs</Typography>} />
        <SettingRow
          label="Signed in as"
          divider={false}
          control={
            <Typography color="text.secondary">
              {user ? `${user.label} (${user.role})` : 'Not signed in'}
            </Typography>
          }
        />
      </ElevatedCard>

      <ElevatedCard>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Updates</Typography>

          {updatesLoading && (
            <Typography color="text.secondary">Checking for updates…</Typography>
          )}

          {!updatesLoading && updates?.error && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Update information unavailable — {updates.error}.
            </Alert>
          )}

          {!updatesLoading && updates && !updates.error && (
            <>
              <Typography variant="body2">
                Current: <strong>{updates.currentVersion}</strong>
              </Typography>
              {updates.latestVersion && (
                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  Latest: <strong>{updates.latestVersion}</strong>
                  {updates.publishedAt && ` · published ${relativeTime(updates.publishedAt)}`}
                </Typography>
              )}

              {updates.updateAvailable && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  Watchtower will apply this update within 5 minutes.
                </Alert>
              )}
              {!updates.updateAvailable && updates.latestVersion && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  You're on the latest version.
                </Typography>
              )}

              {updates.releaseNotes && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>What's new</Typography>
                  <Box
                    sx={{
                      '& p': { my: 1 },
                      '& ul, & ol': { pl: 3 },
                      '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontSize: '0.875em' },
                      '& pre': { bgcolor: 'action.hover', p: 1, borderRadius: 1, overflowX: 'auto', fontSize: '0.875em' },
                      '& a': { color: 'primary.main' },
                      fontSize: '0.875rem',
                    }}
                    dangerouslySetInnerHTML={{ __html: renderReleaseNotes(updates.releaseNotes) }}
                  />
                </>
              )}

              {updates.htmlUrl && (
                <Button
                  size="small"
                  variant="text"
                  sx={{ mt: 2 }}
                  component="a"
                  href={updates.htmlUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on GitHub →
                </Button>
              )}
            </>
          )}
        </Box>
      </ElevatedCard>

      {crashes.length > 0 && (
        <ElevatedCard>
          <Box sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Box>
                <Typography sx={{ fontWeight: 500 }}>Recent player crashes</Typography>
                <Typography variant="caption" color="text.secondary">
                  The renderer was killed mid-playback. Most often caused by memory pressure on the Tesla browser.
                </Typography>
              </Box>
              <Button
                size="small"
                variant="text"
                onClick={() => { clearCrashLog(); setCrashes([]); }}
              >
                Clear
              </Button>
            </Box>
            <Box>
              {crashes.map((c, i) => <CrashRow key={`${c.crashedAt}-${i}`} record={c} />)}
            </Box>
          </Box>
        </ElevatedCard>
      )}

      <Accordion
        expanded={diagOpen}
        onChange={(_, expanded) => setDiagOpen(expanded)}
        sx={{
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 1,
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" color="text.secondary">Diagnostics</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            component="pre"
            sx={{
              m: 0, p: 1.5,
              fontFamily: 'monospace', fontSize: 12,
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 1,
              overflow: 'auto',
              color: 'text.secondary',
            }}
          >
{JSON.stringify(
  {
    BUILD_SHA: import.meta.env.VITE_BUILD_SHA ?? 'dev',
    CANVAS_API: import.meta.env.VITE_CANVAS_API ?? 'unset',
    USER_ID: user?.id ?? null,
    USER_ROLE: user?.role ?? null,
  },
  null,
  2,
)}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
