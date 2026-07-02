# Audio-Clock pts Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change `AudioSink.currentTime()` to return the pts of the sample the worklet is currently outputting, not cumulative playback duration. This makes video's clock reference align with actual audio playback position, closing the desync that causes video freezes after a fetcher burst.

**Architecture:** One task, two files. `web/src/player/audio-worklet.js` carries the batch's start pts in each queue entry and tracks `currentPtsSec` as samples are consumed, sending it back in the progress message. `web/src/player/audio.ts` sends `startPtsSec` on each batch, receives `currentPtsSec` from the worklet, and exposes it via `currentTime()`.

**Tech Stack:** React + Vite + TypeScript. AudioWorkletProcessor. WebCodecs AudioDecoder. Bun-runtime backend unchanged.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.6.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.** AudioWorkletProcessor runs in AudioWorkletGlobalScope; no established mock exists in canvas.
- **`framesPlayed` is kept in both files** — no longer the source of truth for `currentTime()`, but retained for backward compatibility.
- **Worklet uses the global `sampleRate`** from AudioWorkletGlobalScope. No plumbing changes required for that.
- **Only two files touched.** No changes to Player.tsx, no changes to the diagnostics event schema, no changes to VideoSink.
- **`queue_snapshot.clockSec` semantics silently shift** from "cumulative playback duration" to "audio pts being played." Field name unchanged. This is intended.
- **Queue entry shape changes** from `channels[]` to `{ channels, startPtsSec }`. The `.offset` custom property on the `channels` array is preserved (still used to track consumption within a batch).

---

## File Structure

**Modified files (two):**

- `web/src/player/audio-worklet.js`
  - Constructor: initialize `this.currentPtsSec = 0` alongside `this.framesPlayed = 0`.
  - `port.onmessage` handler: incoming `samples` messages now push `{ channels, startPtsSec }` instead of bare `channels`. `reset` message also zeroes `currentPtsSec`.
  - `process()`: reads `entry.channels` (was `chunk` directly), updates `this.currentPtsSec` from `entry.startPtsSec + (offset + toCopy) / sampleRate` each iteration, and includes `currentPtsSec` in the progress `postMessage`.

- `web/src/player/audio.ts`
  - New instance field `private currentPtsSec = 0`.
  - `onData()`: computes `startPtsSec = data.timestamp / 1_000_000` and includes it in the `samples` postMessage.
  - `port.onmessage` handler: updates `this.currentPtsSec` from `e.data.currentPtsSec` (guarded by `typeof … === 'number'`) alongside the existing `framesPlayed` update.
  - `currentTime()` returns `this.currentPtsSec` instead of `this.framesPlayed / this.sampleRate`.

**No new files. No server changes. No test files.**

---

## Task 1: Audio-clock pts tracking

**Files:**
- Modify: `web/src/player/audio-worklet.js` (constructor + onmessage + process)
- Modify: `web/src/player/audio.ts` (onData, onmessage, currentTime)

**Interfaces:**
- Consumes: `AudioData.timestamp` (microseconds) from WebCodecs — provided by the existing AudioDecoder output callback.
- Produces:
  - Worklet-to-main message: `{ type: 'progress', framesPlayed, currentPtsSec }` (was `{ type: 'progress', framesPlayed }`).
  - Main-to-worklet message: `{ type: 'samples', channels, startPtsSec }` (was `{ type: 'samples', channels }`).
  - `AudioSink.currentTime(): number` — return-type unchanged; semantics change from cumulative-duration to audio-pts-in-seconds.
  - Existing `framesPlayed` getter (if any) unchanged in shape and behavior.

- [ ] **Step 1: Update the worklet — constructor + onmessage handler**

Read `web/src/player/audio-worklet.js` first to confirm current shape. Then modify the constructor to initialize `this.currentPtsSec = 0`, and update the `port.onmessage` handler so each `samples` message pushes an object carrying the pts. Full replacement of the constructor + onmessage handler:

```javascript
class CanvasPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.framesPlayed = 0;
    this.currentPtsSec = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'samples') {
        this.queue.push({
          channels: e.data.channels,
          startPtsSec: e.data.startPtsSec,
        });
      } else if (e.data?.type === 'reset') {
        this.queue.length = 0;
        this.framesPlayed = 0;
        this.currentPtsSec = 0;
      }
    };
  }
```

The `queue` now holds `{ channels, startPtsSec }` objects, not bare `channels` arrays. This matters for Step 2.

- [ ] **Step 2: Update the worklet — `process()`**

Replace the `process()` method body with the new version that reads `entry.channels` and tracks `currentPtsSec`:

```javascript
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const channelCount = out.length;
    let filled = 0;
    while (filled < frames) {
      if (this.queue.length === 0) {
        for (let c = 0; c < channelCount; c++) {
          out[c].fill(0, filled);
        }
        break;
      }
      const entry = this.queue[0];
      const chunk = entry.channels;
      const remaining = chunk[0].length - chunk.offset;
      const toCopy = Math.min(remaining, frames - filled);
      for (let c = 0; c < channelCount; c++) {
        const src = chunk[Math.min(c, chunk.length - 1)];
        out[c].set(src.subarray(chunk.offset, chunk.offset + toCopy), filled);
      }
      // Update pts to reflect the sample we're actively consuming.
      this.currentPtsSec = entry.startPtsSec + (chunk.offset + toCopy) / sampleRate;
      chunk.offset += toCopy;
      filled += toCopy;
      this.framesPlayed += toCopy;
      if (chunk.offset >= chunk[0].length) this.queue.shift();
    }
    this.port.postMessage({
      type: 'progress',
      framesPlayed: this.framesPlayed,
      currentPtsSec: this.currentPtsSec,
    });
    return true;
  }
}
registerProcessor('canvas-player', CanvasPlayerProcessor);
```

Key differences from the old body:
- Reads `entry = this.queue[0]` and then `chunk = entry.channels` (was `chunk = this.queue[0]`).
- Updates `this.currentPtsSec` from `entry.startPtsSec + (chunk.offset + toCopy) / sampleRate` immediately AFTER copying samples and BEFORE incrementing `chunk.offset`. The formula is: pts-at-start-of-batch + (samples-consumed-from-batch) / sampleRate.
- `postMessage` payload now includes `currentPtsSec`.

`sampleRate` is a global inside AudioWorkletGlobalScope; no need to import or receive it.

- [ ] **Step 3: Update `audio.ts` — `onData()` sends `startPtsSec`**

Read `web/src/player/audio.ts` first. Find the `onData` private method (currently ends around line 108). Replace with:

```typescript
  private onData(data: AudioData): void {
    if (!this.worklet) { data.close(); return; }
    const channels: Float32Array[] = [];
    for (let c = 0; c < data.numberOfChannels; c++) {
      const buf = new Float32Array(data.numberOfFrames);
      data.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      channels.push(buf);
    }
    (channels as unknown as { offset: number }).offset = 0;
    const startPtsSec = data.timestamp / 1_000_000;
    this.worklet.port.postMessage({ type: 'samples', channels, startPtsSec });
    data.close();
  }
```

Only two changes: compute `startPtsSec = data.timestamp / 1_000_000` (WebCodecs AudioData `.timestamp` is in microseconds), and add it to the postMessage payload.

- [ ] **Step 4: Update `audio.ts` — new `currentPtsSec` field, `onmessage` handler, `currentTime()`**

Find the field declarations block (around lines 15-17). Add a new private field alongside `framesPlayed`:

```typescript
  private framesPlayed = 0;
  private currentPtsSec = 0;
```

Find the `port.onmessage` handler in the `start()` method (around lines 52-54). Replace with:

```typescript
    this.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'progress') {
        this.framesPlayed = e.data.framesPlayed;
        if (typeof e.data.currentPtsSec === 'number') {
          this.currentPtsSec = e.data.currentPtsSec;
        }
      }
    };
```

The `typeof … === 'number'` guard is defensive against a hypothetical older worklet build that lacks the field.

Find the `currentTime()` method (around line 74-76). Replace with:

```typescript
  currentTime(): number {
    return this.currentPtsSec;
  }
```

The `framesPlayed` field stays as-is — no getter changes.

- [ ] **Step 5: Verify build**

```bash
cd web
npm run build
```

Expected: `tsc --noEmit` clean + `vite build` succeeds. Only the pre-existing ~873KB chunk-size warning — no new warnings. Any NEW warnings mean regression.

- [ ] **Step 6: Commit**

```bash
git add web/src/player/audio-worklet.js web/src/player/audio.ts
git commit -m "player/audio: track audio pts in worklet, expose via currentTime()"
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
   - Watch for one of:
     - **Playback runs ≥60s cleanly** → K resolved it. Capture the trace to confirm `clockSec` in `queue_snapshot` events now closely tracks `videoHeadPtsSec`. `frame_flush` events (from J-1) should be rare or absent.
     - **Video still freezes** → grab the trace. The FIFO-depth theory is the next hypothesis: audio worklet has queued far-forward samples that take wall time to play through. Compare `clockSec` progression against `fetch_chunk` offsets and `video_frame` pts values to measure the FIFO depth. Sub-project L addresses this by throttling decoder feeding upstream.
   - Verify existing behavior intact: hotspot triple-tap opens overlay, sourceType reads "plex", no console errors, no OOM on ≥10 minutes of playback.

3. Tag + push:
   ```bash
   git tag -a v0.6.0 -m "canvas v0.6.0 — audio-clock pts tracking"
   git push origin v0.6.0
   ```

4. Wait for publish workflow → `ghcr.io/bleichroeder/canvas:0.6.0` (private).

5. Rolling in-place update on desktop container (preserves canvas-data volume):
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.6.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.6.0
   ```

6. Reproduce the scenario. Report back with the trace.

## Out of scope

- Throttling decoder input feed (sub-project L if K alone insufficient).
- Full seek-to-clock recovery.
- Audio worklet FIFO reset on desync detection.
- Tests for VideoSink/AudioSink/AudioWorklet.
- Renaming `clockSec` field on `queue_snapshot` (semantics improve; name unchanged).
- Server-side changes.
- Modifying MAX_HEAD_LEAD_SEC or the drawDue skip-ahead behavior from J.
