# Reverse-proxy recipes

Canvas ships as HTTP-only on `:8787`. These recipes get HTTPS in front of it. Pick whichever fits your setup — all assume canvas is already running from the repo-root `docker-compose.yml` (or you add these services alongside).

| Recipe | Requires | Best when |
|---|---|---|
| [Caddy standalone](caddy-standalone.md) | Ports 80 + 443 forwardable to your machine | You want auto-TLS via Let's Encrypt + a clean Caddyfile |
| [Cloudflare Tunnel](cloudflare-tunnel.md) | Free CF account + a domain on CF DNS | You can't (or don't want to) forward ports |
| [Tailscale Funnel](tailscale-funnel.md) | Free Tailscale account | You already live in Tailscale, or your ISP blocks port 80 |

If you're already running nginx / Traefik / HAProxy / whatever, canvas is just an HTTP upstream on port 8787 — point your existing proxy at it. The three recipes above cover the common "starting from scratch" cases.

## Local testing

You don't need any of these for local development. Canvas works fine over HTTP on `localhost` because browsers treat `localhost` as a secure context. Real deployments — in-car browser, phone off wifi, another room's laptop — require the HTTPS setup covered by the recipes.
