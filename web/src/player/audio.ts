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
  private startedAt: number | null = null;
  private framesPlayed = 0;
  private currentVolume = 1;
  private muted = false;

  constructor(opts: AudioSinkOptions) {
    this.sampleRate = opts.config.sampleRate;
    this.channelCount = opts.config.numberOfChannels;
    this.ctx = new AudioContext({ sampleRate: this.sampleRate });
    this.decoder = new AudioDecoder({
      output: (data) => this.onData(data),
      error: (e) => opts.onError(e as unknown as Error),
    });
    this.decoder.configure(opts.config);
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
    this.worklet = new AudioWorkletNode(this.ctx, 'passenger-player', {
      outputChannelCount: [this.channelCount],
    });
    this.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'progress') this.framesPlayed = e.data.framesPlayed;
    };
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.muted ? 0 : this.currentVolume;
    this.worklet.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    await this.ctx.resume();
    this.startedAt = this.ctx.currentTime;
  }

  stop(): void {
    this.worklet?.disconnect();
    this.gain?.disconnect();
    this.worklet = null;
    this.gain = null;
    if (this.decoder.state !== 'closed') this.decoder.close();
    void this.ctx.close();
  }

  currentTime(): number {
    return this.framesPlayed / this.sampleRate;
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
    this.worklet.port.postMessage({ type: 'samples', channels });
    data.close();
  }
}
