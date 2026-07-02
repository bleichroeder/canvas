class CanvasPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.framesPlayed = 0;
    this.currentPtsSec = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'samples') {
        this.queue.push({
          channels: e.data.channels,
          startPtsSec: e.data.startPtsSec,
        });
      } else if (e.data?.type === 'reset') {
        this.queue.length = 0;
        this.framesPlayed = 0;
        this.currentPtsSec = 0;
      }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const frames = out[0].length;
    const channelCount = out.length;
    let filled = 0;
    while (filled < frames) {
      if (this.queue.length === 0) {
        for (let c = 0; c < channelCount; c++) {
          out[c].fill(0, filled);
        }
        break;
      }
      const entry = this.queue[0];
      const chunk = entry.channels;
      const remaining = chunk[0].length - chunk.offset;
      const toCopy = Math.min(remaining, frames - filled);
      for (let c = 0; c < channelCount; c++) {
        const src = chunk[Math.min(c, chunk.length - 1)];
        out[c].set(src.subarray(chunk.offset, chunk.offset + toCopy), filled);
      }
      // Update pts to reflect the sample we're actively consuming.
      this.currentPtsSec = entry.startPtsSec + (chunk.offset + toCopy) / sampleRate;
      chunk.offset += toCopy;
      filled += toCopy;
      this.framesPlayed += toCopy;
      if (chunk.offset >= chunk[0].length) this.queue.shift();
    }
    this.port.postMessage({
      type: 'progress',
      framesPlayed: this.framesPlayed,
      currentPtsSec: this.currentPtsSec,
    });
    return true;
  }
}
registerProcessor('canvas-player', CanvasPlayerProcessor);
