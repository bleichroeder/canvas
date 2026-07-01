# syntax=docker/dockerfile:1.7
#
# canvas self-host image. HTTP-only on :8787 — put your own reverse proxy
# (Caddy, nginx, Cloudflare Tunnel, Tailscale Funnel, etc.) in front of it.
# See docs/reverse-proxy-examples/ for working recipes.

# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# VITE_CANVAS_API unset — the bundled frontend calls /api/* as relative URLs.
RUN npm run build

# --- Stage 2: runtime (Bun + built frontend) ---
FROM oven/bun:1.3-alpine AS runtime

# tini as PID 1 for proper signal + zombie handling.
RUN apk add --no-cache tini

WORKDIR /app

# Server deps first for layer caching.
COPY server/package.json server/
COPY server/bun.lockb* server/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd server && (bun install --production --frozen-lockfile || bun install --production)
COPY server/ server/

# Built frontend from stage 1 — served statically by the Bun server on /*.
COPY --from=web-build /web/dist /app/web

# Persistent state (SQLite database).
RUN mkdir -p /data
VOLUME ["/data"]

ENV CANVAS_DB_PATH=/data/canvas.db
ENV CANVAS_WEB_DIR=/app/web

EXPOSE 8787
WORKDIR /app/server
ENTRYPOINT ["/sbin/tini", "--", "bun", "run", "src/index.ts"]
