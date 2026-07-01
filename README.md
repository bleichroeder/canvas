# canvas

Self-hosted Tesla-in-car streaming client. Bypasses Tesla's `<video>`-while-not-in-Park restriction via a canvas + WebCodecs pipeline. Plays from Plex and Flixify sources.

> Passenger entertainment only — not for the driver, not for a moving vehicle.

## Requirements

- Docker
- A machine on your home network (Raspberry Pi 4/5, spare desktop, NAS with Docker, etc.)
- A way to put HTTPS in front of canvas (see [reverse-proxy recipes](docs/reverse-proxy-examples/))

## Quick start

```bash
mkdir canvas && cd canvas
curl -O https://raw.githubusercontent.com/dherzfeld/canvas/main/docker-compose.yml
docker compose up -d
```

Canvas listens on HTTP port 8787. Verify with:

```bash
curl http://localhost:8787/health
# {"ok":true,"version":"..."}
```

Then pick a reverse-proxy recipe from [`docs/reverse-proxy-examples/`](docs/reverse-proxy-examples/) to get HTTPS in front. Recipes assume canvas is already running on `:8787` and add a proxy in front.

## Why do I need a reverse proxy?

Canvas uses the browser's **WebCodecs API** to render video onto a canvas element — that's how it bypasses Tesla's video-in-motion restriction. WebCodecs is a **secure-context API**; it only works over HTTPS or on `localhost`. Real-world use — Tesla, phone, another laptop — requires HTTPS.

Canvas doesn't ship its own TLS story so we don't dictate infrastructure decisions or bloat the image. If you already have nginx / Caddy / Traefik / Cloudflare Tunnel / Tailscale in your stack, point it at `canvas:8787`. If you don't, the recipes give you a working stack in minutes.

## First login

Once you have HTTPS in front and can reach canvas from a browser:

1. `docker logs canvas` shows the admin claim token on first run (also written to `./canvas-data/admin-claim-token.txt`).
2. Open canvas → `/#/claim` → paste the token → set a password.
3. Subsequent logins use username + password at `/#/sign-in`.

Additional users are created from Settings → Users; admin picks their initial password.

## Environment variables

| Var | Default | Description |
|---|---|---|
| `CANVAS_PORT` | `8787` | HTTP port |
| `CANVAS_DB_PATH` | `/data/canvas.db` | SQLite path |
| `CANVAS_WEB_DIR` | `/app/web` | Static frontend directory (set only for local dev) |
| `CANVAS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS allowlist. Rarely needed when reverse-proxied same-origin. |

## Updating

```bash
docker compose pull && docker compose up -d
```

`./canvas-data/` (SQLite database, admin claim token file) survives updates.

## Layout

- `server/` — Bun + Hono + Drizzle + SQLite backend. See `server/README.md` for dev commands.
- `web/` — Vite + React + MUI frontend. `cd web && npm run dev` for hot reload; set `VITE_CANVAS_API=http://localhost:8787` in `web/.env.local` to point at a separately-running server.
- `worker/` — Frozen legacy Cloudflare Worker.

Design + implementation docs: `docs/superpowers/specs/` and `docs/superpowers/plans/`.
