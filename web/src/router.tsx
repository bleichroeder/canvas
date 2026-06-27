import { useEffect, useState } from 'preact/hooks';

export interface Route {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

function parseHash(): Route {
  const raw = window.location.hash.slice(1) || '/';
  const parts = raw.split('?');
  const pathOnly = parts[0] ?? '/';
  const qs = parts[1] ?? '';
  const query: Record<string, string> = {};
  if (qs) {
    for (const [k, v] of new URLSearchParams(qs)) query[k] = v;
  }
  return { path: pathOnly, params: {}, query };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string): void {
  if (to.startsWith('#')) { window.location.hash = to.slice(1); return; }
  window.location.hash = to;
}

interface LinkProps {
  to: string;
  children: preact.ComponentChildren;
  class?: string;
  style?: preact.JSX.CSSProperties;
}

export function Link({ to, children, class: cls, style }: LinkProps): preact.JSX.Element {
  return (
    <a
      href={`#${to}`}
      class={cls}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// Pattern matching for routes like '/item/:src/:id'
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const pParts = pattern.split('/').filter(Boolean);
  const aParts = path.split('/').filter(Boolean);
  if (pParts.length !== aParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pParts.length; i++) {
    const p = pParts[i]!;
    const a = aParts[i]!;
    if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(a);
    else if (p !== a) return null;
  }
  return params;
}
