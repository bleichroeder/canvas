# Self-Host Distribution Design (sub-project C+D combined)

**Status:** Draft 2026-06-30. Combines the former sub-project C (TLS) and sub-project D (Docker packaging + frontend bundling) into one deliverable — TLS is inseparable from the packaging that ships it.

**Goal:** Make canvas installable via one `docker run` (or `docker compose up`) command that delivers a working, HTTPS-accessible-from-a-Tesla server. Includes automatic TLS provisioning, sensible defaults for users without a domain, and a fallback for users whose ISP blocks inbound ports.

**Non-goal:** Solving hosted-canvas migration (the `canvas-8j0.pages.dev` deployment stays on the CF Worker + Supabase until this sub-project's image is proven in the wild). That cutover is a post-E decision.

## Architecture

**One Docker image.** Contains the Bun+Hono canvas server, Caddy for TLS + static frontend serving, the built React frontend, and the startup wiring. Not bundled: `tailscaled` — the Tailscale Funnel path uses a sidecar container (documented in the shipped compose file), so the primary image stays lean and doesn't require TUN/`NET_ADMIN`.

**Three operating modes, chosen at container start by env vars:**

1. **sslip.io mode (default).** No env vars needed. Container detects its public IP on startup, constructs a hostname like `142-51-0-77.sslip.io`, has Caddy fetch a Let's Encrypt cert via HTTP-01 (port 80). Canvas is reachable at `https://142-51-0-77.sslip.io/`. Requires ports 80 + 443 forwarded to the container.
2. **BYO-domain mode.** User sets `CANVAS_DOMAIN=canvas.mydomain.com`. Container skips public-IP detection; Caddy uses that hostname for LE cert issuance. User points their DNS at their public IP and forwards 80 + 443. Handles dynamic-IP scenarios (as long as DNS is updated separately — canvas doesn't do DDNS itself).
3. **Tailscale Funnel mode (via sidecar).** User runs the shipped `docker-compose.tailscale.yml` which spins up a Tailscale sidecar alongside canvas. Tailscale exposes canvas via Funnel on `<name>.<tailnet>.ts.net`. No inbound ports required. Container detects it's behind Tailscale and skips Caddy's TLS (Tailscale terminates at their edge); Caddy still runs internally to serve the frontend + proxy `/api/*`.

**Container layout:**
```
/app/server/            — Bun server (bundled via `bun build` for faster cold-start)
/app/web/               — built React frontend (Vite output)
/etc/caddy/Caddyfile    — templated by entrypoint.sh at start time
/entrypoint.sh          — mode selection, IP detection, Caddyfile rendering, service startup
/data/                  — mount point for persistent state
  canvas.db             — SQLite database
  admin-claim-token.txt — first-run sentinel
```

**Startup sequence (entrypoint.sh):**
1. Parse env vars (`CANVAS_DOMAIN`, `TS_FUNNEL_MODE`, `CANVAS_LE_STAGING`, `CANVAS_PORT`, `CANVAS_DB_PATH`).
2. Determine effective hostname:
   - If `CANVAS_DOMAIN` set → use it.
   - Else if `TS_FUNNEL_MODE=1` → skip hostname discovery (Tailscale sidecar handles the URL).
   - Else → curl a public-IP oracle (`https://api.ipify.org` primary, `https://ifconfig.me` fallback, both HTTPS), dash the octets, append `.sslip.io`.
3. Render `Caddyfile` from a template inside the image, substituting the resolved hostname and mode.
4. Start Caddy (background) + Bun server (foreground). Trap SIGTERM → gracefully stop both.
5. On the Bun server's own boot, the existing bootstrap flow prints the admin claim token banner to stdout — Docker logs surface it. The sentinel file lands in `/data/`.

**Caddy config:**
- Modes 1 + 2: Caddy listens on 80 (LE HTTP-01 challenges + HTTPS redirect) and 443 (canvas). Serves `/app/web/*` as static files; proxies `/api/*` and `/health` to the Bun server on `127.0.0.1:${CANVAS_PORT:-8787}`.
- Mode 3 (Tailscale sidecar): Caddy listens on plain HTTP internally at `:8080`. The Tailscale sidecar (running with `TS_SERVE_CONFIG` or equivalent) tunnels its Funnel URL to this port. No LE flow because Tailscale terminates TLS.

**Frontend + backend same-origin.** Caddy serves frontend at `/`, proxies API at `/api/*` — one origin, no CORS gymnastics. This is what enables the `x-sources` sunset from sub-project B to work seamlessly and lets us serve everything through one URL.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `CANVAS_DOMAIN` | (empty) | Set to override sslip.io auto-hostname. Caddy will attempt LE cert for this domain. |
| `CANVAS_PORT` | `8787` | Internal Bun server port. Exposed externally only via Caddy. |
| `CANVAS_DB_PATH` | `/data/canvas.db` | SQLite path. Must be inside the mounted volume. |
| `CANVAS_LE_STAGING` | (unset) | If `1`, Caddy uses LE staging (untrusted cert but no rate limit) for testing. |
| `TS_FUNNEL_MODE` | (unset) | If `1`, Caddy runs in HTTP-only internal mode; expects Tailscale sidecar to front. |
| `CANVAS_PUBLIC_IP_OVERRIDE` | (unset) | Skip IP-oracle lookup; use this value verbatim (useful for local testing / behind CGNAT). |

## Ports

- **Mode 1 (sslip.io) / Mode 2 (domain):** publish `80:80` and `443:443` in `docker run` / compose.
- **Mode 3 (Tailscale):** no ports published on canvas container; Tailscale sidecar handles external access.

## Frontend bundle

The React app currently builds via `npm run build` in `web/` to `web/dist/`. The Dockerfile has a build stage that runs `npm ci && npm run build` and copies `dist/` into the final image at `/app/web/`. The `VITE_CANVAS_API` build-time env var is intentionally left empty in the bundled build — the frontend calls `/api/*` as same-origin relative URLs, which Caddy proxies.

Impact on `web/src/config.ts`: currently reads `import.meta.env.VITE_CANVAS_API`. Change to default to an empty string (relative URL prefix) when the env var is absent. Dev users (`npm run dev` against a separate Bun server) still set `VITE_CANVAS_API=http://localhost:8787` in their `.env.local` as today; the bundled image doesn't need it.

## Public-IP detection

- Primary: `curl -sf https://api.ipify.org` → returns bare IPv4
- Fallback: `curl -sf https://ifconfig.me`
- Cache result to `/data/detected-ip.txt` so container restarts don't hammer the oracle
- Re-detect on every container start (IP might have changed)
- If both oracles fail after 5s → refuse to start with a clear error pointing at `CANVAS_PUBLIC_IP_OVERRIDE`

## Multi-arch

Publish `linux/amd64` + `linux/arm64` images. Covers x86 servers, Apple Silicon Macs, and Raspberry Pi 4/5. Docker BuildKit's `--platform` flag; the CI pipeline (in sub-project E) will handle this.

## Container registry

`ghcr.io/dherzfeld/canvas:<tag>` — private during this sub-project, made public as part of sub-project E's OSS release. Tags: `latest`, semver tags (`v0.3.0`), and `main-<sha>` for CI builds.

## Volume + persistence

- One volume mount: `/data`. Contains `canvas.db`, `admin-claim-token.txt`, Caddy's cert cache, and the cached public IP.
- Actually — Caddy's cert cache should live at `/data/caddy/` so certs survive container recreation. `CANVAS_LE_STAGING=1` should use a different subdirectory to avoid mixing staging + prod certs.

## docker-compose files shipped in the repo

**`docker-compose.yml`** (default, sslip.io mode):
```yaml
services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./canvas-data:/data
    restart: unless-stopped
```

**`docker-compose.tailscale.yml`** (Funnel mode):
Two services — canvas (no external ports, `TS_FUNNEL_MODE=1`) and a `tailscale/tailscale` sidecar with `TS_AUTHKEY` from env, `TS_SERVE_CONFIG` pointing at canvas's HTTP port. User runs `TS_AUTHKEY=tskey-... docker compose -f docker-compose.tailscale.yml up`.

## Startup output UX

First run, docker logs will show:
```
{"level":30,"msg":"canvas server starting","version":"0.3.0",...}
{"level":30,"msg":"caddy: obtaining certificate for 142-51-0-77.sslip.io"}
{"level":30,"msg":"caddy: certificate obtained"}
{"level":30,"msg":"listening","url":"http://0.0.0.0:8787"}

┌──────────────────────────────────────────────────────────┐
│  FIRST-RUN ADMIN CLAIM TOKEN (expires 24h):              │
│                                                          │
│      ABCD-EFGH-IJKL-MNOP-XYZ                             │
│                                                          │
│  Enter this token on your first device to become admin.  │
│  Also written to: /data/admin-claim-token.txt            │
└──────────────────────────────────────────────────────────┘

Canvas is ready at: https://142-51-0-77.sslip.io/
```

Public URL is a distinct log line so `docker logs canvas | grep 'Canvas is ready'` works for scripts.

## Failure modes + user guidance

- **Port 80 blocked by ISP:** LE HTTP-01 fails. Caddy will retry then log an error. Docs recommend Tailscale mode.
- **Dynamic IP changed:** sslip.io hostname is now wrong. Container restart re-detects and re-issues cert. Docs mention DDNS as an alternative for BYO-domain mode.
- **User provides bad `CANVAS_DOMAIN` (DNS doesn't resolve to them):** LE challenge fails. Caddy logs clear error.
- **First run behind CGNAT / no public IP:** Container likely fails LE; docs point at Tailscale mode as the escape hatch.
- **Tesla can't reach sslip.io URL:** the sslip.io service must be up for the DNS to resolve. Their SLA isn't hard-guaranteed. Mitigation: docs note this and recommend a paid domain if reliability matters. `nip.io` is an alternate to fall back on.

## Out of scope

- Automatic DDNS updates (BYO-domain mode users bring their own).
- OS package installation instructions (Homebrew formula, apt, etc.). Docker is the supported path.
- Kubernetes / Nomad / systemd unit files. Community can contribute.
- Reverse-proxy behind an existing user setup (nginx, Traefik). Users who want that turn off canvas's built-in Caddy via a `CANVAS_NO_CADDY=1` env var (out-of-scope for the initial spec — considered a follow-up).
- Backup / restore tooling. Users copy the `/data` volume.
- Migrating existing hosted-canvas data (`canvas-8j0.pages.dev`) — that's a post-E decision.
- Update mechanism (Watchtower, manual `docker pull`). Docs mention `docker compose pull && docker compose up -d`.
- OSS release / license / GitHub Actions / ghcr.io publish workflow — sub-project E's job. This sub-project produces a working image; E automates the release pipeline.

## Success criteria

1. `docker run -d -v ./canvas-data:/data -p 80:80 -p 443:443 <image>` starts cleanly on a machine with public IP + ports forwarded. Within ~30 seconds, docker logs show a `Canvas is ready at: https://...` URL. Opening that URL in Tesla shows the sign-in screen.
2. `docker run ... -e CANVAS_DOMAIN=canvas.example.com ...` (with example.com DNS pointing at the machine's IP) delivers the same result at the user's chosen domain.
3. `docker compose -f docker-compose.tailscale.yml up` with a valid `TS_AUTHKEY` starts canvas + the Tailscale sidecar; canvas is reachable at the tailnet URL, no inbound ports required.
4. Container restart: DB and certs persist. Second boot doesn't re-issue LE cert unless expiry is near.
5. First-run admin claim token appears in `docker logs` and at `/data/admin-claim-token.txt`.
6. Frontend loads from `/` and API calls to `/api/*` succeed same-origin (no CORS, no `x-sources` needed).
7. Image is <300MB compressed, works on `linux/amd64` and `linux/arm64`.
8. Bun server unit tests still pass (the container's start-time behavior is exercised by manual smoke).
