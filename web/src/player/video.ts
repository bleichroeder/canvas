import { emit } from './diagnostics';

export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  clock: () => number;
  onError: (err: Error) => void;
  onFirstFrame?: () => void;
  /**
   * Backpressure signal. The sink calls this with 'pause' when the queue
   * fills past HIGH_WATER and 'resume' when it drains back to LOW_WATER.
   * Player wires it to the engine's fetcher so we stop pulling bytes (and
   * therefore stop decoding) when we have enough buffered video to play
   * out. Without this, hardware decoders that run faster than realtime
   * race ahead and fill the queue with frames whose timestamps are all in
   * the future relative to the playback clock — every frame gets dropped
   * by drawDue's tolerance check and video freezes after the first paint.
   */
  onBackpressure?: (state: 'pause' | 'resume') => void;
}

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

// Draw cadence in ms. ~16ms ≈ 60Hz, more than enough for 24-30fps streams.
// We use setInterval rather than requestAnimationFrame because Tesla's
// browser throttles RAF whenever the car's UI overlays our tab (climate
// panel, autopilot status, lane-departure warnings, etc.). setInterval
// keeps firing regardless of focus state.
const DRAW_INTERVAL_MS = 16;

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly clock: () => number;
  private readonly frames: VideoFrame[] = [];
  private readonly onFirstFrame: (() => void) | undefined;
  private readonly onBackpressure: ((state: 'pause' | 'resume') => void) | undefined;
  private timerHandle: number | null = null;
  private frameIntervalSec = 1 / 24;
  private firstFrameDispatched = false;
  private droppedFrames = 0;
  private backpressureState: 'flowing' | 'paused' = 'flowing';
  private stallTicks = 0;        // consecutive drawDue calls that didn't draw
  private stallActive = false;   // have we emitted frame_stall (waiting for recovery)?

  private emitFrame = (() => {
    let last = 0;
    return (ptsSec: number) => {
      const now = performance.now();
      if (now - last >= 1000) {
        last = now;
        emit('video_frame', { ptsSec });
      }
    };
  })();

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.clock = opts.clock;
    this.onFirstFrame = opts.onFirstFrame;
    this.onBackpressure = opts.onBackpressure;
    this.decoder = new VideoDecoder({
      output: (frame) => this.onFrame(frame),
      error: (e) => {
        emit('video_error', { message: (e as unknown as Error).message });
        opts.onError(e as unknown as Error);
      },
    });
    this.decoder.configure(opts.config);
    emit('video_configure', {
      codec: opts.config.codec,
      width: opts.config.codedWidth ?? null,
      height: opts.config.codedHeight ?? null,
    });
  }

  feed(chunk: EncodedVideoChunk): void {
    if (this.decoder.state === 'closed') return;
    this.decoder.decode(chunk);
  }

  start(): void {
    if (this.timerHandle !== null) return;
    this.timerHandle = window.setInterval(() => this.drawDue(), DRAW_INTERVAL_MS);
  }

  stop(): void {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  async flush(): Promise<void> {
    if (this.decoder.state === 'configured') await this.decoder.flush();
  }

  reset(): void {
    for (const f of this.frames) f.close();
    this.frames.length = 0;
    if (this.decoder.state === 'configured') this.decoder.reset();
  }

  close(): void {
    this.stop();
    this.reset();
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  get queuedFrames(): number { return this.frames.length; }
  get queueLength(): number { return this.frames.length; }
  get droppedFrameCount(): number { return this.droppedFrames; }
  get headPtsSec(): number | null {
    return this.frames.length > 0 ? this.frames[0]!.timestamp / 1_000_000 : null;
  }

  private onFrame(frame: VideoFrame): void {
    if (frame.duration) {
      this.frameIntervalSec = frame.duration / 1_000_000;
    }
    // Hard cap: if the queue is already at HARD_CAP, drop the INCOMING
    // frame. The oldest queued frames are the ones nearest the playback
    // clock — we need to keep them so drawDue has something to paint.
    if (this.frames.length >= HARD_CAP) {
      frame.close();
      this.droppedFrames++;
      return;
    }
    this.frames.push(frame);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    this.emitFrame(frame.timestamp / 1_000_000);
    // Signal the fetcher to pause once we've buffered enough video ahead.
    if (this.frames.length >= HIGH_WATER && this.backpressureState === 'flowing') {
      this.backpressureState = 'paused';
      emit('backpressure', { direction: 'pause', queueDepth: this.frames.length });
      if (this.onBackpressure) this.onBackpressure('pause');
    }
  }

  private drawDue(): void {
    const clockSec = this.clock();
    const clockUs = clockSec * 1_000_000;
    let drawn: VideoFrame | null = null;
    while (this.frames.length > 0) {
      const f = this.frames[0]!;
      if (f.timestamp > clockUs + this.frameIntervalSec * 500_000) break;
      this.frames.shift();
      if (drawn) drawn.close();
      drawn = f;
    }
    if (drawn) {
      this.ctx.drawImage(drawn, 0, 0, this.canvas.width, this.canvas.height);
      drawn.close();
      if (!this.firstFrameDispatched) {
        this.firstFrameDispatched = true;
        if (this.onFirstFrame) {
          try { this.onFirstFrame(); } catch { /* ignore */ }
        }
      }
    }
    // Resume the fetcher when the queue has drained enough.
    if (this.frames.length <= LOW_WATER && this.backpressureState === 'paused') {
      this.backpressureState = 'flowing';
      emit('backpressure', { direction: 'resume', queueDepth: this.frames.length });
      if (this.onBackpressure) this.onBackpressure('resume');
    }
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
  }
}
