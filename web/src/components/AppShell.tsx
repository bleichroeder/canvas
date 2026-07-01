import { useEffect, useState, useRef, type ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { useRoute, navigate } from '../router';
import { RouteBreadcrumbs } from './Breadcrumbs';
import { useNowPlaying } from './NowPlayingStrip';
import { getUser } from '../lib/session';
import { api } from '../api';

interface AppShellProps {
  children: ReactNode;
  heroHeight?: number;
}

// Poll deployment status every 30 seconds (admin only). Only shows a banner
// when status === 'failed'; all other states are silent. The banner links to
// /settings/deployment so the admin can investigate and fix.
function useDeploymentFailedBanner(): string | null {
  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    async function check() {
      try {
        const status = await api.deploymentStatus();
        if (!cancelled) {
          setFailedMessage(status.status === 'failed' ? status.statusMessage ?? 'Unknown deployment error.' : null);
        }
      } catch {
        // Ignore — network blip, don't clear an existing banner
      }
      if (!cancelled) {
        timerRef.current = setTimeout(() => { void check(); }, 30_000);
      }
    }

    void check();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once per AppShell mount; isAdmin is stable for a session

  return isAdmin ? failedMessage : null;
}

export function AppShell({ children, heroHeight }: AppShellProps) {
  const route = useRoute();
  const isHome = route.path === '/';
  const nowPlaying = useNowPlaying();
  const mainPaddingBottom = nowPlaying ? '108px' : 0;
  const deploymentFailedMessage = useDeploymentFailedBanner();

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
      {/* Spacer that accounts for the fixed AppBar height */}
      <Toolbar variant="dense" sx={{ minHeight: 56 }} />
      {/* Deployment failure banner — admin-only, only shown when status === 'failed' */}
      {deploymentFailedMessage && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2.5,
            py: 1,
            bgcolor: 'error.dark',
            color: '#fff',
            fontSize: 14,
            lineHeight: 1.5,
            flexWrap: 'wrap',
          }}
        >
          <ErrorOutlineIcon fontSize="small" sx={{ flexShrink: 0 }} />
          <Typography variant="body2" component="span" sx={{ color: '#fff', flex: 1 }}>
            <strong>Deployment error:</strong> {deploymentFailedMessage}
          </Typography>
          <Box
            component="button"
            onClick={() => navigate('/settings?tab=deployment')}
            sx={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.35)',
              borderRadius: 1,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              px: 1.5,
              py: 0.5,
              flexShrink: 0,
              '&:hover': { background: 'rgba(255,255,255,0.25)' },
            }}
          >
            Fix in Settings → Deployment
          </Box>
        </Box>
      )}
      <Box component="main" sx={{ pb: mainPaddingBottom }}>{children}</Box>
    </Box>
  );
}
