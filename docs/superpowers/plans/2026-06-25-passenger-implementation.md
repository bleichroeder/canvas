# Passenger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tesla in-vehicle passenger-entertainment surface that plays H.264/AAC MP4 video through a WebCodecs + `<canvas>` + WebAudio pipeline (bypassing the `<video>`-element restriction), fed by a bookmarklet-driven queue stored in a Cloudflare Worker.

**Architecture:** Three independent packages in one repo. Bookmarklet captures the signed MP4 URL from a source-site movie page and POSTs to a Cloudflare Worker. Worker stores the queue in KV. Cloudflare Pages static site (Vite + TypeScript, no framework) reads the queue and plays selected items via WebCodecs.

**Tech Stack:** TypeScript, Vite, Cloudflare Workers, Cloudflare Pages, Cloudflare KV, `mp4box.js`, WebCodecs (`VideoDecoder`, `AudioDecoder`), Web Audio API (`AudioWorklet`), esbuild (for bookmarklet bundling), Wrangler CLI.

## Global Constraints

- All code TypeScript except the bookmarklet source (plain ES5-compatible JS so it inlines as `javascript:` URL after minification).
- Repository root: `C:\github\passenger`.
- No automated tests in v1 — manual smoke verification only (per spec). Every task ends with a manual verification step plus a commit.
- No frameworks in the web app. Plain DOM, MPA via Vite.
- Single static bearer token for auth (set as Wrangler secret; pasted into bookmarklet build and `localStorage` on the web app).
- Three subdirectories, each with its own `package.json`. No workspaces — independent installs.
- Target browser: Tesla MCU3 (Ryzen) Chromium. Desktop Chrome/Edge for development.
- HTTPS required for production (Cloudflare Pages handles this).
- Out of scope for v1: subtitles, ABR, multi-user, Chromecast, transparent proxy, DRM, MJPEG fallback, offline, PiP, telemetry.

---

## Task 1: Repo scaffolding and root metadata

**Files:**
- Create: `C:\github\passenger\README.md`
- Create: `C:\github\passenger\package.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a navigable repo root that names the project and points to the three subpackages.

- [ ] **Step 1: Confirm working directory and existing tree**

```powershell
cd C:\github\passenger
git status
```

Expected: clean working tree on `main` with the spec already committed (commit `86373ab` or later).

- [ ] **Step 2: Write the root README**

Create `C:\github\passenger\README.md`:

```markdown
# Passenger

Experimental Tesla in-vehicle WebCodecs/canvas video player.
Passenger entertainment only — not for the driver, not for moving vehicles.

## Layout

- `worker/` — Cloudflare Worker queue API.
- `web/` — Vite + TypeScript static site deployed to Cloudflare Pages.
- `bookmarklet/` — Source + builder for the capture bookmarklet.
- `docs/superpowers/specs/` — design spec.
- `docs/superpowers/plans/` — implementation plan.

## Setup (one-time)

1. Generate a bearer token: any 32+ hex chars.
2. `worker/`: `npm install`, `npx wrangler kv:namespace create PASSENGER_QUEUE`, copy the ID into `wrangler.toml`, then `npx wrangler secret put PASSENGER_TOKEN`.
3. `web/`: `npm install`, `npm run dev`.
4. `bookmarklet/`: `npm install`, edit `.env` with token + worker URL, `npm run build`, open `dist/install.html`.

See `docs/superpowers/specs/2026-06-25-passenger-design.md` for full architecture.
```

- [ ] **Step 3: Write the root package.json**

Create `C:\github\passenger\package.json`:

```json
{
  "name": "passenger",
  "version": "0.0.1",
  "private": true,
  "description": "Experimental Tesla in-vehicle WebCodecs/canvas video player",
  "license": "UNLICENSED"
}
```

- [ ] **Step 4: Commit**

```powershell
git add README.md package.json
git commit -m "Add repo root scaffolding"
```

---

## Task 2: Worker — project init

**Files:**
- Create: `C:\github\passenger\worker\package.json`
- Create: `C:\github\passenger\worker\tsconfig.json`
- Create: `C:\github\passenger\worker\wrangler.toml`
- Create: `C:\github\passenger\worker\src\index.ts` (placeholder)

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable empty Worker that responds `ok` on `GET /health`, plus the KV namespace binding `QUEUE` declared but not yet created in Cloudflare.

- [ ] **Step 1: Make the directory**

```powershell
mkdir C:\github\passenger\worker\src
```

- [ ] **Step 2: Write `worker/package.json`**

Create `C:\github\passenger\worker\package.json`:

```json
{
  "name": "passenger-worker",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240419.0",
    "typescript": "^5.4.5",
    "wrangler": "^3.57.0"
  }
}
```

- [ ] **Step 3: Write `worker/tsconfig.json`**

Create `C:\github\passenger\worker\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Write `worker/wrangler.toml`**

Create `C:\github\passenger\worker\wrangler.toml` (KV id placeholder filled in Task 3):

```toml
name = "passenger-api"
main = "src/index.ts"
compatibility_date = "2026-06-01"

[[kv_namespaces]]
binding = "QUEUE"
id = "REPLACE_WITH_KV_ID"
```

- [ ] **Step 5: Write a placeholder Worker**

Create `C:\github\passenger\worker\src\index.ts`:

```typescript
export interface Env {
  PASSENGER_TOKEN: string;
  QUEUE: KVNamespace;
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

- [ ] **Step 6: Install and typecheck**

```powershell
cd C:\github\passenger\worker
npm install
npm run typecheck
```

Expected: no output (success).

- [ ] **Step 7: Smoke run locally**

```powershell
npx wrangler dev --local --port 8787
```

In another shell:

```powershell
curl http://127.0.0.1:8787/health
```

Expected: `ok`. Stop `wrangler dev` with Ctrl-C.

- [ ] **Step 8: Commit**

```powershell
cd C:\github\passenger
git add worker/
git commit -m "Scaffold Cloudflare Worker with /health endpoint"
```

---

## Task 3: Worker — KV namespace and secret

**Files:**
- Modify: `C:\github\passenger\worker\wrangler.toml` (real KV id)

**Interfaces:**
- Consumes: scaffolding from Task 2.
- Produces: a deployed KV namespace `PASSENGER_QUEUE` bound to the Worker as `QUEUE`, plus a Wrangler secret `PASSENGER_TOKEN` containing the bearer token.

- [ ] **Step 1: Authenticate Wrangler if needed**

```powershell
cd C:\github\passenger\worker
npx wrangler whoami
```

If not logged in: `npx wrangler login`, complete OAuth in browser.

- [ ] **Step 2: Create KV namespace**

```powershell
npx wrangler kv:namespace create PASSENGER_QUEUE
```

Expected output includes a line like:

```
[[kv_namespaces]]
binding = "PASSENGER_QUEUE"
id = "abc123..."
```

Copy that `id` value.

- [ ] **Step 3: Update `wrangler.toml` with the real KV id**

Edit `C:\github\passenger\worker\wrangler.toml`, replace `REPLACE_WITH_KV_ID` with the id from Step 2. The binding name stays `QUEUE` (what the code uses) — only the `id` changes:

```toml
[[kv_namespaces]]
binding = "QUEUE"
id = "<actual-id-here>"
```

- [ ] **Step 4: Generate and set the bearer token**

Generate a 32-byte hex token (PowerShell):

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$token = ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
Write-Output $token
```

Save this token in a password manager — you will paste it into the bookmarklet build and into the web Settings page.

Set it as a Worker secret:

```powershell
npx wrangler secret put PASSENGER_TOKEN
```

Paste the token when prompted.

- [ ] **Step 5: Verify local dev still works**

```powershell
npx wrangler dev --local --port 8787
# in another shell:
curl http://127.0.0.1:8787/health
# expect: ok
```

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add worker/wrangler.toml
git commit -m "Wire real KV namespace id into Worker config"
```

(The token never enters the repo — it lives in Wrangler secrets and your password manager only.)

---

## Task 4: Worker — queue API routes

**Files:**
- Modify: `C:\github\passenger\worker\src\index.ts`
- Create: `C:\github\passenger\worker\src\queue.ts`
- Create: `C:\github\passenger\worker\src\cors.ts`
- Create: `C:\github\passenger\worker\src\id.ts`

**Interfaces:**
- Consumes: Env binding `QUEUE: KVNamespace`, secret `PASSENGER_TOKEN`.
- Produces:
  - `POST /api/queue` body `{url: string, title?: string}` → `{id, url, title, addedAt}` (200) or 401/400.
  - `GET /api/queue` → `Array<{id, url, title, addedAt}>` sorted by `addedAt` desc.
  - `DELETE /api/queue/:id` → 204 or 404.
  - `GET /health` → `ok`.
  - `OPTIONS *` preflight with permissive CORS for the bookmarklet origin and Pages origin.

- [ ] **Step 1: Write the id generator**

Create `C:\github\passenger\worker\src\id.ts`:

```typescript
// Time-prefixed random id. Newer ids sort after older ids lexicographically.
export function makeId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${ts}-${rand}`;
}
```

- [ ] **Step 2: Write the CORS helper**

Create `C:\github\passenger\worker\src\cors.ts`:

```typescript
const ALLOWED_ORIGINS = new Set<string>([
  'https://thecalm.site',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

const PAGES_SUFFIXES = ['.pages.dev'];

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return PAGES_SUFFIXES.some((s) => url.hostname.endsWith(s));
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
    'access-control-allow-headers': 'content-type, x-passenger-token',
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

- [ ] **Step 3: Write the queue module**

Create `C:\github\passenger\worker\src\queue.ts`:

```typescript
import { makeId } from './id';

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const KEY_PREFIX = 'queue:';
const TTL_SECONDS = 6 * 60 * 60;
const MAX_ITEMS = 50;

function key(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

export async function addItem(
  kv: KVNamespace,
  url: string,
  title: string,
): Promise<QueueItem> {
  const item: QueueItem = {
    id: makeId(),
    url,
    title,
    addedAt: Date.now(),
  };
  await kv.put(key(item.id), JSON.stringify(item), {
    expirationTtl: TTL_SECONDS,
  });
  await trim(kv);
  return item;
}

export async function listItems(kv: KVNamespace): Promise<QueueItem[]> {
  const list = await kv.list({ prefix: KEY_PREFIX, limit: MAX_ITEMS + 10 });
  const items = await Promise.all(
    list.keys.map(async (k) => {
      const v = await kv.get(k.name, 'json');
      return v as QueueItem | null;
    }),
  );
  return items
    .filter((x): x is QueueItem => x !== null)
    .sort((a, b) => b.addedAt - a.addedAt);
}

export async function deleteItem(kv: KVNamespace, id: string): Promise<boolean> {
  const k = key(id);
  const existed = (await kv.get(k)) !== null;
  if (existed) await kv.delete(k);
  return existed;
}

async function trim(kv: KVNamespace): Promise<void> {
  const items = await listItems(kv);
  if (items.length <= MAX_ITEMS) return;
  const excess = items.slice(MAX_ITEMS);
  await Promise.all(excess.map((it) => kv.delete(key(it.id))));
}
```

- [ ] **Step 4: Replace the placeholder Worker with the full router**

Replace the contents of `C:\github\passenger\worker\src\index.ts`:

```typescript
import { withCors, corsHeaders } from './cors';
import { addItem, listItems, deleteItem } from './queue';

export interface Env {
  PASSENGER_TOKEN: string;
  QUEUE: KVNamespace;
}

function authed(req: Request, env: Env): boolean {
  const token = req.headers.get('x-passenger-token');
  return !!token && token === env.PASSENGER_TOKEN;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(req) });
    }

    if (url.pathname === '/health') {
      return withCors(req, new Response('ok', { headers: { 'content-type': 'text/plain' } }));
    }

    if (!authed(req, env)) {
      return withCors(req, json({ error: 'unauthorized' }, 401));
    }

    if (url.pathname === '/api/queue') {
      if (req.method === 'GET') {
        const items = await listItems(env.QUEUE);
        return withCors(req, json(items));
      }
      if (req.method === 'POST') {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return withCors(req, json({ error: 'invalid json' }, 400));
        }
        if (
          typeof body !== 'object' ||
          body === null ||
          typeof (body as { url?: unknown }).url !== 'string'
        ) {
          return withCors(req, json({ error: 'missing url' }, 400));
        }
        const { url: mediaUrl, title } = body as { url: string; title?: string };
        const item = await addItem(env.QUEUE, mediaUrl, title?.trim() || 'Untitled');
        return withCors(req, json(item));
      }
    }

    const deleteMatch = url.pathname.match(/^\/api\/queue\/([\w-]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      const id = deleteMatch[1]!;
      const existed = await deleteItem(env.QUEUE, id);
      return withCors(req, json({ ok: existed }, existed ? 200 : 404));
    }

    return withCors(req, json({ error: 'not found' }, 404));
  },
};
```

- [ ] **Step 5: Typecheck**

```powershell
cd C:\github\passenger\worker
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Local smoke test**

Start the worker (local mode uses in-memory KV):

```powershell
npx wrangler dev --local --port 8787
```

In another shell, save your token to a variable and test:

```powershell
$T = '<your-token>'
# health (no auth)
curl http://127.0.0.1:8787/health
# expect: ok

# POST without auth
curl -X POST http://127.0.0.1:8787/api/queue -H "content-type: application/json" --data '{\"url\":\"https://example.com/v.mp4\"}'
# expect: 401 {"error":"unauthorized"}

# POST with auth
curl -X POST http://127.0.0.1:8787/api/queue -H "content-type: application/json" -H "x-passenger-token: $T" --data '{\"url\":\"https://example.com/v.mp4\",\"title\":\"Test\"}'
# expect: 200 with {id, url, title, addedAt}

# LIST
curl -H "x-passenger-token: $T" http://127.0.0.1:8787/api/queue
# expect: array with one item
```

Stop `wrangler dev` with Ctrl-C.

- [ ] **Step 7: Commit**

```powershell
cd C:\github\passenger
git add worker/src/
git commit -m "Implement queue API: POST/GET/DELETE with auth, CORS, KV storage"
```

---

## Task 5: Worker — deploy and smoke test

**Files:** none (deploy only)

**Interfaces:**
- Consumes: completed Task 4.
- Produces: a live Worker at `https://passenger-api.<account>.workers.dev` (or your chosen subdomain) reachable from any allowed origin. Note this hostname for use in later tasks.

- [ ] **Step 1: Deploy**

```powershell
cd C:\github\passenger\worker
npx wrangler deploy
```

Expected output ends with a line like `Published passenger-api (1.23 sec) https://passenger-api.<your-account>.workers.dev`. Copy this URL — write it down as `WORKER_URL`.

- [ ] **Step 2: Smoke test the deployed Worker**

```powershell
$T = '<your-token>'
$WORKER = 'https://passenger-api.<your-account>.workers.dev'

curl "$WORKER/health"
# expect: ok

curl -X POST "$WORKER/api/queue" -H "content-type: application/json" -H "x-passenger-token: $T" --data '{\"url\":\"https://example.com/v.mp4\",\"title\":\"Deploy Test\"}'
# expect: {id:...,url:...,title:"Deploy Test",addedAt:...}

curl -H "x-passenger-token: $T" "$WORKER/api/queue"
# expect: array containing the deploy test

# delete it (replace <id> with the id from the POST response)
curl -X DELETE -H "x-passenger-token: $T" "$WORKER/api/queue/<id>"
# expect: {"ok":true}
```

- [ ] **Step 3: Commit nothing (deploy-only task)**

```powershell
cd C:\github\passenger
git log --oneline -1
# expect: previous commit hash (no new commit for this task)
```

---

## Task 6: Bookmarklet — source, builder, install page

**Files:**
- Create: `C:\github\passenger\bookmarklet\package.json`
- Create: `C:\github\passenger\bookmarklet\src.js`
- Create: `C:\github\passenger\bookmarklet\build.mjs`
- Create: `C:\github\passenger\bookmarklet\.env.example`
- Create: `C:\github\passenger\bookmarklet\.gitignore`

**Interfaces:**
- Consumes: deployed Worker URL (Task 5) and bearer token.
- Produces: `dist/install.html` — a one-page guide containing a draggable `javascript:` link the user adds to their bookmarks bar. The bookmarklet, when clicked on a source-site movie page, POSTs `{url, title}` to the Worker's `/api/queue`.

- [ ] **Step 1: Create the bookmarklet directory and package metadata**

```powershell
mkdir C:\github\passenger\bookmarklet
```

Create `C:\github\passenger\bookmarklet\package.json`:

```json
{
  "name": "passenger-bookmarklet",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node build.mjs"
  },
  "devDependencies": {
    "esbuild": "^0.21.0"
  }
}
```

Create `C:\github\passenger\bookmarklet\.env.example`:

```
PASSENGER_TOKEN=
PASSENGER_API=https://passenger-api.<your-account>.workers.dev
```

Create `C:\github\passenger\bookmarklet\.gitignore`:

```
node_modules/
dist/
.env
```

- [ ] **Step 2: Write the bookmarklet source**

Create `C:\github\passenger\bookmarklet\src.js`:

```javascript
(function () {
  var TOKEN = '__PASSENGER_TOKEN__';
  var API = '__PASSENGER_API__';

  function showToast(msg, ok) {
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText =
      'position:fixed;top:16px;right:16px;padding:12px 16px;' +
      'background:' + (ok ? '#0a7d2c' : '#a02020') + ';color:#fff;' +
      'border-radius:6px;z-index:2147483647;font:14px/1.3 system-ui,sans-serif;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.3)';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3000);
  }

  var v = document.querySelector('video');
  if (!v || !v.currentSrc) {
    showToast('Passenger: no <video> with a src found. Press play first.', false);
    return;
  }

  var rawTitle = document.title || 'Untitled';
  var title = rawTitle.replace(/\s*-\s*Thecalm\.site\s*$/i, '').trim() || 'Untitled';

  fetch(API + '/api/queue', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-passenger-token': TOKEN,
    },
    body: JSON.stringify({ url: v.currentSrc, title: title }),
  })
    .then(function (r) {
      if (r.ok) {
        showToast('Passenger: queued "' + title + '"', true);
      } else {
        showToast('Passenger: queue failed (' + r.status + ')', false);
      }
    })
    .catch(function (e) {
      showToast('Passenger: network error: ' + (e && e.message), false);
    });
})();
```

- [ ] **Step 3: Write the build script**

Create `C:\github\passenger\bookmarklet\build.mjs`:

```javascript
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as esbuild from 'esbuild';

async function main() {
  const dotenv = existsSync('.env') ? await readFile('.env', 'utf8') : '';
  const env = { ...process.env };
  for (const line of dotenv.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }

  const token = env.PASSENGER_TOKEN;
  const api = env.PASSENGER_API;
  if (!token || !api) {
    console.error('Missing PASSENGER_TOKEN or PASSENGER_API in .env');
    process.exit(1);
  }

  const src = await readFile('src.js', 'utf8');
  const substituted = src
    .replace('__PASSENGER_TOKEN__', token)
    .replace('__PASSENGER_API__', api.replace(/\/$/, ''));

  const minified = await esbuild.transform(substituted, {
    minify: true,
    target: 'es2015',
    format: 'iife',
  });

  const bookmarkletUrl = 'javascript:' + encodeURIComponent(minified.code);

  await mkdir('dist', { recursive: true });
  await writeFile('dist/bookmarklet.js', minified.code);
  await writeFile('dist/bookmarklet.url.txt', bookmarkletUrl);

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Install Passenger Bookmarklet</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 640px; margin: 40px auto; padding: 0 16px; color: #222; }
  h1 { margin-bottom: 8px; }
  .install { display: inline-block; padding: 10px 16px; background: #0a7d2c; color: white;
             border-radius: 6px; text-decoration: none; font-weight: 600; }
  .install:hover { background: #086020; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  ol li { margin-bottom: 8px; }
</style>
</head><body>
<h1>Passenger Bookmarklet</h1>
<p>Drag this button to your bookmarks bar:</p>
<p><a class="install" href="${bookmarkletUrl.replace(/"/g, '&quot;')}">Queue for Passenger</a></p>
<h2>Use</h2>
<ol>
  <li>Open a movie on the source site and start playback (so the video element gets a src).</li>
  <li>Click the bookmark.</li>
  <li>A green toast confirms the item was queued.</li>
</ol>
<h2>Notes</h2>
<ul>
  <li>API: <code>${api}</code></li>
  <li>This page contains your token in the bookmarklet URL — do not share.</li>
</ul>
</body></html>`;
  await writeFile('dist/install.html', html);

  console.log(`Built bookmarklet (${minified.code.length} bytes minified).`);
  console.log(`Open dist/install.html in your browser, then drag the link to your bookmarks bar.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 4: Install esbuild and build**

```powershell
cd C:\github\passenger\bookmarklet
npm install
copy .env.example .env
```

Edit `.env` and fill in your token + Worker URL. Then:

```powershell
npm run build
```

Expected: `Built bookmarklet (NNN bytes minified). Open dist/install.html ...`

- [ ] **Step 5: Verify**

Open `C:\github\passenger\bookmarklet\dist\install.html` in your normal browser. Drag the green button to your bookmarks bar. Then:

1. Open a movie on the source site.
2. Click Play on the page (so `<video>.currentSrc` is populated).
3. Click the bookmark.
4. Expect a green toast "Passenger: queued ..."

Then verify the Worker received it:

```powershell
$T = '<your-token>'
$WORKER = '<your-worker-url>'
curl -H "x-passenger-token: $T" "$WORKER/api/queue"
```

Expected: array containing the movie you just queued.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add bookmarklet/package.json bookmarklet/src.js bookmarklet/build.mjs bookmarklet/.env.example bookmarklet/.gitignore
git commit -m "Add bookmarklet: source, esbuild bundler, install page"
```

(The built artifacts under `bookmarklet/dist/` and the `.env` file are gitignored.)

---

## Task 7: Web app — Vite scaffolding and three HTML entry points

**Files:**
- Create: `C:\github\passenger\web\package.json`
- Create: `C:\github\passenger\web\tsconfig.json`
- Create: `C:\github\passenger\web\vite.config.ts`
- Create: `C:\github\passenger\web\index.html`
- Create: `C:\github\passenger\web\player.html`
- Create: `C:\github\passenger\web\settings.html`
- Create: `C:\github\passenger\web\src\styles.css`
- Create: `C:\github\passenger\web\src\config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Three navigable HTML pages served by `vite dev` at `/`, `/player.html`, `/settings.html`, each with a minimal shell linking the others. `config.ts` exports `getApiBase()` and `getToken()` reading `localStorage`.

- [ ] **Step 1: Make the directory**

```powershell
mkdir C:\github\passenger\web\src
```

- [ ] **Step 2: Write `web/package.json`**

Create `C:\github\passenger\web\package.json`:

```json
{
  "name": "passenger-web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "wrangler pages deploy ./dist --project-name=passenger"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vite": "^5.2.0",
    "wrangler": "^3.57.0"
  },
  "dependencies": {
    "mp4box": "^0.5.2"
  }
}
```

- [ ] **Step 3: Write `web/tsconfig.json`**

Create `C:\github\passenger\web\tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Write `web/vite.config.ts`**

Create `C:\github\passenger\web\vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        player: resolve(__dirname, 'player.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
    },
  },
});
```

- [ ] **Step 5: Write shared styles**

Create `C:\github\passenger\web\src\styles.css`:

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
         border: 1px solid #3a3e4a; border-radius: 6px; padding: 10px 14px;
         cursor: pointer; }
button:hover { background: #353946; }
input { font: inherit; color: var(--fg); background: #1a1c20;
        border: 1px solid #3a3e4a; border-radius: 6px; padding: 10px 12px;
        width: 100%; }
header { display: flex; align-items: center; padding: 16px 20px;
         border-bottom: 1px solid #232631; gap: 16px; }
header h1 { margin: 0; font-size: 18px; font-weight: 600; }
header nav { margin-left: auto; display: flex; gap: 12px; }
main { padding: 20px; max-width: 900px; margin: 0 auto; }
.muted { color: var(--muted); }
```

- [ ] **Step 6: Write `index.html` (queue list shell)**

Create `C:\github\passenger\web\index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Passenger — Queue</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <header>
      <h1>Passenger</h1>
      <nav>
        <a href="/index.html">Queue</a>
        <a href="/settings.html">Settings</a>
      </nav>
    </header>
    <main>
      <div id="queue-root">Loading…</div>
    </main>
    <script type="module" src="/src/queue.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `player.html` (canvas player shell)**

Create `C:\github\passenger\web\player.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Passenger — Player</title>
    <link rel="stylesheet" href="/src/styles.css" />
    <style>
      body { background: #000; }
      #stage { position: fixed; inset: 0; display: flex;
               align-items: center; justify-content: center; }
      #canvas { max-width: 100vw; max-height: 100vh; background: #000; }
      #controls { position: fixed; left: 0; right: 0; bottom: 0;
                  background: linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0));
                  padding: 24px 20px 16px; display: flex; gap: 12px; align-items: center;
                  transition: opacity 0.3s; }
      #controls.hidden { opacity: 0; pointer-events: none; }
      #seek { flex: 1; }
      #status { position: fixed; top: 12px; left: 12px; color: #ccc;
                background: rgba(0,0,0,0.5); padding: 6px 10px; border-radius: 4px;
                font-size: 13px; }
      #back { position: fixed; top: 12px; right: 12px; }
      #error { position: fixed; inset: 0; display: none; flex-direction: column;
               align-items: center; justify-content: center; color: #f88;
               text-align: center; padding: 20px; }
    </style>
  </head>
  <body>
    <div id="stage"><canvas id="canvas"></canvas></div>
    <div id="status">Initializing…</div>
    <a id="back" href="/index.html"><button>← Back</button></a>
    <div id="controls" class="hidden">
      <button id="play-pause">Play</button>
      <input id="seek" type="range" min="0" max="1000" value="0" step="1" />
      <span id="time" class="muted">0:00 / 0:00</span>
      <button id="volume-toggle">🔊</button>
    </div>
    <div id="error"></div>
    <script type="module" src="/src/player/index.ts"></script>
  </body>
</html>
```

- [ ] **Step 8: Write `settings.html`**

Create `C:\github\passenger\web\settings.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Passenger — Settings</title>
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <header>
      <h1>Passenger</h1>
      <nav>
        <a href="/index.html">Queue</a>
        <a href="/settings.html">Settings</a>
      </nav>
    </header>
    <main>
      <h2>Settings</h2>
      <p class="muted">Stored in this browser's localStorage only.</p>
      <form id="settings-form">
        <label>Worker API base URL<br /><input id="api-base" type="url" placeholder="https://passenger-api.example.workers.dev" /></label>
        <p></p>
        <label>Bearer token<br /><input id="token" type="password" /></label>
        <p></p>
        <button type="submit">Save</button>
        <span id="settings-status" class="muted"></span>
      </form>
    </main>
    <script type="module" src="/src/settings.ts"></script>
  </body>
</html>
```

- [ ] **Step 9: Write `src/config.ts`**

Create `C:\github\passenger\web\src\config.ts`:

```typescript
const API_KEY = 'passenger.apiBase';
const TOKEN_KEY = 'passenger.token';

export function getApiBase(): string {
  return (localStorage.getItem(API_KEY) || '').replace(/\/$/, '');
}

export function setApiBase(v: string): void {
  localStorage.setItem(API_KEY, v.trim());
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(v: string): void {
  localStorage.setItem(TOKEN_KEY, v.trim());
}

export function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { 'x-passenger-token': t } : {};
}
```

- [ ] **Step 10: Stub the entry scripts**

Create `C:\github\passenger\web\src\queue.ts`:

```typescript
const root = document.getElementById('queue-root');
if (root) root.textContent = 'queue page placeholder';
```

Create `C:\github\passenger\web\src\settings.ts`:

```typescript
const root = document.getElementById('settings-form');
if (root) root.addEventListener('submit', (e) => e.preventDefault());
```

Create `C:\github\passenger\web\src\player\index.ts`:

```typescript
const status = document.getElementById('status');
if (status) status.textContent = 'player placeholder';
```

(`src/player/` is a subdirectory — `mkdir` it first.)

```powershell
mkdir C:\github\passenger\web\src\player
```

- [ ] **Step 11: Install and run dev server**

```powershell
cd C:\github\passenger\web
npm install
npm run dev
```

Expected: Vite serves on `http://localhost:5173/`. Open it; you should see "passenger placeholder" content and be able to navigate between Queue, Settings, and Player pages (player at `/player.html`).

Stop dev server with Ctrl-C.

- [ ] **Step 12: Commit**

```powershell
cd C:\github\passenger
git add web/
git commit -m "Scaffold web app: Vite MPA with queue/player/settings shells"
```

---

## Task 8: Web — Settings page wired up

**Files:**
- Modify: `C:\github\passenger\web\src\settings.ts`

**Interfaces:**
- Consumes: `getApiBase`, `setApiBase`, `getToken`, `setToken` from `src/config.ts`.
- Produces: a working Settings form that reads and writes `localStorage` and confirms with a status message.

- [ ] **Step 1: Replace `src/settings.ts`**

Replace `C:\github\passenger\web\src\settings.ts`:

```typescript
import { getApiBase, setApiBase, getToken, setToken } from './config';

const apiInput = document.getElementById('api-base') as HTMLInputElement | null;
const tokenInput = document.getElementById('token') as HTMLInputElement | null;
const form = document.getElementById('settings-form') as HTMLFormElement | null;
const status = document.getElementById('settings-status');

if (apiInput) apiInput.value = getApiBase();
if (tokenInput) tokenInput.value = getToken();

form?.addEventListener('submit', (e) => {
  e.preventDefault();
  if (apiInput) setApiBase(apiInput.value);
  if (tokenInput) setToken(tokenInput.value);
  if (status) {
    status.textContent = 'Saved.';
    setTimeout(() => { if (status) status.textContent = ''; }, 1500);
  }
});
```

- [ ] **Step 2: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

Open `http://localhost:5173/settings.html`. Enter your Worker URL and token, click Save. Reload — values should persist.

Test from the devtools console on the same page:

```javascript
localStorage.getItem('passenger.apiBase')
localStorage.getItem('passenger.token')
```

Expected: both return what you saved.

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/settings.ts
git commit -m "Wire Settings form to localStorage"
```

---

## Task 9: Web — Queue list page

**Files:**
- Modify: `C:\github\passenger\web\src\queue.ts`

**Interfaces:**
- Consumes: `getApiBase`, `authHeaders` from `src/config.ts`. Worker `GET /api/queue` returning `QueueItem[]`.
- Produces: a polling queue list. Each row links to `/player.html?id=<id>`. Polls every 3 seconds while visible. Shows empty state and config-missing state.

- [ ] **Step 1: Replace `src/queue.ts`**

Replace `C:\github\passenger\web\src\queue.ts`:

```typescript
import { getApiBase, authHeaders, getToken } from './config';

interface QueueItem {
  id: string;
  url: string;
  title: string;
  addedAt: number;
}

const root = document.getElementById('queue-root');

function relativeTime(t: number): string {
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c),
  );
}

function render(state:
  | { kind: 'config-missing' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; items: QueueItem[] }): void {
  if (!root) return;
  if (state.kind === 'config-missing') {
    root.innerHTML = `<p>No Worker URL or token configured. <a href="/settings.html">Open Settings</a>.</p>`;
    return;
  }
  if (state.kind === 'loading') {
    root.innerHTML = `<p class="muted">Loading…</p>`;
    return;
  }
  if (state.kind === 'error') {
    root.innerHTML = `<p style="color:var(--danger)">Error: ${escapeHtml(state.message)}</p>`;
    return;
  }
  if (state.items.length === 0) {
    root.innerHTML = `<p class="muted">Queue is empty. Use the bookmarklet to add something.</p>`;
    return;
  }
  root.innerHTML = state.items
    .map(
      (it) => `
      <a href="/player.html?id=${encodeURIComponent(it.id)}"
         style="display:block;background:var(--row);padding:14px 16px;border-radius:8px;margin-bottom:8px;color:var(--fg);">
        <div style="font-weight:600">${escapeHtml(it.title)}</div>
        <div class="muted" style="font-size:13px;margin-top:4px">${relativeTime(it.addedAt)}</div>
      </a>`,
    )
    .join('');
}

async function fetchQueue(): Promise<void> {
  const base = getApiBase();
  const token = getToken();
  if (!base || !token) { render({ kind: 'config-missing' }); return; }
  try {
    const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
    if (!res.ok) { render({ kind: 'error', message: `HTTP ${res.status}` }); return; }
    const items: QueueItem[] = await res.json();
    render({ kind: 'ok', items });
  } catch (e) {
    render({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
  }
}

let timer: number | undefined;
function startPolling(): void {
  fetchQueue();
  timer = window.setInterval(fetchQueue, 3000);
}
function stopPolling(): void {
  if (timer !== undefined) { clearInterval(timer); timer = undefined; }
}

render({ kind: 'loading' });
startPolling();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling(); else startPolling();
});
```

- [ ] **Step 2: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

Open `http://localhost:5173/`. Confirm:

1. If you haven't configured Settings yet, you see the config-missing message.
2. After saving Settings, you see items from the Worker (use the bookmarklet to add one if empty).
3. Adding a new item via bookmarklet appears within ~3 seconds.
4. Tapping an item navigates to `/player.html?id=<id>` (will show placeholder for now).

Stop dev server.

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add web/src/queue.ts
git commit -m "Implement queue list page with polling"
```

---

## Task 10: Web player — range-fetcher

**Files:**
- Create: `C:\github\passenger\web\src\player\range-fetcher.ts`

**Interfaces:**
- Consumes: nothing (utility module).
- Produces: a `RangeFetcher` class that pulls a URL in sequential ranges via `fetch`, emitting `Uint8Array` chunks to a consumer callback, supporting `pauseAt(byteOffset)` resume, `seek(byteOffset)`, and `abort()`.

```typescript
export interface RangeFetcherOptions {
  url: string;
  chunkSize?: number;
  onChunk: (offset: number, bytes: Uint8Array) => void | Promise<void>;
  onError: (err: Error) => void;
  onDone: () => void;
}

export class RangeFetcher {
  private readonly url: string;
  private readonly chunkSize: number;
  private readonly onChunk: RangeFetcherOptions['onChunk'];
  private readonly onError: RangeFetcherOptions['onError'];
  private readonly onDone: RangeFetcherOptions['onDone'];
  private offset = 0;
  private totalSize: number | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private paused = false;

  constructor(opts: RangeFetcherOptions) {
    this.url = opts.url;
    this.chunkSize = opts.chunkSize ?? 4 * 1024 * 1024;
    this.onChunk = opts.onChunk;
    this.onError = opts.onError;
    this.onDone = opts.onDone;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    void this.loop();
  }

  pause(): void { this.paused = true; }
  resume(): void { if (this.running && this.paused) { this.paused = false; void this.loop(); } }
  seek(byteOffset: number): void { this.abort(); this.offset = byteOffset; this.start(); }

  abort(): void {
    this.running = false;
    this.paused = false;
    this.controller?.abort();
    this.controller = null;
  }

  get currentOffset(): number { return this.offset; }
  get total(): number | null { return this.totalSize; }

  private async loop(): Promise<void> {
    while (this.running && !this.paused) {
      if (this.totalSize !== null && this.offset >= this.totalSize) {
        this.running = false;
        this.onDone();
        return;
      }
      const end = this.offset + this.chunkSize - 1;
      this.controller = new AbortController();
      try {
        const res = await fetch(this.url, {
          headers: { Range: `bytes=${this.offset}-${end}` },
          signal: this.controller.signal,
        });
        if (!res.ok && res.status !== 206 && res.status !== 200) {
          throw new Error(`HTTP ${res.status}`);
        }
        const range = res.headers.get('content-range');
        if (range) {
          const m = range.match(/\/(\d+)$/);
          if (m) this.totalSize = Number(m[1]);
        } else if (this.totalSize === null) {
          const len = res.headers.get('content-length');
          if (len) this.totalSize = Number(len);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length === 0) {
          this.running = false;
          this.onDone();
          return;
        }
        const offsetForChunk = this.offset;
        this.offset += buf.length;
        await this.onChunk(offsetForChunk, buf);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        this.running = false;
        this.onError(e as Error);
        return;
      }
    }
  }
}
```

- [ ] **Step 1: Write the file** (above content)

- [ ] **Step 2: Smoke test from a temporary scratch script**

Add a temporary entry to `player.html` to load the test. Edit `C:\github\passenger\web\src\player\index.ts`:

```typescript
import { RangeFetcher } from './range-fetcher';

const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const testUrl = params.get('url');

if (testUrl) {
  let total = 0;
  const fetcher = new RangeFetcher({
    url: testUrl,
    chunkSize: 1 * 1024 * 1024,
    onChunk: (offset, bytes) => {
      total += bytes.length;
      if (status) status.textContent = `Fetched ${(total / 1024 / 1024).toFixed(2)} MiB at ${offset}`;
    },
    onError: (e) => { if (status) status.textContent = `Error: ${e.message}`; },
    onDone: () => { if (status) status.textContent = `Done. Total ${(total / 1024 / 1024).toFixed(2)} MiB`; },
  });
  fetcher.start();
  setTimeout(() => fetcher.abort(), 10_000);
} else {
  if (status) status.textContent = 'Player ready (pass ?url=... to test fetcher)';
}
```

- [ ] **Step 3: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

Grab a test URL (a small static MP4 or even a random file) and visit:

```
http://localhost:5173/player.html?url=<encoded-url>
```

Expected: the status text increments as chunks arrive, then stops after 10 seconds.

Stop dev server.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/range-fetcher.ts web/src/player/index.ts
git commit -m "Add range-fetcher with seek and abort support"
```

---

## Task 11: Web player — mp4box demux wrapper

**Files:**
- Create: `C:\github\passenger\web\src\player\demux.ts`
- Modify: `C:\github\passenger\web\src\player\index.ts`

**Interfaces:**
- Consumes: `mp4box` npm package, chunks from `RangeFetcher`.
- Produces: a `Demuxer` class that accepts file chunks at known byte offsets and emits:
  - `onReady(info)` — track metadata, `videoConfig: VideoDecoderConfig | null`, `audioConfig: AudioDecoderConfig | null`, `duration` (seconds), `videoTrackId`, `audioTrackId`.
  - `onVideoSample(EncodedVideoChunk)` per video sample, in decode order.
  - `onAudioSample(EncodedAudioChunk)` per audio sample.
  - `seek(seconds): { videoByteOffset: number, audioByteOffset: number, time: number }` — returns the byte offset of the nearest keyframe.

- [ ] **Step 1: Write `demux.ts`**

Create `C:\github\passenger\web\src\player\demux.ts`:

```typescript
import * as MP4Box from 'mp4box';

type MP4BoxFile = ReturnType<typeof MP4Box.createFile>;

interface MP4BoxBuffer extends ArrayBuffer { fileStart: number; }

export interface DemuxInfo {
  duration: number;
  videoConfig: VideoDecoderConfig | null;
  audioConfig: AudioDecoderConfig | null;
  videoTrackId: number | null;
  audioTrackId: number | null;
}

export interface DemuxOptions {
  onReady: (info: DemuxInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onError: (err: Error) => void;
}

export class Demuxer {
  private readonly file: MP4BoxFile;
  private readonly opts: DemuxOptions;
  private ready = false;
  private videoTrackId: number | null = null;
  private audioTrackId: number | null = null;
  private videoTimescale = 1;
  private audioTimescale = 1;

  constructor(opts: DemuxOptions) {
    this.opts = opts;
    this.file = MP4Box.createFile();
    this.file.onError = (e: string) => this.opts.onError(new Error(e));
    this.file.onReady = (info: any) => this.handleReady(info);
    this.file.onSamples = (id: number, _user: unknown, samples: any[]) =>
      this.handleSamples(id, samples);
  }

  appendChunk(offset: number, bytes: Uint8Array): void {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as MP4BoxBuffer;
    buf.fileStart = offset;
    this.file.appendBuffer(buf);
  }

  seek(seconds: number): { videoByteOffset: number; time: number } {
    const result = this.file.seek(seconds, true);
    return { videoByteOffset: result.offset, time: result.time };
  }

  flush(): void {
    this.file.flush();
  }

  private handleReady(info: any): void {
    if (this.ready) return;
    this.ready = true;

    let videoConfig: VideoDecoderConfig | null = null;
    let audioConfig: AudioDecoderConfig | null = null;
    let videoTrackId: number | null = null;
    let audioTrackId: number | null = null;

    for (const track of info.tracks) {
      if (track.type === 'video' && !videoTrackId) {
        videoTrackId = track.id;
        this.videoTrackId = track.id;
        this.videoTimescale = track.timescale;
        const description = extractAvccDescription(this.file, track.id);
        videoConfig = {
          codec: track.codec,
          codedWidth: track.video.width,
          codedHeight: track.video.height,
          ...(description ? { description } : {}),
        };
      } else if (track.type === 'audio' && !audioTrackId) {
        audioTrackId = track.id;
        this.audioTrackId = track.id;
        this.audioTimescale = track.timescale;
        const description = extractEsdsDescription(this.file, track.id);
        audioConfig = {
          codec: track.codec,
          sampleRate: track.audio.sample_rate,
          numberOfChannels: track.audio.channel_count,
          ...(description ? { description } : {}),
        };
      }
    }

    if (videoTrackId !== null) {
      this.file.setExtractionOptions(videoTrackId, null, { nbSamples: 60 });
    }
    if (audioTrackId !== null) {
      this.file.setExtractionOptions(audioTrackId, null, { nbSamples: 120 });
    }

    this.opts.onReady({
      duration: info.duration / info.timescale,
      videoConfig,
      audioConfig,
      videoTrackId,
      audioTrackId,
    });

    this.file.start();
  }

  private handleSamples(trackId: number, samples: any[]): void {
    if (trackId === this.videoTrackId) {
      for (const s of samples) {
        this.opts.onVideoSample(new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: (s.cts * 1_000_000) / this.videoTimescale,
          duration: (s.duration * 1_000_000) / this.videoTimescale,
          data: s.data,
        }));
      }
    } else if (trackId === this.audioTrackId) {
      for (const s of samples) {
        this.opts.onAudioSample(new EncodedAudioChunk({
          type: 'key',
          timestamp: (s.cts * 1_000_000) / this.audioTimescale,
          duration: (s.duration * 1_000_000) / this.audioTimescale,
          data: s.data,
        }));
      }
    }
  }
}

function extractAvccDescription(file: MP4BoxFile, trackId: number): Uint8Array | undefined {
  const track = (file as any).getTrackById(trackId);
  if (!track) return undefined;
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC;
    if (!box) continue;
    const stream = new (MP4Box as any).DataStream(undefined, 0, (MP4Box as any).DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

function extractEsdsDescription(file: MP4BoxFile, trackId: number): Uint8Array | undefined {
  const track = (file as any).getTrackById(trackId);
  if (!track) return undefined;
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const esds = entry.esds;
    if (!esds || !esds.esd) continue;
    const decoderConfig = esds.esd.descs?.[0];
    const decoderSpecific = decoderConfig?.descs?.[0];
    if (decoderSpecific?.data instanceof Uint8Array) {
      return decoderSpecific.data;
    }
  }
  return undefined;
}
```

- [ ] **Step 2: Update `player/index.ts` to glue fetcher + demux for inspection**

Replace `C:\github\passenger\web\src\player\index.ts`:

```typescript
import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';

const status = document.getElementById('status');
const params = new URLSearchParams(location.search);
const testUrl = params.get('url');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

if (testUrl) {
  let videoCount = 0;
  let audioCount = 0;
  const demuxer = new Demuxer({
    onReady: (info) => {
      log(`Ready: ${info.duration.toFixed(1)}s, video=${info.videoConfig?.codec}, audio=${info.audioConfig?.codec}`);
      console.log('demux info', info);
    },
    onVideoSample: () => { videoCount++; },
    onAudioSample: () => { audioCount++; },
    onError: (e) => { log(`Demux error: ${e.message}`); },
  });
  const fetcher = new RangeFetcher({
    url: testUrl,
    chunkSize: 2 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => { log(`Fetch error: ${e.message}`); },
    onDone: () => { log(`Done. video samples=${videoCount}, audio samples=${audioCount}`); demuxer.flush(); },
  });
  fetcher.start();
  setInterval(() => {
    log(`Samples: video=${videoCount}, audio=${audioCount}`);
  }, 1000);
} else {
  log('Player ready (pass ?url=... to test)');
}
```

- [ ] **Step 3: Install mp4box and run**

```powershell
cd C:\github\passenger\web
npm install
npm run dev
```

Visit `http://localhost:5173/player.html?url=<encoded-mp4-url>` using a fresh signed URL from a bookmarklet-queued movie.

Expected:
- Within ~1 second: status shows `Ready: NNNN.Ns, video=avc1.XXXXXX, audio=mp4a.40.2` (or similar).
- DevTools console shows the full demux info object including the `videoConfig` with a `description` Uint8Array.
- Sample counts increment as more chunks arrive.

If video codec string is missing or `description` is undefined, fix `extractAvccDescription`. If the audio codec is missing or unsupported, you'll surface that in Task 13.

Stop dev server.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/package.json web/package-lock.json web/src/player/demux.ts web/src/player/index.ts
git commit -m "Add mp4box demux wrapper, extract decoder configs"
```

---

## Task 12: Web player — silent video to canvas

**Files:**
- Create: `C:\github\passenger\web\src\player\video.ts`
- Modify: `C:\github\passenger\web\src\player\index.ts`

**Interfaces:**
- Consumes: a `VideoDecoderConfig` from `Demuxer`, a stream of `EncodedVideoChunk`s.
- Produces: a `VideoSink` class that decodes and draws frames on the supplied canvas. For Task 12 only: uses `performance.now()` as clock (no audio sync yet). Exposes `feed(chunk)`, `start()`, `stop()`, `flush()`.

- [ ] **Step 1: Write `video.ts`**

Create `C:\github\passenger\web\src\player\video.ts`:

```typescript
export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  onError: (err: Error) => void;
}

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly frames: VideoFrame[] = [];
  private startTimeUs: number | null = null;
  private startWallMs: number | null = null;
  private rafHandle: number | null = null;
  private maxQueued = 8;

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
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

  close(): void {
    this.stop();
    for (const f of this.frames) f.close();
    this.frames.length = 0;
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  get queuedFrames(): number { return this.frames.length; }

  get backpressure(): boolean { return this.frames.length >= this.maxQueued; }

  private onFrame(frame: VideoFrame): void {
    this.frames.push(frame);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    if (this.frames.length > this.maxQueued * 2) {
      const dropped = this.frames.shift();
      dropped?.close();
    }
  }

  private nowUs(): number {
    if (this.startTimeUs === null || this.startWallMs === null) {
      if (this.frames.length === 0) return 0;
      this.startTimeUs = this.frames[0]!.timestamp;
      this.startWallMs = performance.now();
      return this.startTimeUs;
    }
    return this.startTimeUs + (performance.now() - this.startWallMs) * 1000;
  }

  private drawDue(): void {
    const now = this.nowUs();
    let drawn: VideoFrame | null = null;
    while (this.frames.length > 0 && this.frames[0]!.timestamp <= now) {
      const f = this.frames.shift()!;
      if (drawn) drawn.close();
      drawn = f;
    }
    if (drawn) {
      this.ctx.drawImage(drawn, 0, 0, this.canvas.width, this.canvas.height);
      drawn.close();
    }
  }
}
```

- [ ] **Step 2: Replace `player/index.ts` to actually play**

Replace `C:\github\passenger\web\src\player\index.ts`:

```typescript
import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';
import { VideoSink } from './video';
import { getApiBase, authHeaders } from '../config';

interface QueueItem { id: string; url: string; title: string; addedAt: number; }

const status = document.getElementById('status');
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

function showError(msg: string): void {
  if (errorEl) {
    errorEl.style.display = 'flex';
    errorEl.textContent = msg;
  }
  if (status) status.textContent = msg;
}

async function getItemById(id: string): Promise<QueueItem | null> {
  const base = getApiBase();
  if (!base) return null;
  const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
  if (!res.ok) return null;
  const items: QueueItem[] = await res.json();
  return items.find((it) => it.id === id) ?? null;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const directUrl = params.get('url');

  let mediaUrl: string;
  let title = 'Untitled';

  if (directUrl) {
    mediaUrl = directUrl;
  } else if (id) {
    log('Looking up queue item…');
    const item = await getItemById(id);
    if (!item) { showError('Queue item not found or expired.'); return; }
    mediaUrl = item.url;
    title = item.title;
  } else {
    showError('No id or url specified.');
    return;
  }

  log(`Loading: ${title}`);

  let video: VideoSink | null = null;

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      log(`Ready: ${info.duration.toFixed(1)}s — decoding…`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
      video.start();
    },
    onVideoSample: (chunk) => { video?.feed(chunk); },
    onAudioSample: () => { /* audio in next task */ },
    onError: (e) => showError(`Demux error: ${e.message}`),
  });

  const fetcher = new RangeFetcher({
    url: mediaUrl,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => showError(`Fetch error: ${e.message}`),
    onDone: () => { demuxer.flush(); log('Stream complete'); },
  });
  fetcher.start();
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 3: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

1. Queue a movie via the bookmarklet.
2. Open `http://localhost:5173/`, tap the item.
3. Expect: video starts decoding and rendering on the canvas within ~2 seconds. **Silent — audio comes next task.**
4. Open devtools console; confirm no decoder errors.

Stop dev server.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/video.ts web/src/player/index.ts
git commit -m "Decode and render video to canvas (no audio yet)"
```

---

## Task 13: Web player — audio decoding and playback

**Files:**
- Create: `C:\github\passenger\web\src\player\audio.ts`
- Create: `C:\github\passenger\web\src\player\audio-worklet.js`
- Modify: `C:\github\passenger\web\src\player\index.ts`

**Interfaces:**
- Consumes: an `AudioDecoderConfig`, a stream of `EncodedAudioChunk`s, a user gesture (caller must call `start()` from a click handler so `AudioContext` resumes).
- Produces: an `AudioSink` class. Methods: `feed(chunk)`, `start()`, `stop()`, `currentTime()` returning seconds since playback start (master clock).

- [ ] **Step 1: Write the AudioWorklet processor**

Create `C:\github\passenger\web\src\player\audio-worklet.js`:

```javascript
class PassengerPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.framesPlayed = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'samples') {
        this.queue.push(e.data.channels);
      } else if (e.data?.type === 'reset') {
        this.queue.length = 0;
        this.framesPlayed = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const channelCount = out.length;
    let filled = 0;
    while (filled < frames) {
      if (this.queue.length === 0) {
        for (let c = 0; c < channelCount; c++) {
          out[c].fill(0, filled);
        }
        break;
      }
      const chunk = this.queue[0];
      const remaining = chunk[0].length - chunk.offset;
      const toCopy = Math.min(remaining, frames - filled);
      for (let c = 0; c < channelCount; c++) {
        const src = chunk[Math.min(c, chunk.length - 1)];
        out[c].set(src.subarray(chunk.offset, chunk.offset + toCopy), filled);
      }
      chunk.offset += toCopy;
      filled += toCopy;
      this.framesPlayed += toCopy;
      if (chunk.offset >= chunk[0].length) this.queue.shift();
    }
    this.port.postMessage({ type: 'progress', framesPlayed: this.framesPlayed });
    return true;
  }
}
registerProcessor('passenger-player', PassengerPlayerProcessor);
```

- [ ] **Step 2: Write `audio.ts`**

Create `C:\github\passenger\web\src\player\audio.ts`:

```typescript
export interface AudioSinkOptions {
  config: AudioDecoderConfig;
  onError: (err: Error) => void;
}

export class AudioSink {
  private readonly ctx: AudioContext;
  private readonly decoder: AudioDecoder;
  private readonly sampleRate: number;
  private readonly channelCount: number;
  private worklet: AudioWorkletNode | null = null;
  private startedAt: number | null = null;
  private framesPlayed = 0;

  constructor(opts: AudioSinkOptions) {
    this.sampleRate = opts.config.sampleRate;
    this.channelCount = opts.config.numberOfChannels;
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.decoder = new AudioDecoder({
      output: (data) => this.onData(data),
      error: (e) => opts.onError(e as unknown as Error),
    });
    this.decoder.configure(opts.config);
  }

  feed(chunk: EncodedAudioChunk): void {
    if (this.decoder.state === 'closed') return;
    this.decoder.decode(chunk);
  }

  async start(): Promise<void> {
    if (this.worklet) return;
    await this.ctx.audioWorklet.addModule('/src/player/audio-worklet.js');
    this.worklet = new AudioWorkletNode(this.ctx, 'passenger-player', {
      outputChannelCount: [this.channelCount],
    });
    this.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'progress') this.framesPlayed = e.data.framesPlayed;
    };
    this.worklet.connect(this.ctx.destination);
    await this.ctx.resume();
    this.startedAt = this.ctx.currentTime;
  }

  stop(): void {
    this.worklet?.disconnect();
    this.worklet = null;
    if (this.decoder.state !== 'closed') this.decoder.close();
    void this.ctx.close();
  }

  currentTime(): number {
    return this.framesPlayed / this.sampleRate;
  }

  private onData(data: AudioData): void {
    if (!this.worklet) { data.close(); return; }
    const channels: Float32Array[] = [];
    for (let c = 0; c < data.numberOfChannels; c++) {
      const buf = new Float32Array(data.numberOfFrames);
      data.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      channels.push(buf);
    }
    (channels as any).offset = 0;
    this.worklet.port.postMessage({ type: 'samples', channels });
    data.close();
  }
}
```

- [ ] **Step 3: Make the worklet file reachable by Vite**

Vite serves `/src/player/audio-worklet.js` directly because `.js` files in `src/` are served as static assets. Verify by visiting `http://localhost:5173/src/player/audio-worklet.js` after starting the dev server — you should see the JS source.

For the production build, ensure the worklet is also emitted. Add this to `web/vite.config.ts`:

Replace `C:\github\passenger\web\vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        player: resolve(__dirname, 'player.html'),
        settings: resolve(__dirname, 'settings.html'),
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

Update `audio.ts` to use a build-aware path. Replace the `addModule` line:

```typescript
const workletUrl = import.meta.env.DEV
  ? '/src/player/audio-worklet.js'
  : '/audio-worklet.js';
await this.ctx.audioWorklet.addModule(workletUrl);
```

(The dev path serves the source file; prod path comes from the Rollup output.)

- [ ] **Step 4: Wire audio into `player/index.ts`**

Replace `C:\github\passenger\web\src\player\index.ts`:

```typescript
import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';
import { VideoSink } from './video';
import { AudioSink } from './audio';
import { getApiBase, authHeaders } from '../config';

interface QueueItem { id: string; url: string; title: string; addedAt: number; }

const status = document.getElementById('status');
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error');
const playPauseBtn = document.getElementById('play-pause') as HTMLButtonElement | null;
const controls = document.getElementById('controls');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

function showError(msg: string): void {
  if (errorEl) {
    errorEl.style.display = 'flex';
    errorEl.textContent = msg;
  }
  if (status) status.textContent = msg;
}

async function getItemById(id: string): Promise<QueueItem | null> {
  const base = getApiBase();
  if (!base) return null;
  const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
  if (!res.ok) return null;
  const items: QueueItem[] = await res.json();
  return items.find((it) => it.id === id) ?? null;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const directUrl = params.get('url');

  let mediaUrl: string;
  let title = 'Untitled';

  if (directUrl) {
    mediaUrl = directUrl;
  } else if (id) {
    log('Looking up queue item…');
    const item = await getItemById(id);
    if (!item) { showError('Queue item not found or expired.'); return; }
    mediaUrl = item.url;
    title = item.title;
  } else {
    showError('No id or url specified.');
    return;
  }

  log(`Loading: ${title} — tap Play to start`);
  if (controls) controls.classList.remove('hidden');

  let video: VideoSink | null = null;
  let audio: AudioSink | null = null;
  let pendingVideo: EncodedVideoChunk[] = [];
  let pendingAudio: EncodedAudioChunk[] = [];
  let started = false;

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      log(`Ready: ${info.duration.toFixed(1)}s — tap Play`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
      if (info.audioConfig) {
        audio = new AudioSink({
          config: info.audioConfig,
          onError: (e) => showError(`Audio decode error: ${e.message}`),
        });
      }
    },
    onVideoSample: (chunk) => {
      if (started && video) video.feed(chunk);
      else pendingVideo.push(chunk);
    },
    onAudioSample: (chunk) => {
      if (started && audio) audio.feed(chunk);
      else pendingAudio.push(chunk);
    },
    onError: (e) => showError(`Demux error: ${e.message}`),
  });

  const fetcher = new RangeFetcher({
    url: mediaUrl,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => showError(`Fetch error: ${e.message}`),
    onDone: () => { demuxer.flush(); video?.flush().catch(() => {}); },
  });
  fetcher.start();

  playPauseBtn?.addEventListener('click', async () => {
    if (started) return;
    if (audio) await audio.start();
    if (video) video.start();
    for (const c of pendingVideo) video?.feed(c);
    for (const c of pendingAudio) audio?.feed(c);
    pendingVideo = [];
    pendingAudio = [];
    started = true;
    if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    log('Playing');
  });
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 5: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

1. Bookmarklet a movie, open the queue, tap it.
2. Wait for "Ready — tap Play", then tap **Play**.
3. Expect: video plays on canvas, audio plays through speakers. Sync may not be perfect yet but should be acceptable for verification (within a second or two).
4. Confirm no decoder errors in devtools console.

If audio decode errors: confirm `AudioDecoder.isConfigSupported(info.audioConfig)` is `true` in console; check that the `description` Uint8Array was extracted.

Stop dev server.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/audio.ts web/src/player/audio-worklet.js web/src/player/index.ts web/vite.config.ts
git commit -m "Add audio decode + AudioWorklet playback"
```

---

## Task 14: Web player — audio-master sync clock

**Files:**
- Modify: `C:\github\passenger\web\src\player\video.ts`
- Modify: `C:\github\passenger\web\src\player\index.ts`

**Interfaces:**
- Consumes: `AudioSink.currentTime()` from Task 13.
- Produces: `VideoSink` accepts an external clock function `() => number` (seconds). Frames are drawn when their PTS (in seconds) ≤ clock + small lookahead. Frames more than one frame interval behind clock are dropped.

- [ ] **Step 1: Update `VideoSink` to take an external clock**

Replace `C:\github\passenger\web\src\player\video.ts`:

```typescript
export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  clock: () => number;
  onError: (err: Error) => void;
}

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly clock: () => number;
  private readonly frames: VideoFrame[] = [];
  private rafHandle: number | null = null;
  private frameIntervalSec = 1 / 24;

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.clock = opts.clock;
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
    }
  }
}
```

- [ ] **Step 2: Wire clock in `player/index.ts`**

Edit `C:\github\passenger\web\src\player\index.ts`. Find the `video = new VideoSink({...})` block and replace it (only that block) to pass a clock function:

```typescript
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        clock: () => (audio ? audio.currentTime() : performance.now() / 1000),
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
```

- [ ] **Step 3: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

1. Queue a movie, open it from the queue, tap Play.
2. Watch a dialogue-heavy scene. Lips should sync with audio within a frame or two.
3. If sync drifts over time, check `audio.currentTime()` is monotonically increasing in the console — it should match real wall time.

Stop dev server.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/video.ts web/src/player/index.ts
git commit -m "Sync video to audio master clock"
```

---

## Task 15: Web player — UI controls (play/pause, seek, volume, time)

**Files:**
- Modify: `C:\github\passenger\web\src\player\index.ts`

**Interfaces:**
- Consumes: existing `Demuxer.seek(seconds)`, `VideoSink`, `AudioSink`.
- Produces: working play/pause button, seek bar (live during playback), current/total time display, mute button.

- [ ] **Step 1: Replace `player/index.ts` with the controls-aware version**

Replace `C:\github\passenger\web\src\player\index.ts`:

```typescript
import { RangeFetcher } from './range-fetcher';
import { Demuxer } from './demux';
import { VideoSink } from './video';
import { AudioSink } from './audio';
import { getApiBase, authHeaders } from '../config';

interface QueueItem { id: string; url: string; title: string; addedAt: number; }

const status = document.getElementById('status');
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const errorEl = document.getElementById('error');
const playPauseBtn = document.getElementById('play-pause') as HTMLButtonElement | null;
const seekEl = document.getElementById('seek') as HTMLInputElement | null;
const timeEl = document.getElementById('time');
const volumeBtn = document.getElementById('volume-toggle') as HTMLButtonElement | null;
const controls = document.getElementById('controls');

function log(msg: string): void {
  if (status) status.textContent = msg;
  console.log('[passenger]', msg);
}

function showError(msg: string): void {
  if (errorEl) {
    errorEl.style.display = 'flex';
    errorEl.textContent = msg;
  }
  if (status) status.textContent = msg;
}

function fmt(sec: number): string {
  if (!isFinite(sec)) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

async function getItemById(id: string): Promise<QueueItem | null> {
  const base = getApiBase();
  if (!base) return null;
  const res = await fetch(`${base}/api/queue`, { headers: authHeaders() });
  if (!res.ok) return null;
  const items: QueueItem[] = await res.json();
  return items.find((it) => it.id === id) ?? null;
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const directUrl = params.get('url');

  let mediaUrl: string;
  let title = 'Untitled';

  if (directUrl) {
    mediaUrl = directUrl;
  } else if (id) {
    log('Looking up queue item…');
    const item = await getItemById(id);
    if (!item) { showError('Queue item not found or expired.'); return; }
    mediaUrl = item.url;
    title = item.title;
  } else {
    showError('No id or url specified.');
    return;
  }

  log(`Loading: ${title} — tap Play to start`);
  if (controls) controls.classList.remove('hidden');

  let video: VideoSink | null = null;
  let audio: AudioSink | null = null;
  let duration = 0;
  let pendingVideo: EncodedVideoChunk[] = [];
  let pendingAudio: EncodedAudioChunk[] = [];
  let started = false;
  let paused = false;
  let muted = false;
  let seekingByUser = false;

  function getTimeSec(): number {
    if (audio) return audio.currentTime();
    return 0;
  }

  const demuxer = new Demuxer({
    onReady: (info) => {
      if (!info.videoConfig) { showError('No video track found.'); return; }
      duration = info.duration;
      log(`Ready: ${fmt(duration)} — tap Play`);
      video = new VideoSink({
        canvas,
        config: info.videoConfig,
        clock: () => getTimeSec(),
        onError: (e) => showError(`Video decode error: ${e.message}`),
      });
      if (info.audioConfig) {
        audio = new AudioSink({
          config: info.audioConfig,
          onError: (e) => showError(`Audio decode error: ${e.message}`),
        });
      }
    },
    onVideoSample: (chunk) => {
      if (started && video) video.feed(chunk);
      else pendingVideo.push(chunk);
    },
    onAudioSample: (chunk) => {
      if (started && audio) audio.feed(chunk);
      else pendingAudio.push(chunk);
    },
    onError: (e) => showError(`Demux error: ${e.message}`),
  });

  const fetcher = new RangeFetcher({
    url: mediaUrl,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { demuxer.appendChunk(offset, bytes); },
    onError: (e) => showError(`Fetch error: ${e.message}`),
    onDone: () => { demuxer.flush(); video?.flush().catch(() => {}); },
  });
  fetcher.start();

  playPauseBtn?.addEventListener('click', async () => {
    if (!started) {
      if (audio) await audio.start();
      if (video) video.start();
      for (const c of pendingVideo) video?.feed(c);
      for (const c of pendingAudio) audio?.feed(c);
      pendingVideo = [];
      pendingAudio = [];
      started = true;
      if (playPauseBtn) playPauseBtn.textContent = 'Pause';
      log('Playing');
      return;
    }
    // Toggle pause: stop visual clock (audio resume/suspend handles audio).
    paused = !paused;
    if (paused) {
      video?.stop();
      // AudioContext.suspend silences audio and freezes currentTime advancement.
      if (audio) await (audio as any).ctx?.suspend?.();
      if (playPauseBtn) playPauseBtn.textContent = 'Play';
    } else {
      if (audio) await (audio as any).ctx?.resume?.();
      video?.start();
      if (playPauseBtn) playPauseBtn.textContent = 'Pause';
    }
  });

  volumeBtn?.addEventListener('click', () => {
    muted = !muted;
    if (audio) {
      const ctx = (audio as any).ctx as AudioContext | undefined;
      const worklet = (audio as any).worklet as AudioWorkletNode | null;
      if (ctx && worklet) {
        if (muted) worklet.disconnect();
        else worklet.connect(ctx.destination);
      }
    }
    if (volumeBtn) volumeBtn.textContent = muted ? '🔇' : '🔊';
  });

  seekEl?.addEventListener('input', () => { seekingByUser = true; });
  seekEl?.addEventListener('change', () => {
    if (!seekEl || duration <= 0) { seekingByUser = false; return; }
    const target = (Number(seekEl.value) / 1000) * duration;
    const { videoByteOffset } = demuxer.seek(target);
    video?.reset();
    fetcher.seek(videoByteOffset);
    seekingByUser = false;
  });

  // Time/seek update loop
  setInterval(() => {
    if (!started) return;
    const t = getTimeSec();
    if (timeEl) timeEl.textContent = `${fmt(t)} / ${fmt(duration)}`;
    if (seekEl && !seekingByUser && duration > 0) {
      seekEl.value = String(Math.round((t / duration) * 1000));
    }
  }, 250);
}

main().catch((e) => showError(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 2: Expose `ctx` and `worklet` on `AudioSink` for the pause/mute hooks**

The `index.ts` code above uses `(audio as any).ctx` / `(audio as any).worklet` — that works because TS doesn't know about private fields. For cleaner code, edit `C:\github\passenger\web\src\player\audio.ts` and change two field declarations from `private` to `public`:

```typescript
public readonly ctx: AudioContext;
public worklet: AudioWorkletNode | null = null;
```

(Leave the rest of the file as-is. Remove the `as any` casts in `index.ts` accordingly:)

In `index.ts`, change two lines:

```typescript
if (audio) await audio.ctx.suspend();
```
```typescript
if (audio) await audio.ctx.resume();
```

And:

```typescript
const ctx = audio.ctx;
const worklet = audio.worklet;
```

- [ ] **Step 3: Verify**

```powershell
cd C:\github\passenger\web
npm run dev
```

1. Queue, open, Play.
2. Test pause: tap Pause, expect video freezes, audio silences, time stops advancing. Tap again, resumes.
3. Test seek: drag slider mid-playback to a different point. Expect: video reseeks within ~1 s, audio resumes from new position.
4. Test mute: tap volume, audio mutes / unmutes.
5. Confirm time display updates ~4x per second.

Stop dev server.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/index.ts web/src/player/audio.ts
git commit -m "Add player controls: play/pause, seek, mute, time display"
```

---

## Task 16: Deploy web to Cloudflare Pages

**Files:**
- Modify: `C:\github\passenger\web\package.json` if needed (Pages project name).

**Interfaces:**
- Consumes: deployed Worker (Task 5), built web app.
- Produces: a live URL on `<project>.pages.dev` that, with Settings configured, plays queued items.

- [ ] **Step 1: Production build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: no TypeScript errors; `dist/` populated with `index.html`, `player.html`, `settings.html`, `audio-worklet.js`, hashed JS assets.

- [ ] **Step 2: Local preview**

```powershell
npm run preview
```

Open the printed URL (typically `http://localhost:4173/`). Set settings, play a queued item. Confirm production build works end-to-end.

Stop preview server.

- [ ] **Step 3: First-time Pages deploy**

```powershell
npx wrangler pages deploy ./dist --project-name=passenger
```

If prompted, select "Create a new project". Wrangler prints a URL like `https://passenger.pages.dev` (or `https://<hash>.passenger.pages.dev` for a preview).

- [ ] **Step 4: Update Worker CORS to include the live Pages URL**

The deployed URL ending in `.pages.dev` should already match the wildcard in `worker/src/cors.ts`. Verify by visiting the deployed Pages URL, configuring Settings (point at your Worker URL + token), and confirming `/api/queue` requests succeed (devtools Network tab — no CORS errors).

If it fails, edit `worker/src/cors.ts` to add the literal hostname and redeploy:

```powershell
cd C:\github\passenger\worker
# edit cors.ts to add to ALLOWED_ORIGINS
npx wrangler deploy
```

- [ ] **Step 5: Commit any worker changes**

If you edited `cors.ts`:

```powershell
cd C:\github\passenger
git add worker/src/cors.ts
git commit -m "Allow Pages production origin in Worker CORS"
```

If you didn't edit anything, no commit.

- [ ] **Step 6: End-to-end smoke test from desktop**

1. Open `https://passenger.pages.dev/settings.html`, paste Worker URL + token, save.
2. Rebuild bookmarklet with the same token + Worker URL (already done — no change).
3. Use bookmarklet on source site to queue a movie.
4. Open `https://passenger.pages.dev/`, see the item, tap, Play.
5. Confirm video + audio playback works end-to-end against the deployed stack.

---

## Task 17: Tesla validation — the actual experiment

**Files:** none (manual test only)

**Interfaces:**
- Consumes: deployed system from Task 16.
- Produces: a verdict — does the canvas/WebCodecs pipeline play video when the car is not in Park?

- [ ] **Step 1: Pre-flight**

On your phone or laptop:
1. Open a movie on the source site, click Play.
2. Click the bookmarklet — see green toast.
3. Confirm item appears in queue at `https://passenger.pages.dev/`.

In the Tesla, in Park, with the browser open:
1. Navigate to `https://passenger.pages.dev/settings.html`. Paste Worker URL + token. Save.
2. Navigate to `https://passenger.pages.dev/`. Confirm queue list loads and the item is visible.

- [ ] **Step 2: In-Park playback**

Tap the queued item. Tap Play. Confirm video + audio plays smoothly. If anything fails here, it's not a Tesla issue — go back to desktop diagnosis.

- [ ] **Step 3: The experiment**

While the movie is playing, shift the car to N (or D, in a controlled stationary environment — e.g., a flat empty parking lot with no obstructions; do not drive while testing this).

- **If video continues to play:** the experimental claim is validated. The Tesla restriction is `<video>`-element-specific; canvas/WebCodecs rendering is not gated.
- **If video stops or canvas freezes:** the restriction is broader than `<video>`. Document the failure mode (does the page reload? does only the canvas freeze? does audio continue?).

- [ ] **Step 4: Record the result**

Append a "Result" section to the spec at `C:\github\passenger\docs\superpowers\specs\2026-06-25-passenger-design.md`:

```markdown
## Result (recorded YYYY-MM-DD)

- **Outcome:** [played continuously | froze on canvas | audio-only | other]
- **Observations:** [free text — anything unusual about timing, errors, console output if accessible]
- **Conclusion:** [the experimental claim is/is not validated]
```

```powershell
cd C:\github\passenger
git add docs/superpowers/specs/2026-06-25-passenger-design.md
git commit -m "Record Tesla validation result"
```

---

## Self-review notes

- **Spec coverage:** Every spec section maps to one or more tasks. Worker (T2-T5), bookmarklet (T6), web shell (T7-T9), player pipeline (T10-T15), deploy (T16), validation (T17).
- **Out-of-scope items confirmed absent from plan:** no subtitle path, no ABR, no multi-user, no MJPEG fallback, no PiP, no telemetry, no transparent proxy, no DRM, no offline.
- **Risk #1 (AAC support):** handled implicitly — if `AudioDecoder.configure` throws or `output` never fires, the `onError` paths in T13 will surface it. If you hit this on MCU3, that contradicts the assumption; revisit then.
- **Risk #2 (AudioContext autoplay policy):** handled in T13 — `AudioSink.start()` only runs from the user's tap on Play.
- **Risk #4 (URL expiry):** handled in T15 — fetcher's `onError` surfaces an expiry as a clear error message.
- **Sync model:** audio master via `AudioSink.currentTime()` (T13) consumed by `VideoSink` clock (T14).
- **Naming consistency check:** `VideoSink.reset()` (T14) called from seek handler (T15) — matches. `Demuxer.seek()` returns `{videoByteOffset, time}` (T11) — consumed correctly by T15. `RangeFetcher.seek(byteOffset)` (T10) — consumed correctly by T15. No mismatches found.
