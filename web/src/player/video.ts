export interface VideoSinkOptions {
  canvas: HTMLCanvasElement;
  config: VideoDecoderConfig;
  onError: (err: Error) => void;
}

export class VideoSink {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly decoder: VideoDecoder;
  private readonly frames: VideoFrame[] = [];
  private startTimeUs: number | null = null;
  private startWallMs: number | null = null;
  private rafHandle: number | null = null;
  private maxQueued = 8;

  constructor(opts: VideoSinkOptions) {
    this.canvas = opts.canvas;
    this.canvas.width = opts.config.codedWidth ?? 1280;
    this.canvas.height = opts.config.codedHeight ?? 720;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    this.ctx = ctx;
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

  close(): void {
    this.stop();
    for (const f of this.frames) f.close();
    this.frames.length = 0;
    if (this.decoder.state !== 'closed') this.decoder.close();
  }

  get queuedFrames(): number { return this.frames.length; }

  get backpressure(): boolean { return this.frames.length >= this.maxQueued; }

  private onFrame(frame: VideoFrame): void {
    this.frames.push(frame);
    this.frames.sort((a, b) => a.timestamp - b.timestamp);
    if (this.frames.length > this.maxQueued * 2) {
      const dropped = this.frames.shift();
      dropped?.close();
    }
  }

  private nowUs(): number {
    if (this.startTimeUs === null || this.startWallMs === null) {
      if (this.frames.length === 0) return 0;
      this.startTimeUs = this.frames[0]!.timestamp;
      this.startWallMs = performance.now();
      return this.startTimeUs;
    }
    return this.startTimeUs + (performance.now() - this.startWallMs) * 1000;
  }

  private drawDue(): void {
    const now = this.nowUs();
    let drawn: VideoFrame | null = null;
    while (this.frames.length > 0 && this.frames[0]!.timestamp <= now) {
      const f = this.frames.shift()!;
      if (drawn) drawn.close();
      drawn = f;
    }
    if (drawn) {
      this.ctx.drawImage(drawn, 0, 0, this.canvas.width, this.canvas.height);
      drawn.close();
    }
  }
}
