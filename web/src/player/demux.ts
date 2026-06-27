import * as MP4Box from 'mp4box';

type MP4BoxFile = ReturnType<typeof MP4Box.createFile>;

interface MP4BoxBuffer extends ArrayBuffer { fileStart: number; }

export interface DemuxInfo {
  duration: number;
  videoConfig: VideoDecoderConfig | null;
  audioConfig: AudioDecoderConfig | null;
  videoTrackId: number | null;
  audioTrackId: number | null;
}

export interface DemuxOptions {
  onReady: (info: DemuxInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onError: (err: Error) => void;
}

export class Demuxer {
  private readonly file: MP4BoxFile;
  private readonly opts: DemuxOptions;
  private ready = false;
  private videoTrackId: number | null = null;
  private audioTrackId: number | null = null;
  private videoTimescale = 1;
  private audioTimescale = 1;

  constructor(opts: DemuxOptions) {
    this.opts = opts;
    this.file = MP4Box.createFile();
    this.file.onError = (e: string) => this.opts.onError(new Error(e));
    this.file.onReady = (info: any) => this.handleReady(info);
    this.file.onSamples = (id: number, _user: unknown, samples: any[]) =>
      this.handleSamples(id, samples);
  }

  appendChunk(offset: number, bytes: Uint8Array): void {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as MP4BoxBuffer;
    buf.fileStart = offset;
    this.file.appendBuffer(buf);
  }

  seek(seconds: number): { videoByteOffset: number; time: number } {
    const result = this.file.seek(seconds, true);
    return { videoByteOffset: result.offset, time: result.time };
  }

  flush(): void {
    this.file.flush();
  }

  private handleReady(info: any): void {
    if (this.ready) return;
    this.ready = true;

    let videoConfig: VideoDecoderConfig | null = null;
    let audioConfig: AudioDecoderConfig | null = null;
    let videoTrackId: number | null = null;
    let audioTrackId: number | null = null;

    for (const track of info.tracks) {
      if (track.type === 'video' && !videoTrackId) {
        videoTrackId = track.id;
        this.videoTrackId = track.id;
        this.videoTimescale = track.timescale;
        const description = extractAvccDescription(this.file, track.id);
        videoConfig = {
          codec: track.codec,
          codedWidth: track.video.width,
          codedHeight: track.video.height,
          ...(description ? { description } : {}),
        };
      } else if (track.type === 'audio' && !audioTrackId) {
        audioTrackId = track.id;
        this.audioTrackId = track.id;
        this.audioTimescale = track.timescale;
        const description = extractEsdsDescription(this.file, track.id);
        audioConfig = {
          codec: track.codec,
          sampleRate: track.audio.sample_rate,
          numberOfChannels: track.audio.channel_count,
          ...(description ? { description } : {}),
        };
      }
    }

    if (videoTrackId !== null) {
      this.file.setExtractionOptions(videoTrackId, null, { nbSamples: 60 });
    }
    if (audioTrackId !== null) {
      this.file.setExtractionOptions(audioTrackId, null, { nbSamples: 120 });
    }

    this.opts.onReady({
      duration: info.duration / info.timescale,
      videoConfig,
      audioConfig,
      videoTrackId,
      audioTrackId,
    });

    this.file.start();
  }

  private handleSamples(trackId: number, samples: any[]): void {
    if (trackId === this.videoTrackId) {
      for (const s of samples) {
        this.opts.onVideoSample(new EncodedVideoChunk({
          type: s.is_sync ? 'key' : 'delta',
          timestamp: (s.cts * 1_000_000) / this.videoTimescale,
          duration: (s.duration * 1_000_000) / this.videoTimescale,
          data: s.data,
        }));
      }
    } else if (trackId === this.audioTrackId) {
      for (const s of samples) {
        this.opts.onAudioSample(new EncodedAudioChunk({
          type: 'key',
          timestamp: (s.cts * 1_000_000) / this.audioTimescale,
          duration: (s.duration * 1_000_000) / this.audioTimescale,
          data: s.data,
        }));
      }
    }
  }
}

function extractAvccDescription(file: MP4BoxFile, trackId: number): Uint8Array | undefined {
  const track = (file as any).getTrackById(trackId);
  if (!track) return undefined;
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC;
    if (!box) continue;
    const stream = new (MP4Box as any).DataStream(undefined, 0, (MP4Box as any).DataStream.BIG_ENDIAN);
    box.write(stream);
    return new Uint8Array(stream.buffer, 8);
  }
  return undefined;
}

function extractEsdsDescription(file: MP4BoxFile, trackId: number): Uint8Array | undefined {
  const track = (file as any).getTrackById(trackId);
  if (!track) return undefined;
  for (const entry of track.mdia.minf.stbl.stsd.entries) {
    const esds = entry.esds;
    if (!esds || !esds.esd) continue;
    const decoderConfig = esds.esd.descs?.[0];
    const decoderSpecific = decoderConfig?.descs?.[0];
    if (decoderSpecific?.data instanceof Uint8Array) {
      return decoderSpecific.data;
    }
  }
  return undefined;
}
