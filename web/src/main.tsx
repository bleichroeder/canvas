import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Fade from '@mui/material/Fade';
import { theme } from './theme';
import { useRoute, matchRoute, navigate } from './router';
import { getUser } from './lib/session';
import { SourcesProvider } from './lib/SourcesContext';
import { Home } from './views/Home';
import { SourceHome } from './views/SourceHome';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';
import { Pair } from './views/Pair';
import { PhonePair } from './views/PhonePair';
import { Player } from './views/Player';
import { Claim } from './views/Claim';
import { Users } from './views/Users';
import { Devices } from './views/Devices';
import { NowPlayingStrip } from './components/NowPlayingStrip';
import { DrivingDisclaimer } from './components/DrivingDisclaimer';
import { checkForPreviousCrash } from './lib/crash-telemetry';

// Detect renderer-killed-mid-playback once at cold load. Logs to console and
// appends to canvas.crashLog (surfaced in Settings → About → Diagnostics).
const previousCrash = checkForPreviousCrash();
if (previousCrash) {
  console.warn('[canvas] previous player session crashed:', previousCrash);
}

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

// Routes accessible without a canvas account. /pair is the phone-side
// helper for the Tesla's QR — anyone holding the short-lived pair code is
// authorized for THAT pairing. /claim is the auth entry point.
const PUBLIC_ROUTES = new Set(['/claim', '/pair']);

function App() {
  const route = useRoute();
  const user = getUser();
  const isPublicRoute = PUBLIC_ROUTES.has(route.path);
  const needsClaimRedirect = !isPublicRoute && !user;
  const needsHomeRedirect = route.path === '/claim' && !!user;

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

  useEffect(() => {
    if (needsClaimRedirect) navigate('/claim');
    else if (needsHomeRedirect) navigate('/');
  }, [needsClaimRedirect, needsHomeRedirect]);

  const routes: Array<[string, (params: Record<string, string>) => React.JSX.Element]> = [
    ['/', () => <Home />],
    ['/search', () => <SearchView />],
    ['/source/:src', (p) => <SourceHome source={p.src!} />],
    ['/lib/:src', (p) => <Library source={p.src!} />],
    ['/lib/:src/:libId', (p) => <Library source={p.src!} libraryId={p.libId} />],
    ['/item/:src/:id', (p) => <ItemDetailView source={p.src!} id={p.id!} />],
    ['/play/:src/:id', (p) => <Player source={p.src!} id={p.id!} />],
    ['/settings', () => <Settings />],
    ['/settings/pair', () => <Pair />],
    ['/settings/users', () => <Users />],
    ['/settings/devices', () => <Devices />],
    ['/pair', () => <PhonePair />],
    ['/claim', () => <Claim />],
  ];

  // While the splash is still up, don't mount the visible tree.
  if (!splashGone) return null;
  // During the brief window after redirect fires but before the hash update lands.
  if (needsClaimRedirect || needsHomeRedirect) return null;

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
