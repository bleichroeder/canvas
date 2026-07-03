# Sub-project O: Flixify Seek + Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable seek and resume-from-position on MP4-served static-URL streams (Flixify today; any similarly-shaped future adapter) by wiring the existing `Demuxer.seek` and `RangeFetcher.seek` primitives at the engine level.

**Architecture:** Server signals `PlayResolution.streamStartSec` (the file-time seconds that the URL's t=0 corresponds to). Plex sets it to `fromSec` because its transcoder pre-offsets the URL; Flixify leaves it unset (0) because streams are static CDN URLs. The client's `bootEngine` accepts `fromSec` and `streamStartSec` params. If `fromSec > streamStartSec`, after the mp4 demuxer's `onReady` (moov parsed) fires, the engine calls `demuxer.seek(delta)` to get a byte offset and `fetcher.seek(byteOffset)` to redirect the download — before mp4box's `file.start()` runs, so sample extraction starts from the seeked-to sample.

**Tech Stack:** Bun + Hono + TypeScript server (`server/`), React 18 + Vite 5 + TypeScript + MUI 6 + WebCodecs frontend (`web/`), mp4box.js for MP4 demuxing.

## Global Constraints

- No test framework in either server or web. Server verification: `bun run typecheck` (runs `tsc --noEmit`). Web verification: `npm --prefix web run build` (runs `tsc --noEmit && vite build`). Behavioral verification is manual dev-server / docker QA.
- Commit messages: NO `Co-Authored-By: Claude ...` trailer, NO "🤖 Generated with Claude Code" footer. User has explicitly opted out of Claude attribution.
- Do not touch `web/src/player/demux.ts`, `web/src/player/range-fetcher.ts`, `web/src/player/audio.ts`, `web/src/player/video.ts`, `web/src/player/chunk-buffer.ts`, or any MKV/MP3 source internals — the primitives already exist and non-MP4 sources will return `null` from the new `seekToByteOffset` for graceful degradation.
- Preserve existing Plex behavior end-to-end. `streamStartSec = fromSec` means "URL is pre-offset"; engine does no seek in that case.
- No changes to how `sessionBaseRef` is otherwise used — only its assignment source changes (from `fromSec` to `resolution.streamStartSec ?? 0`).
- MKV / MP3 seek is a non-goal. Their `seekToByteOffset` returns `null`; engine emits `seek_unsupported` diagnostic and playback proceeds from `streamStartSec` (0) with accurate `pos` display.

---

## File Structure

**Modified:**
- `server/src/sources/types.ts` — add optional `streamStartSec` field to `PlayResolution`. Responsibility: canonical shape shared by all source adapters.
- `server/src/sources/plex.ts` — populate `streamStartSec: fromSec` when the transcoder URL is offset. Responsibility: Plex adapter play resolver.
- `server/src/sources/flixify.ts` — comment update only (adapter's `void fromSec` becomes correct — the client now handles it). Responsibility: Flixify adapter play resolver.
- `web/src/types.ts` — mirror the server's `streamStartSec` field on the client `PlayResolution`. Responsibility: client-side type surface.
- `web/src/player/stream-source.ts` — extend `StreamSource` interface with `seekToByteOffset(streamTimeSec)`; implement in `Mp4SourceAdapter` (delegate to `demuxer.seek`); return `null` in `MkvSourceAdapter` and `Mp3SourceAdapter`; expose `format` getter on `AutoSource`. Responsibility: seek dispatch across the three container adapters.
- `web/src/player/engine.ts` — `BootEngineOptions` gains `fromSec` + `streamStartSec`; the `AutoSource.onReady` wrapper computes `seekDeltaSec` and (if positive) calls `source.seekToByteOffset` then `fetcher.seek`; emits `engine_seek` / `seek_unsupported` diagnostic events. Responsibility: orchestrating the seek dance during engine boot.
- `web/src/views/Player.tsx` — read `resolution.streamStartSec`; pass `fromSec` and `streamStartSec` into `bootEngine`; set `sessionBaseRef.current = resolution.streamStartSec ?? 0` (not `fromSec`) inside the `onReady` handler that constructs the sinks. Responsibility: engine invocation + playback-clock base.

**Untouched (primitives already in place):**
- `web/src/player/demux.ts` — `Demuxer.seek(seconds)` at line 46 already returns `{ videoByteOffset, time }`.
- `web/src/player/range-fetcher.ts` — `RangeFetcher.seek(byteOffset)` at line 52 already aborts + restarts with `Range: bytes=X-`.
- `web/src/player/mkv-source.ts`, `mp3-source.ts` — no changes; new interface method returns `null` from their adapters in `stream-source.ts`.

---

## Critical mp4box timing note

`Demuxer.handleReady` at `web/src/player/demux.ts:55-106` calls `setExtractionOptions` on tracks → emits `onReady` → then calls `this.file.start()`. Our engine seek runs inside the `onReady` wrapper, **before** `file.start()`. Because mp4box's `file.seek(time, useRAP=true)` sets the extraction cursor, when `file.start()` runs it extracts from the seeked-to sample onwards. Pre-seek buffered bytes (moov + head-of-file) never emit samples. This is why no `ChunkBuffer.clear()` or explicit sample-drop is needed — the ordering guarantees samples only flow after the seek is applied.

---

## Task 1: Server-side `streamStartSec` plumbing

**Files:**
- Modify: `server/src/sources/types.ts`
- Modify: `server/src/sources/plex.ts`
- Modify: `server/src/sources/flixify.ts`

**Interfaces:**
- Consumes: existing `PlayResolution` shape and Plex adapter's `resolveStream` return.
- Produces: `PlayResolution.streamStartSec?: number` on the server-side interface; Plex's `resolveStream` return sets it to the floored `fromSec` when `fromSec > 0`, omits otherwise; Flixify's `resolveStream` unchanged (defaults absent = 0 on the client).

- [ ] **Step 1: Add `streamStartSec` field to server `PlayResolution`**

Modify `server/src/sources/types.ts`. Current interface at lines 97-108:

```ts
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

Replace with:

```ts
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
  /**
   * The stream's t=0 corresponds to this many seconds into the actual media.
   * Adapters that pre-offset the stream URL server-side (e.g., Plex transcoder
   * with `?offset=X`) set this to the requested fromSec. Adapters that return
   * the raw file leave it unset (client treats undefined as 0 and seeks in the
   * demuxer). See sub-project O spec (2026-07-03-flixify-seek-design.md).
   */
  streamStartSec?: number;
}
```

- [ ] **Step 2: Populate `streamStartSec` in Plex `resolveStream`**

Modify `server/src/sources/plex.ts`. Locate the `resolveStream` return object (currently around lines 315-320, immediately after `const url = ${ctx.baseUrl}/video/:/transcode/universal/start.mp4?${params.toString()};`):

```ts
    return {
      url,
      durationSec: Math.round(durationMs / 1000),
      ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
      ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
```

Add a `streamStartSec` field when `fromSec` is a positive number (the same condition that sets the transcoder `offset` param on lines 306-308):

```ts
    return {
      url,
      durationSec: Math.round(durationMs / 1000),
      ...(typeof fromSec === 'number' && fromSec > 0
        ? { streamStartSec: Math.floor(fromSec) }
        : {}),
      ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
      ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
```

(The exact closing `};` on the next line stays unchanged.)

- [ ] **Step 3: Update the Flixify `void fromSec` comment**

Modify `server/src/sources/flixify.ts`. Locate the `resolveStream` opening (currently around line 428):

```ts
  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    void fromSec;  // Flixify streams are static URLs; Player handles offset via reseek.
```

Replace the comment with an accurate one — no behavior change:

```ts
  async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
    // Flixify streams are static CDN URLs. streamStartSec is intentionally
    // omitted from the return (client treats absence as 0) — the client engine
    // seeks to fromSec via Demuxer.seek() + RangeFetcher.seek() after the mp4
    // moov parses. See sub-project O.
    void fromSec;
```

- [ ] **Step 4: Verify server typechecks**

Run:

```bash
cd C:/github/canvas/server && bun run typecheck
```

Expected: exits 0 with no compiler errors. The output is just `$ tsc --noEmit` followed by a clean exit (no errors listed).

- [ ] **Step 5: Commit**

```bash
cd C:/github/canvas
git add server/src/sources/types.ts server/src/sources/plex.ts server/src/sources/flixify.ts
git commit -m "feat: PlayResolution.streamStartSec signals pre-offset stream URLs"
```

---

## Task 2: Client-side type mirror + `StreamSource` seek contract

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/player/stream-source.ts`

**Interfaces:**
- Consumes: existing `StreamSource` interface (`appendChunk`, `flush`), `Demuxer.seek(seconds): { videoByteOffset: number; time: number }` from `web/src/player/demux.ts`, existing `AutoSource.format: StreamFormat` private field.
- Produces:
  - Client `PlayResolution.streamStartSec?: number` matching the server type.
  - New method on `StreamSource`: `seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null`. Returns non-null only for MP4; `null` from MKV/MP3 signals unsupported.
  - New public getter on `AutoSource`: `get format(): StreamFormat` (needed for diagnostic payloads in Task 3).

- [ ] **Step 1: Add `streamStartSec` to client `PlayResolution`**

Modify `web/src/types.ts`. Current interface at lines 84-91:

```ts
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
}
```

Replace with:

```ts
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
  /**
   * The stream's t=0 in file-time seconds. Undefined = 0 (client seeks in the
   * demuxer to reach fromSec). Set by adapters that pre-offset the URL
   * server-side (Plex transcoder). See sub-project O.
   */
  streamStartSec?: number;
}
```

- [ ] **Step 2: Extend `StreamSource` interface with `seekToByteOffset`**

Modify `web/src/player/stream-source.ts`. Current interface at lines 24-27:

```ts
export interface StreamSource {
  appendChunk(offset: number, bytes: Uint8Array): void;
  flush(): void;
}
```

Replace with:

```ts
export interface StreamSource {
  appendChunk(offset: number, bytes: Uint8Array): void;
  flush(): void;
  /**
   * Return the byte offset (and actual keyframe-aligned time) for a
   * stream-relative time target, or null if this source can't seek.
   * The MP4 path delegates to mp4box's file.seek(time, useRAP=true); MKV and
   * MP3 sources return null (no cursor-based random access implemented).
   */
  seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null;
}
```

- [ ] **Step 3: Implement `seekToByteOffset` on `Mp4SourceAdapter`**

In the same file, locate `Mp4SourceAdapter` (currently lines 127-144):

```ts
class Mp4SourceAdapter implements StreamSource {
  private readonly demuxer: Demuxer;
  constructor(opts: StreamSourceCallbacks) {
    this.demuxer = new Demuxer({
      onReady: (info) =>
        opts.onReady({
          duration: info.duration,
          videoConfig: info.videoConfig,
          audioConfig: info.audioConfig,
        }),
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.demuxer.appendChunk(offset, bytes); }
  flush(): void { this.demuxer.flush(); }
}
```

Replace with (adds `seekToByteOffset` that delegates to `Demuxer.seek`):

```ts
class Mp4SourceAdapter implements StreamSource {
  private readonly demuxer: Demuxer;
  constructor(opts: StreamSourceCallbacks) {
    this.demuxer = new Demuxer({
      onReady: (info) =>
        opts.onReady({
          duration: info.duration,
          videoConfig: info.videoConfig,
          audioConfig: info.audioConfig,
        }),
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.demuxer.appendChunk(offset, bytes); }
  flush(): void { this.demuxer.flush(); }
  seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null {
    return this.demuxer.seek(streamTimeSec);
  }
}
```

- [ ] **Step 4: Implement `seekToByteOffset` on `MkvSourceAdapter` and `Mp3SourceAdapter`**

In the same file, locate `MkvSourceAdapter` (currently lines 147-159):

```ts
class MkvSourceAdapter implements StreamSource {
  private readonly mkv: MkvSource;
  constructor(opts: StreamSourceCallbacks) {
    this.mkv = new MkvSource({
      onReady: opts.onReady,
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mkv.appendChunk(offset, bytes); }
  flush(): void { this.mkv.flush(); }
}
```

Replace with (adds a stub `seekToByteOffset` returning `null`):

```ts
class MkvSourceAdapter implements StreamSource {
  private readonly mkv: MkvSource;
  constructor(opts: StreamSourceCallbacks) {
    this.mkv = new MkvSource({
      onReady: opts.onReady,
      onVideoSample: opts.onVideoSample,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mkv.appendChunk(offset, bytes); }
  flush(): void { this.mkv.flush(); }
  seekToByteOffset(_streamTimeSec: number): { videoByteOffset: number; time: number } | null {
    // MKV seek (SeekHead + Cues parsing) is not implemented. Engine will
    // emit seek_unsupported and playback starts at streamStartSec (0).
    return null;
  }
}
```

Locate `Mp3SourceAdapter` (currently lines 162-172):

```ts
class Mp3SourceAdapter implements StreamSource {
  private readonly mp3: Mp3Source;
  constructor(opts: StreamSourceCallbacks) {
    this.mp3 = new Mp3Source({
      onReady: opts.onReady,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mp3.appendChunk(offset, bytes); }
  flush(): void { this.mp3.flush(); }
}
```

Replace with:

```ts
class Mp3SourceAdapter implements StreamSource {
  private readonly mp3: Mp3Source;
  constructor(opts: StreamSourceCallbacks) {
    this.mp3 = new Mp3Source({
      onReady: opts.onReady,
      onAudioSample: opts.onAudioSample,
      onError: opts.onError,
    });
  }
  appendChunk(offset: number, bytes: Uint8Array): void { this.mp3.appendChunk(offset, bytes); }
  flush(): void { this.mp3.flush(); }
  seekToByteOffset(_streamTimeSec: number): { videoByteOffset: number; time: number } | null {
    // MP3 seek not implemented (VBR needs a scan; CBR would need bitrate lookup).
    // Engine emits seek_unsupported; playback starts at streamStartSec (0).
    return null;
  }
}
```

- [ ] **Step 5: Expose `format` getter + `seekToByteOffset` on `AutoSource`**

Still in the same file, locate the `AutoSource` class (currently lines 58-124). Its `format` field is private (line 64: `private format: StreamFormat = 'unknown';`). We need to expose a public getter and add the delegating `seekToByteOffset`.

Find the `flush(): void { this.inner?.flush(); }` method at the end of the class (around line 121-123). Immediately after it (still inside the class body), add:

```ts
  /**
   * Container format identified by sniff. Used by the engine for diagnostic
   * payloads and to decide whether seek is supported.
   */
  get sourceFormat(): StreamFormat {
    return this.format;
  }

  seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null {
    return this.inner?.seekToByteOffset(streamTimeSec) ?? null;
  }
```

(Using `sourceFormat` as the getter name to avoid clashing with the existing private `format` field; renaming the private field would be a wider refactor and is out of scope.)

- [ ] **Step 6: Verify web build passes**

Run:

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0, `tsc --noEmit` clean, `vite built in <N>s` message. No new errors introduced.

- [ ] **Step 7: Commit**

```bash
cd C:/github/canvas
git add web/src/types.ts web/src/player/stream-source.ts
git commit -m "feat: StreamSource gains seekToByteOffset for engine-level seek dispatch"
```

---

## Task 3: `bootEngine` seek wire-up + `Player.tsx` invocation

**Files:**
- Modify: `web/src/player/engine.ts`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Consumes:
  - `StreamSource.seekToByteOffset(streamTimeSec): { videoByteOffset, time } | null` from Task 2.
  - `AutoSource.sourceFormat: StreamFormat` from Task 2.
  - Client `PlayResolution.streamStartSec` from Task 2.
  - Existing `RangeFetcher.seek(byteOffset): void` at `web/src/player/range-fetcher.ts:52`.
  - Existing `emit(kind, payload)` from `web/src/player/diagnostics.ts`.
- Produces:
  - `BootEngineOptions` extended with `fromSec: number` and `streamStartSec: number`.
  - New diagnostic event kinds: `engine_seek` (payload: `format, fromSec, seekDeltaSec, videoByteOffset, actualStreamTime`) and `seek_unsupported` (payload: `format, fromSec, streamStartSec, seekDeltaSec`).
  - `Player.tsx` `bootSession` passes `fromSec` + `streamStartSec` to `bootEngine`; sets `sessionBaseRef.current = resolution.streamStartSec ?? 0` inside the `onReady` handler.

- [ ] **Step 1: Extend `BootEngineOptions` in `engine.ts`**

Modify `web/src/player/engine.ts`. Current interface at lines 7-15:

```ts
export interface BootEngineOptions {
  url: string;
  getClock: () => number;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}
```

Replace with:

```ts
export interface BootEngineOptions {
  url: string;
  /** File-time (seconds) that the client wants playback to begin at. */
  fromSec: number;
  /**
   * File-time (seconds) that the URL's t=0 corresponds to. When
   * `fromSec > streamStartSec`, the engine performs a demuxer-level seek
   * after `onReady` fires (mp4 only; other formats emit seek_unsupported).
   */
  streamStartSec: number;
  getClock: () => number;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}
```

- [ ] **Step 2: Wire the seek dance inside `bootEngine`'s `AutoSource` construction**

Still in `engine.ts`, locate the `AutoSource` construction (currently lines 50-55):

```ts
  const source = new AutoSource({
    onReady: (info) => { if (!disposed) opts.onReady(info); },
    onVideoSample: (c) => { if (!disposed) buffer.pushVideo(c); },
    onAudioSample: (c) => { if (!disposed) buffer.pushAudio(c); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
  });
```

Replace with a version that intercepts `onReady` to fire the engine seek:

```ts
  const seekDeltaSec = opts.fromSec - opts.streamStartSec;
  const source = new AutoSource({
    onReady: (info) => {
      if (disposed) return;
      // The seek must run inside the onReady callback, BEFORE mp4box's
      // file.start() (which runs synchronously immediately after onReady is
      // dispatched in demux.ts:handleReady). file.seek(t, useRAP=true) sets
      // the extraction cursor; file.start() then extracts from that cursor
      // onwards, so pre-seek buffered bytes never emit samples.
      if (seekDeltaSec > 0) {
        const target = source.seekToByteOffset(seekDeltaSec);
        if (target === null) {
          emit('seek_unsupported', {
            format: source.sourceFormat,
            fromSec: opts.fromSec,
            streamStartSec: opts.streamStartSec,
            seekDeltaSec,
          });
        } else {
          emit('engine_seek', {
            format: source.sourceFormat,
            fromSec: opts.fromSec,
            seekDeltaSec,
            videoByteOffset: target.videoByteOffset,
            actualStreamTime: target.time,
          });
          fetcher.seek(target.videoByteOffset);
        }
      }
      opts.onReady(info);
    },
    onVideoSample: (c) => { if (!disposed) buffer.pushVideo(c); },
    onAudioSample: (c) => { if (!disposed) buffer.pushAudio(c); },
    onError: (e) => { if (!disposed) opts.onFatal(e); },
  });
```

(The `fetcher` and `buffer` bindings that this code references are declared later in `bootEngine`. This works because JS closures capture them lexically — `source`, `fetcher`, and `buffer` are all in the same function scope and all defined before `fetcher.start()` runs. If TypeScript complains about temporal-dead-zone use of `fetcher` inside the `source` constructor callback, note that `onReady` fires only after the fetcher delivers the moov bytes — long after both variables are defined.)

- [ ] **Step 3: Verify web build passes (engine only, before Player wiring)**

Run:

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

If the build errors on the `fetcher` reference inside the `source` callback, hoist the `source` variable declaration: declare `const fetcher = ...` first, then `const source = new AutoSource(...)`, then move the `buffer` declaration to whichever position makes both references legal. The order in the current file is `buffer` → `source` → `fetcher`; the new callback needs `fetcher` visible when it runs (which it will be at runtime because `onReady` fires after moov parses, well after all three are constructed) — TypeScript will let this pass as long as the closure captures by reference. If it doesn't, restructure to `let source: AutoSource;` declaration then `source = new AutoSource(...)` after `fetcher` is declared.

- [ ] **Step 4: Wire `bootEngine` invocation in `Player.tsx`**

Modify `web/src/views/Player.tsx`. Locate the `bootEngine` call inside `bootSession` (currently around lines 269-360). The current call starts with `engineRef.current = bootEngine({` and includes `url: resolution.url, getClock: ..., onReady: (info) => {...}, ...`.

Two changes needed:

**(a)** Add `fromSec` and `streamStartSec` to the options object. Insert two new lines immediately after `url: resolution.url,` (currently line 270):

```ts
        engineRef.current = bootEngine({
          url: resolution.url,
          fromSec,
          streamStartSec: resolution.streamStartSec ?? 0,
          getClock: () => audioRef.current?.currentTime() ?? 0,
```

**(b)** Change the `sessionBaseRef.current` assignment inside the `onReady` handler. The current line (around line 315) reads:

```ts
            sessionBaseRef.current = fromSec;
```

Replace with:

```ts
            sessionBaseRef.current = resolution.streamStartSec ?? 0;
```

Nothing else in the `onReady` handler changes.

- [ ] **Step 5: Verify web build passes**

Run:

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0, `tsc --noEmit` clean.

- [ ] **Step 6: Manual smoke test — Plex regression**

Start the dev flow to test against a real server. The simplest path with existing `canvas-data` volume: rebuild the local Docker image and swap it in (matches the sub-project N test process):

```bash
cd C:/github/canvas
docker build -t canvas:local .
```

Edit `docker-compose.yml` — change `image: ghcr.io/bleichroeder/canvas:latest` to `image: canvas:local`, and comment out the entire `watchtower:` service block (else Watchtower would replace canvas:local with ghcr:latest on the next poll). Then:

```bash
docker-compose up -d canvas
```

Open http://localhost:8787. Verify Plex behavior is unchanged:
- Play a Plex movie with a resume position (viewOffsetSec > 0). Verify playback resumes at the right point.
- Play a Plex TV episode; seek forward via the scrub bar to ~75% of the runtime. Verify content jumps to that point (audio + video sync).
- Seek backward using the −10s button. Verify content jumps back cleanly.

If the DiagnosticsOverlay is available (kebab menu → Diagnostics), verify NO `engine_seek` events fire for Plex — Plex's `streamStartSec = fromSec`, so `seekDeltaSec = 0` and the engine skips the seek block.

- [ ] **Step 7: Manual smoke test — Flixify seek + resume**

Still on the local Docker canvas:
- Play a Flixify TV episode that has a resume position (from Continue Watching row). Verify playback **actually resumes** at the offset (not just displays the offset while playing from 0).
- Seek forward via scrub bar to ~75% of the runtime. Verify content jumps to that point within ~2 seconds.
- Seek backward via the −10s button multiple times. Verify each jump resolves cleanly.
- Open DiagnosticsOverlay (kebab menu → Diagnostics). Verify `engine_seek` events appear with correct payloads: `format: 'mp4'`, `seekDeltaSec` matches the seek distance, `videoByteOffset` is populated.
- Play a Flixify movie. Repeat resume + seek tests.
- Optional: if Flixify serves any MKV titles in your library, play one and attempt a seek. Verify `seek_unsupported` event appears in DiagnosticsOverlay and playback starts at 0:00 (the timer should read 0:00, not the intended resume point — this is the graceful-degradation path).

- [ ] **Step 8: Commit**

```bash
cd C:/github/canvas
git add web/src/player/engine.ts web/src/views/Player.tsx
git commit -m "feat: engine-level MP4 seek for static-URL streams (Flixify, etc.)"
```

- [ ] **Step 9: Revert local test scaffolding**

Restore `docker-compose.yml` to reference `ghcr.io/bleichroeder/canvas:latest` and re-enable the `watchtower:` service block. Don't commit the compose file (it should already be at ghcr:latest in git; local swap-in was in your working tree only). Verify with:

```bash
cd C:/github/canvas
git status
```

Expected: `docker-compose.yml` shows as modified if you edited it in Step 6; run `git checkout docker-compose.yml` to restore.

---

## After all tasks — release

- [ ] **Step 1: In-vehicle validation**

Rebuild once with your Task 3 test image (or wait for v0.10.0 ghcr publish + Watchtower roll). Drive to the car with the Cloudflare Quick Tunnel URL and validate the full sub-project O flow end-to-end:
- Flixify TV binge session including a mid-episode seek and a next-episode transition.
- Plex TV binge session (regression check).
- One error injection to confirm the dialog + retry flow still works (v0.9.0 features preserved).

- [ ] **Step 2: Tag and publish v0.10.0**

```bash
cd C:/github/canvas
git tag -a v0.10.0 -m "canvas v0.10.0 — Flixify seek + resume"
git push origin v0.10.0
```

Watch the publish workflow at https://github.com/bleichroeder/canvas/actions. Once green, `ghcr.io/bleichroeder/canvas:latest` picks up v0.10.0 and Watchtower rolls installations forward within ~5 minutes.

- [ ] **Step 3: Update project memory**

Update `C:\Users\David\.claude\projects\C--code\memory\project_canvas.md`: bump latest release to v0.10.0, move sub-project O from "In progress" to the completed A–O list, and update `MEMORY.md` index accordingly.

---

## Self-review

**Spec coverage:**
- `streamStartSec` field on PlayResolution → Task 1 Step 1 (server), Task 2 Step 1 (client).
- Plex populates `streamStartSec` → Task 1 Step 2.
- Flixify leaves `streamStartSec` unset with corrected comment → Task 1 Step 3.
- `StreamSource.seekToByteOffset` contract → Task 2 Step 2.
- MP4 delegates to `Demuxer.seek` → Task 2 Step 3.
- MKV / MP3 return `null` → Task 2 Step 4.
- `AutoSource.sourceFormat` getter + `seekToByteOffset` delegation → Task 2 Step 5.
- `BootEngineOptions.fromSec` + `.streamStartSec` → Task 3 Step 1.
- Engine seek wired inside `onReady` wrapper with `engine_seek` / `seek_unsupported` diagnostics → Task 3 Step 2.
- `Player.tsx` passes `fromSec` + `streamStartSec` and sets `sessionBaseRef.current = streamStartSec ?? 0` → Task 3 Step 4.
- mp4box timing note surfaced in the plan header + Task 3 Step 2 comment.

**Placeholder scan:** No TBDs / TODOs / "implement later" outside of an accurate "MKV seek not implemented" comment in Task 2 Step 4 (which is a real design decision, not a placeholder — sub-project O explicitly defers MKV seek in non-goals).

**Type consistency:**
- `PlayResolution.streamStartSec?: number` — identical name and type across server (Task 1 Step 1) and client (Task 2 Step 1).
- `seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null` — identical signature across the interface declaration (Task 2 Step 2), MP4 adapter (Task 2 Step 3), MKV adapter (Task 2 Step 4), MP3 adapter (Task 2 Step 4), AutoSource delegation (Task 2 Step 5), and engine usage (Task 3 Step 2).
- `sourceFormat` getter name used consistently in Task 2 Step 5 (declaration) and Task 3 Step 2 (diagnostic payload).
- Diagnostic event payload field names (`format`, `fromSec`, `seekDeltaSec`, `videoByteOffset`, `actualStreamTime`, `streamStartSec`) consistent between the two event kinds.
