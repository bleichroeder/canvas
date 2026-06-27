# Canvas Plan 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap Preact → React, adopt MUI for components and icons, replace every emoji glyph, add AppShell + Breadcrumbs navigation, rename `passenger` → `canvas` everywhere user-visible. Existing screen *layouts* are preserved; only interactive primitives and chrome change.

**Architecture:** Mechanical framework swap (Preact's JSX is structurally compatible with React's; the dep set changes, the hook imports change, `class` → `className`). MUI `createTheme` centralizes design tokens. Existing inline-style layouts stay; only buttons / inputs / icons / chrome swap to MUI components. New Cloudflare resources are stood up alongside the existing v2 stack — old infra stays live so we can flip back if needed.

**Tech Stack:** React 18, MUI v6 (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`), Inter via `@fontsource/inter`, Vite, TypeScript strict, Cloudflare Workers + KV + Pages, Wrangler v4.

## Global Constraints

- All work on the **`v2` branch**, builds on `094ca35` (canvas UI redesign spec) and `e2a054b` (player polish closure).
- TypeScript strict throughout.
- Tesla MCU3 / Ryzen Chromium is the only supported client.
- Worker uses Vitest for unit tests on **pure logic**. Frontend has **no automated tests** — manual smoke per task.
- **Layouts stay the same** in Plan 1. Only interactive primitives (buttons, inputs, slider) and chrome (Chrome → AppShell) swap to MUI. Per-screen visual redesign is Plan 2; do not preempt it.
- Existing `styles.css` with CSS variables stays in place. Plan 2 replaces it with `sx`-prop theming.
- The repo on-disk dir name stays `C:\github\passenger\` (user preference — bookmarks / IDE paths).
- `bookmarklet/` directory stays untouched in this plan. Plan 3 removes it during cutover.
- New Cloudflare resources stand alongside the old; do **not** delete `passenger-api-v2` or `passenger-v2` Pages project in this plan.

---

## Task 1: Create new Cloudflare resources (USER)

**Files:** none. User-driven step.

**Interfaces:**
- Consumes: existing Wrangler auth on the user's machine.
- Produces:
  - A new KV namespace `CANVAS` with a fresh id.
  - The id, communicated back via the user pasting it to the next-task prompt (used in Task 2's `wrangler.toml`).
  - The user can confirm `canvas` is a free Pages project name at their account (or pick a fallback like `canvas-tv`).

- [ ] **Step 1: Verify Wrangler auth**

```powershell
cd C:\github\passenger\worker
npx wrangler whoami
```

Expected: prints your Cloudflare account email + account id.

- [ ] **Step 2: Create the new KV namespace**

```powershell
npx wrangler kv namespace create CANVAS
```

Expected output includes a line like:

```
[[kv_namespaces]]
binding = "CANVAS"
id = "abc123..."
```

Copy that `id`. You will paste it into `wrangler.toml` in Task 2.

- [ ] **Step 3: Confirm `canvas` Pages project name availability**

Visit `https://dash.cloudflare.com/?to=/:account/pages` in a browser. If there's no project called `canvas`, the deploy in Task 14 will create it. If `canvas` is taken at your account level, pick a fallback name (e.g., `canvas-tv` or `canvas-app`) and use that consistently in subsequent tasks where the brief references `canvas` as a project name.

- [ ] **Step 4: Communicate the KV id**

Reply to the controller with the KV `id` from Step 2 and the Pages project name you'll use (`canvas` or the fallback). No commit yet — Task 2 commits the `wrangler.toml` edit.

---

## Task 2: Worker rename (wrangler.toml + source strings)

**Files:**
- Modify: `worker/wrangler.toml`
- Modify: `worker/src/sources/plex.ts`
- Modify: `worker/src/sources/plex-api.ts`
- Modify: `worker/src/routes/pair-plex-servers.ts`

**Interfaces:**
- Consumes: KV id from Task 1.
- Produces: worker config that deploys as `canvas-api` with KV binding `KV` pointing at the new namespace. `X-Plex-Product` / `X-Plex-Client-Identifier` headers send `canvas` instead of `passenger`.

- [ ] **Step 1: Replace `worker/wrangler.toml`**

Replace its contents with:

```toml
name = "canvas-api"
main = "src/index.ts"
compatibility_date = "2026-06-01"

[[kv_namespaces]]
binding = "KV"
id = "<paste the id from Task 1 Step 2>"
```

The binding name stays `KV` so the worker code doesn't change.

- [ ] **Step 2: Update Plex client identifier in `plex-api.ts`**

Read `C:\github\passenger\worker\src\sources\plex-api.ts`. Find the existing header set:

```typescript
headers.set('X-Plex-Token', ctx.token);
headers.set('Accept', 'application/json');
headers.set('X-Plex-Client-Identifier', 'passenger');
```

Replace the last line with:

```typescript
headers.set('X-Plex-Client-Identifier', 'canvas');
```

- [ ] **Step 3: Update Plex transcoder identifiers in `plex.ts`**

In `worker/src/sources/plex.ts`, find the `resolveStream` method and replace the `URLSearchParams` block. Specifically replace the lines:

```typescript
      'X-Plex-Client-Identifier': 'passenger',
      'X-Plex-Product': 'Passenger',
      'X-Plex-Platform': 'Web',
```

With:

```typescript
      'X-Plex-Client-Identifier': 'canvas',
      'X-Plex-Product': 'Canvas',
      'X-Plex-Platform': 'Web',
```

- [ ] **Step 4: Update pair-plex-servers identifier**

In `worker/src/routes/pair-plex-servers.ts`, find the fetch call to `plex.tv/api/v2/resources` and the `X-Plex-Client-Identifier` header. The value in this route is the user's per-device `clientId` (came from `crypto.randomUUID()` on the phone) — that stays. **Do not change it.** This task only touches strings that say `passenger`.

Verify by searching:

```powershell
cd C:\github\passenger\worker
Select-String -Path src -Pattern "passenger" -SimpleMatch
```

Expected after Step 3: zero matches in `worker/src/`.

- [ ] **Step 5: Typecheck + test**

```powershell
cd C:\github\passenger\worker
npm run typecheck
npm test
```

Both must succeed. Tests should still pass since the rename is to string literals; existing tests don't pin the literal value.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add worker/wrangler.toml worker/src/sources/plex.ts worker/src/sources/plex-api.ts
git commit -m "Worker: rename to canvas-api, X-Plex-Product=Canvas, new KV namespace"
```

---

## Task 3: Frontend dependencies — swap Preact → React + MUI + Inter

**Files:**
- Modify: `web/package.json`
- Modify: `web/tsconfig.json`
- Modify: `web/vite.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a frontend dep set where Preact is gone and React + MUI + Inter are installed. TypeScript and Vite are configured for React JSX. The build will fail until later tasks port the existing components — that's expected at the end of this task.

- [ ] **Step 1: Replace `web/package.json`**

```json
{
  "name": "canvas-web",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "wrangler pages deploy ./dist --project-name=canvas"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.0",
    "wrangler": "^4.105.0"
  },
  "dependencies": {
    "@emotion/react": "^11.13.0",
    "@emotion/styled": "^11.13.0",
    "@fontsource/inter": "^5.0.18",
    "@mui/icons-material": "^6.1.0",
    "@mui/material": "^6.1.0",
    "mp4box": "^0.5.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  }
}
```

(If `--project-name=canvas` was taken at your account, replace with the fallback name from Task 1 Step 3.)

- [ ] **Step 2: Replace `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

The key changes: dropped `jsxImportSource: "preact"`. `jsx: "react-jsx"` now resolves to React's runtime by default.

- [ ] **Step 3: Replace `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const buildSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'audio-worklet': resolve(__dirname, 'src/player/audio-worklet.js'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'audio-worklet'
            ? 'audio-worklet.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
});
```

Dropped: the manual `jsxFactory: 'h'` / `jsxFragment: 'Fragment'` / `jsxInject` config and the `preact/compat` aliases. The new `@vitejs/plugin-react` handles JSX automatically with React.

- [ ] **Step 4: Install**

```powershell
cd C:\github\passenger\web
npm install
```

Expected: completes, ~80 new packages. Plenty of MUI peers / transitives, plus React.

- [ ] **Step 5: Confirm only deps changed**

Don't run `npm run build` yet — the components haven't been ported to React. Just confirm the install succeeded.

```powershell
type package.json | findstr preact
```

Expected: no matches (Preact gone).

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/package.json web/package-lock.json web/tsconfig.json web/vite.config.ts
git commit -m "web: swap Preact deps for React + MUI + Inter; build SHA via Vite define"
```

---

## Task 4: Theme + main entry (React mount + ThemeProvider)

**Files:**
- Create: `web/src/theme.ts`
- Modify: `web/src/main.tsx`
- Modify: `web/index.html`
- Modify: `web/src/vite-env.d.ts`

**Interfaces:**
- Consumes: React, MUI, Inter from Task 3.
- Produces:
  - `theme.ts` exports a single `theme` instance built via `createTheme`.
  - `main.tsx` mounts a React root, wraps the route table in `<ThemeProvider><CssBaseline/>…</ThemeProvider>`.
  - `vite-env.d.ts` adds `VITE_BUILD_SHA` to `ImportMetaEnv`.

- [ ] **Step 1: Create `web/src/theme.ts`**

```typescript
import { createTheme } from '@mui/material/styles';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#0e0f12',
      paper: '#181a1f',
    },
    primary: {
      main: '#4f8ef7',
      dark: '#2d8cff',
    },
    text: {
      primary: '#f4f5f7',
      secondary: '#9aa0a8',
    },
    divider: '#2a2d36',
    error: {
      main: '#ef5350',
    },
    success: {
      main: '#67d391',
    },
  },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
    h1: { fontSize: 40, fontWeight: 600, letterSpacing: '0.5px' },
    h2: { fontSize: 32, fontWeight: 600, letterSpacing: '0.5px' },
    h3: { fontSize: 20, fontWeight: 600, letterSpacing: '0.5px' },
    body1: { fontSize: 16, fontWeight: 400 },
    body2: { fontSize: 14, fontWeight: 400 },
    caption: { fontSize: 12, fontWeight: 500 },
  },
  components: {
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { textTransform: 'none' },
      },
    },
  },
});
```

- [ ] **Step 2: Update `web/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSENGER_API_V2?: string;
  readonly VITE_CANVAS_API?: string;
  readonly VITE_BUILD_SHA?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

(`VITE_PASSENGER_API_V2` stays declared during the transition so old `.env` values don't trip TypeScript; Task 12 drops it.)

- [ ] **Step 3: Replace `web/src/main.tsx`**

Read the current file first to confirm its structure. Then replace with:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './theme';
import { useRoute, matchRoute } from './router';
import { Home } from './views/Home';
import { Library } from './views/Library';
import { ItemDetailView } from './views/ItemDetail';
import { SearchView } from './views/Search';
import { Settings } from './views/Settings';
import { Pair } from './views/Pair';
import { PhonePair } from './views/PhonePair';
import { Player } from './views/Player';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

function App() {
  const route = useRoute();
  const routes: Array<[string, (params: Record<string, string>) => React.JSX.Element]> = [
    ['/', () => <Home />],
    ['/search', () => <SearchView />],
    ['/lib/:src', (p) => <Library source={p.src!} />],
    ['/lib/:src/:libId', (p) => <Library source={p.src!} libraryId={p.libId} />],
    ['/item/:src/:id', (p) => <ItemDetailView source={p.src!} id={p.id!} />],
    ['/play/:src/:id', (p) => <Player source={p.src!} id={p.id!} />],
    ['/settings', () => <Settings />],
    ['/settings/pair', () => <Pair />],
    ['/pair', () => <PhonePair />],
  ];
  for (const [pattern, renderFn] of routes) {
    const params = matchRoute(pattern, route.path);
    if (params) return renderFn(params);
  }
  return <NotFound />;
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
```

- [ ] **Step 4: Update `web/index.html`**

Find the existing `<title>` tag and change it from `passenger` to `canvas`. Update the file to:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>canvas</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Don't build yet**

Building will fail because router.tsx and the views still use Preact. The next tasks port them. Just confirm the new files are in place via a directory listing.

```powershell
cd C:\github\passenger\web
type src\theme.ts | findstr createTheme
```

Expected: one match.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/src/theme.ts web/src/main.tsx web/index.html web/src/vite-env.d.ts
git commit -m "web: theme.ts + React root + ThemeProvider + CssBaseline + canvas title"
```

---

## Task 5: Router compatibility (Preact hooks → React hooks)

**Files:**
- Modify: `web/src/router.tsx`

**Interfaces:**
- Consumes: React `useState` / `useEffect`.
- Produces: `useRoute`, `navigate`, `<Link>`, `matchRoute` exports with React-compatible types.

- [ ] **Step 1: Replace `web/src/router.tsx`**

```tsx
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

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
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Link({ to, children, className, style }: LinkProps): React.JSX.Element {
  return (
    <a
      href={`#${to}`}
      className={className}
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
```

Changes from the current Preact version: imports from `react` instead of `preact/hooks`; types `CSSProperties` and `ReactNode` come from `react`; `<Link>` uses `className` (React standard) instead of `class`.

- [ ] **Step 2: Typecheck**

```powershell
cd C:\github\passenger\web
npx tsc --noEmit
```

This will FAIL because the views still use Preact. The router file alone should typecheck though — confirm the error output is only about other files (Chrome.tsx, PosterCard.tsx, etc.).

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/router.tsx
git commit -m "web: router.tsx ported to React imports + types"
```

---

## Task 6: AppShell + Breadcrumbs (replaces Chrome.tsx)

**Files:**
- Delete: `web/src/components/Chrome.tsx`
- Create: `web/src/components/AppShell.tsx`
- Create: `web/src/components/Breadcrumbs.tsx`
- Modify: `web/src/storage.ts` (add library-name cache)

**Interfaces:**
- Consumes: React, MUI components, `useRoute` from router.
- Produces:
  - `<AppShell>{children}</AppShell>` — wraps non-player views with AppBar + Breadcrumbs + content area.
  - `<Breadcrumbs/>` — derives the crumb list from the current route, displays as MUI Breadcrumbs.
  - `getLibraryName(srcKey, libId): string | undefined` and `setLibraryName(srcKey, libId, name)` in storage.ts.
  - `getSourceLabel(srcKey): string | undefined` in storage.ts (reads from existing paired-source map).

- [ ] **Step 1: Add library-name cache to `web/src/storage.ts`**

Open `web/src/storage.ts` and append:

```typescript
const LIBRARY_NAMES_KEY = 'canvas.libraryNames';

export function getLibraryName(srcKey: string, libId: string): string | undefined {
  try {
    const raw = localStorage.getItem(LIBRARY_NAMES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const k = `${srcKey}:${libId}`;
    const v = (parsed as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setLibraryName(srcKey: string, libId: string, name: string): void {
  try {
    const raw = localStorage.getItem(LIBRARY_NAMES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === 'object' && parsed !== null) {
      (parsed as Record<string, string>)[`${srcKey}:${libId}`] = name;
      localStorage.setItem(LIBRARY_NAMES_KEY, JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
}

export function getSourceLabel(srcKey: string): string | undefined {
  const s = getSources()[srcKey];
  return s?.label;
}
```

This uses `canvas.libraryNames` even though we haven't renamed the other storage keys yet (Task 12 does the bulk rename); using the new prefix here matches the spec's final state.

- [ ] **Step 2: Create `web/src/components/Breadcrumbs.tsx`**

```tsx
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useRoute, navigate } from '../router';
import { getSourceLabel, getLibraryName } from '../storage';

interface Crumb {
  label: string;
  href?: string;
}

function deriveCrumbs(path: string): Crumb[] {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const crumbs: Crumb[] = [{ label: 'Home', href: '/' }];

  // /lib/:src
  // /lib/:src/:libId
  if (parts[0] === 'lib') {
    const src = parts[1];
    if (src) {
      crumbs.push({
        label: getSourceLabel(src) ?? src,
        href: parts.length > 2 ? `/lib/${src}` : undefined,
      });
    }
    if (parts[2]) {
      const name = getLibraryName(src!, parts[2]) ?? 'Library';
      crumbs.push({ label: name });
    }
    return crumbs;
  }
  // /item/:src/:id
  if (parts[0] === 'item' && parts[1] && parts[2]) {
    crumbs.push({ label: getSourceLabel(parts[1]) ?? parts[1], href: `/lib/${parts[1]}` });
    // item title isn't known at this layer — view sets document.title or could push state.
    crumbs.push({ label: 'Item' });
    return crumbs;
  }
  // /search
  if (parts[0] === 'search') {
    crumbs.push({ label: 'Search' });
    return crumbs;
  }
  // /settings, /settings/pair
  if (parts[0] === 'settings') {
    crumbs.push({ label: 'Settings', href: parts[1] ? '/settings' : undefined });
    if (parts[1] === 'pair') crumbs.push({ label: 'Pair new source' });
    return crumbs;
  }
  // /pair (phone)
  if (parts[0] === 'pair') {
    crumbs.push({ label: 'Phone pair' });
    return crumbs;
  }
  return crumbs;
}

export function RouteBreadcrumbs() {
  const route = useRoute();
  const crumbs = deriveCrumbs(route.path);
  if (crumbs.length <= 1) return null;
  return (
    <Breadcrumbs
      separator={<ChevronRightIcon fontSize="small" />}
      sx={{ px: 2.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}
      aria-label="breadcrumb"
    >
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        if (last || !c.href) {
          return <Typography key={i} color="text.primary" variant="body2">{c.label}</Typography>;
        }
        return (
          <Link
            key={i}
            underline="hover"
            color="text.secondary"
            variant="body2"
            href={`#${c.href}`}
            onClick={(e) => { e.preventDefault(); navigate(c.href!); }}
          >
            {c.label}
          </Link>
        );
      })}
    </Breadcrumbs>
  );
}
```

- [ ] **Step 3: Create `web/src/components/AppShell.tsx`**

```tsx
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

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const route = useRoute();
  const isHome = route.path === '/';

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
      <Box component="main">{children}</Box>
    </Box>
  );
}
```

- [ ] **Step 4: Delete the old Chrome component**

```powershell
cd C:\github\passenger\web\src\components
Remove-Item Chrome.tsx
```

We'll wire `AppShell` into each view in the subsequent view tasks. For now, do not call it from anywhere.

- [ ] **Step 5: Don't build yet**

Views still reference Chrome (deleted) and Preact. Confirm no other component imports Chrome:

```powershell
cd C:\github\passenger\web
Select-String -Path src -Pattern "from '../components/Chrome'" -SimpleMatch
```

Expected: only the import lines in views/, which we'll replace shortly. Don't run the build.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/AppShell.tsx web/src/components/Breadcrumbs.tsx web/src/storage.ts
git rm web/src/components/Chrome.tsx
git commit -m "web: AppShell + Breadcrumbs (replaces Chrome.tsx); library-name cache"
```

---

## Task 7: PosterCard + Rail components (MUI primitive swap)

**Files:**
- Modify: `web/src/components/PosterCard.tsx`
- Modify: `web/src/components/Rail.tsx`

**Interfaces:**
- Consumes: React, MUI `Card`, `Typography`, `Box`.
- Produces: `<PosterCard item={...} source={...} width?>` and `<Rail title={...} items={...} cardWidth?>` rendering with MUI primitives. Layouts unchanged from current.

- [ ] **Step 1: Replace `web/src/components/PosterCard.tsx`**

```tsx
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

export interface PosterCardProps {
  item: Item;
  source: string;
  width?: number;
}

export function PosterCard({ item, source, width = 180 }: PosterCardProps) {
  const isFolder = item.type === 'folder';
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${item.id}`;
  const aspectRatio = item.type === 'episode' ? 16 / 9 : 2 / 3;
  return (
    <Card sx={{ flexShrink: 0, width, backgroundColor: 'transparent', border: 'none' }}>
      <CardActionArea onClick={() => navigate(href)} sx={{ borderRadius: 1 }}>
        <Box
          sx={{
            width,
            aspectRatio: String(aspectRatio),
            backgroundColor: 'background.paper',
            borderRadius: 1,
            border: '1px solid',
            borderColor: 'divider',
            backgroundImage: item.poster ? `url(${item.poster})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
        <Typography
          variant="body2"
          sx={{
            mt: 1,
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'text.primary',
          }}
        >
          {item.title}
        </Typography>
        {item.year ? (
          <Typography variant="caption" color="text.secondary">{item.year}</Typography>
        ) : null}
      </CardActionArea>
    </Card>
  );
}
```

- [ ] **Step 2: Replace `web/src/components/Rail.tsx`**

```tsx
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Item } from '../types';
import { PosterCard } from './PosterCard';

export interface RailProps {
  title: string;
  items: (Item & { source: string })[];
  cardWidth?: number;
}

export function Rail({ title, items, cardWidth = 180 }: RailProps) {
  if (items.length === 0) return null;
  return (
    <Box component="section" sx={{ mb: 4 }}>
      <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>{title}</Typography>
      <Box
        sx={{
          display: 'flex',
          gap: 1.5,
          overflowX: 'auto',
          px: 2.5,
          scrollSnapType: 'x mandatory',
          '&::-webkit-scrollbar': { display: 'none' },
        }}
      >
        {items.map((it) => (
          <Box key={`${it.source}:${it.id}`} sx={{ scrollSnapAlign: 'start' }}>
            <PosterCard item={it} source={it.source} width={cardWidth} />
          </Box>
        ))}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Don't build yet** — views still use the old PosterCard signature, which is unchanged here, so they'll keep working once they're ported. Just confirm:

```powershell
cd C:\github\passenger\web
type src\components\PosterCard.tsx | findstr "PosterCard"
```

Expected: at least 3 matches (interface, function, export).

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/PosterCard.tsx web/src/components/Rail.tsx
git commit -m "web: PosterCard + Rail on MUI primitives (layouts unchanged)"
```

---

## Task 8: PlayerControls — MUI Slider + IconButton + Tooltip + icons

**Files:**
- Modify: `web/src/components/PlayerControls.tsx`

**Interfaces:**
- Consumes: React, MUI `Slider`, `IconButton`, `Tooltip`, `Fade`, `Box`, `Typography`.
- Produces: same prop interface as before; emoji glyphs replaced by MUI icons; underlying `<input type="range">` replaced by MUI `<Slider>`.

- [ ] **Step 1: Replace `web/src/components/PlayerControls.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import Fade from '@mui/material/Fade';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import Replay10Icon from '@mui/icons-material/Replay10';
import Forward10Icon from '@mui/icons-material/Forward10';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  thumbnailUrlTemplate?: string;
  volume: number;
  muted: boolean;
  fullscreen: boolean;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onVolumeChange(v: number): void;
  onMuteToggle(): void;
  onFullscreenToggle(): void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function SpeakerIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeOffIcon />;
  if (volume < 0.34) return <VolumeMuteIcon />;
  if (volume < 0.67) return <VolumeDownIcon />;
  return <VolumeUpIcon />;
}

export function PlayerControls(p: PlayerControlsProps) {
  const [previewPos, setPreviewPos] = useState<number | null>(null);
  const [previewBroken, setPreviewBroken] = useState(false);

  useEffect(() => {
    if (!p.visible) setPreviewPos(null);
  }, [p.visible]);

  useEffect(() => {
    setPreviewBroken(false);
  }, [p.thumbnailUrlTemplate]);

  const scrubPos = previewPos ?? p.posSec;
  const sliderMax = Math.max(1, p.durationSec);
  const previewMs = previewPos !== null ? Math.floor(previewPos * 100) * 100 : null;
  const previewBucketMs = previewMs !== null ? Math.floor(previewMs / 10000) * 10000 : null;
  const previewSrc = p.thumbnailUrlTemplate && previewBucketMs !== null
    ? p.thumbnailUrlTemplate.replace('{ms}', String(previewBucketMs))
    : null;

  return (
    <Box onClick={(e) => e.stopPropagation()}>
      <Fade in={p.visible} timeout={200}>
        <IconButton
          onClick={p.onClose}
          aria-label="close"
          sx={{ position: 'fixed', top: 16, right: 16, zIndex: 10, color: 'text.primary' }}
        >
          <CloseIcon />
        </IconButton>
      </Fade>

      {previewSrc && !previewBroken && (
        <Fade in={p.visible} timeout={100}>
          <Box
            component="img"
            src={previewSrc}
            alt=""
            onError={() => setPreviewBroken(true)}
            sx={{
              position: 'fixed', bottom: 110, left: '50%',
              transform: `translateX(calc(-50% + ${
                ((scrubPos / sliderMax) - 0.5) * Math.min(window.innerWidth - 40, 1400)
              }px))`,
              width: 160, height: 90, objectFit: 'cover',
              borderRadius: 1, boxShadow: 4,
              border: '2px solid', borderColor: 'common.white',
              pointerEvents: 'none', zIndex: 11,
            }}
          />
        </Fade>
      )}

      <Fade in={p.visible} timeout={200}>
        <Box
          sx={{
            position: 'fixed', left: 0, right: 0, bottom: 0,
            px: 2.5, pt: 3, pb: 2,
            background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
            zIndex: 10,
          }}
        >
          <Slider
            value={Math.min(scrubPos, sliderMax)}
            min={0}
            max={sliderMax}
            step={1}
            onChange={(_, v) => setPreviewPos(typeof v === 'number' ? v : v[0] ?? 0)}
            onChangeCommitted={(_, v) => {
              const value = typeof v === 'number' ? v : (v[0] ?? 0);
              setPreviewPos(null);
              p.onSeek(value);
            }}
            sx={{ color: 'primary.main', height: 4 }}
            aria-label="Seek"
          />
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1 }}>
            <Tooltip title="Back 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(-10)} aria-label="back 10s">
                <Replay10Icon />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.paused ? 'Play' : 'Pause'}>
              <IconButton onClick={p.onPlayPause} aria-label="play pause">
                {p.paused ? <PlayArrowIcon /> : <PauseIcon />}
              </IconButton>
            </Tooltip>
            <Tooltip title="Forward 10 seconds">
              <IconButton onClick={() => p.onSeekRelative(+10)} aria-label="forward 10s">
                <Forward10Icon />
              </IconButton>
            </Tooltip>
            <Tooltip title={p.muted ? 'Unmute' : 'Mute'}>
              <IconButton onClick={p.onMuteToggle} aria-label="mute toggle" sx={{ ml: 2 }}>
                <SpeakerIcon volume={p.volume} muted={p.muted} />
              </IconButton>
            </Tooltip>
            <Slider
              value={Math.round(p.volume * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(_, v) => p.onVolumeChange((typeof v === 'number' ? v : (v[0] ?? 0)) / 100)}
              sx={{ width: 100, color: 'primary.main' }}
              aria-label="Volume"
            />
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              {fmt(scrubPos)} / {fmt(p.durationSec)}
            </Typography>
            <Tooltip title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              <IconButton onClick={p.onFullscreenToggle} aria-label="fullscreen toggle">
                {p.fullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Fade>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/PlayerControls.tsx
git commit -m "web: PlayerControls on MUI Slider/IconButton/Tooltip; emojis → icons"
```

---

## Task 9: Convert Home + Library views

**Files:**
- Modify: `web/src/views/Home.tsx`
- Modify: `web/src/views/Library.tsx`

**Interfaces:**
- Consumes: React `useEffect`/`useState`; `AppShell` from Task 6; `PosterCard`/`Rail` from Task 7.
- Produces: Home and Library views rendering under React with the new AppShell. Layouts unchanged; only React/MUI primitive swaps.

- [ ] **Step 1: Replace `web/src/views/Home.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../api';
import { getSources } from '../storage';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { Link, navigate } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[] }
  | { kind: 'error'; message: string };

export function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const sources = getSources();
    if (Object.keys(sources).length === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors }) => setState({ kind: 'ok', rows, errors }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, []);

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        {state.kind === 'loading' && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>Loading…</Typography>
        )}
        {state.kind === 'empty' && (
          <Box sx={{ p: 5, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ mb: 2 }}>No sources paired yet.</Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => navigate('/settings/pair')}
            >
              Pair your first source
            </Button>
          </Box>
        )}
        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5 }}>Error: {state.message}</Alert>
        )}
        {state.kind === 'ok' && state.errors.length > 0 && (
          <Box sx={{ px: 2.5, pb: 2 }}>
            {state.errors.map((err) => (
              <Alert key={err.source} severity="warning" sx={{ my: 0.5 }}>
                {err.source}: {err.message}
              </Alert>
            ))}
          </Box>
        )}
        {state.kind === 'ok' && state.rows.map((row) => (
          <Rail
            key={`${row.source}:${row.kind}:${row.title}`}
            title={row.source ? `${row.title} · ${row.source}` : row.title}
            items={row.items.map((i: Item) => ({ ...i, source: row.source }))}
            cardWidth={row.items[0]?.type === 'episode' ? 260 : 180}
          />
        ))}
        {state.kind === 'ok' && state.rows.length === 0 && state.errors.length === 0 && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>
            Your sources are paired but returned nothing yet.
          </Typography>
        )}
      </Box>
    </AppShell>
  );
}
```

Note: this keeps the existing single-rail flat layout. The hero + grouped rails redesign is **Plan 2**, not this task. Also notice the breadcrumb subtle helper `<Link>` that used to wrap the "Pair your first source" button now lives behind an MUI `Button`'s `onClick`.

- [ ] **Step 2: Replace `web/src/views/Library.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { PosterCard } from '../components/PosterCard';
import { setLibraryName } from '../storage';
import type { BrowseResult } from '../types';

interface Props {
  source: string;
  libraryId?: string;
}

export function Library({ source, libraryId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; data: BrowseResult }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    api.library(source, libraryId).then(
      (data) => {
        // Cache library name for breadcrumbs on subsequent visits.
        const last = data.breadcrumbs[data.breadcrumbs.length - 1];
        if (libraryId && last && last.libraryId === libraryId && last.name) {
          setLibraryName(source, libraryId, last.name);
        }
        setState({ kind: 'ok', data });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  return (
    <AppShell>
      <Box sx={{ p: 2.5 }}>
        {state.kind === 'loading' && <Typography color="text.secondary">Loading…</Typography>}
        {state.kind === 'error' && <Alert severity="error">Error: {state.message}</Alert>}
        {state.kind === 'ok' && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, 180px)',
              gap: 2.5,
            }}
          >
            {state.data.items.map((it) => (
              <PosterCard key={it.id} item={it} source={source} />
            ))}
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
```

Notes: dropped the in-page breadcrumb (now handled by `AppShell` → `RouteBreadcrumbs`). Added `setLibraryName` cache write so breadcrumbs on revisit have the proper name.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Home.tsx web/src/views/Library.tsx
git commit -m "web: Home + Library views ported to React + MUI (layouts preserved)"
```

---

## Task 10: Convert ItemDetail + Search views

**Files:**
- Modify: `web/src/views/ItemDetail.tsx`
- Modify: `web/src/views/Search.tsx`

**Interfaces:**
- Consumes: React; `AppShell`; `PosterCard`.
- Produces: ported views. Layouts unchanged from current implementation.

- [ ] **Step 1: Replace `web/src/views/ItemDetail.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { navigate, Link } from '../router';
import type { ItemDetail } from '../types';

interface Props { source: string; id: string }

function formatRuntime(sec?: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPos(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function ItemDetailView({ source, id }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; item: ItemDetail }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    setState({ kind: 'loading' });
    api.item(source, id).then(
      (item) => setState({ kind: 'ok', item }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, id]);

  if (state.kind === 'loading') {
    return <AppShell><Typography sx={{ p: 2.5 }} color="text.secondary">Loading…</Typography></AppShell>;
  }
  if (state.kind === 'error') {
    return <AppShell><Alert severity="error" sx={{ m: 2.5 }}>{state.message}</Alert></AppShell>;
  }

  const { item } = state;
  const resume = (item.viewOffsetSec ?? 0) > 60;

  return (
    <AppShell>
      {item.backdrop && (
        <Box
          sx={{
            height: 320,
            backgroundImage: `url(${item.backdrop})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            position: 'relative',
          }}
        >
          <Box
            sx={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, transparent 50%, var(--mui-palette-background-default, #0e0f12) 100%)',
            }}
          />
        </Box>
      )}
      <Box sx={{ px: 2.5, mt: item.backdrop ? -10 : 2.5, position: 'relative' }}>
        <Box sx={{ display: 'flex', gap: 3 }}>
          {item.poster && (
            <Box
              component="img"
              src={item.poster}
              alt=""
              sx={{ width: 200, height: 300, borderRadius: 1, objectFit: 'cover' }}
            />
          )}
          <Box sx={{ flex: 1, pt: item.backdrop ? 7.5 : 0 }}>
            <Typography variant="h1" sx={{ mb: 1 }}>{item.title}</Typography>
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {[item.year, formatRuntime(item.durationSec), item.rating ? `★ ${item.rating}` : null]
                .filter(Boolean).join(' · ')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1.5, mb: 2 }}>
              <Button
                variant="contained"
                size="large"
                startIcon={<PlayArrowIcon />}
                onClick={() => navigate(`/play/${source}/${item.id}`)}
              >
                {resume ? `Resume ${formatPos(item.viewOffsetSec!)}` : 'Play'}
              </Button>
              {resume && (
                <Button
                  variant="text"
                  onClick={() => navigate(`/play/${source}/${item.id}?from=0`)}
                >
                  Start over
                </Button>
              )}
            </Box>
            {item.synopsis && (
              <Typography variant="body1" sx={{ maxWidth: 720, lineHeight: 1.5 }}>
                {item.synopsis}
              </Typography>
            )}
          </Box>
        </Box>

        {item.episodes && item.episodes.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h3" sx={{ mb: 1.5 }}>Episodes</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {item.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/play/${source}/${ep.id}`}
                  style={{
                    display: 'flex', gap: 16, padding: 12,
                    backgroundColor: 'var(--mui-palette-background-paper, #181a1f)',
                    border: '1px solid var(--mui-palette-divider, #2a2d36)',
                    borderRadius: 8,
                    color: 'inherit',
                  }}
                >
                  {ep.poster && (
                    <Box
                      component="img"
                      src={ep.poster}
                      alt=""
                      sx={{ width: 160, height: 90, borderRadius: 0.5, objectFit: 'cover' }}
                    />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 600 }}>
                      S{ep.season}·E{ep.episode} · {ep.title}
                    </Typography>
                    {ep.synopsis && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {ep.synopsis}
                      </Typography>
                    )}
                  </Box>
                </Link>
              ))}
            </Box>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace `web/src/views/Search.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Typography from '@mui/material/Typography';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { PosterCard } from '../components/PosterCard';
import type { Item } from '../types';

export function SearchView() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<(Item & { source: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (q.trim().length < 2) { setResults([]); return; }
    debounce.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { hits } = await api.search(q.trim());
        setResults(hits);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]);

  return (
    <AppShell>
      <Box sx={{ p: 2.5 }}>
        <TextField
          fullWidth
          autoFocus
          placeholder="Search across your libraries…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        {loading && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>Searching…</Typography>
        )}
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <Typography color="text.secondary" sx={{ mt: 2 }}>No results.</Typography>
        )}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 180px)',
            gap: 2.5,
            mt: 2.5,
          }}
        >
          {results.map((it) => (
            <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
          ))}
        </Box>
      </Box>
    </AppShell>
  );
}
```

(Plan 2 will group these results by source — Plan 1 keeps the flat grid.)

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/ItemDetail.tsx web/src/views/Search.tsx
git commit -m "web: ItemDetail + Search ported to React + MUI (layouts preserved)"
```

---

## Task 11: Convert Settings + Pair views

**Files:**
- Modify: `web/src/views/Settings.tsx`
- Modify: `web/src/views/Pair.tsx`

**Interfaces:**
- Consumes: React; `AppShell`; storage helpers.
- Produces: ported views, layouts unchanged.

- [ ] **Step 1: Replace `web/src/views/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import AddIcon from '@mui/icons-material/Add';
import { AppShell } from '../components/AppShell';
import { navigate } from '../router';
import { getSources, removeSource, getPrefs, setPrefs } from '../storage';
import type { StoredSource, Prefs } from '../storage';

export function Settings() {
  const [sources, setLocalSources] = useState<Record<string, StoredSource>>({});
  const [prefs, setLocalPrefs] = useState<Prefs>(getPrefs());

  useEffect(() => {
    setLocalSources(getSources());
  }, []);

  function unpair(key: string) {
    removeSource(key);
    setLocalSources({ ...getSources() });
  }

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next: Prefs = { ...prefs, [key]: value };
    setLocalPrefs(next);
    setPrefs(next);
  }

  const entries = Object.entries(sources);
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';

  return (
    <AppShell>
      <Box sx={{ p: 2.5, maxWidth: 700 }}>
        <Typography variant="h3" sx={{ mb: 2 }}>Sources</Typography>
        {entries.length === 0 && (
          <Typography color="text.secondary">No sources paired yet.</Typography>
        )}
        {entries.map(([key, src]) => (
          <Box
            key={key}
            sx={{
              display: 'flex', alignItems: 'center', p: 1.5,
              backgroundColor: 'background.paper',
              border: '1px solid', borderColor: 'divider',
              borderRadius: 1, mb: 1,
            }}
          >
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 600 }}>{src.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {src.type} · {src.baseUrl}
              </Typography>
            </Box>
            <Button variant="text" color="error" onClick={() => unpair(key)}>
              Unpair
            </Button>
          </Box>
        ))}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/settings/pair')}
          sx={{ mt: 1.5 }}
        >
          Pair new source
        </Button>

        <Typography variant="h3" sx={{ mt: 4, mb: 2 }}>Preferences</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={prefs.autoplayNext}
              onChange={(e) => update('autoplayNext', e.target.checked)}
            />
          }
          label="Autoplay next episode"
          sx={{ display: 'block', mb: 1.5 }}
        />
        <FormControlLabel
          control={
            <Switch
              checked={prefs.skipIntro}
              onChange={(e) => update('skipIntro', e.target.checked)}
            />
          }
          label="Skip intro automatically"
          sx={{ display: 'block', mb: 1.5 }}
        />

        <Typography variant="h3" sx={{ mt: 4, mb: 1 }}>About</Typography>
        <Typography variant="body2" color="text.secondary">
          canvas · v1.0 · build {buildSha}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Player engine · canvas/WebCodecs
        </Typography>
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Replace `web/src/views/Pair.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { addSource, makeSourceKey } from '../storage';
import { navigate } from '../router';
import type { StoredSource } from '../storage';

type SourceType = StoredSource['type'];

type State =
  | { kind: 'choose' }
  | { kind: 'pairing'; type: SourceType; code: string; expiresAt: number }
  | { kind: 'paired'; label: string }
  | { kind: 'error'; message: string };

const SOURCE_TYPES: Array<{ type: SourceType; label: string; available: boolean }> = [
  { type: 'plex', label: 'Plex Media Server', available: true },
  { type: 'jellyfin', label: 'Jellyfin', available: false },
  { type: 'flixify', label: 'thecalm.site (Flixify)', available: false },
  { type: 'generic', label: 'Direct URL', available: false },
];

export function Pair() {
  const [state, setState] = useState<State>({ kind: 'choose' });

  async function startPair(type: SourceType) {
    try {
      const { code, expiresAt } = await api.pairStart(type);
      setState({ kind: 'pairing', type, code, expiresAt });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }

  useEffect(() => {
    if (state.kind !== 'pairing') return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.pairPoll(state.code);
        if (cancelled) return;
        if (res.status === 'approved' && res.source) {
          const key = makeSourceKey(res.source.label || res.source.baseUrl);
          addSource(key, res.source);
          await api.pairDelete(state.code).catch(() => {});
          setState({ kind: 'paired', label: res.source.label });
          setTimeout(() => navigate('/settings'), 1200);
          return;
        }
        if (res.status === 'expired') {
          setState({ kind: 'error', message: 'Pair code expired. Try again.' });
          return;
        }
        setTimeout(poll, 3000);
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: (e as Error).message });
      }
    };
    void poll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === 'pairing' ? state.code : null]);

  return (
    <AppShell>
      <Box sx={{ p: 5, maxWidth: 600, mx: 'auto', textAlign: 'center' }}>
        {state.kind === 'choose' && (
          <>
            <Typography variant="h3" sx={{ mb: 1 }}>Pair a new source</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Choose what kind of source you want to add.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {SOURCE_TYPES.map((s) => (
                <Button
                  key={s.type}
                  variant="outlined"
                  disabled={!s.available}
                  onClick={() => startPair(s.type)}
                  sx={{ py: 2, justifyContent: 'flex-start', px: 2.5 }}
                >
                  {s.label}{!s.available && (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      (coming soon)
                    </Typography>
                  )}
                </Button>
              ))}
            </Box>
          </>
        )}
        {state.kind === 'pairing' && (
          <>
            <Typography variant="h3" sx={{ mb: 2 }}>On your phone, go to:</Typography>
            <Typography sx={{ fontSize: 20, mb: 2 }}>canvas.pages.dev/#/pair</Typography>
            <Typography>Enter this code:</Typography>
            <Typography
              variant="h1"
              sx={{
                fontSize: 80, fontWeight: 700, letterSpacing: '16px',
                backgroundColor: 'background.paper',
                border: '1px solid', borderColor: 'divider',
                py: 3, px: 4, borderRadius: 2,
                display: 'inline-block', my: 2,
              }}
            >
              {state.code}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5 }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Waiting for approval…</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Code expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </Typography>
          </>
        )}
        {state.kind === 'paired' && (
          <>
            <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Paired</Typography>
            <Typography>{state.label} is now linked. Redirecting…</Typography>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>{state.message}</Alert>
            <Button variant="text" onClick={() => setState({ kind: 'choose' })}>Try again</Button>
          </>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Settings.tsx web/src/views/Pair.tsx
git commit -m "web: Settings + Pair ported to React + MUI (layouts preserved)"
```

---

## Task 12: Convert PhonePair + Player views; rename frontend strings + storage keys

**Files:**
- Modify: `web/src/views/PhonePair.tsx`
- Modify: `web/src/views/Player.tsx`
- Modify: `web/src/storage.ts`
- Modify: `web/src/config.ts`
- Modify: `web/src/api.ts`

**Interfaces:**
- Consumes: React, MUI, all prior tasks.
- Produces: ported views; localStorage keys / env var / X-Plex headers renamed to `canvas.*`. Existing v2 users will need to re-pair once.

- [ ] **Step 1: Replace `web/src/views/PhonePair.tsx`**

```tsx
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { useRoute } from '../router';
import { api } from '../api';

const PLEX_PRODUCT = 'Canvas';
const CLIENT_ID_KEY = 'canvas.plex.clientId';

function plexClientId(): string {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

interface PlexPin { id: number; code: string; authToken: string | null }

async function plexCreatePin(): Promise<PlexPin> {
  const res = await fetch('https://plex.tv/api/v2/pins?strong=true', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'X-Plex-Product': PLEX_PRODUCT,
      'X-Plex-Client-Identifier': plexClientId(),
    },
  });
  if (!res.ok) throw new Error(`plex.tv POST /pins failed: ${res.status}`);
  return res.json();
}

async function plexPollPin(id: number): Promise<PlexPin> {
  const res = await fetch(`https://plex.tv/api/v2/pins/${id}?X-Plex-Client-Identifier=${plexClientId()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`plex.tv GET /pins/${id} failed: ${res.status}`);
  return res.json();
}

interface ResolvedServer {
  name: string;
  clientIdentifier: string;
  baseUrl: string;
  accessToken: string;
  publiclyReachable: boolean;
}

export function PhonePair() {
  const route = useRoute();
  const codeFromUrl = route.query.code ?? '';
  const typeFromUrl = route.query.type ?? '';
  const [code, setCode] = useState(codeFromUrl);
  const [stage, setStage] = useState<
    | { kind: 'enter-code' }
    | { kind: 'plex-pin'; pin: PlexPin }
    | { kind: 'plex-servers'; servers: ResolvedServer[] }
    | { kind: 'done' }
    | { kind: 'error'; message: string }
  >({ kind: 'enter-code' });

  async function startPlex() {
    try {
      const pin = await plexCreatePin();
      setStage({ kind: 'plex-pin', pin });
      const authUrl = `https://app.plex.tv/auth#?clientID=${plexClientId()}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`;
      window.open(authUrl, '_blank');
      const start = Date.now();
      while (Date.now() - start < 10 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await plexPollPin(pin.id);
        if (polled.authToken) {
          const { servers } = await api.pairPlexServers(polled.authToken, plexClientId());
          setStage({ kind: 'plex-servers', servers });
          return;
        }
      }
      setStage({ kind: 'error', message: 'Plex sign-in timed out' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  async function approveWithServer(server: ResolvedServer) {
    try {
      if (!server.baseUrl) throw new Error('No connection URL for this server');
      await api.pairApprove({
        code,
        type: 'plex',
        baseUrl: server.baseUrl,
        token: server.accessToken,
        label: server.name,
      });
      setStage({ kind: 'done' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <Box sx={{ p: 3, maxWidth: 500, mx: 'auto', fontFamily: 'system-ui' }}>
      <Typography variant="h2" sx={{ mb: 2 }}>canvas · phone pair</Typography>
      {stage.kind === 'enter-code' && (
        <Box>
          <Typography sx={{ mb: 1 }}>Enter the code shown on your Tesla:</Typography>
          <TextField
            fullWidth
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXX-XXX"
            inputProps={{ style: { fontSize: 24, textAlign: 'center', letterSpacing: 4 } }}
            sx={{ mb: 2 }}
          />
          {(typeFromUrl === 'plex' || code) && (
            <Button
              fullWidth
              variant="contained"
              size="large"
              disabled={code.length < 7}
              onClick={() => { if (typeFromUrl === 'plex' || code) startPlex(); }}
            >
              Sign in to Plex →
            </Button>
          )}
        </Box>
      )}
      {stage.kind === 'plex-pin' && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={20} />
          <Typography>Waiting for Plex sign-in in the popup window…</Typography>
        </Box>
      )}
      {stage.kind === 'plex-servers' && (
        <Box>
          <Typography sx={{ mb: 1.5 }}>Pick your Plex server:</Typography>
          {stage.servers.length === 0 && (
            <Alert severity="warning">No servers found for this account.</Alert>
          )}
          {stage.servers.map((s) => (
            <Button
              key={s.clientIdentifier}
              fullWidth
              variant="outlined"
              onClick={() => approveWithServer(s)}
              sx={{
                py: 1.75, mb: 1, justifyContent: 'flex-start',
                opacity: s.publiclyReachable ? 1 : 0.6,
              }}
            >
              {s.name}
              {!s.publiclyReachable && (
                <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                  (no public access)
                </Typography>
              )}
            </Button>
          ))}
        </Box>
      )}
      {stage.kind === 'done' && (
        <Box>
          <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Linked</Typography>
          <Typography>Return to your Tesla — it should pick up the source within a few seconds.</Typography>
        </Box>
      )}
      {stage.kind === 'error' && (
        <Box>
          <Alert severity="error" sx={{ mb: 1.5 }}>{stage.message}</Alert>
          <Button variant="text" onClick={() => setStage({ kind: 'enter-code' })}>Try again</Button>
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Replace `web/src/views/Player.tsx`**

Read the current file first. It already builds on React-friendly hooks (`useEffect`, `useRef`, `useState`), so the conversion is mostly `from 'preact/hooks'` → `from 'react'`. Replace the file with:

```tsx
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { navigate } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { bootEngine, type EngineHandle } from '../player/engine';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import type { PlayResolution } from '../types';

interface Props { source: string; id: string }

const PROGRESS_INTERVAL_MS = 15_000;

export function Player({ source, id }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [paused, setPaused] = useState(true);
  const [pos, setPos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState('Loading…');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const VOL_KEY = 'canvas.volume';
  const [volume, setVolume] = useState<number>(() => {
    const raw = localStorage.getItem(VOL_KEY);
    const n = raw === null ? 1 : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
  });
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const startedRef = useRef(false);
  const reportRef = useRef(0);
  const resolutionRef = useRef<PlayResolution | null>(null);
  const wasPlayingRef = useRef(false);
  const seekTokenRef = useRef(0);
  const sessionBaseRef = useRef(0);

  useEffect(() => {
    let t: number | undefined;
    const reset = () => {
      setControlsVisible(true);
      if (t) clearTimeout(t);
      t = window.setTimeout(() => setControlsVisible(false), 3000);
    };
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    reset();
    return () => {
      if (t) clearTimeout(t);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audioRef.current;
      if (a) setPos(sessionBaseRef.current + a.currentTime());
      if (resolutionRef.current) setDuration(resolutionRef.current.durationSec);
      const now = Date.now();
      if (startedRef.current && now - reportRef.current > PROGRESS_INTERVAL_MS) {
        reportRef.current = now;
        const cur = a ? sessionBaseRef.current + a.currentTime() : 0;
        void api.progress(source, id, cur, false).catch(() => {});
      }
    }, 250);
    return () => clearInterval(t);
  }, [source, id]);

  useEffect(() => {
    audioRef.current?.setVolume(volume);
    localStorage.setItem(VOL_KEY, String(volume));
  }, [volume]);
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function autoStartPlayback(): Promise<void> {
    if (audioRef.current) await audioRef.current.start();
    videoRef.current?.start();
    for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
    for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = true;
    setPaused(false);
  }

  const bootSession = (fromSec: number): { cancel: () => void } => {
    let cancelled = false;
    let cancelTimer: number | undefined;
    void (async () => {
      try {
        setStatus(fromSec > 0 ? 'Seeking…' : 'Resolving stream…');
        const resolution = await api.play(source, id, fromSec);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');
        const canvas = canvasRef.current!;
        engineRef.current = bootEngine({
          url: resolution.url,
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig) { setErrMsg('No video track'); return; }
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
            });
            videoRef.current = video;
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audio.setVolume(volume);
              audio.setMuted(muted);
              audioRef.current = audio;
            }
            sessionBaseRef.current = fromSec;
            setStatus('');
            if (wasPlayingRef.current) {
              void autoStartPlayback();
            } else {
              setStatus('Ready — tap to play');
            }
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onFatal: (e) => setErrMsg(e.message),
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    })();
    return { cancel: () => { cancelled = true; if (cancelTimer) clearTimeout(cancelTimer); } };
  };

  useEffect(() => {
    const handle = bootSession(0);
    return () => {
      handle.cancel();
      engineRef.current?.dispose();
      engineRef.current = null;
      videoRef.current?.close();
      videoRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a && startedRef.current) {
        const cur = sessionBaseRef.current + a.currentTime();
        const url = `${import.meta.env.VITE_CANVAS_API}/api/progress/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
        const blob = new Blob(
          [JSON.stringify({ posSec: cur, completed: false })],
          { type: 'application/json' },
        );
        navigator.sendBeacon?.(url, blob);
      }
    };
  }, [source, id]);

  async function onPlayPause() {
    if (errMsg) return;
    if (!startedRef.current) {
      wasPlayingRef.current = true;
      await autoStartPlayback();
      setStatus('');
      return;
    }
    const a = audioRef.current;
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
      wasPlayingRef.current = false;
    } else {
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
      wasPlayingRef.current = true;
    }
  }

  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
    const target = Math.max(0, Math.min(targetSec, duration > 0 ? duration - 1 : targetSec));
    const myToken = ++seekTokenRef.current;
    setPos(target);
    wasPlayingRef.current = startedRef.current && !paused;
    engineRef.current?.dispose();
    engineRef.current = null;
    videoRef.current?.close();
    videoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = false;
    const handle = bootSession(target);
    const interval = window.setInterval(() => {
      if (myToken !== seekTokenRef.current) {
        handle.cancel();
        clearInterval(interval);
      } else if (engineRef.current) {
        clearInterval(interval);
      }
    }, 100);
  }

  function onSeek(sec: number): void { void reseek(sec); }
  function onSeekRelative(delta: number): void { void reseek(pos + delta); }

  async function onFullscreenToggle(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* ignore */ }
  }
  function onMuteToggle(): void { setMuted((m) => !m); }
  function onVolumeChange(v: number): void {
    setVolume(v);
    if (v > 0 && muted) setMuted(false);
  }

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, sessionBaseRef.current + a.currentTime(), false).catch(() => {});
    }
    navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  }

  return (
    <div
      onClick={() => {
        if (!errMsg && controlsVisible) void onPlayPause();
      }}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100vw', maxHeight: '100vh', display: 'block' }}
      />
      {(status || errMsg) && (
        <div style={{
          position: 'fixed', top: 12, left: 12,
          color: errMsg ? '#f88' : '#ccc',
          background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 4, fontSize: 13,
        }}>
          {errMsg ?? status}
        </div>
      )}
      <PlayerControls
        paused={paused}
        posSec={pos}
        durationSec={duration}
        visible={controlsVisible}
        thumbnailUrlTemplate={resolutionRef.current?.thumbnailUrlTemplate}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
        onVolumeChange={onVolumeChange}
        onMuteToggle={onMuteToggle}
        onFullscreenToggle={onFullscreenToggle}
      />
    </div>
  );
}
```

- [ ] **Step 3: Update `web/src/storage.ts` — rename localStorage keys**

Find the existing key constants near the top of the file:

```typescript
const SOURCES_KEY = 'passenger.v2.sources';
const PREFS_KEY = 'passenger.v2.prefs';
```

Replace with:

```typescript
const SOURCES_KEY = 'canvas.sources';
const PREFS_KEY = 'canvas.prefs';
```

(`LIBRARY_NAMES_KEY` was already created at `canvas.libraryNames` in Task 6 — leave it as is.)

- [ ] **Step 4: Update `web/src/config.ts` — rename env var**

```typescript
export const API_BASE = (import.meta.env.VITE_CANVAS_API ?? '').replace(/\/$/, '');
```

- [ ] **Step 5: Update `web/.env.example`**

```
# Baked into the web bundle at build time.
# Replace with your actual Cloudflare Workers URL from the canvas-api deploy.
VITE_CANVAS_API=https://canvas-api.<your-account>.workers.dev
```

- [ ] **Step 6: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

The build should now succeed end-to-end. If TypeScript reports errors, they're likely missed `class` → `className` renames or stray Preact-namespace types — fix them inline. The bundle size will be substantially larger than before (~600 KB total).

- [ ] **Step 7: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/PhonePair.tsx web/src/views/Player.tsx web/src/storage.ts web/src/config.ts web/.env.example
git commit -m "web: PhonePair + Player ported; localStorage and env-var renamed to canvas"
```

---

## Task 13: Local smoke + final cleanup

**Files:**
- Modify (if needed): residual files with `passenger` strings — verified via grep.

**Interfaces:**
- Consumes: completed Tasks 1–12.
- Produces: locally-verified clean build, no residual `passenger` references in user-visible source.

- [ ] **Step 1: Run the dev server locally**

```powershell
cd C:\github\passenger\web
copy .env.example .env  # only if not already present from before
```

Edit `web/.env` and set `VITE_CANVAS_API` to your `canvas-api.<account>.workers.dev` value (or the existing `passenger-api-v2.<account>.workers.dev` value temporarily — we deploy the new worker in Task 14, but for local smoke either URL works as long as it's reachable).

```powershell
npm run dev
```

Open `http://localhost:5173/` — confirm:
- Wordmark reads "canvas".
- Tab title reads "canvas".
- Back button + breadcrumbs work on `/settings`, `/lib/...`, `/item/...`.
- All control glyphs in the player are real MUI icons (no emojis visible).
- Volume slider is the MUI Slider (continuous), not the native browser one.

Stop the dev server.

- [ ] **Step 2: Grep for residual `passenger` strings in source**

```powershell
cd C:\github\passenger
Select-String -Path web\src -Pattern "passenger" -SimpleMatch
Select-String -Path worker\src -Pattern "passenger" -SimpleMatch
```

Expected: zero matches in user-visible strings. Acceptable matches:
- Comments referencing "passenger v1" or "passenger v2" history — leave them; they're useful.
- The repo dir name `C:\github\passenger\` in file paths — leave it.

If any string literal in source files still says `'passenger'` or `"Passenger"` and IS user-visible (page title, header value, etc.), edit it now.

- [ ] **Step 3: Commit any cleanup**

```powershell
cd C:\github\passenger
git status
# if any files changed:
git add <files>
git commit -m "web/worker: clean up remaining passenger string references"
```

If nothing changed, skip the commit.

- [ ] **Step 4: Final build verification**

```powershell
cd C:\github\passenger\web
npm run build
```

Note the new bundle file name (`index-<hash>.js`) and rough size — record in the next task's report.

---

## Task 14: Deploy worker + frontend + Tesla smoke (USER)

**Files:** none (deploy + verification).

**Interfaces:**
- Consumes: completed Tasks 1–13.
- Produces:
  - `canvas-api` Worker deployed and reachable.
  - `canvas` Pages project deployed and reachable.
  - End-to-end smoke verified on desktop and Tesla.

- [ ] **Step 1: Deploy the worker**

```powershell
cd C:\github\passenger\worker
npx wrangler deploy
```

Expected: prints `https://canvas-api.<account>.workers.dev`. Copy the URL.

- [ ] **Step 2: Smoke the deployed worker**

```powershell
Invoke-RestMethod "https://canvas-api.<account>.workers.dev/health"
```

Expected: `ok`.

- [ ] **Step 3: Update `web/.env` for production deploy**

Edit `web/.env`:

```
VITE_CANVAS_API=https://canvas-api.<your-account>.workers.dev
```

- [ ] **Step 4: Build + deploy Pages**

```powershell
cd C:\github\passenger\web
npm run build
cd ..
npx wrangler pages deploy ./web/dist --project-name=canvas --branch=v2 --commit-dirty=true
```

(If `canvas` was taken at the account level, use the fallback project name selected in Task 1 Step 3.)

If the project doesn't exist yet, you'll need to create it first:

```powershell
npx wrangler pages project create canvas --production-branch=v2
```

Then re-run the deploy. Expected: prints a deploy URL like `https://canvas.pages.dev/`.

- [ ] **Step 5: Desktop smoke**

Open `https://canvas.pages.dev/` (or fallback URL) in a desktop browser. Existing v2 pairings won't carry over (localStorage keys changed). Verify:

1. Wordmark + tab title are "canvas".
2. AppBar shows wordmark + Search + Settings icons (no emojis).
3. With no paired sources, Home shows "No sources paired yet" + an `<AddIcon/>`-prefixed "Pair your first source" button.
4. Click the button → `/settings/pair`. Back button works.
5. Pair Plex (same flow as v2; phone-side opens plex.tv OAuth).
6. After pairing, Home renders Continue Watching + Recently Added rails.
7. Tap a movie → ItemDetail → Play → canvas player loads with MUI player controls (proper icons, MUI Slider).
8. Seek by dragging the slider — reseek works.
9. Volume slider, mute toggle, fullscreen button all functional.

- [ ] **Step 6: Tesla smoke**

In the Tesla browser, open the new canvas URL. Pair Plex (use phone for OAuth). Play a movie. In Park first, then shift to N in a controlled stationary spot to re-validate the v2 stack on the new infrastructure.

- [ ] **Step 7: Record acceptance**

Append a "Plan 1 result" section to `docs/superpowers/specs/2026-06-27-canvas-ui-redesign-design.md`:

```markdown
## Plan 1 result (recorded YYYY-MM-DD)

- Worker deployed: canvas-api.<account>.workers.dev (version <id>)
- Pages deployed: https://canvas.pages.dev/ (bundle index-<hash>.js, total ~<size> KB gzip)
- Old infra still live: passenger-api-v2.<account>.workers.dev, passenger-v2.pages.dev
- Desktop smoke: <pass | issues>
- Tesla smoke (in Park + shift-out): <pass | issues>
- Notes:
```

Commit:

```powershell
cd C:\github\passenger
git add docs/superpowers/specs/2026-06-27-canvas-ui-redesign-design.md
git commit -m "Record canvas Plan 1 acceptance result"
```

---

## Self-review notes

- **Spec coverage:** Every spec section maps to a task.
  - Framework swap → Tasks 3, 4, 5
  - Theme + DNA → Task 4
  - Icon replacement → Tasks 6, 8, 11 (settings/pair), 12 (player implicitly), 9-11 (per-view button → IconButton swaps)
  - AppShell + Breadcrumbs → Task 6
  - Component rewrites → Tasks 7, 8, 9, 10, 11, 12
  - Brand rename (worker side) → Task 2
  - Brand rename (frontend side) → Task 12 + 13 cleanup
  - Build SHA → Task 3 (Vite config), Task 11 (Settings About card consumes it)
  - Cloudflare resource creation → Task 1
  - Deploy + smoke → Task 14
- **Per-screen redesign work (Plan 2)** is **not** in this plan. Each ported view keeps its existing layout — no hero, no episode list redesign, no source-status pings.
- **Plan 3** features (onboarding, branding finalization, cutover) are not in this plan.
- **No placeholders found** in the steps. The repo dir name `C:\github\passenger\` stays — that's the user preference, not a forgotten rename.
- **Type consistency:** `EngineHandle`, `VideoSink`, `AudioSink`, `bootEngine` signatures unchanged across tasks. New: `getLibraryName`, `setLibraryName`, `getSourceLabel` in storage.ts (Task 6), consumed by Breadcrumbs (Task 6) and Library view (Task 9). `VITE_CANVAS_API` env var defined in Task 4 (vite-env.d.ts) and consumed in Task 12 (config.ts + Player beacon URL).
- **Localstorage migration** is intentionally destructive (drops existing v2 pairings; user re-pairs once). Acceptable per spec; flagged in Task 14 Step 5.
