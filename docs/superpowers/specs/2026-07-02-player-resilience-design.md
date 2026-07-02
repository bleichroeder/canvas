# Sub-project H: Player Resilience — Design

**Status:** Design approved, awaiting spec review

**Context:** Sub-project G shipped diagnostics that immediately identified the root cause of the mid-playback "network error." A concurrent-loop bug in `RangeFetcher.resume()` spawns a second HTTP fetch on every backpressure resume, causing Plex to drop connections. This sub-project fixes that bug and adds fetch-retry resilience so transient network errors (Tesla cellular blips, brief Plex hiccups) no longer kill playback. Two small UX tidies land alongside.

**Goal:** Playback runs continuously against Plex without a fatal `network error` and survives at least one transient network blip via retry. Diagnostics trace shows a clean single `fetch_start` per session.

## Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.3.0` when all four fixes are merged and the smoke passes.
- **No new deps.** Everything is in-tree edits.
- **Server code is NOT touched.** Client-only fix.
- **RangeFetcher's reader-pause design is preserved** — the paused branch of `loop()` at lines 102-113 is already correct. We fix `resume()`, not the pause mechanism.
- **Retry emits a diagnostics event** (`fetch_retry`) so recovery is visible in the trace, not silent.

## Four fixes

### Fix 1 — `RangeFetcher.resume()` double-loop bug (root cause)

**File:** `web/src/player/range-fetcher.ts`, line 51.

**Change:**

```typescript
// Before
resume(): void { if (this.running && this.paused) { this.paused = false; void this.loop(); } }

// After
resume(): void { if (this.paused) this.paused = false; }
```

The original `void this.loop()` call spawned a second concurrent fetch, racing the first for `this.offset` and `this.controller`. The existing `await new Promise` block in `loop()` (lines 105-111) polls `this.paused` on a 200ms tick and resolves when the flag flips false — no re-invocation needed.

Also dropping `this.running` from the condition: nothing except `start()` sets `paused=false`, and `start()` calls `loop()` which sets `running=true` before entering the paused branch. If we're paused, we're running.

**Verification:** the diagnostics trace should show exactly one `fetch_start` per playback session. Backpressure pause/resume cycles produce zero additional `fetch_start` events.

### Fix 2 — Fetch retry on transient network errors

**File:** `web/src/player/range-fetcher.ts`, refactor `loop()`.

**Behavior:**

- **Retry** on transient errors: fetch reject (TypeError from network layer), reader.read() throw, "response has no body" throw.
- **Do NOT retry** on:
  - `AbortError` — user-initiated (seek, dispose). Propagate silently.
  - HTTP status ≥ 400 — auth, not-found, server errors. Retrying won't help; propagate.
- **Max attempts:** 4 total (1 original + 3 retries).
- **Backoff:** 200ms, 500ms, 2000ms. Total worst-case ≈ 2.7s before giving up.
- **State persistence across attempts:** `this.offset` continues to reflect bytes consumed. Retry sends `Range: bytes=<current-offset>-`, so bytes already delivered are not re-delivered (server responds 206, or if Plex transcoder ignores range then 200 from full file — which the current code already handles).

**New diagnostics event:**

```typescript
emit('fetch_retry', {
  attempt: number,             // 1-based (first retry = 1)
  delayMs: number,             // how long we waited before this attempt
  reason: sanitizeMessage(lastError.message),
});
```

Emitted BEFORE the retry attempt. The Diagnostics tab renders it inline with the event timeline so recovery is legible: `fetch_error → fetch_retry(attempt:1) → fetch_start → …`.

**Implementation shape** (illustrative):

```typescript
private async loop(): Promise<void> {
  const RETRY_DELAYS_MS = [200, 500, 2000]; // for attempts 2, 3, 4
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (!this.running) return;
    if (attempt > 0) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1]!;
      emit('fetch_retry', {
        attempt,
        delayMs,
        reason: sanitizeMessage(lastError?.message ?? 'unknown'),
      });
      await new Promise<void>((r) => setTimeout(r, delayMs));
      if (!this.running) return;
    }
    try {
      await this.attemptFetch();
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      lastError = e as Error;
      if (this.lastStatus >= 400) break; // non-retryable
    }
  }

  this.running = false;
  if (lastError) {
    emit('fetch_error', {
      message: sanitizeMessage(lastError.message),
      offset: this.offset,
      status: this.lastStatus,
    });
    this.onError(lastError);
  }
}

private async attemptFetch(): Promise<void> {
  // Existing body of loop(): AbortController, fetch(), response validation,
  // reader loop with paused-await, fetch_end emit on clean completion.
  // Any exception bubbles up to the retry loop above.
}
```

**Add `fetch_retry` to the diagnostics event kinds documentation** (docs/diagnostics.md's implicit event list) and the DiagnosticsOverlay's `KIND_COLOR` map (color: default or warning).

### Fix 3 — Diagnostics hotspot re-placement

**File:** `web/src/views/Player.tsx`.

**Change:** the invisible hotspot div (at the bottom of the returned JSX):

```typescript
// Before
style={{ position: 'fixed', top: 0, right: 0, width: 100, height: 100, zIndex: 9998 }}
// After
style={{ position: 'fixed', top: 0, left: 0, width: 100, height: 100, zIndex: 9998 }}
```

Player controls (close, back, seek) live on the right side of the viewport, so top-LEFT is safe. Three-tap gesture and 1.5s window unchanged.

**Docs update:** `docs/diagnostics.md` currently says "triple-tap the top-right corner." Change to "top-left corner."

### Fix 4 — `session_start` sourceType label

**File:** `web/src/views/Player.tsx`.

**Current:** `bootSession` emits `session_start` with `sourceType: source`, where `source` is the route param (a source ID like `"1"`). Trace shows `sourceType: "1"` which is meaningless in a report.

**Change:** look up the human-readable source name from the sources list already available in the app. Two viable implementations, implementer picks:

**Option A** (preferred if `api.play(source, id, fromSec)` returns metadata):
```typescript
const resolved = await api.play(source, id, fromSec);
emit('session_start', {
  sourceType: resolved.sourceName ?? source,
  canvasVersion: ...,
});
```

**Option B** (if api.play doesn't return that): fetch or cache `api.sources()` on Player mount:
```typescript
const sourceType = sourcesList.find(s => String(s.id) === source)?.type ?? source;
emit('session_start', { sourceType, canvasVersion: ... });
```

Fallback in either case: if the lookup misses, emit the raw source ID. Never crash on missing metadata.

**Reader-friendly output:** `sourceType: "Plex"` or `sourceType: "Flixify"` in the diagnostics tab.

## Testing

- **No new server tests** — server code is unchanged.
- **No new web unit tests.** RangeFetcher has no existing test infrastructure; retry logic is only meaningfully verified end-to-end against a real HTTP server. Building a mock fetch layer for a one-file test is out of scope. Coverage relies on manual smoke.

**Manual smoke checklist** (mandatory before cutting v0.3.0):

1. `docker build -t canvas:local .` locally succeeds.
2. Run against David's Plex library. Play any item.
3. Playback runs ≥60 seconds without a fatal `network error`.
4. Open diagnostics overlay via triple-tap **top-left** corner. Confirm:
   - Exactly one `fetch_start` per session (the session_start's tsMs to fetch_end's tsMs covers the full playback).
   - `backpressure pause/resume` cycles visible without spawning new fetch_start events.
   - `sourceType` in the header reads "Plex" (or the applicable source name), not "1".
5. Verify the player's close/exit control is clickable in the top-RIGHT corner (no hotspot blocking).
6. **Optional stress:** simulate a network hiccup by briefly disabling wifi during playback. Trace should show `fetch_error → fetch_retry → fetch_start → fetch_chunk …` and playback should resume. If retries exhaust, verify graceful failure with a real fetch_error report POSTed.

## Rollout

1. Cut `v0.3.0` tag on `self-host-server-port`.
2. Publish workflow → ghcr.io/bleichroeder/canvas private.
3. Update David's desktop container. Verify Chrome playback clean.
4. Update Tesla-facing container. Drive. Verify playback survives cellular.
5. If Tesla shows a new failure mode: pull the diagnostics report and scope sub-project I from what the trace reveals.

## Out of scope

- User-facing "reconnecting…" status while retries are in flight. If retries feel invisible-but-slow, a future sub-project can add an unobtrusive UI indicator.
- Alternate-source failover (if Plex fails, try Flixify) — no.
- Refactoring the RangeFetcher / VideoSink / Player.tsx boundary — no. Fix the resume bug, add retry, don't touch structure.
- Adding a mock HTTP test infrastructure for RangeFetcher — no.
- Modifying HIGH_WATER / LOW_WATER thresholds — no. They're not the problem.
- Fixing the underlying reason a retry might be needed (network / server) — nothing canvas can do.
