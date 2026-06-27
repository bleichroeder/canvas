import { render } from 'preact';
import { useRoute, matchRoute } from './router';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

function App() {
  const route = useRoute();
  const routes: Array<[string, (params: Record<string, string>) => preact.JSX.Element]> = [
    ['/', () => <Home />],
    ['/search', () => <SearchView />],
    ['/lib/:src', (p) => <Library source={p.src!} />],
    ['/lib/:src/:libId', (p) => <Library source={p.src!} libraryId={p.libId} />],
    ['/item/:src/:id', (p) => <ItemDetailView source={p.src!} id={p.id!} />],
    ['/play/:src/:id', (p) => <div style={{ padding: 20 }}><h1>Play: {p.src} / {p.id}</h1></div>],
    ['/settings', () => <Settings />],
    ['/settings/pair', () => <div style={{ padding: 20 }}><h1>Pair (TBD)</h1></div>],
    ['/pair', () => <div style={{ padding: 20 }}><h1>Phone pair (TBD)</h1></div>],
  ];

  for (const [pattern, renderFn] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) return renderFn(params);
  }
  return <NotFound />;
}

const root = document.getElementById('app');
if (root) render(<App />, root);
