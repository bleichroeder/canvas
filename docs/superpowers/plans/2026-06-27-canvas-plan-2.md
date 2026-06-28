# Canvas Plan 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-source IA (aggregate home + per-source mini-home + source picker), QR-code pairing, PIN auto-format, per-screen visual polish (hero, episode list, skeletons, error Alerts, empty states), live source-status pings in Settings, and the Plan 1 deferrals (tsconfig flags, item-title cache, theme cssVariables).

**Architecture:** Two new worker routes (`/api/source-status`, `/api/source-home`) and one extended (`/api/home` gains `libraryCounts`). Frontend gains `/source/:src` route, four new components (`SourcePickerCard`, `LibraryCard`, `SourceCard`, `EmptyState`), and one new view (`SourceHome.tsx`). Per-screen visual redesigns rewrite Home/SourceHome/ItemDetail/Library/Search/Settings/Pair in place. Existing `/lib/:src` (bare) redirects to `/source/:src`.

**Tech Stack:** React 18, MUI v6 (`Skeleton`, `Alert`, `Backdrop`, `Dialog`, `Switch`, `Select`, `LinearProgress`, `ListItemButton`, `Stack`, `Chip` are all already-installed), Inter, Vite, TypeScript strict, Cloudflare Workers + KV, Vitest on worker. New runtime dep: `qrcode` (~10 KB minified, SVG output).

## Global Constraints

- All work on the **`v2` branch**, builds on commit `595b725` (Plan 2 spec).
- TypeScript strict throughout.
- Worker uses Vitest for unit tests on pure logic. Frontend has no automated tests — manual smoke per task.
- The `<Source>` crumb on `/lib/:src/:libId` and `/item/:src/:id` links to `/source/:src` (NOT the deprecated `/lib/:src`).
- Aggregate home picker is hidden when `Object.keys(getSources()).length === 1`.
- Per-source-status returns 4 states: `'ok'`, `'degraded'`, `'unreachable'`, `'lan-only'`. The `'lan-only'` state means the worker short-circuited (RFC1918 hostname) without probing. Always HTTP 200 except unknown source key (404).
- RFC1918 ranges: `10.0.0.0/8`, `172.16.0.0` through `172.31.255.255`, `192.168.0.0/16`. Plex `plex.direct` subdomains encode IP as dash-separated (`192-168-1-100.abc123.plex.direct`).
- LocalStorage keys this plan adds: `canvas.itemTitles` (JSON map `<src>:<id>` → title).
- New worker KV keys this plan adds: `status:<srcKey>` (30-second TTL cache).
- The QR encodes `${window.location.protocol}//${window.location.host}/#/pair?code=${pin}&type=${sourceType}`.
- PIN strip-and-format: 6 alphanumeric chars, uppercased, dash inserted at index 3 of the stripped form.
- Bundle target: under 750 KB / 210 KB gzip after this plan.
- The repo dir name stays `C:\github\passenger\`.
- New runtime dependency: `qrcode ^1.5.0`.

---

## Task 1: Plan 1 deferrals (tsconfig flags + item-title cache + theme cssVariables)

**Files:**
- Modify: `web/tsconfig.json`
- Modify: `web/src/storage.ts` (append helpers)
- Modify: `web/src/theme.ts` (add `cssVariables: true`)
- Possibly modify: any web/src/**.tsx files flagged by `tsc --noEmit` as having unused locals/parameters

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `getItemTitle(srcKey, itemId): string | undefined` and `setItemTitle(srcKey, itemId, title): void` exported from `web/src/storage.ts`.
  - Theme builds with CSS variables enabled (MUI emits `:root { --mui-palette-* }` properties at runtime).
  - Codebase compiles cleanly under strict `noUnusedLocals` + `noUnusedParameters`.

- [ ] **Step 1: Add the tsconfig flags**

Open `web/tsconfig.json`. Inside `compilerOptions`, add:

```json
"noUnusedLocals": true,
"noUnusedParameters": true,
```

The full `compilerOptions` should look like (preserving any order):

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
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 2: Run typecheck and triage**

```powershell
cd C:\github\passenger\web
npx tsc --noEmit
```

If any unused-local/parameter errors surface: open each flagged file and either delete the unused identifier (preferred) or prefix it with `_` if it's a function parameter that must stay for API conformance. Re-run until clean.

If a flagged unused identifier is part of a TypeScript prop interface that's intentional (e.g., for future use), suppress with `// eslint-disable-next-line @typescript-eslint/no-unused-vars` — but only if the parameter cannot be removed.

- [ ] **Step 3: Add item-title cache helpers to `web/src/storage.ts`**

At the bottom of `web/src/storage.ts` (after `getSourceLabel`), append:

```typescript
const ITEM_TITLES_KEY = 'canvas.itemTitles';

export function getItemTitle(srcKey: string, itemId: string): string | undefined {
  try {
    const raw = localStorage.getItem(ITEM_TITLES_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const k = `${srcKey}:${itemId}`;
    const v = (parsed as Record<string, unknown>)[k];
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function setItemTitle(srcKey: string, itemId: string, title: string): void {
  try {
    const raw = localStorage.getItem(ITEM_TITLES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (typeof parsed === 'object' && parsed !== null) {
      (parsed as Record<string, string>)[`${srcKey}:${itemId}`] = title;
      localStorage.setItem(ITEM_TITLES_KEY, JSON.stringify(parsed));
    }
  } catch { /* ignore */ }
}
```

- [ ] **Step 4: Enable theme CSS variables**

Open `web/src/theme.ts`. Change:

```typescript
export const theme = createTheme({
  palette: {
```

To:

```typescript
export const theme = createTheme({
  cssVariables: true,
  palette: {
```

Just one line added at the top of the createTheme options.

- [ ] **Step 5: Verify build still passes**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds. Record bundle JS size + gzip — note for ledger. If size moved by >50 KB, investigate.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/tsconfig.json web/src/storage.ts web/src/theme.ts
# plus any source files you touched for unused-local cleanup
git status
git add <other touched files if any>
git commit -m "Plan 1 deferrals: tsconfig strict flags + item-title cache + theme cssVariables"
```

---

## Task 2: Worker — `GET /api/source-status?key=X` route + RFC1918 detection

**Files:**
- Create: `worker/src/lib/rfc1918.ts`
- Create: `worker/src/lib/rfc1918.test.ts`
- Create: `worker/src/routes/source-status.ts`
- Create: `worker/src/routes/source-status.test.ts`
- Modify: `worker/src/index.ts` (wire the route)

**Interfaces:**
- Consumes:
  - `parseXSources(req)` from `../x-sources` returns `Record<string, ParsedSource>` where `ParsedSource = { type, baseUrl, token }`.
  - `withCors(req, res)` from `../cors`.
  - `Env.KV` from `../index`.
- Produces:
  - `isRfc1918Host(host: string): boolean` exported from `worker/src/lib/rfc1918.ts`.
  - `handleSourceStatus(req, env, url): Promise<Response>` exported from `worker/src/routes/source-status.ts`.
  - Worker route `GET /api/source-status?key=<srcKey>` returning JSON `{ status, lastSeenAt }` or `{ error }`.

- [ ] **Step 1: Write failing tests for `isRfc1918Host`**

Create `worker/src/lib/rfc1918.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isRfc1918Host } from './rfc1918';

describe('isRfc1918Host', () => {
  it('returns true for bare 10.x literal', () => {
    expect(isRfc1918Host('10.0.0.1')).toBe(true);
    expect(isRfc1918Host('10.255.255.255')).toBe(true);
  });

  it('returns true for bare 192.168.x literal', () => {
    expect(isRfc1918Host('192.168.1.1')).toBe(true);
    expect(isRfc1918Host('192.168.255.255')).toBe(true);
  });

  it('returns true for bare 172.16-31.x literal', () => {
    expect(isRfc1918Host('172.16.0.1')).toBe(true);
    expect(isRfc1918Host('172.31.255.255')).toBe(true);
  });

  it('returns false for 172.15.x and 172.32.x', () => {
    expect(isRfc1918Host('172.15.0.1')).toBe(false);
    expect(isRfc1918Host('172.32.0.1')).toBe(false);
  });

  it('returns false for public IPs', () => {
    expect(isRfc1918Host('8.8.8.8')).toBe(false);
    expect(isRfc1918Host('1.1.1.1')).toBe(false);
  });

  it('decodes plex.direct subdomain IP encoding', () => {
    expect(isRfc1918Host('192-168-1-100.abc123def456.plex.direct')).toBe(true);
    expect(isRfc1918Host('10-0-0-5.xyz.plex.direct')).toBe(true);
    expect(isRfc1918Host('172-20-0-1.abc.plex.direct')).toBe(true);
  });

  it('returns false for public plex.direct hostnames', () => {
    expect(isRfc1918Host('32-218-121-209.abc.plex.direct')).toBe(false);
  });

  it('returns false for ordinary hostnames', () => {
    expect(isRfc1918Host('example.com')).toBe(false);
    expect(isRfc1918Host('media.tld')).toBe(false);
    expect(isRfc1918Host('localhost')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isRfc1918Host('')).toBe(false);
    expect(isRfc1918Host('not-an-ip')).toBe(false);
    expect(isRfc1918Host('192.168.1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
cd C:\github\passenger\worker
npx vitest run src/lib/rfc1918.test.ts
```

Expected: FAIL with "Cannot find module './rfc1918'".

- [ ] **Step 3: Implement `worker/src/lib/rfc1918.ts`**

```typescript
const IP_LITERAL_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const PLEX_DIRECT_RE = /^(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\.[^.]+\.plex\.direct$/i;

function rangeMatches(a: number, b: number, c: number): boolean {
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  // c, d unused — RFC1918 ranges are determined by a and b.
  void c;
  return false;
}

function parseOctets(s: string): [number, number, number, number] | null {
  const m = IP_LITERAL_RE.exec(s);
  if (!m) return null;
  const a = Number(m[1]); const b = Number(m[2]);
  const c = Number(m[3]); const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
  return [a, b, c, d];
}

export function isRfc1918Host(host: string): boolean {
  if (!host) return false;
  // 1. Bare IP literal
  const direct = parseOctets(host);
  if (direct) {
    return rangeMatches(direct[0], direct[1], direct[2]);
  }
  // 2. plex.direct subdomain encoding
  const plex = PLEX_DIRECT_RE.exec(host);
  if (plex) {
    const a = Number(plex[1]); const b = Number(plex[2]);
    const c = Number(plex[3]); const d = Number(plex[4]);
    if ([a, b, c, d].some((n) => n < 0 || n > 255)) return false;
    return rangeMatches(a, b, c);
  }
  return false;
}
```

- [ ] **Step 4: Run tests, verify pass**

```powershell
cd C:\github\passenger\worker
npx vitest run src/lib/rfc1918.test.ts
```

Expected: 9 tests pass.

- [ ] **Step 5: Write failing tests for `handleSourceStatus`**

Create `worker/src/routes/source-status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSourceStatus } from './source-status';

interface FakeKV {
  get: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
}

function fakeKV(): FakeKV {
  return {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  };
}

function makeReq(sources: Record<string, { type: string; baseUrl: string; token: string }>) {
  return new Request('https://api.test/api/source-status', {
    headers: { 'x-sources': JSON.stringify(sources) },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('handleSourceStatus', () => {
  it('returns 404 for unknown source key', async () => {
    const url = new URL('https://api.test/api/source-status?key=missing');
    const res = await handleSourceStatus(makeReq({}), { KV: fakeKV() } as never, url);
    expect(res.status).toBe(404);
  });

  it('returns lan-only when source baseUrl is RFC1918', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'http://192.168.1.5:32400', token: 't' },
    });
    const kv = fakeKV();
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'lan-only', lastSeenAt: null });
  });

  it('returns lan-only for plex.direct LAN subdomain', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://192-168-1-100.abc.plex.direct:32400', token: 't' },
    });
    const res = await handleSourceStatus(req, { KV: fakeKV() } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'lan-only', lastSeenAt: null });
  });

  it('returns cached value when KV has a fresh entry', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    kv.get.mockResolvedValueOnce(JSON.stringify({ status: 'ok', lastSeenAt: 1234 }));
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', lastSeenAt: 1234 });
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('probes Plex /identity and returns ok on 200', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{}', { status: 200 }),
    );
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(typeof body.lastSeenAt).toBe('number');
    expect(fetchMock).toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalled();
  });

  it('returns unreachable when probe fetch fails', async () => {
    const url = new URL('https://api.test/api/source-status?key=plex1');
    const req = makeReq({
      plex1: { type: 'plex', baseUrl: 'https://public.example.com', token: 't' },
    });
    const kv = fakeKV();
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network'));
    const res = await handleSourceStatus(req, { KV: kv } as never, url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('unreachable');
    expect(body.lastSeenAt).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests, verify they fail**

```powershell
cd C:\github\passenger\worker
npx vitest run src/routes/source-status.test.ts
```

Expected: FAIL with "Cannot find module './source-status'".

- [ ] **Step 7: Implement `worker/src/routes/source-status.ts`**

```typescript
import { withCors } from '../cors';
import { parseXSources } from '../x-sources';
import { isRfc1918Host } from '../lib/rfc1918';
import type { Env } from '../index';

const CACHE_TTL_SEC = 30;
const PROBE_TIMEOUT_MS = 3000;

interface StatusResponse {
  status: 'ok' | 'degraded' | 'unreachable' | 'lan-only';
  lastSeenAt: number | null;
}

function probePath(type: string): string {
  switch (type) {
    case 'plex': return '/identity';
    case 'jellyfin': return '/System/Info/Public';
    default: return '/';
  }
}

async function probe(type: string, baseUrl: string, token: string): Promise<StatusResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let url = `${baseUrl}${probePath(type)}`;
    if (type === 'plex') {
      url += `?X-Plex-Token=${encodeURIComponent(token)}`;
    }
    const res = await fetch(url, { signal: controller.signal, headers });
    if (res.ok) return { status: 'ok', lastSeenAt: Date.now() };
    return { status: 'degraded', lastSeenAt: Date.now() };
  } catch {
    return { status: 'unreachable', lastSeenAt: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleSourceStatus(req: Request, env: Env, url: URL): Promise<Response> {
  const key = url.searchParams.get('key');
  if (!key) {
    return withCors(req, new Response(JSON.stringify({ error: 'missing key' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }

  const sources = parseXSources(req);
  const src = sources[key];
  if (!src) {
    return withCors(req, new Response(JSON.stringify({ error: 'unknown source key' }), {
      status: 404, headers: { 'content-type': 'application/json' },
    }));
  }

  let host = '';
  try { host = new URL(src.baseUrl).hostname; } catch { host = ''; }

  if (isRfc1918Host(host)) {
    const body: StatusResponse = { status: 'lan-only', lastSeenAt: null };
    return withCors(req, new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json' },
    }));
  }

  const cacheKey = `status:${key}`;
  const cached = await env.KV.get(cacheKey);
  if (cached) {
    return withCors(req, new Response(cached, {
      headers: { 'content-type': 'application/json' },
    }));
  }

  const result = await probe(src.type, src.baseUrl, src.token);
  const payload = JSON.stringify(result);
  await env.KV.put(cacheKey, payload, { expirationTtl: CACHE_TTL_SEC });
  return withCors(req, new Response(payload, {
    headers: { 'content-type': 'application/json' },
  }));
}
```

- [ ] **Step 8: Wire the route in `worker/src/index.ts`**

Add an import near the others:

```typescript
import { handleSourceStatus } from './routes/source-status';
```

Inside the `route()` function, after the existing `/api/home` and `/api/search` lines, before the `// Per-source` block, add:

```typescript
  if (url.pathname === '/api/source-status' && req.method === 'GET') return handleSourceStatus(req, env, url);
```

- [ ] **Step 9: Run all tests, verify pass**

```powershell
cd C:\github\passenger\worker
npm test
```

Expected: all previous tests still pass, plus the new ones from Steps 1 and 5. Total count should be original count + 15.

- [ ] **Step 10: Typecheck the worker**

```powershell
cd C:\github\passenger\worker
npm run typecheck
```

Expected: clean.

- [ ] **Step 11: Commit**

```powershell
cd C:\github\passenger
git add worker/src/lib/rfc1918.ts worker/src/lib/rfc1918.test.ts worker/src/routes/source-status.ts worker/src/routes/source-status.test.ts worker/src/index.ts
git commit -m "Worker: GET /api/source-status with RFC1918 detection + KV cache"
```

---

## Task 3: Worker — `/api/source-home` route + extend `/api/home` with `libraryCounts`

**Files:**
- Create: `worker/src/routes/source-home.ts`
- Create: `worker/src/routes/source-home.test.ts`
- Modify: `worker/src/routes/home.ts` (add `libraryCounts`)
- Modify: `worker/src/index.ts` (wire the route)

**Interfaces:**
- Consumes:
  - `callOneSource(sources, key, fn)` from `../dispatch` (returns the function's result, throws if source missing).
  - `getAdapter(type)` from `../sources/registry`.
  - `parseXSources(req)` from `../x-sources`.
  - `callPerSource(sources, fn)` from `../dispatch`.
- Produces:
  - `handleSourceHome(req, url, srcKey): Promise<Response>` exported from `worker/src/routes/source-home.ts`.
  - Worker route `GET /api/source-home?key=<srcKey>` returning `{ continueWatching, recentlyAdded, libraries }`.
  - Extended `/api/home` response now includes `libraryCounts: { [srcKey]: number }`.

- [ ] **Step 1: Write failing tests for `handleSourceHome`**

Create `worker/src/routes/source-home.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSourceHome } from './source-home';
import { registerAdapter } from '../sources/registry';
import type { SourceAdapter } from '../sources/types';

function makeReq(sources: Record<string, { type: string; baseUrl: string; token: string }>) {
  return new Request('https://api.test/api/source-home', {
    headers: { 'x-sources': JSON.stringify(sources) },
  });
}

const fakeAdapter: SourceAdapter = {
  type: 'plex',
  startPair: async () => ({ pairUrl: '', expiresAt: 0 }),
  home: async () => [
    { kind: 'continue', title: 'Continue Watching', items: [{ id: '1', type: 'movie', title: 'Item 1' }] },
    { kind: 'recent', title: 'Recently Added', items: [{ id: '2', type: 'movie', title: 'Item 2' }] },
  ],
  search: async () => [],
  library: async (_ctx, libraryId) => {
    if (!libraryId) {
      return {
        breadcrumbs: [{ name: 'Libraries' }],
        items: [
          { id: 'lib1', type: 'folder', title: 'Movies' },
          { id: 'lib2', type: 'folder', title: 'Shows' },
        ],
      };
    }
    return { breadcrumbs: [], items: [] };
  },
  item: async () => ({ id: '1', type: 'movie', title: 'X' }),
  resolveStream: async () => ({ url: '', durationSec: 0 }),
  saveProgress: async () => undefined,
};

beforeEach(() => {
  registerAdapter(fakeAdapter);
  vi.restoreAllMocks();
});

describe('handleSourceHome', () => {
  it('returns continue/recent/libraries for a known source', async () => {
    const url = new URL('https://api.test/api/source-home?key=plex1');
    const req = makeReq({ plex1: { type: 'plex', baseUrl: 'https://x', token: 't' } });
    const res = await handleSourceHome(req, url, 'plex1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.continueWatching).toHaveLength(1);
    expect(body.continueWatching[0].id).toBe('1');
    expect(body.recentlyAdded).toHaveLength(1);
    expect(body.recentlyAdded[0].id).toBe('2');
    expect(body.libraries).toHaveLength(2);
    expect(body.libraries[0].title).toBe('Movies');
  });

  it('returns 404 for unknown source', async () => {
    const url = new URL('https://api.test/api/source-home?key=missing');
    const req = makeReq({});
    const res = await handleSourceHome(req, url, 'missing');
    expect(res.status).toBe(404);
  });

  it('returns empty arrays when source returns nothing', async () => {
    registerAdapter({
      ...fakeAdapter,
      home: async () => [],
      library: async () => ({ breadcrumbs: [], items: [] }),
    });
    const url = new URL('https://api.test/api/source-home?key=plex1');
    const req = makeReq({ plex1: { type: 'plex', baseUrl: 'https://x', token: 't' } });
    const res = await handleSourceHome(req, url, 'plex1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.continueWatching).toEqual([]);
    expect(body.recentlyAdded).toEqual([]);
    expect(body.libraries).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```powershell
cd C:\github\passenger\worker
npx vitest run src/routes/source-home.test.ts
```

Expected: FAIL with "Cannot find module './source-home'".

- [ ] **Step 3: Implement `worker/src/routes/source-home.ts`**

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleSourceHome(req: Request, _url: URL, srcKey: string): Promise<Response> {
  const sources = parseXSources(req);
  try {
    const data = await callOneSource(sources, srcKey, async (src) => {
      const adapter = getAdapter(src.type);
      const ctx = { baseUrl: src.baseUrl, token: src.token };
      const [rows, libsResult] = await Promise.all([
        adapter.home(ctx),
        adapter.library(ctx).catch(() => ({ breadcrumbs: [], items: [] })),
      ]);
      const continueWatching = rows.find((r) => r.kind === 'continue')?.items ?? [];
      const recentlyAdded = rows.find((r) => r.kind === 'recent')?.items ?? [];
      const libraries = libsResult.items.filter((i) => i.type === 'folder');
      return { continueWatching, recentlyAdded, libraries };
    });
    return withCors(req, new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    const msg = String(message);
    const httpStatus = msg.startsWith('source not paired:') ? 404 : status;
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status: httpStatus, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```powershell
cd C:\github\passenger\worker
npx vitest run src/routes/source-home.test.ts
```

Expected: 3 tests pass.

- [ ] **Step 5: Extend `/api/home` to include `libraryCounts`**

Open `worker/src/routes/home.ts`. Replace the file contents with:

```typescript
import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleHome(req: Request): Promise<Response> {
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    const ctx = { baseUrl: src.baseUrl, token: src.token };
    const [home, libs] = await Promise.all([
      adapter.home(ctx),
      adapter.library(ctx).then((r) => r.items.filter((i) => i.type === 'folder').length).catch(() => 0),
    ]);
    return { home, libCount: libs };
  });
  const rows = Object.entries(results).flatMap(([key, rs]) =>
    rs.home.map((r) => ({ ...r, source: key })),
  );
  const libraryCounts: Record<string, number> = {};
  for (const [key, rs] of Object.entries(results)) libraryCounts[key] = rs.libCount;
  return withCors(
    req,
    new Response(JSON.stringify({ rows, errors, libraryCounts }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}
```

- [ ] **Step 6: Wire the new route in `worker/src/index.ts`**

Add the import:

```typescript
import { handleSourceHome } from './routes/source-home';
```

Inside `route()`, near the `/api/library/...` match, add **before** it (so the more-specific path matches first — actually `/api/source-home` doesn't overlap with `/api/library/...`, but keep grouping clean):

```typescript
  const srcHomeMatch = url.pathname === '/api/source-home';
  if (srcHomeMatch && req.method === 'GET') {
    const key = url.searchParams.get('key');
    if (!key) {
      return withCors(req, new Response(JSON.stringify({ error: 'missing key' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      }));
    }
    return handleSourceHome(req, url, key);
  }
```

You'll need `withCors` imported — it's already imported via `corsHeaders, withCors` at the top.

- [ ] **Step 7: Run all worker tests**

```powershell
cd C:\github\passenger\worker
npm test
```

Expected: all tests pass. The home.ts change doesn't break the existing home.test.ts (the new `libraryCounts` field is additive). If any home test breaks because it asserted exact shape, update it minimally to allow the new field.

- [ ] **Step 8: Typecheck**

```powershell
cd C:\github\passenger\worker
npm run typecheck
```

Expected: clean.

- [ ] **Step 9: Commit**

```powershell
cd C:\github\passenger
git add worker/src/routes/source-home.ts worker/src/routes/source-home.test.ts worker/src/routes/home.ts worker/src/index.ts
git commit -m "Worker: GET /api/source-home + libraryCounts on /api/home"
```

---

## Task 4: New `/source/:src` route + `<SourceHome>` view scaffold

**Files:**
- Create: `web/src/views/SourceHome.tsx`
- Create: `web/src/components/LibraryCard.tsx`
- Modify: `web/src/api.ts` (add `sourceHome()` method; update `home()` return type to include `libraryCounts`)
- Modify: `web/src/types.ts` (add types)
- Modify: `web/src/main.tsx` (add route)

**Interfaces:**
- Consumes:
  - Worker `/api/source-home` from Task 3.
  - `AppShell` from `../components/AppShell`.
  - `Rail` and `PosterCard` from existing components (no changes needed).
- Produces:
  - `<SourceHome source={src}/>` component.
  - `<LibraryCard library={Item} source={srcKey}/>` component (`Item` is the folder-typed item from BrowseResult).
  - `api.sourceHome(srcKey): Promise<SourceHomeResponse>` where `SourceHomeResponse = { continueWatching: Item[], recentlyAdded: Item[], libraries: Item[] }`.
  - New route entry `['/source/:src', (p) => <SourceHome source={p.src!} />]` in main.tsx's route table.

- [ ] **Step 1: Add types to `web/src/types.ts`**

Append:

```typescript
export interface SourceHomeResponse {
  continueWatching: Item[];
  recentlyAdded: Item[];
  libraries: Item[];
}
```

- [ ] **Step 2: Add `sourceHome` to `web/src/api.ts`**

Inside the `api` object (just before the closing `}`):

```typescript
  sourceHome: (srcKey: string) =>
    request<import('./types').SourceHomeResponse>(`/api/source-home?key=${encodeURIComponent(srcKey)}`),
```

Also update the `home` return-type generic to include `libraryCounts: Record<string, number>`:

```typescript
  home: () => request<{
    rows: (HomeRow & { source: string })[];
    errors: { source: string; status: number; message: string }[];
    libraryCounts: Record<string, number>;
  }>('/api/home'),
```

- [ ] **Step 3: Create `web/src/components/LibraryCard.tsx`**

```tsx
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { Item } from '../types';

export interface LibraryCardProps {
  library: Item;
  source: string;
}

export function LibraryCard({ library, source }: LibraryCardProps) {
  return (
    <Card sx={{ width: 200 }}>
      <CardActionArea
        onClick={() => navigate(`/lib/${source}/${library.id}`)}
        sx={{ p: 2.5 }}
      >
        <Box sx={{ minHeight: 80, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Typography variant="body1" sx={{ fontWeight: 500, mb: 0.5 }}>
            {library.title}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}
```

- [ ] **Step 4: Create `web/src/views/SourceHome.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { LibraryCard } from '../components/LibraryCard';
import { getSourceLabel } from '../storage';
import type { SourceHomeResponse } from '../types';

interface Props { source: string }

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; data: SourceHomeResponse }
  | { kind: 'error'; message: string };

export function SourceHome({ source }: Props) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const label = getSourceLabel(source) ?? source;

  useEffect(() => {
    setState({ kind: 'loading' });
    api.sourceHome(source).then(
      (data) => setState({ kind: 'ok', data }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source]);

  return (
    <AppShell>
      <Box sx={{ py: 2.5 }}>
        {state.kind === 'loading' && (
          <Typography color="text.secondary" sx={{ px: 2.5 }}>Loading…</Typography>
        )}
        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5 }}>Error: {state.message}</Alert>
        )}
        {state.kind === 'ok' && (
          <>
            <Typography variant="h1" sx={{ px: 2.5, mb: 3 }}>{label}</Typography>
            <Rail
              title="Continue Watching"
              items={state.data.continueWatching.map((i) => ({ ...i, source }))}
              cardWidth={state.data.continueWatching[0]?.type === 'episode' ? 260 : 180}
            />
            <Rail
              title="Recently Added"
              items={state.data.recentlyAdded.map((i) => ({ ...i, source }))}
              cardWidth={state.data.recentlyAdded[0]?.type === 'episode' ? 260 : 180}
            />
            {state.data.libraries.length > 0 && (
              <Box component="section" sx={{ mb: 4 }}>
                <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>Libraries</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 200px)',
                    gap: 2.5,
                    px: 2.5,
                  }}
                >
                  {state.data.libraries.map((lib) => (
                    <LibraryCard key={lib.id} library={lib} source={source} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 5: Wire route in `web/src/main.tsx`**

Add the import:

```tsx
import { SourceHome } from './views/SourceHome';
```

In the route table inside `App()`, add **above** the `/lib/:src` patterns (so it matches first):

```tsx
    ['/source/:src', (p) => <SourceHome source={p.src!} />],
```

The final route table order should put `/source/:src` before `/lib/:src` and `/lib/:src/:libId`.

- [ ] **Step 6: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds. Type errors would be from the api.ts inline-type-import — if so, switch to a top-of-file import: `import type { SourceHomeResponse } from './types';`.

- [ ] **Step 7: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/SourceHome.tsx web/src/components/LibraryCard.tsx web/src/api.ts web/src/types.ts web/src/main.tsx
git commit -m "web: /source/:src route + SourceHome view + LibraryCard component"
```

---

## Task 5: Home redesign — hero + source picker grid + single-source fallback

**Files:**
- Modify: `web/src/views/Home.tsx`
- Create: `web/src/components/SourcePickerCard.tsx`

**Interfaces:**
- Consumes:
  - `api.home()` returning `{ rows, errors, libraryCounts }`.
  - `AppShell`, `Rail`, `PosterCard` from components.
  - `getSources()` from storage.
- Produces:
  - `<SourcePickerCard source={key} label={...} type={...} libraryCount={...} />`.
  - Home renders hero + cross-source rails + source picker (hidden when 1 source).

- [ ] **Step 1: Create `web/src/components/SourcePickerCard.tsx`**

```tsx
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { navigate } from '../router';
import type { StoredSource } from '../storage';

export interface SourcePickerCardProps {
  srcKey: string;
  label: string;
  type: StoredSource['type'];
  libraryCount?: number;
}

const TYPE_COLOR: Record<StoredSource['type'], string> = {
  plex: '#e5a00d',
  jellyfin: '#aa5cc3',
  flixify: '#cc3333',
  generic: '#6b7280',
};

const TYPE_GLYPH: Record<StoredSource['type'], string> = {
  plex: 'P',
  jellyfin: 'J',
  flixify: 'F',
  generic: '·',
};

export function SourcePickerCard({ srcKey, label, type, libraryCount }: SourcePickerCardProps) {
  return (
    <Card sx={{ width: 200 }}>
      <CardActionArea
        onClick={() => navigate(`/source/${srcKey}`)}
        sx={{ p: 2.5, minHeight: 140, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
      >
        <Box
          sx={{
            width: 40, height: 40, borderRadius: 1,
            backgroundColor: TYPE_COLOR[type],
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22,
          }}
        >
          {TYPE_GLYPH[type]}
        </Box>
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary">
            {libraryCount === undefined ? ' ' : `${libraryCount} ${libraryCount === 1 ? 'library' : 'libraries'}`}
          </Typography>
        </Box>
      </CardActionArea>
    </Card>
  );
}
```

- [ ] **Step 2: Replace `web/src/views/Home.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { api } from '../api';
import { getSources } from '../storage';
import { AppShell } from '../components/AppShell';
import { Rail } from '../components/Rail';
import { SourcePickerCard } from '../components/SourcePickerCard';
import { navigate } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[]; libraryCounts: Record<string, number> }
  | { kind: 'error'; message: string };

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

export function Home() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const sources = getSources();
  const sourceCount = Object.keys(sources).length;

  useEffect(() => {
    if (sourceCount === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors, libraryCounts }) => setState({ kind: 'ok', rows, errors, libraryCounts }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueRow = state.kind === 'ok'
    ? state.rows.find((r) => r.kind === 'continue')
    : undefined;
  const heroItem = continueRow?.items[0] as (Item & { backdrop?: string; source?: string }) | undefined;

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
        {state.kind === 'ok' && (
          <>
            {heroItem && heroItem.source && (
              <Box
                sx={{
                  height: 320,
                  mx: 2.5, mb: 3, borderRadius: 2,
                  position: 'relative', overflow: 'hidden',
                  backgroundImage: heroItem.poster ? `url(${heroItem.poster})` : 'linear-gradient(135deg, #1a2030, #0e0f12)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <Box
                  sx={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to right, rgba(14,15,18,0.95) 0%, rgba(14,15,18,0.6) 50%, transparent 100%)',
                  }}
                />
                <Box
                  sx={{
                    position: 'absolute', left: 32, top: 0, bottom: 0,
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    maxWidth: 480,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">Continue Watching</Typography>
                  <Typography variant="h1" sx={{ mt: 0.5, mb: 1 }}>{heroItem.title}</Typography>
                  <Typography color="text.secondary" sx={{ mb: 2 }}>
                    {[heroItem.year, formatRuntime(heroItem.durationSec)].filter(Boolean).join(' · ')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Button
                      variant="contained"
                      size="large"
                      startIcon={<PlayArrowIcon />}
                      onClick={() => navigate(`/play/${heroItem.source}/${heroItem.id}`)}
                    >
                      {heroItem.viewOffsetSec && heroItem.viewOffsetSec > 60
                        ? `Resume ${formatPos(heroItem.viewOffsetSec)}`
                        : 'Play'}
                    </Button>
                    {heroItem.viewOffsetSec && heroItem.viewOffsetSec > 60 && (
                      <Button
                        variant="text"
                        onClick={() => navigate(`/play/${heroItem.source}/${heroItem.id}?from=0`)}
                      >
                        Start over
                      </Button>
                    )}
                  </Box>
                </Box>
              </Box>
            )}

            {state.errors.length > 0 && (
              <Box sx={{ px: 2.5, pb: 2 }}>
                {state.errors.map((err) => (
                  <Alert key={err.source} severity="warning" sx={{ my: 0.5 }}>
                    {err.source}: {err.message}
                  </Alert>
                ))}
              </Box>
            )}

            {state.rows.map((row) => (
              <Rail
                key={`${row.source}:${row.kind}:${row.title}`}
                title={row.title}
                items={row.items.map((i: Item) => ({ ...i, source: row.source }))}
                cardWidth={row.items[0]?.type === 'episode' ? 260 : 180}
              />
            ))}

            {sourceCount > 1 && (
              <Box component="section" sx={{ mt: 4 }}>
                <Typography variant="h3" sx={{ px: 2.5, mb: 1.5 }}>Your sources</Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 200px)',
                    gap: 2.5,
                    px: 2.5,
                  }}
                >
                  {Object.entries(sources).map(([key, src]) => (
                    <SourcePickerCard
                      key={key}
                      srcKey={key}
                      label={src.label}
                      type={src.type}
                      libraryCount={state.libraryCounts[key]}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {state.rows.length === 0 && state.errors.length === 0 && (
              <Typography color="text.secondary" sx={{ px: 2.5 }}>
                Your sources are paired but returned nothing yet.
              </Typography>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Home.tsx web/src/components/SourcePickerCard.tsx
git commit -m "web: Home — hero + source picker grid + single-source fallback"
```

---

## Task 6: Breadcrumb updates — Source crumb links to /source/:src; item-title plumbing

**Files:**
- Modify: `web/src/components/Breadcrumbs.tsx`
- Modify: `web/src/views/ItemDetail.tsx` (write item title to cache after fetch)

**Interfaces:**
- Consumes:
  - `getItemTitle(srcKey, itemId): string | undefined` from `../storage` (added in Task 1).
  - `setItemTitle(srcKey, itemId, title): void` from `../storage` (added in Task 1).
  - `getSourceLabel(srcKey)`, `getLibraryName(srcKey, libId)` already in storage.
- Produces: Breadcrumbs that link the source crumb to `/source/:src` and use the cached item title.

- [ ] **Step 1: Update `web/src/components/Breadcrumbs.tsx`**

Replace the imports and `deriveCrumbs` function. Read the current file first; specifically the file has a `deriveCrumbs(path)` function — replace its implementation to:

1. Change the `/lib/:src` branch's href (when there's also a `parts[2]` libId): the parent-source crumb's href goes from `/lib/${src}` to `/source/${src}`.
2. Change the `/item/:src/:id` branch to push a crumb for the item title (`getItemTitle(parts[1]!, parts[2]!) ?? 'Item'`), and the source crumb's href to `/source/${parts[1]}`.

Specifically, find and replace this block:

```typescript
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
```

With:

```typescript
  // /source/:src
  if (parts[0] === 'source' && parts[1]) {
    crumbs.push({ label: getSourceLabel(parts[1]) ?? parts[1] });
    return crumbs;
  }
  // /lib/:src/:libId — bare /lib/:src is deprecated (T7 redirects it)
  if (parts[0] === 'lib') {
    const src = parts[1];
    if (src) {
      crumbs.push({
        label: getSourceLabel(src) ?? src,
        href: parts.length > 2 ? `/source/${src}` : undefined,
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
    crumbs.push({ label: getSourceLabel(parts[1]) ?? parts[1], href: `/source/${parts[1]}` });
    crumbs.push({ label: getItemTitle(parts[1], parts[2]) ?? 'Item' });
    return crumbs;
  }
```

And update the imports at the top:

```typescript
import { getSourceLabel, getLibraryName, getItemTitle } from '../storage';
```

- [ ] **Step 2: Write item title from ItemDetail view**

Open `web/src/views/ItemDetail.tsx`. In the `useEffect` that calls `api.item(...)`, after the `setState({ kind: 'ok', item })` line, add a `setItemTitle` call. Find:

```tsx
    api.item(source, id).then(
      (item) => setState({ kind: 'ok', item }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
```

Change to:

```tsx
    api.item(source, id).then(
      (item) => {
        setItemTitle(source, id, item.title);
        setState({ kind: 'ok', item });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
```

And update the imports to include `setItemTitle`:

```tsx
import { setItemTitle } from '../storage';
```

- [ ] **Step 3: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/Breadcrumbs.tsx web/src/views/ItemDetail.tsx
git commit -m "web: source crumb links to /source/:src; item-title plumbing"
```

---

## Task 7: Deprecate `/lib/:src` (redirect to `/source/:src`)

**Files:**
- Modify: `web/src/views/Library.tsx` (early redirect if no libraryId)
- Modify: `web/src/components/PosterCard.tsx` (folder navigation review)
- Modify: `web/src/views/Settings.tsx` (any place that linked to `/lib/:src`)
- Modify: `web/src/views/PhonePair.tsx` (no — this doesn't link to lib)

**Interfaces:**
- Consumes: `navigate(path)` from router; `useEffect`.
- Produces: visiting `/lib/:src` (no libraryId) redirects to `/source/:src`. The `/lib/:src/:libId` deep route still works unchanged.

- [ ] **Step 1: Add redirect to `web/src/views/Library.tsx`**

Open `web/src/views/Library.tsx`. The component currently accepts `libraryId?: string`. Add a redirect at the top:

```tsx
export function Library({ source, libraryId }: Props) {
  useEffect(() => {
    if (!libraryId) {
      navigate(`/source/${source}`);
    }
  }, [source, libraryId]);
```

Make sure `navigate` is imported:

```tsx
import { navigate } from '../router';
```

Then guard the rest of the render with an early return:

```tsx
  if (!libraryId) {
    // Redirect in flight; render nothing this tick.
    return null;
  }
```

Add the early return AFTER the existing useEffect that calls `api.library(source, libraryId)`. The state machine etc. all stay; just the no-libId branch redirects.

Actually the cleanest fix: place the redirect-and-return at the very top of the component body, before any other hooks. But all hooks must be called in the same order each render, so use:

```tsx
export function Library({ source, libraryId }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; data: BrowseResult }
    | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    if (!libraryId) {
      navigate(`/source/${source}`);
      return;
    }
    setState({ kind: 'loading' });
    api.library(source, libraryId).then(
      (data) => {
        const last = data.breadcrumbs[data.breadcrumbs.length - 1];
        if (libraryId && last && last.libraryId === libraryId && last.name) {
          setLibraryName(source, libraryId, last.name);
        }
        setState({ kind: 'ok', data });
      },
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  if (!libraryId) return null;
  // ... rest of render unchanged
```

Add this `if (!libraryId) return null;` BEFORE the return statement that renders the AppShell + grid.

- [ ] **Step 2: PosterCard folder navigation review**

Open `web/src/components/PosterCard.tsx`. Currently:

```tsx
  const href = isFolder
    ? `/lib/${source}/${item.id}`
    : `/item/${source}/${item.id}`;
```

Folder items appear in: per-library item browsing (where `item.type === 'folder'` could be a sub-folder — currently Plex returns these only at the library-listing level). After T7, the library-listing level redirects to `/source/:src`, so PosterCard folder cards inside `/lib/:src/:libId` would only show real folders within a library (rare for Plex). Leave the href as `/lib/${source}/${item.id}` — that's still correct for sub-folder navigation.

No change needed. Verify by reading PosterCard.tsx.

- [ ] **Step 3: Settings — review for any `/lib/:src` links**

Open `web/src/views/Settings.tsx`. The Source cards don't link anywhere (they show source info; clicking does nothing currently). No change needed in this task. (T11 reworks the Settings source row entirely.)

- [ ] **Step 4: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Library.tsx
git commit -m "web: /lib/:src redirects to /source/:src"
```

---

## Task 8: ItemDetail visual redesign — backdrop hero + poster overhang + episode List + LinearProgress

**Files:**
- Modify: `web/src/views/ItemDetail.tsx`

**Interfaces:**
- Consumes: existing `api.item()`, MUI components (Stack, Chip, List, ListItemButton, Avatar, LinearProgress, Box, Typography, Button).
- Produces: redesigned ItemDetail layout per the spec Section 3.

- [ ] **Step 1: Replace `web/src/views/ItemDetail.tsx`**

Read the existing file first to preserve the `formatRuntime`/`formatPos` helpers and the `setItemTitle` wiring from Task 6. Then replace with:

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Avatar from '@mui/material/Avatar';
import LinearProgress from '@mui/material/LinearProgress';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StarIcon from '@mui/icons-material/Star';
import { api } from '../api';
import { AppShell } from '../components/AppShell';
import { navigate } from '../router';
import { setItemTitle } from '../storage';
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

function Dot() {
  return <Box component="span" sx={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: 'text.secondary' }} />;
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
      (item) => {
        setItemTitle(source, id, item.title);
        setState({ kind: 'ok', item });
      },
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
  const genres: string[] = []; // TODO: when adapter exposes genres on ItemDetail, wire here. (no genres for v1)

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
              background: 'linear-gradient(to bottom, transparent 40%, var(--mui-palette-background-default) 100%)',
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
              sx={{ width: 200, height: 300, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
            />
          )}
          <Box sx={{ flex: 1, pt: item.backdrop ? 7.5 : 0 }}>
            <Typography variant="h1" sx={{ mb: 1 }}>{item.title}</Typography>
            <Stack direction="row" spacing={1.5} alignItems="center" divider={<Dot />} sx={{ mb: 1, color: 'text.secondary' }}>
              {item.year && <Typography variant="body2">{item.year}</Typography>}
              {item.durationSec && <Typography variant="body2">{formatRuntime(item.durationSec)}</Typography>}
              {item.rating !== undefined && (
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <StarIcon fontSize="small" sx={{ color: '#f5a623' }} />
                  <Typography variant="body2">{item.rating.toFixed(1)}</Typography>
                </Stack>
              )}
            </Stack>
            {genres.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                {genres.map((g) => <Chip key={g} label={g} size="small" variant="outlined" />)}
              </Stack>
            )}
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
            <List sx={{ p: 0 }}>
              {item.episodes.map((ep) => {
                const pct = ep.durationSec && ep.viewOffsetSec
                  ? Math.min(100, Math.round((ep.viewOffsetSec / ep.durationSec) * 100))
                  : 0;
                const resumeEp = (ep.viewOffsetSec ?? 0) > 60;
                return (
                  <ListItemButton
                    key={ep.id}
                    onClick={() => navigate(`/play/${source}/${ep.id}`)}
                    sx={{
                      position: 'relative',
                      mb: 1, p: 1.5,
                      backgroundColor: 'background.paper',
                      border: '1px solid', borderColor: 'divider',
                      borderRadius: 1,
                      gap: 2, alignItems: 'flex-start',
                    }}
                  >
                    {ep.poster && (
                      <Avatar
                        variant="rounded"
                        src={ep.poster}
                        sx={{ width: 160, height: 90, flexShrink: 0 }}
                      />
                    )}
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }}>
                        S{ep.season}·E{ep.episode} · {ep.title}
                      </Typography>
                      <Stack direction="row" spacing={1.5} divider={<Dot />} sx={{ mt: 0.5, color: 'text.secondary' }}>
                        {ep.durationSec && <Typography variant="caption">{formatRuntime(ep.durationSec)}</Typography>}
                        {resumeEp && <Typography variant="caption">Resume {formatPos(ep.viewOffsetSec!)}</Typography>}
                      </Stack>
                      {ep.synopsis && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                          {ep.synopsis}
                        </Typography>
                      )}
                    </Box>
                    {resumeEp && (
                      <LinearProgress
                        variant="determinate"
                        value={pct}
                        sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: 0 }}
                      />
                    )}
                  </ListItemButton>
                );
              })}
            </List>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/ItemDetail.tsx
git commit -m "web: ItemDetail visual redesign — backdrop hero + poster overhang + episode List"
```

---

## Task 9: Library header band + count + EmptyState consumption (placeholder before T15 creates EmptyState)

**Files:**
- Modify: `web/src/views/Library.tsx`

**Interfaces:**
- Consumes: existing `api.library()`; eventually `EmptyState` from T15 (uses inline empty state copy for now).
- Produces: Library with `<Typography variant="h1">` header + item count caption.

- [ ] **Step 1: Update `web/src/views/Library.tsx`**

After Task 7's redirect-guard, the Library component already renders when `libraryId` is set. Add a header band above the grid. Specifically, in the existing render path (the `{state.kind === 'ok' && ...}` branch), wrap the existing `<Box sx={{ display: 'grid', ... }}>` in a parent `<Box>` that adds the header first:

```tsx
        {state.kind === 'ok' && (
          <>
            <Box sx={{ mb: 3 }}>
              <Typography variant="h1">
                {state.data.breadcrumbs[state.data.breadcrumbs.length - 1]?.name ?? 'Library'}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                  · {state.data.items.length} {state.data.items.length === 1 ? 'item' : 'items'}
                </Typography>
              </Typography>
            </Box>
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
            {state.data.items.length === 0 && (
              <Box sx={{ py: 5, textAlign: 'center' }}>
                <Typography variant="h3" sx={{ mb: 1 }}>This library is empty</Typography>
                <Button onClick={() => navigate(`/source/${source}`)}>Back to source</Button>
              </Box>
            )}
          </>
        )}
```

The inline empty state is a placeholder for Task 15's `<EmptyState>` component — T15 will rewrite this to use the new component.

Add the missing import for `Button` if not already there (it's in MUI material).

- [ ] **Step 2: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Library.tsx
git commit -m "web: Library — h1 header + count + inline empty state (EmptyState comes T15)"
```

---

## Task 10: Search grouped-by-source

**Files:**
- Modify: `web/src/views/Search.tsx`

**Interfaces:**
- Consumes: existing `api.search()` returning `{ hits: (Item & { source: string })[] }`; `getSourceLabel` from storage; existing `PosterCard`.
- Produces: Search results render in groups, one section per source.

- [ ] **Step 1: Replace `web/src/views/Search.tsx`**

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
import { getSourceLabel } from '../storage';
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

  // Group results by source.
  const grouped = new Map<string, (Item & { source: string })[]>();
  for (const hit of results) {
    const arr = grouped.get(hit.source) ?? [];
    arr.push(hit);
    grouped.set(hit.source, arr);
  }

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
          sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity 100ms' }}
        />
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
            No results for "{q}".
          </Typography>
        )}
        {q.trim().length < 2 && (
          <Typography color="text.secondary" sx={{ mt: 4, textAlign: 'center' }}>
            Search runs across all paired sources.
          </Typography>
        )}
        <Box sx={{ mt: 2.5, opacity: loading ? 0.5 : 1, transition: 'opacity 100ms' }}>
          {[...grouped.entries()].map(([srcKey, hits]) => (
            <Box key={srcKey} sx={{ mb: 4 }}>
              <Typography variant="h3" sx={{ mb: 1.5 }}>
                {getSourceLabel(srcKey) ?? srcKey}
                <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
                  · {hits.length} {hits.length === 1 ? 'result' : 'results'}
                </Typography>
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, 180px)',
                  gap: 2.5,
                }}
              >
                {hits.map((it) => (
                  <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Search.tsx
git commit -m "web: Search — group results by source"
```

---

## Task 11: Settings — SourceCard with status pings + Preferences + About + Unpair Dialog

**Files:**
- Create: `web/src/components/SourceCard.tsx`
- Modify: `web/src/api.ts` (add `sourceStatus()`)
- Modify: `web/src/views/Settings.tsx`

**Interfaces:**
- Consumes: Worker `/api/source-status` from Task 2.
- Produces:
  - `<SourceCard srcKey label type baseUrl status lastSeenAt onUnpair/>` component.
  - `api.sourceStatus(srcKey): Promise<{ status, lastSeenAt }>`.
  - Redesigned Settings with status pings + Dialog confirm for Unpair.

- [ ] **Step 1: Add `sourceStatus` API method**

In `web/src/api.ts`, inside the `api` object:

```typescript
  sourceStatus: (srcKey: string) =>
    request<{ status: 'ok' | 'degraded' | 'unreachable' | 'lan-only'; lastSeenAt: number | null }>(
      `/api/source-status?key=${encodeURIComponent(srcKey)}`,
    ),
```

- [ ] **Step 2: Create `web/src/components/SourceCard.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { api } from '../api';
import type { StoredSource } from '../storage';

export interface SourceCardProps {
  srcKey: string;
  label: string;
  type: StoredSource['type'];
  baseUrl: string;
  onUnpair(): void;
}

const TYPE_COLOR: Record<StoredSource['type'], string> = {
  plex: '#e5a00d',
  jellyfin: '#aa5cc3',
  flixify: '#cc3333',
  generic: '#6b7280',
};

const TYPE_GLYPH: Record<StoredSource['type'], string> = {
  plex: 'P',
  jellyfin: 'J',
  flixify: 'F',
  generic: '·',
};

const DOT_COLOR: Record<string, string> = {
  ok: '#67d391',
  degraded: '#f5a623',
  unreachable: '#ef5350',
  'lan-only': '#6b7280',
  loading: '#6b7280',
};

function timeAgo(ms: number | null): string {
  if (!ms) return '';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function SourceCard({ srcKey, label, type, baseUrl, onUnpair }: SourceCardProps) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'degraded' | 'unreachable' | 'lan-only'>('loading');
  const [lastSeenAt, setLastSeenAt] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.sourceStatus(srcKey).then(
      (res) => {
        if (cancelled) return;
        setStatus(res.status);
        setLastSeenAt(res.lastSeenAt);
      },
      () => { if (!cancelled) setStatus('unreachable'); },
    );
    return () => { cancelled = true; };
  }, [srcKey]);

  const statusText =
    status === 'loading' ? 'Checking…' :
    status === 'ok' ? `Last seen: ${timeAgo(lastSeenAt)}` :
    status === 'degraded' ? 'Degraded' :
    status === 'unreachable' ? 'Unreachable' :
    'LAN-only — health check unavailable';

  return (
    <>
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 2, p: 2,
          backgroundColor: 'background.paper',
          border: '1px solid', borderColor: 'divider',
          borderRadius: 1, mb: 1,
        }}
      >
        <Box
          sx={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: DOT_COLOR[status] ?? DOT_COLOR.loading,
            flexShrink: 0,
          }}
        />
        <Box
          sx={{
            width: 40, height: 40, borderRadius: 1,
            backgroundColor: TYPE_COLOR[type],
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 22,
            flexShrink: 0,
          }}
        >
          {TYPE_GLYPH[type]}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {type} · {baseUrl}
          </Typography>
          <Typography variant="caption" color="text.secondary">{statusText}</Typography>
        </Box>
        <Button variant="text" color="error" onClick={() => setConfirmOpen(true)}>Unpair</Button>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Unpair {label}?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This removes {label} from canvas. You can pair again later. Existing playback progress on the source itself is not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" onClick={() => { setConfirmOpen(false); onUnpair(); }}>Unpair</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
```

- [ ] **Step 3: Replace `web/src/views/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import AddIcon from '@mui/icons-material/Add';
import { AppShell } from '../components/AppShell';
import { SourceCard } from '../components/SourceCard';
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
        <Typography variant="h1" sx={{ mb: 3 }}>Settings</Typography>

        <Typography variant="h3" sx={{ mb: 2 }}>Sources</Typography>
        {entries.length === 0 && (
          <Typography color="text.secondary" sx={{ mb: 2 }}>No sources paired yet.</Typography>
        )}
        {entries.map(([key, src]) => (
          <SourceCard
            key={key}
            srcKey={key}
            label={src.label}
            type={src.type}
            baseUrl={src.baseUrl}
            onUnpair={() => unpair(key)}
          />
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
        <Box sx={{ p: 2, backgroundColor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          <FormControlLabel
            control={
              <Switch
                checked={prefs.autoplayNext}
                onChange={(e) => update('autoplayNext', e.target.checked)}
              />
            }
            label="Autoplay next episode"
            sx={{ display: 'flex', mb: 1.5 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={prefs.skipIntro}
                onChange={(e) => update('skipIntro', e.target.checked)}
              />
            }
            label="Skip intro automatically"
            sx={{ display: 'flex', mb: 1.5 }}
          />
          <FormControl size="small" sx={{ minWidth: 200, mb: 1.5, display: 'block' }}>
            <InputLabel>Default subtitle language</InputLabel>
            <Select
              value={prefs.defaultSubLang}
              label="Default subtitle language"
              onChange={(e) => update('defaultSubLang', e.target.value)}
            >
              <MenuItem value="">None</MenuItem>
              <MenuItem value="eng">English</MenuItem>
              <MenuItem value="spa">Spanish</MenuItem>
              <MenuItem value="fre">French</MenuItem>
              <MenuItem value="deu">German</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200, display: 'block' }}>
            <InputLabel>Default audio language</InputLabel>
            <Select
              value={prefs.defaultAudioLang}
              label="Default audio language"
              onChange={(e) => update('defaultAudioLang', e.target.value)}
            >
              <MenuItem value="">Original</MenuItem>
              <MenuItem value="eng">English</MenuItem>
              <MenuItem value="spa">Spanish</MenuItem>
              <MenuItem value="fre">French</MenuItem>
              <MenuItem value="deu">German</MenuItem>
            </Select>
          </FormControl>
        </Box>

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

- [ ] **Step 4: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/SourceCard.tsx web/src/api.ts web/src/views/Settings.tsx
git commit -m "web: Settings — SourceCard with status pings + Preferences + About"
```

---

## Task 12: Pair (Tesla) — refined card-button picker + redesigned PIN screen layout

**Files:**
- Modify: `web/src/views/Pair.tsx`

**Interfaces:**
- Consumes: existing api pairing methods.
- Produces: Pair view with Card-based source picker (replacing button list) and a more polished PIN-display layout (still NO QR — QR comes in T13).

- [ ] **Step 1: Replace `web/src/views/Pair.tsx`**

Read the current Pair.tsx first to preserve the polling state machine, then replace:

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
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
      <Box sx={{ p: 4, maxWidth: 720, mx: 'auto' }}>
        {state.kind === 'choose' && (
          <>
            <Typography variant="h1" sx={{ mb: 1 }}>Pair a new source</Typography>
            <Typography color="text.secondary" sx={{ mb: 3 }}>
              Choose what kind of source you want to add.
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {SOURCE_TYPES.map((s) => (
                <Card key={s.type} sx={{ opacity: s.available ? 1 : 0.5 }}>
                  <CardActionArea
                    disabled={!s.available}
                    onClick={() => startPair(s.type)}
                    sx={{ p: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>{s.label}</Typography>
                    {!s.available && (
                      <Typography variant="caption" color="text.secondary">(coming soon)</Typography>
                    )}
                  </CardActionArea>
                </Card>
              ))}
            </Box>
          </>
        )}
        {state.kind === 'pairing' && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h2" sx={{ mb: 3 }}>Pair your phone</Typography>
            <Typography color="text.secondary" sx={{ mb: 1 }}>
              Or enter this code on your phone at:
            </Typography>
            <Typography sx={{ fontSize: 18, mb: 3 }}>{window.location.host}/#/pair</Typography>
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
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 2 }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Waiting for approval…</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </Typography>
          </Box>
        )}
        {state.kind === 'paired' && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h3" color="success.main" sx={{ mb: 1 }}>✓ Paired</Typography>
            <Typography>{state.label} is now linked. Redirecting…</Typography>
          </Box>
        )}
        {state.kind === 'error' && (
          <Box sx={{ textAlign: 'center' }}>
            <Alert severity="error" sx={{ mb: 2, textAlign: 'left' }}>{state.message}</Alert>
            <Button variant="text" onClick={() => setState({ kind: 'choose' })}>Try again</Button>
          </Box>
        )}
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 2: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Pair.tsx
git commit -m "web: Pair — Card-based source picker + redesigned PIN layout (no QR yet)"
```

---

## Task 13: QR code on Tesla pair screen

**Files:**
- Modify: `web/package.json` (add `qrcode` dep)
- Modify: `web/src/views/Pair.tsx` (render QR in pairing state)

**Interfaces:**
- Consumes: `qrcode` (`qrcode.toString(text, opts): Promise<string>`).
- Produces: Tesla pair screen renders a 280×280 SVG QR; PIN displays as small fallback caption.

- [ ] **Step 1: Install qrcode dependency**

```powershell
cd C:\github\passenger\web
npm install qrcode@^1.5.0
npm install --save-dev @types/qrcode
```

This adds two entries to `package.json` — `qrcode` to dependencies and `@types/qrcode` to devDependencies.

- [ ] **Step 2: Update Pair.tsx to render QR**

Open `web/src/views/Pair.tsx`. At the top of the file, add the import:

```tsx
import QRCode from 'qrcode';
```

Inside the component, add useState + useEffect for the QR SVG string:

```tsx
  const [qrSvg, setQrSvg] = useState<string>('');

  useEffect(() => {
    if (state.kind !== 'pairing') return;
    const url = `${window.location.protocol}//${window.location.host}/#/pair?code=${encodeURIComponent(state.code)}&type=${state.type}`;
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 })
      .then(setQrSvg)
      .catch(() => setQrSvg(''));
  }, [state.kind, state.kind === 'pairing' ? state.code : null, state.kind === 'pairing' ? state.type : null]);
```

(The exhaustive-deps quirk with discriminated unions: include the relevant fields conditionally. The eslint comment isn't needed since we're explicitly listing dep values, but the dependency array uses ternary fallbacks to `null` which is OK.)

Replace the entire `{state.kind === 'pairing' && (...)}` block with:

```tsx
        {state.kind === 'pairing' && (
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="h2" sx={{ mb: 3 }}>Scan with your phone to pair</Typography>
            {qrSvg ? (
              <Box
                sx={{
                  display: 'inline-block', p: 2.5,
                  backgroundColor: '#ffffff',
                  borderRadius: 2,
                  mb: 3,
                }}
                dangerouslySetInnerHTML={{ __html: qrSvg }}
              />
            ) : (
              <Box sx={{ width: 280, height: 280, mx: 'auto', mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
              </Box>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
              Or enter <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>{state.code}</Box> at {window.location.host}/#/pair
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, mt: 2 }}>
              <CircularProgress size={20} />
              <Typography color="text.secondary">Waiting for approval…</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              Expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </Typography>
          </Box>
        )}
```

Note the white `#ffffff` background around the SVG: QR codes need light-on-dark contrast for camera scanning, and the dark theme would otherwise hide the dark modules.

- [ ] **Step 3: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds. Bundle should grow by ~10 KB minified.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/package.json web/package-lock.json web/src/views/Pair.tsx
git commit -m "web: QR code on Tesla pair screen via qrcode npm package"
```

---

## Task 14: PIN auto-format on phone side + auto-submit on QR-prefilled URL

**Files:**
- Create: `web/src/lib/pin-format.ts`
- Modify: `web/src/views/PhonePair.tsx`

**Interfaces:**
- Produces:
  - `stripPin(raw: string): string` — uppercases, strips non-alphanumeric, caps at 6.
  - `formatPin(stripped: string): string` — inserts dash at index 3 if length >= 4.

- [ ] **Step 1: Create `web/src/lib/pin-format.ts`**

```typescript
export function stripPin(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function formatPin(stripped: string): string {
  if (stripped.length <= 3) return stripped;
  return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
}
```

- [ ] **Step 2: Update `web/src/views/PhonePair.tsx`**

Open `web/src/views/PhonePair.tsx`. The component reads `code` from `route.query.code` already. Two changes:

1. Auto-format the input as the user types.
2. If `code` came from the URL (QR scan), auto-submit by triggering `startPlex()`.

Replace the relevant `useState` line:

```tsx
  const [code, setCode] = useState(codeFromUrl);
```

With:

```tsx
  const [code, setCode] = useState(formatPin(stripPin(codeFromUrl)));
```

Add imports at the top of the file:

```tsx
import { stripPin, formatPin } from '../lib/pin-format';
```

Replace the TextField's `onChange`:

```tsx
            onChange={(e) => setCode(e.target.value.toUpperCase())}
```

With:

```tsx
            onChange={(e) => setCode(formatPin(stripPin(e.target.value)))}
```

Replace the submit-button `disabled={code.length < 7}` with the strip-based check:

```tsx
              disabled={stripPin(code).length < 6}
```

For auto-submit on URL prefill: add a useEffect after the `useState` definitions:

```tsx
  useEffect(() => {
    if (stripPin(codeFromUrl).length === 6 && typeFromUrl === 'plex' && stage.kind === 'enter-code') {
      // Auto-submit shortly after mount so the user sees the code briefly.
      const t = setTimeout(() => startPlex(), 300);
      return () => clearTimeout(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeFromUrl, typeFromUrl]);
```

Note: `startPlex` is defined later in the function body. Hoisting via `function` declaration is fine; if it's defined with `async function startPlex()` already, the call works. If TS complains, define `startPlex` before the useEffect, or use a ref/callback pattern. Easier: convert `startPlex` to a `useCallback` so it can be a stable dep.

Actually, simpler: keep `startPlex` as a function declaration `async function startPlex() { ... }`. JS hoisting allows it. TS strict mode should be fine.

- [ ] **Step 3: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/lib/pin-format.ts web/src/views/PhonePair.tsx
git commit -m "web: PIN auto-format + auto-submit on QR-prefilled URL"
```

---

## Task 15: `<EmptyState>` component + wire into Home / Library / Search / SourceHome

**Files:**
- Create: `web/src/components/EmptyState.tsx`
- Modify: `web/src/views/Home.tsx` (use EmptyState for 0-sources branch)
- Modify: `web/src/views/Library.tsx` (use EmptyState for empty library)
- Modify: `web/src/views/Search.tsx` (use EmptyState for no-results state)
- Modify: `web/src/views/SourceHome.tsx` (use EmptyState if 0 libraries and 0 rails)

**Interfaces:**
- Produces:
  - `<EmptyState icon title body? actionLabel? onAction? />` component.

- [ ] **Step 1: Create `web/src/components/EmptyState.tsx`**

```tsx
import { type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';

export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Box
      sx={{
        p: 5, textAlign: 'center',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
      }}
    >
      <Box sx={{ '& svg': { fontSize: 64, color: 'text.secondary' } }}>{icon}</Box>
      <Typography variant="h3">{title}</Typography>
      {body && <Typography color="text.secondary">{body}</Typography>}
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction}>{actionLabel}</Button>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Use in `Home.tsx` (replace the empty-sources inline block)**

In `Home.tsx`, replace the `{state.kind === 'empty' && (...)}` block with:

```tsx
        {state.kind === 'empty' && (
          <EmptyState
            icon={<LibraryAddOutlinedIcon />}
            title="No sources paired yet"
            body="Pair a Plex server to get started."
            actionLabel="Pair your first source"
            onAction={() => navigate('/settings/pair')}
          />
        )}
```

Add imports:

```tsx
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import { EmptyState } from '../components/EmptyState';
```

- [ ] **Step 3: Use in `Library.tsx`**

Replace the inline empty-state block (from Task 9) with:

```tsx
            {state.data.items.length === 0 && (
              <EmptyState
                icon={<InboxOutlinedIcon />}
                title="This library is empty"
                actionLabel="Back to source"
                onAction={() => navigate(`/source/${source}`)}
              />
            )}
```

Add imports:

```tsx
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { EmptyState } from '../components/EmptyState';
```

- [ ] **Step 4: Use in `Search.tsx`**

Replace the no-results `<Typography>` line with:

```tsx
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <EmptyState
            icon={<SearchOffOutlinedIcon />}
            title={`No results for "${q}"`}
          />
        )}
```

Add imports:

```tsx
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import { EmptyState } from '../components/EmptyState';
```

- [ ] **Step 5: Use in `SourceHome.tsx`**

After the existing rails + libraries render, if all three arrays are empty, render an EmptyState. Add inside the `state.kind === 'ok'` branch, after the libraries section:

```tsx
            {state.data.continueWatching.length === 0 &&
             state.data.recentlyAdded.length === 0 &&
             state.data.libraries.length === 0 && (
              <EmptyState
                icon={<InboxOutlinedIcon />}
                title="This source returned nothing"
                body="The source is reachable but has no content to show right now."
              />
            )}
```

Add imports:

```tsx
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import { EmptyState } from '../components/EmptyState';
```

- [ ] **Step 6: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 7: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/EmptyState.tsx web/src/views/Home.tsx web/src/views/Library.tsx web/src/views/Search.tsx web/src/views/SourceHome.tsx
git commit -m "web: EmptyState component + wired into Home/Library/Search/SourceHome"
```

---

## Task 16: Skeleton loading states for Home / SourceHome / Library / ItemDetail

**Files:**
- Modify: `web/src/views/Home.tsx`
- Modify: `web/src/views/SourceHome.tsx`
- Modify: `web/src/views/Library.tsx`
- Modify: `web/src/views/ItemDetail.tsx`

**Interfaces:**
- Consumes: MUI `Skeleton` from `@mui/material/Skeleton`.
- Produces: views render skeleton placeholders during `kind: 'loading'` instead of plain "Loading…" text.

- [ ] **Step 1: Home loading skeleton**

In `web/src/views/Home.tsx`, replace the `{state.kind === 'loading' && (...)}` block with:

```tsx
        {state.kind === 'loading' && (
          <>
            <Box sx={{ mx: 2.5, mb: 3 }}>
              <Skeleton variant="rounded" height={320} />
            </Box>
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={180} height={28} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 1.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={180} height={270} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
          </>
        )}
```

Add import:

```tsx
import Skeleton from '@mui/material/Skeleton';
```

- [ ] **Step 2: SourceHome loading skeleton**

In `web/src/views/SourceHome.tsx`, replace the `{state.kind === 'loading' && (...)}` line with:

```tsx
        {state.kind === 'loading' && (
          <>
            <Skeleton variant="text" width={240} height={48} sx={{ mx: 2.5, mb: 3 }} />
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={180} height={28} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 1.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={180} height={270} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 200px)', gap: 2.5, px: 2.5 }}>
              {[1, 2, 3, 4].map((j) => (
                <Skeleton key={j} variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          </>
        )}
```

Add the Skeleton import.

- [ ] **Step 3: Library loading skeleton**

In `web/src/views/Library.tsx`, replace `{state.kind === 'loading' && <Typography ...>Loading…</Typography>}` with:

```tsx
        {state.kind === 'loading' && (
          <>
            <Skeleton variant="text" width={300} height={48} sx={{ mb: 3 }} />
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, 180px)',
                gap: 2.5,
              }}
            >
              {[...Array(12)].map((_, i) => (
                <Skeleton key={i} variant="rectangular" width={180} height={270} sx={{ borderRadius: 1 }} />
              ))}
            </Box>
          </>
        )}
```

Add the Skeleton import.

- [ ] **Step 4: ItemDetail loading skeleton**

In `web/src/views/ItemDetail.tsx`, replace the `if (state.kind === 'loading') return ...;` early return with:

```tsx
  if (state.kind === 'loading') {
    return (
      <AppShell>
        <Skeleton variant="rectangular" height={320} />
        <Box sx={{ px: 2.5, mt: -10, position: 'relative' }}>
          <Box sx={{ display: 'flex', gap: 3 }}>
            <Skeleton variant="rectangular" width={200} height={300} sx={{ borderRadius: 1, flexShrink: 0 }} />
            <Box sx={{ flex: 1, pt: 7.5 }}>
              <Skeleton variant="text" width="60%" height={56} sx={{ mb: 1 }} />
              <Skeleton variant="text" width="40%" height={24} sx={{ mb: 2 }} />
              <Skeleton variant="rounded" width={180} height={42} sx={{ mb: 2 }} />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="100%" />
              <Skeleton variant="text" width="80%" />
            </Box>
          </Box>
        </Box>
      </AppShell>
    );
  }
```

Add the Skeleton import.

- [ ] **Step 5: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Home.tsx web/src/views/SourceHome.tsx web/src/views/Library.tsx web/src/views/ItemDetail.tsx
git commit -m "web: Skeleton loading states for Home/SourceHome/Library/ItemDetail"
```

---

## Task 17: Error Alert primitives + reseek Backdrop overlay (with VideoSink `onFirstFrame`)

**Files:**
- Modify: `web/src/player/video.ts` (add `onFirstFrame?` option)
- Modify: `web/src/views/Player.tsx` (reseek backdrop state + onFirstFrame wiring)

**Interfaces:**
- Consumes: existing Player engine.
- Produces:
  - `VideoSinkOptions` gains optional `onFirstFrame?: () => void`.
  - Player.tsx renders a MUI `<Backdrop>` over the canvas during reseek, dismisses on first new frame.

- [ ] **Step 1: Update `web/src/player/video.ts`**

Add `onFirstFrame?: () => void` to `VideoSinkOptions`. Track a `firstFrameDispatched` flag inside the class. Invoke the callback once in `drawDue()` when the first frame paints. Replace the file with:

```typescript
export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  clock: () => number;
  onError: (err: Error) => void;
  onFirstFrame?: () => void;
}

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly clock: () => number;
  private readonly frames: VideoFrame[] = [];
  private readonly onFirstFrame: (() => void) | undefined;
  private rafHandle: number | null = null;
  private frameIntervalSec = 1 / 24;
  private firstFrameDispatched = false;

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.clock = opts.clock;
    this.onFirstFrame = opts.onFirstFrame;
    this.decoder = new VideoDecoder({
      output: (frame) => this.onFrame(frame),
      error: (e) => opts.onError(e as unknown as Error),
    });
    this.decoder.configure(opts.config);
  }

  feed(chunk: EncodedVideoChunk): void {
    if (this.decoder.state === 'closed') return;
    this.decoder.decode(chunk);
  }

  start(): void {
    if (this.rafHandle !== null) return;
    const tick = () => {
      this.drawDue();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  async flush(): Promise<void> {
    if (this.decoder.state === 'configured') await this.decoder.flush();
  }

  reset(): void {
    for (const f of this.frames) f.close();
    this.frames.length = 0;
    if (this.decoder.state === 'configured') this.decoder.reset();
  }

  close(): void {
    this.stop();
    this.reset();
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  get queuedFrames(): number { return this.frames.length; }

  private onFrame(frame: VideoFrame): void {
    if (frame.duration) {
      this.frameIntervalSec = frame.duration / 1_000_000;
    }
    this.frames.push(frame);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
  }

  private drawDue(): void {
    const clockSec = this.clock();
    const clockUs = clockSec * 1_000_000;
    let drawn: VideoFrame | null = null;
    while (this.frames.length > 0) {
      const f = this.frames[0]!;
      if (f.timestamp > clockUs + this.frameIntervalSec * 500_000) break;
      this.frames.shift();
      if (drawn) drawn.close();
      drawn = f;
    }
    if (drawn) {
      this.ctx.drawImage(drawn, 0, 0, this.canvas.width, this.canvas.height);
      drawn.close();
      if (!this.firstFrameDispatched) {
        this.firstFrameDispatched = true;
        if (this.onFirstFrame) {
          try { this.onFirstFrame(); } catch { /* ignore */ }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Wire reseek backdrop in `web/src/views/Player.tsx`**

Add new state at the top of the component:

```tsx
  const [reseeking, setReseeking] = useState(false);
```

In `bootSession`, the `onReady` callback constructs the VideoSink. Change the `new VideoSink({ ... })` call to add `onFirstFrame`:

```tsx
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
              onFirstFrame: () => setReseeking(false),
            });
```

In `reseek()`, set `reseeking` true at the start of the function (right after the `target` calc):

```tsx
  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
    const target = Math.max(0, Math.min(targetSec, duration > 0 ? duration - 1 : targetSec));
    setReseeking(true);
    const myToken = ++seekTokenRef.current;
    // ... rest unchanged
```

Render the backdrop. Inside the main `return (...)` of Player, just before `</div>`, add:

```tsx
      <Backdrop open={reseeking} sx={{ zIndex: 5, bgcolor: 'rgba(0,0,0,0.6)' }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography color="common.white">Seeking…</Typography>
        </Stack>
      </Backdrop>
```

Add imports near the top of Player.tsx:

```tsx
import Backdrop from '@mui/material/Backdrop';
import Stack from '@mui/material/Stack';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
```

- [ ] **Step 3: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/video.ts web/src/views/Player.tsx
git commit -m "web: VideoSink.onFirstFrame + reseek Backdrop overlay"
```

---

## Task 18: Deploy + Tesla smoke (USER)

**Files:** none.

**Interfaces:**
- Consumes: completed Tasks 1–17.
- Produces:
  - `canvas-api` Worker redeployed with new routes (source-status, source-home, extended home).
  - `canvas` Pages redeployed with new bundle.
  - End-to-end smoke on desktop and Tesla.

- [ ] **Step 1: Deploy the worker**

```powershell
cd C:\github\passenger\worker
npx wrangler deploy
```

Expected: prints `https://canvas-api.<account>.workers.dev`. The KV namespace is the same as Plan 1's (no changes there).

- [ ] **Step 2: Smoke the new worker routes**

```powershell
$base = "https://canvas-api.<your-account>.workers.dev"
Invoke-RestMethod "$base/health"
# Expect: ok
```

Smoke the source-status route (requires the x-sources header — easier to test from the deployed frontend).

- [ ] **Step 3: Build + deploy Pages**

```powershell
cd C:\github\passenger\web
npm run build
cd ..
npx wrangler pages deploy ./web/dist --project-name=canvas-8j0 --branch=v2 --commit-dirty=true
```

(Use whichever project name was assigned at Plan 1 deploy — `canvas-8j0` per the recorded Plan 1 result.)

- [ ] **Step 4: Desktop smoke**

Open `https://canvas-8j0.pages.dev` in a desktop browser.

If only one source paired:
- Home shows aggregated rails (no picker grid).
- Settings shows the source with a green / grey status dot (grey if LAN-only Plex).

If you pair a second source (re-pair or add another Plex):
- Home shows the picker grid below the rails.
- Tap a picker card → `/source/<src>` loads rails + libraries grid.

Pair flow:
- Tap "Pair new source" → card-button picker.
- Tap "Plex Media Server" → QR + small text fallback.
- Scan QR with phone camera → phone opens canvas pair URL with code pre-filled, auto-submits.
- Phone signs in to Plex, picks server, approves.
- Tesla picks up the new source within 3 seconds, redirects to Settings.

ItemDetail:
- Backdrop + poster overhang + episode list with LinearProgress on resumable episodes.

Skeleton loading:
- Tap a library, observe skeleton grid before content fills in.

Reseek:
- Play any movie. Drag the seek slider. Observe "Seeking…" backdrop briefly before the new frame paints.

- [ ] **Step 5: Tesla smoke**

Open `https://canvas-8j0.pages.dev` on the Tesla browser. Same flow: pair, browse, play, seek. Verify the QR pair works (scan from your actual phone).

- [ ] **Step 6: Record acceptance**

Append to `docs/superpowers/specs/2026-06-27-canvas-plan-2-design.md`:

```markdown
## Plan 2 result (recorded YYYY-MM-DD)

- Worker version: <wrangler-printed-id>
- Pages deployment: https://canvas-8j0.pages.dev/ (bundle index-<hash>.js, total ~<size> KB / ~<gzip> KB gzip)
- Desktop smoke: <pass | issues>
- Tesla smoke: <pass | issues>
- QR pair smoke: <pass | issues>
- Notes:
```

Commit:

```powershell
cd C:\github\passenger
git add docs/superpowers/specs/2026-06-27-canvas-plan-2-design.md
git commit -m "Record canvas Plan 2 acceptance result"
```

---

## Self-review notes

- **Spec coverage:**
  - Plan 1 deferrals (Section 1) → T1.
  - Worker routes (Section 2) → T2 (status) + T3 (source-home + libraryCounts).
  - Aggregate home + source picker + single-source fallback → T5 (consumes T2 indirectly via Settings, but home picker uses libraryCounts directly from T3).
  - Per-source mini-home → T4.
  - Breadcrumb updates → T6.
  - `/lib/:src` deprecation → T7.
  - ItemDetail redesign → T8.
  - Library header band + count → T9.
  - Search grouped-by-source → T10.
  - Settings SourceCard + Preferences + About + Dialog → T11.
  - Pair redesign (Tesla card picker + redesigned PIN screen) → T12.
  - QR code on Tesla → T13.
  - PIN auto-format + auto-submit → T14.
  - EmptyState component + wiring → T15.
  - Skeletons → T16.
  - Reseek backdrop + VideoSink.onFirstFrame → T17.
  - Error Alerts: implicitly already in Plan 1 (Home + ItemDetail + Search show Alert on error). Spec Section 5 also called out a "full-screen primary fetch fails: centered MUI Alert with Retry + Home buttons." This is not yet a separate component; the current per-view error renders are sufficient for Plan 2 — promote later if needed. (Player engine fatal Alert IS in T17's scope via the existing setErrMsg path; can wrap in Backdrop for full overlay. This plan keeps the existing `errMsg` display in Player; Plan 3 can revisit.)
- **Type consistency:** `StoredSource['type']` used identically across SourcePickerCard, SourceCard, LibraryCard, Pair, PhonePair. `SourceHomeResponse` defined in types.ts, consumed by SourceHome view and api.sourceHome. The `'lan-only'` status state appears in T2 (worker) and T11 (SourceCard) with the same string literal.
- **Placeholder scan:** No "TBD", "TODO", "implement later". One inline `// TODO: when adapter exposes genres on ItemDetail, wire here.` in T8 — that's a deliberate placeholder for FUTURE work outside Plan 2 scope; the genres array is empty for now (no adapter exposes genres on ItemDetail in v1). Keep the comment.
- **Build cadence:** every task ends with `npm run build` confirmation + commit. The build must remain green between tasks.
- **Worker tests:** T2 + T3 add Vitest cases. Frontend has no automated tests by design — manual smoke per task and the final Tesla smoke in T18.
- **The Plan 1 deferral T1 covers tsconfig flags + item-title cache + theme cssVariables.** If the tsconfig flags catch many unused identifiers, the implementer's T1 commit will be larger than the rest of the plan's small commits. This is OK — the deferral was the explicit user request.
