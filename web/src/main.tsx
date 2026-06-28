import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Fade from '@mui/material/Fade';
import { theme } from './theme';
import { useRoute, matchRoute } from './router';
import { Home } from './views/Home';
import { SourceHome } from './views/SourceHome';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';
import { Pair } from './views/Pair';
import { PhonePair } from './views/PhonePair';
import { Player } from './views/Player';
import { NowPlayingStrip } from './components/NowPlayingStrip';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

function App() {
  const route = useRoute();

  useEffect(() => {
    const t = setTimeout(() => {
      window.dispatchEvent(new Event('canvas:ready'));
    }, 400);
    return () => clearTimeout(t);
  }, []);

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
  ];

  let element: React.JSX.Element = <NotFound />;
  for (const [pattern, renderFn] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) { element = renderFn(params); break; }
  }

  return (
    <>
      <Fade in key={route.path} timeout={250}>
        <div>{element}</div>
      </Fade>
      <NowPlayingStrip />
    </>
  );
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
