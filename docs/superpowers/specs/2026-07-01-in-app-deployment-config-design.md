# In-App Deployment Config Design (sub-project F)

**Status:** Draft 2026-07-01. Reverses C.1's unbundling — but as a proper design, not a repeat of C+D's env-var soup. Adds an in-app browser wizard for choosing how canvas is exposed to the internet, with a Cloudflare Quick Tunnel option that requires no external accounts.

**Motivation:** After C.1 stripped TLS entirely, the "just spin it up" story collapsed — every user has to grok reverse-proxy recipes, edit `Caddyfile`s, forward router ports, potentially buy a domain. Real self-hosted apps in the polished class (Nextcloud AIO, Home Assistant OS, Ghost) offer UI-driven deployment configuration; canvas should too.

**Design principle:** the reverse-proxy is bundled again, but as a *managed dependency*, not a first-class module. Users configure it through a UI. Advanced users can opt out entirely via one env var and BYO proxy.

## User-visible flow

**Fresh install (target UX):**

```bash
docker run -d -p 80:80 -p 443:443 -p 8787:8787 -v canvas-data:/data ghcr.io/dherzfeld/canvas:latest
```

1. User opens `http://localhost:8787/` in a browser
2. **Setup wizard fires** (no admin exists yet → localhost bootstrap allowed)
   - **Step 1:** Create admin account — username + password
   - **Step 2:** Pick how canvas is exposed — 4 options:
     - **Local only** — HTTP on 8787, works on LAN via `http://<lan-ip>:8787/`
     - **Domain + Let's Encrypt** — provide `canvas.mydomain.com`, requires ports 80/443 forwarded, Caddy auto-issues cert
     - **Cloudflare Quick Tunnel** — one click, no signup, canvas gets `<random>.trycloudflare.com` URL immediately
     - **Cloudflare Named Tunnel** — paste tunnel token from CF dashboard, use your own domain via CF
   - **Step 3:** Applying — container restarts, shows spinner + progress ("obtaining certificate", "connecting tunnel", etc.)
   - **Step 4:** Done — shows the public URL as a clickable link. User bookmarks and moves on.
3. Sign in with admin username + password → land in canvas Home (empty)
4. Pair Plex source, add family users, etc. — normal canvas flow from here.

**Later reconfiguration** — Settings → Deployment lets admin change mode anytime. Same 3-step apply flow.

**Recommendation flow:** the wizard defaults to **Cloudflare Quick Tunnel** as the "just work" pick. Fine print explains the URL is not permanent (may change on container restarts). Users bookmark it and enjoy; if they want a stable URL later, they can switch to Domain + LE or Named Tunnel from Settings → Deployment.

## Image contents

- Bun canvas server (existing)
- Built React frontend (existing)
- **Caddy binary** (re-bundled, ~30 MB compressed)
- **cloudflared binary** (~35 MB compressed)
- tini as PID 1 (existing)

Expected image size: ~170–200 MB compressed. Trade-off vs C.1's 123 MB is justified by the UX gain.

**Not bundled:** `tailscaled`. Requires `NET_ADMIN` capability + `/dev/net/tun` device, which breaks the "just `docker run`" ideal. Tailscale Funnel remains available via the existing sidecar recipe in `docs/reverse-proxy-examples/`.

## Deployment modes

### Mode `local`

Default. Only Bun runs. HTTP on 8787. Suitable for:
- LAN-only setups (browser on same machine or LAN device)
- Testing / development
- Users who intend to configure a mode later but want to explore first

WebCodecs works because `localhost` is a secure context. LAN device access (via `http://192.168.x.x:8787/`) is *not* a secure context — WebCodecs will fail, video won't play. Documented in the wizard.

### Mode `domain`

Caddy binds `:80` (LE HTTP-01 challenge + HTTPS redirect) and `:443` (canvas). Bun on internal `127.0.0.1:8787`. Caddyfile rendered at container start from the user's saved domain.

Prerequisites: user's public DNS points at their machine's IP, router forwards 80/443 in.

### Mode `cf-quick` (Cloudflare Quick Tunnel)

`cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate` runs as a subprocess. No token, no account, no domain. Cloudflare assigns a `<random>.trycloudflare.com` URL on connect, prints it to stdout. Entrypoint captures the URL and writes it to `deployment_config.public_url`. Bun reads it and shows to the user.

**Known limitation:** trycloudflare.com URLs are officially "temporary." In practice they persist while the cloudflared process runs continuously; a container restart typically produces a new URL. Wizard explicitly warns.

### Mode `cf-named` (Cloudflare Named Tunnel)

`cloudflared tunnel --no-autoupdate run --token <user-supplied-token>`. User provides the token from their CF Zero Trust dashboard. Canvas doesn't touch DNS — user configures the public hostname mapping in the CF dashboard itself (Public Hostname → HTTP → `canvas:8787`).

Wizard shows a link to CF's tunnel creation page + instructions for how to grab the token.

### Escape hatch — `CANVAS_EXTERNAL_PROXY=1`

Env var passed to the container. When set:
- Entrypoint skips all Caddy / cloudflared subprocess spawning
- Bun runs on 8787 as the sole process
- Deployment wizard hidden (Settings → Deployment shows "Managed externally" note)
- User is expected to run their own reverse proxy separately

Preserves the C.1 unbundled model for anyone who wants it. Documented in README.

## Schema

Migration `0003_deployment_config.sql`:

```sql
CREATE TABLE deployment_config (
  id                 INTEGER PRIMARY KEY CHECK (id = 1),  -- singleton
  mode               TEXT    NOT NULL DEFAULT 'local'
                        CHECK (mode IN ('local', 'domain', 'cf-quick', 'cf-named')),
  domain             TEXT,                -- for mode='domain'
  admin_email        TEXT,                -- optional LE contact
  cf_named_token     TEXT,                -- for mode='cf-named'
  public_url         TEXT,                -- populated at runtime; for cf-quick + display
  status             TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'applying', 'ready', 'failed')),
  status_message     TEXT,                -- last event or error
  cert_expires_at    INTEGER,             -- Unix epoch, for LE certs
  last_applied_at    INTEGER              -- Unix epoch, last successful apply
);

INSERT INTO deployment_config (id, mode, status) VALUES (1, 'local', 'ready');
```

Singleton (only one row, ever). `INSERT` at migration time seeds the default local mode so the row always exists.

## API surface

**Admin endpoints (require admin bearer):**

```
GET  /api/admin/deployment
     → { mode, domain, admin_email, public_url, status, status_message,
         cert_expires_at, last_applied_at, has_cf_named_token: boolean }
     Notes: cf_named_token itself is NEVER returned — only a "yes/no" flag

POST /api/admin/deployment
     Body: { mode, domain?, admin_email?, cf_named_token? }
     → 204
     Side effect: writes new config, triggers container restart after 2s delay
                   (giving the response time to reach the client)

POST /api/admin/deployment/apply
     → 204
     Side effect: triggers container restart immediately (used from wizard)
```

**Unauthenticated endpoints:**

```
GET  /api/deployment/status
     → { mode, status, public_url }
     Purpose: wizard polls this during the "applying" spinner; safe to expose
              since it reveals no secrets, only public info
```

**First-run bootstrap (localhost-only):**

```
POST /api/setup
     Preconditions: no admin user exists in the DB AND request originates
                    from 127.0.0.1 or ::1 (checked via c.req.raw remote or
                    trusted-loopback middleware)
     Body: { adminUsername, adminPassword, deployment: { mode, ... } }
     → { publicUrl, adminBearer }
     Side effect: creates admin, writes deployment_config, triggers restart
```

The localhost-only guard is critical — this endpoint lets someone create an admin without any credentials. Anyone who has HTTP access to canvas from a loopback address is trusted (same posture Docker uses for its own API). If the user has exposed canvas externally *before* creating admin, that's their problem — the entrypoint prints a big warning banner in local mode saying "not yet configured, do not expose externally."

## Restart-triggered reconfiguration

Not runtime hot-reload. When user saves new deployment settings:

1. Bun writes to `deployment_config` in SQLite
2. Bun sends `SIGTERM` to PID 1 (tini) via `process.kill(1, 'SIGTERM')`
3. tini gracefully stops Bun + any subprocesses
4. Container exits with code 0
5. Docker's `restart: unless-stopped` policy relaunches the container
6. Entrypoint reads new `deployment_config`, starts appropriate services
7. Client polls `GET /api/deployment/status` until `status === 'ready'`, then redirects to new URL

Expected downtime: 3–5 seconds for `local` / `cf-*` modes, 15–30 seconds for `domain` mode (LE issuance). Wizard shows a spinner and progress messages during this window.

**Users who don't set restart policy:** Docker won't auto-restart; canvas stays down until they run `docker start canvas` manually. Wizard docs mention this and the README's install command includes `--restart unless-stopped` prominently.

## Entrypoint responsibilities

New `docker/entrypoint.sh`:

1. Wait briefly for `/data/canvas.db` to be readable (Bun-created on first ever boot)
2. Read `deployment_config` mode via a small `bun -e "…"` snippet OR keep a "current-mode" plaintext file at `/data/.deployment-mode` written by Bun on save
3. If `CANVAS_EXTERNAL_PROXY=1` → skip to step 6 (just start Bun)
4. Based on mode, spawn appropriate subprocess:
   - `local` → nothing extra
   - `domain` → render Caddyfile with domain, start Caddy in background
   - `cf-quick` → start `cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate`, capture stdout in a fifo, background parser writes public URL back to `deployment_config`
   - `cf-named` → start `cloudflared tunnel --no-autoupdate run --token <token>` with token from `deployment_config`
5. Set trap so SIGTERM stops all subprocesses cleanly before exiting
6. `exec` Bun in foreground (PID inherited so Bun is the "main" process)

The plaintext `/data/.deployment-mode` sidecar file is simpler than shelling out to Bun for a DB read at boot. Bun writes it whenever config changes; entrypoint just reads.

## Frontend

### Router additions

- `/#/setup` — first-run wizard, publicly accessible (guarded by "is there an admin yet?" check)
- `/#/admin/deployment` — Settings → Deployment page

### Setup wizard (`views/Setup.tsx`)

Three steps in one component:

**Step 1: Create admin**
- Username input (min 2, max 32 chars, unique)
- Password input (min 8 chars) + confirm
- On submit → `POST /api/setup` with just username/password/mode=local
- Local state advances to step 2

**Step 2: Pick deployment mode**
- Four radio-button cards:
  - "Cloudflare Quick Tunnel — recommended" (selected by default)
    - Description: no signup, gets a random URL, may change on restarts
  - "Custom domain — my URL"
    - Domain input, admin_email input
    - Requires ports 80/443 forwarded (docs link)
  - "Cloudflare Named Tunnel — my domain via CF"
    - Token textarea (paste from CF dashboard)
    - Docs link to CF tunnel-creation page
  - "Local only — advanced"
    - Description: canvas stays on 8787, only reachable on your LAN or localhost
- On submit → `POST /api/admin/deployment` with the chosen mode + fields
- Wizard shows "Applying..." spinner + polls `GET /api/deployment/status` every 2s

**Step 3: Done**
- Shows the public URL as a large clickable link with "Sign in →" button
- Copy-to-clipboard button
- Note: "Save this URL — you'll enter it on your Tesla to access canvas"
- Continue → `/#/sign-in`

### Settings → Deployment page (`views/DeploymentTab.tsx`)

Admin-only. Shows current mode + status. Same 4-mode picker as wizard step 2. On save, warns "This will restart canvas for ~10 seconds. Proceed?" Confirm → restart cycle.

Status panel shows:
- Current mode + public URL
- Last successful apply time
- (For `domain` mode) Cert expiry date + renewal status
- (For `cf-*` modes) Tunnel connection status

### Header banner

When `status === 'failed'`, show a red banner across the top: "Deployment error: <status_message>. Fix in Settings → Deployment."

## Docs

README rewrites again — this time the quickstart really is one command:

```bash
docker run -d --restart unless-stopped \
  -p 80:80 -p 443:443 -p 8787:8787 \
  -v ~/canvas-data:/data \
  ghcr.io/dherzfeld/canvas:latest

# Then open http://localhost:8787/ and follow the wizard
```

Reverse-proxy-examples/ stays for advanced users but demoted from primary flow. New docs page: `docs/deployment-modes.md` explaining the four modes in more depth for anyone who wants to understand.

## Success criteria

1. Fresh `docker run` starts, admin claim token generation is SUPPRESSED (no more banner spam), user goes straight to wizard
2. Wizard step 1 creates admin, request from localhost accepted, non-localhost 403
3. Wizard step 2 picks `cf-quick`, container restarts, cloudflared spawns, URL captured within 10s, wizard advances
4. Wizard step 3 shows public trycloudflare.com URL, opening it from another network reaches canvas
5. Switching to `domain` mode from Settings → LE cert issued within 30s, HTTPS URL reachable
6. Switching to `local` mode disables Caddy + cloudflared, canvas at 8787 only
7. `CANVAS_EXTERNAL_PROXY=1` bypasses all of this — canvas is HTTP on 8787, wizard hidden, deployment settings show "External"
8. All existing 185 server tests pass; new deployment tests added
9. Container image size < 220 MB compressed
10. Docker restart cycle completes end-to-end in < 20s for cf-quick mode, < 40s for domain mode (with LE issuance)

## Out of scope

- Bundled tailscaled (needs container caps; stays as sidecar recipe)
- Runtime hot-reload of Caddy config (restart is fine given how rarely reconfig happens)
- Deployment-mode webhooks / external integrations
- Multi-domain / SNI-based routing (single hostname per deployment)
- Custom Caddy plugins (stock caddy:2 only)
- Docker Swarm / Kubernetes considerations
- Reversing the admin bootstrap to require a claim token from localhost too (localhost bootstrap is intentional — matches Docker's own trust model)
- DDNS updater bundled (users still need external DDNS if their ISP is dynamic-IP + domain mode)
