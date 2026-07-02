import { emit } from './diagnostics';

export interface AudioSinkOptions {
  config: AudioDecoderConfig;
  onError: (err: Error) => void;
}

export class AudioSink {
  public readonly ctx: AudioContext;
  public worklet: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private decoder: AudioDecoder;
  private sampleRate: number;
  private channelCount: number;
  private currentPtsSec = 0;
  private currentVolume = 1;
  private muted = false;

  constructor(opts: AudioSinkOptions) {
    this.sampleRate = opts.config.sampleRate;
    this.channelCount = opts.config.numberOfChannels;
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.decoder = new AudioDecoder({
      output: (data) => this.onData(data),
      error: (e) => {
        emit('audio_error', { message: (e as unknown as Error).message });
        opts.onError(e as unknown as Error);
      },
    });
    this.decoder.configure(opts.config);
    emit('audio_configure', {
      codec: opts.config.codec,
      sampleRate: opts.config.sampleRate,
      channels: opts.config.numberOfChannels,
    });
  }

  feed(chunk: EncodedAudioChunk): void {
    if (this.decoder.state === 'closed') return;
    this.decoder.decode(chunk);
  }

  async start(): Promise<void> {
    if (this.worklet) return;
    const workletUrl = import.meta.env.DEV
      ? '/src/player/audio-worklet.js'
      : '/audio-worklet.js';
    await this.ctx.audioWorklet.addModule(workletUrl);
    this.worklet = new AudioWorkletNode(this.ctx, 'canvas-player', {
      outputChannelCount: [this.channelCount],
    });
    this.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'progress') {
        // Worklet also sends framesPlayed; unused on the main thread since
        // the clock is pts-driven.
        if (typeof e.data.currentPtsSec === 'number') {
          this.currentPtsSec = e.data.currentPtsSec;
        }
      }
    };
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.currentVolume;
    this.worklet.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    await this.ctx.resume();
  }

  stop(): void {
    this.worklet?.disconnect();
    this.gain?.disconnect();
    this.worklet = null;
    this.gain = null;
    if (this.decoder.state !== 'closed') this.decoder.close();
    void this.ctx.close();
  }

  /** AudioSink decodes synchronously into the worklet; no internal queue. */
  get queueLength(): number { return 0; }

  /** PTS (in seconds) of the audio sample the worklet is currently outputting.
   *  This is the master playback clock for video sync — NOT cumulative playback
   *  duration. When the worklet's internal FIFO crosses batch boundaries with a
   *  pts discontinuity, this value jumps accordingly. */
  currentTime(): number {
    return this.currentPtsSec;
  }

  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.currentVolume = clamped;
    if (this.gain && !this.muted) this.gain.gain.value = clamped;
  }

  getVolume(): number {
    return this.currentVolume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.gain) this.gain.gain.value = m ? 0 : this.currentVolume;
  }

  isMuted(): boolean {
    return this.muted;
  }

  private onData(data: AudioData): void {
    if (!this.worklet) { data.close(); return; }
    const channels: Float32Array[] = [];
    for (let c = 0; c < data.numberOfChannels; c++) {
      const buf = new Float32Array(data.numberOfFrames);
      data.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      channels.push(buf);
    }
    (channels as unknown as { offset: number }).offset = 0;
    const startPtsSec = data.timestamp / 1_000_000;
    this.worklet.port.postMessage({ type: 'samples', channels, startPtsSec });
    data.close();
  }
}
