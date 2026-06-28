import { type ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import { useRoute, navigate } from '../router';
import { RouteBreadcrumbs } from './Breadcrumbs';
import { useNowPlaying } from './NowPlayingStrip';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const route = useRoute();
  const isHome = route.path === '/';
  const nowPlaying = useNowPlaying();
  // Reserve space at the bottom when the now-playing strip is mounted so
  // content can scroll past it instead of being clipped underneath.
  const mainPaddingBottom = nowPlaying ? '108px' : 0;

  const onBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  };

  return (
    <Box>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'background.default',
        }}
      >
        <Toolbar variant="dense" sx={{ minHeight: 56, gap: 1 }}>
          {!isHome && (
            <IconButton onClick={onBack} edge="start" aria-label="back">
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            variant="h2"
            component="a"
            href="#/"
            onClick={(e) => { e.preventDefault(); navigate('/'); }}
            sx={{
              fontSize: 24, fontWeight: 500, letterSpacing: '1px',
              color: 'text.primary', textDecoration: 'none', cursor: 'pointer',
              mr: 'auto',
            }}
          >
            canvas
          </Typography>
          <IconButton onClick={() => navigate('/search')} aria-label="search">
            <SearchIcon />
          </IconButton>
          <IconButton onClick={() => navigate('/settings')} aria-label="settings">
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <RouteBreadcrumbs />
      <Box component="main" sx={{ pb: mainPaddingBottom }}>{children}</Box>
    </Box>
  );
}
