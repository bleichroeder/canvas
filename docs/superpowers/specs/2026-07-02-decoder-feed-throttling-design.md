# Sub-project L: Decoder feed throttling — Design

**Status:** Design approved, awaiting spec review

**Context:** K (v0.6.0) fixed `AudioSink.currentTime()` to return the pts of the sample being played. Trace confirmed the clock is correct. But the freeze persists because after fetcher pause/resume delivers a TCP-buffered burst, the demuxer processes it at ~12× realtime, feeding audio/video decoders far-forward chunks. The audio worklet's FIFO holds many seconds of unplayed samples; video decoder produces frames way ahead of the audio playback position. J-1's drawDue skip-ahead fires constantly (hundreds of `frame_flush` events per second) without recovery, because whatever the decoder produces next is also far-forward.

Additional bug observed: on the first user_gesture `play` after a session_start, `clockSec` stays at 0 for 8+ seconds before finally advancing. Audio worklet appears to not consume samples during that window despite the play gesture. Not in scope for L; will be addressed in a follow-up sub-project M.

**Goal:** Insert a `ChunkBuffer` between the demuxer's sample output and the decoders' input. Only feed decoder chunks whose pts is within `feedLeadSec` (1.5s) of the audio clock. The buffer becomes the new backpressure surface — when the buffer's tail chunk is > `pauseLeadSec` (3.0s) ahead of clock, signal fetcher pause. Video queue stays small; drawDue draws frames as clock advances; no more far-forward frame accumulation.

## Constraints

- **Branch:** direct commits on `self-host-server-port`.
- **Ship as:** `v0.7.0` after manual smoke passes.
- **Server code is NOT touched.**
- **No new deps. No new tests.**
- **Threshold values (module-level):** `feedLeadSec = 1.5`, `pauseLeadSec = 3.0`, `resumeLeadSec = 2.0`. Hysteresis on backpressure.
- **Drain cadence:** 100ms via `setInterval` inside `engine.ts`.
- **Diagnostic snapshot cadence:** 2s via `setInterval` inside `engine.ts`. Emits `chunk_buffer_snapshot` event.
- **New event kind (exact name):** `chunk_buffer_snapshot` with payload `{ videoDepth: number, audioDepth: number, tailPtsSec: number | null, clockSec: number }`.
- **KIND_COLOR value:** `chunk_buffer_snapshot: 'default'`.
- **FIFO order preserved.** Chunks are drained in push order (not sorted by pts) so H.264 B-frames work.
- **Player.tsx changes minimal.** Existing `pendingVideoChunks`/`pendingAudioChunks` (pre-user-gesture holding buffers) stay. Only new plumbing is a `getClock` param on `bootEngine`.
- **VideoSink's existing onBackpressure signal (from HIGH_WATER=48) is KEPT as a safety net.** Fetcher pauses if either signal asserts. Under normal L-2 operation the chunk-buffer signal fires first and the sink signal never does.
- **Interaction with J-1 skip-ahead + K's currentPtsSec: unchanged.** J still runs in drawDue. K's clock still drives everything. L adds a new upstream layer only.

## Architecture

**Before L:**
```
Fetcher → AutoSource → engine.ts callback → Player.onVideoSample → videoSink.feed
                                                                 → (pendingV if pre-play)
```

**After L:**
```
Fetcher → AutoSource → ChunkBuffer.push
                                       ↓  (100ms drain tick, gated by clock)
                       ChunkBuffer.drain → Player.onVideoSample → videoSink.feed
                                                                 → (pendingV if pre-play)
```

The `ChunkBuffer` is created inside `bootEngine`. `AutoSource`'s sample callbacks now push to the buffer instead of calling Player's handlers directly. The buffer's `drain()` calls Player's handlers when a chunk's pts is close enough to the clock.

**Side effect on the "audio doesn't start" bug:** with L, only ~1.5s of chunks reach Player's callbacks before user gesture (rather than 8+ seconds of chunks buffered into `pendingV`/`pendingA`). So the "video queue stuffed with pts=0-70s frames after delayed audio start" pattern is bounded to ~1.5s of pts range. The audio-startup bug itself isn't fixed by L, but its visible symptom (long freeze) is contained.

## The `ChunkBuffer` module

**File:** `web/src/player/chunk-buffer.ts` (new).

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

interface BufferedVideoChunk { ptsSec: number; chunk: EncodedVideoChunk }
interface BufferedAudioChunk { ptsSec: number; chunk: EncodedAudioChunk }

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

**Ordering:** FIFO (`shift()`). Not pts-sorted. Chunks come in decode order (which for H.264 is not strictly pts order due to B-frames); decoder handles reorder internally.

**Backpressure interaction:** the ChunkBuffer emits pause/resume via `onBackpressure`. In engine.ts this wires to `fetcher.pause()` / `fetcher.resume()`. VideoSink's existing `onBackpressure` (from HIGH_WATER=48) ALSO wires to the same fetcher pause/resume. Fetcher's own state machine handles the "either signal pauses, both must release to resume" semantics — this already exists via `RangeFetcher.pause()` / `.resume()`'s idempotent behavior.

## engine.ts integration

**File:** `web/src/player/engine.ts` — modify.

Add `getClock` to `BootEngineOptions`. Create ChunkBuffer. Route source's onSample callbacks through the buffer. Add drain + snapshot intervals. Extend `dispose()` to clear intervals and buffer.

```typescript
export interface BootEngineOptions {
  url: string;
  getClock: () => number;  // NEW
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}

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

**Import addition at top of engine.ts:**
```typescript
import { ChunkBuffer } from './chunk-buffer';
```

## Player.tsx changes

**File:** `web/src/views/Player.tsx` — one addition.

At the `bootEngine(...)` call in `bootSession`, add a `getClock` property:

```typescript
const engine = bootEngine({
  url: resolution.url,
  getClock: () => audioRef.current?.currentTime() ?? 0,
  onReady: (info) => { /* existing */ },
  onVideoSample: (chunk) => { /* existing */ },
  onAudioSample: (chunk) => { /* existing */ },
  onFatal, onDone,
});
```

`audioRef` is the existing ref for AudioSink. Before the sink is constructed (before `onReady` fires), `audioRef.current` is null and `getClock()` returns 0 — correct behavior: no chunks fed until audio is ready.

**Existing `pendingVideoChunks` / `pendingAudioChunks` pattern in Player.tsx: unchanged.** Player's onVideoSample/onAudioSample handlers still route to those pending arrays before user gesture. With L, those handlers are only called when the buffer's drain decides to feed — so `pendingV`/`pendingA` hold at most ~1.5s of chunks (bounded by feedLeadSec), not the 8+ seconds seen in the trace.

## DiagnosticsOverlay change

**File:** `web/src/components/DiagnosticsOverlay.tsx` — add one entry to `KIND_COLOR`:

```typescript
chunk_buffer_snapshot: 'default',
```

## Testing

- **No new unit tests.** Following the pattern set in G-K.
- **Manual smoke** before v0.7.0 tag:
  - `docker build -t canvas:local .` clean.
  - `bun test` clean, `bun run typecheck` clean, `npm run build` clean.
  - Play a Plex item on desktop for ≥60 seconds.
  - Expected trace on success:
    - `chunk_buffer_snapshot` shows `tailPtsSec - clockSec` staying around 1.5-3.0 (buffer throttling is working).
    - `queue_snapshot.videoQueue` stays in the 30-40 range, NOT hitting HARD_CAP=60.
    - `frame_flush` events rare or absent (drawDue's skip-ahead barely needed).
    - `videoHeadPtsSec` closely tracks `clockSec` (gap under 1s).
  - Failure signals:
    - `chunk_buffer_snapshot.tailPtsSec` still climbing far past clock → the drain isn't correctly gated. Check `getClock()`.
    - Audio silent, clockSec stuck at 0 → the deferred audio-startup bug; sub-project M scope.
    - Playback stutters visibly → feedLeadSec too tight. Bump to 2.0-2.5s.
  - Existing behavior intact: hotspot triple-tap opens overlay, sourceType reads "plex", no OOM after 10 min.

## Rollout

1. Cut `v0.7.0` tag.
2. Publish workflow → `ghcr.io/bleichroeder/canvas:0.7.0` (private).
3. Rolling in-place update:
   ```bash
   docker pull ghcr.io/bleichroeder/canvas:0.7.0
   docker rm -f canvas
   docker run -d --restart unless-stopped --name canvas \
     -p 8787:8787 -p 80:80 -p 443:443 \
     -v canvas-data:/data \
     ghcr.io/bleichroeder/canvas:0.7.0
   ```
4. Reproduce. Report back.

## Out of scope

- Audio-startup-doesn't-fire-on-first-play-gesture bug (deferred to sub-project M).
- Adaptive `feedLeadSec` (framerate-dependent tuning).
- Removing `pendingV`/`pendingA` from Player.tsx entirely.
- Chunk buffer memory cap / eviction policy (relies on backpressure to bound growth).
- Tests for ChunkBuffer.
- Modifying HIGH_WATER / LOW_WATER / HARD_CAP or the frame_stall watchdog thresholds.
- Modifying MAX_HEAD_LEAD_SEC or the drawDue skip-ahead behavior from J.
