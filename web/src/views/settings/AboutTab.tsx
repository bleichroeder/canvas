import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { useAuth } from '../../lib/use-auth';
import { isSupabaseConfigured } from '../../lib/supabase';
import { getCrashLog, clearCrashLog } from '../../lib/crash-telemetry';
import type { CrashRecord } from '../../lib/crash-telemetry';

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
  const auth = useAuth();
  const [diagOpen, setDiagOpen] = useState(false);
  const [crashes, setCrashes] = useState<CrashRecord[]>(() => getCrashLog());
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';
  const cloudConnected = isSupabaseConfigured() && !!auth.user;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <SettingRow label="Version" control={<Typography color="text.secondary">v1.2.0 · build {buildSha}</Typography>} />
        <SettingRow label="Player engine" control={<Typography color="text.secondary">canvas / WebCodecs</Typography>} />
        <SettingRow
          label="Cloud sync"
          divider={false}
          control={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: cloudConnected ? 'success.main' : 'error.main',
                }}
              />
              <Typography color="text.secondary">{cloudConnected ? 'Connected' : 'Not configured'}</Typography>
            </Box>
          }
        />
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
    SUPABASE_CONFIGURED: isSupabaseConfigured(),
    USER_ID: auth.user?.id ?? null,
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
