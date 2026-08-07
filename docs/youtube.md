# YouTube source

Canvas can play **public YouTube** videos ad-free through its canvas/WebCodecs
player — the same pipeline it uses for Plex and Flixify, so it works in the
in-car browser where the YouTube app/site won't. Unlike a paired media server,
YouTube is an **add-on** source: public, no sign-in, no pairing.

## How it works

YouTube doesn't hand out a ready-to-play file the way Plex (server transcode) or
Flixify (direct link) do — its streams are ciphered, throttled, and split into
separate video/audio DASH tracks. So canvas resolves playback server-side:

1. **Metadata** (search, followed channels/playlists, video details) comes from
   `yt-dlp -J` — no API key, no account.
2. **Playback**: `resolveStream` returns a short-lived HMAC-signed canvas URL.
   The stream route fetches the best **H.264** video + **AAC** audio DASH tracks
   and pipes them through `ffmpeg`, which **remuxes** (stream-copies) them into a
   fragmented MP4 the player fetches. Full-resolution **seek** works by reading
   the DASH `sidx` (time→byte map) and range-fetching straight to the seek point,
   and the proxy pulls googlevideo in bounded chunks to defeat its throttle.
3. **Resilience**: if googlevideo rejects a URL mid-stream (a 403 from
   rate-limiting/expiry), the proxy re-resolves fresh URLs and continues; if the
   client connection drops, the player re-opens at the current time.

Ad-free is a property of this approach, not of YouTube Premium: canvas streams
the raw content off the CDN and never runs YouTube's ad-serving player.

## Adding it

**Settings → Sources → Add a source → Add-ons → YouTube.** There's no sign-in or
QR — it's added instantly, and it groups under "Add-ons" (no reachability check,
since there's no server to reach). As with any source, admins can share it
per-user in **Settings → Users**.

## The YouTube page

Opening the YouTube source lands on a dedicated page (not the aggregated Home):

- **Search** — a centered, live search (debounced; no Enter needed) with
  infinite scroll.
- **Continue watching** — resume rail of videos you've partly watched.
- **Liked** — videos you've hearted.
- **Followed channels & playlists** — one rail each, newest videos first, with
  a "View all" into the full channel/playlist.

## Features

- **Search** — live, paged/infinite-scroll results.
- **Subscriptions** — follow a channel or playlist (Subscribe on a channel page
  or from the in-player details panel); each becomes a rail on the YouTube page.
- **Likes** — tap the ♥ on any video to keep it in the Liked rail.
- **Watch history + resume** — playback position is saved as you watch; the
  Continue-watching rail (and clicking any partly-watched video) resumes where
  you left off, starting over only if you were within ~15s of the end.
- **Autoplay next** — at end of a video an "Up next" countdown advances to the
  next item in whatever list you launched from (search, a channel, a rail);
  Next/Prev controls appear too. A video opened outside a list doesn't
  auto-advance.
- **Ad-free playback, H.264 up to 1080p**, with full-resolution seek.
- **Captions** — human + a capped set of auto-captions, with the player's timing
  offset control.

Follows, likes, and history are **per-user** and stored server-side (they sync
across a user's devices), like the rest of canvas.

## Limits

- **Public content only** — no account-backed features (your real YouTube
  subscriptions feed, watch-later, members-only / age-restricted / private
  videos); these need account auth. Canvas's subscriptions/likes/history are its
  own, local to canvas.
- **No live streams / premieres** — live videos show a LIVE badge but aren't
  supported for playback.
- **1080p H.264 ceiling** — 4K/VP9/AV1 aren't Tesla-decodable and aren't chased.
- **First-play latency** of a second or two while `yt-dlp` + `ffmpeg` spin up.
- **Occasional resolve failures** if the bundled `yt-dlp` falls behind a YouTube
  change — the player shows a retryable error (and auto-retries fresh URLs on
  transient 403s); Plex/Flixify are unaffected.

## Configuration

| Var | Default | Description |
|---|---|---|
| `YTDLP_PATH` | `yt-dlp` | Path to the yt-dlp binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `YT_JS_RUNTIME` | `node` (in the Docker image) | JS runtime yt-dlp uses to solve YouTube's signature/`n`-param — required to avoid CDN throttling. The image ships Node and sets this; for a local dev setup set it to `node` (or `deno`). |
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
