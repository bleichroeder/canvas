# Sub-project J: drawDue skip-ahead — Design

**Status:** Design approved, awaiting spec review

**Context:** Sub-project I (v0.4.0) instrumented the video pipeline. The resulting trace confirmed hypothesis A: the video queue accumulates frames whose `.timestamp` values are far ahead of the audio clock. Concretely — after a fetcher pause/resume that delivers a TCP-buffered burst, the queue reaches HARD_CAP=60 with head=pts=23.75s while the audio clock is at 15.4s (8+ second gap). drawDue rejects the head every tick because `head.timestamp > clock + tolerance`, and video visibly freezes until the clock naturally catches up 10+ seconds later.

**Goal:** Shorten the visible freeze window by skipping past far-future frames at the head of the queue when they're unreachable within a reasonable time. If the queue's head is more than 2 seconds ahead of the audio clock, close head frames and iterate.

## Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.5.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.** VideoSink has no test infrastructure; coverage is manual smoke.
- **Threshold:** `MAX_HEAD_LEAD_SEC = 2.0` — well above the ~1.2s max normal-operation `head - clock` gap seen in the v0.4.0 trace.
- **New event kind (exact name):** `frame_flush` with payload `{ closedCount: number, clockSec: number, remainingQueue: number }`.
- **KIND_COLOR entry:** `frame_flush: 'warning'`.
- **The existing draw loop, backpressure cycles, HIGH_WATER/LOW_WATER/HARD_CAP constants, and frame_stall watchdog are NOT touched.** Only the skip-ahead block is added.

## Acknowledged limitation

If, after flushing, the decoder continues producing frames at pts far ahead of the clock (because the fetcher's byte position corresponds to a far-forward point in the stream), the queue will refill with more far-future frames and get flushed again. The freeze may persist. If observed, sub-project K would tackle either:

- Audio worklet FIFO reset (advance `framesPlayed` so the clock catches up to the stream position), or
- Full seek-to-clock recovery (reset decoder + rewind fetcher to a byte offset that maps back to `clockSec`).

Both are more invasive. Ship J first, measure, then decide.

## The change

**File:** `web/src/player/video.ts`.

**Add module-level constant** — placed adjacent to the existing HIGH_WATER/LOW_WATER/HARD_CAP block (around lines 22-35):

```typescript
// If the queue head is more than this many seconds past the audio clock,
// close head frames and iterate. Without this, a burst of far-future
// frames (e.g., after fetcher pause/resume delivers a TCP-buffered burst)
// pins the queue at HARD_CAP; drawDue rejects the head every tick, and
// video visibly freezes until the clock catches up (10+ seconds).
const MAX_HEAD_LEAD_SEC = 2.0;
```

**Extend `drawDue()`** — a new block at the top of the method, BEFORE the existing draw loop:

```typescript
private drawDue(): void {
  const clockSec = this.clock();
  const clockUs = clockSec * 1_000_000;
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

  // ... existing draw loop from line 157 onward unchanged
  // ... existing backpressure resume check unchanged
  // ... existing frame_stall / frame_recovery watchdog (added in v0.4.0) unchanged
}
```

The `clockSec` and `clockUs` locals were already computed at the top of the method (line 155-156 in the current code); reuse them.

**KIND_COLOR entry** in `web/src/components/DiagnosticsOverlay.tsx` — add adjacent to `frame_stall` and `frame_recovery`:

```typescript
frame_flush: 'warning',
```

## Edge cases

- **Empty queue:** `while` condition guards `frames.length > 0` → no-op, no emit.
- **Head at exactly `clock + 2.0s`:** condition uses strict `>`, so equality keeps the frame.
- **Head far ahead, subsequent frames also far ahead:** iterates through and closes each until under threshold or empty. Single emit at the end with `closedCount` and `remainingQueue`.
- **Mixed queue (unlikely — queue is pts-sorted):** only far-future head gets flushed; near-clock frames retained. The while loop stops at the first frame within threshold.

## Testing

- **No new tests.** VideoSink has no unit test infrastructure; not added here.
- **Manual smoke** before v0.5.0 tag:
  - `docker build -t canvas:local .` clean.
  - `bun test` clean, `bun run typecheck` clean, `npm run build` clean.
  - Run against Plex on desktop. Play any item.
  - Watch for one of:
    - **Playback runs ≥60s clean** → J worked; capture trace for confirmation. `frame_flush` events may or may not fire depending on whether the decoder-ahead pattern reoccurs.
    - **Freeze persists** → capture trace. If `frame_flush` events fire but freeze continues → decoder-forward-production hypothesis confirmed; sub-project K needs deeper fix. If `frame_flush` does NOT fire → either threshold too high OR the freeze mechanism is different from what we modeled.
  - Verify existing behavior: hotspot triple-tap opens overlay, sourceType reads "plex", no OOM on ≥10 min playback.

## Rollout

1. Cut `v0.5.0` tag.
2. Publish workflow → `ghcr.io/bleichroeder/canvas:0.5.0` (private).
3. Rolling in-place update on desktop container (preserves canvas-data volume):
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.5.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.5.0
   ```
4. Reproduce the freeze scenario. Report back.

## Out of scope

- Audio worklet FIFO reset.
- Full decoder reset + seek to clock position.
- Dropping incoming far-future frames in `onFrame` (parallel approach; only revisit if drawDue skip-ahead alone is insufficient).
- Adaptive `MAX_HEAD_LEAD_SEC` computed from framerate or bitrate.
- Tests for VideoSink.
- Server-side changes.
