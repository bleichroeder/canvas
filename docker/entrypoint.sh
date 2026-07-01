#!/bin/sh
# canvas Docker entrypoint. Reads deployment_config sidecar files from
# CANVAS_DATA_DIR, spawns Caddy or cloudflared per selected mode, then execs
# the Bun canvas server as the foreground process.
#
# Sidecar files (all in $CANVAS_DATA_DIR):
#   .deployment-mode         "local" | "domain" | "cf-quick" | "cf-named"
#   .deployment-domain       hostname for mode=domain
#   .deployment-admin-email  optional LE contact
#   .deployment-cf-token     token for mode=cf-named (chmod 0600)
#
# When CANVAS_EXTERNAL_PROXY=1 is set, everything below is skipped — Bun
# starts alone and users are expected to run their own reverse proxy.
set -eu

: "${CANVAS_PORT:=8787}"
: "${CANVAS_DATA_DIR:=/data}"
: "${CANVAS_EXTERNAL_PROXY:=}"

echo "[entrypoint] canvas starting…"

mkdir -p "$CANVAS_DATA_DIR/caddy"

# External-proxy escape hatch — bypass all subprocess spawning, just run Bun.
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
	MODE=$(cat "$CANVAS_DATA_DIR/.deployment-mode" 2>/dev/null || echo "local")
fi

echo "[entrypoint] mode: $MODE"

# Track child PIDs so we can shut them down cleanly on SIGTERM.
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
		# Nothing extra to spawn — Bun on 8787 is the whole story.
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
		# Give Caddy a beat to write the pidfile.
		sleep 0.3
		[ -f /tmp/caddy.pid ] && CHILDREN="$CHILDREN $(cat /tmp/caddy.pid)"
		echo "[entrypoint] Caddy started for $DOMAIN"
		;;
	cf-quick)
		echo "[entrypoint] starting cloudflared quick tunnel…"
		# Quick tunnel prints a random trycloudflare.com URL on connect. We
		# tee stdout so an awk pipe can extract the URL and write it into
		# the sidecar so Bun can pick it up and persist to deployment_config.
		(cloudflared tunnel --url "http://127.0.0.1:$CANVAS_PORT" --no-autoupdate 2>&1 \
			| tee "$CANVAS_DATA_DIR/.cloudflared.log" \
			| while IFS= read -r line; do
				printf '%s\n' "$line"
				url=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -n 1)
				if [ -n "$url" ]; then
					printf '%s' "$url" > "$CANVAS_DATA_DIR/.deployment-public-url"
				fi
			done) &
		CHILDREN="$CHILDREN $!"
		;;
	cf-named)
		TOKEN=$(cat "$CANVAS_DATA_DIR/.deployment-cf-token" 2>/dev/null || echo "")
		if [ -z "$TOKEN" ]; then
			echo "[entrypoint] ERROR: mode=cf-named but .deployment-cf-token is empty" >&2
			exit 1
		fi
		echo "[entrypoint] starting cloudflared named tunnel…"
		cloudflared tunnel --no-autoupdate run --token "$TOKEN" &
		CHILDREN="$CHILDREN $!"
		;;
	*)
		echo "[entrypoint] ERROR: unknown deployment mode: $MODE" >&2
		exit 1
		;;
esac

echo "[entrypoint] exec bun canvas server on :$CANVAS_PORT"
cd /app/server
exec bun run src/index.ts
