import { emit } from './diagnostics';
import { RangeFetcher } from './range-fetcher';
import { AutoSource } from './stream-source';
import type { StreamInfo } from './stream-source';
import { ChunkBuffer } from './chunk-buffer';

export interface BootEngineOptions {
  url: string;
  getClock: () => number;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}

export interface EngineHandle {
  /** Stop fetching and detach callbacks. Safe to call multiple times. */
  dispose(): void;
  /** Pause network fetching. Buffered samples already in flight still arrive. */
  pause(): void;
  /** Resume network fetching after pause(). No-op if not paused. */
  resume(): void;
}

/**
 * Wire the fetcher → source → callback chain for one playback session.
 *
 * The view is responsible for constructing VideoSink / AudioSink in its
 * onReady callback (the configs depend on the parsed StreamInfo). The view
 * also owns sample-buffering before the user gesture that starts playback.
 */
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
      // Fetch was aborted — emit a terminal fetch_end so the ring has a
      // record that this session's network transfer ended (status 0 = aborted).
      emit('fetch_end', { totalBytes: fetcher.currentOffset, durationMs: 0, status: 0 });
    },
    pause(): void {
      if (disposed) return;
      fetcher.pause();
    },
    resume(): void {
      if (disposed) return;
      fetcher.resume();
    },
  };
}
