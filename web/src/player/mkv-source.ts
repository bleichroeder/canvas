/**
 * Minimal incremental MKV/EBML demuxer.
 *
 * Feeds bytes from a streaming source (Plex's transcoded MKV output), extracts
 * H.264 + AAC codec configurations and per-frame samples, and emits
 * EncodedVideoChunk / EncodedAudioChunk objects directly consumable by the
 * existing WebCodecs pipeline.
 *
 * Scope: SimpleBlock frames only (no BlockGroup), H.264 video + AAC audio.
 * Anything else surfaces an explicit error.
 *
 * EBML spec references:
 *   https://www.rfc-editor.org/rfc/rfc8794 (EBML)
 *   https://www.matroska.org/technical/elements.html (Matroska element IDs)
 */

// Matroska element IDs (encoded VINT form, exact bytes including length prefix).
const ID_EBML_HEADER = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_TIMESTAMP_SCALE = 0x2ad7b1;
const ID_DURATION = 0x4489;
const ID_TRACKS = 0x1654ae6b;
const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_TRACK_TYPE = 0x83;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;
const ID_VIDEO = 0xe0;
const ID_PIXEL_WIDTH = 0xb0;
const ID_PIXEL_HEIGHT = 0xba;
const ID_AUDIO = 0xe1;
const ID_SAMPLING_FREQUENCY = 0xb5;
const ID_CHANNELS = 0x9f;
const ID_CLUSTER = 0x1f43b675;
const ID_TIMESTAMP = 0xe7;
const ID_SIMPLE_BLOCK = 0xa3;
const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_CUES = 0x1c53bb6b;

const TRACK_TYPE_VIDEO = 1;
const TRACK_TYPE_AUDIO = 2;

const CODEC_H264 = 'V_MPEG4/ISO/AVC';
const CODEC_AAC = 'A_AAC';

export interface MkvInfo {
  duration: number;
  videoConfig: VideoDecoderConfig | null;
  audioConfig: AudioDecoderConfig | null;
}

export interface MkvSourceCallbacks {
  onReady: (info: MkvInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onError: (err: Error) => void;
}

interface TrackInfo {
  trackNumber: number;
  trackType: number;
  codecId: string;
  codecPrivate: Uint8Array | null;
  pixelWidth: number;
  pixelHeight: number;
  samplingFrequency: number;
  channels: number;
}

export class MkvSource {
  private readonly opts: MkvSourceCallbacks;
  private readonly buffers: Uint8Array[] = [];
  private bufferedSize = 0;
  private parsedOffset = 0;     // bytes already consumed from the head of buffers
  private absoluteOffset = 0;   // total bytes ever appended
  private ready = false;
  private errored = false;
  private timestampScaleNs = 1_000_000; // default 1ms per MKV unit
  private duration = 0;
  private tracks: TrackInfo[] = [];
  private videoTrackNumber: number | null = null;
  private audioTrackNumber: number | null = null;
  private clusterTimestamp = 0;

  // For Plex transcoder streams the Segment is "unknown size" — VINT
  // 0x01FFFFFFFFFFFFFF. We don't enforce its length; we parse children
  // sequentially until the byte stream ends.

  constructor(opts: MkvSourceCallbacks) {
    this.opts = opts;
  }

  appendChunk(_offset: number, bytes: Uint8Array): void {
    if (this.errored) return;
    this.buffers.push(bytes);
    this.bufferedSize += bytes.length;
    this.absoluteOffset += bytes.length;
    if (this.absoluteOffset < 4_000_000 || this.absoluteOffset % 4_000_000 < bytes.length) {
      console.log('[mkv] appended', bytes.length, 'bytes; total=', this.absoluteOffset, 'buffered=', this.bufferedSize, 'ready=', this.ready);
    }
    try {
      this.drain();
    } catch (e) {
      this.errored = true;
      console.error('[mkv] drain threw:', e);
      this.opts.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  flush(): void {
    // No-op: we already emit samples as they arrive. Kept for API symmetry
    // with the MP4 path.
  }

  /** Try to parse as many complete elements out of the buffered bytes as we can. */
  private drain(): void {
    let iter = 0;
    while (true) {
      iter++;
      if (iter > 100000) {
        console.error('[mkv] drain iter limit; head bytes:', this.peek(16));
        throw new Error('MKV: drain iter limit hit');
      }
      const head = this.peek(16);
      if (!head) return;
      const idResult = readVintFromBytes(head, 0);
      if (!idResult) return;
      const sizeResult = readVintFromBytes(head, idResult.byteLength);
      if (!sizeResult) return;
      const headerLen = idResult.byteLength + sizeResult.byteLength;

      const isContainer =
        idResult.id === ID_SEGMENT ||
        idResult.id === ID_INFO ||
        idResult.id === ID_TRACKS ||
        idResult.id === ID_TRACK_ENTRY ||
        idResult.id === ID_VIDEO ||
        idResult.id === ID_AUDIO ||
        idResult.id === ID_CLUSTER ||
        idResult.id === ID_BLOCK_GROUP;

      if (isContainer) {
        if (!this.ready || idResult.id === ID_CLUSTER) {
          console.log('[mkv] container id=0x' + idResult.id.toString(16), 'size=', sizeResult.size, 'headerLen=', headerLen);
        }
        this.consume(headerLen);
        if (idResult.id === ID_TRACK_ENTRY) {
          this.tracks.push({
            trackNumber: 0,
            trackType: 0,
            codecId: '',
            codecPrivate: null,
            pixelWidth: 0,
            pixelHeight: 0,
            samplingFrequency: 0,
            channels: 0,
          });
        } else if (idResult.id === ID_CLUSTER) {
          this.clusterTimestamp = 0;
          if (!this.ready && this.tracks.length > 0) {
            this.finalizeReady();
          }
        }
        continue;
      }

      const payloadSize = sizeResult.size;
      if (payloadSize === null) {
        throw new Error(`MKV: unknown-size leaf element 0x${idResult.id.toString(16)}`);
      }
      const total = headerLen + payloadSize;
      if (this.bufferedSize < total) {
        if (!this.ready && payloadSize > 1_000_000) {
          console.log('[mkv] waiting for big leaf id=0x' + idResult.id.toString(16), 'payloadSize=', payloadSize, 'have=', this.bufferedSize);
        }
        return;
      }

      const payload = this.peek(total)!.subarray(headerLen, total);
      if (!this.ready) {
        console.log('[mkv] leaf id=0x' + idResult.id.toString(16), 'payloadSize=', payloadSize);
      }
      this.handleLeaf(idResult.id, payload);
      this.consume(total);
    }
  }

  private handleLeaf(id: number, payload: Uint8Array): void {
    switch (id) {
      case ID_EBML_HEADER:
      case ID_SEEK_HEAD:
      case ID_CUES:
        // Skip — we don't need these for streaming playback.
        return;
      case ID_TIMESTAMP_SCALE:
        this.timestampScaleNs = readUint(payload);
        return;
      case ID_DURATION: {
        const f = readFloat(payload);
        if (Number.isFinite(f) && f > 0) {
          this.duration = (f * this.timestampScaleNs) / 1_000_000_000;
        }
        return;
      }
      case ID_TRACK_NUMBER: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.trackNumber = readUint(payload);
        return;
      }
      case ID_TRACK_TYPE: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.trackType = readUint(payload);
        return;
      }
      case ID_CODEC_ID: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.codecId = new TextDecoder().decode(payload).replace(/\0+$/, '');
        return;
      }
      case ID_CODEC_PRIVATE: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.codecPrivate = new Uint8Array(payload);
        return;
      }
      case ID_PIXEL_WIDTH: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.pixelWidth = readUint(payload);
        return;
      }
      case ID_PIXEL_HEIGHT: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.pixelHeight = readUint(payload);
        return;
      }
      case ID_SAMPLING_FREQUENCY: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.samplingFrequency = readFloat(payload);
        return;
      }
      case ID_CHANNELS: {
        const t = this.tracks[this.tracks.length - 1];
        if (t) t.channels = readUint(payload);
        return;
      }
      case ID_TIMESTAMP:
        this.clusterTimestamp = readUint(payload);
        return;
      case ID_SIMPLE_BLOCK:
      case ID_BLOCK:
        this.handleBlock(id, payload);
        return;
      default:
        // Silently skip unknown elements.
        return;
    }
  }

  private handleBlock(id: number, payload: Uint8Array): void {
    // SimpleBlock: VINT track | int16 BE relative timestamp | byte flags | frame data
    // Block (inside BlockGroup): same layout but keyframe inferred from
    //   ReferenceBlock absence inside the BlockGroup; we don't track that, so
    //   Block samples are always marked 'delta'.
    const trackVint = readVintFromBytes(payload, 0);
    if (trackVint === null || trackVint.size === null) return;
    // Track number is a VINT *value* (marker bit stripped), not an EBML element
    // ID — use .size rather than .id.
    const trackNumber = trackVint.size;
    const tsDeltaOffset = trackVint.byteLength;
    if (payload.length < tsDeltaOffset + 3) return;
    const tsDelta =
      (payload[tsDeltaOffset]! << 8) | payload[tsDeltaOffset + 1]!;
    // Sign-extend 16-bit
    const tsDeltaSigned = tsDelta > 0x7fff ? tsDelta - 0x10000 : tsDelta;
    const flags = payload[tsDeltaOffset + 2]!;
    const frameStart = tsDeltaOffset + 3;
    const frameData = payload.subarray(frameStart);

    const absTs = this.clusterTimestamp + tsDeltaSigned;
    const tsMicroseconds = Math.round((absTs * this.timestampScaleNs) / 1000);

    if (trackNumber === this.videoTrackNumber) {
      const isKey = id === ID_SIMPLE_BLOCK
        ? (flags & 0x80) !== 0
        : false; // BlockGroup keyframe inference deferred
      this.opts.onVideoSample(
        new EncodedVideoChunk({
          type: isKey ? 'key' : 'delta',
          timestamp: tsMicroseconds,
          data: frameData,
        }),
      );
    } else if (trackNumber === this.audioTrackNumber) {
      this.opts.onAudioSample(
        new EncodedAudioChunk({
          type: 'key',
          timestamp: tsMicroseconds,
          data: frameData,
        }),
      );
    }
  }

  private finalizeReady(): void {
    if (this.ready) return;
    this.ready = true;

    let videoConfig: VideoDecoderConfig | null = null;
    let audioConfig: AudioDecoderConfig | null = null;

    for (const t of this.tracks) {
      if (t.trackType === TRACK_TYPE_VIDEO && this.videoTrackNumber === null) {
        if (t.codecId !== CODEC_H264) {
          this.opts.onError(new Error(`MKV: unsupported video codec ${t.codecId}; only H.264 (${CODEC_H264}) supported`));
          this.errored = true;
          return;
        }
        if (!t.codecPrivate) {
          this.opts.onError(new Error('MKV: H.264 track missing CodecPrivate (avcC)'));
          this.errored = true;
          return;
        }
        const codecString = avcCodecString(t.codecPrivate);
        this.videoTrackNumber = t.trackNumber;
        videoConfig = {
          codec: codecString,
          codedWidth: t.pixelWidth,
          codedHeight: t.pixelHeight,
          description: t.codecPrivate,
        };
      } else if (t.trackType === TRACK_TYPE_AUDIO && this.audioTrackNumber === null) {
        if (t.codecId !== CODEC_AAC) {
          this.opts.onError(new Error(`MKV: unsupported audio codec ${t.codecId}; only AAC supported`));
          this.errored = true;
          return;
        }
        if (!t.codecPrivate) {
          this.opts.onError(new Error('MKV: AAC track missing CodecPrivate (AudioSpecificConfig)'));
          this.errored = true;
          return;
        }
        const codecString = aacCodecString(t.codecPrivate);
        this.audioTrackNumber = t.trackNumber;
        audioConfig = {
          codec: codecString,
          sampleRate: t.samplingFrequency || 48000,
          numberOfChannels: t.channels || 2,
          description: t.codecPrivate,
        };
      }
    }

    this.opts.onReady({
      duration: this.duration,
      videoConfig,
      audioConfig,
    });
  }

  /** Return a contiguous Uint8Array view of up to `len` bytes from the head, or null if not enough buffered. */
  private peek(len: number): Uint8Array | null {
    // bufferedSize already excludes consumed bytes (decremented in consume()).
    if (this.bufferedSize < len) return null;
    // Fast path: first buffer has enough after parsedOffset.
    const first = this.buffers[0];
    if (first && first.length - this.parsedOffset >= len) {
      return first.subarray(this.parsedOffset, this.parsedOffset + len);
    }
    // Slow path: concatenate up to `len` bytes from head.
    const out = new Uint8Array(len);
    let written = 0;
    let bufIdx = 0;
    let off = this.parsedOffset;
    while (written < len && bufIdx < this.buffers.length) {
      const b = this.buffers[bufIdx]!;
      const available = b.length - off;
      const need = len - written;
      const copy = Math.min(available, need);
      out.set(b.subarray(off, off + copy), written);
      written += copy;
      if (copy === available) { bufIdx++; off = 0; } else { off += copy; }
    }
    return out;
  }

  /** Advance the read cursor by `n` bytes, dropping any fully-consumed head buffers. */
  private consume(n: number): void {
    this.parsedOffset += n;
    this.bufferedSize -= n;
    while (this.buffers.length > 0) {
      const b = this.buffers[0]!;
      if (this.parsedOffset >= b.length) {
        this.parsedOffset -= b.length;
        this.buffers.shift();
      } else {
        break;
      }
    }
  }
}

/** Read an EBML VINT (variable-length integer) starting at `offset`. */
function readVintFromBytes(buf: Uint8Array, offset: number): { id: number; size: number | null; byteLength: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset]!;
  if (first === 0) return null; // invalid
  // Count leading zero bits to determine length.
  let length = 0;
  let mask = 0x80;
  while ((first & mask) === 0 && mask > 0) {
    length++;
    mask >>= 1;
  }
  length++; // length includes the byte with the leading 1
  if (length > 8) return null;
  if (offset + length > buf.length) return null;

  // Element ID convention: include the leading marker bit (used as ID bytes).
  // For sizes: strip the marker bit to get the numeric value.
  // Compute both interpretations: raw bytes as a single integer (for IDs)
  // and value with marker bit cleared (for sizes).
  let idValue = 0;
  for (let i = 0; i < length; i++) {
    idValue = idValue * 256 + buf[offset + i]!;
  }

  // For sizes, clear the high bit of the first byte.
  let sizeValue: number | null = (first & (mask - 1)) | 0;
  // Check for the "unknown size" sentinel: all bits set after stripping the marker.
  let allOnes = sizeValue === mask - 1;
  for (let i = 1; i < length; i++) {
    sizeValue = sizeValue * 256 + buf[offset + i]!;
    if (buf[offset + i] !== 0xff) allOnes = false;
  }
  if (allOnes) sizeValue = null;

  return { id: idValue, size: sizeValue, byteLength: length };
}

function readUint(buf: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < buf.length; i++) v = v * 256 + buf[i]!;
  return v;
}

function readFloat(buf: Uint8Array): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length === 4) return dv.getFloat32(0, false);
  if (buf.length === 8) return dv.getFloat64(0, false);
  if (buf.length === 0) return 0;
  return readUint(buf);
}

/** Build a WebCodecs codec string for H.264 from an avcC record. */
function avcCodecString(avcc: Uint8Array): string {
  // avcC layout: byte 0 configurationVersion, 1 AVCProfileIndication,
  // 2 profile_compatibility, 3 AVCLevelIndication.
  if (avcc.length < 4) return 'avc1.42E01E';
  const profile = avcc[1]!.toString(16).padStart(2, '0');
  const compat = avcc[2]!.toString(16).padStart(2, '0');
  const level = avcc[3]!.toString(16).padStart(2, '0');
  return `avc1.${profile}${compat}${level}`;
}

/** Build a WebCodecs codec string for AAC from an AudioSpecificConfig (ASC). */
function aacCodecString(asc: Uint8Array): string {
  if (asc.length === 0) return 'mp4a.40.2';
  // ASC first 5 bits = AudioObjectType. If AOT==31, an extension follows; we don't expect it for our content.
  const aot = (asc[0]! >> 3) & 0x1f;
  return `mp4a.40.${aot || 2}`;
}
