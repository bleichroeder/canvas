import { RangeFetcher } from './range-fetcher';
import { AutoSource } from './stream-source';
import type { StreamInfo } from './stream-source';

export interface BootEngineOptions {
  url: string;
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

  const source = new AutoSource({
    onReady: (info) => { if (!disposed) opts.onReady(info); },
    onVideoSample: (c) => { if (!disposed) opts.onVideoSample(c); },
    onAudioSample: (c) => { if (!disposed) opts.onAudioSample(c); },
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

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      fetcher.abort();
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
