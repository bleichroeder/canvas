# Tailscale Funnel

No port forwarding, no domain purchase. Tailscale exposes canvas at a `<hostname>.<yourtailnet>.ts.net` URL that anyone on the internet can reach. Tailscale terminates TLS with a real Let's Encrypt cert.

## What you need

- A free Tailscale account (Personal plan is fine).
- **HTTPS certificates enabled on your tailnet.**
- **Funnel enabled** in your tailnet's ACL.

Both of those are one-time tailnet settings (see setup below).

## One-time tailnet setup

**1. Enable HTTPS certificates**

Go to https://login.tailscale.com/admin/dns and click **Enable HTTPS**. Accept the disclaimer.

**2. Grant Funnel access via ACL**

Go to https://login.tailscale.com/admin/acls/file. Add a `nodeAttrs` block (alongside your existing `acls`, `groups`, etc.):

```json
"nodeAttrs": [
    { "target": ["autogroup:member"], "attr": ["funnel"] }
]
```

Save. Every human account in your tailnet can now enable Funnel on devices they own.

**3. Generate an auth key**

Go to https://login.tailscale.com/admin/settings/keys → **Generate auth key**. Set **Reusable** on, **Ephemeral** off. Copy the key (starts with `tskey-auth-`).

## Stack

Save as `docker-compose.yml`:

```yaml
services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    network_mode: "service:canvas-tailscale"
    volumes:
      - ./canvas-data:/data
    depends_on:
      - canvas-tailscale

  canvas-tailscale:
    image: tailscale/tailscale:latest
    container_name: canvas-tailscale
    hostname: canvas
    restart: unless-stopped
    environment:
      TS_AUTHKEY: ${TS_AUTHKEY:?TS_AUTHKEY required — see setup instructions}
      TS_STATE_DIR: /var/lib/tailscale
      TS_USERSPACE: "false"
      TS_SERVE_CONFIG: /config/serve.json
    volumes:
      - ./canvas-tailscale-state:/var/lib/tailscale
      - ./ts-serve.json:/config/serve.json:ro
    cap_add:
      - net_admin
      - sys_module
    devices:
      - /dev/net/tun:/dev/net/tun
```

Save as `ts-serve.json` in the same directory:

```json
{
  "TCP": {
    "443": { "HTTPS": true }
  },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": {
        "/": { "Proxy": "http://127.0.0.1:8787" }
      }
    }
  },
  "AllowFunnel": {
    "${TS_CERT_DOMAIN}:443": true
  }
}
```

Save as `.env`:

```
TS_AUTHKEY=tskey-auth-...paste-from-Tailscale-here
```

## Run

```bash
docker compose up -d
sleep 10
docker exec canvas-tailscale tailscale funnel status
```

That last command prints your public URL: `https://canvas.<yourtailnet>.ts.net`. Open it on Tesla.

## Notes

- Canvas shares Tailscale's network namespace (`network_mode: "service:canvas-tailscale"`) so the sidecar's `127.0.0.1:8787` reaches canvas directly. No published ports on the canvas container.
- Video streams from Plex to Tesla still go through the tunnel because Tesla can only reach the internet via the `.ts.net` URL. Tailscale's Funnel free-tier has a fair-use bandwidth policy — heavy streamers should check current limits.
- Auth key is single-purpose: Tailscale exchanges it for a per-device token at startup, stored in `./canvas-tailscale-state/`. You can revoke the auth key from the admin console after the device is registered; the device keeps working.
