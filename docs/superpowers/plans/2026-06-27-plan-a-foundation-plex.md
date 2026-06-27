# Passenger v2 — Plan A: Foundation + Plex

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v2 architecture end-to-end with the Plex adapter only. Pair a Plex Media Server from the Tesla, browse its catalog, play a movie via the canvas pipeline, and resume from saved position.

**Architecture:** Cloudflare Worker hosts the `SourceAdapter` registry and federated API. Preact + Vite SPA on Cloudflare Pages calls one federated endpoint per screen. The v1 player engine (range fetcher → mp4box demux → WebCodecs → canvas + audio + sync clock) is ported into the new frontend unchanged. v2 deploys to *new* Cloudflare resources (`passenger-api-v2` Worker, `PASSENGER_V2` KV namespace, `passenger-v2.pages.dev` Pages) so v1 keeps running on `main` until parity.

**Tech Stack:** TypeScript, Cloudflare Workers + KV + Pages, Wrangler v4, Vite, Preact, Vitest (worker-side unit tests only), `mp4box` (existing), WebCodecs, WebAudio.

## Global Constraints

- All work happens on the **`v2` branch**, cut from current `main` (`HEAD = b0edb9c` or later).
- All code TypeScript except the audio worklet (plain JS, ported unchanged).
- Tesla MCU3 / Ryzen Chromium is the only supported client.
- Plain Preact + DOM in the web app — no React, Solid, Vue, Tailwind, or other UI frameworks.
- Hand-rolled hash router (~200 LoC, no `preact-router` etc.).
- Worker deploys as `passenger-api-v2`, frontend as `passenger-v2.pages.dev`, KV namespace `PASSENGER_V2` — do **not** touch v1's `passenger-api`, `passenger`, or v1's KV namespace.
- Wrangler v4.x (consistent with current `worker/` install).
- **Worker code uses Vitest for unit tests** on pure logic (cache, X-Sources parsing, PIN generation, adapter response parsers). HTTP routes and integration paths are manual-smoke only.
- **Frontend code has no automated tests** in this plan — manual smoke per task (build, dev server load, click through).
- Auth model: there is no `passenger`-side bearer token in v2. The Tesla sends source tokens via `X-Sources` header.
- Federated endpoints always return 200 with a `errors[]` array for partial source failures; per-source endpoints (`item`, `play`, `progress`) bubble the source's status code.

---

## Task 1: Cut `v2` branch and gut the worker source tree

**Files:**
- Modify: `worker/wrangler.toml`
- Delete: `worker/src/index.ts`, `worker/src/queue.ts`, `worker/src/id.ts`, `worker/src/cors.ts`
- Create: `worker/src/index.ts` (minimal /health)
- Create: `worker/vitest.config.ts`
- Modify: `worker/package.json` (add vitest, add test script)

**Interfaces:**
- Consumes: nothing.
- Produces: `v2` branch checked out, worker compiles and `/health` returns `ok`. A new Vitest config exists with one passing sanity test. The new `passenger-api-v2` worker and `PASSENGER_V2` KV namespace exist in Cloudflare.

- [ ] **Step 1: Cut the v2 branch from current main**

```powershell
cd C:\github\passenger
git status
# expect: clean working tree
git checkout -b v2
git branch
# expect: * v2,  main
```

- [ ] **Step 2: Create the new KV namespace for v2**

```powershell
cd C:\github\passenger\worker
npx wrangler kv namespace create PASSENGER_V2
```

Copy the returned `id` value. You will paste it into `wrangler.toml` in Step 4.

- [ ] **Step 3: Delete the v1 worker src files (queue API)**

```powershell
cd C:\github\passenger\worker\src
Remove-Item index.ts, queue.ts, id.ts, cors.ts
```

- [ ] **Step 4: Rewrite `worker/wrangler.toml`**

Replace `C:\github\passenger\worker\wrangler.toml` with:

```toml
name = "passenger-api-v2"
main = "src/index.ts"
compatibility_date = "2026-06-01"

[[kv_namespaces]]
binding = "KV"
id = "<paste-id-from-step-2>"
```

The binding is renamed from `QUEUE` to `KV` (it holds caches, pair sessions, and future per-key data — no longer a "queue").

- [ ] **Step 5: Add Vitest to worker devDependencies**

Replace `C:\github\passenger\worker\package.json`:

```json
{
  "name": "passenger-worker",
  "version": "0.0.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240419.0",
    "typescript": "^5.4.5",
    "vitest": "^1.6.0",
    "wrangler": "^4.105.0"
  }
}
```

- [ ] **Step 6: Create `worker/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
});
```

- [ ] **Step 7: Create the minimal Worker entry**

Create `C:\github\passenger\worker\src\index.ts`:

```typescript
export interface Env {
  KV: KVNamespace;
}

export default {
  async fetch(req: Request, _env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 8: Create a sanity Vitest**

Create `C:\github\passenger\worker\src\sanity.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

describe('vitest sanity', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Install, typecheck, test**

```powershell
cd C:\github\passenger\worker
npm install
npm run typecheck
npm test
```

Expected: typecheck succeeds (no output); `npm test` prints `1 passed`.

- [ ] **Step 10: Deploy the empty worker (sanity)**

```powershell
npx wrangler deploy
```

Expected: prints `passenger-api-v2.<acct>.workers.dev`. Copy the URL.

```powershell
Invoke-RestMethod "https://passenger-api-v2.<acct>.workers.dev/health"
```

Expected: `ok`.

- [ ] **Step 11: Commit**

```powershell
cd C:\github\passenger
git add worker/
git rm worker/src/queue.ts worker/src/id.ts worker/src/cors.ts 2>$null
git commit -m "v2: cut branch, gut worker, scaffold Vitest, deploy passenger-api-v2"
```

---

## Task 2: SourceAdapter types and registry

**Files:**
- Create: `worker/src/sources/types.ts`
- Create: `worker/src/sources/registry.ts`
- Create: `worker/src/sources/registry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SourceType = 'plex' | 'jellyfin' | 'flixify' | 'generic'`
  - `SourceContext = { baseUrl: string; token: string }`
  - `SourceAdapter` interface as defined in the spec (all methods)
  - Shared types: `HomeRow`, `Item`, `ItemDetail`, `Episode`, `BrowseResult`, `PlayResolution`
  - `getAdapter(type: SourceType): SourceAdapter` and `registerAdapter(adapter: SourceAdapter)`

- [ ] **Step 1: Create `sources/types.ts`**

```typescript
export type SourceType = 'plex' | 'jellyfin' | 'flixify' | 'generic';

export interface SourceContext {
  baseUrl: string;
  token: string;
}

export interface Item {
  id: string;
  type: 'movie' | 'show' | 'episode' | 'folder';
  title: string;
  year?: number;
  poster?: string;
  durationSec?: number;
  viewOffsetSec?: number;
}

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  durationSec?: number;
  viewOffsetSec?: number;
  synopsis?: string;
  poster?: string;
}

export interface ItemDetail extends Item {
  backdrop?: string;
  synopsis?: string;
  rating?: number;
  episodes?: Episode[];
  intro?: { startSec: number; endSec: number };
  credits?: { startSec: number; endSec: number };
}

export interface HomeRow {
  kind: 'continue' | 'recent' | 'libraries';
  title: string;
  items: Item[];
}

export interface BrowseResult {
  breadcrumbs: { name: string; libraryId?: string; path?: string }[];
  items: Item[];
}

export interface AudioTrack { id: string; language?: string; label?: string }
export interface SubtitleTrack { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

export interface SourceAdapter {
  readonly type: SourceType;
  startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }>;
  home(ctx: SourceContext): Promise<HomeRow[]>;
  search(ctx: SourceContext, query: string): Promise<Item[]>;
  library(ctx: SourceContext, libraryId?: string, path?: string): Promise<BrowseResult>;
  item(ctx: SourceContext, id: string): Promise<ItemDetail>;
  resolveStream(ctx: SourceContext, id: string): Promise<PlayResolution>;
  saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void>;
}
```

- [ ] **Step 2: Write the failing registry test**

Create `worker/src/sources/registry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { getAdapter, registerAdapter } from './registry';
import type { SourceAdapter } from './types';

const fakeAdapter: SourceAdapter = {
  type: 'plex',
  async startPair() { return { pairUrl: '', expiresAt: 0 }; },
  async home() { return []; },
  async search() { return []; },
  async library() { return { breadcrumbs: [], items: [] }; },
  async item() { return { id: '', type: 'movie', title: '' }; },
  async resolveStream() { return { url: '', durationSec: 0 }; },
  async saveProgress() {},
};

describe('source registry', () => {
  it('returns a registered adapter by type', () => {
    registerAdapter(fakeAdapter);
    expect(getAdapter('plex')).toBe(fakeAdapter);
  });

  it('throws for an unregistered type', () => {
    expect(() => getAdapter('jellyfin')).toThrow(/not registered|unknown adapter/i);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL (module not found)**

```powershell
cd C:\github\passenger\worker
npm test
```

Expected: fail importing `./registry`.

- [ ] **Step 4: Implement the registry**

Create `worker/src/sources/registry.ts`:

```typescript
import type { SourceAdapter, SourceType } from './types';

const registry = new Map<SourceType, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  registry.set(adapter.type, adapter);
}

export function getAdapter(type: SourceType): SourceAdapter {
  const adapter = registry.get(type);
  if (!adapter) {
    throw new Error(`Source adapter not registered: ${type}`);
  }
  return adapter;
}

export function listAdapters(): SourceAdapter[] {
  return [...registry.values()];
}
```

- [ ] **Step 5: Run test, expect PASS**

```powershell
npm test
```

Expected: 3 passed (sanity + 2 registry tests).

- [ ] **Step 6: Typecheck**

```powershell
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```powershell
cd C:\github\passenger
git add worker/src/sources/
git commit -m "v2: SourceAdapter contract and registry"
```

---

## Task 3: CORS, KV cache wrapper, log helper

**Files:**
- Create: `worker/src/cors.ts`
- Create: `worker/src/cache.ts`
- Create: `worker/src/cache.test.ts`
- Create: `worker/src/log.ts`

**Interfaces:**
- Consumes: `Env.KV` from index.ts.
- Produces:
  - `corsHeaders(req: Request): Record<string,string>` — returns CORS headers for allowed origins.
  - `withCors(req: Request, res: Response): Response` — wraps a Response with CORS headers.
  - `cached<T>(kv: KVNamespace, key: string, ttlSec: number, fn: () => Promise<T>): Promise<T>` — memoizing wrapper.
  - `log.info(msg, ...args)`, `log.warn(msg, ...args)`, `log.error(msg, ...args)` — thin console wrappers.

- [ ] **Step 1: Create `cors.ts`**

```typescript
const PAGES_SUFFIXES = ['.pages.dev'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (PAGES_SUFFIXES.some((s) => url.hostname.endsWith(s))) return true;
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  if (!isAllowedOrigin(origin)) return {};
  return {
    'access-control-allow-origin': origin!,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type, x-sources',
    'access-control-max-age': '86400',
    'vary': 'origin',
  };
}

export function withCors(req: Request, res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
```

- [ ] **Step 2: Write the failing cache test**

Create `worker/src/cache.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';
import { cached } from './cache';

function fakeKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(k: string) { return store.get(k) ?? null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cacheStatus: null } as any; },
    getWithMetadata: () => Promise.reject(new Error('unused')),
  } as unknown as KVNamespace;
}

describe('cached()', () => {
  it('calls fn on first call', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ value: 42 }));
    const result = await cached(kv, 'k1', 60, fn);
    expect(result).toEqual({ value: 42 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns cached value on second call without invoking fn', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ value: 7 }));
    await cached(kv, 'k2', 60, fn);
    const second = await cached(kv, 'k2', 60, fn);
    expect(second).toEqual({ value: 7 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors bypass=true and calls fn again', async () => {
    const kv = fakeKV();
    const fn = vi.fn(async () => ({ n: Math.random() }));
    await cached(kv, 'k3', 60, fn);
    await cached(kv, 'k3', 60, fn, { bypass: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run test, expect FAIL**

```powershell
npm test
```

- [ ] **Step 4: Implement `cache.ts`**

```typescript
export interface CacheOptions {
  bypass?: boolean;
}

export async function cached<T>(
  kv: KVNamespace,
  key: string,
  ttlSec: number,
  fn: () => Promise<T>,
  opts: CacheOptions = {},
): Promise<T> {
  if (!opts.bypass) {
    const hit = await kv.get(key, 'json');
    if (hit !== null) return hit as T;
  }
  const value = await fn();
  // KV's minimum TTL is 60s; clamp.
  const ttl = Math.max(60, ttlSec);
  await kv.put(key, JSON.stringify(value), { expirationTtl: ttl });
  return value;
}

export async function tokenHash(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest).slice(0, 4)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
```

- [ ] **Step 5: Run test, expect PASS**

```powershell
npm test
```

Expected: 5 passed (sanity + registry × 2 + cache × 3).

- [ ] **Step 6: Create `log.ts`**

```typescript
export const log = {
  info: (msg: string, ...args: unknown[]) => console.log('[info]', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => console.warn('[warn]', msg, ...args),
  error: (msg: string, ...args: unknown[]) => console.error('[err]', msg, ...args),
};
```

- [ ] **Step 7: Commit**

```powershell
git add worker/src/cors.ts worker/src/cache.ts worker/src/cache.test.ts worker/src/log.ts
git commit -m "v2: CORS, KV cache wrapper with token hashing, log helper"
```

---

## Task 4: PIN pair routes (start, poll, approve, delete)

**Files:**
- Create: `worker/src/pin.ts`
- Create: `worker/src/pin.test.ts`
- Create: `worker/src/routes/pair.ts`
- Modify: `worker/src/index.ts` (wire pair routes)

**Interfaces:**
- Consumes: `Env.KV`, `corsHeaders`, `withCors`.
- Produces:
  - `generatePin(): string` — 6-char unambiguous code, formatted `XXX-XXX`.
  - Routes:
    - `POST /api/pair/start` body `{ sourceType }` → `{ code, expiresAt }`
    - `POST /api/pair/poll` body `{ code }` → `{ status: 'pending' | 'approved' | 'expired', source? }`
    - `POST /api/pair/approve` body `{ code, type, baseUrl, token, label }` → 204
    - `DELETE /api/pair/:code` → 204

- [ ] **Step 1: Write PIN test**

Create `worker/src/pin.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { generatePin, isPinShape } from './pin';

describe('generatePin', () => {
  it('matches XXX-XXX with unambiguous alphabet', () => {
    const pin = generatePin();
    expect(pin).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/);
  });

  it('produces different values across calls', () => {
    const a = generatePin();
    const b = generatePin();
    expect(a).not.toBe(b);
  });
});

describe('isPinShape', () => {
  it('accepts the formatted PIN', () => {
    expect(isPinShape('K7P-Q3M')).toBe(true);
  });

  it('rejects ambiguous chars', () => {
    expect(isPinShape('O1L-IL0')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isPinShape('K7P')).toBe(false);
    expect(isPinShape('K7PQ3M')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```powershell
npm test
```

- [ ] **Step 3: Implement `pin.ts`**

```typescript
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PIN_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{3}$/;

export function generatePin(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

export function isPinShape(s: string): boolean {
  return PIN_RE.test(s);
}

export function pinKvKey(pin: string): string {
  return `pair:${pin.replace('-', '')}`;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Implement `routes/pair.ts`**

Create `worker/src/routes/pair.ts`:

```typescript
import { withCors } from '../cors';
import { log } from '../log';
import { generatePin, isPinShape, pinKvKey } from '../pin';
import type { SourceType } from '../sources/types';

const PAIR_TTL_SEC = 10 * 60;
const SUPPORTED_TYPES: SourceType[] = ['plex', 'jellyfin', 'flixify', 'generic'];

interface PairSessionPending {
  status: 'pending';
  sourceType: SourceType;
  createdAt: number;
}

interface PairSessionApproved {
  status: 'approved';
  source: { type: SourceType; baseUrl: string; token: string; label: string };
  createdAt: number;
}

type PairSession = PairSessionPending | PairSessionApproved;

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(
    req,
    new Response(JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

export async function handlePairStart(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const sourceType = (body as { sourceType?: unknown }).sourceType;
  if (typeof sourceType !== 'string' || !SUPPORTED_TYPES.includes(sourceType as SourceType)) {
    return json(req, { error: 'invalid sourceType' }, 400);
  }
  const pin = generatePin();
  const session: PairSessionPending = {
    status: 'pending',
    sourceType: sourceType as SourceType,
    createdAt: Date.now(),
  };
  await kv.put(pinKvKey(pin), JSON.stringify(session), { expirationTtl: PAIR_TTL_SEC });
  log.info('pair start', pin, sourceType);
  return json(req, { code: pin, expiresAt: Date.now() + PAIR_TTL_SEC * 1000 });
}

export async function handlePairPoll(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const code = (body as { code?: unknown }).code;
  if (typeof code !== 'string' || !isPinShape(code)) {
    return json(req, { error: 'invalid code' }, 400);
  }
  const raw = await kv.get(pinKvKey(code), 'json');
  if (raw === null) return json(req, { status: 'expired' });
  const session = raw as PairSession;
  if (session.status === 'approved') {
    return json(req, { status: 'approved', source: session.source });
  }
  return json(req, { status: 'pending' });
}

export async function handlePairApprove(req: Request, kv: KVNamespace): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: 'invalid json' }, 400);
  }
  const b = body as {
    code?: unknown;
    type?: unknown;
    baseUrl?: unknown;
    token?: unknown;
    label?: unknown;
  };
  if (
    typeof b.code !== 'string' || !isPinShape(b.code) ||
    typeof b.type !== 'string' || !SUPPORTED_TYPES.includes(b.type as SourceType) ||
    typeof b.baseUrl !== 'string' || !b.baseUrl.startsWith('http') ||
    typeof b.token !== 'string' || b.token.length === 0 ||
    typeof b.label !== 'string'
  ) {
    return json(req, { error: 'invalid approve payload' }, 400);
  }
  const key = pinKvKey(b.code);
  const existing = await kv.get(key, 'json');
  if (existing === null) return json(req, { error: 'code expired' }, 410);
  const approved: PairSessionApproved = {
    status: 'approved',
    source: { type: b.type as SourceType, baseUrl: b.baseUrl, token: b.token, label: b.label },
    createdAt: (existing as PairSession).createdAt,
  };
  await kv.put(key, JSON.stringify(approved), { expirationTtl: PAIR_TTL_SEC });
  log.info('pair approve', b.code);
  return withCors(req, new Response(null, { status: 204 }));
}

export async function handlePairDelete(req: Request, kv: KVNamespace, code: string): Promise<Response> {
  if (!isPinShape(code)) return json(req, { error: 'invalid code' }, 400);
  await kv.delete(pinKvKey(code));
  return withCors(req, new Response(null, { status: 204 }));
}
```

- [ ] **Step 6: Wire pair routes into `index.ts`**

Replace `worker/src/index.ts`:

```typescript
import { corsHeaders, withCors } from './cors';
import { handlePairStart, handlePairPoll, handlePairApprove, handlePairDelete } from './routes/pair';

export interface Env {
  KV: KVNamespace;
}

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  }));
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (url.pathname === '/health') {
    return withCors(req, new Response('ok', { headers: { 'content-type': 'text/plain' } }));
  }

  if (url.pathname === '/api/pair/start' && req.method === 'POST') return handlePairStart(req, env.KV);
  if (url.pathname === '/api/pair/poll' && req.method === 'POST') return handlePairPoll(req, env.KV);
  if (url.pathname === '/api/pair/approve' && req.method === 'POST') return handlePairApprove(req, env.KV);

  const delMatch = url.pathname.match(/^\/api\/pair\/([A-Z0-9-]+)$/);
  if (delMatch && req.method === 'DELETE') return handlePairDelete(req, env.KV, delMatch[1]!);

  return json(req, { error: 'not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('worker error:', message);
      return withCors(req, new Response(JSON.stringify({ error: 'internal', message }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
    }
  },
};
```

- [ ] **Step 7: Typecheck, test, deploy**

```powershell
npm run typecheck
npm test
npx wrangler deploy
```

- [ ] **Step 8: Smoke test the pair flow**

```powershell
$WORKER = 'https://passenger-api-v2.<acct>.workers.dev'

# Start a pair session
$start = Invoke-RestMethod -Method Post -Uri "$WORKER/api/pair/start" `
  -ContentType 'application/json' -Body '{"sourceType":"plex"}'
$start
# expect: code XXX-XXX, expiresAt timestamp

# Poll, expect pending
$code = $start.code
Invoke-RestMethod -Method Post -Uri "$WORKER/api/pair/poll" `
  -ContentType 'application/json' -Body (@{code=$code} | ConvertTo-Json)
# expect: status=pending

# Approve
$approve = @{code=$code; type='plex'; baseUrl='https://test.plex.tv'; token='dummy'; label='Test'} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$WORKER/api/pair/approve" -ContentType 'application/json' -Body $approve

# Poll again, expect approved
Invoke-RestMethod -Method Post -Uri "$WORKER/api/pair/poll" `
  -ContentType 'application/json' -Body (@{code=$code} | ConvertTo-Json)
# expect: status=approved, source={type,baseUrl,token,label}

# Delete
Invoke-WebRequest -Method Delete -Uri "$WORKER/api/pair/$code" | Select-Object StatusCode
# expect: 204
```

- [ ] **Step 9: Commit**

```powershell
git add worker/
git commit -m "v2: PIN pair routes (start/poll/approve/delete) + KV-backed sessions"
```

---

## Task 5: Federated route shells with `X-Sources` parsing

**Files:**
- Create: `worker/src/x-sources.ts`
- Create: `worker/src/x-sources.test.ts`
- Create: `worker/src/routes/home.ts`
- Create: `worker/src/routes/search.ts`
- Create: `worker/src/routes/library.ts`
- Create: `worker/src/routes/item.ts`
- Create: `worker/src/routes/play.ts`
- Create: `worker/src/routes/progress.ts`
- Modify: `worker/src/index.ts`

**Interfaces:**
- Consumes: `getAdapter`, `SourceContext`, KV cache helpers.
- Produces:
  - `parseXSources(req: Request): Record<string, { type: SourceType; baseUrl: string; token: string }>` — returns map keyed by source key (free-form), or empty object if header missing/malformed. Throws nothing.
  - Route handlers stub-call adapters in parallel for `/home` and `/search`; route by `:src` key for `/library`, `/item`, `/play`, `/progress`. Adapter dispatch goes through `getAdapter(type)` — registry is empty for now, so calls throw "not registered" → caught and returned as per-source error.

- [ ] **Step 1: Write `x-sources.test.ts`**

```typescript
import { describe, expect, it } from 'vitest';
import { parseXSources } from './x-sources';

function makeReq(headerValue: string | null): Request {
  const headers = new Headers();
  if (headerValue !== null) headers.set('x-sources', headerValue);
  return new Request('https://example.com/', { headers });
}

describe('parseXSources', () => {
  it('returns {} when header missing', () => {
    expect(parseXSources(makeReq(null))).toEqual({});
  });

  it('returns {} on malformed JSON', () => {
    expect(parseXSources(makeReq('{not json'))).toEqual({});
  });

  it('parses valid sources', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"plex","baseUrl":"https://plex.example","token":"t1"}}'),
    );
    expect(v).toEqual({
      a: { type: 'plex', baseUrl: 'https://plex.example', token: 't1' },
    });
  });

  it('drops entries with missing fields', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"plex","baseUrl":"x"},"b":{"type":"jellyfin","baseUrl":"y","token":"t"}}'),
    );
    expect(v).toEqual({ b: { type: 'jellyfin', baseUrl: 'y', token: 't' } });
  });

  it('drops entries with invalid type', () => {
    const v = parseXSources(
      makeReq('{"a":{"type":"bogus","baseUrl":"x","token":"t"}}'),
    );
    expect(v).toEqual({});
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `x-sources.ts`**

```typescript
import type { SourceType } from './sources/types';

const SUPPORTED: SourceType[] = ['plex', 'jellyfin', 'flixify', 'generic'];

export interface ParsedSource {
  type: SourceType;
  baseUrl: string;
  token: string;
}

export function parseXSources(req: Request): Record<string, ParsedSource> {
  const raw = req.headers.get('x-sources');
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: Record<string, ParsedSource> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as { type?: unknown; baseUrl?: unknown; token?: unknown };
    if (
      typeof v.type !== 'string' ||
      !SUPPORTED.includes(v.type as SourceType) ||
      typeof v.baseUrl !== 'string' ||
      typeof v.token !== 'string'
    ) {
      continue;
    }
    out[key] = { type: v.type as SourceType, baseUrl: v.baseUrl, token: v.token };
  }
  return out;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Create the per-source dispatcher**

Create `worker/src/dispatch.ts`:

```typescript
import { getAdapter } from './sources/registry';
import type { ParsedSource } from './x-sources';
import { log } from './log';

export interface PerSourceError {
  source: string;
  status: number;
  message: string;
}

export async function callPerSource<T>(
  sources: Record<string, ParsedSource>,
  fn: (key: string, src: ParsedSource) => Promise<T>,
): Promise<{ results: Record<string, T>; errors: PerSourceError[] }> {
  const entries = Object.entries(sources);
  const settled = await Promise.allSettled(entries.map(([k, s]) => fn(k, s)));
  const results: Record<string, T> = {};
  const errors: PerSourceError[] = [];
  settled.forEach((r, i) => {
    const [key] = entries[i]!;
    if (r.status === 'fulfilled') {
      results[key] = r.value;
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      log.warn('source failed', key, msg);
      errors.push({ source: key, status: 502, message: msg });
    }
  });
  return { results, errors };
}

export function callOneSource<T>(
  sources: Record<string, ParsedSource>,
  key: string,
  fn: (src: ParsedSource) => Promise<T>,
): Promise<T> {
  const src = sources[key];
  if (!src) throw new Error(`source not paired: ${key}`);
  return fn(src);
}

// Used in catch-blocks to surface adapter-or-source errors cleanly.
export function explain(e: unknown): { status: number; message: string } {
  const message = e instanceof Error ? e.message : String(e);
  return { status: 502, message };
}
```

- [ ] **Step 6: Create all six federated route handlers**

Create `worker/src/routes/home.ts`:

```typescript
import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleHome(req: Request): Promise<Response> {
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    return adapter.home({ baseUrl: src.baseUrl, token: src.token });
  });
  const rows = Object.entries(results).flatMap(([key, rs]) =>
    rs.map((r) => ({ ...r, source: key })),
  );
  return withCors(
    req,
    new Response(JSON.stringify({ rows, errors }), {
      headers: { 'content-type': 'application/json' },
    }),
  );
}
```

Create `worker/src/routes/search.ts`:

```typescript
import { withCors } from '../cors';
import { callPerSource } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleSearch(req: Request, url: URL): Promise<Response> {
  const q = url.searchParams.get('q') ?? '';
  if (!q) {
    return withCors(req, new Response(JSON.stringify({ hits: [], errors: [] }), {
      headers: { 'content-type': 'application/json' },
    }));
  }
  const sources = parseXSources(req);
  const { results, errors } = await callPerSource(sources, async (_key, src) => {
    const adapter = getAdapter(src.type);
    return adapter.search({ baseUrl: src.baseUrl, token: src.token }, q);
  });
  const hits = Object.entries(results).flatMap(([key, items]) =>
    items.map((i) => ({ ...i, source: key })),
  );
  return withCors(req, new Response(JSON.stringify({ hits, errors }), {
    headers: { 'content-type': 'application/json' },
  }));
}
```

Create `worker/src/routes/library.ts`:

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleLibrary(req: Request, url: URL, srcKey: string, libId?: string): Promise<Response> {
  const path = url.searchParams.get('path') ?? undefined;
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.library({ baseUrl: src.baseUrl, token: src.token }, libId, path);
    });
    return withCors(req, new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

Create `worker/src/routes/item.ts`:

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleItem(req: Request, srcKey: string, id: string): Promise<Response> {
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.item({ baseUrl: src.baseUrl, token: src.token }, id);
    });
    return withCors(req, new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

Create `worker/src/routes/play.ts`:

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handlePlay(req: Request, srcKey: string, id: string): Promise<Response> {
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id);
    });
    return withCors(req, new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

Create `worker/src/routes/progress.ts`:

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export async function handleProgress(req: Request, srcKey: string, id: string): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch {
    return withCors(req, new Response(JSON.stringify({ error: 'invalid json' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }
  const b = body as { posSec?: unknown; completed?: unknown };
  if (typeof b.posSec !== 'number') {
    return withCors(req, new Response(JSON.stringify({ error: 'posSec required' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    }));
  }
  const sources = parseXSources(req);
  try {
    await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.saveProgress({ baseUrl: src.baseUrl, token: src.token }, id, b.posSec as number, b.completed === true);
    });
    return withCors(req, new Response(null, { status: 204 }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

- [ ] **Step 7: Wire routes into `index.ts`**

Replace `worker/src/index.ts`:

```typescript
import { corsHeaders, withCors } from './cors';
import { handlePairStart, handlePairPoll, handlePairApprove, handlePairDelete } from './routes/pair';
import { handleHome } from './routes/home';
import { handleSearch } from './routes/search';
import { handleLibrary } from './routes/library';
import { handleItem } from './routes/item';
import { handlePlay } from './routes/play';
import { handleProgress } from './routes/progress';

export interface Env {
  KV: KVNamespace;
}

function json(req: Request, data: unknown, status = 200): Response {
  return withCors(req, new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  }));
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (url.pathname === '/health') {
    return withCors(req, new Response('ok', { headers: { 'content-type': 'text/plain' } }));
  }

  // Pair
  if (url.pathname === '/api/pair/start' && req.method === 'POST') return handlePairStart(req, env.KV);
  if (url.pathname === '/api/pair/poll' && req.method === 'POST') return handlePairPoll(req, env.KV);
  if (url.pathname === '/api/pair/approve' && req.method === 'POST') return handlePairApprove(req, env.KV);
  const delMatch = url.pathname.match(/^\/api\/pair\/([A-Z0-9-]+)$/);
  if (delMatch && req.method === 'DELETE') return handlePairDelete(req, env.KV, delMatch[1]!);

  // Federated
  if (url.pathname === '/api/home' && req.method === 'GET') return handleHome(req);
  if (url.pathname === '/api/search' && req.method === 'GET') return handleSearch(req, url);

  // Per-source
  const libMatch = url.pathname.match(/^\/api\/library\/([^/]+)(?:\/([^/]+))?$/);
  if (libMatch && req.method === 'GET') return handleLibrary(req, url, libMatch[1]!, libMatch[2]);

  const itemMatch = url.pathname.match(/^\/api\/item\/([^/]+)\/(.+)$/);
  if (itemMatch && req.method === 'GET') return handleItem(req, itemMatch[1]!, itemMatch[2]!);

  const playMatch = url.pathname.match(/^\/api\/play\/([^/]+)\/(.+)$/);
  if (playMatch && req.method === 'POST') return handlePlay(req, playMatch[1]!, playMatch[2]!);

  const progMatch = url.pathname.match(/^\/api\/progress\/([^/]+)\/(.+)$/);
  if (progMatch && req.method === 'POST') return handleProgress(req, progMatch[1]!, progMatch[2]!);

  return json(req, { error: 'not found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('worker error:', message);
      return withCors(req, new Response(JSON.stringify({ error: 'internal', message }), {
        status: 500, headers: { 'content-type': 'application/json' },
      }));
    }
  },
};
```

- [ ] **Step 8: Typecheck + test**

```powershell
npm run typecheck
npm test
```

Both must pass. (`/api/home` with no sources will return `{rows:[],errors:[]}`; with sources but no adapters registered, errors will say "Source adapter not registered: plex".)

- [ ] **Step 9: Deploy + smoke**

```powershell
npx wrangler deploy

$WORKER = 'https://passenger-api-v2.<acct>.workers.dev'
$src = '{"a":{"type":"plex","baseUrl":"https://x","token":"y"}}'

Invoke-RestMethod -Uri "$WORKER/api/home" -Headers @{'x-sources'=$src}
# expect: rows=[], errors=[{source:'a', status:502, message:'Source adapter not registered: plex'}]
```

- [ ] **Step 10: Commit**

```powershell
git add worker/
git commit -m "v2: federated route shells (home/search/library/item/play/progress) + X-Sources parsing"
```

---

## Task 6: Plex adapter — pair (plex.tv PIN OAuth)

**Files:**
- Create: `worker/src/sources/plex.ts`
- Create: `worker/src/sources/plex-pair.test.ts`
- Modify: `worker/src/index.ts` (register plex adapter)

**Interfaces:**
- Consumes: `SourceAdapter`, `registerAdapter`.
- Produces: a partial `plexAdapter` whose `startPair` implements Plex's PIN OAuth: POST `https://plex.tv/api/v2/pins` to get a pin id + code, return the `https://app.plex.tv/auth#?...` URL the phone visits. Other methods throw "not implemented" for now (filled in T7-T9).

Plex PIN OAuth reference (no docs URL — verify against `https://plex.tv/api/v2/pins` behavior):
- POST `https://plex.tv/api/v2/pins?strong=true` with headers `Accept: application/json`, `X-Plex-Product: Passenger`, `X-Plex-Client-Identifier: <stable-uuid-per-device>` → returns `{id, code, ...}`
- Phone visits `https://app.plex.tv/auth#?clientID=<uuid>&code=<code>&context%5Bdevice%5D%5Bproduct%5D=Passenger`
- After user approves, GET `https://plex.tv/api/v2/pins/<id>?X-Plex-Client-Identifier=<uuid>` → returns `{authToken}` (or null if not yet approved)

For our flow, the **phone** does the pin-creation + polling (not the worker), because the user is on the phone interacting with plex.tv. The worker's `startPair(code)` only needs to return the pairing URL pattern; the phone-side `Pair.tsx` page handles the plex.tv calls and posts the resulting token to our `/api/pair/approve`.

So Plex's `startPair` is trivial: returns the Plex-auth instruction URL, which is just the path the phone visits (`/pair?code=<code>&type=plex`).

- [ ] **Step 1: Create Plex adapter skeleton**

Create `worker/src/sources/plex.ts`:

```typescript
import type { SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

const NOT_IMPLEMENTED = 'plex method not implemented yet';

export const plexAdapter: SourceAdapter = {
  type: 'plex',

  async startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }> {
    // Pair flow is driven by the phone (Pair.tsx) which talks to plex.tv directly.
    // We just return the pair URL with the code; the phone view handles the rest.
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=plex`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(_ctx: SourceContext): Promise<HomeRow[]> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async search(_ctx: SourceContext, _query: string): Promise<Item[]> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async library(_ctx: SourceContext, _libraryId?: string, _path?: string): Promise<BrowseResult> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async item(_ctx: SourceContext, _id: string): Promise<ItemDetail> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async resolveStream(_ctx: SourceContext, _id: string): Promise<PlayResolution> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async saveProgress(_ctx: SourceContext, _id: string, _posSec: number, _completed: boolean): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
```

- [ ] **Step 2: Write the pair test**

Create `worker/src/sources/plex-pair.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { plexAdapter } from './plex';

describe('plexAdapter.startPair', () => {
  it('returns a /pair URL containing the code', async () => {
    const { pairUrl, expiresAt } = await plexAdapter.startPair('K7P-Q3M');
    expect(pairUrl).toContain('code=K7P-Q3M');
    expect(pairUrl).toContain('type=plex');
    expect(expiresAt).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 3: Run, expect PASS**

```powershell
npm test
```

- [ ] **Step 4: Register the plex adapter in `index.ts`**

Add this near the top of `worker/src/index.ts`, after the imports, BEFORE the `route` function:

```typescript
import { registerAdapter } from './sources/registry';
import { plexAdapter } from './sources/plex';

registerAdapter(plexAdapter);
```

- [ ] **Step 5: Typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add worker/src/sources/plex.ts worker/src/sources/plex-pair.test.ts worker/src/index.ts
git commit -m "v2: plex adapter skeleton + startPair returns phone-side pair URL"
```

---

## Task 7: Plex adapter — home (recently-added + on-deck) and library

**Files:**
- Modify: `worker/src/sources/plex.ts`
- Create: `worker/src/sources/plex-api.ts` (HTTP client)
- Create: `worker/src/sources/plex-api.test.ts`

**Interfaces:**
- Consumes: `fetch`, `SourceContext`, `HomeRow`, `Item`, `BrowseResult`.
- Produces: `plexFetch(ctx, path, init?)` HTTP wrapper that adds `X-Plex-Token: <ctx.token>`, `Accept: application/json` headers and parses JSON; `plexAdapter.home(ctx)` returning two rows ("Continue Watching" from `/library/onDeck`, "Recently Added" from `/library/recentlyAdded`); `plexAdapter.library(ctx, libraryId?, path?)` lists library sections (no libraryId) or browses one section (with libraryId).

Plex JSON endpoints used here:
- `GET /library/sections` → `MediaContainer.Directory[]` of library sections
- `GET /library/sections/<id>/all` → `MediaContainer.Metadata[]` of items in a section
- `GET /library/onDeck` → continue watching
- `GET /library/recentlyAdded` → recently added across libraries

Metadata mapping (Plex JSON → our `Item`):
- `Metadata.ratingKey` → `id`
- `Metadata.type` (`movie|show|episode`) → `type` (folder used only for directories)
- `Metadata.title` → `title`
- `Metadata.year` → `year`
- `Metadata.thumb` (relative path on the Plex server) → `poster` (full URL with token)
- `Metadata.duration` (ms) → `durationSec` (÷1000)
- `Metadata.viewOffset` (ms) → `viewOffsetSec` (÷1000)

- [ ] **Step 1: Write the Plex HTTP wrapper test (with fetch mocking)**

Create `worker/src/sources/plex-api.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plexFetch, mapMetadata } from './plex-api';

afterEach(() => vi.restoreAllMocks());

describe('plexFetch', () => {
  it('adds plex headers and parses JSON', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"MediaContainer":{"size":0}}', {
        status: 200, headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await plexFetch(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '/library/sections',
    );
    expect(spy).toHaveBeenCalledWith(
      'https://plex.example/library/sections',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'tok',
          'Accept': 'application/json',
        }),
      }),
    );
    expect(result).toEqual({ MediaContainer: { size: 0 } });
  });

  it('throws on non-2xx with status code', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    );
    await expect(
      plexFetch({ baseUrl: 'https://plex.example', token: 'tok' }, '/'),
    ).rejects.toThrow(/403/);
  });
});

describe('mapMetadata', () => {
  it('produces an Item with correct types and poster URL', () => {
    const item = mapMetadata(
      { baseUrl: 'https://plex.example', token: 'tok' },
      {
        ratingKey: '123',
        type: 'movie',
        title: 'Hello',
        year: 2024,
        thumb: '/library/metadata/123/thumb/456',
        duration: 5_400_000,
        viewOffset: 120_000,
      },
    );
    expect(item).toEqual({
      id: '123',
      type: 'movie',
      title: 'Hello',
      year: 2024,
      poster: 'https://plex.example/library/metadata/123/thumb/456?X-Plex-Token=tok',
      durationSec: 5400,
      viewOffsetSec: 120,
    });
  });

  it('returns type=folder for show-level entries when called with as=folder', () => {
    const item = mapMetadata(
      { baseUrl: 'https://plex.example', token: 'tok' },
      { ratingKey: '9', type: 'show', title: 'Test Show' },
      'show',
    );
    expect(item.type).toBe('show');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Create `plex-api.ts`**

```typescript
import type { SourceContext, Item } from './types';

export async function plexFetch<T = unknown>(
  ctx: SourceContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${ctx.baseUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set('X-Plex-Token', ctx.token);
  headers.set('Accept', 'application/json');
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Plex ${res.status} ${path}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export interface PlexMetadata {
  ratingKey: string;
  type: string;
  title: string;
  year?: number;
  thumb?: string;
  art?: string;
  duration?: number;
  viewOffset?: number;
  summary?: string;
  rating?: number;
  Genre?: { tag: string }[];
}

function imageUrl(ctx: SourceContext, path: string | undefined): string | undefined {
  if (!path) return undefined;
  // thumb/art are relative Plex paths; suffix with auth token.
  const sep = path.includes('?') ? '&' : '?';
  return `${ctx.baseUrl}${path}${sep}X-Plex-Token=${encodeURIComponent(ctx.token)}`;
}

export function mapMetadata(
  ctx: SourceContext,
  m: PlexMetadata,
  typeOverride?: 'movie' | 'show' | 'episode' | 'folder',
): Item {
  let type: Item['type'];
  if (typeOverride) type = typeOverride;
  else if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') type = m.type;
  else type = 'folder';
  return {
    id: m.ratingKey,
    type,
    title: m.title,
    year: m.year,
    poster: imageUrl(ctx, m.thumb),
    durationSec: m.duration ? Math.round(m.duration / 1000) : undefined,
    viewOffsetSec: m.viewOffset ? Math.round(m.viewOffset / 1000) : undefined,
  };
}

export interface PlexSection {
  key: string;
  type: string;
  title: string;
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Implement `plexAdapter.home` and `.library`**

Replace the `home` and `library` methods in `worker/src/sources/plex.ts`:

```typescript
import { plexFetch, mapMetadata, type PlexMetadata, type PlexSection } from './plex-api';
import type { SourceAdapter, SourceContext, HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

const NOT_IMPLEMENTED = 'plex method not implemented yet';

interface MediaContainer<T> {
  MediaContainer: {
    size: number;
    Metadata?: T[];
    Directory?: T[];
  };
}

export const plexAdapter: SourceAdapter = {
  type: 'plex',

  async startPair(code: string) {
    return {
      pairUrl: `/pair?code=${encodeURIComponent(code)}&type=plex`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    };
  },

  async home(ctx: SourceContext): Promise<HomeRow[]> {
    const [onDeck, recent] = await Promise.all([
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/onDeck?X-Plex-Container-Size=20'),
      plexFetch<MediaContainer<PlexMetadata>>(ctx, '/library/recentlyAdded?X-Plex-Container-Size=20'),
    ]);
    const rows: HomeRow[] = [];
    const onDeckItems = (onDeck.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (onDeckItems.length) rows.push({ kind: 'continue', title: 'Continue Watching', items: onDeckItems });
    const recentItems = (recent.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    if (recentItems.length) rows.push({ kind: 'recent', title: 'Recently Added', items: recentItems });
    return rows;
  },

  async search(_ctx: SourceContext, _query: string): Promise<Item[]> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async library(ctx: SourceContext, libraryId?: string): Promise<BrowseResult> {
    if (!libraryId) {
      // List sections as folder items.
      const sections = await plexFetch<MediaContainer<PlexSection>>(ctx, '/library/sections');
      const items: Item[] = (sections.MediaContainer.Directory ?? []).map((s) => ({
        id: s.key,
        type: 'folder',
        title: s.title,
      }));
      return { breadcrumbs: [{ name: 'Libraries' }], items };
    }
    // Browse one section.
    const all = await plexFetch<MediaContainer<PlexMetadata & { Section?: { title: string } }>>(
      ctx,
      `/library/sections/${encodeURIComponent(libraryId)}/all?X-Plex-Container-Size=200`,
    );
    const items = (all.MediaContainer.Metadata ?? []).map((m) => mapMetadata(ctx, m));
    return {
      breadcrumbs: [
        { name: 'Libraries' },
        { name: items[0] && (all.MediaContainer.Metadata?.[0] as any)?.librarySectionTitle || 'Library', libraryId },
      ],
      items,
    };
  },

  async item(_ctx: SourceContext, _id: string): Promise<ItemDetail> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async resolveStream(_ctx: SourceContext, _id: string): Promise<PlayResolution> {
    throw new Error(NOT_IMPLEMENTED);
  },

  async saveProgress(_ctx: SourceContext, _id: string, _posSec: number, _completed: boolean): Promise<void> {
    throw new Error(NOT_IMPLEMENTED);
  },
};
```

- [ ] **Step 6: Typecheck + test**

```powershell
npm run typecheck
npm test
```

All previous tests still pass; no new tests required for home/library at this layer (we'll smoke them manually against a real Plex server next task — they require real HTTP, not worth the mocking effort).

- [ ] **Step 7: Commit**

```powershell
git add worker/src/sources/plex.ts worker/src/sources/plex-api.ts worker/src/sources/plex-api.test.ts
git commit -m "v2: plex adapter — home (onDeck + recentlyAdded) and library browse"
```

---

## Task 8: Plex adapter — item, episodes, search

**Files:**
- Modify: `worker/src/sources/plex.ts`

**Interfaces:**
- Consumes: `plexFetch`, `mapMetadata`, types.
- Produces: full `plexAdapter.item(ctx, id)` returning movie or TV `ItemDetail` (with `episodes` for TV); `plexAdapter.search(ctx, q)` returning hits.

Plex endpoints:
- `GET /library/metadata/<id>` → full metadata including `Genre`, `summary`, `art`, `rating`
- `GET /library/metadata/<id>/children` → seasons (for show) or episodes (for season)
- `GET /library/metadata/<showId>/allLeaves` → all episodes in a show, flat
- `GET /hubs/search?query=<q>` → search hubs grouped by type

For TV: we fetch the show with `?includeChildren=1&includeOnDeck=1` then `/allLeaves` for the episode list.

- [ ] **Step 1: Update `plexAdapter.item` and `.search`**

In `worker/src/sources/plex.ts`, replace the `item` and `search` methods (everything else stays):

```typescript
  async search(ctx: SourceContext, query: string): Promise<Item[]> {
    const res = await plexFetch<MediaContainer<{ Metadata?: PlexMetadata[] } & PlexMetadata>>(
      ctx,
      `/hubs/search?query=${encodeURIComponent(query)}&limit=20`,
    );
    // hubs/search returns a Hub[] each containing Metadata. The shape: MediaContainer.Hub[].Metadata[]
    const hubs = (res.MediaContainer as unknown as { Hub?: { Metadata?: PlexMetadata[]; type?: string }[] }).Hub ?? [];
    const items: Item[] = [];
    for (const hub of hubs) {
      if (!hub.Metadata) continue;
      for (const m of hub.Metadata) {
        if (m.type === 'movie' || m.type === 'show' || m.type === 'episode') {
          items.push(mapMetadata(ctx, m));
        }
      }
    }
    return items;
  },

  async item(ctx: SourceContext, id: string): Promise<ItemDetail> {
    const res = await plexFetch<MediaContainer<PlexMetadata>>(
      ctx,
      `/library/metadata/${encodeURIComponent(id)}`,
    );
    const m = res.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const base = mapMetadata(ctx, m);
    const detail: ItemDetail = {
      ...base,
      backdrop: m.art ? `${ctx.baseUrl}${m.art}?X-Plex-Token=${encodeURIComponent(ctx.token)}` : undefined,
      synopsis: m.summary,
      rating: m.rating,
    };
    if (m.type === 'show') {
      const leaves = await plexFetch<MediaContainer<PlexMetadata & {
        parentIndex?: number; index?: number;
      }>>(ctx, `/library/metadata/${encodeURIComponent(id)}/allLeaves`);
      detail.episodes = (leaves.MediaContainer.Metadata ?? []).map((e) => ({
        id: e.ratingKey,
        title: e.title,
        season: (e as any).parentIndex ?? 0,
        episode: (e as any).index ?? 0,
        durationSec: e.duration ? Math.round(e.duration / 1000) : undefined,
        viewOffsetSec: e.viewOffset ? Math.round(e.viewOffset / 1000) : undefined,
        synopsis: e.summary,
        poster: e.thumb
          ? `${ctx.baseUrl}${e.thumb}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
          : undefined,
      }));
    }
    return detail;
  },
```

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 3: Commit**

```powershell
git add worker/src/sources/plex.ts
git commit -m "v2: plex adapter — item with episodes (TV), search via hubs"
```

---

## Task 9: Plex adapter — resolveStream and saveProgress

**Files:**
- Modify: `worker/src/sources/plex.ts`

**Interfaces:**
- Consumes: `plexFetch`, `SourceContext`, `PlayResolution`.
- Produces: `plexAdapter.resolveStream(ctx, id)` returning a direct-play URL for the file's media stream (no transcode) plus duration; `plexAdapter.saveProgress(ctx, id, posSec, completed)` POSTing to `:/timeline`.

Plex endpoints:
- `GET /library/metadata/<id>` returns `Metadata.Media[0].Part[0].key` which is the playable URL path on the Plex server. Suffix with `?X-Plex-Token=<tok>` for direct-play.
- `GET /:/timeline?ratingKey=<id>&state=<playing|paused|stopped>&time=<ms>&duration=<ms>&X-Plex-Token=<tok>` — note: it's GET, not POST, despite saving state. Plex's quirk.

- [ ] **Step 1: Replace `resolveStream` and `saveProgress` in plex.ts**

```typescript
  async resolveStream(ctx: SourceContext, id: string): Promise<PlayResolution> {
    const res = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: { key: string; container?: string }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = res.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const part = m.Media?.[0]?.Part?.[0];
    if (!part) throw new Error(`Plex item ${id} has no playable Part`);
    const url = `${ctx.baseUrl}${part.key}?X-Plex-Token=${encodeURIComponent(ctx.token)}`;
    return {
      url,
      durationSec: m.duration ? Math.round(m.duration / 1000) : (m.Media?.[0]?.duration ?? 0) / 1000,
    };
  },

  async saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void> {
    const state = completed ? 'stopped' : 'playing';
    const timeMs = Math.round(posSec * 1000);
    const url = `/:/timeline?ratingKey=${encodeURIComponent(id)}&key=/library/metadata/${encodeURIComponent(id)}&state=${state}&time=${timeMs}`;
    await plexFetch(ctx, url);
  },
```

- [ ] **Step 2: Typecheck**

```powershell
npm run typecheck
```

- [ ] **Step 3: Commit**

```powershell
git add worker/src/sources/plex.ts
git commit -m "v2: plex adapter — resolveStream (direct-play URL) + saveProgress via :/timeline"
```

---

## Task 10: Deploy v2 worker; smoke test against a real Plex server (user step)

**Files:** none (deploy only)

**Interfaces:**
- Consumes: deployed `passenger-api-v2` worker.
- Produces: confirmation that Plex pair → home → item → play → progress works end-to-end against a live Plex Media Server. The Plex token and server URL are obtained out-of-band by the user (e.g., from an existing Plex client login).

- [ ] **Step 1: Deploy**

```powershell
cd C:\github\passenger\worker
npx wrangler deploy
```

Confirm the URL: `https://passenger-api-v2.<acct>.workers.dev`.

- [ ] **Step 2: Acquire a Plex token (one-time)**

If you don't have a Plex token handy:

1. Sign in to Plex Web at `https://app.plex.tv`.
2. Open devtools → Application → Cookies → `app.plex.tv` → `X-Plex-Token` (or follow the standard guide: open any item in Plex Web, "Get Info" → "View XML" → the URL in the address bar contains `X-Plex-Token=`).
3. Note your Plex server's local URL (e.g., `http://192.168.1.50:32400`) or remote URL (via `plex.direct`).

This is for smoke testing only — the production pair flow (T16-T17) wraps this user-side.

- [ ] **Step 3: Smoke `/api/home` against real Plex**

```powershell
$WORKER = 'https://passenger-api-v2.<acct>.workers.dev'
$PLEX = 'http://your-plex-host:32400'
$TOK  = 'your-plex-token'

$src = @{ p1 = @{ type='plex'; baseUrl=$PLEX; token=$TOK } } | ConvertTo-Json -Compress

Invoke-RestMethod -Uri "$WORKER/api/home" -Headers @{'x-sources'=$src}
```

Expected: `rows` containing "Continue Watching" (if you have stuff in progress) and "Recently Added"; `errors: []`.

- [ ] **Step 4: Smoke `/api/library/p1` and `/api/library/p1/<sectionId>`**

```powershell
Invoke-RestMethod -Uri "$WORKER/api/library/p1" -Headers @{'x-sources'=$src}
# expect: items as folders (libraries)

# Pick a libraryId from the result above:
$LIB = '1'
Invoke-RestMethod -Uri "$WORKER/api/library/p1/$LIB" -Headers @{'x-sources'=$src}
# expect: items grid of movies / shows in that library
```

- [ ] **Step 5: Smoke `/api/item/p1/<id>` and `/api/play/p1/<id>`**

Pick a movie from the library response. Use its `id` value:

```powershell
$ID = '12345'
Invoke-RestMethod -Uri "$WORKER/api/item/p1/$ID" -Headers @{'x-sources'=$src}
# expect: ItemDetail with title, synopsis, durationSec, viewOffsetSec, etc.

Invoke-RestMethod -Method Post -Uri "$WORKER/api/play/p1/$ID" -Headers @{'x-sources'=$src}
# expect: { url: 'http://plex:32400/...mkv?X-Plex-Token=...', durationSec: N }
```

Open the returned `url` in a browser — it should download or stream the file.

- [ ] **Step 6: Smoke `/api/progress/p1/<id>`**

```powershell
$body = @{ posSec = 120 } | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri "$WORKER/api/progress/p1/$ID" `
  -ContentType 'application/json' -Body $body -Headers @{'x-sources'=$src} `
  | Select-Object StatusCode
# expect: 204
```

Then `GET /api/item/p1/<ID>` again — `viewOffsetSec` should reflect ~120s.

- [ ] **Step 7: No commit needed (deploy-only task)**

---

## Task 11: Branch over to frontend; Vite + Preact scaffold

**Files:**
- Delete: `web/src/*`, `web/index.html`, `web/player.html`, `web/settings.html`, `web/vite.config.ts`
- Modify: `web/package.json`, `web/tsconfig.json`
- Create: `web/index.html` (single SPA entry)
- Create: `web/vite.config.ts`
- Create: `web/src/main.tsx` (Preact mount point)

**Interfaces:**
- Consumes: nothing new.
- Produces: Vite + Preact + TS web app boots at `/`, shows "passenger v2" placeholder, builds to `dist/`.

- [ ] **Step 1: Wipe the v1 web source tree**

```powershell
cd C:\github\passenger\web
Remove-Item -Recurse src
Remove-Item index.html, player.html, settings.html, vite.config.ts
```

The audio worklet will be re-added when we port the player engine in T12.

- [ ] **Step 2: Replace `web/package.json`**

```json
{
  "name": "passenger-web",
  "version": "0.0.2",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "wrangler pages deploy ./dist --project-name=passenger-v2"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "typescript": "^5.4.5",
    "vite": "^5.2.0",
    "wrangler": "^4.105.0"
  },
  "dependencies": {
    "preact": "^10.22.0",
    "mp4box": "^0.5.2"
  }
}
```

- [ ] **Step 3: Replace `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
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

- [ ] **Step 4: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
});
```

- [ ] **Step 5: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>passenger</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `web/src/main.tsx`**

```tsx
import { render } from 'preact';

function App() {
  return <div style={{ padding: '20px', fontFamily: 'system-ui' }}>
    <h1>passenger v2</h1>
    <p>scaffold OK</p>
  </div>;
}

const root = document.getElementById('app');
if (root) render(<App />, root);
```

- [ ] **Step 7: Create `web/src/styles.css`**

```css
:root {
  --bg: #0e0f12;
  --fg: #e8eaf0;
  --muted: #888c95;
  --accent: #2d8cff;
  --row: #1a1c20;
  --row-hover: #232631;
  --danger: #d05050;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg);
             font: 16px/1.4 system-ui, -apple-system, sans-serif; }
a { color: var(--accent); text-decoration: none; }
button { font: inherit; color: var(--fg); background: #2a2d36;
         border: 1px solid #3a3e4a; border-radius: 6px; padding: 10px 14px; cursor: pointer; }
button:hover { background: #353946; }
input { font: inherit; color: var(--fg); background: #1a1c20;
        border: 1px solid #3a3e4a; border-radius: 6px; padding: 10px 12px; width: 100%; }
.muted { color: var(--muted); }
```

- [ ] **Step 8: Install and build**

```powershell
cd C:\github\passenger\web
npm install
npm run build
```

Both must succeed.

- [ ] **Step 9: Dev server smoke**

```powershell
npm run dev
```

Open `http://localhost:5173/` — should show "passenger v2 / scaffold OK". Kill server.

- [ ] **Step 10: Commit**

```powershell
git add web/
git commit -m "v2: wipe v1 web, scaffold Preact + Vite SPA shell"
```

---

## Task 12: Port v1 player engine into v2's `src/player/` (lift-and-shift)

**Files:**
- Recover from main: `web/src/player/range-fetcher.ts`, `web/src/player/demux.ts`, `web/src/player/video.ts`, `web/src/player/audio.ts`, `web/src/player/audio-worklet.js`
- Create: `web/src/player/clock.ts` (extracted from index.ts logic)
- Modify: `web/vite.config.ts` (add audio-worklet as additional input)
- Recover from main: `web/src/mp4box.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RangeFetcher`, `Demuxer`, `VideoSink`, `AudioSink` classes available from `web/src/player/`. Engine code is unchanged from v1 — exact same behavior.

The v1 player engine was validated end-to-end in the v1 plan. We're not rewriting it; we're copying it from `main`.

- [ ] **Step 1: Restore the player module files from main**

```powershell
cd C:\github\passenger
git checkout main -- web/src/player/range-fetcher.ts
git checkout main -- web/src/player/demux.ts
git checkout main -- web/src/player/video.ts
git checkout main -- web/src/player/audio.ts
git checkout main -- web/src/player/audio-worklet.js
git checkout main -- web/src/mp4box.d.ts
```

- [ ] **Step 2: Create `web/src/player/clock.ts`** (the sync helper, extracted into a named module so the Player view can read `currentTime` without owning the AudioSink)

```typescript
/**
 * Master playback clock.
 * Audio-master when an AudioSink is connected; falls back to performance.now() before that.
 */
export interface Clock {
  currentTime(): number;
}

export function makePerformanceClock(): Clock {
  const start = performance.now();
  return { currentTime: () => (performance.now() - start) / 1000 };
}

export function makeAudioMasterClock(audio: { currentTime(): number }): Clock {
  return { currentTime: () => audio.currentTime() };
}
```

- [ ] **Step 3: Adjust `vite.config.ts` to emit the audio worklet as a fixed-name asset**

Replace `web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
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

- [ ] **Step 4: Confirm the player module compiles in the new context**

```powershell
cd C:\github\passenger\web
npm run build
```

The player files import only WebCodecs / mp4box / browser globals — no new deps needed. Build must pass.

- [ ] **Step 5: Commit**

```powershell
git add web/src/player/ web/src/mp4box.d.ts web/vite.config.ts
git commit -m "v2: port player engine from v1 unchanged; add clock.ts helper"
```

---

## Task 13: Router, API client, storage layer

**Files:**
- Create: `web/src/router.ts`
- Create: `web/src/api.ts`
- Create: `web/src/storage.ts`
- Create: `web/src/config.ts`
- Create: `web/src/vite-env.d.ts`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `router.ts`: `useRoute()` hook returning `{ path, params, query }`; `navigate(to)`; `<Link to={...}>` component. Hash-based.
  - `api.ts`: typed client with methods `home()`, `search(q)`, `library(srcKey, libId?, path?)`, `item(srcKey, id)`, `play(srcKey, id)`, `progress(srcKey, id, posSec, completed?)`, `pairStart(type)`, `pairPoll(code)`, `pairApprove(...)`, `pairDelete(code)`. Reads sources from storage and attaches `X-Sources` header.
  - `storage.ts`: `getSources()`, `addSource(key, source)`, `removeSource(key)`, `getPrefs()`, `setPrefs(p)`.
  - `config.ts`: reads `VITE_PASSENGER_API_V2` for the worker base URL with sensible fallback.

- [ ] **Step 1: Create `vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PASSENGER_API_V2?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 2: Create `config.ts`**

```typescript
export const API_BASE = (import.meta.env.VITE_PASSENGER_API_V2 ?? '').replace(/\/$/, '');
```

- [ ] **Step 3: Create `storage.ts`**

```typescript
export interface StoredSource {
  type: 'plex' | 'jellyfin' | 'flixify' | 'generic';
  baseUrl: string;
  token: string;
  label: string;
}

export interface Prefs {
  autoplayNext: boolean;
  defaultSubLang: string;
  defaultAudioLang: string;
  skipIntro: boolean;
}

const SOURCES_KEY = 'passenger.v2.sources';
const PREFS_KEY = 'passenger.v2.prefs';

const DEFAULT_PREFS: Prefs = {
  autoplayNext: true,
  defaultSubLang: '',
  defaultAudioLang: '',
  skipIntro: false,
};

export function getSources(): Record<string, StoredSource> {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function setSources(s: Record<string, StoredSource>): void {
  localStorage.setItem(SOURCES_KEY, JSON.stringify(s));
}

export function addSource(key: string, source: StoredSource): void {
  const cur = getSources();
  cur[key] = source;
  setSources(cur);
}

export function removeSource(key: string): void {
  const cur = getSources();
  delete cur[key];
  setSources(cur);
}

export function getPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function setPrefs(p: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export function makeSourceKey(label: string): string {
  // Stable-ish key derived from label; collision-safe by suffix.
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 8) || 'src';
  const existing = getSources();
  let candidate = slug;
  let i = 2;
  while (existing[candidate]) candidate = `${slug}${i++}`;
  return candidate;
}
```

- [ ] **Step 4: Create `api.ts`**

```typescript
import { API_BASE } from './config';
import { getSources } from './storage';
import type { StoredSource } from './storage';

function sourcesHeader(): Record<string, string> {
  const s = getSources();
  if (Object.keys(s).length === 0) return {};
  // Stripped down to only the fields the worker validates.
  const compact: Record<string, { type: StoredSource['type']; baseUrl: string; token: string }> = {};
  for (const [k, v] of Object.entries(s)) {
    compact[k] = { type: v.type, baseUrl: v.baseUrl, token: v.token };
  }
  return { 'x-sources': JSON.stringify(compact) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(sourcesHeader())) headers.set(k, v);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

import type { HomeRow, Item, ItemDetail, BrowseResult, PlayResolution } from './types';

export const api = {
  home: () => request<{ rows: (HomeRow & { source: string })[]; errors: { source: string; status: number; message: string }[] }>('/api/home'),
  search: (q: string) => request<{ hits: (Item & { source: string })[]; errors: unknown[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  library: (srcKey: string, libId?: string, path?: string) => {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    const lib = libId ? `/${encodeURIComponent(libId)}` : '';
    return request<BrowseResult>(`/api/library/${encodeURIComponent(srcKey)}${lib}${qs}`);
  },
  item: (srcKey: string, id: string) =>
    request<ItemDetail>(`/api/item/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`),
  play: (srcKey: string, id: string) =>
    request<PlayResolution>(`/api/play/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`, { method: 'POST' }),
  progress: (srcKey: string, id: string, posSec: number, completed = false) =>
    request<void>(`/api/progress/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ posSec, completed }),
    }),
  pairStart: (sourceType: StoredSource['type']) =>
    request<{ code: string; expiresAt: number }>('/api/pair/start', {
      method: 'POST',
      body: JSON.stringify({ sourceType }),
    }),
  pairPoll: (code: string) =>
    request<{ status: 'pending' | 'approved' | 'expired'; source?: StoredSource }>('/api/pair/poll', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  pairApprove: (payload: { code: string; type: StoredSource['type']; baseUrl: string; token: string; label: string }) =>
    request<void>('/api/pair/approve', { method: 'POST', body: JSON.stringify(payload) }),
  pairDelete: (code: string) => request<void>(`/api/pair/${encodeURIComponent(code)}`, { method: 'DELETE' }),
};
```

- [ ] **Step 5: Create the shared frontend types file**

Create `web/src/types.ts`:

```typescript
export type ItemKind = 'movie' | 'show' | 'episode' | 'folder';

export interface Item {
  id: string;
  type: ItemKind;
  title: string;
  year?: number;
  poster?: string;
  durationSec?: number;
  viewOffsetSec?: number;
}

export interface Episode {
  id: string;
  title: string;
  season: number;
  episode: number;
  durationSec?: number;
  viewOffsetSec?: number;
  synopsis?: string;
  poster?: string;
}

export interface ItemDetail extends Item {
  backdrop?: string;
  synopsis?: string;
  rating?: number;
  episodes?: Episode[];
  intro?: { startSec: number; endSec: number };
  credits?: { startSec: number; endSec: number };
}

export interface HomeRow {
  kind: 'continue' | 'recent' | 'libraries';
  title: string;
  items: Item[];
}

export interface BrowseResult {
  breadcrumbs: { name: string; libraryId?: string; path?: string }[];
  items: Item[];
}

export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
}
```

- [ ] **Step 6: Create `router.ts`**

```typescript
import { useEffect, useState } from 'preact/hooks';

export interface Route {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

function parseHash(): Route {
  const raw = window.location.hash.slice(1) || '/';
  const [pathOnly, qs = ''] = raw.split('?');
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
```

- [ ] **Step 7: Replace `main.tsx` to use the router**

```tsx
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
```

- [ ] **Step 8: Build + dev smoke**

```powershell
npm run build
npm run dev
```

Open `http://localhost:5173/` → "Home (TBD)". Click into devtools URL bar and visit `http://localhost:5173/#/lib/p1` → "Library: p1". `#/item/p1/123` → "Item: p1 / 123". All 8 routes render their placeholders.

- [ ] **Step 9: Commit**

```powershell
git add web/src/router.ts web/src/api.ts web/src/storage.ts web/src/config.ts web/src/types.ts web/src/vite-env.d.ts web/src/main.tsx
git commit -m "v2: hash router, typed API client, localStorage layer, route table"
```

---

## Task 14: Home view + Library view

**Files:**
- Create: `web/src/views/Home.tsx`
- Create: `web/src/views/Library.tsx`
- Create: `web/src/components/Rail.tsx`
- Create: `web/src/components/PosterCard.tsx`
- Create: `web/src/components/Chrome.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `api`, `Link`, `useRoute`, types.
- Produces: Home renders rails (continue / recent / libraries). Library renders a poster grid with breadcrumbs. Both gracefully handle no-sources state.

- [ ] **Step 1: Create `components/Chrome.tsx`**

```tsx
import { Link } from '../router';

export function Chrome({ children }: { children: preact.ComponentChildren }) {
  return (
    <div>
      <header style={{
        display: 'flex', alignItems: 'center', padding: '12px 20px',
        borderBottom: '1px solid #232631', gap: 16, height: 56,
      }}>
        <Link to="/" style={{ fontWeight: 600, fontSize: 18, color: 'var(--fg)' }}>passenger</Link>
        <nav style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
          <Link to="/search" style={{ padding: '6px 12px' }}>🔍 Search</Link>
          <Link to="/settings" style={{ padding: '6px 12px' }}>⚙ Settings</Link>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/PosterCard.tsx`**

```tsx
import { Link } from '../router';
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
    <Link to={href} style={{ display: 'block', flexShrink: 0, width }}>
      <div style={{
        width,
        aspectRatio: String(aspectRatio),
        background: 'var(--row)',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundImage: item.poster ? `url(${item.poster})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }} />
      <div style={{ marginTop: 8, color: 'var(--fg)', fontSize: 14, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {item.title}
      </div>
      {item.year ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{item.year}</div> : null}
    </Link>
  );
}
```

- [ ] **Step 3: Create `components/Rail.tsx`**

```tsx
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
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ padding: '0 20px', fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>{title}</h2>
      <div style={{
        display: 'flex', gap: 12, overflowX: 'auto', padding: '0 20px',
        scrollSnapType: 'x mandatory',
      }}>
        {items.map((it) => (
          <div key={`${it.source}:${it.id}`} style={{ scrollSnapAlign: 'start' }}>
            <PosterCard item={it} source={it.source} width={cardWidth} />
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create `views/Home.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { getSources } from '../storage';
import { Chrome } from '../components/Chrome';
import { Rail } from '../components/Rail';
import { Link } from '../router';
import type { HomeRow, Item } from '../types';

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[] }
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
      ({ rows }) => setState({ kind: 'ok', rows }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, []);

  return (
    <Chrome>
      <div style={{ padding: '20px 0' }}>
        {state.kind === 'loading' && <p style={{ padding: '0 20px' }} class="muted">Loading…</p>}
        {state.kind === 'empty' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <p style={{ fontSize: 18, marginBottom: 16 }}>No sources paired yet.</p>
            <Link to="/settings/pair">
              <button>+ Pair your first source</button>
            </Link>
          </div>
        )}
        {state.kind === 'error' && (
          <p style={{ padding: '0 20px', color: 'var(--danger)' }}>Error: {state.message}</p>
        )}
        {state.kind === 'ok' && state.rows.map((row) => (
          <Rail
            key={`${row.source}:${row.kind}:${row.title}`}
            title={row.source ? `${row.title} · ${row.source}` : row.title}
            items={row.items.map((i) => ({ ...i, source: row.source }))}
            cardWidth={row.items[0]?.type === 'episode' ? 260 : 180}
          />
        ))}
        {state.kind === 'ok' && state.rows.length === 0 && (
          <p style={{ padding: '0 20px' }} class="muted">Your sources are paired but returned nothing yet.</p>
        )}
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 5: Create `views/Library.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { Link } from '../router';
import { PosterCard } from '../components/PosterCard';
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
      (data) => setState({ kind: 'ok', data }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  }, [source, libraryId]);

  return (
    <Chrome>
      <div style={{ padding: 20 }}>
        {state.kind === 'ok' && (
          <div style={{ marginBottom: 16, color: 'var(--muted)' }}>
            {state.data.breadcrumbs.map((b, i) => (
              <span key={i}>
                {b.libraryId
                  ? <Link to={`/lib/${source}/${b.libraryId}`}>{b.name}</Link>
                  : <Link to={`/lib/${source}`}>{b.name}</Link>}
                {i < state.data.breadcrumbs.length - 1 ? ' › ' : null}
              </span>
            ))}
          </div>
        )}
        {state.kind === 'loading' && <p class="muted">Loading…</p>}
        {state.kind === 'error' && <p style={{ color: 'var(--danger)' }}>Error: {state.message}</p>}
        {state.kind === 'ok' && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, 180px)',
            gap: 20,
          }}>
            {state.data.items.map((it) => (
              <PosterCard key={it.id} item={it} source={source} />
            ))}
          </div>
        )}
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 6: Wire into `main.tsx`**

Replace the route table in `main.tsx`:

```tsx
import { render } from 'preact';
import { useRoute, matchRoute } from './router';
import { Home } from './views/Home';
import { Library } from './views/Library';

function NotFound() {
  return <div style={{ padding: 20 }}><h1>Not found</h1></div>;
}

function App() {
  const route = useRoute();

  const routes: Array<[string, (params: Record<string, string>) => preact.JSX.Element]> = [
    ['/', () => <Home />],
    ['/search', () => <div style={{ padding: 20 }}><h1>Search (TBD)</h1></div>],
    ['/lib/:src', (p) => <Library source={p.src!} />],
    ['/lib/:src/:libId', (p) => <Library source={p.src!} libraryId={p.libId} />],
    ['/item/:src/:id', (p) => <div style={{ padding: 20 }}><h1>Item: {p.src} / {p.id}</h1></div>],
    ['/play/:src/:id', (p) => <div style={{ padding: 20 }}><h1>Play: {p.src} / {p.id}</h1></div>],
    ['/settings', () => <div style={{ padding: 20 }}><h1>Settings (TBD)</h1></div>],
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
```

- [ ] **Step 7: Build + dev smoke**

```powershell
npm run build
npm run dev
```

Open `http://localhost:5173/#/` — with no sources paired, should see "No sources paired yet" + "Pair your first source" button. Without a worker URL configured (no `.env`), the home view should remain in the empty state because `getSources()` returns `{}`.

- [ ] **Step 8: Commit**

```powershell
git add web/src/views/ web/src/components/ web/src/main.tsx
git commit -m "v2: Home view with rails, Library view with grid + breadcrumbs, Chrome layout"
```

---

## Task 15: ItemDetail view + Search view + Settings view

**Files:**
- Create: `web/src/views/ItemDetail.tsx`
- Create: `web/src/views/Search.tsx`
- Create: `web/src/views/Settings.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `api`, `storage`, `Link`, types.
- Produces: ItemDetail shows hero + Play + episodes for TV; Search has live results across all sources; Settings lists paired sources, allows unpair, links to /settings/pair.

- [ ] **Step 1: Create `views/ItemDetail.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
import { Link, navigate } from '../router';
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

  if (state.kind === 'loading') return <Chrome><p style={{ padding: 20 }} class="muted">Loading…</p></Chrome>;
  if (state.kind === 'error') return <Chrome><p style={{ padding: 20, color: 'var(--danger)' }}>{state.message}</p></Chrome>;

  const { item } = state;
  const resume = (item.viewOffsetSec ?? 0) > 60;

  return (
    <Chrome>
      {item.backdrop && (
        <div style={{
          height: 320, backgroundImage: `url(${item.backdrop})`,
          backgroundSize: 'cover', backgroundPosition: 'center',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, transparent 50%, var(--bg) 100%)',
          }} />
        </div>
      )}
      <div style={{ padding: '0 20px', marginTop: item.backdrop ? -80 : 20, position: 'relative' }}>
        <div style={{ display: 'flex', gap: 24 }}>
          {item.poster && (
            <img src={item.poster} style={{ width: 200, height: 300, borderRadius: 8, objectFit: 'cover' }} alt="" />
          )}
          <div style={{ flex: 1, paddingTop: item.backdrop ? 60 : 0 }}>
            <h1 style={{ margin: '0 0 8px', fontSize: 32 }}>{item.title}</h1>
            <div class="muted" style={{ marginBottom: 16 }}>
              {[item.year, formatRuntime(item.durationSec), item.rating ? `★ ${item.rating}` : null]
                .filter(Boolean).join(' · ')}
            </div>
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <button
                style={{ padding: '14px 28px', fontSize: 16, background: 'var(--accent)', border: 'none' }}
                onClick={() => navigate(`/play/${source}/${item.id}`)}
              >
                ▶ {resume ? `Resume ${formatPos(item.viewOffsetSec!)}` : 'Play'}
              </button>
              {resume && (
                <button onClick={() => navigate(`/play/${source}/${item.id}?from=0`)}>
                  Start over
                </button>
              )}
            </div>
            {item.synopsis && <p style={{ maxWidth: 700, lineHeight: 1.5 }}>{item.synopsis}</p>}
          </div>
        </div>

        {item.episodes && item.episodes.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 20, marginBottom: 12 }}>Episodes</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {item.episodes.map((ep) => (
                <Link
                  key={ep.id}
                  to={`/play/${source}/${ep.id}`}
                  style={{
                    display: 'flex', gap: 16, padding: 12,
                    background: 'var(--row)', borderRadius: 8, color: 'var(--fg)',
                  }}
                >
                  {ep.poster && (
                    <img src={ep.poster} style={{ width: 160, height: 90, borderRadius: 4, objectFit: 'cover' }} alt="" />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>S{ep.season}·E{ep.episode} · {ep.title}</div>
                    {ep.synopsis && <div class="muted" style={{ marginTop: 4, fontSize: 14 }}>{ep.synopsis}</div>}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 2: Create `views/Search.tsx`**

```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
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
    <Chrome>
      <div style={{ padding: 20 }}>
        <input
          type="search"
          placeholder="Search…"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          autoFocus
          style={{ fontSize: 18, padding: 14 }}
        />
        {loading && <p class="muted" style={{ marginTop: 16 }}>Searching…</p>}
        {!loading && results.length === 0 && q.trim().length >= 2 && (
          <p class="muted" style={{ marginTop: 16 }}>No results.</p>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, 180px)',
          gap: 20, marginTop: 20,
        }}>
          {results.map((it) => (
            <PosterCard key={`${it.source}:${it.id}`} item={it} source={it.source} />
          ))}
        </div>
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 3: Create `views/Settings.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { Chrome } from '../components/Chrome';
import { Link } from '../router';
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

  return (
    <Chrome>
      <div style={{ padding: 20, maxWidth: 700 }}>
        <h2>Sources</h2>
        {entries.length === 0 && <p class="muted">No sources paired yet.</p>}
        {entries.map(([key, src]) => (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', padding: 12,
            background: 'var(--row)', borderRadius: 8, marginBottom: 8,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{src.label}</div>
              <div class="muted" style={{ fontSize: 13 }}>{src.type} · {src.baseUrl}</div>
            </div>
            <button onClick={() => unpair(key)}>Unpair</button>
          </div>
        ))}
        <Link to="/settings/pair"><button style={{ marginTop: 12 }}>+ Pair new source</button></Link>

        <h2 style={{ marginTop: 32 }}>Preferences</h2>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={prefs.autoplayNext}
            onChange={(e) => update('autoplayNext', (e.currentTarget as HTMLInputElement).checked)}
          />
          Autoplay next episode
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={prefs.skipIntro}
            onChange={(e) => update('skipIntro', (e.currentTarget as HTMLInputElement).checked)}
          />
          Skip intro automatically
        </label>

        <h2 style={{ marginTop: 32 }}>About</h2>
        <p class="muted">passenger v2.0 · canvas/WebCodecs player</p>
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 4: Wire all three into `main.tsx`**

Update the route table in `main.tsx`:

```tsx
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
```

- [ ] **Step 5: Build + dev smoke**

```powershell
npm run build
npm run dev
```

- Visit `/#/search` — search input renders.
- Visit `/#/settings` — shows "No sources paired yet" + button.
- Visit `/#/item/p1/123` — shows "Loading…" then "Error: HTTP 404" or similar (no source paired).

- [ ] **Step 6: Commit**

```powershell
git add web/src/views/ItemDetail.tsx web/src/views/Search.tsx web/src/views/Settings.tsx web/src/main.tsx
git commit -m "v2: ItemDetail with hero + episodes, Search with debounce, Settings with sources/prefs"
```

---

## Task 16: Pair flow — Tesla side

**Files:**
- Create: `web/src/views/Pair.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `api`, `storage`, `Link`, `navigate`.
- Produces: `/settings/pair` view that lets user pick a source type, displays the PIN code, polls for approval, saves to localStorage on success.

- [ ] **Step 1: Create `views/Pair.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { api } from '../api';
import { Chrome } from '../components/Chrome';
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
  { type: 'jellyfin', label: 'Jellyfin', available: false }, // wired in Plan B
  { type: 'flixify', label: 'thecalm.site (Flixify)', available: false }, // wired in Plan B
  { type: 'generic', label: 'Direct URL', available: false }, // wired in Plan B
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
  }, [state.kind === 'pairing' ? state.code : null]);

  return (
    <Chrome>
      <div style={{ padding: 40, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
        {state.kind === 'choose' && (
          <>
            <h2>Pair a new source</h2>
            <p class="muted" style={{ marginBottom: 24 }}>Choose what kind of source you want to add.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {SOURCE_TYPES.map((s) => (
                <button
                  key={s.type}
                  disabled={!s.available}
                  onClick={() => startPair(s.type)}
                  style={{ padding: '16px 20px', textAlign: 'left' }}
                >
                  {s.label} {!s.available && <span class="muted" style={{ fontSize: 13 }}>(coming soon)</span>}
                </button>
              ))}
            </div>
          </>
        )}
        {state.kind === 'pairing' && (
          <>
            <h2>On your phone, go to:</h2>
            <p style={{ fontSize: 20, margin: '16px 0' }}>passenger-v2.pages.dev/#/pair</p>
            <p>Enter this code:</p>
            <div style={{
              fontSize: 56, fontWeight: 700, letterSpacing: 4,
              background: 'var(--row)', padding: '24px 32px', borderRadius: 12,
              display: 'inline-block', margin: '16px 0',
            }}>{state.code}</div>
            <p class="muted">Waiting for approval…</p>
            <p class="muted" style={{ fontSize: 13, marginTop: 16 }}>
              Code expires {new Date(state.expiresAt).toLocaleTimeString()}.
            </p>
          </>
        )}
        {state.kind === 'paired' && (
          <>
            <h2 style={{ color: 'var(--accent)' }}>✓ Paired</h2>
            <p>{state.label} is now linked. Redirecting…</p>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <h2 style={{ color: 'var(--danger)' }}>Pair failed</h2>
            <p>{state.message}</p>
            <button onClick={() => setState({ kind: 'choose' })} style={{ marginTop: 16 }}>Try again</button>
          </>
        )}
      </div>
    </Chrome>
  );
}
```

- [ ] **Step 2: Wire `Pair` into `main.tsx`**

Add the import and replace the `/settings/pair` route line:

```tsx
import { Pair } from './views/Pair';
// ...
['/settings/pair', () => <Pair />],
```

- [ ] **Step 3: Build + dev smoke**

```powershell
npm run build
npm run dev
```

Visit `/#/settings/pair` → source picker shown, only Plex is enabled. Click Plex → calls real worker API at `VITE_PASSENGER_API_V2`. Without `.env`, the build will likely fail to reach the worker (API_BASE is empty string → relative URL hits dev server which returns 404). Configure `.env` per Step 4.

- [ ] **Step 4: Add `web/.env`**

Create `web/.env` (the user already has the relevant URL from T10 deploy):

```
VITE_PASSENGER_API_V2=https://passenger-api-v2.<acct>.workers.dev
```

(The leading `<` placeholder must be replaced with the real acct subdomain. The user knows this from Task 10.)

Re-run `npm run build` and `npm run dev`. Clicking "Plex" in the picker should now produce a PIN like `K7P-Q3M`.

- [ ] **Step 5: Commit**

```powershell
git add web/src/views/Pair.tsx web/src/main.tsx web/.env.example
git commit -m "v2: Pair view (Tesla side) — source picker + PIN display + poll loop"
```

(If `web/.env.example` exists from v1, update it now to use `VITE_PASSENGER_API_V2`; if not, create it without your real worker URL.)

---

## Task 17: Pair flow — phone side (`/pair`)

**Files:**
- Create: `web/src/views/PhonePair.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `api.pairApprove`. For Plex specifically, talks to `plex.tv/api/v2/pins` to acquire the user's Plex token via the standard headless-device OAuth.
- Produces: `/pair` view. On phone: user enters the code displayed by the Tesla, signs in to Plex via plex.tv pop-up flow, the resulting `authToken` is sent to `/api/pair/approve` along with the chosen server URL.

This is the only step where the user types something on the phone (not the Tesla). Server URL entry for Plex requires picking from their server list — Plex's `/api/v2/resources` endpoint enumerates the user's servers post-auth.

- [ ] **Step 1: Create `views/PhonePair.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';
import { useRoute } from '../router';
import { api } from '../api';

const PLEX_PRODUCT = 'Passenger';
const CLIENT_ID_KEY = 'passenger.plex.clientId';

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

interface PlexResource {
  name: string;
  clientIdentifier: string;
  product: string;
  provides: string;
  connections: { uri: string; local: boolean; relay: boolean; https: boolean }[];
}

async function plexListServers(authToken: string): Promise<PlexResource[]> {
  const res = await fetch('https://plex.tv/api/v2/resources?includeHttps=1', {
    headers: {
      Accept: 'application/json',
      'X-Plex-Token': authToken,
      'X-Plex-Client-Identifier': plexClientId(),
    },
  });
  if (!res.ok) throw new Error(`plex.tv GET /resources failed: ${res.status}`);
  const all = await res.json() as PlexResource[];
  return all.filter((r) => r.provides.split(',').includes('server'));
}

export function PhonePair() {
  const route = useRoute();
  const codeFromUrl = route.query.code ?? '';
  const typeFromUrl = route.query.type ?? '';
  const [code, setCode] = useState(codeFromUrl);
  const [stage, setStage] = useState<
    | { kind: 'enter-code' }
    | { kind: 'plex-pin'; pin: PlexPin }
    | { kind: 'plex-servers'; authToken: string; servers: PlexResource[] }
    | { kind: 'done' }
    | { kind: 'error'; message: string }
  >({ kind: 'enter-code' });

  async function startPlex() {
    try {
      const pin = await plexCreatePin();
      setStage({ kind: 'plex-pin', pin });
      const authUrl = `https://app.plex.tv/auth#?clientID=${plexClientId()}&code=${pin.code}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PLEX_PRODUCT)}`;
      window.open(authUrl, '_blank');
      // Poll the pin until it has an authToken.
      const start = Date.now();
      while (Date.now() - start < 10 * 60 * 1000) {
        await new Promise((r) => setTimeout(r, 2000));
        const polled = await plexPollPin(pin.id);
        if (polled.authToken) {
          const servers = await plexListServers(polled.authToken);
          setStage({ kind: 'plex-servers', authToken: polled.authToken, servers });
          return;
        }
      }
      setStage({ kind: 'error', message: 'Plex sign-in timed out' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  async function approveWithServer(authToken: string, server: PlexResource) {
    try {
      // Prefer https + local connection; fall back to relay.
      const conn = server.connections.find((c) => c.local && c.https)
        ?? server.connections.find((c) => c.https)
        ?? server.connections[0];
      if (!conn) throw new Error('No connection for this Plex server');
      await api.pairApprove({
        code,
        type: 'plex',
        baseUrl: conn.uri,
        token: authToken,
        label: server.name,
      });
      setStage({ kind: 'done' });
    } catch (e) {
      setStage({ kind: 'error', message: (e as Error).message });
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 500, margin: '0 auto', fontFamily: 'system-ui' }}>
      <h1>passenger · phone pair</h1>
      {stage.kind === 'enter-code' && (
        <>
          <p>Enter the code shown on your Tesla:</p>
          <input
            value={code}
            onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value.toUpperCase())}
            placeholder="XXX-XXX"
            style={{ fontSize: 24, textAlign: 'center', letterSpacing: 4, marginBottom: 16 }}
          />
          {(typeFromUrl === 'plex' || code) && (
            <button
              disabled={code.length < 7}
              onClick={() => { if (typeFromUrl === 'plex' || code) startPlex(); }}
              style={{ width: '100%', padding: 14, fontSize: 16 }}
            >
              Sign in to Plex →
            </button>
          )}
        </>
      )}
      {stage.kind === 'plex-pin' && (
        <p>Waiting for Plex sign-in to complete in the popup window…</p>
      )}
      {stage.kind === 'plex-servers' && (
        <>
          <p>Pick your Plex server:</p>
          {stage.servers.length === 0 && <p style={{ color: '#c33' }}>No servers found for this account.</p>}
          {stage.servers.map((s) => (
            <button
              key={s.clientIdentifier}
              onClick={() => approveWithServer(stage.authToken, s)}
              style={{ display: 'block', width: '100%', padding: 14, marginBottom: 8, textAlign: 'left' }}
            >
              {s.name}
            </button>
          ))}
        </>
      )}
      {stage.kind === 'done' && (
        <>
          <h2 style={{ color: '#0a7d2c' }}>✓ Linked</h2>
          <p>Return to your Tesla — it should pick up the source within a few seconds.</p>
        </>
      )}
      {stage.kind === 'error' && (
        <>
          <h2 style={{ color: '#c33' }}>Pair failed</h2>
          <p>{stage.message}</p>
          <button onClick={() => setStage({ kind: 'enter-code' })} style={{ marginTop: 12 }}>Try again</button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire `/pair` into `main.tsx`**

```tsx
import { PhonePair } from './views/PhonePair';
// ...
['/pair', () => <PhonePair />],
```

- [ ] **Step 3: End-to-end pair smoke (on desktop, while the dev server is running)**

```powershell
cd C:\github\passenger\web
npm run dev
```

On desktop:
- Open `http://localhost:5173/#/settings/pair` in one tab. Click Plex → code appears.
- Open `http://localhost:5173/#/pair?code=<the-code>&type=plex` in another tab.
- Click "Sign in to Plex" — a plex.tv popup appears. Sign in.
- Server picker appears. Pick your Plex server.
- The first tab transitions to "✓ Paired" within ~3 seconds.
- Visit `/#/` — Home now shows your Plex Continue Watching + Recently Added rows.

If anything fails, devtools network/console should tell you exactly which call broke.

- [ ] **Step 4: Commit**

```powershell
git add web/src/views/PhonePair.tsx web/src/main.tsx
git commit -m "v2: phone pair view — plex.tv PIN OAuth flow + server picker + approve"
```

---

## Task 18: Player view (wraps the existing engine)

**Files:**
- Create: `web/src/views/Player.tsx`
- Create: `web/src/components/PlayerControls.tsx`
- Modify: `web/src/main.tsx`

**Interfaces:**
- Consumes: `api.play`, `api.progress`, `RangeFetcher`, `Demuxer`, `VideoSink`, `AudioSink`, types.
- Produces: `/play/:src/:id` route that resolves the URL, sets up the canvas pipeline, shows controls, and saves progress every 15 s.

This is the most complex view because it wires the player engine into the SPA. The engine itself is unchanged from v1.

- [ ] **Step 1: Create `components/PlayerControls.tsx`**

```tsx
interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onToggleSubs?: () => void;
  subsOn?: boolean;
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

export function PlayerControls(p: PlayerControlsProps) {
  return (
    <>
      <button
        onClick={p.onClose}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10,
          opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
          pointerEvents: p.visible ? 'auto' : 'none',
        }}
      >✕</button>
      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        padding: '24px 20px 16px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
        opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
        pointerEvents: p.visible ? 'auto' : 'none',
        zIndex: 10,
      }}>
        <input
          type="range"
          min={0}
          max={Math.max(1, p.durationSec)}
          step={1}
          value={Math.min(p.posSec, p.durationSec)}
          onChange={(e) => p.onSeek(Number((e.currentTarget as HTMLInputElement).value))}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <button onClick={() => p.onSeekRelative(-10)}>◀ 10s</button>
          <button onClick={p.onPlayPause}>{p.paused ? '▶' : '⏸'}</button>
          <button onClick={() => p.onSeekRelative(+10)}>10s ▶</button>
          <span class="muted" style={{ marginLeft: 'auto' }}>
            {fmt(p.posSec)} / {fmt(p.durationSec)}
          </span>
          {p.onToggleSubs && (
            <button onClick={p.onToggleSubs}>{p.subsOn ? 'CC ✓' : 'CC'}</button>
          )}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create `views/Player.tsx`**

```tsx
import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { navigate } from '../router';
import { PlayerControls } from '../components/PlayerControls';
import { RangeFetcher } from '../player/range-fetcher';
import { Demuxer } from '../player/demux';
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

  // Long-lived refs for engine pieces.
  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const demuxerRef = useRef<Demuxer | null>(null);
  const fetcherRef = useRef<RangeFetcher | null>(null);
  const pendingVideoRef = useRef<EncodedVideoChunk[]>([]);
  const pendingAudioRef = useRef<EncodedAudioChunk[]>([]);
  const startedRef = useRef(false);
  const reportRef = useRef(0);
  const resolutionRef = useRef<PlayResolution | null>(null);

  // Auto-hide controls after 3s of inactivity.
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

  // Pos/duration polling tick (every 250ms).
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = videoRef.current;
      const a = audioRef.current;
      if (a) setPos(a.currentTime());
      if (resolutionRef.current) setDuration(resolutionRef.current.durationSec);

      // Progress save every 15s.
      const now = Date.now();
      if (startedRef.current && now - reportRef.current > PROGRESS_INTERVAL_MS) {
        reportRef.current = now;
        const cur = a ? a.currentTime() : 0;
        void api.progress(source, id, cur, false).catch(() => {});
      }
    }, 250);
    return () => clearInterval(t);
  }, [source, id]);

  // Boot the engine.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setStatus('Resolving stream…');
        const resolution = await api.play(source, id);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');

        const canvas = canvasRef.current!;

        const demuxer = new Demuxer({
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
              audioRef.current = audio;
            }
            setStatus('Ready — tap to play');
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onError: (e) => setErrMsg(`demux: ${e.message}`),
        });
        demuxerRef.current = demuxer;

        const fetcher = new RangeFetcher({
          url: resolution.url,
          chunkSize: 4 * 1024 * 1024,
          onChunk: (offset, bytes) => demuxer.appendChunk(offset, bytes),
          onError: (e) => setErrMsg(`fetch: ${e.message}`),
          onDone: () => { demuxer.flush(); videoRef.current?.flush().catch(() => {}); },
        });
        fetcherRef.current = fetcher;
        fetcher.start();
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      fetcherRef.current?.abort();
      videoRef.current?.close();
      audioRef.current?.stop();
    };
  }, [source, id]);

  // Save progress on close.
  useEffect(() => {
    return () => {
      const a = audioRef.current;
      if (a && startedRef.current) {
        const cur = a.currentTime();
        const url = `${import.meta.env.VITE_PASSENGER_API_V2}/api/progress/${encodeURIComponent(source)}/${encodeURIComponent(id)}`;
        navigator.sendBeacon?.(url, JSON.stringify({ posSec: cur, completed: false }));
      }
    };
  }, [source, id]);

  async function onPlayPause() {
    if (errMsg) return;
    if (!startedRef.current) {
      if (audioRef.current) await audioRef.current.start();
      videoRef.current?.start();
      for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
      for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
      pendingVideoRef.current = [];
      pendingAudioRef.current = [];
      startedRef.current = true;
      setPaused(false);
      setStatus('');
      return;
    }
    // Toggle pause via AudioContext suspend/resume; video clock follows audio.
    const a = audioRef.current as unknown as { ctx?: { suspend(): Promise<void>; resume(): Promise<void> } } | null;
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx?.suspend?.();
      setPaused(true);
    } else {
      await a?.ctx?.resume?.();
      videoRef.current?.start();
      setPaused(false);
    }
  }

  function onSeek(sec: number) {
    const dem = demuxerRef.current;
    const fet = fetcherRef.current;
    const v = videoRef.current;
    if (!dem || !fet) return;
    const { videoByteOffset } = dem.seek(sec);
    v?.reset();
    fet.seek(videoByteOffset);
  }

  function onSeekRelative(delta: number) {
    onSeek(Math.max(0, pos + delta));
  }

  async function onClose() {
    const a = audioRef.current;
    if (a && startedRef.current) {
      await api.progress(source, id, a.currentTime(), false).catch(() => {});
    }
    navigate(`/item/${source}/${id}`);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000' }}>
      <canvas
        ref={canvasRef}
        style={{ maxWidth: '100vw', maxHeight: '100vh', display: 'block', margin: '0 auto' }}
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
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
      />
    </div>
  );
}
```

- [ ] **Step 3: Wire into `main.tsx`**

```tsx
import { Player } from './views/Player';
// ...
['/play/:src/:id', (p) => <Player source={p.src!} id={p.id!} />],
```

- [ ] **Step 4: Build + dev smoke**

```powershell
npm run build
npm run dev
```

If you have a Plex source paired:
- Navigate to home → click any movie → ItemDetail → click Play.
- Player should resolve the URL, decode, render to canvas. Tap Play → audio + video sync.
- Pause, seek, close all work. Closing returns to ItemDetail; `viewOffsetSec` should reflect roughly where you stopped.

- [ ] **Step 5: Commit**

```powershell
git add web/src/views/Player.tsx web/src/components/PlayerControls.tsx web/src/main.tsx
git commit -m "v2: Player view wires the canvas engine with controls, seek, progress save"
```

---

## Task 19: Deploy v2 frontend and end-to-end Tesla smoke

**Files:** none (deploy only)

**Interfaces:**
- Consumes: working local v2 stack.
- Produces: live `https://passenger-v2.pages.dev/` (or its hashed preview URL) backed by the live `passenger-api-v2` worker, end-to-end verified on the user's Tesla.

- [ ] **Step 1: Production build**

```powershell
cd C:\github\passenger\web
npm run build
```

The build must succeed; `dist/` contains `index.html`, `audio-worklet.js`, and hashed assets.

- [ ] **Step 2: First deploy to a new Pages project**

```powershell
npx wrangler pages deploy ./dist --project-name=passenger-v2
```

If prompted, create a new project. Wrangler prints the live URL (e.g., `https://passenger-v2.pages.dev`). Copy it.

- [ ] **Step 3: Desktop end-to-end**

Open `https://passenger-v2.pages.dev/` in your desktop browser:

1. You should see "No sources paired yet." Click `+ Pair your first source`.
2. Pick Plex → PIN appears.
3. In a second tab on phone or desktop, open `https://passenger-v2.pages.dev/#/pair?code=<that-code>&type=plex`.
4. Click "Sign in to Plex" → complete Plex OAuth → pick your server.
5. Tesla tab transitions to "✓ Paired" → redirects to Settings; source visible.
6. Visit `/#/` — Plex Continue Watching + Recently Added rows render.
7. Click any item → ItemDetail → Play → canvas player loads and plays with audio.
8. Pause, seek, close. `viewOffsetSec` updates on Plex (verify in Plex Web).

- [ ] **Step 4: Tesla smoke (in Park)**

In the Tesla, in P:
1. Open `https://passenger-v2.pages.dev/`.
2. The token + worker URL are baked into the bundle via `VITE_PASSENGER_API_V2`; no Settings entry needed.
3. Repeat the pair flow (use your phone for the phone-side step).
4. Play a queued item.
5. Confirm the canvas pipeline works as in v1.

- [ ] **Step 5: Tesla shift-out-of-Park check (the experiment, again)**

While a movie is playing, shift to N (or D in a controlled stationary spot — never while driving). Verify playback continues. This re-confirms the v1 result on the new v2 stack.

- [ ] **Step 6: Document the result**

Append a short "Plan A result" block to `docs/superpowers/specs/2026-06-27-passenger-v2-design.md`:

```markdown
## Plan A result (recorded YYYY-MM-DD)

- Worker deployed: passenger-api-v2.<acct>.workers.dev
- Pages deployed: passenger-v2.pages.dev
- Plex pair flow: works
- Browse + play + resume: works
- Tesla in-Park playback: works
- Tesla shift-out-of-Park: <played continuously | broke as below>
- Notes:
```

Commit:

```powershell
git add docs/superpowers/specs/2026-06-27-passenger-v2-design.md
git commit -m "v2: record Plan A acceptance result"
```

- [ ] **Step 7: Push the v2 branch**

```powershell
git push -u origin v2
```

Plan A is done when criteria 1, 2, 3, 4 of the spec's Success Criteria pass: pair Plex, browse, play with audio sync, resume from saved position. Plans B → D follow.

---

## Self-review notes

- **Spec coverage:** Every spec component for v2.0 that depends on having Plex working is covered:
  - Worker: SourceAdapter registry (T2), CORS+cache+log (T3), pair routes (T4), federated routes (T5), Plex adapter (T6-T9), deploy (T10).
  - Frontend: scaffold (T11), player engine port (T12), router+API+storage (T13), Home+Library (T14), ItemDetail+Search+Settings (T15), Pair Tesla side (T16), Pair phone side (T17), Player view (T18), deploy + smoke (T19).
  - Player polish items beyond Plex's "view offset" resume (subtitles, audio tracks, intro markers, gestures, auto-next) are **deliberately deferred to Plan C** — they live behind capability that not all Plan B adapters will expose, and don't block Plan A acceptance.
  - Adapters Jellyfin / Flixify / Generic are deliberately deferred to Plan B; their pair-flow buttons in T16 are disabled with "coming soon."
- **Naming consistency:** `srcKey` (frontend) ↔ `srcKey` (worker route) ↔ map key in `X-Sources` header — same identifier across the boundary. `pairUrl` returned by adapters → `/pair?code=...&type=...` on the same Pages origin. `viewOffsetSec` consistent from Plex API (ms) → adapter mapping → ItemDetail → Player.
- **Types:** `web/src/types.ts` and `worker/src/sources/types.ts` are deliberately separate copies of the same shapes — they cross a service boundary, so we don't share a runtime module, but the shapes match by construction. If any property is renamed in one, the other must follow.
- **Test posture matches spec:** Vitest only for pure worker logic (cache, x-sources parsing, PIN generation, plex-api parsers). All HTTP integration and UI behavior is manual smoke per task. This is in line with the spec's testing direction (no formal section, but the v1 precedent and v2's "feels like a streaming app" success criterion both point at integration over unit).
- **No placeholders found** in tasks 1-19 (the design doc's line 143 reference to "TBD by writing-plans" is a self-reference, not a plan placeholder; tasks T15/T16's "coming soon" buttons reference Plan B and are intentional).
