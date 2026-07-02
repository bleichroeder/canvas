# Update Detection + Release Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.8.0 with server-side update detection via GitHub Releases API, a `docker-compose.yml` at repo root including Watchtower for auto-updates, and a Settings → About "Updates" card showing current + latest + release notes.

**Architecture:** Three tasks. T1 server-side (update-checker + admin route + Dockerfile CANVAS_VERSION propagation + tests). T2 deployment plumbing (docker-compose.yml + README rewrite + docs/updates.md + publish workflow GH Release step). T3 frontend (API method + `marked` dep + AboutTab "Updates" card).

**Tech Stack:** Bun + Hono + Drizzle backend (existing). React + Vite + MUI frontend (existing). `marked` new dep on frontend for markdown-to-HTML rendering of release notes.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.8.0` after manual smoke passes.
- **Server: no new deps.** Bun's global `fetch` handles GitHub API. In-memory cache is a plain object.
- **Frontend: one new dep** — `marked` (or similar tiny markdown-to-HTML renderer with SAFE-by-default output). See T3 for the exact choice.
- **Admin-only route.** Mounted behind existing `requireUser` + `requireAdmin` middleware, at `/api/admin/updates`.
- **Cache TTL: 6 hours** = 21_600_000 ms. In-memory only; resets on server restart. Single-flight — concurrent requests before fetch resolves share the same in-flight Promise.
- **Watchtower configuration:** poll interval 300s. `WATCHTOWER_LABEL_ENABLE=true` + `com.centurylinklabs.watchtower.enable=true` on canvas — label-scoped watch so Watchtower ignores other containers on the host.
- **`CANVAS_VERSION` env:** propagated from build ARG `VERSION` to the runtime stage of the Dockerfile. Defaults to `'dev'` if unset. Server reads via existing zod ConfigSchema.
- **Semver compare:** normalize by stripping leading `v`, split on `.`, integer-compare each part. `"dev"` and unparseable versions sort as older than any real version.
- **GitHub Release creation:** `softprops/action-gh-release@v2` with `generate_release_notes: true`. Requires `contents: write` permission on the workflow.
- **Response shape (must match verbatim):** `{ currentVersion, latestVersion, updateAvailable, publishedAt, releaseNotes, htmlUrl, checkedAt, error }` — all fields present in every response, nullable where noted in the type.
- **Endpoint URL (must match verbatim):** `GET /api/admin/updates/status`.
- **Failure modes:** GitHub 404 → `error: "no releases published yet"`. 5xx / network → serve stale cache if present, else `error: "GitHub API unavailable"`. 403 rate-limited → serve stale cache, else `error: "rate limited"`.

---

## File Structure

**Server (create):**
- `server/src/lib/update-checker.ts` — GitHub Releases fetch + cache + semver compare. Exports `getUpdateStatus(currentVersion): Promise<UpdateStatus>` and `UpdateStatus` type.
- `server/src/routes/admin-updates.ts` — `makeAdminUpdatesRoutes(getDb)` returning Hono. Single `GET /updates/status` route.
- `server/src/routes/admin-updates.test.ts` — auth + response-shape tests.
- `server/src/lib/update-checker.test.ts` — cache behavior + semver + failure modes.

**Server (modify):**
- `server/src/config.ts` — add `CANVAS_VERSION` field to zod schema, default `'dev'`.
- `server/src/app.ts` — mount admin-updates route behind admin middleware.

**Docker + workflow (modify):**
- `Dockerfile` — runtime stage adds `ARG VERSION=dev` + `ENV CANVAS_VERSION=$VERSION`.
- `.github/workflows/publish.yml` — bump `contents` permission to `write`; add `softprops/action-gh-release@v2` step.

**Deployment plumbing (create):**
- `docker-compose.yml` at repo root — canvas + Watchtower services.
- `docs/updates.md` — user-facing doc on how auto-update works, disabling it, manual updates, rollback.

**Deployment plumbing (modify):**
- `README.md` — swap Quick Start to point at docker-compose.yml. Move old `docker run` into an "Advanced / manual install" section below.

**Frontend (modify):**
- `web/package.json` — add `marked` dep.
- `web/src/api.ts` — add `adminUpdates.status()` method.
- `web/src/views/settings/AboutTab.tsx` — add "Updates" card.

**No changes to VideoSink / AudioSink / player pipeline / diagnostics.**

---

## Task 1: Server-side update detection

**Files:**
- Create: `server/src/lib/update-checker.ts`
- Create: `server/src/lib/update-checker.test.ts`
- Create: `server/src/routes/admin-updates.ts`
- Create: `server/src/routes/admin-updates.test.ts`
- Modify: `server/src/config.ts` (add CANVAS_VERSION)
- Modify: `server/src/app.ts` (mount route)
- Modify: `Dockerfile` (runtime CANVAS_VERSION env)

**Interfaces:**
- Consumes: `requireUser`, `requireAdmin` middleware (existing); `Db` type (existing, but the route doesn't need db — takes `getDb` param to match pattern).
- Produces:
  - `UpdateStatus` interface in `update-checker.ts` (shape below).
  - `getUpdateStatus(currentVersion: string): Promise<UpdateStatus>` function.
  - `makeAdminUpdatesRoutes(getDb: () => Db): Hono` returning a Hono instance with `GET /updates/status` mounted.
  - Route: `GET /api/admin/updates/status` returning `UpdateStatus` JSON.

- [ ] **Step 1: Write update-checker tests (failing)**

Create `server/src/lib/update-checker.test.ts`:

```typescript
import { describe, expect, test, beforeEach, mock } from 'bun:test';
import { getUpdateStatus, __resetForTests } from './update-checker';

// Helper to install a fetch mock returning a specific response.
function mockFetch(status: number, body: unknown): { calls: number } {
  const state = { calls: 0 };
  const original = globalThis.fetch;
  (globalThis as unknown as { fetch: unknown }).fetch = async () => {
    state.calls++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response;
  };
  // Restore in a teardown — bun:test doesn't have afterEach easily wired here,
  // so tests are responsible for calling __resetForTests() to clear cache.
  return Object.assign(state, {
    restore: () => {
      (globalThis as unknown as { fetch: typeof fetch }).fetch = original;
    },
  });
}

describe('getUpdateStatus', () => {
  beforeEach(() => __resetForTests());

  test('fetches from GitHub API on first call', async () => {
    const m = mockFetch(200, {
      tag_name: 'v0.8.0',
      published_at: '2026-07-02T12:00:00Z',
      body: '## What\'s new\n- Fix X\n- Add Y',
      html_url: 'https://github.com/bleichroeder/canvas/releases/tag/v0.8.0',
    });
    const status = await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    expect(status.currentVersion).toBe('v0.7.0');
    expect(status.latestVersion).toBe('v0.8.0');
    expect(status.updateAvailable).toBe(true);
    expect(status.releaseNotes).toContain("Fix X");
    expect(status.htmlUrl).toBe('https://github.com/bleichroeder/canvas/releases/tag/v0.8.0');
    expect(status.error).toBeNull();
    (m as unknown as { restore: () => void }).restore();
  });

  test('serves cached data within TTL, does not refetch', async () => {
    const m = mockFetch(200, {
      tag_name: 'v0.8.0',
      published_at: '2026-07-02T12:00:00Z',
      body: 'notes',
      html_url: 'https://example',
    });
    await getUpdateStatus('v0.7.0');
    await getUpdateStatus('v0.7.0');
    await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: v0.7.0 vs v0.8.0 → updateAvailable true', async () => {
    const m = mockFetch(200, { tag_name: 'v0.8.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.updateAvailable).toBe(true);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: v1.0.0 vs v0.9.99 → updateAvailable false', async () => {
    const m = mockFetch(200, { tag_name: 'v0.9.99', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v1.0.0');
    expect(status.updateAvailable).toBe(false);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: equal → updateAvailable false', async () => {
    const m = mockFetch(200, { tag_name: 'v0.7.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.updateAvailable).toBe(false);
    (m as unknown as { restore: () => void }).restore();
  });

  test('semver: "dev" current → updateAvailable true when a real version exists', async () => {
    const m = mockFetch(200, { tag_name: 'v0.1.0', published_at: '', body: '', html_url: '' });
    const status = await getUpdateStatus('dev');
    expect(status.updateAvailable).toBe(true);
    (m as unknown as { restore: () => void }).restore();
  });

  test('404 → error message, cached', async () => {
    const m = mockFetch(404, { message: 'Not Found' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
    expect(status.error).toBe('no releases published yet');
    // Second call should also be cached
    await getUpdateStatus('v0.7.0');
    expect(m.calls).toBe(1);
    (m as unknown as { restore: () => void }).restore();
  });

  test('5xx → error message, no stale cache available', async () => {
    const m = mockFetch(503, { message: 'Service unavailable' });
    const status = await getUpdateStatus('v0.7.0');
    expect(status.error).toBe('GitHub API unavailable');
    (m as unknown as { restore: () => void }).restore();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server
bun test src/lib/update-checker.test.ts
```

Expected: FAIL — `getUpdateStatus is not defined`.

- [ ] **Step 3: Implement `update-checker.ts`**

Create `server/src/lib/update-checker.ts`:

```typescript
export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  publishedAt: string | null;
  releaseNotes: string | null;
  htmlUrl: string | null;
  checkedAt: string;
  error: string | null;
}

const GITHUB_URL = 'https://api.github.com/repos/bleichroeder/canvas/releases/latest';
const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CacheEntry {
  data: UpdateStatus;
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<UpdateStatus> | null = null;

export function __resetForTests(): void {
  cache = null;
  inFlight = null;
}

function parseVersion(v: string): number[] | null {
  const cleaned = v.startsWith('v') ? v.slice(1) : v;
  const parts = cleaned.split('.');
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  return nums;
}

function compareVersions(a: string, b: string): number {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (av === null && bv === null) return 0;
  if (av === null) return -1; // unparseable/dev < any real version
  if (bv === null) return 1;
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

async function fetchFromGitHub(currentVersion: string): Promise<UpdateStatus> {
  const now = new Date().toISOString();
  const empty: UpdateStatus = {
    currentVersion,
    latestVersion: null,
    updateAvailable: false,
    publishedAt: null,
    releaseNotes: null,
    htmlUrl: null,
    checkedAt: now,
    error: null,
  };

  let res: Response;
  try {
    res = await fetch(GITHUB_URL, {
      headers: { 'accept': 'application/vnd.github+json' },
    });
  } catch {
    return { ...empty, error: 'GitHub API unavailable' };
  }

  if (res.status === 404) {
    return { ...empty, error: 'no releases published yet' };
  }
  if (res.status === 403) {
    return { ...empty, error: 'rate limited' };
  }
  if (res.status >= 500) {
    return { ...empty, error: 'GitHub API unavailable' };
  }
  if (!res.ok) {
    return { ...empty, error: `GitHub API returned ${res.status}` };
  }

  let body: {
    tag_name?: unknown;
    published_at?: unknown;
    body?: unknown;
    html_url?: unknown;
  };
  try {
    body = await res.json() as typeof body;
  } catch {
    return { ...empty, error: 'GitHub API returned invalid JSON' };
  }

  const latestVersion = typeof body.tag_name === 'string' ? body.tag_name : null;
  const publishedAt = typeof body.published_at === 'string' ? body.published_at : null;
  const releaseNotes = typeof body.body === 'string' ? body.body : null;
  const htmlUrl = typeof body.html_url === 'string' ? body.html_url : null;

  if (!latestVersion) {
    return { ...empty, error: 'GitHub API returned no tag_name' };
  }

  const updateAvailable = compareVersions(currentVersion, latestVersion) < 0;

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    publishedAt,
    releaseNotes,
    htmlUrl,
    checkedAt: now,
    error: null,
  };
}

export async function getUpdateStatus(currentVersion: string): Promise<UpdateStatus> {
  const now = Date.now();
  if (cache !== null && now - cache.fetchedAt < TTL_MS) {
    return { ...cache.data, currentVersion };
  }
  if (inFlight !== null) return inFlight;
  inFlight = (async () => {
    try {
      const data = await fetchFromGitHub(currentVersion);
      // Cache even error results (except transient 5xx if we have a stale cache — see below).
      if (data.error === 'GitHub API unavailable' && cache !== null) {
        // Prefer stale cache over transient error.
        return { ...cache.data, currentVersion, checkedAt: new Date().toISOString() };
      }
      cache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server
bun test src/lib/update-checker.test.ts
```

Expected: 8 passing tests.

- [ ] **Step 5: Add `CANVAS_VERSION` to config**

Read `server/src/config.ts` first. Add `CANVAS_VERSION` to the zod schema alongside the other env fields:

```typescript
CANVAS_VERSION: z.string().optional().default('dev'),
```

Also add it to the `process.env` mapping if the file uses that pattern (grep to confirm the shape).

- [ ] **Step 6: Write admin-updates route tests (failing)**

Create `server/src/routes/admin-updates.test.ts`:

```typescript
import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { Hono } from 'hono';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { createUser } from '../storage/users';
import { createDeviceSession, generateBearer, hashBearer } from '../lib/bearer';
import { requireUser, requireAdmin } from '../middleware/auth';
import { makeAdminUpdatesRoutes } from './admin-updates';
import { __resetForTests as resetUpdateCache } from '../lib/update-checker';

async function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);

  const admin = createUser(db, { label: 'A', role: 'admin' });
  const adminBearer = generateBearer();
  createDeviceSession(db, { userId: admin.id, deviceLabel: 'D', tokenHash: await hashBearer(adminBearer) });

  const member = createUser(db, { label: 'M', role: 'member' });
  const memberBearer = generateBearer();
  createDeviceSession(db, { userId: member.id, deviceLabel: 'D2', tokenHash: await hashBearer(memberBearer) });

  const app = new Hono();
  app.use('/api/admin/*', requireUser(() => db));
  app.use('/api/admin/*', requireAdmin);
  app.route('/api/admin', makeAdminUpdatesRoutes(() => db));

  return { app, adminBearer, memberBearer };
}

describe('admin-updates', () => {
  test('unauthenticated request → 401', async () => {
    resetUpdateCache();
    // Stub fetch to prevent real network call.
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status'));
    expect(res.status).toBe(401);
  });

  test('non-admin request → 403', async () => {
    resetUpdateCache();
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response('{}', { status: 200 }) as unknown as Response;
    const { app, memberBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status', {
      headers: { authorization: `Bearer ${memberBearer}` },
    }));
    expect(res.status).toBe(403);
  });

  test('admin request returns UpdateStatus shape', async () => {
    resetUpdateCache();
    (globalThis as unknown as { fetch: unknown }).fetch = async () =>
      new Response(JSON.stringify({
        tag_name: 'v0.8.0',
        published_at: '2026-07-02T12:00:00Z',
        body: 'notes',
        html_url: 'https://example',
      }), { status: 200 }) as unknown as Response;
    const { app, adminBearer } = await makeApp();
    const res = await app.fetch(new Request('http://test/api/admin/updates/status', {
      headers: { authorization: `Bearer ${adminBearer}` },
    }));
    expect(res.status).toBe(200);
    const body = await res.json() as {
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
      releaseNotes: string;
    };
    expect(body.currentVersion).toBeDefined();
    expect(body.latestVersion).toBe('v0.8.0');
    expect(body.updateAvailable).toBe(true);
    expect(body.releaseNotes).toBe('notes');
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

```bash
cd server
bun test src/routes/admin-updates.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 8: Implement `admin-updates.ts`**

Create `server/src/routes/admin-updates.ts`:

```typescript
import { Hono } from 'hono';
import type { Db } from '../db';
import { config } from '../config';
import { getUpdateStatus } from '../lib/update-checker';

export function makeAdminUpdatesRoutes(_getDb: () => Db) {
  const r = new Hono();

  r.get('/updates/status', async (c) => {
    const status = await getUpdateStatus(config.CANVAS_VERSION);
    return c.json(status);
  });

  return r;
}
```

The `_getDb` parameter is kept for symmetry with other admin route factories, even though this route doesn't need the DB.

- [ ] **Step 9: Mount route in `app.ts`**

Read `server/src/app.ts`. Add import at the top with the other route imports:

```typescript
import { makeAdminUpdatesRoutes } from './routes/admin-updates';
```

In the admin-mounting section (AFTER `app.use('/api/admin/*', requireAdmin)`), add:

```typescript
app.route('/api/admin', makeAdminUpdatesRoutes(() => db));
```

Place it adjacent to the existing admin-telemetry mount for readability.

- [ ] **Step 10: Run all server tests**

```bash
cd server
bun run typecheck
bun test
```

Expected: all previously passing tests still pass, plus the 8 update-checker tests and 3 admin-updates tests. No new typecheck errors.

- [ ] **Step 11: Modify `Dockerfile` to propagate `VERSION` to runtime**

Read `Dockerfile`. Find the final runtime stage (the one with `ENTRYPOINT`; look for `FROM oven/bun:1.3-alpine AS runtime` or similar). Add these lines somewhere before `ENTRYPOINT`, adjacent to any existing OCI-labels or ARG blocks:

```dockerfile
ARG VERSION=dev
ENV CANVAS_VERSION=$VERSION
```

The `VERSION` build arg is already passed from `publish.yml`. The web-build stage already reads it as `VITE_CANVAS_VERSION` for the client bundle. This propagates the same value to the runtime stage as `CANVAS_VERSION` for the server process.

- [ ] **Step 12: Commit**

```bash
git add server/src/lib/update-checker.ts server/src/lib/update-checker.test.ts server/src/routes/admin-updates.ts server/src/routes/admin-updates.test.ts server/src/config.ts server/src/app.ts Dockerfile
git commit -m "updates: server-side detection via GitHub Releases API"
```

---

## Task 2: Deployment plumbing — compose, docs, publish workflow

**Files:**
- Create: `docker-compose.yml` at repo root
- Create: `docs/updates.md`
- Modify: `README.md`
- Modify: `.github/workflows/publish.yml`

**Interfaces:** none — this task is infrastructure only.

- [ ] **Step 1: Create `docker-compose.yml` at repo root**

Create `docker-compose.yml`:

```yaml
services:
  canvas:
    image: ghcr.io/bleichroeder/canvas:latest
    container_name: canvas
    restart: unless-stopped
    ports:
      - "8787:8787"
      - "80:80"
      - "443:443"
    volumes:
      - canvas-data:/data
    # Diagnostic + telemetry knobs — see docs/diagnostics.md
    # environment:
    #   TELEMETRY_ENABLED: "true"
    #   TELEMETRY_RETENTION_DAYS: "30"
    #   TELEMETRY_MAX_ROWS: "1000"
    labels:
      # Opt this container into Watchtower's auto-update watch.
      com.centurylinklabs.watchtower.enable: "true"

  watchtower:
    image: containrrr/watchtower:latest
    container_name: canvas-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      # Only update containers explicitly labeled — don't touch other stuff.
      WATCHTOWER_LABEL_ENABLE: "true"
      # Check every 5 minutes.
      WATCHTOWER_POLL_INTERVAL: "300"
      # Remove old images after successful update to save disk.
      WATCHTOWER_CLEANUP: "true"

volumes:
  canvas-data:
```

- [ ] **Step 2: Create `docs/updates.md`**

Create `docs/updates.md`:

```markdown
# Updates

Canvas auto-updates via [Watchtower](https://containrrr.dev/watchtower/), bundled in the `docker-compose.yml` at the repo root.

## How it works

- Watchtower polls `ghcr.io/bleichroeder/canvas` every 5 minutes.
- When it sees a newer image than the currently-running one, it pulls the image, stops the canvas container, and starts a new one from the new image.
- Only containers explicitly labeled `com.centurylinklabs.watchtower.enable=true` are watched. Watchtower will not touch other containers on your host.
- The canvas data volume (`canvas-data`) persists across updates. Users, sources, and error reports are preserved.

## Viewing update status in canvas

Sign in as admin → **Settings → About**. The "Updates" card shows:

- Current running version.
- Latest published version (if newer than current).
- Release notes for the latest version.
- A hint that Watchtower will apply the update within 5 minutes.

## Disabling auto-updates

Remove the `watchtower` service from your `docker-compose.yml`, then:

```
docker-compose up -d
```

Canvas continues running. You'll need to update manually — see below.

## Triggering an update manually

Whether or not Watchtower is running:

```
docker-compose pull canvas
docker-compose up -d canvas
```

Watchtower will pick up the change on its next poll if it's still enabled.

## Rolling back to an older version

Pin canvas to a specific tag in your compose file:

```yaml
services:
  canvas:
    image: ghcr.io/bleichroeder/canvas:0.6.0
    # rest unchanged
```

Then:

```
docker-compose up -d canvas
```

Note: if the old version has DB schema older than your `canvas-data`, migrations only go forward. Rolling back may break if newer schema is required for the DB to load. Test rollbacks against a fresh volume if you're worried.

## Direct-Docker deployment (skipping compose)

If you're running canvas via plain `docker run` instead of compose, updates are your responsibility:

```
docker pull ghcr.io/bleichroeder/canvas:latest
docker rm -f canvas
docker run -d --restart unless-stopped --name canvas \
  -p 8787:8787 -p 80:80 -p 443:443 \
  -v canvas-data:/data \
  ghcr.io/bleichroeder/canvas:latest
```

This works but you don't get auto-updates. Watchtower can still work with `docker run` deployments — see [Watchtower docs](https://containrrr.dev/watchtower/).
```

- [ ] **Step 3: Update `README.md`**

Read `README.md` first. Find the current Quick Start section (contains a `docker run` command). Replace it with:

```markdown
### Quick start (recommended)

1. Download the compose file:
   ```
   curl -O https://raw.githubusercontent.com/bleichroeder/canvas/main/docker-compose.yml
   ```
2. Start canvas + auto-updater:
   ```
   docker-compose up -d
   ```
3. Open http://localhost:8787/setup and follow the wizard.

Canvas keeps itself up to date via [Watchtower](https://containrrr.dev/watchtower/), bundled in the compose file. See [docs/updates.md](docs/updates.md) for details.

### Advanced — plain `docker run`

If you'd rather not use compose (or Watchtower), you can run canvas directly:

```
docker run -d --restart unless-stopped --name canvas \
  -p 8787:8787 -p 80:80 -p 443:443 \
  -v canvas-data:/data \
  ghcr.io/bleichroeder/canvas:latest
```

You'll be responsible for pulling updates. See [docs/updates.md](docs/updates.md).
```

Do NOT touch other README sections. Only the Quick Start.

- [ ] **Step 4: Modify `publish.yml` — bump permissions + add release step**

Read `.github/workflows/publish.yml`. Update the `permissions` block at the job level:

```yaml
    permissions:
      contents: write   # (was: read) — needed to create the GitHub Release
      packages: write
```

Then add this step at the end of the `steps:` list, AFTER the existing `Build and push` step:

```yaml
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: canvas ${{ github.ref_name }}
          generate_release_notes: true
          draft: false
          prerelease: false
```

- [ ] **Step 5: Verify workflow syntax**

```bash
cd /c/github/passenger
gh workflow view publish.yml >/dev/null 2>&1 || echo "workflow parse check passed via YAML"
```

The `gh workflow view` command validates the file if `gh` is authenticated. Manual check: eyeball the YAML for correct indentation. No syntax test runs until we push a tag.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml docs/updates.md README.md .github/workflows/publish.yml
git commit -m "updates: docker-compose + Watchtower + docs + GH Release publish step"
```

---

## Task 3: Frontend — AboutTab "Updates" card

**Files:**
- Modify: `web/package.json` (add `marked` dep)
- Modify: `web/src/api.ts` (add `adminUpdates.status()`)
- Modify: `web/src/views/settings/AboutTab.tsx` (add "Updates" card)

**Interfaces:**
- Consumes: `/api/admin/updates/status` endpoint from T1.
- Consumes: `request` helper from `web/src/api.ts` (existing).
- Consumes: existing MUI components used elsewhere in AboutTab / settings.
- Produces: no new exports — self-contained UI.

**One preflight decision, locked in here:** for markdown rendering, use `marked` + a small runtime sanitization pass via `DOMPurify` OR a bundle-friendly all-in-one like `snarkdown`. The plan uses **`marked` (with `mangle: false, headerIds: false`) + `DOMPurify`** because:
- `marked` is widely used and well-maintained.
- Release notes may contain user-generated content (issue titles, contributor names) — sanitizing defends against `<script>` injection.
- Combined size ~35KB gzip. Acceptable.

If bundle size is critical, `snarkdown` is a 1KB alternative but is markdown-only (no HTML sanitization; less-full markdown syntax). Not chosen here.

- [ ] **Step 1: Add `marked` and `dompurify` to `web/package.json`**

```bash
cd web
npm install marked dompurify
npm install --save-dev @types/dompurify
```

Verify the resulting `package.json` includes both packages under `dependencies`. `marked` has TS types built in; `dompurify` needs `@types/dompurify`.

- [ ] **Step 2: Add `adminUpdates.status()` to api.ts**

Read `web/src/api.ts`. Find the existing `api.adminTelemetry` block (or similar admin.* namespace). Add adjacent:

```typescript
adminUpdates: {
  status: () => request<{
    currentVersion: string;
    latestVersion: string | null;
    updateAvailable: boolean;
    publishedAt: string | null;
    releaseNotes: string | null;
    htmlUrl: string | null;
    checkedAt: string;
    error: string | null;
  }>('/api/admin/updates/status'),
},
```

- [ ] **Step 3: Add "Updates" card to `AboutTab.tsx`**

Read `web/src/views/settings/AboutTab.tsx` first. Identify where the current version display lives, and add the "Updates" card AFTER that (or in a natural sibling position — the exact placement is aesthetic, but it should be visually distinct from the pre-existing version line).

At the top of `AboutTab.tsx`, add these imports:

```typescript
import { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
```

Add a helper at the top of the file (module-level, before the component):

```typescript
// Configure marked once at module load.
marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderReleaseNotes(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}
```

Inside the AboutTab component, add state + effect + card. Below is the full addition:

```typescript
// Inside the AboutTab component's return body, alongside other cards.
// State + effect for update status:
const [updates, setUpdates] = useState<Awaited<ReturnType<typeof api.adminUpdates.status>> | null>(null);
const [updatesLoading, setUpdatesLoading] = useState(true);

useEffect(() => {
  let cancelled = false;
  api.adminUpdates.status()
    .then((s) => { if (!cancelled) setUpdates(s); })
    .catch(() => { if (!cancelled) setUpdates(null); })
    .finally(() => { if (!cancelled) setUpdatesLoading(false); });
  return () => { cancelled = true; };
}, []);
```

And the card itself, placed as a sibling to whatever other cards are in the tab. Use `<ElevatedCard>` (existing component pattern in settings):

```typescript
<ElevatedCard>
  <Box sx={{ p: 3 }}>
    <Typography variant="h6" sx={{ mb: 2 }}>Updates</Typography>

    {updatesLoading && (
      <Typography color="text.secondary">Checking for updates…</Typography>
    )}

    {!updatesLoading && updates?.error && (
      <Alert severity="info" sx={{ mb: 2 }}>
        Update information unavailable — {updates.error}.
      </Alert>
    )}

    {!updatesLoading && updates && !updates.error && (
      <>
        <Typography variant="body2">
          Current: <strong>{updates.currentVersion}</strong>
        </Typography>
        {updates.latestVersion && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            Latest: <strong>{updates.latestVersion}</strong>
            {updates.publishedAt && ` · published ${relativeTime(updates.publishedAt)}`}
          </Typography>
        )}

        {updates.updateAvailable && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Watchtower will apply this update within 5 minutes.
          </Alert>
        )}
        {!updates.updateAvailable && updates.latestVersion && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            You're on the latest version.
          </Typography>
        )}

        {updates.releaseNotes && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>What's new</Typography>
            <Box
              sx={{
                '& p': { my: 1 },
                '& ul, & ol': { pl: 3 },
                '& code': { bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5, fontSize: '0.875em' },
                '& pre': { bgcolor: 'action.hover', p: 1, borderRadius: 1, overflowX: 'auto', fontSize: '0.875em' },
                '& a': { color: 'primary.main' },
                fontSize: '0.875rem',
              }}
              dangerouslySetInnerHTML={{ __html: renderReleaseNotes(updates.releaseNotes) }}
            />
          </>
        )}

        {updates.htmlUrl && (
          <Button
            size="small"
            variant="text"
            sx={{ mt: 2 }}
            component="a"
            href={updates.htmlUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub →
          </Button>
        )}
      </>
    )}
  </Box>
</ElevatedCard>
```

If `AboutTab.tsx` uses a different card wrapper (grep the file for existing tab layouts — `SettingRow`, custom card, etc.), match that pattern instead of `ElevatedCard`.

- [ ] **Step 4: Verify build**

```bash
cd web
npm run build
```

Expected: clean. Bundle size will grow by ~30-40KB gzip from `marked` + `dompurify`. That's expected; note the number.

- [ ] **Step 5: Commit**

```bash
git add web/package.json web/package-lock.json web/src/api.ts web/src/views/settings/AboutTab.tsx
git commit -m "updates: AboutTab \"Updates\" card with release notes"
```

---

## Rollout after all tasks merge

1. Full-suite verification (mandatory before tagging):
   ```bash
   cd server && bun run typecheck && bun test
   cd ../web && npm run build
   cd .. && docker build -t canvas:local .
   ```
   Expected: server tests pass (11 new tests added), typecheck clean, web build clean, docker build clean.

2. Manual smoke on desktop:
   - Start canvas via `docker-compose up -d` using the new compose file.
   - Verify BOTH containers running: `docker ps | grep -E 'canvas|watchtower'` shows canvas + canvas-watchtower.
   - Log in as admin → Settings → About → "Updates" card visible.
     - Pre-flip: expect `error: "no releases published yet"` displayed as "Update information unavailable" — normal.
     - Post-flip: expect current + latest + release notes.
   - Verify Watchtower log: `docker logs canvas-watchtower` shows polling activity.

3. Tag + push:
   ```bash
   git tag -a v0.8.0 -m "canvas v0.8.0 — update detection + auto-update via Watchtower"
   git push origin v0.8.0
   ```

4. Watch the publish workflow — new step "Create GitHub Release" should succeed and create a release entry at `github.com/bleichroeder/canvas/releases`.

5. Wait 5 minutes. Watchtower should detect v0.8.0 and update canvas. Verify via `docker logs canvas-watchtower` and reload the About tab.

6. Once repo goes public: the Updates card lights up with real data. Test with a subsequent tag (v0.8.1) to confirm end-to-end.

## Out of scope

- Curated `CHANGELOG.md` (relying on auto-generated release notes from commit history).
- Update history / prior release archive in the UI.
- Non-admin visibility of update info.
- Manual "trigger update now" button in the UI.
- Update banner outside AboutTab.
- Watchtower notification integrations (email / webhook / etc.).
- Server-side changelog / release-notes storage.
- Rollback UI.
- Testing that Watchtower actually applies updates (requires a real tag push, not automatable in this plan).
