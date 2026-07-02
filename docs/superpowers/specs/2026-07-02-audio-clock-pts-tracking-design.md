# Sub-project K: Audio-clock pts tracking — Design

**Status:** Design approved, awaiting spec review

**Context:** Sub-project J (v0.5.0) added drawDue skip-ahead, but the trace showed `frame_flush` firing hundreds of times without resolving the freeze. Investigation of the audio worklet revealed the root cause: `AudioSink.currentTime()` returns `framesPlayed / sampleRate` — cumulative playback duration, not the pts of the sample currently being played. Under normal continuous playback these are equal (both start at 0 and advance 1×). But after a fetcher pause/resume delivers a TCP-buffered burst, the worklet's internal FIFO gets fed samples for pts=100+ content, plays them seamlessly in FIFO order, but `framesPlayed` just counts cumulative sample consumption. So `clockSec` reports 15s of playback while the worklet is actually playing pts=100 audio. Video decoder produces pts-tagged frames (pts=100+); drawDue compares them against `clockSec` (15); huge gap; drawDue rejects; freeze.

**Goal:** Change `AudioSink.currentTime()` to return the pts of the sample the worklet is currently outputting, not cumulative duration. This makes video's clock reference align with actual audio playback position.

## Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.6.0` after manual smoke passes.
- **Server code is NOT touched.** Client-only change.
- **No new deps. No new tests.**
- **Only two files touched:** `web/src/player/audio-worklet.js` (worklet-side pts tracking + progress payload) and `web/src/player/audio.ts` (send startPtsSec, consume currentPtsSec, expose via currentTime()).
- **`framesPlayed` field is kept** in both files for backward compatibility. It's simply no longer the source of truth for `currentTime()`.
- **`sampleRate` inside the worklet** uses the AudioWorkletGlobalScope global — no changes to constructor plumbing.

## The change

### File 1: `web/src/player/audio-worklet.js`

**Queue entries carry the batch's start pts.** Update the incoming-samples message handler:

```javascript
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
```

Also initialize `this.currentPtsSec = 0` alongside `this.framesPlayed = 0` in the constructor.

**Inside `process()`, track pts as samples are consumed and report it back:**

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
```

The queue-entry shape changes from `channels[]` to `{ channels, startPtsSec }`. The while-loop reads from `entry.channels` instead of directly from `chunk`. The `.offset` custom property on the channels array still gets used the same way for tracking consumption within a batch.

### File 2: `web/src/player/audio.ts`

**`onData()` sends the batch's start pts:**

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

Only two changes to this method: compute `startPtsSec` from `data.timestamp` (which is in microseconds), and add it to the postMessage payload.

**Track `currentPtsSec` in AudioSink**:

Add a new instance field:

```typescript
private currentPtsSec = 0;
```

Update the worklet-progress handler:

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

The `typeof e.data.currentPtsSec === 'number'` guard is defensive — if an older worklet build somehow ends up in production without the pts field, currentPtsSec stays 0 (which is safer than NaN or undefined).

**`currentTime()` returns the tracked pts:**

```typescript
currentTime(): number {
  return this.currentPtsSec;
}
```

`framesPlayed` and its getter (if any) stay as they are — they're just not the source of truth for playback pts anymore.

### Consequence for existing diagnostics

The `queue_snapshot` event's `clockSec` field is computed from `audioSink.currentTime()` in Player.tsx. After this change, `clockSec` will now correctly reflect actual audio pts. All previous trace analyses hold with the reinterpretation: OLD `clockSec` = cumulative-duration, NEW `clockSec` = audio pts. No renaming necessary; the field's name was always ambiguous, and the new semantics match the field's intent.

The J-1 skip-ahead in `drawDue()` uses `MAX_HEAD_LEAD_SEC = 2.0`. With the corrected clock, `frame_flush` should fire much less often — only when the queue genuinely holds frames 2+ seconds past the audio pts, which is a real desync rather than a naming artifact.

## Testing

- **No new tests.** AudioWorkletProcessor runs in a Worklet global scope; there is no established mock for it in canvas, and the change is small.
- **Manual smoke** before v0.6.0 tag:
  - `docker build -t canvas:local .` clean.
  - `bun test` clean, `bun run typecheck` clean, `npm run build` clean.
  - Play a Plex item on desktop for ≥60 seconds.
  - Watch for one of:
    - **Playback clean** → grab trace, verify `clockSec` and `videoHeadPtsSec` now track closely. `frame_flush` should be rare or absent (~0 or a small handful during startup).
    - **Freeze persists** → the FIFO-depth theory is real: audio worklet has queued far-forward samples, playing them still takes wall time. Trace shows how deep the FIFO is (compare `clockSec` progression vs `fetch_chunk` offsets). This scopes the next sub-project (throttle decoder feeding upstream, or explicitly manage the audio FIFO depth).
  - Verify existing behavior: hotspot triple-tap opens overlay, sourceType reads "plex", no OOM after 10 min.

## Rollout

1. Cut `v0.6.0` tag.
2. Publish workflow → `ghcr.io/bleichroeder/canvas:0.6.0` (private).
3. Rolling in-place update on desktop container:
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.6.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.6.0
   ```
4. Reproduce. Report back with the trace.

## Out of scope

- Throttling decoder input feed (sub-project L if K alone insufficient).
- Full seek-to-clock recovery.
- Audio worklet FIFO reset on desync.
- Tests for VideoSink/AudioSink/AudioWorklet.
- Renaming `clockSec` field on `queue_snapshot`.
- Server-side changes.
