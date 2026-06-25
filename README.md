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
