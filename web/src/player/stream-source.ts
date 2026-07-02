/**
 * Common stream-source contract. Both the MP4 (mp4box-backed) demuxer and the
 * MKV (custom EBML) demuxer implement this. The Player view talks only to the
 * common interface and doesn't care which container is on the wire.
 */
import { emit } from './diagnostics';
import { Demuxer } from './demux';
import { MkvSource } from './mkv-source';
import { Mp3Source } from './mp3-source';

export interface StreamInfo {
  duration: number;
  videoConfig: VideoDecoderConfig | null;
  audioConfig: AudioDecoderConfig | null;
}

export interface StreamSourceCallbacks {
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onError: (err: Error) => void;
}

export interface StreamSource {
  appendChunk(offset: number, bytes: Uint8Array): void;
  flush(): void;
}

/**
 * Identify the container by sniffing the first 8 bytes of the stream.
 *   - 0x1A 0x45 0xDF 0xA3 → EBML/Matroska (MKV / WebM)
 *   - bytes 4..8 == 'ftyp' → ISOBMFF (MP4)
 */
export type StreamFormat = 'mp4' | 'mkv' | 'mp3' | 'unknown';

export function sniffFormat(head: Uint8Array): StreamFormat {
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
    return 'mkv';
  }
  if (head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return 'mp4';
  }
  // Raw MP3 — either an ID3v2 tag ('ID3') or a direct MPEG sync (0xFF 0xEx).
  if (head.length >= 3 && head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
    return 'mp3';
  }
  if (head.length >= 2 && head[0] === 0xff && ((head[1]! & 0xe0) === 0xe0)) {
    return 'mp3';
  }
  return 'unknown';
}

/**
 * Buffering source that sniffs the first chunk to pick the real demuxer,
 * then forwards all buffered + future bytes to it. Lets the caller wire the
 * RangeFetcher → source without knowing the container in advance.
 */
export class AutoSource implements StreamSource {
  private readonly opts: StreamSourceCallbacks;
  private inner: StreamSource | null = null;
  private pending: { offset: number; bytes: Uint8Array }[] = [];
  private sniffed = false;
  private head: Uint8Array = new Uint8Array(0);
  private format: StreamFormat = 'unknown';

  constructor(opts: StreamSourceCallbacks) {
    // Wrap onReady to emit demux_ready before forwarding to the caller.
    // Wrap onError to emit demux_error before forwarding to the caller.
    this.opts = {
      ...opts,
      onReady: (info) => {
        emit('demux_ready', {
          format: this.format,
          videoCodec: info.videoConfig?.codec ?? null,
          audioCodec: info.audioConfig?.codec ?? null,
          tracks: (info.videoConfig ? 1 : 0) + (info.audioConfig ? 1 : 0),
        });
        opts.onReady(info);
      },
      onError: (err) => {
        emit('demux_error', { message: err.message });
        opts.onError(err);
      },
    };
  }

  appendChunk(offset: number, bytes: Uint8Array): void {
    if (this.inner) {
      this.inner.appendChunk(offset, bytes);
      return;
    }
    // Buffer until we have enough to sniff.
    this.pending.push({ offset, bytes });
    if (this.head.length < 16) {
      const merged = new Uint8Array(this.head.length + bytes.length);
      merged.set(this.head, 0);
      merged.set(bytes, this.head.length);
      this.head = merged.subarray(0, Math.min(16, merged.length));
    }
    if (!this.sniffed && this.head.length >= 8) {
      const format = sniffFormat(this.head);
      this.sniffed = true;
      this.format = format;
      if (format === 'mkv') {
        this.inner = new MkvSourceAdapter(this.opts);
      } else if (format === 'mp4') {
        this.inner = new Mp4SourceAdapter(this.opts);
      } else if (format === 'mp3') {
        this.inner = new Mp3SourceAdapter(this.opts);
      } else {
        // demux_error is emitted by the wrapped this.opts.onError below.
        this.opts.onError(new Error(`Unrecognised container; first bytes: ${[...this.head].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join(' ')}`));
        return;
      }
      // Replay buffered chunks into the chosen source.
      for (const p of this.pending) this.inner.appendChunk(p.offset, p.bytes);
      this.pending = [];
    }
  }

  flush(): void {
    this.inner?.flush();
  }
}

/** Adapter so the MP4 path implements the common StreamSource shape. */
class Mp4SourceAdapter implements StreamSource {
  private readonly demuxer: Demuxer;
  constructor(opts: StreamSourceCallbacks) {
    this.demuxer = new Demuxer({
      onReady: (info) =>
        opts.onReady({
          duration: info.duration,
          videoConfig: info.videoConfig,
          audioConfig: info.audioConfig,
        }),
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.demuxer.appendChunk(offset, bytes); }
  flush(): void { this.demuxer.flush(); }
}

/** Adapter so the MKV path implements the common StreamSource shape. */
class MkvSourceAdapter implements StreamSource {
  private readonly mkv: MkvSource;
  constructor(opts: StreamSourceCallbacks) {
    this.mkv = new MkvSource({
      onReady: opts.onReady,
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mkv.appendChunk(offset, bytes); }
  flush(): void { this.mkv.flush(); }
}

/** Adapter so the raw-MP3 path implements the common StreamSource shape. */
class Mp3SourceAdapter implements StreamSource {
  private readonly mp3: Mp3Source;
  constructor(opts: StreamSourceCallbacks) {
    this.mp3 = new Mp3Source({
      onReady: opts.onReady,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mp3.appendChunk(offset, bytes); }
  flush(): void { this.mp3.flush(); }
}
