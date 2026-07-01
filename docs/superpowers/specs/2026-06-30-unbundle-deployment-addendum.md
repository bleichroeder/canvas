# Unbundle Deployment Addendum (sub-project C.1)

**Status:** Approved 2026-06-30 after C+D shipped and smoke testing revealed the bundled-TLS story wasn't actually the "spin up and forget" experience it needed to be. Every mode (sslip.io, BYO domain, Tailscale) had non-trivial per-user setup, and bundling Caddy dictated a deployment shape that many self-hosters already have opinions about.

**Goal:** Retreat from the "canvas ships TLS" position. Canvas becomes an HTTP-only Bun server on `:8787`; users bring their own reverse proxy (Caddy, nginx, Cloudflare Tunnel, Tailscale, whatever). Follows the same shape as Immich, Vaultwarden, Jellyfin, Nextcloud, and every other self-hosted app in this class.

**What we're removing:**
- Caddy binary inside the image
- Public-IP detection, Caddyfile template, envsubst, sslip.io hostname computation
- Mode selection logic (sslip / domain / tailscale / local-TLS)
- ~6 env vars related to TLS + hostname
- `docker-compose.tailscale.yml` (moves to a documented recipe alongside others)

**What we're keeping:**
- Bun canvas server
- Built React frontend
- SQLite persistence at `/data`
- tini for signal handling
- `CANVAS_PORT` (default 8787) + `CANVAS_DB_PATH` (default `/data/canvas.db`) env vars

**What we're adding:**
- Bun/Hono serves the built frontend statically (Caddy used to). Uses Hono's `serveStatic` from `hono/bun` — no new dependency.
- SPA fallback: unmatched paths return `index.html` (matches Caddy's `try_files {path} /index.html` behavior).
- `docs/reverse-proxy-examples/` folder with working snippets for the most common paths.

## Architecture

Canvas image content after this sub-project:

```
/app/server/            — Bun canvas server (existing)
/app/web/               — built React frontend (existing, but now Bun-served)
/data/                  — volume mount (existing)
```

**No Caddy. No entrypoint script. No template.** Container's ENTRYPOINT becomes `tini -- bun run src/index.ts` (or similar).

Bun-Hono routing precedence:
1. `/health` (existing)
2. `/api/*` (existing)
3. Anything else → serve from `/app/web` with `index.html` fallback (new)

## Env vars after this sub-project

| Var | Default | Description |
|---|---|---|
| `CANVAS_PORT` | `8787` | HTTP port the Bun server listens on |
| `CANVAS_DB_PATH` | `/data/canvas.db` | SQLite path |
| `CANVAS_WEB_DIR` | `/app/web` | Static file root; set for local dev only |

Everything else from C+D (`CANVAS_DOMAIN`, `CANVAS_LE_STAGING`, `CANVAS_PUBLIC_IP_OVERRIDE`, `CANVAS_LOCAL_TLS`, `TS_FUNNEL_MODE`) is deleted.

## Reverse-proxy story

`docs/reverse-proxy-examples/` gets:

- `caddy-standalone.md` — user runs Caddy separately, either as a sidecar via a small compose file or on the host. Caddyfile template + LE via Caddy's default ACME
- `cloudflare-tunnel.md` — cloudflared token approach
- `tailscale-funnel.md` — the sidecar setup we already tested; moved from top-level compose to a recipe
- `nginx-letsencrypt.md` — nginx.conf + certbot recipe (community-familiar path)

README's quickstart becomes: run canvas on 8787, pick a reverse-proxy recipe, done.

## Success criteria

1. Image size drops meaningfully (target: ~50% reduction, from ~182 MB compressed toward ~90 MB).
2. `docker run -p 8787:8787 -v ./canvas-data:/data canvas:local` starts the server; `curl http://localhost:8787/health` returns `{"ok":true,...}`.
3. `http://localhost:8787/` returns the React frontend `index.html`.
4. `http://localhost:8787/#/sign-in` (any hash route) works — because it hits `/`, the SPA fallback serves index.html, then the hash router takes over client-side.
5. All 185 server tests still pass — the static-serve middleware is new logic but doesn't change existing route behavior.
6. `docs/reverse-proxy-examples/` contains at least Caddy-standalone, Cloudflare Tunnel, and Tailscale-funnel recipes with working config snippets.

## Out of scope

- Serving anything but the bundled `/app/web` frontend. If users want to swap the frontend, they run Bun with `CANVAS_WEB_DIR` pointing at their build.
- Compression (gzip/br) — Caddy did this; Bun/Hono can add it but the frontend bundle is already gzip-friendly at the reverse-proxy layer. Deferred.
- Cache headers on static assets — same, reverse proxy handles it.
- Recipes for every possible reverse proxy. Ship 3-4 core ones; community can PR more later (sub-project E).
