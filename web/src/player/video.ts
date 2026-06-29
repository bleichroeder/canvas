export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  clock: () => number;
  onError: (err: Error) => void;
  onFirstFrame?: () => void;
}

// Hard cap on decoded frames held in memory between decoder output and canvas
// paint. Each 1080p VideoFrame is ~6 MB; without a cap, any RAF stall (page
// backgrounded, GPU throttled, decoder running ahead of playback) blows the
// renderer's memory budget and Chromium kills the tab. ~12 frames is ~0.5 sec
// of 24fps content — plenty of headroom for the render loop to catch up,
// nowhere near OOM territory.
const MAX_QUEUED_FRAMES = 12;

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly clock: () => number;
  private readonly frames: VideoFrame[] = [];
  private readonly onFirstFrame: (() => void) | undefined;
  private rafHandle: number | null = null;
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
    if (this.rafHandle !== null) return;
    const tick = () => {
      this.drawDue();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
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
    // already past the clock by definition (drawDue runs every RAF and
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
