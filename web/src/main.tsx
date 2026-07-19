import { installGlobalErrorHandlers } from './player/diagnostics';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

installGlobalErrorHandlers();
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Fade from '@mui/material/Fade';
import { theme } from './theme';
import { useRoute, matchRoute, navigate } from './router';
import { getUser, clearSession } from './lib/session';
import { SourcesProvider, useSources } from './lib/SourcesContext';
import { Home } from './views/Home';
import { SourceHome } from './views/SourceHome';
import { YouTube } from './views/YouTube';
import { YouTubeChannel } from './views/YouTubeChannel';
import { YouTubeWatch } from './views/YouTubeWatch';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';
import { Pair } from './views/Pair';
import { PhonePair } from './views/PhonePair';
import { PlayerHost } from './components/PlayerHost';
import { openPlayer, setPlayerMode, getPlayerSession } from './lib/player-session';
import { Claim } from './views/Claim';
import { SignIn } from './views/SignIn';
import { SetPassword } from './views/SetPassword';
import { Setup } from './views/Setup';
import { Users } from './views/Users';
import { Devices } from './views/Devices';
import { NowPlayingStrip } from './components/NowPlayingStrip';
import { DrivingDisclaimer } from './components/DrivingDisclaimer';
import { checkForPreviousCrash } from './lib/crash-telemetry';
import { api } from './api';

// Routes a source card to its type-specific page: YouTube gets a dedicated
// search + followed-feed page; personal-media sources use SourceHome.
function SourceRoute({ source }: { source: string }) {
  const { sources } = useSources();
  return sources[source]?.type === 'youtube'
    ? <YouTube source={source} />
    : <SourceHome source={source} />;
}

// Detect renderer-killed-mid-playback once at cold load. Logs to console and
// appends to canvas.crashLog (surfaced in Settings → About → Diagnostics).
const previousCrash = checkForPreviousCrash();
if (previousCrash) {
  console.warn('[canvas] previous player session crashed:', previousCrash);
}

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

// The /play route no longer mounts the player itself (it lives in PlayerHost,
// above the router, so it survives navigation). This just drives the session:
// open the item full-screen on entry, and dock it to a mini player when the
// user navigates away while it's still playing.
function PlayerRoute({ source, id }: { source: string; id: string }) {
  const route = useRoute();
  const raw = route.query.from;
  const fromSec = raw !== undefined && Number.isFinite(Number(raw)) ? Math.max(0, Math.floor(Number(raw))) : 0;
  useEffect(() => {
    openPlayer(source, id, { fromSec, mode: 'full' });
    return () => {
      const s = getPlayerSession();
      if (s && s.source === source && s.id === id) setPlayerMode('mini');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);
  return null;
}

// Routes accessible without a canvas account. /pair is the phone-side
// helper for the Tesla's QR — anyone holding the short-lived pair code is
// authorized for THAT pairing. /claim and /sign-in are auth entry points.
// /set-password is public so newly-claimed users can set their password
// before the session fully resolves. /setup is the first-run wizard.
const PUBLIC_ROUTES = new Set(['/claim', '/sign-in', '/set-password', '/pair', '/setup']);

function App() {
  const route = useRoute();
  const user = getUser();
  const isPublicRoute = PUBLIC_ROUTES.has(route.path);
  const needsSignInRedirect = !isPublicRoute && !user;
  // Authenticated user without a password must finish setup before going anywhere else.
  const needsSetPasswordRedirect = !!user && !user.hasPassword && route.path !== '/set-password';
  const needsHomeRedirect = (route.path === '/claim' || route.path === '/sign-in' || route.path === '/setup') && !!user && user.hasPassword;
  // Keep old alias for clarity in effects below.
  const needsClaimRedirect = needsSignInRedirect;

  // First-run detection: if unauthenticated, probe setup status to decide
  // whether to redirect to /#/setup or /#/sign-in. Only runs once on load.
  const [setupChecked, setSetupChecked] = useState(false);

  // Defer the entire route render until the splash leaves the DOM. Without
  // this, the Claim form mounts behind the splash and password-manager
  // extensions attach their autofill UI to the inputs — those icons render
  // outside the React tree and bleed through the splash. The splash
  // dispatches 'canvas:splashGone' from index.html when it removes itself.
  const [splashGone, setSplashGone] = useState(() =>
    typeof document !== 'undefined' && !document.getElementById('canvas-splash'),
  );
  useEffect(() => {
    if (splashGone) return;
    const onGone = () => setSplashGone(true);
    window.addEventListener('canvas:splashGone', onGone);
    // Catch the case where the splash was removed between initial-state
    // computation and effect setup (rare; defensive).
    if (!document.getElementById('canvas-splash')) setSplashGone(true);
    return () => window.removeEventListener('canvas:splashGone', onGone);
  }, [splashGone]);

  useEffect(() => {
    // The index.html splash holds the screen until 'canvas:ready' fires.
    // /claim and /pair don't depend on auth; dispatch immediately.
    window.dispatchEvent(new Event('canvas:ready'));
  }, []);

  // On app load, ALWAYS probe /api/setup/probe. Even when localStorage looks
  // like an authenticated user, the server DB may have been reset (fresh volume,
  // container recreated, etc.) — in that case localStorage is stale and the
  // wizard needs to run. Skipping the probe when `user` is truthy would strand
  // the user on /sign-in with credentials that no longer exist on the server.
  useEffect(() => {
    if (route.path === '/setup') {
      // Already on setup — no probe needed, no redirect.
      setSetupChecked(true);
      return;
    }
    let cancelled = false;
    api.setupProbe().then((res) => {
      if (cancelled) return;
      if (res.setupRequired) {
        // Wipe any stale localStorage session — server has no matching admin.
        clearSession();
        navigate('/setup');
      }
      setSetupChecked(true);
    }).catch(() => {
      if (cancelled) return;
      // Probe failed (server unreachable, etc.) — fall through to normal auth flow.
      setSetupChecked(true);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally run once on mount only.

  useEffect(() => {
    if (needsClaimRedirect) navigate('/sign-in');
    else if (needsSetPasswordRedirect) navigate('/set-password');
    else if (needsHomeRedirect) navigate('/');
  }, [needsClaimRedirect, needsSetPasswordRedirect, needsHomeRedirect]);

  const routes: Array<[string, (params: Record<string, string>) => React.JSX.Element]> = [
    ['/', () => <Home />],
    ['/search', () => <SearchView />],
    ['/source/:src', (p) => <SourceRoute source={p.src!} />],
    ['/yt/:src/channel/:cid', (p) => <YouTubeChannel source={p.src!} channelId={p.cid!} />],
    ['/yt/:src/watch/:id', (p) => <YouTubeWatch source={p.src!} id={p.id!} />],
    ['/lib/:src', (p) => <Library source={p.src!} />],
    ['/lib/:src/:libId', (p) => <Library source={p.src!} libraryId={p.libId} />],
    ['/item/:src/:id', (p) => <ItemDetailView source={p.src!} id={p.id!} />],
    ['/play/:src/:id', (p) => <PlayerRoute source={p.src!} id={p.id!} />],
    ['/settings', () => <Settings />],
    ['/settings/pair', () => <Pair />],
    ['/settings/users', () => <Users />],
    ['/settings/devices', () => <Devices />],
    ['/pair', () => <PhonePair />],
    ['/claim', () => <Claim />],
    ['/sign-in', () => <SignIn />],
    ['/set-password', () => <SetPassword />],
    ['/setup', () => <Setup />],
  ];

  // While the splash is still up, don't mount the visible tree.
  if (!splashGone) return null;
  // Hold render while unauthenticated and the probe hasn't resolved yet,
  // to avoid flashing /sign-in before the /setup redirect fires.
  if (!user && !setupChecked) return null;
  // During the brief window after redirect fires but before the hash update lands.
  if (needsClaimRedirect || needsSetPasswordRedirect || needsHomeRedirect) return null;

  let element: React.JSX.Element = <NotFound />;
  for (const [pattern, renderFn] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) { element = renderFn(params); break; }
  }

  const inner = (
    <>
      <Fade in key={route.path} timeout={250}>
        <div>{element}</div>
      </Fade>
      {/* Persistent player — above the routed tree so it survives navigation
          (enables the docked mini-player and the YouTube watch embed). */}
      <PlayerHost />
      <NowPlayingStrip />
      <DrivingDisclaimer isPublicRoute={isPublicRoute} />
    </>
  );

  // Only mount SourcesProvider when the user is authenticated so the initial
  // api.listSources() call has a bearer token to send. Public routes (/claim,
  // /pair) never need source data.
  if (!isPublicRoute && user) {
    return <SourcesProvider>{inner}</SourcesProvider>;
  }
  return inner;
}

const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}
