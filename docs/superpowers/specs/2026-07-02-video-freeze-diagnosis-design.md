# Sub-project I: Video-freeze diagnosis + speculative fix — Design

**Status:** Design approved, awaiting spec review

**Context:** Sub-project G shipped diagnostics; sub-project H fixed the mid-playback `network error` (RangeFetcher.resume double-loop). Trace from v0.3.0 reveals a new failure: video freezes at `queue_snapshot.videoQueue = 18` (HARD_CAP) while audio continues playing audibly. Two competing hypotheses:

- **A** — the video queue holds frames whose `.timestamp` values are all ahead of the current audio clock plus tolerance, so `drawDue()` breaks on frames[0] on every 16ms tick.
- **B** — the audio worklet's `framesPlayed` counter stalls despite audible playback (worklet outputs silence when its internal queue starves, without incrementing framesPlayed), so the video clock (derived from framesPlayed / sampleRate) is stuck.

Neither hypothesis fully explains a 6+ second freeze on desktop Chrome. Instrumenting the queue_snapshot event with clock + head-frame data will disambiguate. In parallel, raise the backpressure thresholds 4× as a speculative fix — the current caps (HIGH_WATER=12, HARD_CAP=18) are tight enough that a fast desktop decoder overwhelms them within 15ms.

**Goal:** Ship v0.4.0 that either (a) plays continuously for ≥60s (fix worked, diagnostics validate hypothesis A), or (b) still freezes but with a trace that identifies the root cause unambiguously so sub-project J can be scoped.

## Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.4.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.** RangeFetcher/VideoSink/AudioSink have no unit test infrastructure; adding one is out of scope.
- **queue_snapshot cadence:** unchanged at 2s.
- **New event kinds:** `frame_stall` and `frame_recovery`. Payloads use existing allowlist rules (numeric only, no URLs).
- **Threshold ratios preserved:** HIGH:LOW=3:1, HARD:HIGH=5:4. All three scale 4× together.

## Three fixes

### Fix 1 — Extend `queue_snapshot` event

**File:** `web/src/views/Player.tsx` (the 2-second setInterval inside `bootSession`) + `web/src/player/video.ts` (new getter).

Current payload:

```typescript
{ videoQueue, audioQueue, pendingV, pendingA }
```

New payload:

```typescript
{
  videoQueue: number,           // existing
  audioQueue: number,           // existing (always 0 per AudioSink shape)
  pendingV: number,             // existing
  pendingA: number,             // existing
  clockSec: number,             // NEW — AudioSink.currentTime() at snapshot time
  videoHeadPtsSec: number | null, // NEW — frames[0].timestamp/1e6, null if queue empty
  droppedTotal: number,         // NEW — VideoSink.droppedFrameCount cumulative
}
```

**Implementation:**

New public getter on `VideoSink` (alongside existing `queueLength`, `droppedFrameCount`):

```typescript
get headPtsSec(): number | null {
  return this.frames.length > 0 ? this.frames[0]!.timestamp / 1_000_000 : null;
}
```

Emit site in Player.tsx bootSession's setInterval callback becomes:

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

**Diagnostic value:** across snapshots we can compare `clockSec` (progression) vs `videoHeadPtsSec` (queue head vs clock):

- `clockSec` stalled → hypothesis B (worklet framesPlayed frozen).
- `clockSec` advancing, `videoHeadPtsSec > clockSec + ~0.02` → hypothesis A (queue holds future frames).
- `droppedTotal` growing rapidly → decoder is producing far more than we can consume; indicates the underlying overshoot severity.

### Fix 2 — Raise backpressure thresholds 4×

**File:** `web/src/player/video.ts:27-35`.

**Change:**

```typescript
// Before
const HIGH_WATER = 12;
const LOW_WATER = 4;
const HARD_CAP = 18;

// After
const HIGH_WATER = 48;
const LOW_WATER = 16;
const HARD_CAP = 60;
```

**Rationale:** at 24fps content, current HARD_CAP=18 is ~0.75s of buffered video. The trace shows the queue hitting this cap within 15ms of the first video frame (fast decoder overshoot). 4× scale-up gives ~2s of buffer headroom before HARD_CAP kicks in, without exploding memory (60 additional VideoFrame refs worst-case).

Ratios preserved:
- HIGH:LOW = 3:1 (was 12:4, now 48:16)
- HARD:HIGH = 5:4 (was 18:12, now 60:48)

**Comment update at `video.ts:22-26`:** the existing block comment cites "12 frames ≈ 0.5 sec of buffered video." Update the numbers to match the new constants ("48 frames ≈ 2 sec at 24 fps"). Don't rewrite the philosophy — just the stated numbers.

### Fix 3 — `frame_stall` / `frame_recovery` watchdog

**File:** `web/src/player/video.ts` — add state to `VideoSink`, extend `drawDue()`.

**New instance state** (near `backpressureState` at line 56):

```typescript
private stallTicks = 0;        // consecutive drawDue calls that didn't draw
private stallActive = false;   // have we emitted frame_stall (waiting for recovery)?
```

**Extension to `drawDue()`** — added at the end of the method after the backpressure resume check:

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

**Semantics:** state-transition emit. `frame_stall` fires ONCE when drawDue stops drawing for 500ms; `frame_recovery` fires ONCE when it resumes. No per-tick flood.

**KIND_COLOR entries** in `web/src/components/DiagnosticsOverlay.tsx` (adjacent to other frame events):

```typescript
frame_stall: 'warning',
frame_recovery: 'success',
```

## Testing

- **No new tests.** RangeFetcher/VideoSink/AudioSink have no unit test infrastructure in canvas; not adding one here.
- **Manual smoke** before v0.4.0 tag:
  - `docker build -t canvas:local .` succeeds.
  - `bun test` and `bun run typecheck` clean (server unchanged).
  - `npm run build` clean.
  - Run against Plex on desktop. Play any item.
  - Watch for one of:
    - **Video plays ≥60s without freeze** → speculative fix worked. Capture the trace anyway (triple-tap top-left) to validate hypothesis A.
    - **Video still freezes** → capture the trace. It'll show `clockSec` progression, `videoHeadPtsSec` positioning, `droppedTotal` growth, plus a `frame_stall` event at the freeze moment. That trace scopes sub-project J.
  - Verify existing behavior intact — hotspot triple-tap opens overlay, sourceType reads "plex", no new console errors on ≥10 minutes of playback (memory pressure check).

## Rollout

1. Cut `v0.4.0` tag.
2. Publish workflow → ghcr.io/bleichroeder/canvas:0.4.0 (private).
3. Rolling update on desktop container:
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.4.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.4.0
   ```
4. Reproduce the freeze. Report back with the trace.

## Out of scope

- Unit tests for VideoSink/AudioSink/AudioWorklet.
- Adaptive HARD_CAP computed from detected framerate.
- Rewriting the video sync mechanism (audio-clock-driven vs monotonic-clock-driven).
- Fixing the underlying audio worklet starvation semantics (this is what J may need to address).
- Reproducing the freeze deterministically in a test harness.
