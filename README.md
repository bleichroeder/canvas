# canvas

Self-hosted Tesla-in-car streaming client. Bypasses Tesla's `<video>`-while-not-in-Park restriction via a canvas + WebCodecs pipeline. Plays from Plex and Flixify sources.

> Passenger entertainment only — not for the driver, not for a moving vehicle.

## Quick self-host

Requires: Docker + one machine on your home network with ports 80 + 443 forwardable to it, OR a Tailscale account.

### Option A — default (auto-hostname via sslip.io)

```bash
mkdir canvas && cd canvas
curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/docker-compose.yml
docker compose up -d
docker compose logs -f canvas
```

Watch the logs for the ready line:

```
[entrypoint] Canvas is ready at: https://142-51-0-77.sslip.io/
```

Open that URL in your Tesla (or any browser). Sign in with the admin claim token — also printed in the logs and written to `./canvas-data/admin-claim-token.txt`. Set your password when prompted; future sign-ins use your username + password.

sslip.io is a free public DNS service that maps any dashed IPv4 (like `142-51-0-77.sslip.io`) to its underlying IP (`142.51.0.77`). Let's Encrypt sees a real hostname and issues a real cert.

### Option B — your own domain

Point your domain's DNS at your public IP, then either edit `docker-compose.yml` to set `CANVAS_DOMAIN: canvas.mydomain.com` in the environment block, or pass it via env:

```bash
CANVAS_DOMAIN=canvas.mydomain.com docker compose up -d
```

Same LE flow, just at your chosen hostname.

### Option C — Tailscale Funnel (no port forwarding needed)

Handy when your ISP blocks port 80, or you don't want to touch your router.

1. Get an auth key from <https://login.tailscale.com/admin/settings/keys> (Reusable, non-Ephemeral).
2. Grab the Tailscale compose file + env template:

   ```bash
   curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/docker-compose.tailscale.yml
   curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/.env.example
   mv .env.example .env
   # Edit .env: TS_AUTHKEY=tskey-auth-XXXX
   ```

3. Start:

   ```bash
   docker compose -f docker-compose.tailscale.yml up -d
   docker compose -f docker-compose.tailscale.yml logs -f canvas-tailscale
   ```

Find the `.ts.net` URL Tailscale assigns and open it in your Tesla.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `CANVAS_DOMAIN` | (unset) | Your own domain instead of auto-sslip.io. |
| `CANVAS_LE_STAGING` | (unset) | `1` = use Let's Encrypt staging (untrusted, no rate limit). Handy for testing. |
| `CANVAS_PUBLIC_IP_OVERRIDE` | (unset) | Skip auto public-IP detection; use this value verbatim. |
| `CANVAS_PORT` | `8787` | Internal Bun server port (behind Caddy). |
| `TS_FUNNEL_MODE` | (unset) | `1` = Caddy runs internal-only; Tailscale sidecar handles TLS + public URL. Set by `docker-compose.tailscale.yml`. |

## Updating

```bash
docker compose pull && docker compose up -d
```

Volume state (`./canvas-data`) survives updates: SQLite database, admin claim token file, Caddy's cert cache.

## Layout

The Docker image is the shipping surface, but the code lives in three top-level directories:

- `server/` — Bun + Hono + Drizzle + SQLite backend. See `server/README.md` for dev commands (`bun dev`, `bun test`, migrations).
- `web/` — Vite + React + MUI frontend. `cd web && npm run dev` for hot reload; set `VITE_CANVAS_API=http://localhost:8787` in `web/.env.local` to point at a separately-running server.
- `worker/` — Frozen legacy Cloudflare Worker. Still deployed at the hosted canvas URL; will retire once the self-host image is proven.

Design + implementation docs: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
