# Updates

Canvas auto-updates via [Watchtower](https://containrrr.dev/watchtower/), bundled in the `docker-compose.yml` at the repo root.

## How it works

- Watchtower polls `ghcr.io/bleichroeder/canvas` every 5 minutes.
- When it sees a newer image than the currently-running one, it pulls the image, stops the canvas container, and starts a new one from the new image.
- Only containers explicitly labeled `com.centurylinklabs.watchtower.enable=true` are watched. Watchtower will not touch other containers on your host.
- The canvas data volume (`canvas-data`) persists across updates. Users, sources, and error reports are preserved.

## Viewing update status in canvas

Sign in as admin → **Settings → About**. The "Updates" card shows:

- Current running version.
- Latest published version (if newer than current).
- Release notes for the latest version.
- A hint that Watchtower will apply the update within 5 minutes.

## Disabling auto-updates

Remove the `watchtower` service from your `docker-compose.yml`, then:

```
docker-compose up -d
```

Canvas continues running. You'll need to update manually — see below.

## Triggering an update manually

Whether or not Watchtower is running:

```
docker-compose pull canvas
docker-compose up -d canvas
```

Watchtower will pick up the change on its next poll if it's still enabled.

## Rolling back to an older version

Pin canvas to a specific tag in your compose file:

```yaml
services:
  canvas:
    image: ghcr.io/bleichroeder/canvas:0.6.0
    # rest unchanged
```

Then:

```
docker-compose up -d canvas
```

Note: if the old version has DB schema older than your `canvas-data`, migrations only go forward. Rolling back may break if newer schema is required for the DB to load. Test rollbacks against a fresh volume if you're worried.

## Direct-Docker deployment (skipping compose)

If you're running canvas via plain `docker run` instead of compose, updates are your responsibility:

```
docker pull ghcr.io/bleichroeder/canvas:latest
docker rm -f canvas
docker run -d --restart unless-stopped --name canvas \
  -p 8787:8787 -p 80:80 -p 443:443 \
  -v canvas-data:/data \
  ghcr.io/bleichroeder/canvas:latest
```

This works but you don't get auto-updates. Watchtower can still work with `docker run` deployments — see [Watchtower docs](https://containrrr.dev/watchtower/).

## Migrating from an older canvas deployment

If you used an earlier `docker-compose.yml` (pre-v0.8.0) with a bind-mount data directory like `./canvas-data:/data`, the new compose file uses a named Docker volume instead. To carry your existing data across:

```
# Stop the old deployment
docker-compose down

# Copy bind-mounted data into the named volume canvas will now use
docker run --rm \
  -v "$(pwd)/canvas-data:/src:ro" \
  -v canvas-data:/dst \
  alpine sh -c "cp -a /src/. /dst/"

# Bring the new compose file up
docker-compose up -d
```

If you were running canvas via plain `docker run -v canvas-data:/data …`, your named `canvas-data` volume is already picked up automatically — the new compose file declares the volume with `name: canvas-data` to preserve the literal name. No migration needed.
