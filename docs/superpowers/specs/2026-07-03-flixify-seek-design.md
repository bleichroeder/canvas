# Sub-project O: Flixify seek + resume

**Date:** 2026-07-03
**Target release:** v0.10.0
**Scope:** Wire engine-level seek for MP4-served static-URL streams. Enables Flixify (and any future adapter with static CDN URLs) to honor `fromSec` for seek, resume-from-position, and downstream features that depend on real playback tracking.

## Goal

Fix the "seek doesn't work on Flixify" symptom surfaced during v0.9.0 in-vehicle validation, and its silent siblings:
- Resume-from-position on Flixify episodes starts playback from 0 while UI displays the target time.
- The "Resume Xm" indicator's Play button doesn't actually resume.
- `pickDefaultSeason`'s in-progress heuristic is technically correct but useless — the underlying playback offset was a lie.
- Autoplay-next-episode advances episodes correctly but ignores the next episode's viewOffsetSec.

Plex is unaffected (its transcoder pre-offsets stream URLs via `?offset={fromSec}`). This sub-project makes Flixify behavior match Plex behavior — same UX, different mechanism.

## Non-goals

- **MKV seek.** No SeekHead / Cues parsing in `mkv-source.ts`. If Flixify (or any source) serves MKV, seek falls through with a `seek_unsupported` diagnostic event and playback starts at t=0 with accurate `pos` display (honest degradation, not the current lie).
- **MP3 seek.** Same as MKV — degrade gracefully.
- **Seamless seek.** `reseek()` still disposes and reboots the engine, taking ~1-2s. Keeping the engine alive across a seek (feed new bytes into an existing mp4box instance) would be a much larger change and is not needed here.
- **CDN-doesn't-honor-Range fallback.** Assume Flixify's CDN honors byte-range requests (standard for streaming). Handle 200-instead-of-206 responses in a followup only if it comes up.
- **MP4 files with moov-at-end.** Rare in streaming (servers apply faststart). If we hit one, the fetch stalls until moov is parsed — an existing engine behavior, not something this sub-project addresses.

## Global constraints

- Backend changes limited to the `PlayResolution` type and the two source adapters (Plex, Flixify).
- Frontend changes limited to `web/src/player/engine.ts`, `web/src/views/Player.tsx`, and `web/src/types.ts`. Do not touch `demux.ts`, `range-fetcher.ts`, `stream-source.ts`, or audio/video sinks — the primitives already do what we need.
- Preserve the existing behavior for Plex end-to-end. `streamStartSec = fromSec` means "URL is pre-offset by fromSec"; engine does no seek in that case.
- No test framework additions — verification is `bun run typecheck` + `npm --prefix web run build` + manual QA (matches project practice through sub-projects A–N).
- Commit messages: NO `Co-Authored-By: Claude` trailer, NO "Generated with Claude Code" footer.

---

## Server changes

### `server/src/sources/types.ts`

Add an optional `streamStartSec?: number` field to `PlayResolution`:

```ts
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
  /**
   * The stream's t=0 corresponds to this many seconds into the actual media.
   * Adapters that pre-offset the stream URL server-side set this to the
   * requested fromSec (e.g., Plex transcoder with `?offset=X`). Adapters that
   * return the raw file leave it 0 (or unset — treated as 0). The client
   * engine seeks by `fromSec - streamStartSec` after moov parses.
   */
  streamStartSec?: number;
}
```

### `server/src/sources/plex.ts`

Set `streamStartSec: fromSec` when a positive offset is requested:

```ts
if (typeof fromSec === 'number' && fromSec > 0) {
  params.set('offset', String(Math.floor(fromSec)));
}
// ...existing code that assembles `url`...
return {
  url,
  durationSec: Math.round(durationMs / 1000),
  streamStartSec: typeof fromSec === 'number' && fromSec > 0 ? Math.floor(fromSec) : 0,
  ...(subtitleTracks.length > 0 ? { subtitleTracks } : {}),
  ...(thumbnailUrlTemplate ? { thumbnailUrlTemplate } : {}),
};
```

### `server/src/sources/flixify.ts`

Remove the `void fromSec` line — it's no longer accurate (the client will use `fromSec`; the adapter just returns a static URL). Leave `streamStartSec` unset (client treats undefined as 0).

Update the stale comment:
```ts
async resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution> {
  // Flixify streams are static CDN URLs. The client engine seeks to fromSec
  // via demuxer.seek() → fetcher.seek() after the mp4 moov parses;
  // streamStartSec stays 0 (default) to signal this to the client.
  void fromSec;
  // ...existing resolveStream body...
}
```

---

## Frontend changes

### `web/src/types.ts`

Mirror the `streamStartSec` field on the client `PlayResolution` interface:

```ts
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: { id: string; language?: string; label?: string }[];
  subtitleTracks?: { id: string; language?: string; label?: string; url: string; format: 'vtt' | 'srt' }[];
  thumbnailUrlTemplate?: string;
  /** The stream's t=0 in file-time seconds. Undefined = 0. See adapter for details. */
  streamStartSec?: number;
}
```

### `web/src/player/engine.ts`

Extend `BootEngineOptions`:

```ts
export interface BootEngineOptions {
  url: string;
  /** File-time (seconds) that the client wants playback to begin at. */
  fromSec: number;
  /** File-time (seconds) that the URL's t=0 corresponds to. If fromSec > streamStartSec,
   *  the engine seeks after the demuxer emits onReady. */
  streamStartSec: number;
  getClock: () => number;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
  onDone: () => void;
}
```

Wire the seek after `onReady`. In `bootEngine`, wrap the `AutoSource`'s `onReady` handler to intercept and check whether an engine seek is needed:

```ts
const seekDeltaSec = opts.fromSec - opts.streamStartSec;

const source = new AutoSource({
  onReady: (info) => {
    if (disposed) return;
    // Forward to caller first — Player mounts sinks in its onReady handler.
    opts.onReady(info);
    // If seek is needed, ask the source for the byte offset and redirect
    // the fetcher. Only the mp4 path supports this today; other formats
    // emit seek_unsupported and let playback start at streamStartSec.
    if (seekDeltaSec > 0) {
      const target = source.seekToByteOffset(seekDeltaSec);
      if (target === null) {
        emit('seek_unsupported', {
          format: source.format,
          fromSec: opts.fromSec,
          streamStartSec: opts.streamStartSec,
          seekDeltaSec,
        });
      } else {
        emit('engine_seek', {
          format: source.format,
          fromSec: opts.fromSec,
          seekDeltaSec,
          videoByteOffset: target.videoByteOffset,
          actualStreamTime: target.time,
        });
        fetcher.seek(target.videoByteOffset);
      }
    }
  },
  // ...rest unchanged...
});
```

This requires exposing `seekToByteOffset` and `format` on the `AutoSource` / `StreamSource` contract. Add to `stream-source.ts`:

```ts
export interface StreamSource {
  appendChunk(offset: number, bytes: Uint8Array): void;
  flush(): void;
  /** Return the byte offset (and actual keyframe-aligned time) for a
   *  container-time target, or null if this source can't seek. */
  seekToByteOffset(streamTimeSec: number): { videoByteOffset: number; time: number } | null;
}
```

Implementations:
- `Mp4SourceAdapter.seekToByteOffset(t)` → `this.demuxer.seek(t)` (already returns `{ videoByteOffset, time }`).
- `MkvSourceAdapter.seekToByteOffset(_)` → `null`.
- `Mp3SourceAdapter.seekToByteOffset(_)` → `null` for now (VBR MP3 needs a scan; CBR is easy but out of scope).
- `AutoSource.seekToByteOffset(t)` → delegates to `this.inner?.seekToByteOffset(t) ?? null`. Also exposes `get format() { return this.format; }`.

### `web/src/views/Player.tsx`

Update `bootSession` to pass the two new params through and to source `sessionBaseRef.current` from `streamStartSec` (not `fromSec`):

```ts
const resolution = await api.play(source, id, fromSec);
// ...
resolutionRef.current = resolution;
setDuration(resolution.durationSec);
setSubtitleTracks(resolution.subtitleTracks ?? []);
// ...
engineRef.current = bootEngine({
  url: resolution.url,
  fromSec,
  streamStartSec: resolution.streamStartSec ?? 0,
  getClock: () => audioRef.current?.currentTime() ?? 0,
  onReady: (info) => {
    // ...existing sink construction unchanged...
    sessionBaseRef.current = resolution.streamStartSec ?? 0;
    setStatus('');
    // ...rest unchanged...
  },
  // ...
});
```

Rationale for `sessionBaseRef.current = streamStartSec`:
- **Plex path.** `streamStartSec = fromSec`. Stream's t=0 corresponds to file-time fromSec. Samples emerge from the demuxer with pts starting at 0 (transcoder resets pts). `AudioSink.currentTime()` (from sub-project K) reports currentPtsSec ≈ 0 initially, incrementing. `pos = fromSec + currentPtsSec` → correct.
- **Flixify path.** `streamStartSec = 0`. Stream's t=0 IS file's t=0. After engine seek, samples emerge with their original pts (~= fromSec). `AudioSink.currentTime()` reports currentPtsSec ≈ fromSec initially, incrementing. `pos = 0 + currentPtsSec = fromSec` → correct.

---

## Diagnostic events

Two new event kinds in the diagnostics ring:

- `engine_seek` — fired when the engine successfully redirects the fetcher after a demuxer-computed seek. Payload: `{ format, fromSec, seekDeltaSec, videoByteOffset, actualStreamTime }`.
- `seek_unsupported` — fired when `fromSec > streamStartSec` but the source's `seekToByteOffset` returned null (MKV, MP3, unknown). Payload: `{ format, fromSec, streamStartSec, seekDeltaSec }`. Playback proceeds from `streamStartSec`.

These land in the same ring buffer viewed by the DiagnosticsOverlay, so a support session can confirm whether seek fired or degraded.

---

## Downstream side-effects that now work for Flixify

- Resume-from-position (initial `from=X` on `/play/{source}/{id}` URLs).
- The "Resume Xm" indicator's Play → actually resumes at the offset.
- `pickDefaultSeason`'s in-progress heuristic reflects real playback.
- Autoplay-next-episode with per-episode resume positions (advances to next episode; if that next episode has viewOffsetSec > 0, engine seeks there).
- Scrubbing (back-10, forward-10, timeline drag) all funnel through `reseek → bootSession(target)` — same code path.

---

## Verification

Per project practice — no test framework, `bun run typecheck` + `npm --prefix web run build` per task, plus manual QA.

**Regression checklist:**
- Plex resume-from-mid-episode plays from the resume point (as today).
- Plex forward/backward scrub works (as today).
- Plex autoplay next-episode advances correctly.

**New-behavior checklist:**
- Flixify resume-from-mid-episode plays from the resume point.
- Flixify forward scrub (any distance) — target reachable within ~2s (engine boot + moov parse + seek).
- Flixify backward scrub — same.
- Flixify autoplay next-episode with the next episode having a resume position — resumes correctly.
- Injected fatal error near end-of-stream still opens the error dialog (v0.9.0 fix preserved).

**Degradation checklist (only if any test title serves MKV):**
- `seek_unsupported` diagnostic fires.
- Playback starts at 0:00; `pos` display is accurate (not the current 45:00 lie).

**In-vehicle validation before v0.10.0 tag:**
- One Flixify TV binge session including a mid-episode seek + a next-episode transition.
- One error injection to confirm the dialog + retry flow still works.

---

## Files created / modified

**Created:** none.

**Modified:**
- `server/src/sources/types.ts` — add `streamStartSec?: number` to `PlayResolution`.
- `server/src/sources/plex.ts` — set `streamStartSec: fromSec` in resolveStream return.
- `server/src/sources/flixify.ts` — update the stale `void fromSec` comment; no behavior change here.
- `web/src/types.ts` — mirror `streamStartSec` on client `PlayResolution`.
- `web/src/player/stream-source.ts` — extend `StreamSource` interface with `seekToByteOffset`; add `format` getter on `AutoSource`; wire the three concrete sources (mp4 = delegate to demuxer.seek, mkv = return null, mp3 = return null).
- `web/src/player/engine.ts` — `BootEngineOptions.fromSec` + `.streamStartSec`; wrap onReady to fire engine seek when `fromSec > streamStartSec`; emit `engine_seek` / `seek_unsupported` diagnostics.
- `web/src/views/Player.tsx` — pass `fromSec` + `streamStartSec` to bootEngine; set `sessionBaseRef.current = resolution.streamStartSec ?? 0` (not `fromSec`).

**Untouched:**
- `web/src/player/demux.ts` — already has the `seek` method.
- `web/src/player/range-fetcher.ts` — already has the `seek` method.
- `web/src/player/mkv-source.ts` — returns null from the new `seekToByteOffset` (no implementation needed for graceful degradation).
- `web/src/player/mp3-source.ts` — same.
- `web/src/player/audio.ts` / `video.ts` — already pts-aware (sub-project K).
- All other server code.

---

## Release plan

1. Merge sub-project O to `main`.
2. Tag `v0.10.0`.
3. Publish workflow builds + pushes `ghcr.io/bleichroeder/canvas:0.10.0`, `:0.10`, `:latest`.
4. Watchtower rolls installations forward within ~5 minutes.
5. Release notes highlight: Flixify seek + resume support, `streamStartSec` PlayResolution field for future adapters.
