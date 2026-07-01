# syntax=docker/dockerfile:1.7
#
# canvas self-host distribution image.
# Multi-stage: build the React frontend, pull Caddy's binary, then assemble
# a Bun-based runtime containing everything.

# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
# VITE_CANVAS_API left unset — the bundled frontend calls /api/* as
# relative URLs. Caddy inside the runtime proxies to the Bun server.
RUN npm run build

# --- Stage 2: grab the Caddy binary from its official alpine image ---
FROM caddy:2-alpine AS caddy-src

# --- Stage 3: runtime (Bun + Caddy + built frontend + entrypoint) ---
FROM oven/bun:1.3-alpine AS runtime

# Runtime deps:
#   gettext  — provides envsubst for Caddyfile templating
#   curl     — used by docker/detect-public-ip.sh
#   tini     — proper PID-1 for signal + zombie handling
RUN apk add --no-cache gettext curl tini

# Caddy binary from stage 2.
COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy

WORKDIR /app

# Server deps first for layer caching; production install then source copy.
COPY server/package.json server/
COPY server/bun.lockb* server/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd server && (bun install --production --frozen-lockfile || bun install --production)
COPY server/ server/

# Built frontend from stage 1.
COPY --from=web-build /web/dist /app/web

# Orchestration bits.
COPY docker/ /app/docker/
RUN chmod +x /app/docker/entrypoint.sh /app/docker/detect-public-ip.sh

# Directories Caddy + canvas expect to exist.
RUN mkdir -p /etc/caddy /data /data/caddy

# Persistent state.
VOLUME ["/data"]

# HTTPS + HTTP (LE HTTP-01 challenge). Tailscale mode uses neither externally.
EXPOSE 80 443

# tini forwards signals properly to bun.
ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
