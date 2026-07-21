import { emit, sanitizeMessage } from './diagnostics';

export interface RangeFetcherOptions {
  url: string;
  chunkSize?: number;
  /**
   * Whether the URL supports HTTP byte-Range resumption. True (default) for
   * static files / seekable transcodes (Plex, Flixify) — a mid-stream drop is
   * retried with `Range: bytes=<offset>-`. False for a live transcode pipe
   * (YouTube /stream): Range is meaningless there (the server restarts the mux
   * from the top), so instead of a corrupting byte-resume we bail via
   * onInterrupted and let the engine re-open by *time*.
   */
  seekable?: boolean;
  onChunk: (offset: number, bytes: Uint8Array) => void | Promise<void>;
  onError: (err: Error) => void;
  onDone: () => void;
  /** Called for a live (non-seekable) source when the stream drops mid-transfer. */
  onInterrupted?: () => void;
}

export class RangeFetcher {
  private readonly url: string;
  private readonly seekable: boolean;
  private readonly onChunk: RangeFetcherOptions['onChunk'];
  private readonly onError: RangeFetcherOptions['onError'];
  private readonly onDone: RangeFetcherOptions['onDone'];
  private readonly onInterrupted: (() => void) | undefined;
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
    this.seekable = opts.seekable ?? true;
    this.onChunk = opts.onChunk;
    this.onError = opts.onError;
    this.onDone = opts.onDone;
    this.onInterrupted = opts.onInterrupted;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    void this.loop();
  }

  pause(): void { this.paused = true; }
  resume(): void { if (this.paused) this.paused = false; }
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
    // Retry backoff for attempts 2, 3, 4. Attempt 1 runs immediately.
    const RETRY_DELAYS_MS = [200, 500, 2000];
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (!this.running) return;
      if (attempt > 0) {
        const delayMs = RETRY_DELAYS_MS[attempt - 1]!;
        emit('fetch_retry', {
          attempt,
          delayMs,
          reason: sanitizeMessage(lastError?.message ?? 'unknown'),
        });
        await new Promise<void>((r) => setTimeout(r, delayMs));
        if (!this.running) return;
      }
      try {
        await this.attemptFetch();
        return; // clean completion — attemptFetch emitted fetch_end + called onDone.
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        lastError = e as Error;
        // Non-retryable: HTTP status error (server-side rejection).
        if (this.lastStatus >= 400) break;
        // Live (non-seekable) source: a byte-Range retry would corrupt the
        // demuxer (the server restarts the mux from the top). Bail so the
        // engine re-opens by time instead of retrying here.
        if (!this.seekable) break;
      }
    }

    // All attempts exhausted or non-retryable failure.
    this.running = false;
    if (!lastError) return;
    // Live source dropped mid-transfer on a transport (not HTTP-status) error →
    // hand off to time-based recovery rather than surfacing a fatal.
    if (!this.seekable && this.lastStatus < 400 && this.onInterrupted) {
      emit('stream_interrupted', { offset: this.offset, status: this.lastStatus });
      this.onInterrupted();
      return;
    }
    emit('fetch_error', {
      message: sanitizeMessage(lastError.message),
      offset: this.offset,
      status: this.lastStatus,
    });
    this.onError(lastError);
  }

  private async attemptFetch(): Promise<void> {
    // Body of the original loop(): one HTTP fetch, streamed via response.body.
    // On any exception (network error, reader.read throw, missing body), we
    // throw so the outer loop() decides retry vs. fatal. AbortError propagates
    // to loop() which returns silently. HTTP 4xx/5xx are thrown as Error and
    // become non-retryable via lastStatus check in loop().
    this.controller = new AbortController();
    this.startedAtMs = performance.now();
    this.totalRead = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      emit('fetch_start', {
        rangeStart: this.offset,
        rangeEnd: this.totalSize ?? null,
        hostname: new URL(this.url, typeof location !== 'undefined' ? location.href : undefined).hostname,
      });
      const res = await fetch(this.url, {
        // Only a seekable source gets a byte-Range; a live pipe can't honor one.
        headers: this.seekable && this.offset > 0 ? { Range: `bytes=${this.offset}-` } : {},
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
          // Stop pulling but keep the stream alive for resume(). TCP flow
          // control will eventually slow the server as our socket buffer
          // fills; content already in the OS/browser buffer will burst
          // through on resume (why ChunkBuffer's feed throttling exists).
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
    } finally {
      try { reader?.releaseLock(); } catch { /* ignore */ }
    }
  }
}
