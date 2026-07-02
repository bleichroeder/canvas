# Diagnostics

Canvas records structured player events in-browser and uploads a report to your canvas server if playback fails. Reports live on your own SQLite database — nothing goes to Anthropic, Sentry, or any third party.

## What's collected

- **Ring buffer** (500 events, in memory): fetch progress, decoder configuration, backpressure, stall detection, browser errors.
- **Session context**: user-agent, viewport, screen, connection type (2g/3g/4g/wifi), canvas version, source type.
- **The error itself**: message, kind (fetch/video/audio/demux/browser), stack trace.

## What is NOT collected

- Full URLs (only the hostname is recorded — media URLs contain tokens).
- Auth tokens, cookies, session IDs.
- Media titles, source names, watchlist contents, user email or display name.
- Client IP addresses.

## Viewing reports

Admin → **Settings → Diagnostics**. Table of recent reports; click a row for the full event timeline.

## On-screen overlay (in the car)

Two ways to open the live event overlay without needing the admin UI:

- Triple-tap the top-left corner of the player within 1.5 seconds.
- Add `?diag=1` to the URL and reload.

## Configuration

| Env var | Default | Meaning |
| --- | --- | --- |
| `TELEMETRY_ENABLED` | `true` | Set to `false` to disable recording + uploads entirely. |
| `TELEMETRY_RETENTION_DAYS` | `30` | Reports older than this are pruned on every insert. |
| `TELEMETRY_MAX_ROWS` | `1000` | Global cap. When exceeded, oldest reports are pruned. |

> **Note:** `TELEMETRY_ENABLED=false` disables **new** recording only — existing rows persist in the database until you delete them via the admin UI or directly in the DB.

### Deployment note

Rate limiting keys off the `X-Forwarded-For` header. This is trustworthy when canvas is behind a reverse proxy (Caddy or cloudflared, the default self-hosting path) because the proxy sets the header to the real client IP. If you expose the canvas container directly to the internet — without a proxy in front — an attacker can spoof `X-Forwarded-For` and bypass the rate limit. In that configuration you should set `TELEMETRY_ENABLED=false` or firewall the telemetry endpoint to trusted networks.

## Disabling for one session

If you don't want a specific playback session tracked:

- `?diag=off` in the URL, OR
- `localStorage.setItem('canvas.diag.disabled', '1')` in the browser console.
