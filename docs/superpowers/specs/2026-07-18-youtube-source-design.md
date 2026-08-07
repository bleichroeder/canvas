# Sub-project Q: YouTube source

**Date:** 2026-07-18
**Target release:** v0.11.0
**Scope:** Add YouTube as a third source type alongside Plex and Flixify, using a
server-side yt-dlp (extraction) + ffmpeg (mux) pipeline so public YouTube videos
and playlists play ad-free through the existing canvas WebCodecs player.

## Goal

Let a household browse, search, and play **public** YouTube content in the car
through canvas's own canvas/WebCodecs player — the environment where the YouTube
app/site itself doesn't work. Playback is ad-free by construction (we stream the
raw content off the CDN, not the ad-serving player) and needs no YouTube account.

The metadata half maps cleanly onto the existing `SourceAdapter` interface. The
hard half is `resolveStream`: canvas's pipeline (`web/src/player/*`) requires a
fetchable, muxed **H.264 + AAC/MP3** MP4/MKV, and YouTube serves ciphered,
throttled, **split DASH** streams in VP9/AV1/H.264. So YouTube — unlike Plex
(server-side transcode endpoint) and Flixify (direct link) — needs a server-side
extraction + mux stage.

## Non-goals (v1)

- **Signed-in / personal content.** No Google OAuth or cookie auth. No
  subscriptions feed, watch-later, history, likes. Trending stands in for a feed.
  (Cookie-auth as an opt-in Premium/gated-content phase is a documented follow-up.)
- **Gated content.** Members-only, age-restricted, private/unlisted videos —
  all require auth; out of scope.
- **Live streams / premieres.** Different (HLS) path; deferred.
- **>1080p, VP9, AV1 native.** Tesla can't hardware-decode these; we cap at
  H.264 1080p and only transcode when no H.264 rendition exists.
- **Byte-range resume mid-stream.** The stream route is a single-shot pipe;
  time-seek already works via canvas's session-reboot model. A fetch error
  triggers a full player session restart rather than a byte-offset resume.
- **YouTube Premium "Enhanced bitrate."** It's VP9/AV1 we'd transcode to H.264
  anyway, and it needs account auth. No practical gain for this pipeline.

## Global constraints

- **Additive only — must not touch Plex/Flixify behavior.** New adapter, new
  routes, new migration column value, new Docker binaries. The adapter registry
  (`registerAdapter`) and `callPerSource`'s `Promise.allSettled` fan-out already
  isolate a failing source, so a broken YouTube resolve degrades to a Home-screen
  warning badge and never sinks a Plex/Flixify request.
- No test framework additions to `web/`; verify web with `npm --prefix web run build`.
  Server has `bun test`; add tests following `server/src/routes/*.test.ts` and the
  injectable-dependency pattern (`watchtower-client.ts`, `dispatch.ts`).
- Commit messages: NO `Co-Authored-By` trailer, NO "Generated with Claude Code" footer.
- Migrations generated via `bun run db:generate`.
- yt-dlp is on a maintenance treadmill (YouTube changes break it). The bundled
  binary is version-pinned and bumpable; a resolve failure must surface a clean,
  retryable player error, never a crash.

## Data model

**No new tables.** The `sources` and `pair_sessions` `type` enums gain a third
value `'youtube'`. This is a Drizzle schema edit → generated migration; existing
rows are untouched (additive CHECK-constraint change).

A YouTube source row carries `type='youtube'`, a synthetic `label` ("YouTube"),
`baseUrl` unused (empty string), and `token` empty (no credential). It's created
by an admin "Add YouTube" action, bypassing the QR/PIN pair flow.

## Item ID encoding

YouTube has three navigable entity kinds. We pack a kind prefix into the opaque
canvas `Item.id`, mirroring Flixify's `encodeFlixifyItemId`:

- `v:<videoId>`   → a video   → canvas `type: 'movie'` (playable)
- `p:<playlistId>`→ a playlist → canvas `type: 'show'` (videos become episodes)
- `c:<channelId>` → a channel  → canvas `type: 'folder'` (browsable)

`item()` and `resolveStream()` decode the prefix to route correctly. Playlist →
show → episodes plugs straight into the existing queue / Up-Next model with no
frontend changes.

## Streaming pipeline (`resolveStream` + stream route)

1. `resolveStream(ctx, id, fromSec)` decodes `v:<videoId>`, returns a
   `PlayResolution` whose `url` is a canvas-internal **signed** URL:
   `/api/yt/stream/{videoId}?from={sec}&exp={ts}&sig={hmac}`.
   - Signed because `RangeFetcher` (`web/src/player/range-fetcher.ts`) sends no
     `Authorization` header — same reason Plex embeds its token in the URL. HMAC
     over `videoId|from|exp` with a boot-generated secret, short TTL (~6h).
   - `durationSec` + `subtitleTracks` come from a `yt-dlp -J` metadata call.
2. `GET /api/yt/stream/:videoId` (public route, validates `sig`/`exp`):
   - Runs `yt-dlp -J` (or `-g`) to get direct googlevideo URLs for the best
     **avc1** video-only + **m4a** audio-only formats
     (`bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a] / b[ext=mp4][vcodec^=avc1]`).
   - Runs `ffmpeg -ss {from} -i {videoUrl} -ss {from} -i {audioUrl}
     -c:v copy -c:a copy -movflags frag_keyframe+empty_moov+default_base_moof
     -f mp4 pipe:1`, streamed to the response as `video/mp4`.
   - **Remux, not transcode**, in the common case (both streams already
     avc1/aac) — cheap. Transcode (`-c:v libx264`) only when no avc1 rendition
     exists (rare; e.g. some AV1-only uploads).
   - `-ss` before each input = fast keyframe seek; fine because canvas reboots
     the session per seek anyway.
3. **Resource safety:** a module-level semaphore caps concurrent streams
   (default 2, `YT_MAX_CONCURRENT_STREAMS`); yt-dlp + ffmpeg children are killed
   on request abort (client disconnect / seek reboot) so nothing leaks.

## Captions

`yt-dlp -J` exposes `subtitles` + `automatic_captions`. `resolveStream` returns
them as `subtitleTracks` pointing at `/api/yt/subs/:videoId?lang=…`, a small
route that fetches the caption track and returns `text/vtt` — reusing the CORS-
proxy pattern of `routes/subtitles.ts`. Auto-captions labeled "(auto)".

## Docker

Runtime stage (`oven/bun:1.3-alpine`) gains:
- **ffmpeg** via `apk add --no-cache ffmpeg`.
- **yt-dlp** as a version-pinned standalone binary copied to `/usr/local/bin`
  (self-contained; easy to bump, reproducible — unlike the fast-moving apk pkg).

`lib/ytdlp.ts` wraps invocation behind an injectable `exec` function (à la
`watchtower-client`) so adapter/route tests never spawn a real process. At boot,
log a warning if either binary is absent (dev machines without them still run;
YouTube resolves just fail cleanly).

## Adapter method mapping

| Method | YouTube behavior |
|---|---|
| `type` | `'youtube'` |
| `startPair` | unused — YouTube is added tokenless, no pair flow |
| `home` | Trending row (`yt-dlp` on the trending feed). No server-side continue. |
| `search` | `yt-dlp "ytsearchN:query" -J --flat-playlist` → video items |
| `library` | top-level sections (Trending); browse a channel/playlist via id |
| `item` | `v:` → video detail; `p:` → playlist as show + episodes; `c:` → channel |
| `resolveStream` | signed internal stream URL (see pipeline above) |
| `saveProgress` | no-op — local NowPlaying only, like Flixify |

## Frontend

Adapter-driven, so Home/Search/ItemDetail/Player/queue/captions work unchanged.
Only additions:
- `web/src/lib/source-style.ts` — YouTube red (`#ff0000`) + `YT` glyph.
- `web/src/views/Pair.tsx` (or SourcesTab) — an "Add YouTube" entry that calls a
  new admin `POST /api/sources` (tokenless public source) instead of the QR flow.

## Legal note

YouTube's ToS prohibits extracting streams outside their player. This is a
self-hosted, personal-use feature; the choice rests with the operator. Documented
in `docs/`, not enforced.
