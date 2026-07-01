# Cloudflare Tunnel

Zero port-forwarding. Cloudflare terminates TLS at their edge and tunnels traffic to your canvas server via an outbound connection. No cert to manage, no router config.

## What you need

- A free Cloudflare account.
- A domain on Cloudflare DNS. Cloudflare's free tier is fine — buy any domain (Cloudflare Registrar sells them at cost, ~$10/yr) and point its nameservers at Cloudflare, OR use a subdomain of a domain already on CF.

## Set up the tunnel

1. Log in to Cloudflare Zero Trust: https://one.dash.cloudflare.com/
2. **Networks → Tunnels → Create a tunnel → Cloudflared**
3. Name it `canvas`, save
4. On the "Install and run connector" screen, **copy the tunnel token** (a long string beginning with `eyJ...`)
5. **Public Hostname → Add**:
   - Subdomain: `canvas`
   - Domain: pick yours from the dropdown
   - Service: `HTTP` → URL: `canvas:8787`
   - Save

## Stack

Save as `docker-compose.yml`:

```yaml
services:
  canvas:
    image: ghcr.io/dherzfeld/canvas:latest
    container_name: canvas
    restart: unless-stopped
    expose: ["8787"]
    volumes:
      - ./canvas-data:/data

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: canvas-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${CF_TUNNEL_TOKEN}
    depends_on:
      - canvas
```

Save as `.env` (same directory):

```
CF_TUNNEL_TOKEN=eyJhIjo...paste-from-CF-here
```

## Run

```bash
docker compose up -d
docker compose logs -f cloudflared
```

Once cloudflared logs `Registered tunnel connection`, your canvas is live at `https://canvas.yourdomain.com/`. Cloudflare handles the LE cert renewal cycle — you don't have to think about it.

## Notes

- Only API + HTML traffic passes through CF's edge. Video streams direct from Plex to Tesla via plex.direct (Plex's own TLS), bypassing CF entirely. Your CF bandwidth stays tiny.
- If you want a custom subdomain later, edit the Public Hostname mapping in the CF Zero Trust dashboard — no docker restart needed.
- Cloudflare Tunnel free tier is generous but not unlimited; heavy production use should check their fair-use policy.
