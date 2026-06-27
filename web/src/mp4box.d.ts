declare module 'mp4box' {
  interface MP4ArrayBuffer extends ArrayBuffer {
    fileStart: number;
  }

  interface MP4MediaTrack {
    id: number;
    type: string;
    codec: string;
    timescale: number;
    video: { width: number; height: number };
    audio: { sample_rate: number; channel_count: number };
  }

  interface MP4Info {
    duration: number;
    timescale: number;
    tracks: MP4MediaTrack[];
  }

  interface MP4File {
    onError: ((e: string) => void) | null;
    onReady: ((info: MP4Info) => void) | null;
    onSamples: ((id: number, user: unknown, samples: unknown[]) => void) | null;
    appendBuffer(buffer: MP4ArrayBuffer): number;
    setExtractionOptions(trackId: number, user: unknown, options: { nbSamples?: number }): void;
    start(): void;
    flush(): void;
    seek(time: number, useRap?: boolean): { offset: number; time: number };
    getTrackById(id: number): unknown;
  }

  export function createFile(): MP4File;
  export class DataStream {
    static BIG_ENDIAN: boolean;
    constructor(buffer?: ArrayBuffer, offset?: number, endian?: boolean);
    buffer: ArrayBuffer;
  }
}
