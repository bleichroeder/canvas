export interface ChunkBufferOptions {
  getClock: () => number;
  feedLeadSec: number;
  pauseLeadSec: number;
  resumeLeadSec: number;
  onFeedVideo: (chunk: EncodedVideoChunk) => void;
  onFeedAudio: (chunk: EncodedAudioChunk) => void;
  onBackpressure: (state: 'pause' | 'resume') => void;
}

interface BufferedVideoChunk {
  ptsSec: number;
  chunk: EncodedVideoChunk;
}

interface BufferedAudioChunk {
  ptsSec: number;
  chunk: EncodedAudioChunk;
}

export class ChunkBuffer {
  private videoQueue: BufferedVideoChunk[] = [];
  private audioQueue: BufferedAudioChunk[] = [];
  private state: 'flowing' | 'paused' = 'flowing';

  constructor(private opts: ChunkBufferOptions) {}

  pushVideo(chunk: EncodedVideoChunk): void {
    this.videoQueue.push({ ptsSec: chunk.timestamp / 1_000_000, chunk });
    this.updateBackpressure();
  }

  pushAudio(chunk: EncodedAudioChunk): void {
    this.audioQueue.push({ ptsSec: chunk.timestamp / 1_000_000, chunk });
    this.updateBackpressure();
  }

  drain(): { videoFed: number; audioFed: number } {
    const clock = this.opts.getClock();
    const feedUpTo = clock + this.opts.feedLeadSec;
    let videoFed = 0;
    let audioFed = 0;
    while (this.videoQueue.length > 0 && this.videoQueue[0]!.ptsSec <= feedUpTo) {
      const entry = this.videoQueue.shift()!;
      this.opts.onFeedVideo(entry.chunk);
      videoFed++;
    }
    while (this.audioQueue.length > 0 && this.audioQueue[0]!.ptsSec <= feedUpTo) {
      const entry = this.audioQueue.shift()!;
      this.opts.onFeedAudio(entry.chunk);
      audioFed++;
    }
    this.updateBackpressure();
    return { videoFed, audioFed };
  }

  snapshot(): { videoDepth: number; audioDepth: number; tailPtsSec: number | null } {
    const tailV = this.videoQueue.length > 0
      ? this.videoQueue[this.videoQueue.length - 1]!.ptsSec
      : null;
    const tailA = this.audioQueue.length > 0
      ? this.audioQueue[this.audioQueue.length - 1]!.ptsSec
      : null;
    let tailPtsSec: number | null;
    if (tailV != null && tailA != null) tailPtsSec = Math.max(tailV, tailA);
    else tailPtsSec = tailV ?? tailA;
    return {
      videoDepth: this.videoQueue.length,
      audioDepth: this.audioQueue.length,
      tailPtsSec,
    };
  }

  clear(): void {
    this.videoQueue.length = 0;
    this.audioQueue.length = 0;
  }

  private updateBackpressure(): void {
    const { tailPtsSec } = this.snapshot();
    if (tailPtsSec === null) return;
    const clock = this.opts.getClock();
    const lead = tailPtsSec - clock;
    if (this.state === 'flowing' && lead >= this.opts.pauseLeadSec) {
      this.state = 'paused';
      this.opts.onBackpressure('pause');
    } else if (this.state === 'paused' && lead <= this.opts.resumeLeadSec) {
      this.state = 'flowing';
      this.opts.onBackpressure('resume');
    }
  }
}
