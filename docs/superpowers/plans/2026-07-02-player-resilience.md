# Player Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the RangeFetcher.resume() bug that causes mid-playback network errors, add fetch retry on transient errors, move the diagnostics hotspot off the player's close button, and emit a human-readable sourceType in `session_start`.

**Architecture:** Two tasks bundled by file. Task 1 edits `web/src/player/range-fetcher.ts` (resume fix + retry orchestration) plus the diagnostics overlay's kind→color map. Task 2 edits `web/src/views/Player.tsx` (hotspot re-placement + source-name lookup) plus a small docs update.

**Tech Stack:** Web frontend only (Bun-runtime server untouched). React + Vite + TypeScript. No new deps.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.3.0` when all fixes are merged and manual smoke passes.
- **Server code is NOT touched.** Client-only fix.
- **No new deps. No new tests.** The spec explicitly rules out new test infrastructure for RangeFetcher — coverage is manual smoke.
- **Preserve RangeFetcher's reader-pause design.** The paused branch of `loop()` (currently lines 102-113) is correct; we fix `resume()`, not the pause mechanism.
- **Exact retry parameters:** max 4 attempts (1 original + 3 retries), backoff `[200, 500, 2000]` ms. Total worst case ≈ 2.7s.
- **Non-retryable errors:** `AbortError` propagates silently (as today); HTTP status ≥ 400 breaks out of retry loop (fatal). Retryable: transient network errors (fetch reject, reader.read throw, "no body" throw).
- **New event kind:** `fetch_retry` with payload `{ attempt: number, delayMs: number, reason: string }`. `reason` MUST run through the existing `sanitizeMessage` helper before emitting.
- **Hotspot new position:** `top: 0; left: 0` (was `top: 0; right: 0`). Size and z-index unchanged.

---

## File Structure

**Modified files:**

- `web/src/player/range-fetcher.ts` — `resume()` fix + `loop()` refactored into outer retry loop + private `attemptFetch()` method + new `fetch_retry` emit.
- `web/src/components/DiagnosticsOverlay.tsx` — add `fetch_retry` entry to `KIND_COLOR` map.
- `web/src/views/Player.tsx` — hotspot style change + source-name lookup for session_start.
- `docs/diagnostics.md` — update overlay-trigger text from "top-right corner" to "top-left corner".

**No new files. No server changes. No test files.**

---

## Task 1: RangeFetcher — resume fix + retry orchestration

**Files:**
- Modify: `web/src/player/range-fetcher.ts:11-145`
- Modify: `web/src/components/DiagnosticsOverlay.tsx` — the `KIND_COLOR` map (single line addition)

**Interfaces:**
- Consumes: `emit`, `sanitizeMessage` from `./diagnostics` (already imported).
- Produces: no exported-surface change. `RangeFetcher` class + `RangeFetcherOptions` interface unchanged externally. New internal method `attemptFetch()` (private) and updated `loop()` body.

- [ ] **Step 1: Fix `resume()` (Fix 1)**

Read `web/src/player/range-fetcher.ts` first to confirm the current shape. Then change line 51 from:

```typescript
resume(): void { if (this.running && this.paused) { this.paused = false; void this.loop(); } }
```

to:

```typescript
resume(): void { if (this.paused) this.paused = false; }
```

Note: `this.running` guard dropped — nothing sets `paused=false` except `resume()` itself and `start()`, and if we're paused we're by definition running (the loop set `running=true` before entering the paused-await).

- [ ] **Step 2: Refactor `loop()` into outer retry loop + private `attemptFetch()` (Fix 2)**

Replace the entire body of the `loop()` method (currently lines 64-144) with the following two methods. The `attemptFetch()` body is the OLD loop's content, unchanged in behavior; only the outer retry orchestration is new.

```typescript
private async loop(): Promise<void> {
  // Retry backoff for attempts 2, 3, 4. Attempt 1 runs immediately.
  const RETRY_DELAYS_MS = [200, 500, 2000];
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
      return; // clean completion — attemptFetch emitted fetch_end + called onDone.
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      lastError = e as Error;
      // Non-retryable: HTTP status error (server-side rejection).
      if (this.lastStatus >= 400) break;
    }
  }

  // All attempts exhausted or non-retryable failure.
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
  // Body of the original loop(): one HTTP fetch, streamed via response.body.
  // On any exception (network error, reader.read throw, missing body), we
  // throw so the outer loop() decides retry vs. fatal. AbortError propagates
  // to loop() which returns silently. HTTP 4xx/5xx are thrown as Error and
  // become non-retryable via lastStatus check in loop().
  this.controller = new AbortController();
  this.startedAtMs = performance.now();
  this.totalRead = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    emit('fetch_start', {
      rangeStart: this.offset,
      rangeEnd: this.totalSize ?? null,
      hostname: new URL(this.url).hostname,
    });
    const res = await fetch(this.url, {
      headers: this.offset > 0 ? { Range: `bytes=${this.offset}-` } : {},
      signal: this.controller.signal,
      referrerPolicy: 'no-referrer',
    });
    this.lastStatus = res.status;
    if (!res.ok && res.status !== 206 && res.status !== 200) {
      throw new Error(`HTTP ${res.status}`);
    }
    const range = res.headers.get('content-range');
    if (range) {
      const m = range.match(/\/(\d+)$/);
      if (m) this.totalSize = Number(m[1]);
    } else {
      const len = res.headers.get('content-length');
      if (len) this.totalSize = this.offset + Number(len);
    }

    const body = res.body;
    if (!body) throw new Error('response has no body');
    reader = body.getReader();
    while (this.running) {
      if (this.paused) {
        await new Promise<void>((resolve) => {
          const tick = () => {
            if (!this.running || !this.paused) resolve();
            else setTimeout(tick, 200);
          };
          tick();
        });
        if (!this.running) break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const offsetForChunk = this.offset;
      this.offset += value.length;
      this.totalRead += value.length;
      this.emitChunk(offsetForChunk, value.length);
      await this.onChunk(offsetForChunk, value);
    }
    if (this.running) {
      this.running = false;
      emit('fetch_end', {
        totalBytes: this.totalRead,
        durationMs: Math.round(performance.now() - this.startedAtMs),
        status: this.lastStatus,
      });
      this.onDone();
    }
  } finally {
    try { reader?.releaseLock(); } catch { /* ignore */ }
  }
}
```

**Key details for the implementer:**

- The old `catch (e)` block that emitted `fetch_error` and called `onError(e)` is REMOVED from `attemptFetch()`. Those responsibilities move to the outer `loop()`. Exceptions bubble up.
- The `AbortError` short-circuit stays in the outer `loop()` (catch handler returns).
- The `finally` block in `attemptFetch()` still releases the reader lock on every attempt.
- `this.offset` is preserved across retries — the retry `Range: bytes=<offset>-` header resumes from where the previous attempt left off, so bytes already delivered are not re-read.
- The `if (this.lastStatus >= 400) break` in the outer loop() is the non-retryable check. `lastStatus` is set inside `attemptFetch()` before the status-error throw, so it's populated by the time the catch runs.
- `sanitizeMessage` is already imported at the top of the file — no import change needed.

- [ ] **Step 3: Add `fetch_retry` to the KIND_COLOR map in DiagnosticsOverlay**

Read `web/src/components/DiagnosticsOverlay.tsx`. Find the `KIND_COLOR: Record<string, string>` object. Add a new entry:

```typescript
fetch_retry: 'warning',
```

Put it adjacent to the existing `fetch_error: 'error',` entry so related fetch-lifecycle events are grouped.

- [ ] **Step 4: Verify build**

```bash
cd web
npm run build
```

Expected: `tsc --noEmit` clean + `vite build` succeeds. The one pre-existing chunk-size warning (~870KB main bundle) is unrelated — ignore it. Any NEW warnings mean regression.

- [ ] **Step 5: Commit**

```bash
git add web/src/player/range-fetcher.ts web/src/components/DiagnosticsOverlay.tsx
git commit -m "player: fix resume() double-loop + retry on transient network errors"
```

---

## Task 2: Player.tsx UX fixes — hotspot + source-name label

**Files:**
- Modify: `web/src/views/Player.tsx` — the diagnostics hotspot `<div>` style + `session_start` sourceType lookup
- Modify: `docs/diagnostics.md` — update "top-right corner" reference

**Interfaces:**
- Consumes: `api.listSources()` from `web/src/api.ts` (existing method — returns `Array<{ id: number; type: 'plex' | 'flixify'; ... }>`).
- Produces: no new exports. Behavior change only: `session_start.sourceType` now emits `"plex"` / `"flixify"` (the `.type` string from the sources record) instead of the numeric-ID string from the route param.

- [ ] **Step 1: Move the diagnostics hotspot to top-left (Fix 3)**

Read `web/src/views/Player.tsx` and find the invisible hotspot `<div>` near the end of the returned JSX. It's the one with `onClick={onCornerTap}` and inline style setting `position: 'fixed'`. Change the style prop from:

```typescript
style={{ position: 'fixed', top: 0, right: 0, width: 100, height: 100, zIndex: 9998 }}
```

to:

```typescript
style={{ position: 'fixed', top: 0, left: 0, width: 100, height: 100, zIndex: 9998 }}
```

Only `right: 0` → `left: 0`. Nothing else changes on that div.

- [ ] **Step 2: Update docs**

Open `docs/diagnostics.md`. Find the line that reads "triple-tap the top-right corner" (or similar — grep for `top-right` in the file). Replace with "top-left corner". If the surrounding paragraph has other stale references, update them consistently.

- [ ] **Step 3: Look up source name for `session_start` (Fix 4)**

Read `web/src/views/Player.tsx`. Currently `bootSession()` emits:

```typescript
emit('session_start', { sourceType: source, canvasVersion: ... });
```

where `source` is the route param (a numeric ID as a string, e.g. `"1"`).

We need to look up the source's `.type` (`'plex'` or `'flixify'`) from `api.listSources()`. Two viable placements — pick whichever fits the existing Player.tsx structure more cleanly:

**Option A (preferred): call `api.listSources()` inside `bootSession` immediately before the emit.**

```typescript
async function bootSession() {
  // ... existing setup

  // Resolve source name (id -> type) for readable diagnostics.
  // On failure, fall back to the raw source ID.
  let sourceType: string = source;
  try {
    const list = await api.listSources();
    const match = list.find((s) => String(s.id) === source);
    if (match) sourceType = match.type;
  } catch {
    // listSources failed — keep the raw ID. Never let this crash bootSession.
  }

  emit('session_start', {
    sourceType,
    canvasVersion:
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_CANVAS_VERSION ?? 'dev',
  });

  // ... rest of bootSession
}
```

**Option B: use `useEffect`+`useState` to load sources once on mount and cache in a ref.**

More React-idiomatic but adds two hooks for one lookup. If Player.tsx already loads sources for some other reason (grep the file for `listSources` — if it exists, reuse; if not, prefer Option A to avoid new state).

For BOTH options: the lookup is best-effort. If `api.listSources()` fails (e.g., auth token expired), we fall back to the raw source ID. The emit MUST NOT throw or block session bootstrap.

Implementer picks based on file structure. Both are acceptable.

- [ ] **Step 4: Verify build**

```bash
cd web
npm run build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Player.tsx docs/diagnostics.md
git commit -m "player: move diag hotspot to top-left + emit source name in session_start"
```

---

## Rollout after both tasks merge

1. Full-suite verification (mandatory before tagging):
   ```bash
   cd server && bun run typecheck && bun test
   cd ../web && npm run build
   cd .. && docker build -t canvas:local .
   ```
   Expected: server 268/268 pass, typecheck clean, web build clean, docker build clean.

2. Manual smoke on desktop against Plex:
   - Run `canvas:local` locally, sign in, play a Plex item.
   - Verify playback runs ≥60 seconds without a fatal `network error`.
   - Open the diagnostics overlay by triple-tapping the **top-LEFT** corner within 1.5s (or use `?diag=1`). Expected trace:
     - Exactly ONE `fetch_start` per playback session.
     - Multiple `backpressure pause/resume` cycles are fine — none should spawn a new `fetch_start`.
     - `session_start.sourceType` reads `"plex"` (or the actual source `.type`), not `"1"`.
   - Confirm the player's close/exit control on the top-right is clickable (no hotspot blocking).
   - Optional: briefly toggle wifi off then on during playback. Expected: `fetch_error → fetch_retry(attempt: 1, delayMs: 200) → fetch_start → …` and playback recovers.

3. Tag + push:
   ```bash
   git tag -a v0.3.0 -m "canvas v0.3.0 — player resilience"
   git push origin v0.3.0
   ```

4. Wait for publish workflow → `ghcr.io/bleichroeder/canvas:0.3.0` (private).

5. Update Tesla-facing container to `0.3.0`. Drive. If a new failure surfaces, pull the diagnostics report and scope sub-project I from it.

## Out of scope

- Modifying HIGH_WATER / LOW_WATER thresholds in VideoSink.
- Adding a "reconnecting…" UI indicator during retry backoff.
- Alternate-source failover (Plex fails → try Flixify).
- Any server-side changes.
- Adding unit tests for RangeFetcher (per spec — no new test infrastructure).
- Refactoring RangeFetcher / Player.tsx boundaries beyond the surgical edits above.
