import { useEffect, useState, type ReactNode } from 'react';
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
  heroHeight?: number;
}

export function AppShell({ children, heroHeight }: AppShellProps) {
  const route = useRoute();
  const isHome = route.path === '/';
  const nowPlaying = useNowPlaying();
  const mainPaddingBottom = nowPlaying ? '108px' : 0;

  // When a hero is present, top bar starts transparent and solidifies once
  // the user scrolls past it. Without a hero, the bar is always solid.
  const [pastHero, setPastHero] = useState(heroHeight === undefined);

  useEffect(() => {
    if (heroHeight === undefined) { setPastHero(true); return; }
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPastHero(window.scrollY > heroHeight - 56);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [heroHeight]);

  const onBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  };

  return (
    <Box>
      <AppBar
        position="fixed"
        color="default"
        elevation={0}
        sx={(theme) => ({
          // Over a hero we keep a "smoked glass" background so the chrome
          // stays visibly anchored — full transparency reads as broken when
          // the hero artwork is busy. Past the hero we go to near-opaque.
          backgroundColor: pastHero ? 'rgba(14,15,18,0.92)' : 'rgba(14,15,18,0.55)',
          borderBottom: '1px solid',
          borderColor: pastHero ? 'divider' : 'transparent',
          transition: `background-color ${theme.canvasMotion.med} ${theme.canvasMotion.easing}, border-color ${theme.canvasMotion.med} ${theme.canvasMotion.easing}`,
          backgroundImage: 'none',
        })}
      >
        <Toolbar variant="dense" sx={{ minHeight: 56, gap: 1.5, px: { xs: 2, sm: 2 } }}>
          {!isHome && (
            <IconButton
              onClick={onBack}
              edge="start"
              aria-label="back"
              sx={{ width: 48, height: 48 }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            variant="h2"
            component="a"
            href="#/"
            onClick={(e) => { e.preventDefault(); navigate('/'); }}
            sx={{
              fontSize: 24, fontWeight: 500, letterSpacing: '1.5px',
              color: 'text.primary', textDecoration: 'none', cursor: 'pointer',
            }}
          >
            <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
            canvas
            <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', ml: 1 }}>
            <RouteBreadcrumbs />
          </Box>
          <IconButton onClick={() => navigate('/search')} aria-label="search" sx={{ width: 48, height: 48 }}>
            <SearchIcon />
          </IconButton>
          <IconButton onClick={() => navigate('/settings')} aria-label="settings" sx={{ width: 48, height: 48 }}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Toolbar variant="dense" sx={{ minHeight: 56 }} />
      <Box component="main" sx={{ pb: mainPaddingBottom }}>{children}</Box>
    </Box>
  );
}
