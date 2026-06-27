# Passenger v2 — Player Polish Design Spec

**Date:** 2026-06-27
**Status:** Approved, pending implementation plan
**Codename:** `passenger`
**Builds on:** `2026-06-27-passenger-v2-design.md`

## Purpose

After v2 reached "Plex playback works end-to-end" via the MKV demuxer, the player still lacks user-facing controls beyond play/pause. This spec covers the next round of player polish:

1. **Seek** — drag the scrub bar to jump anywhere.
2. **Skip ±10s** — wire the existing buttons.
3. **Thumbnail preview during scrub** — hover/drag shows a frame.
4. **Tap-to-pause on the canvas** — touch anywhere outside the controls toggles playback.
5. **Volume + mute** — slider + speaker glyph, persistent across reloads.
6. **Browser fullscreen** — explicit button.
7. **MP3 audio in MKV** — extend codec coverage so Plex's occasional direct-stream of MP3 plays.

Captions, audio-track switching, skip-intro markers, and auto-next-episode are **deliberately out of scope**. Captions ship in a separate plan immediately after; the other three are deferred indefinitely.

## Non-goals

- No support for non-`H.264 + (AAC|MP3)` codecs. AC3, DTS, EAC3, FLAC, HEVC, AV1 still surface "unsupported codec" errors.
- No on-the-fly bitrate / quality switching (Plex transcoder URL params are fixed at `maxVideoBitrate=8000`).
- No keyboard shortcuts (Tesla browser is touch-only; desktop preview lives with the touch UI).
- No analytics or telemetry on user actions.

## Constraints from the existing architecture

- **Plex's transcoder is a live stream.** Seeking inside an active transcode session is not supported by Plex. To seek we must tear down the current session and start a new one with `&offset=<seconds>`. Round-trip cost: 1–3 seconds for Plex to spin up the new transcode.
- **The Tesla browser is touch-only.** All interactive controls must be tappable; no hover-only affordances. The thumbnail preview is acceptable to omit on Tesla if dragging isn't possible — the scrub bar still works on tap-release.
- **Audio is master clock.** Volume changes go through the existing `AudioSink` → `AudioContext` chain, not video. Tap-to-pause and seek both go through audio's `suspend()` / `resume()` and the engine reboot path.
- **No new external dependencies.** All work uses platform APIs the canvas pipeline already relies on.

## Architecture

```
                       ┌────────────────────────────────────┐
                       │ Player.tsx                          │
                       │  engineRef: EngineHandle | null     │
                       │  pos / paused / volume state        │
                       └────────────┬───────────────────────┘
                                    │ bootEngine / dispose / reseek
                                    ▼
                       ┌────────────────────────────────────┐
                       │ EngineHandle (new fn pair)          │
                       │  - new RangeFetcher                 │
                       │  - new AutoSource                   │
                       │  - new VideoSink / AudioSink        │
                       │  - wire callbacks                   │
                       └────────────┬───────────────────────┘
                                    │
                                    ▼
   onClick canvas ─────────► togglePause()           ◄──── click events
                                                            stopPropagation
   scrub drag ─────────────► local state + preview img      from controls
   scrub release ──────────► reseek(targetSec)              overlay
   skip ±10s ──────────────► reseek(pos ± 10)
   volume slider ──────────► audio.setVolume(v)
   mute toggle ────────────► audio.setMuted(b)
   fullscreen button ──────► requestFullscreen / exit
```

Three small new things touch the worker; the rest is frontend-only.

## Backend changes

### `Adapter.resolveStream` gains an optional `fromSec`

```typescript
// worker/src/sources/types.ts
resolveStream(ctx: SourceContext, id: string, fromSec?: number): Promise<PlayResolution>;
```

Plex impl appends `&offset=<seconds>` to the transcoder URL when `fromSec` is provided. Other adapters can ignore the param without harm.

### `PlayResolution` gains an optional `thumbnailUrlTemplate`

```typescript
export interface PlayResolution {
  url: string;
  headers?: Record<string, string>;
  durationSec: number;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
  thumbnailUrlTemplate?: string; // contains literal "{ms}" the client substitutes
}
```

Plex impl fills it as `${baseUrl}/library/parts/${partId}/indexes/sd/{ms}?X-Plex-Token=${enc(token)}`. The Plex metadata response already includes `Media[0].Part[0].id` — no extra request.

### Worker `/api/play/:src/:id` accepts `?fromSec=N`

The play route reads the query string, parses `fromSec` as a number (validate ≥ 0), and passes through to `adapter.resolveStream`. Missing/invalid values are treated as undefined (start from zero).

## Frontend changes

### `EngineHandle` — extracted boot/dispose

Move the current inline `useEffect` engine wiring in `Player.tsx` into a pure function `bootEngine(opts)` returning an `EngineHandle` with `.dispose()`. The function takes a callbacks object (`onReady`, `onVideoSample`, `onAudioSample`, `onFatal`) and a canvas element; it constructs `RangeFetcher` + `AutoSource` + nothing else — the VideoSink and AudioSink are still constructed inside `onReady` because they depend on the parsed `videoConfig` / `audioConfig`.

```typescript
interface EngineHandle {
  setSinks(video: VideoSink, audio: AudioSink | null): void;
  dispose(): void;
}

function bootEngine(opts: {
  url: string;
  canvas: HTMLCanvasElement;
  onReady: (info: StreamInfo) => void;
  onVideoSample: (chunk: EncodedVideoChunk) => void;
  onAudioSample: (chunk: EncodedAudioChunk) => void;
  onFatal: (err: Error) => void;
}): EngineHandle;
```

`dispose()` aborts the fetcher, closes the video decoder, stops the audio sink, and clears the canvas.

### `Player.tsx` — adds reseek, retains state across reboots

The Player view's outer state survives reseeks: paused/played state, volume, the duration. The engine and the pending-sample buffers do not — they get rebuilt.

`reseek(targetSec)`:
1. Set `pos = targetSec` immediately (so the scrub bar doesn't snap back).
2. Show a "Seeking…" status overlay.
3. Call `engineRef.current?.dispose()`.
4. Reset `pendingVideoRef`, `pendingAudioRef`, `startedRef = false`.
5. Call `api.play(source, id, targetSec)` for the new URL.
6. Boot a fresh engine with the new URL.
7. On the new engine's `onReady`: if we were playing before the seek, automatically re-tap-play (audio context is already user-resumed from the original gesture).

Reseek is debounced by AbortController-style cancellation — if user drags-and-releases twice quickly, the second `reseek` aborts the first mid-boot.

### Scrub bar UX

The `<input type="range">` in `PlayerControls` already exists. We change three things:

1. **Drag preview**: on `input` events (fires during drag), update a local `previewPos` state and show an `<img>` floating above the scrub thumb whose `src` is `template.replace('{ms}', Math.floor(previewPos * 100) * 100)`. Rounding to 10 s aligns with Plex's BIF buckets.
2. **Drag-release commits**: on `change` event (fires on release), call `reseek(previewPos)` and clear the preview state.
3. **Touch on Tesla**: HTML `<input type="range">` handles touch natively. No special touch listeners needed.

### Tap-to-pause

Add `onClick={togglePause}` to the canvas's container `<div>`. The `PlayerControls` overlay (the bottom strip + back button) gets `onClick={(e) => e.stopPropagation()}` on its outer wrappers so taps on slider/buttons don't bubble through.

The first tap also reveals the auto-hidden controls. Same handler does both: toggle pause AND show controls (the existing `pointerdown` listener that resets the 3-s timer already covers the "show" part).

### Volume + mute

**`AudioSink` changes:**

```typescript
class AudioSink {
  public readonly ctx: AudioContext;
  public worklet: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private currentVolume: number = 1.0;
  // ...
  async start(): Promise<void> {
    // existing setup
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.currentVolume;
    this.worklet!.connect(this.gain);
    this.gain.connect(this.ctx.destination);
  }
  setVolume(v: number): void {
    const clamped = Math.max(0, Math.min(1, v));
    this.currentVolume = clamped;
    if (this.gain) this.gain.gain.value = clamped;
  }
}
```

**`Player.tsx` adds:**
- `const [volume, setVolume] = useState(() => Number(localStorage.getItem('passenger.v2.volume') ?? '1'))`
- A `useEffect([volume])` that calls `audioRef.current?.setVolume(volume)` and persists to localStorage.
- A `muted` boolean alongside; mute toggle stores the pre-mute volume separately so unmute restores.

**`PlayerControls` adds** a volume slider (small vertical range input popping up next to a 🔊/🔉/🔈/🔇 speaker glyph button). Touch-friendly: speaker tap = toggle mute; long-press / second-tap reveals slider.

For v1 simplicity: speaker icon tap toggles mute, and we render the slider inline next to it always-visible (no popup). Trade-off: less elegant, fewer interactions. Easier to ship and reason about.

### Browser fullscreen

`PlayerControls` adds a fullscreen-toggle button. Calls `document.documentElement.requestFullscreen()` or `document.exitFullscreen()`. Listens to `fullscreenchange` events to keep the button icon in sync. Catches the rejected promise on browsers that block it.

### MP3 codec support

`mkv-source.ts` `finalizeReady()`:

```typescript
// Existing check for video:
if (t.codecId !== CODEC_H264) { /* error */ }

// New audio handling:
let codecString: string;
let needsDescription: boolean;
if (t.codecId === CODEC_AAC) {
  codecString = aacCodecString(t.codecPrivate ?? new Uint8Array());
  needsDescription = true;
} else if (t.codecId === CODEC_MP3) {  // 'A_MPEG/L3'
  codecString = 'mp3';
  needsDescription = false;  // MP3 frames are self-describing
} else {
  this.opts.onError(new Error(`MKV: unsupported audio codec ${t.codecId}`));
  return;
}
audioConfig = {
  codec: codecString,
  sampleRate: t.samplingFrequency || 48000,
  numberOfChannels: t.channels || 2,
  ...(needsDescription ? { description: t.codecPrivate! } : {}),
};
```

New constant `const CODEC_MP3 = 'A_MPEG/L3';` at the top of the file.

## Component & file layout

```
worker/src/
  sources/
    types.ts             ← extend PlayResolution + Adapter signature
    plex.ts              ← resolveStream takes fromSec; populates thumbnailUrlTemplate
  routes/
    play.ts              ← parse ?fromSec= query param

web/src/
  api.ts                 ← api.play(srcKey, id, fromSec?)
  types.ts               ← PlayResolution.thumbnailUrlTemplate
  player/
    engine.ts            ← NEW: bootEngine + EngineHandle (extracted from Player.tsx)
    audio.ts             ← add GainNode + setVolume/setMuted
    mkv-source.ts        ← MP3 codec support
  views/
    Player.tsx           ← reseek, tap-toggle, volume state, fullscreen
  components/
    PlayerControls.tsx   ← volume slider + speaker glyph + fullscreen button + drag preview img + skip wiring
```

## Data flow at seek time

```
[user drags scrub bar]
        │
        ▼
[Player.tsx]: previewPos = targetSec
              show thumbnail <img src=template.replace("{ms}", round(previewPos*1000, 10s))>
        │
[user releases]
        │
        ▼
[Player.tsx]: reseek(targetSec)
        │
        ├─► engineRef.current.dispose()
        │       - fetcher.abort()
        │       - video.close() ; audio.stop()
        │       - clear pending buffers
        │
        ├─► api.play(source, id, targetSec)
        │       - Tesla → Worker GET /api/play/:src/:id?fromSec=targetSec
        │       - Worker → adapter.resolveStream(ctx, id, targetSec)
        │       - adapter → Plex /video/:/transcode/universal/start.mp4?&offset=targetSec...
        │       - returns new URL + same durationSec + same thumbnailUrlTemplate
        │
        ├─► engineRef.current = bootEngine({url, canvas, callbacks})
        │
        └─► onReady (from new engine): if (wasPlaying) togglePause()
```

The "Seeking…" status overlay clears when onReady fires from the new engine.

## Error handling

- **Reseek fails before onReady** (e.g., Plex unreachable mid-reseek): show error in corner, allow user to scrub again. Engine left disposed; tapping Play attempts a fresh boot from current pos.
- **Unsupported codec from new transcode session**: shouldn't change between reseeks (same item, same codec params), but if it does the existing MKV unsupported-codec path surfaces a clear error.
- **Volume slider interaction during reseek**: AudioSink may not exist briefly. Player view buffers `currentVolume` in its own state; sets on AudioSink when AudioSink (re)constructs in `onReady`.
- **Fullscreen request rejected**: caught promise; button stays in "exit FS" state if the document is still considered fullscreen, or reverts.

## Testing approach

Same as v2 baseline: manual smoke per task. No automated tests added for player polish. Specific verifications:

- Pause/play via tap on canvas.
- Drag scrub bar; preview appears at correct frame; release commits a reseek.
- Skip +10 / -10 from beginning, middle, near end (edge: skip past duration → reseek to duration-1).
- Volume slider responsive, persists across reload.
- Mute toggle, then drag slider while muted → drag should unmute and set new volume.
- Fullscreen on desktop preview.
- MP3 audio file plays without "unsupported codec" error.

## Out of scope (reaffirmed)

- Captions / subtitles (next plan)
- Audio track switching
- Skip-intro markers
- Auto-next episode
- Buffer-level indicator on scrub bar
- Quality / bitrate selection

## Decomposition for implementation planning

Single coherent plan. ~7–10 tasks total:

1. Type extensions (worker types.ts, web types.ts, api.ts)
2. Plex adapter fromSec + thumbnailUrlTemplate
3. Worker play route fromSec param
4. MKV MP3 support
5. AudioSink volume / mute
6. Player.tsx engine.ts extraction
7. Player.tsx reseek + skip wiring
8. PlayerControls drag preview + volume + fullscreen
9. Tap-to-pause + click propagation
10. Deploy + smoke

Each task independent enough for a separate review gate; whole thing should ship in 1–2 working days.

## Success criteria

This is "done" when on the deployed `passenger-v2.pages.dev`, against the user's BLACKHAWKVI Plex server, with Backrooms playing:

1. Dragging the scrub bar mid-playback shows a thumbnail at the dragged position.
2. Releasing the scrub bar reseeks; playback resumes at the target within ~3 s.
3. Skip +10/-10 buttons jump 10 s.
4. Single tap on the video area toggles pause; tap on controls doesn't.
5. Volume slider attenuates audio in real time; persists across reload.
6. Mute icon tap silences immediately; unmute restores prior level.
7. Fullscreen button on desktop preview enters/exits fullscreen.
8. A test MKV with MP3 audio (Plex falls back to it sometimes) plays without error.

## Player polish v1 result (recorded 2026-06-27)

- Worker version: `4107a171-9955-4919-9fcb-5ceee4f10237`
- Pages deploy: `https://passenger-v2.pages.dev/` (latest bundle `index-yb7u7Ndj.js`)
- 10 plan tasks shipped + 3 fix waves:
  - Fix wave 1 (P7): `sessionBase` added to `onClose` + sendBeacon so post-seek progress is reported with absolute file position.
  - Fix wave 2 (P10): `PlayerControls` hides the thumbnail preview after the first 404. Plex BIF previews require `Settings → Manage → Libraries → Edit → Advanced → Generate video preview thumbnails` to be enabled and analysed; until then the empty preview box is suppressed.
  - Fix wave 3 (P10): tap-to-pause only fires when controls were already visible; first tap from auto-hidden state only reveals controls.
- Desktop checklist: tap-toggle, scrub-release reseek, skip ±10s, volume slider, mute, volume persistence, fullscreen all pass.
- MP3 codec smoke: pending an item known to carry MP3 audio; the demuxer no longer throws `unsupported audio codec A_MPEG/L3`.
- Thumbnail preview: deferred; no BIFs generated on the user's Plex library yet. Code path is correct but inert until BIFs exist server-side.
- Tesla shift-out-of-Park re-validation: pending live road test.
