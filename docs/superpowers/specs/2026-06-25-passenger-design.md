# Passenger — Design Spec

**Date:** 2026-06-25
**Status:** Approved, pending implementation plan
**Codename:** `passenger`

## Purpose

The Tesla in-vehicle browser blocks `HTMLVideoElement` playback whenever the car is not in Park. This project is an experiment to determine whether video can be rendered through a *non-`<video>`* pipeline — specifically WebCodecs + `<canvas>` + WebAudio — and whether that pipeline is subject to the same restriction. If it isn't, we get a working passenger-entertainment surface for content the user is already authorized to view.

This is a personal, experimental project, not a product. Single user, single car, single content source for v1.

## Non-goals

- Not a public service. Single user, single bearer token.
- Not a general-purpose web browser bypass. Not a transparent reverse proxy of any third-party site.
- Not for DRM-protected content (Widevine/FairPlay/PlayReady). WebCodecs cannot decrypt those.
- Not intended for use by the driver while the vehicle is in motion. Passenger entertainment only.

## Content source

A user-owned media site that serves clear, progressive H.264/AAC MP4 over HTTPS. Discovery confirmed (2026-06-25):

- Container: progressive MP4, fast-start (`moov` immediately after `ftyp`)
- Video codec: H.264 / AVC (`avc1`)
- Audio codec: assumed AAC (`mp4a.40.2`) — to be verified during implementation
- CORS: `Access-Control-Allow-Origin: *`, `Access-Control-Expose-Headers: Content-Range`, `Access-Control-Allow-Headers: Range`
- HTTP Range / 206 Partial Content fully supported
- URLs are signed and time-limited (lifetime appears to be on the order of hours)

These properties make the canvas/WebCodecs pipeline tractable without any server-side proxying of the media bytes themselves.

## Target environment

- Tesla MCU3 (Ryzen). Chromium with WebCodecs `VideoDecoder` and `AudioDecoder` available.
- Secure context required (HTTPS) — satisfied by Cloudflare Pages.
- Touch-first UI; no keyboard shortcuts assumed.

## Architecture

Three components in one repository at `C:\github\passenger`.

```
[Phone / laptop on source site]
   ↓ bookmarklet click
[Cloudflare Worker: /api/queue]  ←→  [KV: queued items]
                                       ↑
                                       │ HTTP poll every 3 s
[Tesla browser → Cloudflare Pages page]
   ↓ user picks an item, hits Play
[Player pipeline]
   fetch MP4 via Range
     → mp4box.js demux
       → VideoDecoder → <canvas>
       → AudioDecoder → AudioWorklet
```

### 1. Bookmarklet (`bookmarklet/`)

A `javascript:` URL the user saves to their bookmarks bar. On a source-site movie page:

1. Read `document.querySelector('video').currentSrc`.
2. If missing, alert the user to start playback first.
3. Pull a title from `document.title` (or a heading element).
4. `POST` `{url, title, addedAt}` to the Worker with `X-Passenger-Token` header.
5. Show a brief toast confirming success or failure.

Distributed as:
- `bookmarklet/src.js` — readable source.
- `bookmarklet/build.mjs` — minifies and emits a single `javascript:` URL.
- `bookmarklet/install.html` — page the user opens once to drag the link to their bookmarks bar; also shows where to paste the bearer token.

### 2. Worker (`worker/`)

A Cloudflare Worker exposing a minimal queue API.

**Routes:**

| Method | Path               | Behavior                                                          |
| ------ | ------------------ | ----------------------------------------------------------------- |
| `POST` | `/api/queue`       | Auth required. Body `{url, title}`. Stores item in KV.            |
| `GET`  | `/api/queue`       | Auth required. Returns most recent items, newest first.           |
| `DELETE` | `/api/queue/:id` | Auth required. Removes one item.                                  |
| `GET`  | `/health`          | Public, returns `ok` for uptime checks.                           |

**Auth:** static bearer token compared with `X-Passenger-Token` header. Stored as a Worker secret (`PASSENGER_TOKEN`).

**Storage:** a single Cloudflare KV namespace. Each item stored as `queue:<ulid>` → JSON `{id, url, title, addedAt}`. List view paginates by reverse-chronological ULID scan. TTL ~6 hours (matches expected signed-URL lifetime); items older than that are best-effort expired by KV.

**Limits:** soft cap of 50 items; on `POST`, if the list exceeds 50, trim oldest. CORS configured to allow the Pages origin and `https://thecalm.site` (for the bookmarklet).

### 3. Web app (`web/`)

Vite + TypeScript static site deployed to Cloudflare Pages. No framework — plain DOM. Two screens.

**Settings (`/settings`)**
- Stores the bearer token in `localStorage`.
- Stores the Worker base URL in `localStorage` (default to the deployed Worker hostname, configurable for local dev).

**Queue list (`/`)**
- On load, GETs `/api/queue` and renders each item as a tappable row showing title and age.
- Polls every 3 seconds while visible (`visibilitychange`-aware).
- Tap → navigate to `/player?id=<id>`.

**Player (`/player`)**
- Full-bleed `<canvas>` for video.
- Custom controls overlay: play/pause, scrub bar with current/total time, volume.
- All playback runs through the WebCodecs pipeline. No `<video>` element is ever created.

## Player pipeline detail

**Module layout under `web/src/player/`:**

- `range-fetcher.ts` — manages chunked Range requests against the MP4 URL, with cancellation on seek. Issues ~4 MB chunks sequentially while the buffer is below a target depth (~30 s of decoded video).
- `demux.ts` — wraps `mp4box.js`. On `appendBuffer`, listens for `onReady` (tracks + `moov`) and `onSamples` (decoded sample chunks). Surfaces `VideoDecoderConfig` and `AudioDecoderConfig` derived from `moov` metadata.
- `video.ts` — owns a `VideoDecoder`. Receives `EncodedVideoChunk`s from demux, emits `VideoFrame`s into a small ringbuffer (≤8 frames). A `requestAnimationFrame` loop draws the frame whose PTS most closely matches the master clock.
- `audio.ts` — owns an `AudioDecoder`. Pipes decoded `AudioData` into an `AudioWorklet` that copies PCM into the audio graph. AudioContext drives the master clock.
- `clock.ts` — exposes `currentTime`. Uses `audioCtx.currentTime + audioOffset` when audio is initialized; otherwise a `performance.now()` clock.
- `index.ts` — glues the above, owns the playback state machine (`idle | loading | playing | paused | seeking | error`).

**Sync model:** audio is the master. Decoded video frames sit in the ringbuffer and are committed to the canvas when their PTS ≤ `clock.currentTime + halfFrameInterval`. Frames whose PTS is more than one frame behind the clock are dropped (catch-up). The pipeline never blocks on a decoder being slow — if either decoder stalls, playback halts at the current frame and the state machine surfaces a warning.

**Seek:**
1. Set state to `seeking`, pause the visual clock.
2. Abort in-flight range fetch.
3. Ask mp4box.js for the byte offset of the nearest keyframe ≤ target time.
4. Flush both decoders.
5. Resume range-fetching from that offset.
6. Once both decoders emit a frame near target time, set state to `playing` (or `paused` if seek was from paused).

**Backpressure:** range fetcher pauses when the audio buffer ≥ 30 s of decoded data or when 60+ undecoded video samples are queued.

**Memory:** target ceiling ~150 MB resident. `VideoFrame.close()` and `AudioData.close()` called eagerly once consumed.

## Auth model

- A single bearer token generated once by the user, set as a Wrangler secret on the Worker, pasted into the bookmarklet build, and saved to `localStorage` via the Settings page in `web/`.
- No login flow, no per-user separation, no refresh tokens.
- Token rotation = re-deploy Worker secret + regenerate bookmarklet + re-paste in Settings.

## Hosting & deployment

- **Worker:** deployed via `wrangler deploy` from `worker/`. Custom domain not required for v1.
- **Pages:** deployed via `wrangler pages deploy ./dist` from `web/` (or auto-deploy hooked to a GitHub repo). Both free tier.
- **Local dev:** `wrangler dev` for the Worker, `vite dev` for the web app, with the web app's Worker base URL pointed at `localhost:8787`. Local dev is HTTP/`localhost`, which is a valid secure context for WebCodecs.

## Out of scope for v1

- Subtitles. Stub the data path; do not render.
- Quality / bitrate selection (source serves one file).
- Multi-user, OAuth, account linking.
- Chromecast, AirPlay, PiP.
- Transparent reverse proxy of the source site.
- DRM support.
- MJPEG or other fallback (MCU3 has WebCodecs).
- Offline / download.
- Analytics, telemetry, error reporting beyond a local error overlay.

## Risks and sharp edges

1. **AAC support varies.** Chromium added AAC to `AudioDecoder` over time. Feature-detect (`AudioDecoder.isConfigSupported`) and surface a clear error if missing.
2. **AudioWorklet + autoplay policy.** Tesla browser may require a user gesture to construct or resume the `AudioContext`. Playback only starts on tap; this should satisfy the policy.
3. **`moov` parse hitch.** The discovered file has a ~2.1 MB `moov`. Expect a ~500 ms startup pause while mp4box parses. Acceptable.
4. **Signed-URL expiry.** If a URL expires mid-stream, range fetcher will see a 4xx; surface a "URL expired, re-bookmark" error. No auto-refresh in v1.
5. **Cellular bandwidth.** Full-bitrate 1440×720 H.264 may not stream smoothly on weak LTE. Stationary testing first.
6. **The Tesla bypass might not work.** The whole premise is unverified. The fallback if WebCodecs *is* gated the same way as `<video>` is to revisit MJPEG-in-`<img>` (deferred — not in v1).
7. **Site HTML changes.** Bookmarklet relies on `<video>.currentSrc` being populated after the user clicks Play. If the site changes its player, bookmarklet may need adjustment.

## Repository layout

```
C:\github\passenger\
  ├── web/
  │   ├── index.html
  │   ├── player.html
  │   ├── settings.html
  │   ├── src/
  │   │   ├── queue.ts
  │   │   ├── settings.ts
  │   │   └── player/
  │   │       ├── index.ts
  │   │       ├── demux.ts
  │   │       ├── video.ts
  │   │       ├── audio.ts
  │   │       ├── clock.ts
  │   │       └── range-fetcher.ts
  │   ├── public/
  │   ├── vite.config.ts
  │   ├── tsconfig.json
  │   └── package.json
  ├── worker/
  │   ├── src/
  │   │   └── index.ts
  │   ├── wrangler.toml
  │   ├── tsconfig.json
  │   └── package.json
  ├── bookmarklet/
  │   ├── src.js
  │   ├── build.mjs
  │   ├── install.html
  │   └── package.json
  ├── docs/
  │   └── superpowers/
  │       └── specs/
  │           └── 2026-06-25-passenger-design.md
  ├── .gitignore
  ├── package.json
  └── README.md
```

## Success criteria

The build is considered successful for v1 when, on the user's MCU3 Tesla:

1. The bookmarklet, run on a source-site movie page, adds an item to the queue.
2. The queue page on the Tesla browser displays that item within 3 seconds.
3. Tapping the item plays the movie via canvas + WebAudio, with synchronized audio, smooth playback, and working pause / play / seek.
4. Playback continues uninterrupted when the car is shifted out of Park (the central experimental claim).

If criterion 4 fails — i.e., Tesla also gates canvas-rendered video while not in Park — the experiment has answered its central question in the negative, and we either accept that or pivot to investigating other rendering paths (deferred work).

## Testing approach for v1

- Manual smoke testing only. No automated tests.
- Desktop dev loop: `vite dev` + `wrangler dev`. Use the bookmarklet on a real source-site page, confirm queue, confirm desktop playback (Chrome / Edge) with sync, seek, pause.
- Tesla validation: deploy, open on Tesla in Park, play, then shift to N or roll in a controlled environment. Capture result.

Automated tests are deferred. If the project graduates past v1, candidate test surfaces would be: range-fetcher chunking logic, demux config extraction (against a checked-in fixture MP4), and clock-sync drift math.
