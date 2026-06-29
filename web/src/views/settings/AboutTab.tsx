import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { useAuth } from '../../lib/use-auth';
import { isSupabaseConfigured } from '../../lib/supabase';

export function AboutTab() {
  const auth = useAuth();
  const [diagOpen, setDiagOpen] = useState(false);
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
