# syntax=docker/dockerfile:1.7
#
# canvas self-host image with bundled Caddy + cloudflared. Deployment mode
# selected at runtime via the browser wizard — see docs/deployment-modes.md.
#
# For users who prefer BYO reverse proxy: set CANVAS_EXTERNAL_PROXY=1 and
# canvas runs HTTP-only on 8787 (Caddy + cloudflared stay dormant).

# --- Stage 1: build the React frontend ---
FROM node:20-alpine AS web-build
ARG VERSION=dev
ENV VITE_CANVAS_VERSION=$VERSION
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web/ ./
RUN npm run build

# --- Stage 2: pull the Caddy binary ---
FROM caddy:2-alpine AS caddy-src

# --- Stage 3: pull the cloudflared binary ---
FROM cloudflare/cloudflared:latest AS cloudflared-src

# --- Stage 4: runtime ---
FROM oven/bun:1.3-alpine AS runtime

# gettext = envsubst (Caddyfile templating); tini = PID 1 signal handling.
RUN apk add --no-cache gettext tini

# YouTube source deps:
#  - ffmpeg  — remux/transcode
#  - python3 — runs the pinned yt-dlp zipapp (the standalone yt-dlp binary is
#              glibc-only; Alpine is musl, so we use the zipapp on system python3)
#  - nodejs  — JS runtime yt-dlp needs to solve YouTube's signature/n-param;
#              without it many videos fail "This video is not available".
#              (Deno is yt-dlp's default but is glibc-only — hence Node here.)
# Bump YTDLP_VERSION to update the extractor when a YouTube change breaks it.
ARG YTDLP_VERSION=2026.08.19
RUN apk add --no-cache ffmpeg python3 nodejs \
 && wget -qO /usr/local/bin/yt-dlp "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp" \
 && chmod +x /usr/local/bin/yt-dlp \
 && yt-dlp --version && ffmpeg -version | head -n1 && node --version
# Tell canvas to hand yt-dlp the Node runtime for signature solving.
ENV YT_JS_RUNTIME=node

COPY --from=caddy-src /usr/bin/caddy /usr/local/bin/caddy
COPY --from=cloudflared-src /usr/local/bin/cloudflared /usr/local/bin/cloudflared

WORKDIR /app

# Server deps first for layer caching.
COPY server/package.json server/
COPY server/bun.lockb* server/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd server && (bun install --production --frozen-lockfile || bun install --production)
COPY server/ server/

# Built frontend from stage 1 (served statically by Bun on same origin).
COPY --from=web-build /web/dist /app/web

# Orchestration bits — entrypoint + Caddyfile template.
COPY docker/ /app/docker/
RUN chmod +x /app/docker/entrypoint.sh

RUN mkdir -p /data /data/caddy
VOLUME ["/data"]

ENV CANVAS_DB_PATH=/data/canvas.db
ENV CANVAS_WEB_DIR=/app/web
ENV CANVAS_DATA_DIR=/data
ARG VERSION=dev
ENV CANVAS_VERSION=$VERSION

# 80/443 for Caddy (mode=domain); 8787 for Bun (mode=local, admin access
# regardless of mode). Cloudflared modes don't need any external ports.
EXPOSE 80 443 8787

# OCI image metadata — populates registry listings + `docker inspect`.
# VERSION + GIT_SHA are passed by the release workflow; local `docker build`
# uses the defaults, which is fine.
ARG VERSION=dev
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="canvas"
LABEL org.opencontainers.image.description="Self-hosted browser-based streaming client for in-car entertainment. Plays Plex and Flixify via a canvas + WebCodecs pipeline."
LABEL org.opencontainers.image.source="https://github.com/bleichroeder/canvas"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.vendor="bleichroeder"
LABEL org.opencontainers.image.revision="${GIT_SHA}"
LABEL org.opencontainers.image.version="${VERSION}"

ENTRYPOINT ["/sbin/tini", "--", "/app/docker/entrypoint.sh"]
