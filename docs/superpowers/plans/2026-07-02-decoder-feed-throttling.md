# Decoder Feed Throttling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert a `ChunkBuffer` between the demuxer's sample output and the decoders' input. Feed decoder chunks only when their pts is within 1.5s of the audio clock. Signal fetcher backpressure from the buffer's tail-vs-clock gap. Ship as `v0.7.0`.

**Architecture:** One task. New module `web/src/player/chunk-buffer.ts` implements a FIFO buffer with drain-on-clock semantics and hysteresis-based backpressure. `web/src/player/engine.ts` creates the buffer inside `bootEngine`, routes `AutoSource`'s sample callbacks through the buffer, and runs a 100ms drain interval + 2s diagnostic-snapshot interval. `web/src/views/Player.tsx` adds `getClock` to the `bootEngine` call. `web/src/components/DiagnosticsOverlay.tsx` gets a `KIND_COLOR` entry for the new event.

**Tech Stack:** React + Vite + TypeScript. WebCodecs (EncodedVideoChunk / EncodedAudioChunk). Bun-runtime backend unchanged.

## Global Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.7.0` after manual smoke passes.
- **Server code is NOT touched.**
- **No new deps. No new tests.**
- **Threshold values:** `feedLeadSec = 1.5`, `pauseLeadSec = 3.0`, `resumeLeadSec = 2.0`. Passed to `ChunkBuffer` from `engine.ts`.
- **Drain interval:** 100ms `setInterval`.
- **Snapshot interval:** 2000ms `setInterval`.
- **New event kind (exact name):** `chunk_buffer_snapshot` with payload `{ videoDepth: number, audioDepth: number, tailPtsSec: number | null, clockSec: number }`.
- **KIND_COLOR value:** `chunk_buffer_snapshot: 'default'`.
- **FIFO order preserved** — chunks drained in push order, NOT sorted by pts (B-frame safety).
- **VideoSink's existing onBackpressure signal is KEPT.** No changes to VideoSink. The new chunk-buffer signal and the old sink signal both route to `fetcher.pause()` / `fetcher.resume()` — the fetcher's `pause`/`resume` methods are idempotent and paused-flag-based, so the "either signal pauses, both must release" behavior is automatic.
- **Existing `pendingVideoChunks`/`pendingAudioChunks` in Player.tsx are unchanged.** They still hold chunks pre-user-gesture; L just bounds their content to ~1.5s worth of chunks instead of many seconds.
- **No changes to VideoSink, AudioSink, RangeFetcher, AutoSource, or the audio worklet.**

---

## File Structure

**Created:**
- `web/src/player/chunk-buffer.ts` — new module. `ChunkBuffer` class + `ChunkBufferOptions` interface. FIFO video + audio queues, `pushVideo`/`pushAudio`/`drain`/`snapshot`/`clear` methods, private hysteresis-based `updateBackpressure`.

**Modified:**
- `web/src/player/engine.ts` — extend `BootEngineOptions` with `getClock`. Construct `ChunkBuffer` inside `bootEngine`. Route `AutoSource`'s sample callbacks through the buffer. Add drain + snapshot `setInterval`s. Extend `dispose()` to clear intervals + buffer.
- `web/src/views/Player.tsx` — add `getClock: () => audioRef.current?.currentTime() ?? 0` to the `bootEngine(...)` call inside `bootSession`. No other changes.
- `web/src/components/DiagnosticsOverlay.tsx` — one entry in `KIND_COLOR`: `chunk_buffer_snapshot: 'default'`.

**No new files elsewhere. No new tests.**

---

## Task 1: ChunkBuffer + engine integration + Player wiring

**Files:**
- Create: `web/src/player/chunk-buffer.ts`
- Modify: `web/src/player/engine.ts`
- Modify: `web/src/views/Player.tsx`
- Modify: `web/src/components/DiagnosticsOverlay.tsx`

**Interfaces:**
- Consumes: `emit` from `./diagnostics` (already imported in engine.ts). `AudioSink.currentTime(): number` (existing, from K).
- Produces:
  - `ChunkBuffer` class exported from `./chunk-buffer` with methods `pushVideo`, `pushAudio`, `drain`, `snapshot`, `clear`.
  - `ChunkBufferOptions` interface.
  - New event kind `chunk_buffer_snapshot` emitted from engine.ts.
  - `BootEngineOptions.getClock: () => number` (new required field).

- [ ] **Step 1: Create `chunk-buffer.ts`**

Create `web/src/player/chunk-buffer.ts`:

```typescript
export interface ChunkBufferOptions {
  getClock: () => number;
  feedLeadSec: number;
  pauseLeadSec: number;
  resumeLeadSec: number;
  onFeedVideo: (chunk: EncodedVideoChunk) => void;
  onFeedAudio: (chunk: EncodedAudioChunk) => void;
  onBackpressure: (state: 'pause' | 'resume') => void;
}

interface BufferedVideoChunk {
  ptsSec: number;
  chunk: EncodedVideoChunk;
}

interface BufferedAudioChunk {
  ptsSec: number;
  chunk: EncodedAudioChunk;
}

export class ChunkBuffer {
  private videoQueue: BufferedVideoChunk[] = [];
  private audioQueue: BufferedAudioChunk[] = [];
  private state: 'flowing' | 'paused' = 'flowing';

  constructor(private opts: ChunkBufferOptions) {}

  pushVideo(chunk: EncodedVideoChunk): void {
    this.videoQueue.push({ ptsSec: chunk.timestamp / 1_000_000, chunk });
    this.updateBackpressure();
  }

  pushAudio(chunk: EncodedAudioChunk): void {
    this.audioQueue.push({ ptsSec: chunk.timestamp / 1_000_000, chunk });
    this.updateBackpressure();
  }

  drain(): { videoFed: number; audioFed: number } {
    const clock = this.opts.getClock();
    const feedUpTo = clock + this.opts.feedLeadSec;
    let videoFed = 0;
    let audioFed = 0;
    while (this.videoQueue.length > 0 && this.videoQueue[0]!.ptsSec <= feedUpTo) {
      const entry = this.videoQueue.shift()!;
      this.opts.onFeedVideo(entry.chunk);
      videoFed++;
    }
    while (this.audioQueue.length > 0 && this.audioQueue[0]!.ptsSec <= feedUpTo) {
      const entry = this.audioQueue.shift()!;
      this.opts.onFeedAudio(entry.chunk);
      audioFed++;
    }
    this.updateBackpressure();
    return { videoFed, audioFed };
  }

  snapshot(): { videoDepth: number; audioDepth: number; tailPtsSec: number | null } {
    const tailV = this.videoQueue.length > 0
      ? this.videoQueue[this.videoQueue.length - 1]!.ptsSec
      : null;
    const tailA = this.audioQueue.length > 0
      ? this.audioQueue[this.audioQueue.length - 1]!.ptsSec
      : null;
    let tailPtsSec: number | null;
    if (tailV != null && tailA != null) tailPtsSec = Math.max(tailV, tailA);
    else tailPtsSec = tailV ?? tailA;
    return {
      videoDepth: this.videoQueue.length,
      audioDepth: this.audioQueue.length,
      tailPtsSec,
    };
  }

  clear(): void {
    this.videoQueue.length = 0;
    this.audioQueue.length = 0;
  }

  private updateBackpressure(): void {
    const { tailPtsSec } = this.snapshot();
    if (tailPtsSec === null) return;
    const clock = this.opts.getClock();
    const lead = tailPtsSec - clock;
    if (this.state === 'flowing' && lead >= this.opts.pauseLeadSec) {
      this.state = 'paused';
      this.opts.onBackpressure('pause');
    } else if (this.state === 'paused' && lead <= this.opts.resumeLeadSec) {
      this.state = 'flowing';
      this.opts.onBackpressure('resume');
    }
  }
}
```

- [ ] **Step 2: Add `getClock` to `BootEngineOptions` in engine.ts**

Read `web/src/player/engine.ts` first. The current `BootEngineOptions` interface (lines 6-13) becomes:

```typescript
export interface BootEngineOptions {
  url: string;
  getClock: () => number;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}
```

Only one addition: `getClock: () => number` between `url` and `onReady`.

- [ ] **Step 3: Wire ChunkBuffer into `bootEngine` in engine.ts**

Add the import at the top of `engine.ts` (near the existing imports):

```typescript
import { ChunkBuffer } from './chunk-buffer';
```

Then replace the body of `bootEngine` (the block starting `let disposed = false;` through the returned object) with:

```typescript
export function bootEngine(opts: BootEngineOptions): EngineHandle {
  let disposed = false;

  const buffer = new ChunkBuffer({
    getClock: opts.getClock,
    feedLeadSec: 1.5,
    pauseLeadSec: 3.0,
    resumeLeadSec: 2.0,
    onFeedVideo: (c) => { if (!disposed) opts.onVideoSample(c); },
    onFeedAudio: (c) => { if (!disposed) opts.onAudioSample(c); },
    onBackpressure: (state) => {
      if (disposed) return;
      if (state === 'pause') fetcher.pause();
      else fetcher.resume();
    },
  });

  const source = new AutoSource({
    onReady: (info) => { if (!disposed) opts.onReady(info); },
    onVideoSample: (c) => { if (!disposed) buffer.pushVideo(c); },
    onAudioSample: (c) => { if (!disposed) buffer.pushAudio(c); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
  });

  const fetcher = new RangeFetcher({
    url: opts.url,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { if (!disposed) source.appendChunk(offset, bytes); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
    onDone: () => { if (!disposed) { source.flush(); opts.onDone(); } },
  });
  fetcher.start();

  const drainInterval = window.setInterval(() => {
    if (disposed) return;
    buffer.drain();
  }, 100);

  const snapshotInterval = window.setInterval(() => {
    if (disposed) return;
    const s = buffer.snapshot();
    emit('chunk_buffer_snapshot', {
      videoDepth: s.videoDepth,
      audioDepth: s.audioDepth,
      tailPtsSec: s.tailPtsSec,
      clockSec: opts.getClock(),
    });
  }, 2000);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      window.clearInterval(drainInterval);
      window.clearInterval(snapshotInterval);
      fetcher.abort();
      buffer.clear();
      emit('fetch_end', { totalBytes: fetcher.currentOffset, durationMs: 0, status: 0 });
    },
    pause(): void { if (!disposed) fetcher.pause(); },
    resume(): void { if (!disposed) fetcher.resume(); },
  };
}
```

Two key differences from the current body:
- The `buffer` is constructed FIRST (its `onBackpressure` closure references `fetcher`, which is declared later — TypeScript is fine with this because the closure isn't called until push/drain runs, by which time `fetcher` is defined).
- The `source`'s `onVideoSample`/`onAudioSample` callbacks now push to the buffer, NOT to `opts.onVideoSample`/`opts.onAudioSample`.
- Two `setInterval`s added: one 100ms drain, one 2000ms snapshot.
- `dispose()` clears both intervals and the buffer.

- [ ] **Step 4: Add `getClock` in Player.tsx's `bootEngine(...)` call**

Read `web/src/views/Player.tsx` and find where `bootEngine(...)` is called inside `bootSession`. The existing call looks roughly like:

```typescript
const engine = bootEngine({
  url: resolution.url,
  onReady: (info) => { /* ... */ },
  onVideoSample: (chunk) => { /* ... */ },
  onAudioSample: (chunk) => { /* ... */ },
  onFatal, onDone,
});
```

Add `getClock` immediately after `url`:

```typescript
const engine = bootEngine({
  url: resolution.url,
  getClock: () => audioRef.current?.currentTime() ?? 0,
  onReady: (info) => { /* ... */ },
  onVideoSample: (chunk) => { /* ... */ },
  onAudioSample: (chunk) => { /* ... */ },
  onFatal, onDone,
});
```

`audioRef` is the existing React ref for the AudioSink instance (grep the file to confirm the exact ref name — it might be `audioSinkRef` or similar). Match the actual name used in the file. Before the sink is constructed, `audioRef.current` is `null` and `getClock()` returns 0 — which is correct behavior (no chunks flow to decoders until clock is real).

- [ ] **Step 5: Add `chunk_buffer_snapshot` to KIND_COLOR**

Read `web/src/components/DiagnosticsOverlay.tsx` and find the `KIND_COLOR: Record<string, string>` object. Add one entry:

```typescript
chunk_buffer_snapshot: 'default',
```

Place it near the other snapshot-style entries (adjacent to `queue_snapshot` if that entry exists; if not, place it in alphabetical or thematic order). Match the map's existing indentation and trailing-comma style.

- [ ] **Step 6: Verify build**

```bash
cd web
npm run build
```

Expected: `tsc --noEmit` clean + `vite build` succeeds. Only the pre-existing ~873KB chunk-size warning — no new warnings. Any NEW warnings mean regression.

- [ ] **Step 7: Commit**

```bash
git add web/src/player/chunk-buffer.ts web/src/player/engine.ts web/src/views/Player.tsx web/src/components/DiagnosticsOverlay.tsx
git commit -m "player: decoder feed throttling via ChunkBuffer"
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
   - Expected trace on success:
     - `chunk_buffer_snapshot` events (every 2s) show `tailPtsSec - clockSec` staying around 1.5-3.0 (buffer is drain-throttled correctly).
     - `queue_snapshot.videoQueue` stays in the 30-40 range (feedLeadSec × 24fps ≈ 36), NOT hitting HARD_CAP=60.
     - `frame_flush` events rare or absent.
     - `videoHeadPtsSec` closely tracks `clockSec` (gap under ~1s consistently).
   - Failure signals:
     - `chunk_buffer_snapshot.tailPtsSec` still climbing far past clock → the drain isn't correctly gated. Check `getClock()` returns non-zero.
     - Audio silent + `clockSec` stuck at 0 → the deferred audio-startup bug from K's trace; scoped as sub-project M.
     - Playback stutters visibly → `feedLeadSec` too tight; bump the module-level default in `engine.ts:bootEngine` from 1.5 to 2.0-2.5s.
   - Verify existing behavior intact: hotspot triple-tap opens overlay, sourceType reads "plex", no console errors, no OOM after ≥10 minutes.

3. Tag + push:
   ```bash
   git tag -a v0.7.0 -m "canvas v0.7.0 — decoder feed throttling"
   git push origin v0.7.0
   ```

4. Wait for publish workflow → `ghcr.io/bleichroeder/canvas:0.7.0` (private).

5. Rolling in-place update on desktop container:
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.7.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.7.0
   ```

6. Reproduce the scenario. Report back with the trace.

## Out of scope

- Audio-startup-doesn't-fire-on-first-play-gesture bug (deferred to sub-project M).
- Adaptive `feedLeadSec` (framerate-dependent tuning).
- Removing `pendingV`/`pendingA` from Player.tsx entirely.
- Chunk buffer memory cap / eviction policy (relies on backpressure to bound growth).
- Tests for ChunkBuffer.
- Modifying HIGH_WATER / LOW_WATER / HARD_CAP or the frame_stall watchdog from I.
- Modifying MAX_HEAD_LEAD_SEC or drawDue skip-ahead from J.
- Server-side changes.
