import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Button from '@mui/material/Button';
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import DevicesOutlinedIcon from '@mui/icons-material/DevicesOutlined';
import { useTheme } from '@mui/material/styles';
import { AppShell } from '../components/AppShell';
import { useRoute, navigate } from '../router';
import { getUser } from '../lib/session';
import { AccountTab } from './settings/AccountTab';
import { SourcesTab } from './settings/SourcesTab';
import { PlaybackTab } from './settings/PlaybackTab';
import { AboutTab } from './settings/AboutTab';
import { DeploymentTab } from './settings/DeploymentTab';
import { DiagnosticsTab } from './settings/DiagnosticsTab';

type TabId = 'account' | 'sources' | 'playback' | 'about' | 'deployment' | 'diagnostics';
const TAB_IDS: readonly TabId[] = ['account', 'sources', 'playback', 'about', 'deployment', 'diagnostics'] as const;

export function Settings() {
  const theme = useTheme();
  const route = useRoute();
  const user = getUser();
  const isAdmin = user?.role === 'admin';

  // Allow deep-links to a specific tab via /settings?tab=sources (e.g. from
  // Home's unavailable-source FAB). Unknown values fall back to 'account'.
  const initialTab: TabId =
    TAB_IDS.includes(route.query.tab as TabId) ? (route.query.tab as TabId) : 'account';
  const [tab, setTab] = useState<TabId>(initialTab);

  return (
    <AppShell>
      <Box
        sx={{
          minHeight: '100vh',
          backgroundImage: theme.canvasAmbient,
        }}
      >
        <Box sx={{ px: 2.5, pt: 2.5, pb: 1, maxWidth: 760, mx: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h1">Settings</Typography>
            <Box sx={{ display: 'flex', gap: 1, pt: 0.5 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<DevicesOutlinedIcon />}
                onClick={() => navigate('/settings/devices')}
                sx={{ textTransform: 'none', fontWeight: 500 }}
              >
                Devices
              </Button>
              {isAdmin && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<PeopleOutlinedIcon />}
                  onClick={() => navigate('/settings/users')}
                  sx={{ textTransform: 'none', fontWeight: 500 }}
                >
                  Users
                </Button>
              )}
            </Box>
          </Box>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as TabId)}
            sx={{
              borderBottom: '1px solid',
              borderColor: 'divider',
              minHeight: 52,
              '& .MuiTab-root': {
                minHeight: 52,
                px: 2,
                fontWeight: 500,
                textTransform: 'none',
                fontSize: 15,
              },
              '& .MuiTabs-indicator': {
                height: 2,
                backgroundColor: 'primary.main',
              },
            }}
          >
            <Tab label="Account" value="account" />
            <Tab label="Sources" value="sources" />
            <Tab label="Playback" value="playback" />
            <Tab label="About" value="about" />
            {isAdmin && <Tab label="Deployment" value="deployment" />}
            {isAdmin && <Tab label="Diagnostics" value="diagnostics" />}
          </Tabs>
        </Box>
        <Box sx={{ px: 2.5, pt: 3, pb: 6, maxWidth: 760, mx: 'auto' }}>
          {tab === 'account' && <AccountTab />}
          {tab === 'sources' && <SourcesTab />}
          {tab === 'playback' && <PlaybackTab />}
          {tab === 'about' && <AboutTab />}
          {tab === 'deployment' && isAdmin && <DeploymentTab />}
          {tab === 'diagnostics' && isAdmin && <DiagnosticsTab />}
        </Box>
      </Box>
    </AppShell>
  );
}
