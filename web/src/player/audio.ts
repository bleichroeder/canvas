export interface AudioSinkOptions {
  config: AudioDecoderConfig;
  onError: (err: Error) => void;
}

export class AudioSink {
  private readonly ctx: AudioContext;
  private readonly decoder: AudioDecoder;
  private readonly sampleRate: number;
  private readonly channelCount: number;
  private worklet: AudioWorkletNode | null = null;
  private startedAt: number | null = null;
  private framesPlayed = 0;

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
    this.worklet.connect(this.ctx.destination);
    await this.ctx.resume();
    this.startedAt = this.ctx.currentTime;
  }

  stop(): void {
    this.worklet?.disconnect();
    this.worklet = null;
    if (this.decoder.state !== 'closed') this.decoder.close();
    void this.ctx.close();
  }

  currentTime(): number {
    return this.framesPlayed / this.sampleRate;
  }

  private onData(data: AudioData): void {
    if (!this.worklet) { data.close(); return; }
    const channels: Float32Array[] = [];
    for (let c = 0; c < data.numberOfChannels; c++) {
      const buf = new Float32Array(data.numberOfFrames);
      data.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      channels.push(buf);
    }
    (channels as any).offset = 0;
    this.worklet.port.postMessage({ type: 'samples', channels });
    data.close();
  }
}
