import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { useTheme } from '@mui/material/styles';
import { AppShell } from '../components/AppShell';
import { useRoute } from '../router';
import { AccountTab } from './settings/AccountTab';
import { SourcesTab } from './settings/SourcesTab';
import { PlaybackTab } from './settings/PlaybackTab';
import { AboutTab } from './settings/AboutTab';

type TabId = 'account' | 'sources' | 'playback' | 'about';
const TAB_IDS: readonly TabId[] = ['account', 'sources', 'playback', 'about'] as const;

export function Settings() {
  const theme = useTheme();
  const route = useRoute();
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
          <Typography variant="h1" sx={{ mb: 3 }}>Settings</Typography>
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
          </Tabs>
        </Box>
        <Box sx={{ px: 2.5, pt: 3, pb: 6, maxWidth: 760, mx: 'auto' }}>
          {tab === 'account' && <AccountTab />}
          {tab === 'sources' && <SourcesTab />}
          {tab === 'playback' && <PlaybackTab />}
          {tab === 'about' && <AboutTab />}
        </Box>
      </Box>
    </AppShell>
  );
}
