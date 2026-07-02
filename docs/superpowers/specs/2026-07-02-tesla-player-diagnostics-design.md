# Sub-project G: Tesla Player Diagnostics — Design

**Status:** Design approved, awaiting spec review

**Context:** Playback on the real Tesla in-car browser starts, stutters within ~seconds, dies with a "network error" (or similar) shown top-left, never recovers. Reproduces across all sources (Plex, Flixify). Does not currently reproduce on desktop. No prior debugging done — the Tesla browser has no accessible DevTools.

**Goal:** Ship diagnostics infrastructure that captures enough context from the Tesla to identify the root cause of the network error. Ships as a real end-user feature, not just David's private debugging tool. Root cause identification is in scope; the actual code fix is a separate future sub-project.

## Constraints

- **Self-hosted ethos:** no external services, no third-party SDKs. All data stays on the user's canvas server.
- **No Tesla-specific hacks:** everything must degrade gracefully in a regular desktop browser.
- **Player pipeline is untouched apart from event hooks** — this sub-project instruments, it does not refactor.

## Architecture

Two halves connected by one endpoint:

- **Client-side** — `web/src/player/diagnostics.ts` owns a bounded ring buffer of structured events. Existing player code (RangeFetcher, AutoSource, VideoSink, AudioSink, Player.tsx) emits events at key points. On a fatal error, the ring buffer + session context + error info snapshot into a JSON payload and POST to a new telemetry endpoint (with `keepalive: true` so it survives tab close). The same ring buffer feeds an on-screen overlay for live inspection inside the car.
- **Server-side** — `server/src/routes/telemetry.ts` owns `POST /api/telemetry/error` (public, no auth, rate-limited). New `error_reports` SQLite table persists the reports. Admin-only endpoints list + fetch + delete reports.
- **Admin UI** — new `Settings → Diagnostics` tab shows a paginated list of reports with a detail drawer for the full event timeline.

**Data flow for one failure:**
1. Player plays. Every meaningful event (fetch start, chunk received, backpressure pause, decoder configure, …) pushes into the ring buffer.
2. Something fails — decoder rejects a chunk, fetch times out, browser fires an uncaught error.
3. The existing `onFatal` handler in Player.tsx calls `reportFatal(err)`.
4. `reportFatal` snapshots the ring buffer + session context + error info, JSON-encodes, `fetch()` POSTs to `/api/telemetry/error`.
5. Server rate-limits + validates + inserts a row.
6. David opens `Settings → Diagnostics`, sees the trace ending with (say) `video_error{message: "..."}` after 12 successful `fetch_chunk` events and 3 `backpressure_pause` cycles.
7. That trace tells David whether the error is a decoder issue, a network stall, a memory pressure signal, or something else — enough to scope a targeted fix.

## Client-side design

### Ring buffer

- New module `web/src/player/diagnostics.ts`.
- 500-slot circular array of `{ tsMs: number, kind: string, data: object }`.
- `tsMs` is monotonic milliseconds since player boot, not wall-clock — avoids clock skew and doesn't leak local time.
- `push()` is O(1). `snapshot()` returns a fresh array copy.

### Event kinds

Each event carries only the fields listed. No URLs (stripped to hostname), no tokens, no user info.

| Kind | Fields | Emitted from |
|---|---|---|
| `session_start` | `sourceType, canvasVersion` | Player.tsx `bootSession` |
| `fetch_start` | `rangeStart, rangeEnd, hostname` | RangeFetcher.loop |
| `fetch_chunk` | `offset, size` (throttled to ~1/sec) | RangeFetcher onChunk |
| `fetch_end` | `totalBytes, durationMs, status` | RangeFetcher final |
| `fetch_error` | `message, offset, status?` | RangeFetcher onError |
| `demux_ready` | `format, videoCodec, audioCodec, tracks` | AutoSource onReady |
| `demux_error` | `message` | source adapters |
| `video_configure` | `codec, width, height, bitDepth?` | VideoSink init |
| `video_frame` | `ptsSec` (throttled to 1/sec) | VideoSink onFrame |
| `video_error` | `message` | VideoDecoder.error |
| `audio_configure` | `codec, sampleRate, channels` | AudioSink init |
| `audio_error` | `message` | AudioDecoder.error |
| `backpressure` | `direction, queueDepth` | video.ts pause/resume |
| `queue_snapshot` | `videoQueue, audioQueue, pendingV, pendingA` (throttled to 1/2sec) | Player.tsx / engine |
| `user_gesture` | `kind: play\|seek\|pause` | Player.tsx handlers |
| `stall_detected` | `silentDurationSec` | new watchdog |
| `browser_error` | `message, filename, lineno` | `window.onerror` + `unhandledrejection` |

### `reportFatal(err, extra?)`

Wired to the existing `onFatal` in Player.tsx. Fires *before* `setErrMsg` so the fatal itself is captured in the ring buffer's last few events.

1. Build payload:
   ```json
   {
     "events": [ /* ring.snapshot() */ ],
     "session": {
       "userAgent": "...",
       "viewport": { "w": 1200, "h": 800 },
       "screen": { "w": 1920, "h": 1080 },
       "connectionType": "4g" | "wifi" | undefined,
       "canvasVersion": "0.2.0",
       "sourceType": "Plex" | "Flixify" | ...
     },
     "error": {
       "message": "…",
       "kind": "video" | "audio" | "fetch" | "demux" | "browser" | "unknown",
       "stack": "..." | undefined
     }
   }
   ```
2. `fetch('/api/telemetry/error', { method: 'POST', body: JSON.stringify(payload), keepalive: true, headers: {'Content-Type': 'application/json'} })`
3. `.catch(() => {})` — never cascade a telemetry failure into a user-visible error.

### On-screen overlay

The debugging surface *inside* the car when David can't get at the admin UI.

- **Trigger:** three-tap top-right corner of the player within 1.5s. Alternative: URL param `?diag=1` opens on load.
- **Layout:** full-screen dark overlay. Top: session context (UA, viewport, source, codec configs). Middle: scrollable event timeline, newest first, format `[+12.4s] video_error message="Decoder threw at pts=8.2s"`. Bottom: `Copy JSON` + `Dismiss` buttons.
- **State:** reads from the same ring buffer as `reportFatal`. No separate state.

### Stall watchdog

New `web/src/player/watchdog.ts`:

- Tick every 2s during playback.
- Compare current audio clock to previous tick.
- If clock hasn't advanced by ≥1s across 5 consecutive ticks (10s silence) → emit `stall_detected` event.
- Does NOT fire `onFatal` — just adds to the ring buffer. The real error typically follows shortly after.

This addresses the specific symptom: playback silently degrades before the visible error, and without a watchdog we'd never see the pre-stall behavior in the trace.

## Server-side design

### Table: `error_reports`

Drizzle migration adds:

```sql
CREATE TABLE error_reports (
  id             TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  user_id        TEXT NULL,
  canvas_version TEXT,
  user_agent     TEXT,
  error_message  TEXT,
  error_kind     TEXT,
  source_type    TEXT,
  report_json    TEXT NOT NULL
);
CREATE INDEX idx_error_reports_created ON error_reports (created_at DESC);
CREATE INDEX idx_error_reports_kind_created ON error_reports (error_kind, created_at DESC);
```

- `id` is a UUIDv7 (time-sortable, useful for cursor pagination).
- `user_id` is set only when the fatal fires post-auth. Nullable — most fatals fire before or during auth-agnostic playback.
- `report_json` is the raw JSON payload from the client.

### `POST /api/telemetry/error`

- **Public** — no auth. A fatal happens *before* we know if the session is valid. Requiring auth would drop reports on expired sessions, which is exactly when they're most useful.
- **Rate limit:** 10 reports per source IP per 60s (in-memory sliding window; no Redis dep).
- **Size cap:** 256KB. Larger → 413.
- **Validation:** `zod` schema. Reject if `events.length > 1000` or required top-level fields missing → 400.
- **Response:** `{ id }` on success. `429` on rate-limit. `413` on size. `400` on schema. `204` when `TELEMETRY_ENABLED=false`.
- **Column mapping on insert:** `id` = server-generated UUIDv7; `created_at` = server-side `Date.now()` (client's `tsMs` is monotonic-since-boot and never used as wall clock); `error_kind` = payload's `error.kind`; `error_message` = payload's `error.message`; `source_type` = payload's `session.sourceType`; `canvas_version` = payload's `session.canvasVersion`; `user_agent` = payload's `session.userAgent`; `user_id` = opportunistic — if a valid auth token is on the request, record the user id; else NULL; `report_json` = the raw payload.
- **On insert:** fire-and-forget async retention prune (see next).

### Retention

New `server/src/lib/telemetry-retention.ts`:

- On every insert:
  1. Delete rows where `created_at < now - TELEMETRY_RETENTION_DAYS * 86400 * 1000`.
  2. If row count > `TELEMETRY_MAX_ROWS`, delete oldest until at cap.
- Env: `TELEMETRY_RETENTION_DAYS` (default 30), `TELEMETRY_MAX_ROWS` (default 1000).

### Admin endpoints (`server/src/routes/admin/telemetry.ts`)

- `GET /api/admin/telemetry/errors?cursor=X&kind=video&since=Y` — admin-only. Cursor pagination (25 per page). Filter by `error_kind` and since-date. Returns list of report summaries.
- `GET /api/admin/telemetry/errors/:id` — admin-only. Returns full report JSON.
- `DELETE /api/admin/telemetry/errors/:id` — admin-only. For cleaning up test data.

All admin routes protected by the existing admin-role middleware — no new auth logic.

## Admin UI

New file: `web/src/views/settings/DiagnosticsTab.tsx`, added to the existing Settings view alongside the Deployment tab.

### List view

- Filters row: kind chips (`All | Fetch | Video | Audio | Demux | Browser`) + since picker (`Last 24h | 7d | 30d | All`).
- Table columns: `Time`, `Kind` (colored chip), `Message` (truncated), `Source`, `User-Agent` (truncated). Rows are clickable.
- Cursor pagination via "Load more" button. 25 per page.
- Empty state: "No error reports yet." + one-line aside on what triggers a report.

### Detail drawer

Opens on row click, right-side slide-in ≈600px wide, list stays visible underneath.

- Header: error message + kind + created-at.
- **Session context** (collapsible, expanded by default): source type, canvas version, UA, viewport, screen, connection type.
- **Event timeline** (collapsible, expanded by default): reverse chronological (newest first, closest to the failure). Each event: `[+12.4s] video_error` on the left, JSON blob of `data` collapsed with an expand chevron. Color code by kind (fetch = blue, video/audio = amber, browser = red, backpressure = grey, everything else = neutral).
- `Copy full JSON` button (drawer top-right).
- `Delete` button (bottom, small, with confirm dialog) → `DELETE /api/admin/telemetry/errors/:id`.

### Test telemetry button

Near the top of the tab: a "Test telemetry" button that deliberately throws a browser error → generates a report → useful for verifying the pipeline works before you actually need it.

## Privacy, security, defaults

Canvas is self-hosted — the data never leaves the user's server — but a few things still deserve conscious defaults:

**Allowlist model** (blocklist would be too easy to bypass by accident when adding new events):

✅ Byte offsets, chunk sizes, HTTP status codes, timestamps, codec identifiers, queue depths, error messages, filenames + line numbers from browser errors, user-agent, viewport, screen, connection type, canvas version.

❌ Full URLs (stripped to hostname — Plex serves signed URLs with tokens). Auth tokens, cookies, session IDs. Media titles, source names, watchlist contents, user email / display name. Client IP (client doesn't send it, server doesn't record the socket IP into the row).

**`user_id`** is stored when the fatal fires post-auth, but only the internal id — not email or display name.

**No third-party outbound** — no Sentry, no Datadog, no GA. All storage is the user's own SQLite.

**`TELEMETRY_ENABLED`** env (default `true`) — disables recording entirely. Ring buffer doesn't allocate, no POST fires, endpoint returns 204. Documented in README + `docs/diagnostics.md`.

## Testing

### Server tests (bun test, `server/tests/telemetry.test.ts`)

- POST accepts valid payload, returns id, inserts row.
- POST rejects payload > 256KB → 413.
- POST rejects malformed payload → 400.
- POST rate-limits: 11th request from same IP within 60s → 429.
- POST does NOT require auth.
- Retention prune: after 1001st insert, only 1000 rows remain (newest kept).
- Retention prune: rows older than TTL are removed on insert.
- Admin GET list requires admin role.
- Admin GET list filters by kind + since.
- Admin GET :id returns full payload; 404 on unknown id.
- Admin DELETE :id removes the row.
- `TELEMETRY_ENABLED=false` → POST returns 204 without inserting.

### Ring buffer unit test

The ring buffer module is pure logic (no DOM) — testable via bun. Cover: `push`, cap behavior, `snapshot` returns copy.

### Manual web smoke checklist

The web tree has no test infrastructure. Manual verification listed in the plan:

- Admin UI list shows a report after the "Test telemetry" button.
- Drawer detail renders event timeline.
- Three-tap top-right corner opens overlay.
- `?diag=1` opens overlay on load.
- `keepalive: true` — verify DevTools shows the POST completes after navigation.

## Rollout

1. Cut `v0.2.0` with diagnostics.
2. Update David's Tesla-facing deployment.
3. Drive, trigger the failure in-car.
4. Back at desk, open `Settings → Diagnostics`, read the trace.
5. If the trace makes the root cause obvious → open a follow-up sub-project H (targeted fix).
6. If the trace has gaps → add events, ship again, re-test.

## Out of scope

- The actual player bug fix (sub-project H).
- Retry / reconnect / dismissable-error resilience (sub-project I, if we still want it after diagnosis).
- Aggregating reports across canvas instances (nope — self-hosted, each is on its own).
- Alerts / notifications on new errors (nope — David checks Diagnostics tab when investigating).
- Client-side event compression (probably not needed at ~50KB/report).
- Reproducing the bug on desktop.
- Modifying player pipeline beyond event-emission hooks.
