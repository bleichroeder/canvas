import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Fade from '@mui/material/Fade';
import { theme } from './theme';
import { useRoute, matchRoute, navigate } from './router';
import { useAuth } from './lib/use-auth';
import { isSupabaseConfigured } from './lib/supabase';
import { Home } from './views/Home';
import { SourceHome } from './views/SourceHome';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';
import { Pair } from './views/Pair';
import { PhonePair } from './views/PhonePair';
import { Player } from './views/Player';
import { SignIn } from './views/SignIn';
import { NowPlayingStrip } from './components/NowPlayingStrip';
import { CloudSyncConflict } from './components/CloudSyncConflict';
import { DrivingDisclaimer } from './components/DrivingDisclaimer';
import { SourceAddedSnackbar } from './components/SourceAddedSnackbar';
import { startCloudSync } from './lib/cloud-sync';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

// Routes accessible without a canvas account. /pair is the phone-side
// helper for the Tesla's QR — anyone holding the short-lived pair code is
// authorized for THAT pairing; the Tesla's session is what binds the new
// source to a user. /sign-in is the auth entry point itself.
const PUBLIC_ROUTES = new Set(['/sign-in', '/pair']);

function App() {
  const route = useRoute();
  const auth = useAuth();
  const requiresAuth = isSupabaseConfigured() && !PUBLIC_ROUTES.has(route.path);
  const needsSignInRedirect = requiresAuth && !auth.loading && !auth.user;
  // Signed-in users landing on /sign-in (e.g., bookmarked URL, post-OAuth) bounce
  // back to home before the sign-in card has a chance to render.
  const needsHomeRedirect = route.path === '/sign-in' && !auth.loading && !!auth.user;

  useEffect(() => {
    // The index.html splash holds the screen until 'canvas:ready' fires.
    // Public routes (sign-in, pair) don't depend on auth; everything else
    // waits for the initial session check to resolve so signed-in users don't
    // see a sign-in flash. Dispatch immediately — any delay here lets a hash
    // navigation hit a black screen while the timeout is still pending.
    const ready = PUBLIC_ROUTES.has(route.path) || !auth.loading;
    if (!ready) return;
    window.dispatchEvent(new Event('canvas:ready'));
  }, [auth.loading, route.path]);

  useEffect(() => {
    if (needsSignInRedirect) navigate('/sign-in');
    else if (needsHomeRedirect) navigate('/');
  }, [needsSignInRedirect, needsHomeRedirect]);

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
    ['/pair', () => <PhonePair />],
    ['/sign-in', () => <SignIn />],
  ];

  // While auth is resolving on a protected route, render nothing — the
  // index.html splash holds the screen so there's no flash of sign-in UI.
  if (requiresAuth && auth.loading) return null;
  // Likewise during the brief window after redirect fires but before the
  // hash update lands.
  if (needsSignInRedirect || needsHomeRedirect) return null;

  let element: React.JSX.Element = <NotFound />;
  for (const [pattern, renderFn] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) { element = renderFn(params); break; }
  }

  const isPublicRoute = PUBLIC_ROUTES.has(route.path);

  return (
    <>
      <Fade in key={route.path} timeout={250}>
        <div>{element}</div>
      </Fade>
      <NowPlayingStrip />
      <CloudSyncConflict />
      <DrivingDisclaimer isPublicRoute={isPublicRoute} />
      <SourceAddedSnackbar />
    </>
  );
}

// Boot the cloud-sync coordinator once. No-op when Supabase env isn't set.
startCloudSync();

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
