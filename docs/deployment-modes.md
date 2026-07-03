# Deployment modes

Canvas ships four modes for how it's exposed to the internet. Pick during the first-run wizard or change later at **Settings → Deployment**. All modes are managed inside canvas itself — no compose overlays or Caddyfiles to edit.

| Mode | Public URL | Setup | Best for |
|---|---|---|---|
| [Cloudflare Quick Tunnel](#cloudflare-quick-tunnel) | `<random>.trycloudflare.com` | Zero — click enable | Trying canvas out; households OK with a rotating URL |
| [Custom domain + LE](#custom-domain--lets-encrypt) | `canvas.mydomain.com` | Router forward + DNS | Users with a domain who want a stable URL |
| [Cloudflare Named Tunnel](#cloudflare-named-tunnel) | `canvas.mydomain.com` (yours, via CF) | CF account + tunnel token | Stable URL without router config |
| [Local only](#local-only) | `http://localhost:8787` | None | LAN-only setups; dev/testing |

## Cloudflare Quick Tunnel

**How it works.** Canvas runs `cloudflared` in the background with no config; Cloudflare's edge assigns your instance a random `<hash>.trycloudflare.com` subdomain and tunnels traffic to it via an outbound connection. TLS terminates at Cloudflare (real cert, no warnings). Video streams from Plex to the client still go direct via plex.direct — only API + HTML + subtitles go through CF.

**Prerequisites.** None. Container needs outbound internet.

**Trade-off.** The URL is officially "temporary." In practice it persists while cloudflared stays running, but a container restart typically produces a new URL. If you rely on an in-car bookmark, changes require re-bookmarking.

**Recommended for.** Anyone trying canvas for the first time. Households who don't mind the occasional URL rotation.

## Custom domain + Let's Encrypt

**How it works.** Canvas runs Caddy bound to ports 80 + 443. Caddy fetches a Let's Encrypt cert for the hostname you provide via ACME HTTP-01 challenge on port 80, then reverse-proxies HTTPS traffic on 443 to the Bun canvas server internally. Renewals happen automatically at ~day 60 of the 90-day cert lifetime.

**Prerequisites.**
- A domain (or a free hostname service like DuckDNS / sslip.io — see [Free hostname fallbacks](#free-hostname-fallbacks))
- DNS pointing that domain at your public IP
- Router forwarding ports 80 + 443 to the machine running canvas
- ISP not blocking inbound port 80 (some residential ISPs do — Comcast, Verizon Fios have both been reported)

**Renewals.** Fully automatic. Cert cache lives in the persistent volume at `/data/caddy/`; survives container restarts and updates.

**Recommended for.** Users with a domain who want a stable URL, no third-party dependencies (other than LE + your DNS provider).

## Cloudflare Named Tunnel

**How it works.** Same as Quick Tunnel but with a token from your Cloudflare Zero Trust dashboard. You configure the public hostname mapping (`canvas.mydomain.com`) in CF's UI; canvas just runs `cloudflared` with your token. Stable URL, no port forwarding.

**Prerequisites.**
- A free Cloudflare account
- A domain on Cloudflare DNS
- A tunnel + Public Hostname configured in CF Zero Trust dashboard pointing at `http://canvas:8787` (or whatever you set for the tunnel's origin service)
- The tunnel token (long JWT-looking string that starts with `eyJ...`)

**How to get the token.** In [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Networks → Tunnels → Create a tunnel → Cloudflared**. Name it `canvas`. On the "Install and run connector" page, copy the token. Under Public Hostname, add `canvas.yourdomain.com` → HTTP → `canvas:8787`.

**Recommended for.** Users who want the stable URL of the domain path without dealing with router port forwarding or LE renewals.

## Local only

**How it works.** No reverse proxy, no tunnel. Canvas runs Bun HTTP on port 8787. Reachable at `http://localhost:8787/` from the same machine or `http://<lan-ip>:8787/` from LAN devices.

**Caveat.** WebCodecs (canvas's video-decoding pipeline) is a **secure-context API**. It works on `localhost` (special-cased by browsers as always secure) but NOT on `http://192.168.x.x/` (plain HTTP on non-localhost). So LAN devices can access the API + frontend but video playback won't work.

**Recommended for.** Dev/testing, or single-machine setups where the browser and canvas are on the same computer.

## Free hostname fallbacks

If you want the **custom domain + LE** mode but don't own a domain, two free options paired with Caddy inside canvas:

- **sslip.io** — dashed IP hostname (e.g., `142-51-0-77.sslip.io`) resolves to that IP. Zero signup. Downside: hostname changes when your public IP rotates.
- **DuckDNS** — pick a stable name at duckdns.org (e.g., `canvas-mydomain.duckdns.org`), get a token, run an updater to keep the A record synced with your current IP. Free.

**DuckDNS caveat.** Their nameservers are periodically flaky when Let's Encrypt validates CAA records — cert issuance may fail intermittently and retry over minutes-to-hours. Not a canvas bug; DuckDNS-specific. If reliability matters, buy a real domain (~$10/yr) or use CF Named Tunnel.

## Recovery / lock-out

If you lose admin credentials AND all device sessions:

1. Stop the container: `docker stop canvas`
2. Edit the SQLite DB directly (Bun install includes the `bun:sqlite` CLI, or use any SQLite tool):
   ```bash
   docker run --rm -v canvas-data:/data alpine:latest sh -c "apk add sqlite && sqlite3 /data/canvas.db 'DELETE FROM device_sessions; UPDATE users SET password_hash=NULL WHERE role=\"admin\";'"
   ```
3. Start the container: `docker start canvas`
4. Open canvas — normally you'd redirect to `/#/sign-in`, but admin has no password. Reset via `/#/claim` using a new claim token *if* your admin was created via legacy bootstrap. For F-wizard-created admins, there's no legacy claim path; delete the admin row entirely and re-run the wizard:
   ```bash
   docker run --rm -v canvas-data:/data alpine:latest sh -c "apk add sqlite && sqlite3 /data/canvas.db 'DELETE FROM users; DELETE FROM device_sessions; DELETE FROM claim_tokens;'"
   ```
   This restores fresh-install state; the wizard will fire on next visit.

## Debugging deployment issues

Every mode logs to `docker logs canvas`. Key signals:

- **Fresh install banner** — `FIRST-RUN — no admin configured yet.` (should be gone once you complete setup)
- **Caddy cert issuance** — look for `certificate obtained` (success) or `challenge failed` (LE couldn't reach port 80)
- **Cloudflared connection** — `Registered tunnel connection` (success). Quick tunnel: `Your quick tunnel: https://<random>.trycloudflare.com`
- **`AppShell` red banner in the app** — deployment is in `failed` state, statusMessage in the banner tells you why

For LE HTTP-01 failures, the top three culprits are:
1. Router isn't forwarding port 80 (or 443) → fix router
2. Windows Firewall / iptables blocking → allow inbound 80/443
3. ISP blocking inbound port 80 → switch to CF Named Tunnel or Quick Tunnel

Deployment status is queryable without auth: `curl http://localhost:8787/api/deployment/status`.
