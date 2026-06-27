# Passenger v2 — Player Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seek (with BIF thumbnail preview), skip ±10s, tap-to-pause, volume + mute, browser fullscreen, and MP3-in-MKV support to the v2 player.

**Architecture:** Plex's transcoder is a live stream, so seek = tear down the current engine, ask Plex for a fresh URL with `&offset=N`, boot a new engine. The boot logic gets extracted from `Player.tsx`'s `useEffect` into a reusable `bootEngine(opts) → EngineHandle` function pair so both initial-play and reseek go through the same path. `AudioSink` gains a `GainNode` for volume; `mkv-source.ts` gains `A_MPEG/L3` recognition.

**Tech Stack:** TypeScript, Preact, Cloudflare Worker, Vitest (worker pure-logic tests only), WebCodecs `VideoDecoder`/`AudioDecoder`, Web Audio API (`GainNode`), Fullscreen API.

## Global Constraints

- All work on the **`v2` branch**, builds on top of `cd19262` (player-polish spec) and `a1d5516` (last functional commit).
- All code TypeScript except the audio worklet.
- Tesla MCU3 / Ryzen Chromium is the only supported client.
- Worker uses Vitest for unit tests on **pure logic only** (adapter helpers, route param parsing). Frontend has **no automated tests** — manual smoke per task.
- Captions / subtitle rendering, audio-track switching, skip-intro markers, auto-next-episode are **out of scope** — separate plans.
- Plex transcoder is a live stream; seek means restart-at-offset (no in-session seek).
- BIF thumbnail bucket size is **10 000 ms**. Always round preview ms down to nearest 10000 before substituting `{ms}` in `thumbnailUrlTemplate`.
- Reseek latency target: under ~3 seconds end-to-end on the deployed stack.

---

## Task 1: Extend shared types (worker + web)

**Files:**
- Modify: `worker/src/sources/types.ts`
- Modify: `web/src/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SourceAdapter.resolveStream(ctx, id, fromSec?)` — third optional parameter.
  - `PlayResolution.thumbnailUrlTemplate?: string` — optional new field, contains the literal `{ms}` placeholder for client substitution.

- [ ] **Step 1: Modify `worker/src/sources/types.ts`** — add `fromSec` to `resolveStream` and `thumbnailUrlTemplate` to `PlayResolution`

Find the existing `PlayResolution` interface and replace it:

```typescript
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  /**
   * Optional URL template for scrub-bar preview thumbnails. Contains the literal
   * substring "{ms}" the client replaces with a rounded millisecond offset.
   */
  thumbnailUrlTemplate?: string;
}
```

Find the existing `SourceAdapter.resolveStream` signature and replace it:

```typescript
  /**
   * Resolve a playable URL.
   * @param fromSec If provided, the stream should start at this position in seconds.
   *                Adapters that don't support seek can ignore the param (player will
   *                still call this on each seek but the URL won't change).
   */
  resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution>;
```

- [ ] **Step 2: Modify `web/src/types.ts`** — mirror `thumbnailUrlTemplate` on the frontend shape

Replace the `PlayResolution` interface:

```typescript
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
}
```

- [ ] **Step 3: Typecheck both packages**

```powershell
cd C:\github\passenger\worker
npm run typecheck

cd C:\github\passenger\web
npm run build
```

Both must succeed (the wider type only adds an optional field; nothing existing breaks).

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add worker/src/sources/types.ts web/src/types.ts
git commit -m "types: PlayResolution.thumbnailUrlTemplate, resolveStream fromSec"
```

---

## Task 2: MKV demuxer — MP3 audio support

**Files:**
- Modify: `web/src/player/mkv-source.ts`

**Interfaces:**
- Consumes: existing `MkvSource` / `finalizeReady()`.
- Produces: A_MPEG/L3 tracks parse and configure `AudioDecoder` with codec `'mp3'`, no description. Other codec IDs still error explicitly.

- [ ] **Step 1: Add MP3 codec constant**

In `web/src/player/mkv-source.ts`, find the `CODEC_AAC` constant near the top:

```typescript
const CODEC_AAC = 'A_AAC';
```

Add a sibling constant immediately after:

```typescript
const CODEC_MP3 = 'A_MPEG/L3';
```

- [ ] **Step 2: Replace the audio branch of `finalizeReady`**

In `finalizeReady`, find the existing audio branch:

```typescript
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
```

Replace with:

```typescript
      } else if (t.trackType === TRACK_TYPE_AUDIO && this.audioTrackNumber === null) {
        let codecString: string;
        let description: Uint8Array | undefined;
        if (t.codecId === CODEC_AAC) {
          if (!t.codecPrivate) {
            this.opts.onError(new Error('MKV: AAC track missing CodecPrivate (AudioSpecificConfig)'));
            this.errored = true;
            return;
          }
          codecString = aacCodecString(t.codecPrivate);
          description = t.codecPrivate;
        } else if (t.codecId === CODEC_MP3) {
          // MP3 frames are self-describing; no CodecPrivate needed.
          codecString = 'mp3';
          description = undefined;
        } else {
          this.opts.onError(new Error(`MKV: unsupported audio codec ${t.codecId}; only AAC and MP3 supported`));
          this.errored = true;
          return;
        }
        this.audioTrackNumber = t.trackNumber;
        audioConfig = {
          codec: codecString,
          sampleRate: t.samplingFrequency || 48000,
          numberOfChannels: t.channels || 2,
          ...(description ? { description } : {}),
        };
      }
```

- [ ] **Step 3: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: clean build.

- [ ] **Step 4: Manual smoke — only runnable if you have an MP3-audio MKV handy**

For an immediate smoke without an MP3 file, just verify build is clean and no behavior regression by reloading the existing Backrooms (AAC) playback. We test MP3 specifically via the user's known-affected video once the change is deployed (next task chain delivers it).

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/mkv-source.ts
git commit -m "MKV: accept A_MPEG/L3 audio (Plex sometimes direct-streams MP3)"
```

---

## Task 3: Plex adapter — fromSec + thumbnailUrlTemplate

**Files:**
- Modify: `worker/src/sources/plex.ts`
- Modify (or create): `worker/src/sources/plex-resolve.test.ts`

**Interfaces:**
- Consumes: `PlayResolution` shape (Task 1), `plexFetch` (existing).
- Produces: `plexAdapter.resolveStream(ctx, id, fromSec?)`. When `fromSec` is provided, transcoder URL contains `&offset=<seconds>`. Response includes `thumbnailUrlTemplate` set to `${baseUrl}/library/parts/${partId}/indexes/sd/{ms}?X-Plex-Token=<encoded>`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/sources/plex-resolve.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plexAdapter } from './plex';

afterEach(() => vi.restoreAllMocks());

function mockMetadataResponse(durationMs: number, partId: number) {
  return new Response(
    JSON.stringify({
      MediaContainer: {
        size: 1,
        Metadata: [
          {
            ratingKey: '42',
            type: 'movie',
            title: 'Test',
            duration: durationMs,
            Media: [
              {
                duration: durationMs,
                Part: [{ id: partId, key: `/library/parts/${partId}/x/file.mkv` }],
              },
            ],
          },
        ],
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('plexAdapter.resolveStream', () => {
  it('returns a transcoder URL with videoCodec=h264 and audioCodec=aac', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.url).toContain('/video/:/transcode/universal/start.mp4');
    expect(res.url).toContain('videoCodec=h264');
    expect(res.url).toContain('audioCodec=aac');
    expect(res.durationSec).toBe(6499);
  });

  it('appends offset=<seconds> when fromSec is provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
      300,
    );
    expect(res.url).toMatch(/[?&]offset=300(&|$)/);
  });

  it('omits offset when fromSec is undefined or 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const a = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42');
    expect(a.url).not.toContain('offset=');
    const b = await plexAdapter.resolveStream({ baseUrl: 'https://x', token: 't' }, '42', 0);
    expect(b.url).not.toContain('offset=');
  });

  it('populates thumbnailUrlTemplate with the BIF endpoint and {ms} placeholder', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockMetadataResponse(6_499_000, 7));
    const res = await plexAdapter.resolveStream(
      { baseUrl: 'https://plex.example', token: 'tok' },
      '42',
    );
    expect(res.thumbnailUrlTemplate).toBe(
      'https://plex.example/library/parts/7/indexes/sd/{ms}?X-Plex-Token=tok',
    );
  });
});
```

- [ ] **Step 2: Run vitest, expect RED**

```powershell
cd C:\github\passenger\worker
npm test
```

Expected: the new tests fail (current `resolveStream` doesn't accept `fromSec`, doesn't emit `thumbnailUrlTemplate`).

- [ ] **Step 3: Implement — replace `plexAdapter.resolveStream` in `worker/src/sources/plex.ts`**

Find the existing `resolveStream` method (currently builds transcoder URL without `fromSec` or thumbnail template). Replace it:

```typescript
  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    // Plex's direct-play hands us the original container — typically MKV with
    // arbitrary codecs (HEVC, AC3, DTS). The canvas pipeline only handles
    // H.264 + AAC|MP3. Route through Plex's transcoder forcing those codecs.
    const meta = await plexFetch<MediaContainer<PlexMetadata & {
      Media?: { duration?: number; Part?: { id?: number; key: string }[] }[];
    }>>(ctx, `/library/metadata/${encodeURIComponent(id)}`);
    const m = meta.MediaContainer.Metadata?.[0];
    if (!m) throw new Error(`Plex item ${id} not found`);
    const durationMs = m.duration ?? m.Media?.[0]?.duration ?? 0;
    const partId = m.Media?.[0]?.Part?.[0]?.id;

    const session = crypto.randomUUID();
    const params = new URLSearchParams({
      'protocol': 'http',
      'path': `/library/metadata/${id}`,
      'mediaIndex': '0',
      'partIndex': '0',
      'directPlay': '0',
      'directStream': '0',
      'videoCodec': 'h264',
      'audioCodec': 'aac',
      'videoQuality': '80',
      'videoResolution': '1920x1080',
      'maxVideoBitrate': '8000',
      'fastSeek': '1',
      'session': session,
      'X-Plex-Token': ctx.token,
      'X-Plex-Client-Identifier': 'passenger',
      'X-Plex-Product': 'Passenger',
      'X-Plex-Platform': 'Web',
    });
    if (typeof fromSec === 'number' && fromSec > 0) {
      params.set('offset', String(Math.floor(fromSec)));
    }
    const url = `${ctx.baseUrl}/video/:/transcode/universal/start.mp4?${params.toString()}`;

    const thumbnailUrlTemplate = partId !== undefined
      ? `${ctx.baseUrl}/library/parts/${partId}/indexes/sd/{ms}?X-Plex-Token=${encodeURIComponent(ctx.token)}`
      : undefined;

    return {
      url,
      durationSec: Math.round(durationMs / 1000),
      ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
    };
  },
```

- [ ] **Step 4: Run vitest, expect GREEN**

```powershell
npm test
```

Expected: all four new tests pass alongside existing tests.

- [ ] **Step 5: Typecheck**

```powershell
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add worker/src/sources/plex.ts worker/src/sources/plex-resolve.test.ts
git commit -m "Plex adapter: support fromSec + emit thumbnailUrlTemplate"
```

---

## Task 4: Worker `/api/play` — accept `?fromSec=N`

**Files:**
- Modify: `worker/src/routes/play.ts`
- Modify (or create): `worker/src/routes/play.test.ts`

**Interfaces:**
- Consumes: `Adapter.resolveStream(ctx, id, fromSec?)` (Task 3).
- Produces: `POST /api/play/:src/:id?fromSec=N` passes the parsed numeric value to the adapter. Missing / non-numeric / negative values are normalized to `undefined`.

- [ ] **Step 1: Write the failing tests**

Create `worker/src/routes/play.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseFromSecParam } from './play';

describe('parseFromSecParam', () => {
  it('returns undefined when missing', () => {
    expect(parseFromSecParam(null)).toBeUndefined();
  });
  it('returns undefined when blank', () => {
    expect(parseFromSecParam('')).toBeUndefined();
  });
  it('returns undefined when non-numeric', () => {
    expect(parseFromSecParam('abc')).toBeUndefined();
  });
  it('returns undefined for negatives', () => {
    expect(parseFromSecParam('-5')).toBeUndefined();
  });
  it('returns the integer value for valid positive numbers', () => {
    expect(parseFromSecParam('300')).toBe(300);
    expect(parseFromSecParam('300.7')).toBe(300);
    expect(parseFromSecParam('0')).toBe(0);
  });
});
```

- [ ] **Step 2: Run vitest, expect RED** (`parseFromSecParam` isn't exported yet)

```powershell
cd C:\github\passenger\worker
npm test
```

- [ ] **Step 3: Update `worker/src/routes/play.ts`**

Read the current file and replace its contents with:

```typescript
import { withCors } from '../cors';
import { callOneSource, explain } from '../dispatch';
import { getAdapter } from '../sources/registry';
import { parseXSources } from '../x-sources';

export function parseFromSecParam(raw: string | null): number | undefined {
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.floor(n);
}

export async function handlePlay(req: Request, srcKey: string, id: string): Promise<Response> {
  const url = new URL(req.url);
  const fromSec = parseFromSecParam(url.searchParams.get('fromSec'));
  const sources = parseXSources(req);
  try {
    const result = await callOneSource(sources, srcKey, (src) => {
      const adapter = getAdapter(src.type);
      return adapter.resolveStream({ baseUrl: src.baseUrl, token: src.token }, id, fromSec);
    });
    return withCors(req, new Response(JSON.stringify(result), {
      headers: { 'content-type': 'application/json' },
    }));
  } catch (e) {
    const { status, message } = explain(e);
    return withCors(req, new Response(JSON.stringify({ error: message }), {
      status, headers: { 'content-type': 'application/json' },
    }));
  }
}
```

- [ ] **Step 4: Run vitest, expect GREEN**

```powershell
npm test
```

Expected: all 5 new tests pass, prior tests unaffected.

- [ ] **Step 5: Smoke against the deployed worker**

After deploy in Task 10, you'll smoke this for real. For now: ensure the route's URL pattern still works.

Quick local typecheck:

```powershell
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
cd C:\github\passenger
git add worker/src/routes/play.ts worker/src/routes/play.test.ts
git commit -m "play route: parse ?fromSec= and pass to adapter"
```

---

## Task 5: `AudioSink` — volume + mute via GainNode

**Files:**
- Modify: `web/src/player/audio.ts`

**Interfaces:**
- Consumes: existing `AudioSink` class.
- Produces:
  - `audio.setVolume(v: number): void` — clamps to [0, 1]
  - `audio.getVolume(): number`
  - `audio.setMuted(m: boolean): void`
  - `audio.isMuted(): boolean`
  - Internal: an `AudioContext` `GainNode` between the worklet and destination. When muted, gain is forced to 0 regardless of `currentVolume`.

- [ ] **Step 1: Read the current file**

```powershell
type C:\github\passenger\web\src\player\audio.ts
```

Note the existing `start()` method connects `this.worklet → this.ctx.destination`. We'll insert a `GainNode` in the middle.

- [ ] **Step 2: Replace `web/src/player/audio.ts` with the volume-aware version**

```typescript
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
```

- [ ] **Step 3: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: clean build. No type errors.

- [ ] **Step 4: Manual smoke (deferred to deploy)**

Volume slider doesn't exist yet — wired in Task 8. Just confirm build.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/audio.ts
git commit -m "AudioSink: GainNode + setVolume/setMuted"
```

---

## Task 6: Extract `bootEngine` / `EngineHandle` from `Player.tsx`

**Files:**
- Create: `web/src/player/engine.ts`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Consumes: existing `RangeFetcher`, `AutoSource`, `StreamInfo`.
- Produces:
  - `bootEngine(opts: BootEngineOptions): EngineHandle` — constructs `RangeFetcher` + `AutoSource`, wires callbacks. Returns handle whose `dispose()` aborts the fetcher.
  - `BootEngineOptions` carries `url`, `onReady`, `onVideoSample`, `onAudioSample`, `onFatal`, `onDone` callbacks. The view constructs `VideoSink` / `AudioSink` inside `onReady` (same as today).

- [ ] **Step 1: Create `web/src/player/engine.ts`**

```typescript
import { RangeFetcher } from './range-fetcher';
import { AutoSource } from './stream-source';
import type { StreamInfo } from './stream-source';

export interface BootEngineOptions {
  url: string;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}

export interface EngineHandle {
  /** Stop fetching and detach callbacks. Safe to call multiple times. */
  dispose(): void;
}

/**
 * Wire the fetcher → source → callback chain for one playback session.
 *
 * The view is responsible for constructing VideoSink / AudioSink in its
 * onReady callback (the configs depend on the parsed StreamInfo). The view
 * also owns sample-buffering before the user gesture that starts playback.
 */
export function bootEngine(opts: BootEngineOptions): EngineHandle {
  let disposed = false;

  const source = new AutoSource({
    onReady: (info) => { if (!disposed) opts.onReady(info); },
    onVideoSample: (c) => { if (!disposed) opts.onVideoSample(c); },
    onAudioSample: (c) => { if (!disposed) opts.onAudioSample(c); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
  });

  const fetcher = new RangeFetcher({
    url: opts.url,
    chunkSize: 4 * 1024 * 1024,
    onChunk: (offset, bytes) => { if (!disposed) source.appendChunk(offset, bytes); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
    onDone: () => { if (!disposed) { source.flush(); opts.onDone(); } },
  });
  fetcher.start();

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      fetcher.abort();
    },
  };
}
```

- [ ] **Step 2: Refactor `web/src/views/Player.tsx` to use `bootEngine`**

This task is **refactor-only** — no behavior change. The seek logic comes in Task 7.

Read the current `Player.tsx` and replace the engine-boot `useEffect` block. Specifically:

Find this block:

```tsx
  // Long-lived refs for engine pieces.
  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const sourceRef = useRef<AutoSource | null>(null);
  const fetcherRef = useRef<RangeFetcher | null>(null);
```

Replace with:

```tsx
  // Long-lived refs for engine pieces.
  const videoRef = useRef<VideoSink | null>(null);
  const audioRef = useRef<AudioSink | null>(null);
  const engineRef = useRef<EngineHandle | null>(null);
```

Find these imports near the top:

```tsx
import { RangeFetcher } from '../player/range-fetcher';
import { AutoSource } from '../player/stream-source';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import type { PlayResolution } from '../types';
```

Replace with:

```tsx
import { bootEngine, type EngineHandle } from '../player/engine';
import { VideoSink } from '../player/video';
import { AudioSink } from '../player/audio';
import type { PlayResolution } from '../types';
```

Find the existing engine-boot useEffect (the one that calls `api.play`, constructs `Demuxer`/`AutoSource`/`RangeFetcher`). Replace its body:

```tsx
  // Boot the engine.
  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        setStatus('Resolving stream…');
        const resolution = await api.play(source, id);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');

        const canvas = canvasRef.current!;

        engineRef.current = bootEngine({
          url: resolution.url,
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig) { setErrMsg('No video track'); return; }
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
            });
            videoRef.current = video;
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audioRef.current = audio;
            }
            setStatus('Ready — tap to play');
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onFatal: (e) => setErrMsg(e.message),
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      engineRef.current?.dispose();
      videoRef.current?.close();
      audioRef.current?.stop();
    };
  }, [source, id]);
```

- [ ] **Step 3: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: clean build. Bundle size roughly unchanged.

- [ ] **Step 4: Manual smoke (locally)**

```powershell
npm run dev
```

Open `http://localhost:5173/#/play/<src>/<id>` against a paired Plex source (or test via the deployed Pages site after Task 10). Confirm playback still works after the refactor — same behavior as before this task.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/player/engine.ts web/src/views/Player.tsx
git commit -m "Extract bootEngine/EngineHandle from Player.tsx (no behavior change)"
```

---

## Task 7: Player.tsx — `reseek` + skip ±10s wiring

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Consumes: `api.play(srcKey, id, fromSec?)` (this task), `bootEngine` (Task 6), `EngineHandle.dispose()`.
- Produces:
  - `api.play` accepts an optional `fromSec` parameter that's serialized as `?fromSec=N` on the request.
  - `Player.tsx` exposes `onSeek(targetSec)` and `onSeekRelative(deltaSec)` as actual seek operations (previously no-ops). Both call an internal `reseek(targetSec)` that disposes the engine, fetches a new URL with `fromSec`, and boots a fresh engine.

- [ ] **Step 1: Modify `api.play` to accept `fromSec`**

In `web/src/api.ts`, find:

```typescript
  play: (srcKey: string, id: string) =>
    request<PlayResolution>(`/api/play/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}`, { method: 'POST' }),
```

Replace with:

```typescript
  play: (srcKey: string, id: string, fromSec?: number) => {
    const qs = typeof fromSec === 'number' && fromSec > 0 ? `?fromSec=${Math.floor(fromSec)}` : '';
    return request<PlayResolution>(
      `/api/play/${encodeURIComponent(srcKey)}/${encodeURIComponent(id)}${qs}`,
      { method: 'POST' },
    );
  },
```

- [ ] **Step 2: Refactor `Player.tsx` boot into a reusable function and add `reseek`**

Read the current `Player.tsx` and apply these specific changes. **The structure is**: split the in-`useEffect` boot logic into a top-level `bootSession(fromSec)` callback that the useEffect calls on mount AND that `reseek` calls. Track whether the engine was playing pre-seek so we can auto-resume.

Find the existing boot useEffect. Replace its body (and the `onSeek` / `onSeekRelative` stubs further down) with the following. Note: this replaces a sizable contiguous block — read it carefully.

Replace from:

```tsx
  // Boot the engine.
  useEffect(() => {
```

down through the closing of `onSeekRelative` (the no-op stub) with:

```tsx
  // Track whether the user has ever tapped play in this view's lifetime.
  // Survives reseeks so the new engine auto-resumes after a seek.
  const wasPlayingRef = useRef(false);
  const seekTokenRef = useRef(0);

  /** Construct (or reconstruct) the engine. Used at mount and on seek. */
  const bootSession = (fromSec: number): { cancel: () => void } => {
    let cancelled = false;
    let cancelTimer: number | undefined;

    void (async () => {
      try {
        setStatus(fromSec > 0 ? 'Seeking…' : 'Resolving stream…');
        const resolution = await api.play(source, id, fromSec);
        if (cancelled) return;
        resolutionRef.current = resolution;
        setDuration(resolution.durationSec);
        setStatus('Loading…');

        const canvas = canvasRef.current!;

        engineRef.current = bootEngine({
          url: resolution.url,
          onReady: (info) => {
            if (cancelled) return;
            if (!info.videoConfig) { setErrMsg('No video track'); return; }
            const video = new VideoSink({
              canvas,
              config: info.videoConfig,
              clock: () => (audioRef.current ? audioRef.current.currentTime() : performance.now() / 1000),
              onError: (e) => setErrMsg(`video: ${e.message}`),
            });
            videoRef.current = video;
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audioRef.current = audio;
            }
            // Pos baseline for the new session is fromSec (audio.currentTime() resets to 0 in new engine).
            sessionBaseRef.current = fromSec;
            setStatus('');
            if (wasPlayingRef.current) {
              // Auto-resume after seek — audio context is already user-gestured.
              void autoStartPlayback();
            } else {
              setStatus('Ready — tap to play');
            }
          },
          onVideoSample: (chunk) => {
            if (startedRef.current && videoRef.current) videoRef.current.feed(chunk);
            else pendingVideoRef.current.push(chunk);
          },
          onAudioSample: (chunk) => {
            if (startedRef.current && audioRef.current) audioRef.current.feed(chunk);
            else pendingAudioRef.current.push(chunk);
          },
          onFatal: (e) => setErrMsg(e.message),
          onDone: () => { videoRef.current?.flush().catch(() => {}); },
        });
      } catch (e) {
        if (!cancelled) setErrMsg((e as Error).message);
      }
    })();

    return {
      cancel: () => {
        cancelled = true;
        if (cancelTimer) clearTimeout(cancelTimer);
      },
    };
  };

  /** Common code for entering the playing state — used on first tap AND on auto-resume after seek. */
  async function autoStartPlayback(): Promise<void> {
    if (audioRef.current) await audioRef.current.start();
    videoRef.current?.start();
    for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
    for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = true;
    setPaused(false);
  }

  // Boot the engine on mount; tear down on unmount.
  useEffect(() => {
    const handle = bootSession(0);
    return () => {
      handle.cancel();
      engineRef.current?.dispose();
      engineRef.current = null;
      videoRef.current?.close();
      videoRef.current = null;
      audioRef.current?.stop();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, id]);

  async function reseek(targetSec: number): Promise<void> {
    if (errMsg) return;
    const target = Math.max(0, Math.min(targetSec, duration > 0 ? duration - 1 : targetSec));
    const myToken = ++seekTokenRef.current;
    setPos(target);
    wasPlayingRef.current = startedRef.current && !paused;
    // Tear down current engine and sinks.
    engineRef.current?.dispose();
    engineRef.current = null;
    videoRef.current?.close();
    videoRef.current = null;
    audioRef.current?.stop();
    audioRef.current = null;
    pendingVideoRef.current = [];
    pendingAudioRef.current = [];
    startedRef.current = false;
    // Boot at target.
    const handle = bootSession(target);
    // If another seek lands while we're booting, cancel this one.
    const interval = window.setInterval(() => {
      if (myToken !== seekTokenRef.current) {
        handle.cancel();
        clearInterval(interval);
      } else if (engineRef.current) {
        clearInterval(interval);
      }
    }, 100);
  }

  function onSeek(sec: number): void { void reseek(sec); }
  function onSeekRelative(delta: number): void { void reseek(pos + delta); }
```

Now also adjust how `pos` is computed so the displayed time accounts for the session base offset. Find the 250ms tick effect:

```tsx
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = audioRef.current;
      if (a) setPos(a.currentTime());
```

Replace just the `setPos` line with:

```tsx
      if (a) setPos(sessionBaseRef.current + a.currentTime());
```

Add the new ref near the other refs (search for `const startedRef = useRef(false);` and add after):

```tsx
  const sessionBaseRef = useRef(0); // session offset (seconds) — set on each boot, current pos = sessionBase + audio.currentTime()
```

Also adjust the play-pause toggle so the first-tap path sets `wasPlayingRef.current = true`. Find:

```tsx
    if (!startedRef.current) {
      if (audioRef.current) await audioRef.current.start();
      videoRef.current?.start();
      for (const c of pendingVideoRef.current) videoRef.current?.feed(c);
      for (const c of pendingAudioRef.current) audioRef.current?.feed(c);
      pendingVideoRef.current = [];
      pendingAudioRef.current = [];
      startedRef.current = true;
      setPaused(false);
      setStatus('');
      return;
    }
```

Replace with:

```tsx
    if (!startedRef.current) {
      wasPlayingRef.current = true;
      await autoStartPlayback();
      setStatus('');
      return;
    }
```

And the pause toggle branch — find:

```tsx
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
    } else {
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
    }
```

Replace with:

```tsx
    if (!paused) {
      videoRef.current?.stop();
      await a?.ctx.suspend();
      setPaused(true);
      wasPlayingRef.current = false;
    } else {
      await a?.ctx.resume();
      videoRef.current?.start();
      setPaused(false);
      wasPlayingRef.current = true;
    }
```

- [ ] **Step 3: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: clean build.

- [ ] **Step 4: Manual smoke (deferred to deployed test in Task 10)**

Seek isn't user-visible yet because `PlayerControls` still has the inert scrub bar. We wire the UI in Task 8.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/api.ts web/src/views/Player.tsx
git commit -m "Player: reseek via tear-down + reboot; skip ±10s wired to reseek"
```

---

## Task 8: PlayerControls — drag preview, volume slider, fullscreen, skip wiring

**Files:**
- Modify: `web/src/components/PlayerControls.tsx`
- Modify: `web/src/views/Player.tsx` (pass new props)

**Interfaces:**
- Consumes: `Player.tsx`'s `onSeek`, `onSeekRelative`, plus new `volume`, `setVolume`, `muted`, `setMuted` (all backed by `audio.setVolume` / `setMuted` plus localStorage persistence), and `thumbnailUrlTemplate` from `resolutionRef`.
- Produces: a controls overlay with a working scrub bar that shows a `<img>` preview during drag (when template is available), wired skip buttons, volume slider + speaker glyph, fullscreen button.

- [ ] **Step 1: Replace `web/src/components/PlayerControls.tsx`**

```tsx
import { useEffect, useState } from 'preact/hooks';

interface PlayerControlsProps {
  paused: boolean;
  posSec: number;
  durationSec: number;
  visible: boolean;
  thumbnailUrlTemplate?: string;
  volume: number;
  muted: boolean;
  fullscreen: boolean;
  onPlayPause(): void;
  onSeek(sec: number): void;
  onSeekRelative(deltaSec: number): void;
  onClose(): void;
  onVolumeChange(v: number): void;
  onMuteToggle(): void;
  onFullscreenToggle(): void;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    : `${m}:${s.toString().padStart(2, '0')}`;
}

function speakerGlyph(v: number, muted: boolean): string {
  if (muted || v === 0) return '🔇';
  if (v < 0.34) return '🔈';
  if (v < 0.67) return '🔉';
  return '🔊';
}

export function PlayerControls(p: PlayerControlsProps) {
  const [previewPos, setPreviewPos] = useState<number | null>(null);

  // Reset preview when not actively dragging.
  useEffect(() => {
    if (!p.visible) setPreviewPos(null);
  }, [p.visible]);

  const scrubPos = previewPos ?? p.posSec;
  const sliderMax = Math.max(1, p.durationSec);
  const previewMs = previewPos !== null
    ? Math.floor(previewPos * 100) * 100  // round down to nearest 100ms first
    : null;
  // BIF bucket = 10s.
  const previewBucketMs = previewMs !== null ? Math.floor(previewMs / 10000) * 10000 : null;
  const previewSrc = p.thumbnailUrlTemplate && previewBucketMs !== null
    ? p.thumbnailUrlTemplate.replace('{ms}', String(previewBucketMs))
    : null;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        onClick={p.onClose}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10,
          opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
          pointerEvents: p.visible ? 'auto' : 'none',
        }}
      >✕</button>

      {previewSrc && (
        <img
          src={previewSrc}
          alt=""
          style={{
            position: 'fixed', bottom: 110, left: '50%',
            transform: `translateX(calc(-50% + ${
              ((scrubPos / sliderMax) - 0.5) * Math.min(window.innerWidth - 40, 1400)
            }px))`,
            width: 160, height: 90, objectFit: 'cover',
            borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            border: '2px solid #fff',
            opacity: p.visible ? 1 : 0, transition: 'opacity 100ms',
            pointerEvents: 'none', zIndex: 11,
          }}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
        />
      )}

      <div style={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        padding: '24px 20px 16px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.85), rgba(0,0,0,0))',
        opacity: p.visible ? 1 : 0, transition: 'opacity 200ms',
        pointerEvents: p.visible ? 'auto' : 'none',
        zIndex: 10,
      }}>
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={1}
          value={Math.min(scrubPos, sliderMax)}
          onInput={(e) => setPreviewPos(Number((e.currentTarget as HTMLInputElement).value))}
          onChange={(e) => {
            const v = Number((e.currentTarget as HTMLInputElement).value);
            setPreviewPos(null);
            p.onSeek(v);
          }}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
          <button onClick={() => p.onSeekRelative(-10)}>◀ 10s</button>
          <button onClick={p.onPlayPause}>{p.paused ? '▶' : '⏸'}</button>
          <button onClick={() => p.onSeekRelative(+10)}>10s ▶</button>

          <button onClick={p.onMuteToggle} title="Mute" style={{ marginLeft: 16 }}>
            {speakerGlyph(p.volume, p.muted)}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(p.volume * 100)}
            onInput={(e) => p.onVolumeChange(Number((e.currentTarget as HTMLInputElement).value) / 100)}
            style={{ width: 100 }}
            aria-label="Volume"
          />

          <span class="muted" style={{ marginLeft: 'auto' }}>
            {fmt(scrubPos)} / {fmt(p.durationSec)}
          </span>

          <button onClick={p.onFullscreenToggle} title={p.fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {p.fullscreen ? '⤓' : '⤢'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the new props in `Player.tsx`**

Add the volume / mute / fullscreen state near the top of the `Player` function (after the existing `useState` calls):

```tsx
  const VOL_KEY = 'passenger.v2.volume';
  const [volume, setVolume] = useState<number>(() => {
    const raw = localStorage.getItem(VOL_KEY);
    const n = raw === null ? 1 : Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 1;
  });
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
```

Add a `useEffect` to push volume into the AudioSink whenever volume / muted changes, and to persist volume:

```tsx
  useEffect(() => {
    audioRef.current?.setVolume(volume);
    localStorage.setItem(VOL_KEY, String(volume));
  }, [volume]);
  useEffect(() => {
    audioRef.current?.setMuted(muted);
  }, [muted]);
```

Also push volume/muted into AudioSink on its construction. Find this block in `bootSession`:

```tsx
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audioRef.current = audio;
            }
```

Replace with:

```tsx
            if (info.audioConfig) {
              const audio = new AudioSink({
                config: info.audioConfig,
                onError: (e) => setErrMsg(`audio: ${e.message}`),
              });
              audio.setVolume(volume);
              audio.setMuted(muted);
              audioRef.current = audio;
            }
```

Add a fullscreen listener effect:

```tsx
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  async function onFullscreenToggle(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* browser blocked; ignore */ }
  }

  function onMuteToggle(): void { setMuted((m) => !m); }
  function onVolumeChange(v: number): void {
    setVolume(v);
    if (v > 0 && muted) setMuted(false);
  }
```

Update the `<PlayerControls>` render at the bottom of the file. Replace the existing call:

```tsx
      <PlayerControls
        paused={paused}
        posSec={pos}
        durationSec={duration}
        visible={controlsVisible}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
      />
```

With:

```tsx
      <PlayerControls
        paused={paused}
        posSec={pos}
        durationSec={duration}
        visible={controlsVisible}
        thumbnailUrlTemplate={resolutionRef.current?.thumbnailUrlTemplate}
        volume={volume}
        muted={muted}
        fullscreen={fullscreen}
        onPlayPause={onPlayPause}
        onSeek={onSeek}
        onSeekRelative={onSeekRelative}
        onClose={onClose}
        onVolumeChange={onVolumeChange}
        onMuteToggle={onMuteToggle}
        onFullscreenToggle={onFullscreenToggle}
      />
```

- [ ] **Step 3: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

Expected: clean build.

- [ ] **Step 4: Manual smoke (locally)**

`npm run dev`, navigate to a movie, hit Play. Verify controls render with speaker glyph + volume slider + fullscreen button. Wired interactivity tested for real after deploy.

- [ ] **Step 5: Commit**

```powershell
cd C:\github\passenger
git add web/src/components/PlayerControls.tsx web/src/views/Player.tsx
git commit -m "PlayerControls: drag preview, volume + mute, fullscreen, skip wired"
```

---

## Task 9: Tap-to-pause on canvas

**Files:**
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Consumes: existing `onPlayPause`.
- Produces: clicking the video container area toggles play/pause. Clicks on the controls overlay are stopped from bubbling (already done in Task 8's PlayerControls outer `<div onClick={stopPropagation}>`).

- [ ] **Step 1: Add the click handler to the outermost container**

In `Player.tsx`, find the outer `<div>` of the rendered output:

```tsx
    <div style={{
      position: 'fixed', inset: 0, background: '#000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
```

Replace with:

```tsx
    <div
      onClick={() => { if (!errMsg) void onPlayPause(); }}
      style={{
        position: 'fixed', inset: 0, background: '#000',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
```

The `cursor: pointer` is a desktop affordance; harmless on Tesla. The errMsg guard avoids toggling state when the player is already in a fatal-error state.

- [ ] **Step 2: Build**

```powershell
cd C:\github\passenger\web
npm run build
```

- [ ] **Step 3: Manual smoke (locally)**

`npm run dev`, navigate to player. Tap on the video area → pauses; tap again → resumes. Tap on the controls (close button, scrub bar, play button) → only the control's own action fires, not a stray pause.

- [ ] **Step 4: Commit**

```powershell
cd C:\github\passenger
git add web/src/views/Player.tsx
git commit -m "Player: tap-anywhere-on-canvas toggles play/pause"
```

---

## Task 10: Deploy + Tesla smoke

**Files:** none (deploy only)

**Interfaces:** consumes the prior 9 tasks' work.

- [ ] **Step 1: Deploy worker**

```powershell
cd C:\github\passenger\worker
npx wrangler deploy
```

Confirm the deployment line at the end. Note the worker version ID.

- [ ] **Step 2: Build + deploy frontend**

```powershell
cd C:\github\passenger\web
npm run build

cd C:\github\passenger
npx wrangler pages deploy ./web/dist --project-name=passenger-v2 --branch=v2 --commit-dirty=true
```

Note the printed preview URL.

- [ ] **Step 3: Hard-refresh + verify new bundle**

Open `https://passenger-v2.pages.dev/`. Hard-refresh (Ctrl+Shift+R). In devtools Sources, confirm the new `index-<hash>.js` filename matches the printed one.

- [ ] **Step 4: Smoke each feature on desktop**

Pair Plex if not already. Open Backrooms (or any item ≥ 5 min long). Verify:

- ✓ Single tap on video area toggles play/pause
- ✓ Tap on the controls overlay (scrub bar, buttons) does NOT toggle play/pause
- ✓ Drag the scrub bar — thumbnail preview appears at the drag position
- ✓ Release the scrub bar — "Seeking…" appears briefly; playback resumes from new position within ~3 s
- ✓ Skip +10s and -10s buttons jump by 10 s; "Seeking…" briefly; resumes
- ✓ Volume slider attenuates audio in real time
- ✓ Speaker glyph changes (🔇/🔈/🔉/🔊) as volume changes
- ✓ Speaker tap toggles mute
- ✓ Reload page → volume restored from localStorage
- ✓ Fullscreen button enters/exits fullscreen on desktop (Tesla treats it as a no-op)

- [ ] **Step 5: Smoke MP3 audio**

Use any Plex item known to have MP3 audio in its source (older / lower-bitrate content where Plex's transcoder direct-streams the audio). Confirm playback works without the `MKV: unsupported audio codec A_MPEG/L3` error.

- [ ] **Step 6: Tesla validation**

Open `https://passenger-v2.pages.dev/` in the Tesla browser. With the same source already paired (or pair via phone). Play Backrooms; tap to pause; seek via scrub bar; skip ±10s; volume slider; mute.

While playing, shift the car out of Park (in a controlled stationary spot). Confirm playback continues — this re-validates the v2 stack on top of the new controls.

- [ ] **Step 7: Record result in spec, commit**

Append a "Player polish v1 result" section to `docs/superpowers/specs/2026-06-27-player-polish-design.md`:

```markdown
## Player polish v1 result (recorded YYYY-MM-DD)

- Worker version: <id from Step 1>
- Pages preview: <url from Step 2>
- All 8 desktop checks: <pass | issues>
- MP3 smoke: <pass | issues>
- Tesla smoke: <pass | issues>
- Notes:
```

```powershell
cd C:\github\passenger
git add docs/superpowers/specs/2026-06-27-player-polish-design.md
git commit -m "Record player-polish v1 acceptance result"
```

- [ ] **Step 8: Push the v2 branch**

```powershell
git push origin v2
```

---

## Self-review notes

- **Spec coverage** — each spec section maps to at least one task:
  - Seek architecture → Tasks 1, 3, 4, 7
  - Skip ±10s wiring → Task 7 (`onSeekRelative`)
  - Thumbnail preview → Tasks 1, 3 (template), 8 (UI)
  - Tap-to-pause → Tasks 8 (event-stopping in controls) + 9 (canvas handler)
  - Volume + mute → Tasks 5 (AudioSink) + 8 (UI)
  - Fullscreen → Task 8
  - MP3 codec → Task 2
  - Engine extraction → Task 6
  - Deploy + smoke → Task 10
- **No placeholders** — every step contains complete code or commands. The "deferred to deploy" smoke steps in Tasks 5–9 are intentional: the user-visible interactivity doesn't exist until Task 8's UI lands, so checking each piece on desktop is consolidated in Task 10's Step 4 checklist.
- **Type consistency check** — `thumbnailUrlTemplate` is the field name across Task 1 (worker types), Task 1 (web types), Task 3 (Plex impl), and Task 8 (PlayerControls prop + Player.tsx usage). `fromSec` is the parameter name across Tasks 1 (adapter signature), 3 (impl), 4 (worker route + parseFromSecParam), 7 (api.ts client). `EngineHandle.dispose()` and `bootEngine(opts)` are used identically across Tasks 6 and 7. `setVolume`/`getVolume`/`setMuted`/`isMuted` are stable across Tasks 5 and 8.
- **Defensive choices** — `reseek` uses a `seekTokenRef` so a rapid second drag-release cancels the in-flight first reseek. `volume` is clamped in `setVolume` (Task 5) AND in the slider div (Task 8). `bootEngine` carries a `disposed` flag so late callbacks after `dispose()` are no-ops.
