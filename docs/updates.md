# Updates

Canvas installs new versions via a companion [Watchtower](https://containrrr.dev/watchtower/) container that pulls the latest image from `ghcr.io/bleichroeder/canvas` and recreates the canvas container in place. Data persists across updates via the `canvas-data` Docker volume.

## v0.10.0+ update flow (click-to-update)

Watchtower runs in **HTTP API mode** — it does not poll on a schedule. Canvas is in charge of when to trigger updates. Two paths:

- **Click-to-update (default).** Canvas checks GitHub Releases every 15 minutes. When a new version is available, Settings → About shows an **Update now** button. Click it to trigger the update.
- **Auto-update (opt-in).** Flip the **Auto-update** switch in Settings → About. Canvas will call Watchtower automatically the moment a new version is detected on the 15-minute tick.

Either way, canvas restarts within ~10 seconds after the trigger. If you're using Cloudflare Quick Tunnel, expect a new public URL after each restart — canvas surfaces the new URL in Settings → Deployment.

## First-time setup

Generate a shared secret for canvas ↔ Watchtower:

```bash
openssl rand -hex 32
```

Save it in a `.env` file alongside your `docker-compose.yml`:

```
WATCHTOWER_HTTP_API_TOKEN=<paste-your-token-here>
```

See `.env.example` at the repo root for the template.

Bring canvas up:

```bash
docker-compose up -d
```

Verify both services are healthy:

```bash
docker-compose ps
```

Verify the click-to-update flow: open canvas, go to **Settings → About**. The Updates card should show the auto-update toggle and (when applicable) the Update now button.

## Migrating from v0.9.x

Existing v0.9.x installs have Watchtower running in auto-polling mode. Migration is opt-in and non-breaking — v0.9.x → v0.10.0 auto-updates one last time before you switch modes.

1. **Wait for canvas to auto-update to v0.10.0.** Watchtower will pull it within ~5 minutes on its normal poll cycle.
2. **After v0.10.0 is running**, open Settings → About. You'll see a warning: *"Watchtower's HTTP API is unreachable — Update your compose per docs/updates.md."*
3. **Generate a token:**
   ```bash
   openssl rand -hex 32
   ```
4. **Create `.env` next to your `docker-compose.yml`:**
   ```
   WATCHTOWER_HTTP_API_TOKEN=<paste-your-token>
   ```
5. **Update your `docker-compose.yml`** to match the current version at `https://github.com/bleichroeder/canvas/blob/main/docker-compose.yml` (or edit in place: remove `WATCHTOWER_POLL_INTERVAL`, add `WATCHTOWER_HTTP_API_UPDATE: "true"` and `WATCHTOWER_HTTP_API_TOKEN: "${WATCHTOWER_HTTP_API_TOKEN:?...}"` to Watchtower, and `WATCHTOWER_URL` + `WATCHTOWER_TOKEN` to canvas).
6. **Recreate:**
   ```bash
   docker-compose up -d
   ```
7. Refresh Settings → About. The warning should be gone; toggle + button are live.

You can keep running on v0.9.x-style auto-polling indefinitely if you prefer — canvas will still function, only the click-to-update UI features are disabled until you migrate.

## Manual updates

Once click-to-update is set up, updates happen entirely from the UI:

1. Open canvas → Settings → About.
2. If an update is available, an **Update now** button appears.
3. Click it, confirm the dialog. Canvas restarts within ~10 seconds.

## Auto-update

Prefer canvas to update itself the moment a new version is out? Flip the **Auto-update** switch in Settings → About. Canvas polls GitHub every 15 minutes and calls Watchtower automatically when a new tag is detected.

**Caveat:** if you're on Cloudflare Quick Tunnel, auto-updates will silently change your public URL. Users with bookmarked URLs won't know until they visit canvas from a device on the same LAN (which shows the current URL in Settings → Deployment). If URL stability matters, use **Cloudflare Named Tunnel** instead.

## Rollback

Pin a specific version in your `docker-compose.yml`:

```yaml
services:
  canvas:
    image: ghcr.io/bleichroeder/canvas:0.9.2
```

Then `docker-compose up -d`. Watchtower still ignores anything without the `com.centurylinklabs.watchtower.enable=true` label, and the pinned image will only update when you change the tag manually.

## Troubleshooting

**"Watchtower unreachable" persists after migration.**
- Check both services are running: `docker-compose ps`.
- Check Watchtower's logs for token misconfiguration: `docker logs canvas-watchtower`.
- Verify `WATCHTOWER_HTTP_API_TOKEN` is set: `docker-compose config | grep WATCHTOWER`.

**Update button clicked but canvas didn't restart.**
- Check canvas logs immediately after clicking: `docker logs canvas`. A successful trigger logs "auto-update: triggering watchtower" or the manual endpoint logs a 202.
- Check Watchtower logs: `docker logs canvas-watchtower`. It should log the update attempt.
- If Watchtower's log says "no session token" or similar auth error, the token in canvas' env doesn't match Watchtower's env. Verify both reference the same `${WATCHTOWER_HTTP_API_TOKEN}`.
