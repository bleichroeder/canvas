import { emit, sanitizeMessage } from './diagnostics';

export interface RangeFetcherOptions {
  url: string;
  chunkSize?: number;
  onChunk: (offset: number, bytes: Uint8Array) => void | Promise<void>;
  onError: (err: Error) => void;
  onDone: () => void;
}

export class RangeFetcher {
  private readonly url: string;
  private readonly onChunk: RangeFetcherOptions['onChunk'];
  private readonly onError: RangeFetcherOptions['onError'];
  private readonly onDone: RangeFetcherOptions['onDone'];
  private offset = 0;
  private totalSize: number | null = null;
  private controller: AbortController | null = null;
  private running = false;
  private paused = false;
  private totalRead = 0;
  private startedAtMs = 0;
  private lastStatus = 0;

  private emitChunk = (() => {
    let last = 0;
    return (offset: number, size: number) => {
      const now = performance.now();
      if (now - last >= 1000) {
        last = now;
        emit('fetch_chunk', { offset, size });
      }
    };
  })();

  constructor(opts: RangeFetcherOptions) {
    this.url = opts.url;
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
    // One fetch, streamed via response.body. Range header is still sent so
    // servers that support Partial Content (206) can resume from `this.offset`
    // after a seek; servers that don't (Plex's transcoder serves the full file
    // as 200) work too — we just stream the whole body as it arrives. Either
    // way, onChunk fires per network read, not after the response completes.
    this.controller = new AbortController();
    this.startedAtMs = performance.now();
    this.totalRead = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      emit('fetch_start', {
        rangeStart: this.offset,
        rangeEnd: this.totalSize ?? null,
        hostname: new URL(this.url).hostname,
      });
      const res = await fetch(this.url, {
        headers: this.offset > 0 ? { Range: `bytes=${this.offset}-` } : {},
        signal: this.controller.signal,
        referrerPolicy: 'no-referrer',
      });
      this.lastStatus = res.status;
      if (!res.ok && res.status !== 206 && res.status !== 200) {
        throw new Error(`HTTP ${res.status}`);
      }
      const range = res.headers.get('content-range');
      if (range) {
        const m = range.match(/\/(\d+)$/);
        if (m) this.totalSize = Number(m[1]);
      } else {
        const len = res.headers.get('content-length');
        if (len) this.totalSize = this.offset + Number(len);
      }

      const body = res.body;
      if (!body) throw new Error('response has no body');
      reader = body.getReader();
      while (this.running) {
        if (this.paused) {
          // Stop pulling but keep the stream alive for resume(); browsers will
          // back-pressure the underlying network connection when we stop reading.
          await new Promise<void>((resolve) => {
            const tick = () => {
              if (!this.running || !this.paused) resolve();
              else setTimeout(tick, 200);
            };
            tick();
          });
          if (!this.running) break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        const offsetForChunk = this.offset;
        this.offset += value.length;
        this.totalRead += value.length;
        this.emitChunk(offsetForChunk, value.length);
        await this.onChunk(offsetForChunk, value);
      }
      if (this.running) {
        this.running = false;
        emit('fetch_end', {
          totalBytes: this.totalRead,
          durationMs: Math.round(performance.now() - this.startedAtMs),
          status: this.lastStatus,
        });
        this.onDone();
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      this.running = false;
      emit('fetch_error', {
        message: sanitizeMessage((e as Error).message),
        offset: this.offset,
        status: this.lastStatus,
      });
      this.onError(e as Error);
    } finally {
      try { reader?.releaseLock(); } catch { /* ignore */ }
    }
  }
}
