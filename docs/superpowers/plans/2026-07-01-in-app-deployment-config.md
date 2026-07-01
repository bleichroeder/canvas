# In-App Deployment Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Replace the current C.1 unbundled model with an in-app UI-configured deployment story. Fresh install becomes one `docker run` command + browser wizard. Four modes: local, domain+LE, Cloudflare Quick Tunnel, Cloudflare Named Tunnel.

**Architecture:** Bundle Caddy + cloudflared back into the canvas image. Configuration persisted in a `deployment_config` singleton table. Entrypoint reads config on boot and spawns appropriate subprocesses. Reconfiguration triggers a container restart (SIGTERM to PID 1). `CANVAS_EXTERNAL_PROXY=1` env var opts out entirely.

**Tech stack:** Same as before (Bun, Hono, Drizzle, SQLite, tini) + re-bundled Caddy 2 + cloudflared. No new server-side deps.

## Global Constraints

- **Branch:** `self-host-server-port` (integration branch). Direct commits, no per-task subbranch.
- **Existing tests stay green.** 185 server tests continue passing. Adds new deployment-config tests.
- **The admin bootstrap change is additive.** Existing installs with admin already created via B.1's claim-token flow keep working. Fresh installs skip the claim-token dance via localhost bootstrap.
- **No breaking API changes** to existing sub-project A/B/B.1 endpoints. Purely additive.
- **CANVAS_EXTERNAL_PROXY=1** env var must ALWAYS work — it preserves C.1's unbundled model for advanced users.
- **Localhost bootstrap is the security bar.** `POST /api/setup` requires: no admin exists AND request from loopback IP. Both checks enforced server-side.

## File Structure

Server:
- Modify: `server/src/db/schema.ts` — add `deploymentConfig` table
- Create: `server/drizzle/0003_*.sql` (generated migration)
- Create: `server/src/storage/deployment-config.ts` (+ test)
- Create: `server/src/routes/deployment.ts` (+ test) — admin endpoints + public status
- Create: `server/src/routes/setup.ts` (+ test) — first-run bootstrap with localhost guard
- Modify: `server/src/app.ts` — mount new routes
- Modify: `server/src/lib/bootstrap.ts` — bypass claim-token creation when localhost bootstrap can handle it
- Create: `server/src/lib/deployment-writer.ts` — writes `/data/.deployment-*` sidecar files that entrypoint reads

Container:
- Modify: `Dockerfile` — re-add Caddy + cloudflared binaries; new entrypoint
- Create: `docker/entrypoint.sh` — mode-selecting subprocess spawner
- Create: `docker/Caddyfile.template` — for domain mode
- Modify: `docker-compose.yml` — bare image with three ports published + restart policy

Frontend:
- Create: `web/src/views/Setup.tsx` — 3-step first-run wizard
- Create: `web/src/views/DeploymentTab.tsx` — Settings deployment page
- Modify: `web/src/api.ts` — add deployment endpoints
- Modify: `web/src/main.tsx` — routing for `/#/setup`
- Modify: `web/src/lib/session.ts` — no changes expected but verify

Docs:
- Modify: `README.md` — one-command install + wizard walkthrough
- Create: `docs/deployment-modes.md` — deeper explanation of the four modes

---

## Task 1: Deployment config schema + storage

**Files:**
- Modify: `server/src/db/schema.ts`
- Create: `server/drizzle/0003_*.sql` (generated)
- Create: `server/src/storage/deployment-config.ts` (+ test)
- Create: `server/src/lib/deployment-writer.ts` (+ test)

**Interfaces produced:**
- Storage: `getDeploymentConfig(db)`, `updateDeploymentConfig(db, patch)`
- Writer: `writeDeploymentSidecarFiles(config, dataDir)` — writes `/data/.deployment-mode`, `.deployment-domain`, `.deployment-cf-token`

- [ ] **Step 1: Extend `server/src/db/schema.ts`**

Add:
```ts
export const deploymentConfig = sqliteTable('deployment_config', {
  id: integer('id').primaryKey({ autoIncrement: false }),  // singleton, always 1
  mode: text('mode', { enum: ['local', 'domain', 'cf-quick', 'cf-named'] })
    .notNull().default('local'),
  domain: text('domain'),
  adminEmail: text('admin_email'),
  cfNamedToken: text('cf_named_token'),
  publicUrl: text('public_url'),
  status: text('status', { enum: ['pending', 'applying', 'ready', 'failed'] })
    .notNull().default('ready'),
  statusMessage: text('status_message'),
  certExpiresAt: integer('cert_expires_at'),
  lastAppliedAt: integer('last_applied_at'),
});

export type DeploymentConfig = typeof deploymentConfig.$inferSelect;
export type NewDeploymentConfig = typeof deploymentConfig.$inferInsert;
```

- [ ] **Step 2: Generate migration**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun run db:generate
```

Verify the generated `drizzle/0003_*.sql` contains the CREATE TABLE. Then MANUALLY append the seed row at the end of the SQL file:
```sql
INSERT INTO deployment_config (id, mode, status) VALUES (1, 'local', 'ready');
```

Drizzle-kit doesn't auto-generate INSERT statements. This ensures row 1 always exists.

- [ ] **Step 3: Write `storage/deployment-config.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { deploymentConfig, type DeploymentConfig, type NewDeploymentConfig } from '../db/schema';
import { nowSec } from '../lib/time';

export function getDeploymentConfig(db: Db): DeploymentConfig {
  const row = db.select().from(deploymentConfig).where(eq(deploymentConfig.id, 1)).get();
  if (!row) throw new Error('deployment_config singleton row missing; migration 0003 not run?');
  return row;
}

export type DeploymentPatch = Partial<Omit<NewDeploymentConfig, 'id'>>;

export function updateDeploymentConfig(db: Db, patch: DeploymentPatch): DeploymentConfig {
  db.update(deploymentConfig)
    .set({ ...patch, lastAppliedAt: nowSec() })
    .where(eq(deploymentConfig.id, 1))
    .run();
  return getDeploymentConfig(db);
}
```

- [ ] **Step 4: Write `deployment-config.test.ts`**

```ts
import { beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema';
import type { Db } from '../db';
import { runMigrations } from '../db/migrate';
import { getDeploymentConfig, updateDeploymentConfig } from './deployment-config';

function makeDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema }) as unknown as Db;
  (db as unknown as { $client: Database }).$client = sqlite;
  runMigrations(db);
  return db;
}

describe('deployment-config storage', () => {
  let db: Db;
  beforeEach(() => { db = makeDb(); });

  test('singleton row is seeded on migration', () => {
    const config = getDeploymentConfig(db);
    expect(config.id).toBe(1);
    expect(config.mode).toBe('local');
    expect(config.status).toBe('ready');
  });

  test('updateDeploymentConfig patches the singleton and bumps lastAppliedAt', () => {
    const before = getDeploymentConfig(db);
    expect(before.lastAppliedAt).toBeNull();
    const updated = updateDeploymentConfig(db, { mode: 'cf-quick', publicUrl: 'https://foo.trycloudflare.com' });
    expect(updated.mode).toBe('cf-quick');
    expect(updated.publicUrl).toBe('https://foo.trycloudflare.com');
    expect(updated.lastAppliedAt).toBeGreaterThan(0);
  });

  test('cf-named token round-trip', () => {
    updateDeploymentConfig(db, { mode: 'cf-named', cfNamedToken: 'tunnel-token-abc' });
    expect(getDeploymentConfig(db).cfNamedToken).toBe('tunnel-token-abc');
  });
});
```

- [ ] **Step 5: Write `lib/deployment-writer.ts`**

The entrypoint reads plaintext state files at `/data/.deployment-*` because shelling out to SQLite from bash is heavier than reading a file. Bun writes these files whenever config changes.

```ts
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeploymentConfig } from '../db/schema';

/**
 * Writes deployment state to sidecar plaintext files in the data directory.
 * Called after every deployment_config update. The entrypoint reads these
 * on container start to decide what subprocesses to spawn.
 */
export function writeDeploymentSidecarFiles(config: DeploymentConfig, dataDir: string): void {
  writeFileSync(join(dataDir, '.deployment-mode'), config.mode);
  writeFileSync(join(dataDir, '.deployment-domain'), config.domain ?? '');
  writeFileSync(join(dataDir, '.deployment-admin-email'), config.adminEmail ?? '');

  const tokenPath = join(dataDir, '.deployment-cf-token');
  writeFileSync(tokenPath, config.cfNamedToken ?? '');
  try { chmodSync(tokenPath, 0o600); } catch { /* Windows / non-POSIX */ }
}
```

- [ ] **Step 6: Write `deployment-writer.test.ts`**

```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDeploymentSidecarFiles } from './deployment-writer';
import type { DeploymentConfig } from '../db/schema';

const base: DeploymentConfig = {
  id: 1, mode: 'local', domain: null, adminEmail: null, cfNamedToken: null,
  publicUrl: null, status: 'ready', statusMessage: null,
  certExpiresAt: null, lastAppliedAt: null,
};

describe('writeDeploymentSidecarFiles', () => {
  test('writes plaintext mode + domain files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-dep-'));
    writeDeploymentSidecarFiles({ ...base, mode: 'domain', domain: 'canvas.example.com' }, dir);
    expect(readFileSync(join(dir, '.deployment-mode'), 'utf8')).toBe('domain');
    expect(readFileSync(join(dir, '.deployment-domain'), 'utf8')).toBe('canvas.example.com');
    rmSync(dir, { recursive: true, force: true });
  });

  test('empty strings for absent fields', () => {
    const dir = mkdtempSync(join(tmpdir(), 'canvas-dep-'));
    writeDeploymentSidecarFiles(base, dir);
    expect(readFileSync(join(dir, '.deployment-domain'), 'utf8')).toBe('');
    expect(readFileSync(join(dir, '.deployment-cf-token'), 'utf8')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 7: Test + typecheck + commit**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger/server
bun test
bun run typecheck

cd /c/github/passenger
git add server/drizzle/ server/src/db/schema.ts \
        server/src/storage/deployment-config.ts server/src/storage/deployment-config.test.ts \
        server/src/lib/deployment-writer.ts server/src/lib/deployment-writer.test.ts
git commit -m "server: deployment_config schema + storage helpers + sidecar writer"
```

Expect ~193 tests total.

---

## Task 2: Deployment API endpoints + localhost setup

**Files:**
- Create: `server/src/routes/deployment.ts` (+ test)
- Create: `server/src/routes/setup.ts` (+ test)
- Modify: `server/src/app.ts`
- Modify: `server/src/config.ts` — add `CANVAS_EXTERNAL_PROXY` and `CANVAS_DATA_DIR` env vars

**Interfaces produced:**
- Admin: `GET/POST /api/admin/deployment`, `POST /api/admin/deployment/apply`
- Public: `GET /api/deployment/status`
- First-run: `POST /api/setup` (localhost-only, no auth)
- Config additions

- [ ] **Step 1: Extend `config.ts`**

Add to the Zod schema:
```ts
CANVAS_EXTERNAL_PROXY: z.string().optional().transform((v) => v === '1' || v === 'true'),
CANVAS_DATA_DIR: z.string().default('/data'),
```

Both are used by deployment logic to decide behavior.

- [ ] **Step 2: Write `routes/deployment.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { getDeploymentConfig, updateDeploymentConfig, type DeploymentPatch } from '../storage/deployment-config';
import { writeDeploymentSidecarFiles } from '../lib/deployment-writer';
import { getAuthContext } from '../middleware/auth';
import { config } from '../config';
import { logger } from '../log';

const RESTART_DELAY_MS = 2000;

function scheduleRestart(reason: string): void {
  logger.info({ reason }, 'restart scheduled');
  setTimeout(() => {
    logger.info('sending SIGTERM to PID 1');
    try { process.kill(1, 'SIGTERM'); } catch (e) {
      logger.error({ err: (e as Error).message }, 'SIGTERM to PID 1 failed');
    }
  }, RESTART_DELAY_MS);
}

export function makeDeploymentRoutes(getDb: () => Db) {
  const r = new Hono();

  // Admin — full config, minus the secret token.
  r.get('/admin/deployment', async (c) => {
    const conf = getDeploymentConfig(getDb());
    return c.json({
      mode: conf.mode,
      domain: conf.domain,
      adminEmail: conf.adminEmail,
      publicUrl: conf.publicUrl,
      status: conf.status,
      statusMessage: conf.statusMessage,
      certExpiresAt: conf.certExpiresAt,
      lastAppliedAt: conf.lastAppliedAt,
      hasCfNamedToken: conf.cfNamedToken !== null && conf.cfNamedToken.length > 0,
      externallyManaged: config.CANVAS_EXTERNAL_PROXY,
    });
  });

  r.post('/admin/deployment', async (c) => {
    if (config.CANVAS_EXTERNAL_PROXY) {
      return c.json({ error: 'deployment is externally managed (CANVAS_EXTERNAL_PROXY=1)' }, 409);
    }
    const body = await c.req.json().catch(() => null) as {
      mode?: string; domain?: string; adminEmail?: string; cfNamedToken?: string;
    } | null;
    if (!body || !body.mode || !['local', 'domain', 'cf-quick', 'cf-named'].includes(body.mode)) {
      return c.json({ error: 'invalid mode' }, 400);
    }
    // Mode-specific validation
    if (body.mode === 'domain' && (!body.domain || body.domain.length < 3)) {
      return c.json({ error: 'domain required for mode=domain' }, 400);
    }
    if (body.mode === 'cf-named' && (!body.cfNamedToken || body.cfNamedToken.length < 20)) {
      return c.json({ error: 'cf tunnel token required for mode=cf-named' }, 400);
    }

    const patch: DeploymentPatch = {
      mode: body.mode as 'local' | 'domain' | 'cf-quick' | 'cf-named',
      domain: body.domain ?? null,
      adminEmail: body.adminEmail ?? null,
      cfNamedToken: body.cfNamedToken ?? null,
      status: 'pending',
      statusMessage: null,
      publicUrl: null,   // cleared; will be repopulated after apply
    };
    const updated = updateDeploymentConfig(getDb(), patch);
    writeDeploymentSidecarFiles(updated, config.CANVAS_DATA_DIR);
    scheduleRestart(`deployment mode changed to ${body.mode}`);
    return c.body(null, 204);
  });

  r.post('/admin/deployment/apply', async (c) => {
    scheduleRestart('manual apply');
    return c.body(null, 204);
  });

  // Public — safe subset.
  r.get('/deployment/status', async (c) => {
    const conf = getDeploymentConfig(getDb());
    return c.json({
      mode: conf.mode,
      status: conf.status,
      publicUrl: conf.publicUrl,
      externallyManaged: config.CANVAS_EXTERNAL_PROXY,
    });
  });

  return r;
}
```

- [ ] **Step 3: Write `routes/setup.ts`**

```ts
import { Hono } from 'hono';
import type { Db } from '../db';
import { countAdmins, createUser } from '../storage/users';
import { setPasswordHash } from '../storage/users';
import { updateDeploymentConfig } from '../storage/deployment-config';
import { writeDeploymentSidecarFiles } from '../lib/deployment-writer';
import { createDeviceSession } from '../storage/device-sessions';
import { generateBearer, hashBearer } from '../lib/bearer';
import { config } from '../config';
import { logger } from '../log';

function isLoopback(remoteAddr: string | null | undefined): boolean {
  if (!remoteAddr) return false;
  return remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
}

export function makeSetupRoutes(getDb: () => Db, getServer: () => import('bun').Server | null) {
  const r = new Hono();

  r.post('/setup', async (c) => {
    // Guard 1: no admin exists yet.
    if (countAdmins(getDb()) > 0) {
      return c.json({ error: 'setup already complete' }, 409);
    }
    // Guard 2: request must come from loopback (setup has no auth; localhost is the trust boundary).
    const server = getServer();
    let remoteAddr: string | null = null;
    if (server) {
      try {
        const ip = server.requestIP(c.req.raw);
        remoteAddr = ip?.address ?? null;
      } catch { /* fallthrough */ }
    }
    if (!isLoopback(remoteAddr)) {
      logger.warn({ remoteAddr }, 'setup attempt from non-loopback');
      return c.json({ error: 'setup can only be initiated from localhost' }, 403);
    }

    const body = await c.req.json().catch(() => null) as {
      adminUsername?: string; adminPassword?: string; deviceLabel?: string;
    } | null;
    if (!body ||
        typeof body.adminUsername !== 'string' || body.adminUsername.length < 2 || body.adminUsername.length > 32 ||
        typeof body.adminPassword !== 'string' || body.adminPassword.length < 8 ||
        typeof body.deviceLabel !== 'string' || body.deviceLabel.length === 0) {
      return c.json({ error: 'adminUsername (2-32), adminPassword (8+), deviceLabel required' }, 400);
    }

    // Create admin.
    const admin = createUser(getDb(), { label: body.adminUsername, role: 'admin' });
    const hash = await Bun.password.hash(body.adminPassword);
    setPasswordHash(getDb(), admin.id, hash);

    // Issue a bearer immediately so the wizard can continue as admin.
    const bearer = generateBearer();
    const tokenHash = await hashBearer(bearer);
    createDeviceSession(getDb(), { userId: admin.id, deviceLabel: body.deviceLabel, tokenHash });

    // Deployment stays 'local' until wizard step 2 updates it.
    const updated = updateDeploymentConfig(getDb(), { status: 'ready' });
    writeDeploymentSidecarFiles(updated, config.CANVAS_DATA_DIR);

    logger.info({ userId: admin.id, label: admin.label }, 'localhost setup complete');
    return c.json({
      bearer,
      user: { id: admin.id, label: admin.label, role: admin.role, hasPassword: true },
    });
  });

  return r;
}
```

- [ ] **Step 4: Wire into `app.ts`**

`app.ts` becomes a bit more complex — needs to know the Bun server for the setup route's loopback check. Refactor:

```ts
// New signature — accepts an optional getServer accessor
export function buildApp(db: Db, getServer: () => import('bun').Server | null = () => null): Hono {
  const app = new Hono();
  // ... existing middleware/mounts ...

  // Public setup route (unauthenticated, localhost-only-guarded internally)
  app.route('/api', makeSetupRoutes(() => db, getServer));

  // Public deployment status
  app.route('/api', makeDeploymentRoutes(() => db).basePath(''));
  // ^ deployment.ts already prefixes /deployment/status and /admin/deployment

  // requireUser + requireAdmin on /api/admin/deployment/*
  app.use('/api/admin/deployment/*', requireUser(() => db));
  app.use('/api/admin/deployment/*', requireAdmin);

  return app;
}
```

The nesting is a bit awkward — `deployment.ts` uses paths like `/admin/deployment` and `/deployment/status`. Mount at `/api` and Hono routing prefixes them correctly.

`server/src/index.ts` also needs a small change to pass the server ref:

```ts
let serverRef: import('bun').Server | null = null;
const app = buildApp(db, () => serverRef);
serverRef = Bun.serve({
  port: config.PORT,
  hostname: config.HOST,
  fetch: (req, server) => app.fetch(req, { server }),
});
```

Hmm — Hono passes the second arg through as `env`. Slightly clunky. Alternative: use a module-level variable that `index.ts` sets right after Bun.serve returns. `getServer()` closure reads it. Cleaner and standard for this pattern.

- [ ] **Step 5: Extensive tests**

Write `routes/deployment.test.ts` and `routes/setup.test.ts` covering:
- GET /admin/deployment returns config sans token, includes hasCfNamedToken flag
- POST /admin/deployment with each mode + validation errors
- POST /admin/deployment schedules restart (mock `process.kill`)
- POST /admin/deployment when CANVAS_EXTERNAL_PROXY is set returns 409
- GET /deployment/status is unauthenticated + returns limited fields
- POST /setup with valid loopback + no admin → creates admin + returns bearer
- POST /setup when admin exists → 409
- POST /setup from non-loopback IP → 403
- POST /setup with invalid input → 400

Use the same fixture pattern as B tests (in-memory DB, mock request IP via a fake server object).

- [ ] **Step 6: Test + typecheck + commit**

```bash
cd /c/github/passenger/server && bun test && bun run typecheck

cd /c/github/passenger
git add server/src/routes/deployment.ts server/src/routes/deployment.test.ts \
        server/src/routes/setup.ts server/src/routes/setup.test.ts \
        server/src/app.ts server/src/index.ts server/src/config.ts
git commit -m "server: deployment API + first-run /api/setup with localhost guard"
```

---

## Task 3: Entrypoint script

**Files:**
- Create: `docker/entrypoint.sh`
- Create: `docker/Caddyfile.template`

**Interfaces produced:**
- Entrypoint reads `/data/.deployment-mode` etc., spawns Caddy or cloudflared as appropriate, then execs Bun

- [ ] **Step 1: Write `docker/entrypoint.sh`**

```bash
#!/bin/sh
# canvas Docker entrypoint. Reads deployment_config sidecar files from /data,
# spawns Caddy or cloudflared as needed, then execs the Bun canvas server.
set -eu

: "${CANVAS_PORT:=8787}"
: "${CANVAS_DATA_DIR:=/data}"
: "${CANVAS_EXTERNAL_PROXY:=}"

echo "[entrypoint] starting…"

mkdir -p "$CANVAS_DATA_DIR/caddy"

# External-proxy escape hatch — skip everything, just start Bun.
if [ -n "$CANVAS_EXTERNAL_PROXY" ] && [ "$CANVAS_EXTERNAL_PROXY" != "0" ]; then
  echo "[entrypoint] CANVAS_EXTERNAL_PROXY set — running Bun only, no bundled proxy."
  cd /app/server
  exec bun run src/index.ts
fi

# First-boot state — sidecar files don't exist yet. Default to local.
if [ ! -f "$CANVAS_DATA_DIR/.deployment-mode" ]; then
  MODE="local"
  echo "[entrypoint] no deployment sidecar files — starting in local mode."
else
  MODE=$(cat "$CANVAS_DATA_DIR/.deployment-mode")
fi

echo "[entrypoint] mode: $MODE"

# Track child PIDs so we can shut them down cleanly.
CHILDREN=""

shutdown() {
  echo "[entrypoint] shutting down subprocesses…"
  # shellcheck disable=SC2086
  [ -n "$CHILDREN" ] && kill $CHILDREN 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

case "$MODE" in
  local)
    # Nothing extra to spawn.
    ;;
  domain)
    DOMAIN=$(cat "$CANVAS_DATA_DIR/.deployment-domain" 2>/dev/null || echo "")
    ADMIN_EMAIL=$(cat "$CANVAS_DATA_DIR/.deployment-admin-email" 2>/dev/null || echo "")
    if [ -z "$DOMAIN" ]; then
      echo "[entrypoint] ERROR: mode=domain but .deployment-domain is empty" >&2
      exit 1
    fi
    export DOMAIN CANVAS_PORT ADMIN_EMAIL
    envsubst < /app/docker/Caddyfile.template > "$CANVAS_DATA_DIR/caddy/Caddyfile"
    caddy start --config "$CANVAS_DATA_DIR/caddy/Caddyfile" --pidfile /tmp/caddy.pid
    CHILDREN="$CHILDREN $(cat /tmp/caddy.pid 2>/dev/null || true)"
    echo "[entrypoint] Caddy started for $DOMAIN"
    ;;
  cf-quick)
    echo "[entrypoint] starting cloudflared quick tunnel…"
    # Quick tunnel prints the URL to stdout. We tail it into a file so Bun
    # can read + persist it into deployment_config.
    (cloudflared tunnel --url "http://127.0.0.1:$CANVAS_PORT" --no-autoupdate 2>&1 \
      | tee "$CANVAS_DATA_DIR/.cloudflared.log" \
      | awk '/https:\/\/[a-z0-9-]+\.trycloudflare\.com/ {
          for (i=1;i<=NF;i++) if ($i ~ /https:\/\/.*trycloudflare\.com/) {
            gsub(/[|+]/, "", $i);
            print $i > "'"$CANVAS_DATA_DIR"'/.deployment-public-url";
            close("'"$CANVAS_DATA_DIR"'/.deployment-public-url");
          }
        } { print }') &
    CFPID=$!
    CHILDREN="$CHILDREN $CFPID"
    ;;
  cf-named)
    TOKEN=$(cat "$CANVAS_DATA_DIR/.deployment-cf-token" 2>/dev/null || echo "")
    if [ -z "$TOKEN" ]; then
      echo "[entrypoint] ERROR: mode=cf-named but .deployment-cf-token is empty" >&2
      exit 1
    fi
    echo "[entrypoint] starting cloudflared named tunnel…"
    cloudflared tunnel --no-autoupdate run --token "$TOKEN" &
    CFPID=$!
    CHILDREN="$CHILDREN $CFPID"
    ;;
  *)
    echo "[entrypoint] ERROR: unknown mode: $MODE" >&2
    exit 1
    ;;
esac

echo "[entrypoint] exec bun canvas server"
cd /app/server
exec bun run src/index.ts
```

Note the awk one-liner for parsing cloudflared's URL. Cloudflared prints the URL in a boxed banner like `|  https://xxx.trycloudflare.com  |` — the awk extracts and strips the pipe chars. Test manually.

Make executable + shell-check:
```bash
chmod +x docker/entrypoint.sh
sh -n docker/entrypoint.sh
```

- [ ] **Step 2: Write `docker/Caddyfile.template`**

```
# Rendered by entrypoint.sh via envsubst.
# Placeholders: ${DOMAIN}, ${CANVAS_PORT}, ${ADMIN_EMAIL}

{
	email ${ADMIN_EMAIL}
	storage file_system /data/caddy
}

${DOMAIN} {
	reverse_proxy 127.0.0.1:${CANVAS_PORT}
	encode gzip
}
```

The `email` directive can be empty (Caddy will register anonymously if so).

- [ ] **Step 3: Commit**

```bash
cd /c/github/passenger
git add docker/entrypoint.sh docker/Caddyfile.template
git update-index --chmod=+x docker/entrypoint.sh
git commit -m "docker: entrypoint reads deployment config + spawns Caddy/cloudflared per mode"
```

---

## Task 4: Dockerfile update

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`

- [ ] **Step 1: Rewrite `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: grab Caddy binary ---
FROM caddy:2-alpine AS caddy-src

# --- Stage 3: grab cloudflared binary ---
FROM cloudflare/cloudflared:latest AS cloudflared-src

# --- Stage 4: runtime ---
FROM oven/bun:1.3-alpine AS runtime

RUN apk add --no-cache gettext tini

COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy
COPY --from=cloudflared-src /usr/local/bin/cloudflared /usr/local/bin/cloudflared

WORKDIR /app

COPY server/package.json server/
COPY server/bun.lockb* server/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd server && (bun install --production --frozen-lockfile || bun install --production)
COPY server/ server/

COPY --from=web-build /web/dist /app/web

COPY docker/ /app/docker/
RUN chmod +x /app/docker/entrypoint.sh

RUN mkdir -p /data
VOLUME ["/data"]

ENV CANVAS_DB_PATH=/data/canvas.db
ENV CANVAS_WEB_DIR=/app/web
ENV CANVAS_DATA_DIR=/data

EXPOSE 80 443 8787
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
```

- [ ] **Step 2: Rewrite `docker-compose.yml`**

```yaml
# canvas — one command install, browser-configured deployment.
#
#   docker compose up -d
#   docker logs -f canvas
#   Then open http://localhost:8787/ and follow the wizard.

services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "8787:8787"
    volumes:
      - ./canvas-data:/data
    # For BYO reverse proxy: uncomment and canvas will run HTTP-only on 8787.
    # environment:
    #   CANVAS_EXTERNAL_PROXY: "1"
```

- [ ] **Step 3: Local build test**

```bash
export PATH="/c/Users/David/.bun/bin:$PATH"
cd /c/github/passenger
docker build -t canvas:local .
docker image ls canvas:local --format "{{.Size}}"
```

Target: under 220 MB compressed.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml
git commit -m "docker: re-bundle Caddy + cloudflared; publish 80/443/8787"
```

---

## Task 5: Frontend setup wizard

**Files:**
- Create: `web/src/views/Setup.tsx`
- Modify: `web/src/api.ts` — add deployment + setup endpoints
- Modify: `web/src/main.tsx` — routing: default unauth → setup if no admin exists
- Modify: `web/src/lib/session.ts` (verify no changes needed)

- [ ] **Step 1: Extend `api.ts`**

Add:
```ts
setup: (adminUsername: string, adminPassword: string, deviceLabel: string) =>
  request<{ bearer: string; user: SessionUser }>('/api/setup', {
    method: 'POST',
    body: JSON.stringify({ adminUsername, adminPassword, deviceLabel }),
  }),

deploymentStatus: () =>
  request<{ mode: string; status: string; publicUrl: string | null; externallyManaged: boolean }>(
    '/api/deployment/status',
  ),

adminGetDeployment: () =>
  request<{
    mode: string; domain: string | null; adminEmail: string | null;
    publicUrl: string | null; status: string; statusMessage: string | null;
    certExpiresAt: number | null; lastAppliedAt: number | null;
    hasCfNamedToken: boolean; externallyManaged: boolean;
  }>('/api/admin/deployment'),

adminSetDeployment: (payload: { mode: string; domain?: string; adminEmail?: string; cfNamedToken?: string }) =>
  request<void>('/api/admin/deployment', { method: 'POST', body: JSON.stringify(payload) }),

adminApplyDeployment: () =>
  request<void>('/api/admin/deployment/apply', { method: 'POST' }),
```

- [ ] **Step 2: Write `views/Setup.tsx`**

Three-step wizard. See the spec's frontend section for the exact fields per step. Structural sketch:

```tsx
import { useState, useRef, useEffect } from 'react';
import { Box, Button, TextField, Alert, Typography, Stack, RadioGroup, Radio, FormControlLabel, Card } from '@mui/material';
import { api } from '../api';
import { setSession } from '../lib/session';
import { navigate } from '../router';

type Step = 'admin' | 'mode' | 'applying' | 'done';
type Mode = 'cf-quick' | 'domain' | 'cf-named' | 'local';

export default function Setup() {
  const [step, setStep] = useState<Step>('admin');
  const [error, setError] = useState<string | null>(null);
  // Step 1 state
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Step 2 state
  const [mode, setMode] = useState<Mode>('cf-quick');
  const [domain, setDomain] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [cfNamedToken, setCfNamedToken] = useState('');
  // Step 3 state
  const [publicUrl, setPublicUrl] = useState<string | null>(null);

  async function submitAdmin() {
    setError(null);
    if (adminUsername.length < 2) return setError('Username too short.');
    if (adminPassword.length < 8) return setError('Password must be at least 8 characters.');
    if (adminPassword !== confirmPassword) return setError('Passwords do not match.');
    try {
      const { bearer, user } = await api.setup(adminUsername, adminPassword, defaultDeviceName());
      setSession(bearer, user);
      setStep('mode');
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submitMode() {
    setError(null);
    if (mode === 'domain' && domain.length < 3) return setError('Enter a valid domain.');
    if (mode === 'cf-named' && cfNamedToken.length < 20) return setError('Paste your Cloudflare tunnel token.');
    try {
      await api.adminSetDeployment({
        mode,
        ...(mode === 'domain' && { domain, adminEmail: adminEmail || undefined }),
        ...(mode === 'cf-named' && { cfNamedToken }),
      });
      setStep('applying');
      pollStatus();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function pollStatus() {
    // Poll every 2s. Handle connection errors gracefully (container is restarting).
    for (let i = 0; i < 60; i++) {  // up to 2 min
      try {
        const status = await api.deploymentStatus();
        if (status.status === 'ready' && status.publicUrl) {
          setPublicUrl(status.publicUrl);
          setStep('done');
          return;
        }
        if (status.status === 'failed') {
          setError('Deployment failed. Check container logs and try again.');
          setStep('mode');
          return;
        }
      } catch { /* container restarting; retry */ }
      await sleep(2000);
    }
    setError('Timed out waiting for deployment. Check container logs.');
    setStep('mode');
  }

  function defaultDeviceName(): string {
    const ua = navigator.userAgent;
    if (/Tesla/i.test(ua)) return 'Tesla';
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/Android/i.test(ua)) return 'Android';
    return 'Web';
  }
  function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  // Render step 1 (admin) / step 2 (mode) / step 3 (applying) / step 4 (done)
  return (
    <Box sx={{ maxWidth: 480, mx: 'auto', p: 4 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
        canvas
        <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
      </Typography>

      {step === 'admin' && (
        <Stack spacing={2}>
          <Typography variant="h6">Create your admin account</Typography>
          <TextField label="Username" value={adminUsername} onChange={e => setAdminUsername(e.target.value)} autoFocus />
          <TextField label="Password" type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} />
          <TextField label="Confirm password" type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" onClick={submitAdmin}>Continue</Button>
        </Stack>
      )}

      {step === 'mode' && (
        <Stack spacing={2}>
          <Typography variant="h6">How will you access canvas?</Typography>
          <RadioGroup value={mode} onChange={e => setMode(e.target.value as Mode)}>
            <ModeCard value="cf-quick" title="Cloudflare Quick Tunnel — recommended"
                     desc="Click to get a public URL. No signup, no domain. URL may change on container restarts." />
            <ModeCard value="domain" title="Custom domain + Let's Encrypt"
                     desc="Requires a domain pointing at this machine's public IP and ports 80/443 forwarded." />
            <ModeCard value="cf-named" title="Cloudflare Named Tunnel"
                     desc="Bring your own tunnel token from the Cloudflare dashboard for a stable URL." />
            <ModeCard value="local" title="Local only"
                     desc="Access from this machine or LAN only. No public URL." />
          </RadioGroup>
          {mode === 'domain' && (
            <>
              <TextField label="Domain (e.g. canvas.example.com)" value={domain} onChange={e => setDomain(e.target.value)} />
              <TextField label="Admin email (optional)" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} />
            </>
          )}
          {mode === 'cf-named' && (
            <TextField label="Tunnel token" value={cfNamedToken} onChange={e => setCfNamedToken(e.target.value)} multiline rows={3} />
          )}
          {error && <Alert severity="error">{error}</Alert>}
          <Button variant="contained" onClick={submitMode}>Apply</Button>
        </Stack>
      )}

      {step === 'applying' && (
        <Stack spacing={2} alignItems="center">
          <Typography>Applying deployment configuration…</Typography>
          <Typography variant="caption" color="text.secondary">
            Container is restarting. This takes a few seconds; up to 30s if a TLS certificate is being issued.
          </Typography>
        </Stack>
      )}

      {step === 'done' && publicUrl && (
        <Stack spacing={2}>
          <Typography variant="h6">canvas is ready.</Typography>
          <Typography>Access at:</Typography>
          <Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 1, wordBreak: 'break-all' }}>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">{publicUrl}</a>
          </Box>
          <Button variant="contained" onClick={() => navigate('/sign-in')}>Continue to sign in</Button>
        </Stack>
      )}
    </Box>
  );
}

function ModeCard({ value, title, desc }: { value: string; title: string; desc: string }) {
  return (
    <Card sx={{ p: 2 }}>
      <FormControlLabel value={value} control={<Radio />} label={
        <Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>{title}</Typography>
          <Typography variant="caption" color="text.secondary">{desc}</Typography>
        </Box>
      } />
    </Card>
  );
}
```

- [ ] **Step 3: Update `main.tsx` routing**

Add `/#/setup` route. Add first-run detection: if user is unauthenticated AND the setup endpoint says no admin yet, route to `/#/setup` instead of `/#/sign-in`. Detect via a first request that if 401'd tries `GET /api/deployment/status` and shows setup if `mode === 'local' && status === 'ready'` combined with a probe to `GET /api/auth/me` returning "no admin" (which we don't have — hmm).

Simpler: probe `GET /api/setup/probe` (a new endpoint) that returns `{ adminExists: boolean }`. If false and unauthenticated, wizard fires. Let me add that to T2's scope — one more endpoint. Actually simplest — the wizard's `POST /api/setup` returns 409 if admin already exists. So the frontend can just always TRY the setup route; if it 409s, admin exists; redirect to sign-in.

Best: add a new lightweight probe endpoint. In T2, add:

```ts
r.get('/setup/probe', async (c) => {
  return c.json({ adminExists: countAdmins(getDb()) > 0 });
});
```

Then in the frontend router: on load, if no session, call `api.setupProbe()`. If `adminExists === false`, redirect to `/#/setup`. Else, `/#/sign-in`.

Update Step 2 in T2 to add this endpoint. Update `api.ts` in T5 with `setupProbe()`.

- [ ] **Step 4: Verify build + commit**

```bash
cd /c/github/passenger/web && npm run build

cd /c/github/passenger
git add web/src/views/Setup.tsx web/src/api.ts web/src/main.tsx
git commit -m "web: first-run setup wizard (admin creation + deployment mode picker)"
```

---

## Task 6: Settings → Deployment tab

**Files:**
- Create: `web/src/views/DeploymentTab.tsx`
- Modify: appropriate Settings routing to include the new tab

- [ ] **Step 1: Write `views/DeploymentTab.tsx`**

Admin-only. Renders the current deployment mode + status + a mode picker (same as wizard step 2). On save, warns "canvas will restart for ~10 seconds; proceed?" then calls `adminSetDeployment` + polls status.

Also shows:
- Current public URL (clickable, with copy-to-clipboard button)
- Last successful apply time
- (For domain mode) Cert expiry date + warning if <14 days
- (For cf-* modes) Tunnel status
- (When `externallyManaged === true`) Big banner: "Deployment is managed externally via CANVAS_EXTERNAL_PROXY=1"

- [ ] **Step 2: Add link in Settings nav**

Grep for the Settings nav render (probably `AccountTab.tsx` or a Settings shell). Add a "Deployment" link that shows only for admins.

- [ ] **Step 3: Header status banner**

If `deploymentStatus.status === 'failed'`, show a red banner across the top of every page: "Deployment error: <status_message>. Fix in Settings → Deployment."

Add to the AppShell or wherever the top banner slot lives.

- [ ] **Step 4: Build + commit**

```bash
cd /c/github/passenger/web && npm run build

cd /c/github/passenger
git add web/src/views/DeploymentTab.tsx web/src/views/settings/*.tsx web/src/components/AppShell.tsx
git commit -m "web: Settings → Deployment page + status header banner"
```

---

## Task 7: README rewrite + smoke test

**Files:**
- Modify: `README.md`
- Create: `docs/deployment-modes.md`

- [ ] **Step 1: Rewrite `README.md`**

The quickstart becomes:

```markdown
## Quick start

```bash
docker run -d --restart unless-stopped \
  -p 80:80 -p 443:443 -p 8787:8787 \
  -v ~/canvas-data:/data \
  --name canvas \
  ghcr.io/dherzfeld/canvas:latest
```

Then open `http://localhost:8787/` and follow the setup wizard: create your admin account, pick how canvas is exposed (Cloudflare Quick Tunnel is the recommended default — no signup required), and you're done.

See [Deployment modes](docs/deployment-modes.md) for details on each option.
```

Remove the reverse-proxy-examples emphasis from the top-of-fold. Mention `CANVAS_EXTERNAL_PROXY=1` in a bottom section for power users.

- [ ] **Step 2: Write `docs/deployment-modes.md`**

Deep-dive on the four modes: what each does, prerequisites, tradeoffs, troubleshooting. Mention Tailscale sidecar as an unsupported-but-documented alternative for users whose ISP blocks port 80.

- [ ] **Step 3: Smoke test each mode**

For each mode, run the container, walk the wizard, verify:

1. **local** — wizard completes, canvas reachable at `http://localhost:8787/`, `/api/deployment/status` shows `mode: 'local', publicUrl: null`
2. **cf-quick** — wizard completes, container restarts, cloudflared spawns, URL appears in `deployment_config.public_url` within 15s, opening URL from another network reaches canvas
3. **domain** — requires real DNS/port forwarding — controller-side manual test
4. **cf-named** — requires user's CF tunnel token — controller-side manual test

Automated smoke for local + cf-quick. Manual smoke for domain + cf-named.

- [ ] **Step 4: Commit**

```bash
cd /c/github/passenger
git add README.md docs/deployment-modes.md
git commit -m "docs: README quickstart + deployment modes reference"
```

---

## Out of scope

- Bundled tailscaled (needs container caps)
- Runtime hot-reload of Caddy config (restart-based reconfig is fine for household use)
- Deployment webhooks / external integrations
- DDNS updater bundled (users still need external DDNS if dynamic-IP + domain mode)
- Custom Caddy plugins (stock caddy:2 only)
- Multi-domain / SNI routing
- Docker Swarm / Kubernetes manifests
- Admin-user CLI tool for out-of-band recovery
