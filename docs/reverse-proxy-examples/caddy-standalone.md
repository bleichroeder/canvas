# Caddy as a sidecar

Adds a Caddy container in front of canvas. Caddy handles automatic Let's Encrypt cert issuance + HTTPS termination + gzip. Nice defaults, minimal config.

## What you need

- **Ports 80 + 443 forwarded on your router** to the machine running canvas.
- **A hostname**. Options, cheapest to most stable:
  - `sslip.io` (free, no signup, but derived from your public IP — hostname changes if your IP changes)
  - `DuckDNS` (free, signup, stable name like `dave-canvas.duckdns.org` — pair with a small updater container if your IP is dynamic)
  - Your own domain (whatever, `canvas.mydomain.com`)

## Stack

Save as `docker-compose.yml` (replaces the bare one from the repo root):

```yaml
services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    expose: ["8787"]
    volumes:
      - ./canvas-data:/data

  caddy:
    image: caddy:2-alpine
    container_name: canvas-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy-data:/data
      - ./caddy-config:/config
    depends_on:
      - canvas
```

## Caddyfile

Save as `Caddyfile` in the same directory. Replace the hostname with whatever you picked:

```
canvas.mydomain.com {
    reverse_proxy canvas:8787
    encode gzip
}
```

sslip.io flavor (no domain purchase — replace `142-51-0-77` with your public IP dashed):

```
142-51-0-77.sslip.io {
    reverse_proxy canvas:8787
    encode gzip
}
```

## Run

```bash
docker compose up -d
docker compose logs -f canvas-caddy
```

Watch for `certificate obtained`. Then open your hostname in Tesla.

## Notes

- Caddy persists issued certs at `./caddy-data/`. Container recreation preserves them.
- If LE fails with `challenge failed`, port 80 isn't reachable from the internet. Check router port-forwarding + your ISP's stance on inbound port 80 (some residential ISPs block it — use the Cloudflare Tunnel or Tailscale Funnel recipe instead).
- To use LE staging while iterating (untrusted cert, no rate limit), add `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` inside a global block at the top of the Caddyfile.
