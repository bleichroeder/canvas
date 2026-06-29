/**
 * Raw MP3 (MPEG-1/2 Audio Layer III) stream parser.
 *
 * Plex's transcoder for audio-only content (music) hands us a bare MP3 file —
 * optional ID3v2 tag at the start, then a sequence of self-contained MPEG
 * audio frames. The MKV and MP4 demuxers don't recognise that shape; this
 * source parses it and emits one EncodedAudioChunk per MPEG frame for the
 * AudioDecoder configured with codec='mp3'.
 *
 * Refs:
 *   ID3v2.4: https://id3.org/id3v2.4.0-structure (synchsafe 28-bit size at bytes 6..9)
 *   MPEG header bit layout: http://www.mp3-tech.org/programmer/frame_header.html
 */

import type { StreamSourceCallbacks } from './stream-source';

// Sample-rate tables indexed by MPEG version × sample-rate-index.
// version: 0 = MPEG 2.5, 1 = reserved (mapped to 0), 2 = MPEG 2, 3 = MPEG 1
const SAMPLE_RATE_TABLE: number[][] = [
  [11025, 12000, 8000, 0],   // MPEG 2.5
  [0, 0, 0, 0],              // reserved
  [22050, 24000, 16000, 0],  // MPEG 2
  [44100, 48000, 32000, 0],  // MPEG 1
];

// Layer III bitrate tables (kbps) indexed by version-group × bitrate-index.
// MPEG 1 Layer III:
const BITRATE_MPEG1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1];
// MPEG 2 / 2.5 Layer III:
const BITRATE_MPEG2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1];

// Samples per frame for Layer III:
//   MPEG 1   → 1152
//   MPEG 2/2.5 → 576
function samplesPerFrame(version: number): number {
  return version === 3 ? 1152 : 576;
}

interface FrameHeader {
  version: number;
  layer: number;
  bitrateKbps: number;
  sampleRate: number;
  padding: number;
  channelMode: number;
  /** Total frame size in bytes including the 4-byte header. */
  size: number;
  /** Number of audio samples this frame represents. */
  samples: number;
}

/**
 * Parse a 4-byte MPEG audio frame header. Returns null when bytes don't look
 * like a valid Layer III frame (so the caller can scan for the next sync).
 */
function parseMpegHeader(b0: number, b1: number, b2: number, b3: number): FrameHeader | null {
  // 11-bit sync: 0xFF Ex (0xFFE0..0xFFFF)
  if (b0 !== 0xff) return null;
  if ((b1 & 0xe0) !== 0xe0) return null;
  const version = (b1 >> 3) & 0x03;
  if (version === 1) return null;             // reserved
  const layer = (b1 >> 1) & 0x03;
  if (layer !== 1) return null;               // we only support Layer III
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleRateIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const channelMode = (b3 >> 6) & 0x03;
  const sampleRate = SAMPLE_RATE_TABLE[version]![sampleRateIdx]!;
  if (sampleRate === 0) return null;
  const bitrateTable = version === 3 ? BITRATE_MPEG1_L3 : BITRATE_MPEG2_L3;
  const bitrateKbps = bitrateTable[bitrateIdx]!;
  if (bitrateKbps <= 0) return null;
  const samples = samplesPerFrame(version);
  const bytesPerSample = version === 3 ? 144 : 72;  // Layer III constants
  const size = Math.floor((bytesPerSample * bitrateKbps * 1000) / sampleRate) + padding;
  if (size < 4) return null;
  return { version, layer, bitrateKbps, sampleRate, padding, channelMode, size, samples };
}

export interface Mp3SourceCallbacks extends Pick<StreamSourceCallbacks, 'onReady' | 'onAudioSample' | 'onError'> {}

/**
 * Streaming MP3 parser. Buffers incoming bytes, skips ID3v2 tag if present,
 * then emits one EncodedAudioChunk per MPEG frame. Emits onReady with the
 * AudioDecoderConfig derived from the first valid frame header.
 *
 * Duration is unknown ahead of time (no fixed-length container header); we
 * report 0 in onReady and let progress reporting catch up as audio plays.
 */
export class Mp3Source {
  private readonly opts: Mp3SourceCallbacks;
  private readonly chunks: Uint8Array[] = [];
  private bufferedSize = 0;
  private parsedOffset = 0;       // byte cursor into chunks[0]
  private ready = false;
  private errored = false;
  private sampleRate = 0;
  private channels = 0;
  private samplesEmitted = 0;
  // After ID3v2 we know how many bytes to skip before the first MPEG frame.
  // Until then this is 0; once set, the parser drops bytes until it reaches it.
  private bytesToSkip = 0;

  constructor(opts: Mp3SourceCallbacks) {
    this.opts = opts;
  }

  appendChunk(_offset: number, bytes: Uint8Array): void {
    if (this.errored) return;
    this.chunks.push(bytes);
    this.bufferedSize += bytes.length;
    try {
      this.drain();
    } catch (e) {
      this.errored = true;
      this.opts.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  flush(): void { /* no-op: we emit as frames are recognised */ }

  private drain(): void {
    // First pass: consume an ID3v2 tag if it sits at the start.
    if (!this.ready && this.bytesToSkip === 0 && this.bufferedSize >= 10) {
      const head = this.peek(10)!;
      if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) {
        // ID3v2 — bytes 6..9 are synchsafe size of the tag body (header is 10 bytes).
        const size =
          ((head[6]! & 0x7f) << 21) |
          ((head[7]! & 0x7f) << 14) |
          ((head[8]! & 0x7f) << 7) |
          (head[9]! & 0x7f);
        let total = 10 + size;
        // Footer-present flag (byte 5, bit 4) adds a 10-byte trailing
        // footer that synchsafe-size doesn't include.
        if (head[5]! & 0x10) total += 10;
        this.bytesToSkip = total;
      }
    }
    if (this.bytesToSkip > 0) {
      const drop = Math.min(this.bytesToSkip, this.bufferedSize);
      this.consume(drop);
      this.bytesToSkip -= drop;
      if (this.bytesToSkip > 0) return;
    }

    // Hot loop: pull frames out of the buffer until we run out.
    while (true) {
      // Skip any garbage bytes before a sync word.
      while (this.bufferedSize >= 4) {
        const window = this.peek(4)!;
        const hdr = parseMpegHeader(window[0]!, window[1]!, window[2]!, window[3]!);
        if (hdr) break;
        this.consume(1);
      }
      if (this.bufferedSize < 4) return;
      const window = this.peek(4)!;
      const hdr = parseMpegHeader(window[0]!, window[1]!, window[2]!, window[3]!)!;
      if (this.bufferedSize < hdr.size) return; // need more bytes for this frame
      const frame = this.peek(hdr.size)!.slice();  // detach from rolling buffer
      this.consume(hdr.size);

      if (!this.ready) {
        this.sampleRate = hdr.sampleRate;
        this.channels = hdr.channelMode === 3 ? 1 : 2;
        this.ready = true;
        this.opts.onReady({
          duration: 0,
          videoConfig: null,
          audioConfig: {
            codec: 'mp3',
            sampleRate: this.sampleRate,
            numberOfChannels: this.channels,
          },
        });
      }

      const timestampUs = Math.round((this.samplesEmitted * 1_000_000) / this.sampleRate);
      this.samplesEmitted += hdr.samples;
      this.opts.onAudioSample(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: timestampUs,
          data: frame,
        }),
      );
    }
  }

  /** Return up to `len` contiguous bytes from the buffer head; null if short. */
  private peek(len: number): Uint8Array | null {
    if (this.bufferedSize < len) return null;
    const first = this.chunks[0];
    if (first && first.length - this.parsedOffset >= len) {
      return first.subarray(this.parsedOffset, this.parsedOffset + len);
    }
    const out = new Uint8Array(len);
    let written = 0;
    let bufIdx = 0;
    let off = this.parsedOffset;
    while (written < len && bufIdx < this.chunks.length) {
      const b = this.chunks[bufIdx]!;
      const available = b.length - off;
      const need = len - written;
      const copy = Math.min(available, need);
      out.set(b.subarray(off, off + copy), written);
      written += copy;
      if (copy === available) { bufIdx++; off = 0; } else { off += copy; }
    }
    return out;
  }

  private consume(n: number): void {
    this.parsedOffset += n;
    this.bufferedSize -= n;
    while (this.chunks.length > 0) {
      const b = this.chunks[0]!;
      if (this.parsedOffset >= b.length) {
        this.parsedOffset -= b.length;
        this.chunks.shift();
      } else {
        break;
      }
    }
  }
}
