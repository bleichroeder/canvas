# Sub-project P: Update flow + tunnel URL stability

**Date:** 2026-07-06
**Target release:** v0.10.0
**Scope:** Move canvas from Watchtower auto-polling to Watchtower HTTP-API-triggered updates, with canvas as the driver. Add tunnel URL change detection and a soft steering nudge away from Quick Tunnels for stable-URL setups.

## Goal

Give canvas users control over *when* their container restarts. Today Watchtower polls ghcr every 5 minutes and auto-installs whatever's newest. For Cloudflare Quick Tunnel users this means the public URL silently churns without warning; even for Named Tunnel users it means the container can restart mid-viewing session. This sub-project:

1. Flips the default to click-to-update (Watchtower runs in HTTP-API mode, canvas UI has "Update now" button).
2. Adds an "Auto-update" toggle that restores current behavior (canvas periodically calls Watchtower's API when a new version is found).
3. Detects when the public tunnel URL changes across restarts and surfaces it in the UI, so users know their bookmarks are stale.
4. Adds a soft steering nudge on the Quick Tunnel deployment option warning about URL ephemerality.

## Non-goals

- Deferring auto-updates during active playback. User who enables auto-update accepts the trade-off; the toggle exists precisely so users who don't want interruptions leave it off.
- Persisting the URL-changed banner per-user across devices. System-wide dismissal via localStorage on the client is sufficient.
- Rolling back to a previous version. Users who need this pin an image tag via compose.
- Automatic Watchtower token generation by canvas. Bad security model; user generates once and injects via env.
- Removing Quick Tunnel as an option. Only softly nudging toward Named Tunnels; Quick Tunnel remains fully supported.

## Global constraints

- No breaking changes for users who don't migrate their compose file. Watchtower staying in polling mode continues to work; canvas UI shows a notice instead of failing.
- Watchtower token distribution is user-driven: `openssl rand -hex 32` into `.env`, both services reference `${WATCHTOWER_HTTP_API_TOKEN}`.
- No test framework additions to `web/`. Per-task verification for web: `npm --prefix web run build` succeeds. Server-side (`server/`) has `bun test` with real coverage; add tests for the new server code.
- Commit messages: NO `Co-Authored-By: Claude` trailer, NO "Generated with Claude Code" footer.
- Preserve existing sub-project M infrastructure (`getUpdateStatus()`, `GET /api/admin/updates/status`, AboutTab release-notes rendering). This sub-project extends, doesn't replace.

---

## Data model

**One migration.** Filename convention already used in `server/src/db/migrations/`; this becomes the next sequentially-numbered one (0007 or whatever is next).

**New table `update_preferences`** — singleton row (id always 1).

```ts
export const updatePreferences = sqliteTable('update_preferences', {
  id: integer('id').primaryKey({ autoIncrement: false }),  // singleton, always 1
  autoUpdate: integer('auto_update', { mode: 'boolean' }).notNull().default(false),
  lastAutoCheckAt: integer('last_auto_check_at'),  // nullable, seconds since epoch
});
```

Seeded at migration time with `INSERT INTO update_preferences (id, auto_update) VALUES (1, 0)`.

**Additions to `deployment_config`** — three new nullable columns.

```ts
lastKnownPublicUrl: text('last_known_public_url'),  // set on canvas boot, compared next boot
publicUrlChangedAt: integer('public_url_changed_at'),  // seconds since epoch; last drift event
previousPublicUrl: text('previous_public_url'),  // the URL we drifted away from
```

All three nullable. `lastKnownPublicUrl` populated by the change-detector on every boot (so first-boot writes nothing to compare against on second boot — no false positive). `publicUrlChangedAt` + `previousPublicUrl` only populated when a change is actually detected.

---

## Server changes

### `server/src/storage/update-preferences.ts` (new file)

```ts
export interface UpdatePreferences {
  autoUpdate: boolean;
  lastAutoCheckAt: number | null;
}
export function getUpdatePreferences(db: Db): UpdatePreferences;
export function setUpdatePreferences(db: Db, patch: Partial<UpdatePreferences>): UpdatePreferences;
```

Straightforward Drizzle wrapping the singleton row. `setUpdatePreferences` merges the patch onto the existing row and returns the new state.

### `server/src/lib/watchtower-client.ts` (new file)

```ts
export interface WatchtowerClient {
  isReachable(): Promise<boolean>;   // 60s-cached HEAD or GET probe
  triggerUpdate(): Promise<void>;    // POST /v1/update with bearer token
}
export function makeWatchtowerClient(opts: { url: string; token: string }): WatchtowerClient;
```

- `isReachable()`: cached for 60s. Sends `GET ${url}/v1/update` with the bearer token; returns true on any 2xx/4xx (reachable = someone answered, even if 401), false on network error / timeout (2s).
- `triggerUpdate()`: `POST ${url}/v1/update` with `Authorization: Bearer ${token}`. Throws on non-2xx. Canvas will die within seconds of a successful call, so this is effectively fire-and-forget.

### `server/src/lib/tunnel-url-drift.ts` (new file)

```ts
export function detectPublicUrlDrift(db: Db, currentPublicUrl: string | null): void;
```

Called from the server bootstrap after deployment config has been populated with the current tunnel URL. Behavior:

1. Read `deployment_config` row.
2. If `lastKnownPublicUrl === null` → first boot after migration. Write `lastKnownPublicUrl = currentPublicUrl`. Do NOT set changed-at.
3. If `lastKnownPublicUrl === currentPublicUrl` → no drift. No-op.
4. Otherwise → drift detected. Set `previousPublicUrl = lastKnownPublicUrl`, `publicUrlChangedAt = now`, `lastKnownPublicUrl = currentPublicUrl`.

### `server/src/routes/admin-updates.ts` (extend existing)

Add three routes to the existing `makeAdminUpdatesRoutes(getDb)`:

- `GET /preferences` → `{ autoUpdate: boolean, lastAutoCheckAt: number | null, watchtowerReachable: boolean }`. Reads preferences + calls `watchtowerClient.isReachable()`.
- `PATCH /preferences` → body `{ autoUpdate?: boolean }`. Admin-only. Validates types, calls `setUpdatePreferences`, returns the new state.
- `POST /apply` → admin-only. If `watchtowerReachable === false`, returns 409 with `{ error: 'watchtower unreachable — see docs/updates.md' }`. Otherwise calls `watchtowerClient.triggerUpdate()` and returns 202. Doesn't wait — canvas will die during this call anyway.

All three routes require the auth middleware already applied to the route group.

### `server/src/routes/deployment.ts` (extend existing)

Extend `GET /api/deployment/status` return type to include the two new fields:

```ts
{
  mode: string;
  status: string;
  publicUrl: string | null;
  statusMessage: string | null;
  externallyManaged: boolean;
  publicUrlChangedAt: number | null;   // NEW
  previousPublicUrl: string | null;    // NEW
}
```

### `server/src/lib/auto-update-worker.ts` (new file)

```ts
export function startAutoUpdateWorker(opts: {
  getDb: () => Db;
  watchtowerClient: WatchtowerClient;
  currentVersion: string;
  intervalMs?: number;  // default 15 * 60 * 1000
}): { stop(): void };
```

Behavior on each tick:

1. Read `getUpdatePreferences(db)`. Update `lastAutoCheckAt = now` unconditionally so the UI can show "last checked" even when auto-update is off.
2. If `autoUpdate === false`, done.
3. Call `getUpdateStatus(currentVersion)` — reuses sub-project M's helper as-is, including its 6h cache. If the cache is warm, no external network call happens on this tick; that's fine.
4. If `updateAvailable === false`, done.
5. If `updateAvailable === true`, call `watchtowerClient.triggerUpdate()`. Canvas will be recreated within seconds; any state written after this may or may not persist.

Worker fails safely: any error caught and logged, doesn't propagate.

**First tick delay.** Worker sleeps for `intervalMs` before its first tick, not immediate. Avoids a race with canvas' own boot where the deployment config, migrations, and Watchtower reachability may not have settled.

### `server/src/config.ts` (extend)

Add two new config fields with sensible defaults:

```ts
WATCHTOWER_URL: process.env.WATCHTOWER_URL ?? 'http://canvas-watchtower:8080',
WATCHTOWER_TOKEN: process.env.WATCHTOWER_TOKEN ?? '',
```

Empty token means reachability probe will fail with 401 → `watchtowerReachable: false` → UI shows migration nudge. Correct behavior for unmigrated users.

### Boot wiring (`server/src/index.ts` or equivalent)

After `getDb()` is initialized:

1. `detectPublicUrlDrift(db, currentPublicUrl)` — call once, after deployment has written the current URL.
2. `const wtClient = makeWatchtowerClient({ url: config.WATCHTOWER_URL, token: config.WATCHTOWER_TOKEN })`.
3. `startAutoUpdateWorker({ getDb, watchtowerClient: wtClient, currentVersion: config.CANVAS_VERSION })`.
4. Pass `wtClient` to `makeAdminUpdatesRoutes(getDb, wtClient)`.

---

## Client changes

### `web/src/api.ts`

Add three methods:

```ts
adminUpdates: {
  status: () => request<UpdateStatus>('/api/admin/updates/status'),
  preferences: () => request<{ autoUpdate: boolean; lastAutoCheckAt: number | null; watchtowerReachable: boolean }>('/api/admin/updates/preferences'),
  updatePreferences: (patch: { autoUpdate?: boolean }) =>
    request<{ autoUpdate: boolean; lastAutoCheckAt: number | null; watchtowerReachable: boolean }>('/api/admin/updates/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  apply: () => request<void>('/api/admin/updates/apply', { method: 'POST' }),
},
```

`adminUpdates.status` may already exist from sub-project M; extend the existing namespace instead of duplicating.

### `web/src/views/settings/AboutTab.tsx` (extend Updates card)

The existing card renders release notes for the latest available version. Extend it with:

1. **Auto-update toggle** — MUI `Switch` bound to `preferences.autoUpdate`. Label: "Auto-update". Helper text under it: "Automatically install updates when available. Restarts canvas immediately; your public URL will change if you're using Cloudflare Quick Tunnel."
2. **Update now button** — MUI `Button` with `variant="contained"`. Visible only when `updateAvailable === true`. On click, opens a confirmation dialog: "Update canvas to {latestVersion}? This will restart the container within ~10 seconds. If you're on Cloudflare Quick Tunnel, your public URL will change." Confirming calls `api.adminUpdates.apply()`. Button is disabled while the confirmation is open or during the ~10s recreate window (canvas will die anyway).
3. **Last checked** — small caption text: `Last checked: {formatRelativeTime(preferences.lastAutoCheckAt)}` or `Last checked: never` if null.
4. **Watchtower unreachable notice** — MUI `Alert` with `severity="info"`, only rendered when `preferences.watchtowerReachable === false`. Content: "Click-to-update requires Watchtower in HTTP API mode. [Follow the migration guide](docs/updates.md) to enable." Toggle + Update-now button remain visible but are disabled when unreachable, with the alert explaining why.

### `web/src/views/settings/DeploymentTab.tsx` (extend)

Add a dismissible banner at the top of the tab body:

- Render when `info.publicUrlChangedAt` is non-null AND within the last 7 days AND not dismissed in localStorage.
- Content: MUI `Alert` with `severity="info"`, dismissable via close icon. Text: "Your public URL changed on {formatDate(info.publicUrlChangedAt)}. Update any bookmarks on your car. Previous: `{info.previousPublicUrl}`. Current: `{info.publicUrl}`."
- Dismissal writes `localStorage.setItem('canvas.publicUrlChangedDismissedAt', String(info.publicUrlChangedAt))`. On mount, banner suppressed if that value equals the current `publicUrlChangedAt` (dismisses persist until a *new* drift event occurs).

### Deployment picker (in `web/src/views/Setup.tsx` and inline in DeploymentTab)

The mode-picker UI already has four options: `local`, `domain`, `cf-quick`, `cf-named`. Wherever the description text for `cf-quick` is rendered (there's already a text block explaining what it does), append: "**URL changes on every canvas restart.** For a stable URL, use Cloudflare Named Tunnel."

Bold applied to the "URL changes on every canvas restart" fragment. No new component — just extend the existing description string(s). Search for `Quick Tunnel` in `Setup.tsx` and `DeploymentTab.tsx` to find the anchor points.

---

## Compose migration

### `docker-compose.yml` at repo root (modify)

Watchtower service section:

```yaml
  watchtower:
    image: containrrr/watchtower:latest
    container_name: canvas-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_LABEL_ENABLE: "true"
      # Click-to-update mode: no polling, only respond to POST /v1/update.
      WATCHTOWER_HTTP_API_UPDATE: "true"
      WATCHTOWER_HTTP_API_TOKEN: "${WATCHTOWER_HTTP_API_TOKEN:?WATCHTOWER_HTTP_API_TOKEN required — see docs/updates.md for setup}"
      WATCHTOWER_CLEANUP: "true"
```

Canvas service section — add env vars:

```yaml
    environment:
      # (existing env vars unchanged)
      WATCHTOWER_URL: "http://canvas-watchtower:8080"
      WATCHTOWER_TOKEN: "${WATCHTOWER_HTTP_API_TOKEN}"
```

The `:?...` syntax makes compose fail with a helpful message if `WATCHTOWER_HTTP_API_TOKEN` isn't set in `.env`. Better than silent failure.

### `.env.example` (new file)

```
# Required — shared secret between canvas and Watchtower for click-to-update.
# Generate with: openssl rand -hex 32
WATCHTOWER_HTTP_API_TOKEN=
```

### `docs/updates.md` (rewrite)

Restructure into sections:
1. **How updates work in v0.10.0+** — click-to-update via Watchtower HTTP API, auto-update toggle, tunnel URL caveat.
2. **First-time setup** — generate token, populate `.env`, `docker-compose up -d`.
3. **Migrating from v0.9.x** — one-time compose edit, generate token, `docker-compose up -d --force-recreate`. Include a callout: "Watchtower will auto-update canvas to v0.10.0 one last time before switching modes; you can either update your compose file first (v0.10.0 pulls fresh) or wait for the auto-update and then edit compose."
4. **Manual updates** — via canvas UI (Settings → About → Update now).
5. **Rollback** — pin `image: ghcr.io/bleichroeder/canvas:0.9.2` in compose.

---

## Soft migration behavior

- User is on v0.9.x with Watchtower polling. Watchtower auto-updates canvas to v0.10.0.
- Canvas v0.10.0 boots, tries `GET ${WATCHTOWER_URL}/v1/update` with token (empty by default). Watchtower is still in polling mode → API not listening on that port → connection refused / timeout.
- `watchtowerReachable === false`. Settings → About shows the migration Alert.
- User can still watch content, browse sources, everything else works.
- User follows `docs/updates.md`, updates their compose, restarts. Watchtower comes up in HTTP API mode. Canvas' next preferences GET flips `watchtowerReachable === true`. Toggle + Update-now button light up. Auto-update worker (if enabled) will trigger on next tick.

---

## Testing plan

### Server (`bun test`)

New test files:
- `server/src/storage/update-preferences.test.ts` — get/set roundtrip, patch partiality, default state.
- `server/src/lib/watchtower-client.test.ts` — mock fetch; verify auth header, timeout on unreachable, cache TTL on `isReachable`.
- `server/src/lib/tunnel-url-drift.test.ts` — three cases: first boot (no comparison), no drift (no-op), drift (fields set).
- `server/src/routes/admin-updates.test.ts` — extend existing test file (verified working in sub-project M): add tests for GET/PATCH preferences, POST apply with mocked Watchtower client (success + 409 unreachable), admin-only ACL.

Run: `cd server && bun test` — all existing tests must continue to pass.

### Client (`npm --prefix web run build` + manual QA)

Manual QA checklist:
- Updates card renders auto-update toggle. Flipping it persists (reload page, still on).
- With Watchtower running in HTTP API mode: "Update now" button visible when a newer version exists on ghcr (test by locally editing `CANVAS_VERSION` env to something older).
- With Watchtower NOT reachable (env `WATCHTOWER_URL=http://127.0.0.1:65535`): Alert shows, toggle/button disabled.
- Deployment tab: force a URL change (edit DB manually to simulate), reload, banner appears with old + new URL. Dismiss it, banner stays gone. Set a new drift value, banner reappears.
- Quick Tunnel picker option shows the "URL changes on every canvas restart" text.
- `npm --prefix web run build` clean.

### End-to-end in-container

- `docker build -t canvas:local .`; swap into local compose with the new Watchtower config; verify update flow via a test tag push to a fork's ghcr.

---

## Files created / modified

**Created (server):**
- `server/src/db/migrations/00XX_update_flow.sql` — migration for the new table + deployment_config columns.
- `server/src/storage/update-preferences.ts`
- `server/src/lib/watchtower-client.ts`
- `server/src/lib/tunnel-url-drift.ts`
- `server/src/lib/auto-update-worker.ts`
- Corresponding `.test.ts` files.

**Modified (server):**
- `server/src/db/schema.ts` — add `updatePreferences` table + three `deploymentConfig` columns.
- `server/src/config.ts` — `WATCHTOWER_URL` + `WATCHTOWER_TOKEN`.
- `server/src/routes/admin-updates.ts` — three new routes.
- `server/src/routes/deployment.ts` — return `publicUrlChangedAt` + `previousPublicUrl`.
- `server/src/index.ts` (or bootstrap file) — wire `detectPublicUrlDrift`, `makeWatchtowerClient`, `startAutoUpdateWorker`.

**Modified (client):**
- `web/src/api.ts` — new `adminUpdates.preferences`, `.updatePreferences`, `.apply` methods.
- `web/src/views/settings/AboutTab.tsx` — extend Updates card.
- `web/src/views/settings/DeploymentTab.tsx` — URL-change banner.
- `web/src/views/Setup.tsx` — Quick Tunnel description text.

**Modified (deploy / docs):**
- `docker-compose.yml` — Watchtower HTTP API mode + canvas env vars.
- `.env.example` — new file, template for `WATCHTOWER_HTTP_API_TOKEN`.
- `docs/updates.md` — rewrite for new flow + migration steps.

**Untouched:**
- `server/src/lib/update-checker.ts` — sub-project M's helper is reused as-is.
- All other server code.
- All player / sources / auth code.

---

## Release plan

1. Merge sub-project P to `main`.
2. Tag `v0.10.0`.
3. Publish workflow builds + pushes `ghcr.io/bleichroeder/canvas:0.10.0`, `:0.10`, `:latest`.
4. Existing v0.9.x users' Watchtower auto-updates canvas to v0.10.0 within ~5 minutes.
5. On next canvas boot (post-upgrade), users see the migration Alert in Settings → About. They follow `docs/updates.md` to update their compose. After they redo `docker-compose up -d`, click-to-update is live.
6. Release notes highlight: click-to-update, auto-update toggle, tunnel-URL change detection, Quick Tunnel steering nudge. Include the migration steps prominently.

Note: this is the *last* auto-update most users will get by default. From v0.10.0 forward, updates ship on user action.
