import { render } from 'preact';
import { useRoute, matchRoute } from './router';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

function App() {
  const route = useRoute();

  // Route table. Each entry: [pattern, render(params)].
  const routes: Array<[string, (params: Record<string, string>) => preact.JSX.Element]> = [
    ['/', () => <div style={{ padding: 20 }}><h1>Home (TBD)</h1></div>],
    ['/search', () => <div style={{ padding: 20 }}><h1>Search (TBD)</h1></div>],
    ['/lib/:src', (p) => <div style={{ padding: 20 }}><h1>Library: {p.src}</h1></div>],
    ['/lib/:src/:libId', (p) => <div style={{ padding: 20 }}><h1>Library: {p.src} / {p.libId}</h1></div>],
    ['/item/:src/:id', (p) => <div style={{ padding: 20 }}><h1>Item: {p.src} / {p.id}</h1></div>],
    ['/play/:src/:id', (p) => <div style={{ padding: 20 }}><h1>Play: {p.src} / {p.id}</h1></div>],
    ['/settings', () => <div style={{ padding: 20 }}><h1>Settings (TBD)</h1></div>],
    ['/settings/pair', () => <div style={{ padding: 20 }}><h1>Pair (TBD)</h1></div>],
    ['/pair', () => <div style={{ padding: 20 }}><h1>Phone pair (TBD)</h1></div>],
  ];

  for (const [pattern, render] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) return render(params);
  }
  return <NotFound />;
}

const root = document.getElementById('app');
if (root) render(<App />, root);
