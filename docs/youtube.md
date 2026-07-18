# YouTube source

Canvas can play **public YouTube** videos and playlists ad-free through its
canvas/WebCodecs player — the same pipeline it uses for Plex and Flixify, so it
works in the in-car browser where the YouTube app/site won't.

## How it works

YouTube doesn't hand out a ready-to-play file the way Plex (server transcode) or
Flixify (direct link) do — its streams are ciphered, throttled, and split into
separate video/audio DASH tracks in VP9/AV1/H.264. So canvas resolves playback
server-side:

1. **Metadata** (search, trending, playlists, channels) comes from `yt-dlp -J` —
   no API key, no account.
2. **Playback**: `resolveStream` returns a short-lived HMAC-signed canvas URL.
   The stream route then runs `yt-dlp` to fetch fresh direct URLs for the best
   **H.264** video + **AAC** audio and pipes them through `ffmpeg`, which
   **remuxes** them into a fragmented MP4 the player can fetch. Remux (stream
   copy) is the common case; `ffmpeg` only re-encodes when no H.264 rendition
   exists (rare AV1-only uploads).

Ad-free is a property of this approach, not of YouTube Premium: canvas streams
the raw content off the CDN and never runs YouTube's ad-serving player.

## Adding it

**Settings → Sources → Pair new source → YouTube.** There's no sign-in or QR —
it's added instantly. As with any source, admins can share it per-user in
**Settings → Users**.

## What works (v1)

- Search, Trending, playlists (as shows — videos autoplay via Up-Next), channels
- Ad-free playback, **H.264 up to 1080p**
- Captions (human + a capped set of auto-captions), with the player's timing offset
- Local resume / Continue Watching

## Limits (v1)

- **Public content only** — no subscriptions, watch-later, history, or
  members-only / age-restricted / private videos (these need account auth).
- **No live streams / premieres.**
- **1080p H.264 ceiling** — 4K/VP9/AV1 aren't Tesla-decodable and aren't chased.
- **First-play latency** of a second or two while `yt-dlp` + `ffmpeg` spin up.
- **Occasional resolve failures** if the bundled `yt-dlp` falls behind a YouTube
  change — the player shows a retryable error and Plex/Flixify are unaffected.

## Configuration

| Var | Default | Description |
|---|---|---|
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `YT_MAX_CONCURRENT_STREAMS` | `2` | Max simultaneous transcode/remux streams (protects CPU) |
| `YT_STREAM_SECRET` | (unset) | HMAC secret for signed stream URLs; unset = ephemeral per-boot secret (fine for single-instance) |

## Keeping yt-dlp current

yt-dlp needs periodic updates as YouTube changes. The Docker image pins it via
the `YTDLP_VERSION` build arg (see `Dockerfile`); bump it and rebuild, or pass
`--build-arg YTDLP_VERSION=<release>` to `docker build`. For a local (non-Docker)
dev setup, update your own `yt-dlp` install.

## Legal

YouTube's Terms of Service prohibit extracting streams outside their player.
This is a self-hosted, personal-use feature; whether to use it is the operator's
decision. Canvas documents this rather than enforcing it.
