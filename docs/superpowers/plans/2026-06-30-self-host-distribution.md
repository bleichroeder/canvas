# Self-Host Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` for tracking.

**Goal:** Ship a Docker image that turns canvas into a one-command self-hosted install. `docker run … canvas:latest` starts a HTTPS-accessible canvas server usable from a Tesla, with three operating modes chosen by env vars (sslip.io / BYO domain / Tailscale Funnel).

**Architecture:** Single image containing Caddy (frontend static + TLS + reverse proxy) and Bun (canvas server). Frontend + `/api/*` served same-origin through Caddy. Entrypoint script picks mode from env vars and renders the Caddyfile at container start.

**Tech Stack:** Docker BuildKit multi-arch (amd64 + arm64), Caddy 2 (alpine), Bun 1.3 (alpine), Node 20 (build-only for the React frontend), Bash for the entrypoint.

## Global Constraints

- **Branch:** all work lands on `self-host-server-port` (integration branch — no per-task sub-branch this time, matching how sub-project A was executed). Alternatively branch off to `self-host-distribution` if you prefer per-sub-project isolation — controller's call at execution time. Task list here assumes direct commits on `self-host-server-port`.
- **No breaking changes** to the Bun canvas server or the React frontend beyond `web/src/config.ts` for the same-origin default. All 185 sub-project-B tests continue to pass.
- **Frontend + API same-origin.** The bundled build treats `API_BASE` as `""` (relative URLs). Dev mode with a separate server keeps working via `.env.local`.
- **Image size target: <300MB compressed.** Not a hard fail but flag if the built image exceeds 400MB.
- **Multi-arch build defers to CI.** The plan produces a working `Dockerfile` and Compose files. Sub-project E wires the CI pipeline for `buildx` multi-platform pushes. This sub-project verifies `linux/amd64` locally.
- **Registry namespace:** `ghcr.io/dherzfeld/canvas` — used in docs and example commands. The image itself is registry-agnostic during this sub-project (no actual push).
- **Persistent state at `/data`** — SQLite, admin-claim-token.txt, Caddy cert cache, cached public IP.

## File Structure

New files at repo root:
- `Dockerfile`
- `.dockerignore`
- `docker-compose.yml` (default / sslip.io mode)
- `docker-compose.tailscale.yml` (Funnel mode with Tailscale sidecar)
- `docker/entrypoint.sh` — mode selection, IP detection, Caddyfile rendering, service startup
- `docker/Caddyfile.template` — envsubst-ready template
- `docker/detect-public-ip.sh` — small helper called by entrypoint

Modified:
- `web/src/config.ts` — default `API_BASE` to `""` when `VITE_CANVAS_API` is unset
- `web/.env.example` — clarify the same-origin default
- `README.md` (root) — quickstart section for self-hosting

---

## Task 1: Frontend same-origin build

**Files:**
- Modify: `web/src/config.ts`
- Modify: `web/.env.example`

**Interfaces produced:** built frontend calls `/api/*` as same-origin relative URLs when `VITE_CANVAS_API` is empty/unset. Dev mode (`VITE_CANVAS_API=http://localhost:8787`) is unchanged.

- [ ] **Step 1: Read `web/src/config.ts`**

Current file exports `API_BASE` from `import.meta.env.VITE_CANVAS_API`. Confirm exact shape before editing.

- [ ] **Step 2: Default `API_BASE` to empty string**

Change:
```ts
export const API_BASE = import.meta.env.VITE_CANVAS_API;
```
to:
```ts
// Empty string = same-origin (relative URLs). This is the bundled-image
// default — Caddy serves both the frontend and /api/* from one host.
// Dev users targeting a separate Bun server set VITE_CANVAS_API in .env.local.
export const API_BASE: string = import.meta.env.VITE_CANVAS_API ?? '';
```

If the file has more logic (e.g., trimming trailing slashes), preserve it and just change the default.

- [ ] **Step 3: Update `web/.env.example`**

Rewrite the `VITE_CANVAS_API` block:
```env
# Backend URL. Leave UNSET (or empty) for a bundled Docker install — the
# frontend calls /api/* as relative URLs and Caddy proxies to canvas.
# Only set this for local dev when running `npm run dev` against a
# separate Bun server:
#   VITE_CANVAS_API=http://localhost:8787
```

- [ ] **Step 4: Verify build**

```powershell
cd C:\github\passenger\web
npm run build
```
Clean.

- [ ] **Step 5: Verify dev mode still works**

Skim the built `dist/index.html` and confirm the resulting bundle references `/api/` relative paths. In a dev context with `.env.local` set, the app should still fetch from `http://localhost:8787/api/*` (already tested during B smoke).

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add web/src/config.ts web/.env.example
git commit -m "web: default API_BASE to same-origin for bundled installs"
```

---

## Task 2: Caddyfile template + public IP detection helper

**Files:**
- Create: `docker/Caddyfile.template`
- Create: `docker/detect-public-ip.sh`

**Interfaces produced:**
- `Caddyfile.template` — envsubst-processed. Placeholders: `${CANVAS_HOSTNAME}`, `${CANVAS_PORT}`, `${CANVAS_LE_STAGING_LINE}`. Renders three effective modes based on entrypoint logic (see T3).
- `detect-public-ip.sh` — outputs a bare IPv4 to stdout; exits 0 on success, 1 on failure. Tries ipify.org then ifconfig.me, 3s timeout each.

- [ ] **Step 1: Write `docker/detect-public-ip.sh`**

```bash
#!/bin/sh
# Emits a public IPv4 address to stdout, or exits 1 if unreachable.
# Retries a handful of oracles because any single one can go down.
set -eu

try() {
  # $1: URL. curl with 3s connect + 3s total, quiet on error.
  ip=$(curl -sf --connect-timeout 3 --max-time 4 "$1" 2>/dev/null || true)
  # Strip whitespace and validate as IPv4.
  ip=$(printf '%s' "$ip" | tr -d ' \t\n\r')
  case "$ip" in
    *.*.*.*)
      # Basic sanity — reject if any octet contains a non-digit.
      if printf '%s' "$ip" | grep -qE '^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$'; then
        printf '%s\n' "$ip"
        exit 0
      fi
      ;;
  esac
  return 1
}

try https://api.ipify.org || \
  try https://ifconfig.me || \
  try https://icanhazip.com || {
  echo "detect-public-ip: no oracle reachable" >&2
  exit 1
}
```

Make executable: `chmod +x docker/detect-public-ip.sh`.

- [ ] **Step 2: Write `docker/Caddyfile.template`**

```
# Rendered at container start from docker/Caddyfile.template.
# Placeholders replaced by entrypoint.sh via envsubst.

{
  # LE contact — empty is fine for self-hosted; Caddy will still issue certs.
  email {$CANVAS_ADMIN_EMAIL}
  ${CANVAS_LE_STAGING_LINE}
  # Persist certs on the /data volume so they survive container restarts.
  storage file_system /data/caddy
}

${CANVAS_HOSTNAME} {
  # Reverse-proxy /api/* and /health to the Bun canvas server.
  handle_path /api/* {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle /health {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }

  # Everything else: static frontend from /app/web (Vite build output).
  handle {
    root * /app/web
    try_files {path} /index.html
    file_server
  }

  encode gzip
}
```

The `${CANVAS_LE_STAGING_LINE}` placeholder holds either an empty string (prod issuance) or `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` (staging). The entrypoint fills it based on `CANVAS_LE_STAGING`.

Note the `handle_path /api/*` — this strips the `/api` prefix before proxying? Actually no, `handle_path` strips the matcher's prefix. We want to KEEP `/api/*` so the Bun server routes match. Change `handle_path` to `handle`:

```
handle /api/* {
  reverse_proxy 127.0.0.1:${CANVAS_PORT}
}
```

`handle` doesn't strip; `handle_path` does. Use `handle` for both `/api/*` and `/health`.

Corrected Caddyfile snippet:
```
${CANVAS_HOSTNAME} {
  handle /api/* {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle /health {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle {
    root * /app/web
    try_files {path} /index.html
    file_server
  }
  encode gzip
}
```

- [ ] **Step 3: For Tailscale Funnel mode: a second inline template block**

When `TS_FUNNEL_MODE=1`, we don't want Caddy to fight for port 443 (Tailscale terminates TLS externally); we want Caddy listening on internal HTTP `:8080`. The entrypoint will render a DIFFERENT template body in that case. Add to the template file as a comment block, or handle entirely in entrypoint via inline heredoc.

Simplest: keep `Caddyfile.template` as the sslip/BYO version above, and have `entrypoint.sh` write a completely different (short) Caddyfile inline for Tailscale mode:
```
:8080 {
  handle /api/* {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle /health {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle {
    root * /app/web
    try_files {path} /index.html
    file_server
  }
  encode gzip
}
```

No TLS block — this Caddy is behind Tailscale which handles it. Document the two-template approach as a comment at the top of `Caddyfile.template`.

- [ ] **Step 4: Sanity-check the template**

Locally: `caddy validate --config docker/Caddyfile.template` will complain about the unsubstituted `${VAR}` placeholders. That's expected — actual validation happens after entrypoint renders. Skip formal validation here; sub-task 3 will exercise it inside the container.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add docker/Caddyfile.template docker/detect-public-ip.sh
git commit -m "docker: Caddyfile template + public IP detection helper"
```

---

## Task 3: Entrypoint script

**Files:**
- Create: `docker/entrypoint.sh`

**Interfaces produced:** The container's `ENTRYPOINT`. Handles mode selection, hostname resolution, Caddyfile rendering, service startup and shutdown.

- [ ] **Step 1: Write `docker/entrypoint.sh`**

```bash
#!/bin/sh
# canvas Docker entrypoint. Selects operating mode from env vars, renders
# the Caddyfile, and launches Caddy + the Bun canvas server.
set -eu

# ---------- Defaults ----------
: "${CANVAS_PORT:=8787}"
: "${CANVAS_DB_PATH:=/data/canvas.db}"
: "${CANVAS_ADMIN_EMAIL:=}"
: "${CANVAS_HOSTNAME:=}"
: "${CANVAS_DOMAIN:=}"
: "${CANVAS_PUBLIC_IP_OVERRIDE:=}"
: "${CANVAS_LE_STAGING:=}"
: "${TS_FUNNEL_MODE:=}"
export CANVAS_PORT CANVAS_DB_PATH

# ---------- Mode selection ----------
if [ -n "$TS_FUNNEL_MODE" ] && [ "$TS_FUNNEL_MODE" != "0" ]; then
  MODE="tailscale"
elif [ -n "$CANVAS_DOMAIN" ]; then
  MODE="domain"
  CANVAS_HOSTNAME="$CANVAS_DOMAIN"
else
  MODE="sslip"
fi

echo "[entrypoint] mode: $MODE"

# ---------- Hostname discovery (sslip mode only) ----------
if [ "$MODE" = "sslip" ]; then
  if [ -n "$CANVAS_PUBLIC_IP_OVERRIDE" ]; then
    ip="$CANVAS_PUBLIC_IP_OVERRIDE"
    echo "[entrypoint] using CANVAS_PUBLIC_IP_OVERRIDE: $ip"
  else
    # Cache detected IP so restarts don't hit the oracle every time.
    cache="/data/detected-ip.txt"
    if [ -f "$cache" ] && ip=$(cat "$cache" 2>/dev/null) && [ -n "$ip" ]; then
      echo "[entrypoint] cached public IP: $ip (rechecking in background)"
      # Fire off a fresh detection in the background; if it differs, next
      # restart will pick it up. Silent on failure.
      ( fresh=$(/app/docker/detect-public-ip.sh 2>/dev/null || true)
        if [ -n "$fresh" ] && [ "$fresh" != "$ip" ]; then
          echo "$fresh" > "$cache"
          echo "[entrypoint] public IP changed to $fresh; restart canvas to re-issue cert" >&2
        fi
      ) &
    else
      echo "[entrypoint] detecting public IP…"
      ip=$(/app/docker/detect-public-ip.sh) || {
        echo "[entrypoint] ERROR: could not detect public IP" >&2
        echo "  Set CANVAS_DOMAIN=<yourdomain> or CANVAS_PUBLIC_IP_OVERRIDE=<ip>" >&2
        echo "  Or use the Tailscale compose file for tunnel-based access" >&2
        exit 1
      }
      mkdir -p /data
      echo "$ip" > "$cache"
    fi
  fi
  # Dashify: 142.51.0.77 -> 142-51-0-77.sslip.io
  CANVAS_HOSTNAME="$(echo "$ip" | tr '.' '-').sslip.io"
fi

export CANVAS_HOSTNAME

# ---------- Caddyfile rendering ----------
if [ "$MODE" = "tailscale" ]; then
  cat > /etc/caddy/Caddyfile <<EOF
:8080 {
  handle /api/* {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle /health {
    reverse_proxy 127.0.0.1:${CANVAS_PORT}
  }
  handle {
    root * /app/web
    try_files {path} /index.html
    file_server
  }
  encode gzip
}
EOF
  echo "[entrypoint] canvas will be reachable via the Tailscale sidecar."
else
  # Render sslip/domain template.
  if [ -n "$CANVAS_LE_STAGING" ] && [ "$CANVAS_LE_STAGING" != "0" ]; then
    export CANVAS_LE_STAGING_LINE="acme_ca https://acme-staging-v02.api.letsencrypt.org/directory"
    echo "[entrypoint] using Let's Encrypt STAGING (untrusted cert, no rate limit)"
  else
    export CANVAS_LE_STAGING_LINE=""
  fi
  envsubst < /app/docker/Caddyfile.template > /etc/caddy/Caddyfile
  echo "[entrypoint] canvas will be reachable at: https://${CANVAS_HOSTNAME}/"
fi

# ---------- Service startup ----------
# Start Caddy in the background. Log its PID for the shutdown trap.
caddy start --config /etc/caddy/Caddyfile --pidfile /tmp/caddy.pid
sleep 0.5

# Graceful shutdown: on SIGTERM/SIGINT, stop Caddy and let bun exit naturally.
shutdown() {
  echo "[entrypoint] shutting down…"
  caddy stop --pidfile /tmp/caddy.pid 2>/dev/null || true
  # Bun will receive the signal via the process group and exit.
  exit 0
}
trap shutdown TERM INT

# Bun canvas server in the foreground.
cd /app/server
exec bun run src/index.ts
```

Make executable: `chmod +x docker/entrypoint.sh`.

- [ ] **Step 2: Local syntax check**

```powershell
# Use bash's syntax-only mode if available (WSL / git-bash):
bash -n docker/entrypoint.sh
bash -n docker/detect-public-ip.sh
```

If bash isn't available locally, this passes into T4 (built inside container).

- [ ] **Step 3: Commit**

```powershell
cd C:\github\passenger
git add docker/entrypoint.sh
git commit -m "docker: entrypoint — mode selection, IP detection, Caddyfile rendering"
```

---

## Task 4: Dockerfile + .dockerignore

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

**Interfaces produced:** buildable container image `canvas:local` that runs the entrypoint on startup, exposes 80/443, mounts `/data` as a volume.

- [ ] **Step 1: Write `.dockerignore`**

Prevent copying anything we don't need into the build context — critical for build speed and image size.

```
# Node modules — reinstalled inside the image
**/node_modules
web/dist
web/.env.local
web/.env

# Bun install
server/node_modules

# Local dev state
server/data
data
*.log

# Docs + git + IDE
docs/
.git/
.github/
.vscode/
.idea/
**/.DS_Store

# Existing worker (frozen, not in the self-host image)
worker/

# Non-source
bookmarklet/
```

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7

# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# API_BASE defaults to "" (same-origin) when VITE_CANVAS_API is unset — see Task 1.
RUN npm run build

# --- Stage 2: pull Caddy binary (Go, ~40MB alpine image, we take just the exe) ---
FROM caddy:2-alpine AS caddy-src

# --- Stage 3: runtime (Bun + Caddy + built frontend + entrypoint) ---
FROM oven/bun:1.3-alpine AS runtime

# Runtime deps: envsubst (from gettext), curl (for public-IP detection),
# sh (already present in alpine).
RUN apk add --no-cache gettext curl tini

# Caddy binary from stage 2.
COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy

# Application layout.
WORKDIR /app

# Server: package files first for layer caching, then production install, then source.
COPY server/package.json server/bun.lockb* server/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd server && bun install --production --frozen-lockfile || bun install --production
COPY server/ server/

# Built frontend from stage 1.
COPY --from=web-build /web/dist /app/web

# Docker orchestration bits.
COPY docker/ /app/docker/
RUN chmod +x /app/docker/entrypoint.sh /app/docker/detect-public-ip.sh

# Caddy needs a place for the rendered config + its data.
RUN mkdir -p /etc/caddy /data /data/caddy

# Volume for persistent state (SQLite, admin claim token, Caddy certs).
VOLUME ["/data"]

# HTTPS + HTTP (LE HTTP-01 challenge redirect). Tailscale mode uses neither externally.
EXPOSE 80 443

# tini as PID 1 for correct signal + zombie handling.
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
```

Notes:
- `bun.lockb*` (glob) — if there's no lockfile, `COPY` won't error; the `bun install` fallback handles both cases.
- `tini` gives us proper PID-1 signal forwarding so `docker stop` propagates SIGTERM to bun.
- `oven/bun:1.3-alpine` — confirm this tag exists during build; if not, fall back to `oven/bun:1-alpine`.

- [ ] **Step 3: Local build test**

```powershell
cd C:\github\passenger
docker build -t canvas:local .
```

Expected: build succeeds, final image size printed. If size >400MB compressed, investigate before proceeding. Common culprits: node_modules smuggled in via a bad .dockerignore rule, or Bun's install cache leaking into the final layer.

- [ ] **Step 4: Local run smoke (LE staging, safe to hammer)**

```powershell
docker run --rm -it `
  -v ${PWD}/tmp-canvas-data:/data `
  -e CANVAS_LE_STAGING=1 `
  -e CANVAS_PUBLIC_IP_OVERRIDE=127.0.0.1 `
  -p 8080:80 -p 8443:443 `
  canvas:local
```

Verify the logs show:
- `[entrypoint] mode: sslip`
- `[entrypoint] using CANVAS_PUBLIC_IP_OVERRIDE: 127.0.0.1`
- `[entrypoint] canvas will be reachable at: https://127-0-0-1.sslip.io/`
- Caddy attempts LE staging (will fail since 127.0.0.1 isn't a real public IP — expected). The bun server should still start and be reachable on the container's internal port; via Caddy the HTTPS URL will 5xx due to cert issue, but the important signals (mode detection, template rendering, service startup) are visible.

For a REAL smoke test (actual LE issuance), the controller runs this on a machine with a real public IP + ports open. That happens in T6.

Ctrl+C to stop; container exits cleanly.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add Dockerfile .dockerignore
git commit -m "docker: multi-stage Dockerfile — web build + Caddy + Bun runtime"
```

---

## Task 5: docker-compose files

**Files:**
- Create: `docker-compose.yml`
- Create: `docker-compose.tailscale.yml`
- Create: `.env.example` (repo root, distinct from `web/.env.example`)

**Interfaces produced:** copy-paste-ready compose configurations for both operating modes.

- [ ] **Step 1: Write `docker-compose.yml`** (default, sslip.io mode)

```yaml
# Default canvas self-host setup:
#   docker compose up -d
#
# Uses sslip.io + Let's Encrypt for HTTPS. Requires ports 80 + 443
# forwarded on your router to the machine running this compose file.

services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./canvas-data:/data
    environment:
      # Uncomment to use your own domain instead of auto-sslip.io:
      # CANVAS_DOMAIN: canvas.yourdomain.com
      # Use LE staging to test without hitting the prod rate limit:
      # CANVAS_LE_STAGING: "1"
      # Override IP detection (rarely needed):
      # CANVAS_PUBLIC_IP_OVERRIDE: 203.0.113.42
      CANVAS_ADMIN_EMAIL: ""  # optional; LE issues without it
```

- [ ] **Step 2: Write `docker-compose.tailscale.yml`** (Funnel mode)

```yaml
# Canvas via Tailscale Funnel — no port forwarding needed.
#   1. Get a Tailscale auth key from https://login.tailscale.com/admin/settings/keys
#      (choose Reusable + Ephemeral OFF; enable Funnel access on the tag if you use tags)
#   2. TS_AUTHKEY=tskey-auth-XXXX docker compose -f docker-compose.tailscale.yml up -d
#   3. Your canvas URL will be printed in `docker logs canvas-tailscale`.

services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    network_mode: "service:canvas-tailscale"
    volumes:
      - ./canvas-data:/data
    environment:
      TS_FUNNEL_MODE: "1"
      CANVAS_PORT: "8787"
    depends_on:
      - canvas-tailscale

  canvas-tailscale:
    image: tailscale/tailscale:latest
    container_name: canvas-tailscale
    hostname: canvas
    restart: unless-stopped
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY?"TS_AUTHKEY env var is required — see comments at top of this file"}
      TS_STATE_DIR: /var/lib/tailscale
      TS_USERSPACE: "false"
      TS_EXTRA_ARGS: "--advertise-tags=tag:canvas"
      # Expose the Caddy internal HTTP port (:8080) as a public Funnel HTTPS URL.
      TS_SERVE_CONFIG: /config/serve.json
    volumes:
      - ./canvas-tailscale-state:/var/lib/tailscale
      - ./docker/ts-serve.json:/config/serve.json:ro
    cap_add:
      - net_admin
      - sys_module
    devices:
      - /dev/net/tun:/dev/net/tun
```

- [ ] **Step 3: Write `docker/ts-serve.json`** (Tailscale Funnel serve config)

```json
{
  "TCP": {
    "443": { "HTTPS": true }
  },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:8080" }
      }
    }
  },
  "AllowFunnel": {
    "${TS_CERT_DOMAIN}:443": true
  }
}
```

`${TS_CERT_DOMAIN}` is a Tailscale-provided variable that resolves to the machine's tailnet DNS name. See https://tailscale.com/kb/1242/tailscale-serve for authoritative docs.

- [ ] **Step 4: Write `.env.example`** (repo root)

```env
# Copy to .env for docker compose. Only used by docker-compose.tailscale.yml
# at present; the default docker-compose.yml requires no env vars.

# Tailscale auth key — REQUIRED for docker-compose.tailscale.yml
# Get one from: https://login.tailscale.com/admin/settings/keys
TS_AUTHKEY=

# Optional: canvas admin email (passed through to Caddy for LE registration)
CANVAS_ADMIN_EMAIL=
```

Add `.env` to `.gitignore` if not already excluded (repo root `.gitignore` already excludes `.env`).

- [ ] **Step 5: Verify compose files parse**

```powershell
cd C:\github\passenger
docker compose -f docker-compose.yml config >$null
docker compose -f docker-compose.tailscale.yml --env-file .env.example config >$null
```

Both should exit 0. Fix any YAML errors surfaced.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add docker-compose.yml docker-compose.tailscale.yml docker/ts-serve.json .env.example
git commit -m "docker: compose files for sslip.io default + Tailscale Funnel modes"
```

---

## Task 6: README quickstart + final verification

**Files:**
- Modify: `README.md` (repo root — read it first to preserve any existing content)

- [ ] **Step 1: Read existing `README.md`**

If it's a stub or empty, that's fine; you're adding a proper README. If it has meaningful content (unlikely at this stage), integrate the new section rather than overwriting.

- [ ] **Step 2: Write / append the self-host quickstart section**

```markdown
# canvas

Self-hosted Tesla-in-car streaming client. Bypasses Tesla's `<video>`-while-not-in-Park restriction via a canvas + WebCodecs pipeline. Plays from Plex and Flixify sources.

## Quick self-host

Requires: Docker, one machine with ports 80 + 443 forwardable OR a Tailscale account.

### Option A — default (auto-hostname via sslip.io)

```bash
mkdir canvas && cd canvas
curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/docker-compose.yml
docker compose up -d
docker compose logs -f canvas
```

Watch the logs for:

```
Canvas is ready at: https://142-51-0-77.sslip.io/
```

Open that URL in your Tesla. Log in with the admin claim token (also printed in the logs and written to `./canvas-data/admin-claim-token.txt`). Set your password on first login.

### Option B — your own domain

Set your domain's DNS to your public IP, then:

```bash
CANVAS_DOMAIN=canvas.mydomain.com docker compose up -d
```

Or edit `docker-compose.yml` and set `CANVAS_DOMAIN` in the `environment:` block.

### Option C — Tailscale Funnel (no port forwarding needed)

Handy when your ISP blocks port 80, or you don't want to touch your router.

```bash
curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/docker-compose.tailscale.yml
curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/.env.example
mv .env.example .env
# Edit .env: set TS_AUTHKEY=tskey-auth-... from https://login.tailscale.com/admin/settings/keys
docker compose -f docker-compose.tailscale.yml up -d
docker compose -f docker-compose.tailscale.yml logs -f canvas-tailscale
```

Look for the `.ts.net` URL and open it in your Tesla.

## First login

`docker compose logs canvas` shows the admin claim token. It's also at `./canvas-data/admin-claim-token.txt`. Redeem it at your canvas URL's `/#/claim`, set a password, then future logins use `/#/sign-in` (username + password).

## Updating

```bash
docker compose pull && docker compose up -d
```

Volume-mounted state (`./canvas-data`) survives updates.

## Development

If you want to hack on canvas itself rather than run the shipped image, see [docs/development.md](docs/development.md).

(TODO in a follow-up sub-project — currently the server + web dirs both have their own READMEs.)
```

Feel free to add screenshots or a features list — those are polish and can land in the OSS-release sub-project.

- [ ] **Step 3: Local integration smoke (mode 1)**

Full end-to-end with real container:

```powershell
cd C:\github\passenger
docker build -t canvas:smoketest .

# Use LE staging + a real IP override (your workstation's LAN IP; won't actually work for LE but exercises the code paths)
Remove-Item -Recurse -Force tmp-smoke-data -ErrorAction SilentlyContinue
docker run --rm --name canvas-smoke `
  -v ${PWD}/tmp-smoke-data:/data `
  -e CANVAS_LE_STAGING=1 `
  -e CANVAS_PUBLIC_IP_OVERRIDE=192.0.2.1 `
  -p 8080:80 -p 8443:443 `
  -d canvas:smoketest

Start-Sleep -Seconds 5
docker logs canvas-smoke | Select-String -Pattern "mode:|reachable at:|admin claim token"
Test-NetConnection localhost -Port 8080 -InformationLevel Quiet
docker stop canvas-smoke
```

Verify the logs show mode: sslip, hostname `192-0-2-1.sslip.io`, and the admin claim token banner. Port 8080 responds (may 5xx due to Caddy waiting on cert; the point is the container is up and listening).

- [ ] **Step 4: Compose smoke (mode 2)**

```powershell
cd C:\github\passenger
docker compose up -d
Start-Sleep -Seconds 5
docker compose logs canvas | Select-String -Pattern "mode:|reachable at:|admin claim token"
docker compose down
```

Same expected output shape. `docker compose logs -f canvas` in a real deployment surfaces the URL once Caddy has the cert.

- [ ] **Step 5: Server tests still pass**

```powershell
$env:PATH = "C:\Users\David\.bun\bin;" + $env:PATH
cd C:\github\passenger\server
bun test
```

Expect 185/185 pass. This sub-project doesn't touch server code beyond nothing (the config change is frontend-only), so this is just paranoia.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add README.md
git commit -m "docs: self-host quickstart README"
```

- [ ] **Step 7: Final report**

Report to controller:
- All tasks complete
- Image builds, container runs, logs look correct
- 185 server tests pass
- **Deferred to controller for real smoke**: an end-to-end run with actual public IP + LE prod cert + Tesla-browser access. That's a real-network test only David can do.

---

## Out of scope

- CI / GitHub Actions for multi-arch `buildx` publish → sub-project E.
- `ghcr.io` publish → sub-project E (public release).
- Watchtower / auto-update tooling.
- Reverse-proxy-off mode (`CANVAS_NO_CADDY=1`) for users with existing nginx / Traefik setups.
- systemd unit files, Kubernetes manifests, Homebrew formulae.
- Backup/restore automation (users copy `./canvas-data`).
- Full-fat `bun build --compile` into a single binary (current image just runs `bun src/index.ts`).
- Migrating existing `canvas-8j0.pages.dev` deployment to this image — post-E cutover.
- ARM7 (32-bit Pi) support.
- Windows containers.
