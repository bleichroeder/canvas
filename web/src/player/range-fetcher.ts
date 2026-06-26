export interface RangeFetcherOptions {
  url: string;
  chunkSize?: number;
  onChunk: (offset: number, bytes: Uint8Array) => void | Promise<void>;
  onError: (err: Error) => void;
  onDone: () => void;
}

export class RangeFetcher {
  private readonly url: string;
  private readonly chunkSize: number;
  private readonly onChunk: RangeFetcherOptions['onChunk'];
  private readonly onError: RangeFetcherOptions['onError'];
  private readonly onDone: RangeFetcherOptions['onDone'];
  private offset = 0;
  private totalSize: number | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private paused = false;

  constructor(opts: RangeFetcherOptions) {
    this.url = opts.url;
    this.chunkSize = opts.chunkSize ?? 4 * 1024 * 1024;
    this.onChunk = opts.onChunk;
    this.onError = opts.onError;
    this.onDone = opts.onDone;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    void this.loop();
  }

  pause(): void { this.paused = true; }
  resume(): void { if (this.running && this.paused) { this.paused = false; void this.loop(); } }
  seek(byteOffset: number): void { this.abort(); this.offset = byteOffset; this.start(); }

  abort(): void {
    this.running = false;
    this.paused = false;
    this.controller?.abort();
    this.controller = null;
  }

  get currentOffset(): number { return this.offset; }
  get total(): number | null { return this.totalSize; }

  private async loop(): Promise<void> {
    while (this.running && !this.paused) {
      if (this.totalSize !== null && this.offset >= this.totalSize) {
        this.running = false;
        this.onDone();
        return;
      }
      const end = this.offset + this.chunkSize - 1;
      this.controller = new AbortController();
      try {
        const res = await fetch(this.url, {
          headers: { Range: `bytes=${this.offset}-${end}` },
          signal: this.controller.signal,
        });
        if (!res.ok && res.status !== 206 && res.status !== 200) {
          throw new Error(`HTTP ${res.status}`);
        }
        const range = res.headers.get('content-range');
        if (range) {
          const m = range.match(/\/(\d+)$/);
          if (m) this.totalSize = Number(m[1]);
        } else if (this.totalSize === null) {
          const len = res.headers.get('content-length');
          if (len) this.totalSize = Number(len);
        }
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length === 0) {
          this.running = false;
          this.onDone();
          return;
        }
        const offsetForChunk = this.offset;
        this.offset += buf.length;
        await this.onChunk(offsetForChunk, buf);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        this.running = false;
        this.onError(e as Error);
        return;
      }
    }
  }
}
