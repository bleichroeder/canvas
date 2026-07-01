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
export CANVAS_PORT CANVAS_DB_PATH CANVAS_ADMIN_EMAIL

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
		cache="/data/detected-ip.txt"
		if [ -f "$cache" ] && ip=$(cat "$cache" 2>/dev/null) && [ -n "$ip" ]; then
			echo "[entrypoint] cached public IP: $ip (rechecking in background)"
			(
				fresh=$(/app/docker/detect-public-ip.sh 2>/dev/null || true)
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
				echo "  Or use docker-compose.tailscale.yml for tunnel-based access" >&2
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
mkdir -p /etc/caddy /data /data/caddy
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
	if [ -n "${CANVAS_LOCAL_TLS:-}" ] && [ "$CANVAS_LOCAL_TLS" != "0" ]; then
		# Local-test mode — bind Caddy to `localhost` so the browser can hit
		# https://localhost:<port>/ directly. Caddy auto-uses its internal CA
		# for `localhost` (special-cased); browser shows a click-through cert
		# warning. No ACME involved.
		cat > /etc/caddy/Caddyfile <<EOF
{
	storage file_system /data/caddy
}

localhost {
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
		echo "[entrypoint] using Caddy internal CA for localhost (local test mode)"
		echo "[entrypoint] Canvas is ready at: https://localhost/  (accept the browser cert warning)"
	else
		if [ -n "$CANVAS_LE_STAGING" ] && [ "$CANVAS_LE_STAGING" != "0" ]; then
			export CANVAS_LE_STAGING_LINE="acme_ca https://acme-staging-v02.api.letsencrypt.org/directory"
			echo "[entrypoint] using Let's Encrypt STAGING (untrusted cert, no rate limit)"
		else
			export CANVAS_LE_STAGING_LINE=""
		fi
		envsubst < /app/docker/Caddyfile.template > /etc/caddy/Caddyfile
		echo "[entrypoint] Canvas is ready at: https://${CANVAS_HOSTNAME}/"
	fi
fi

# ---------- Service startup ----------
caddy start --config /etc/caddy/Caddyfile --pidfile /tmp/caddy.pid
sleep 0.5

shutdown() {
	echo "[entrypoint] shutting down…"
	caddy stop --pidfile /tmp/caddy.pid 2>/dev/null || true
	exit 0
}
trap shutdown TERM INT

cd /app/server
exec bun run src/index.ts
