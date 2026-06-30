export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  clock: () => number;
  onError: (err: Error) => void;
  onFirstFrame?: () => void;
}

// Hard cap on decoded frames held in memory between decoder output and canvas
// paint. Each 1080p VideoFrame is ~6 MB; without a cap, any draw-loop stall
// blows the renderer's memory budget and Chromium kills the tab.
const MAX_QUEUED_FRAMES = 12;

// Draw cadence in ms. ~16ms ≈ 60Hz, more than enough for 24-30fps streams.
// We use setInterval rather than requestAnimationFrame because Tesla's
// browser throttles RAF whenever the car's UI overlays our tab (climate
// panel, autopilot status, lane-departure warnings, etc.). That throttling
// left the first frame painted and froze every subsequent one while audio
// kept playing. setInterval keeps firing regardless of focus state; vsync
// misalignment isn't perceptible at 24fps streaming content.
const DRAW_INTERVAL_MS = 16;

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly clock: () => number;
  private readonly frames: VideoFrame[] = [];
  private readonly onFirstFrame: (() => void) | undefined;
  private timerHandle: number | null = null;
  private frameIntervalSec = 1 / 24;
  private firstFrameDispatched = false;
  private droppedFrames = 0;

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
    this.clock = opts.clock;
    this.onFirstFrame = opts.onFirstFrame;
    this.decoder = new VideoDecoder({
      output: (frame) => this.onFrame(frame),
      error: (e) => opts.onError(e as unknown as Error),
    });
    this.decoder.configure(opts.config);
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
  get droppedFrameCount(): number { return this.droppedFrames; }

  private onFrame(frame: VideoFrame): void {
    if (frame.duration) {
      this.frameIntervalSec = frame.duration / 1_000_000;
    }
    // Drop the oldest queued frame if we're at capacity. Older frames are
    // already past the clock by definition (drawDue runs every tick and
    // evicts everything <= clock), so dropping them costs nothing visually
    // — and prevents the unbounded-queue OOM that crashed the renderer.
    if (this.frames.length >= MAX_QUEUED_FRAMES) {
      const oldest = this.frames.shift();
      if (oldest) oldest.close();
      this.droppedFrames++;
    }
    this.frames.push(frame);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
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
  }
}
