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
    // Gate on the LESSER-buffered stream's lead, not the max. Using the max let
    // video race ahead and pause the fetcher while audio was still starving —
    // audio then drained to empty, the audio-mastered clock froze, and the lead
    // (dominated by the far-ahead video) never fell back below resumeLeadSec, so
    // the fetcher never resumed: a hard stall a few seconds after a seek. Taking
    // the min keeps bytes flowing until BOTH tracks have enough buffered, and
    // resumes as soon as EITHER runs low.
    const tailV = this.videoQueue.length > 0 ? this.videoQueue[this.videoQueue.length - 1]!.ptsSec : null;
    const tailA = this.audioQueue.length > 0 ? this.audioQueue[this.audioQueue.length - 1]!.ptsSec : null;
    let tail: number;
    if (tailV != null && tailA != null) tail = Math.min(tailV, tailA);
    else if (tailV != null) tail = tailV;
    else if (tailA != null) tail = tailA;
    else return;
    const clock = this.opts.getClock();
    const lead = tail - clock;
    if (lead >= this.opts.pauseLeadSec) {
      // Always re-emit pause while over threshold — the fetcher may have been
      // unpaused by VideoSink's onBackpressure signal even while our internal
      // state is still 'paused'. Fetcher.pause() is idempotent so repeated calls
      // are cheap; this ensures we can't get stuck with the fetcher running
      // unrestrained while our internal state thinks it's paused.
      if (this.state === 'flowing') this.state = 'paused';
      this.opts.onBackpressure('pause');
    } else if (this.state === 'paused' && lead <= this.opts.resumeLeadSec) {
      this.state = 'flowing';
      this.opts.onBackpressure('resume');
    }
  }
}
