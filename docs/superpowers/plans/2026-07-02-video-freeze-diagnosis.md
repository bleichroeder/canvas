# Video-Freeze Diagnosis + Speculative Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship v0.4.0 that (a) extends `queue_snapshot` with clock + head-frame + drop-count fields, (b) raises the backpressure thresholds 4× as a speculative fix for the observed video freeze, and (c) adds a `frame_stall` / `frame_recovery` state-transition watchdog.

**Architecture:** One task. Three related changes across `web/src/player/video.ts` (new getter, threshold constants, drawDue watchdog), `web/src/views/Player.tsx` (extended queue_snapshot emit), and `web/src/components/DiagnosticsOverlay.tsx` (KIND_COLOR entries for the two new events). No server changes. No new tests.

**Tech Stack:** React + Vite + TypeScript. WebCodecs (VideoDecoder, VideoFrame). Bun-runtime backend unchanged.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.4.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.** RangeFetcher/VideoSink/AudioSink have no unit test infrastructure; not adding one here.
- **Threshold values:** HIGH_WATER=48, LOW_WATER=16, HARD_CAP=60 (all 4× the previous 12/4/18).
- **Ratios preserved:** HIGH:LOW=3:1, HARD:HIGH=5:4.
- **STALL_THRESHOLD:** 30 consecutive drawDue ticks without drawing (~500ms at 16ms cadence).
- **New event kinds (exact names):** `frame_stall`, `frame_recovery`. Both use numeric-only payloads.
- **queue_snapshot payload additions (exact field names):** `clockSec: number`, `videoHeadPtsSec: number | null`, `droppedTotal: number`.
- **queue_snapshot cadence:** unchanged at 2s.
- **KIND_COLOR values:** `frame_stall: 'warning'`, `frame_recovery: 'success'`.

---

## File Structure

**Modified files (three total):**

- `web/src/player/video.ts`
  - New public getter `headPtsSec`.
  - Constants raised: HIGH_WATER 12→48, LOW_WATER 4→16, HARD_CAP 18→60.
  - Comment at lines 22-26 updated with new numbers ("48 frames ≈ 2 sec at 24 fps").
  - Two new instance fields (`stallTicks`, `stallActive`) added near `backpressureState`.
  - `drawDue()` extended with a state-transition watchdog block after the backpressure resume check.

- `web/src/views/Player.tsx`
  - The 2-second setInterval callback in `bootSession` extended: 3 new fields on the `queue_snapshot` emit payload (`clockSec`, `videoHeadPtsSec`, `droppedTotal`).

- `web/src/components/DiagnosticsOverlay.tsx`
  - Two entries added to the `KIND_COLOR` map: `frame_stall: 'warning'` and `frame_recovery: 'success'`.

**No new files. No server changes. No test files.**

---

## Task 1: video-freeze diagnosis + speculative fix

**Files:**
- Modify: `web/src/player/video.ts` (constants, comment, new getter, new state, drawDue watchdog)
- Modify: `web/src/views/Player.tsx` (queue_snapshot emit payload extended)
- Modify: `web/src/components/DiagnosticsOverlay.tsx` (KIND_COLOR entries)

**Interfaces:**
- Consumes: `emit` from `./diagnostics` (already imported in `video.ts` at line 1).
- Produces:
  - New getter: `VideoSink.headPtsSec: number | null` (returns `frames[0].timestamp / 1_000_000` or `null` if queue empty).
  - Existing getter (unchanged, referenced by Player.tsx): `VideoSink.droppedFrameCount: number` at video.ts:129.
  - Existing method (unchanged, referenced by Player.tsx): `AudioSink.currentTime(): number` at audio.ts:74.
  - Two new event kinds emitted from `drawDue()`: `frame_stall` with `{ clockSec, queueDepth, headPtsSec }` and `frame_recovery` with `{ clockSec, queueDepth }`.

- [ ] **Step 1: Add `headPtsSec` getter to `VideoSink`**

Read `web/src/player/video.ts` first — confirm the current shape of the getters block (around lines 127-129 with `queuedFrames`, `queueLength`, `droppedFrameCount`).

Add a new getter immediately after `droppedFrameCount`:

```typescript
get headPtsSec(): number | null {
  return this.frames.length > 0 ? this.frames[0]!.timestamp / 1_000_000 : null;
}
```

Nothing else on those existing getters changes. The `frames` array is already sorted by timestamp on every push (see line 144), so `frames[0]` is always the oldest.

- [ ] **Step 2: Raise thresholds + update comment**

In `web/src/player/video.ts`, at lines 22-35, replace the existing block:

```typescript
// Backpressure thresholds (in queued frames).
//   HIGH_WATER: pause the fetcher when we've buffered this many frames
//   LOW_WATER:  resume when we drain back to this many
// At 24 fps, 12 frames ≈ 0.5 sec of buffered video — plenty of headroom for
// the draw loop without committing a lot of memory.
const HIGH_WATER = 12;
const LOW_WATER = 4;
// Defense-in-depth cap. If backpressure doesn't take effect quickly enough
// (the fetcher is still in flight when we signal pause, demuxer still has
// chunks to emit, decoder still has chunks to consume), we drop the
// INCOMING frame rather than the oldest. Dropping oldest is wrong when the
// decoder races ahead — every queued frame is in the future and the oldest
// is the one closest to the clock and most likely to be the next one drawn.
const HARD_CAP = 18;
```

with:

```typescript
// Backpressure thresholds (in queued frames).
//   HIGH_WATER: pause the fetcher when we've buffered this many frames
//   LOW_WATER:  resume when we drain back to this many
// At 24 fps, 48 frames ≈ 2 sec of buffered video — enough headroom for a
// fast desktop decoder that overshoots the pause signal, without going wild
// on memory (raised from 12/4/18 in v0.4.0 after traces showed the tighter
// caps caused HARD_CAP saturation within 15ms of first frame).
const HIGH_WATER = 48;
const LOW_WATER = 16;
// Defense-in-depth cap. If backpressure doesn't take effect quickly enough
// (the fetcher is still in flight when we signal pause, demuxer still has
// chunks to emit, decoder still has chunks to consume), we drop the
// INCOMING frame rather than the oldest. Dropping oldest is wrong when the
// decoder races ahead — every queued frame is in the future and the oldest
// is the one closest to the clock and most likely to be the next one drawn.
const HARD_CAP = 60;
```

Only the three numbers (12, 4, 18) change to (48, 16, 60), plus the "12 frames ≈ 0.5 sec" sentence is rewritten to reflect the new numbers and the reason for the bump. The rest of the comment philosophy is unchanged.

- [ ] **Step 3: Add stall watchdog state fields**

In `VideoSink`'s field declarations block (around line 56, next to `backpressureState`), add two new private fields:

```typescript
private stallTicks = 0;        // consecutive drawDue calls that didn't draw
private stallActive = false;   // have we emitted frame_stall (waiting for recovery)?
```

Place them adjacent to `backpressureState` — same kind of state-tracking, keeps related fields together.

- [ ] **Step 4: Extend `drawDue()` with the watchdog**

Read the current `drawDue()` method (lines 154-181). At the very end of the method (after the existing backpressure resume check at lines 176-180), add:

```typescript
if (drawn) {
  if (this.stallActive) {
    this.stallActive = false;
    emit('frame_recovery', {
      clockSec,
      queueDepth: this.frames.length,
    });
  }
  this.stallTicks = 0;
} else {
  this.stallTicks += 1;
  const STALL_THRESHOLD = 30; // ~500ms at 16ms drawDue cadence
  if (!this.stallActive && this.stallTicks >= STALL_THRESHOLD) {
    this.stallActive = true;
    emit('frame_stall', {
      clockSec,
      queueDepth: this.frames.length,
      headPtsSec: this.frames.length > 0 ? this.frames[0]!.timestamp / 1_000_000 : null,
    });
  }
}
```

The existing `clockSec` variable is already in scope from line 155. Emits fire as one-shot state transitions — `frame_stall` when we cross into stalled state, `frame_recovery` when we come out. No per-tick flood.

- [ ] **Step 5: Extend `queue_snapshot` emit in Player.tsx**

Read `web/src/views/Player.tsx` and find the 2-second `setInterval` callback inside `bootSession` (grep for `queue_snapshot` to locate it — should be around the engine setup block). It currently reads:

```typescript
emit('queue_snapshot', {
  videoQueue: videoSinkRef.current?.queueLength ?? 0,
  audioQueue: audioSinkRef.current?.queueLength ?? 0,
  pendingV: pendingVideoChunks.current.length,
  pendingA: pendingAudioChunks.current.length,
});
```

Replace with:

```typescript
const videoSink = videoSinkRef.current;
const audioSink = audioSinkRef.current;
emit('queue_snapshot', {
  videoQueue: videoSink?.queueLength ?? 0,
  audioQueue: audioSink?.queueLength ?? 0,
  pendingV: pendingVideoChunks.current.length,
  pendingA: pendingAudioChunks.current.length,
  clockSec: audioSink?.currentTime() ?? 0,
  videoHeadPtsSec: videoSink?.headPtsSec ?? null,
  droppedTotal: videoSink?.droppedFrameCount ?? 0,
});
```

Two things worth noting for the implementer:
- Hoisting `videoSinkRef.current` and `audioSinkRef.current` into local const vars is a small readability + typescript-narrowing win but not required. Match whatever style the surrounding code uses.
- If Player.tsx uses different ref variable names (e.g., `videoRef`, `audioRef` instead of `videoSinkRef`, `audioSinkRef`), match the ACTUAL names in the file. Read first, then edit.

- [ ] **Step 6: Add KIND_COLOR entries for the new events**

Read `web/src/components/DiagnosticsOverlay.tsx` and find the `KIND_COLOR: Record<string, string>` object. Add two new entries grouped with the other frame-related events:

```typescript
frame_stall: 'warning',
frame_recovery: 'success',
```

Match the existing indentation and comma style of the map.

- [ ] **Step 7: Verify build**

```bash
cd web
npm run build
```

Expected: `tsc --noEmit` clean + `vite build` succeeds. Only the pre-existing ~870KB chunk-size warning — no new warnings. Any NEW warnings mean regression.

- [ ] **Step 8: Commit**

```bash
git add web/src/player/video.ts web/src/views/Player.tsx web/src/components/DiagnosticsOverlay.tsx
git commit -m "player: extend queue_snapshot + raise backpressure caps + frame_stall watchdog"
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
     - **Video plays ≥60s continuously without freeze** → the raised thresholds resolved it. Still open the diagnostics overlay (triple-tap top-LEFT) and capture the trace to validate hypothesis A.
     - **Video still freezes** → capture the trace via the overlay's Copy JSON button. The `queue_snapshot` events will now include `clockSec`, `videoHeadPtsSec`, `droppedTotal`, and a `frame_stall` event should fire at the freeze moment.
   - Verify existing behavior isn't broken — hotspot triple-tap opens overlay, sourceType still reads "plex", no new console errors on ≥10 minutes of playback (memory pressure check).

3. Tag + push:
   ```bash
   git tag -a v0.4.0 -m "canvas v0.4.0 — video-freeze diagnosis + threshold raise"
   git push origin v0.4.0
   ```

4. Wait for publish workflow → `ghcr.io/bleichroeder/canvas:0.4.0` (private).

5. Rolling in-place update on desktop container (preserves the `canvas-data` volume with existing users, sources, and prior reports):
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.4.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.4.0
   ```

6. Reproduce the freeze. Report the trace back — the enriched `queue_snapshot` fields + any `frame_stall` events will disambiguate hypothesis A vs B.

## Out of scope

- Unit tests for VideoSink/AudioSink/AudioWorklet.
- Adaptive HARD_CAP computed from detected framerate.
- Rewriting the video sync mechanism.
- Fixing the underlying audio worklet starvation semantics (sub-project J territory if trace confirms hypothesis B).
- Reproducing the freeze deterministically in a test harness.
