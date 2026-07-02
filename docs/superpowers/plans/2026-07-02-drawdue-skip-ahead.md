# drawDue Skip-Ahead Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skip-ahead block at the top of `VideoSink.drawDue()` that closes head frames whose pts is more than `MAX_HEAD_LEAD_SEC` (2.0s) past the audio clock, emit a `frame_flush` event for diagnostics, and register the event's color in the overlay. Ship as `v0.5.0`.

**Architecture:** One task. Two files touched: `web/src/player/video.ts` (constant + skip-ahead block) and `web/src/components/DiagnosticsOverlay.tsx` (KIND_COLOR entry). No server changes. No new tests.

**Tech Stack:** React + Vite + TypeScript. WebCodecs (VideoFrame). Bun-runtime backend unchanged.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.5.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.** VideoSink has no unit test infrastructure; not adding one here.
- **`MAX_HEAD_LEAD_SEC = 2.0`** (module-level constant, adjacent to HIGH_WATER/LOW_WATER/HARD_CAP).
- **New event kind (exact name):** `frame_flush` with payload `{ closedCount: number, clockSec: number, remainingQueue: number }`.
- **KIND_COLOR value:** `frame_flush: 'warning'`.
- **Skip-ahead placement:** at the TOP of `drawDue()`, BEFORE the existing draw loop. Reuses the existing `clockSec` / `clockUs` locals (currently declared at video.ts:155-156).
- **The existing draw loop, backpressure cycles, HIGH_WATER/LOW_WATER/HARD_CAP constants, `stallTicks` / `stallActive` state, and `frame_stall` / `frame_recovery` watchdog (all added in v0.4.0) are NOT modified.**
- **Condition uses strict `>`** — frames whose pts equals `clock + MAX_HEAD_LEAD_SEC` are retained.

---

## File Structure

**Modified files (two):**

- `web/src/player/video.ts`
  - New module-level constant `MAX_HEAD_LEAD_SEC = 2.0` (adjacent to existing threshold constants, around lines 22-35).
  - Skip-ahead block added at the top of `drawDue()` (currently lines 154-181), BEFORE the existing draw loop.

- `web/src/components/DiagnosticsOverlay.tsx`
  - One entry added to `KIND_COLOR` map: `frame_flush: 'warning'`.

**No new files. No server changes. No test files.**

---

## Task 1: drawDue skip-ahead

**Files:**
- Modify: `web/src/player/video.ts` (constant + skip-ahead in drawDue)
- Modify: `web/src/components/DiagnosticsOverlay.tsx` (KIND_COLOR entry)

**Interfaces:**
- Consumes: `emit` from `./diagnostics` (already imported at video.ts line 1).
- Produces:
  - Module-level constant `MAX_HEAD_LEAD_SEC: number = 2.0` (private to video.ts).
  - New emitted event kind `frame_flush` with payload `{ closedCount, clockSec, remainingQueue }`.

- [ ] **Step 1: Add the `MAX_HEAD_LEAD_SEC` constant**

Read `web/src/player/video.ts` first — confirm the current shape of the threshold constants block (around lines 22-35). It should currently define `HIGH_WATER = 48`, `LOW_WATER = 16`, `HARD_CAP = 60` and their associated comments.

Add a new constant immediately after `HARD_CAP`:

```typescript
// If the queue head is more than this many seconds past the audio clock,
// close head frames and iterate. Without this, a burst of far-future
// frames (e.g., after fetcher pause/resume delivers a TCP-buffered burst)
// pins the queue at HARD_CAP; drawDue rejects the head every tick, and
// video visibly freezes until the clock catches up (10+ seconds).
const MAX_HEAD_LEAD_SEC = 2.0;
```

Nothing else in the constants block changes.

- [ ] **Step 2: Add the skip-ahead block to `drawDue()`**

Read the current `drawDue()` method (starts around line 154 in the current code). Its first two lines are:

```typescript
const clockSec = this.clock();
const clockUs = clockSec * 1_000_000;
```

Immediately AFTER those two lines and BEFORE the existing draw loop (`let drawn: VideoFrame | null = null; while (this.frames.length > 0) { ... }`), insert this block:

```typescript
const maxLeadUs = MAX_HEAD_LEAD_SEC * 1_000_000;

// Skip-ahead: close head frames whose pts is way past the clock.
// Prevents the queue from pinning at HARD_CAP with unreachable frames.
let flushed = 0;
while (this.frames.length > 0 && this.frames[0]!.timestamp > clockUs + maxLeadUs) {
  const f = this.frames.shift()!;
  f.close();
  flushed++;
}
if (flushed > 0) {
  emit('frame_flush', {
    closedCount: flushed,
    clockSec,
    remainingQueue: this.frames.length,
  });
}
```

Do NOT modify any code below this insertion. The existing draw loop, the `if (drawn)` block, the backpressure resume check, and the `frame_stall` / `frame_recovery` watchdog (added in v0.4.0) all stay exactly as they are.

- [ ] **Step 3: Add `frame_flush` to KIND_COLOR in DiagnosticsOverlay**

Read `web/src/components/DiagnosticsOverlay.tsx` and find the `KIND_COLOR: Record<string, string>` object. Add a new entry adjacent to the other frame-related entries (`frame_stall: 'warning'`, `frame_recovery: 'success'`):

```typescript
frame_flush: 'warning',
```

Match the existing indentation and trailing-comma style of the map. Do NOT modify any other entries.

- [ ] **Step 4: Verify build**

```bash
cd web
npm run build
```

Expected: `tsc --noEmit` clean + `vite build` succeeds. Only the pre-existing ~873KB chunk-size warning — no new warnings. Any NEW warnings mean regression.

- [ ] **Step 5: Commit**

```bash
git add web/src/player/video.ts web/src/components/DiagnosticsOverlay.tsx
git commit -m "player: drawDue skip-ahead — close head frames > 2s past clock"
```

---

## Rollout after task merges

1. Full-suite verification (mandatory before tagging):
   ```bash
   cd server && bun run typecheck && bun test
   cd ../web && npm run build
   cd .. && docker build -t canvas:local .
   ```
   Expected: server 268/268 pass, typecheck clean, web build clean, docker build clean.

2. Manual smoke on desktop against Plex:
   - Run `canvas:local` locally, sign in, play a Plex item.
   - Watch for one of two outcomes:
     - **Playback runs ≥60s continuously without visible freeze** → the skip-ahead resolved it. Grab the trace via the diagnostics overlay (triple-tap top-LEFT, Copy JSON) to confirm — `frame_flush` events may or may not fire depending on whether the decoder-ahead pattern reoccurs.
     - **Video still freezes** → grab the trace. Look for `frame_flush` events. If they fire but freeze persists → confirms the decoder continues producing far-forward frames after each flush; sub-project K needs the deeper fix (audio worklet FIFO reset or full seek-to-clock recovery). If `frame_flush` does NOT fire → either the 2.0s threshold is too high for this stream, or the freeze mechanism is entirely different from what we modeled.
   - Verify existing behavior intact: hotspot triple-tap opens overlay, sourceType reads "plex", no console errors, no OOM on ≥10 minutes of playback.

3. Tag + push:
   ```bash
   git tag -a v0.5.0 -m "canvas v0.5.0 — drawDue skip-ahead"
   git push origin v0.5.0
   ```

4. Wait for publish workflow → `ghcr.io/bleichroeder/canvas:0.5.0` (private).

5. Rolling in-place update (preserves `canvas-data` volume with existing users, sources, and prior reports):
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.5.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.5.0
   ```

6. Reproduce the freeze scenario. Report back — either "playback runs clean" or a trace showing what J did/didn't fix.

## Out of scope

- Audio worklet FIFO reset (sub-project K if J alone is insufficient).
- Full decoder reset + seek to clock position (sub-project K, more invasive).
- Dropping incoming far-future frames in `onFrame` (parallel approach; only revisit if drawDue skip-ahead alone is insufficient).
- Adaptive `MAX_HEAD_LEAD_SEC` computed from framerate or bitrate.
- Tests for VideoSink.
- Server-side changes.
- Modifying HIGH_WATER / LOW_WATER / HARD_CAP or the frame_stall watchdog thresholds.
