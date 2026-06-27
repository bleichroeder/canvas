# Passenger v2 — Design Spec

**Date:** 2026-06-27
**Status:** Approved, pending implementation plan
**Codename:** `passenger` (unchanged from v1)
**Supersedes:** `docs/superpowers/specs/2026-06-25-passenger-design.md` (v1, experimental POC)

## Purpose

v1 confirmed the canvas + WebCodecs + WebAudio pipeline plays video in the Tesla browser regardless of gear state. The experiment is complete. v2 is the product: a polished Tesla-passenger streaming front-end that federates over multiple user-owned video sources (Plex, Jellyfin, Flixify) through a pluggable adapter architecture.

v2 deliberately removes the only legally-fraught aspect of v1 (tight coupling to one specific third-party site) by making the source layer pluggable and BYOC (bring your own catalog). The canvas/WebCodecs Tesla bypass — the actual technical IP — is preserved exactly as built.

## Non-goals

- Not a multi-device app. Tesla-only (1440×720 landscape, touch-first). Phone/desktop can technically load the same URL but we don't optimize for them.
- Not a service users sign up for. No accounts, no profiles, no central user database. Each device pairs with the user's own sources.
- Not a content host. We never store media, transcode media, or know what media a user is watching beyond what's needed to render the UI.
- Not a marketplace for third-party adapters in v2.0. Ships with exactly four adapters: Plex, Jellyfin, Flixify, Generic URL.
- Not responsive. Tesla viewport only.

## Audience

A user who already has at least one of: a Plex Media Server, a Jellyfin server, a Flixify (thecalm.site) account, or direct HTTP URLs of MP4/HLS content they have a right to watch. They drive a Tesla with the MCU3 (Ryzen) browser and want to watch their stuff in the car while the car is in motion (as a passenger or while parked).

## Target environment

- Tesla MCU3 / Ryzen Chromium. WebCodecs (`VideoDecoder`, `AudioDecoder`) and `AudioWorklet` confirmed available in v1 testing.
- Secure context (HTTPS) — provided by Cloudflare Pages.
- Touch-only input; no hover; no copy/paste (PIN pair instead).
- Frequently on cellular — minimize round trips per screen.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Tesla browser (Cloudflare Pages)            │
│  • Preact + Vite SPA                         │
│  • Hand-rolled hash router                   │
│  • Canvas/WebCodecs player (lifted from v1) │
│  • Per-device localStorage (paired sources) │
└────────────────────┬────────────────────────┘
                     │ HTTPS · one round-trip per screen
                     │ X-Sources header carries per-source tokens
                     ▼
┌─────────────────────────────────────────────┐
│ Cloudflare Worker (federator)               │
│  • Source-adapter dispatcher                 │
│  • Federated endpoints (home, search, etc.) │
│  • KV cache (per-user, per-endpoint)         │
│  • PIN pair sessions (ephemeral KV)          │
└────┬─────────────┬─────────────┬────────────┘
     │             │             │
     ▼             ▼             ▼
   Plex        Jellyfin        Flixify
   (REST)      (REST)          (Kodi-plugin endpoints)
```

MP4 / HLS bytes stream **directly** from the source's CDN to the Tesla. Worker handles metadata only. This keeps Worker CPU usage low and bandwidth off the path that matters for playback.

### Decisions made during brainstorming

- **Single SPA, Tesla-only.** No multi-device responsiveness in v2.0.
- **Server-side aggregator.** All adapters live in the Worker. Tesla makes one request per screen.
- **Cloudflare stays.** Workers + KV + Pages. No D1, no Durable Objects, no Postgres — keeps the backend portable to Node-on-Fly.io should we ever migrate.
- **No `passenger`-side bearer token.** Auth is delegated: Tesla sends source tokens, Worker uses them against sources, Worker has no user database.
- **Preact (not React, Solid, or vanilla).** ~3 KB runtime, React-flavored API, TypeScript-first.
- **Hand-rolled router** (~200 LoC). The route table is small enough that pulling in `preact-router` would add more weight than it saves.
- **Player engine unchanged.** v1's `src/player/*` modules port over as the playback engine. Range fetcher + mp4box demux + WebCodecs decoders + AudioWorklet sync clock all stay.

## Component layout

```
C:\github\passenger\
  ├── web/                          # Cloudflare Pages target
  │   ├── index.html                 # single SPA entry
  │   ├── src/
  │   │   ├── main.tsx               # Preact mount + router
  │   │   ├── router.ts              # hand-rolled hash router
  │   │   ├── api.ts                 # typed client for the federator
  │   │   ├── storage.ts             # localStorage wrappers (paired sources, prefs)
  │   │   ├── views/
  │   │   │   ├── Home.tsx
  │   │   │   ├── Library.tsx
  │   │   │   ├── ItemDetail.tsx
  │   │   │   ├── Search.tsx
  │   │   │   ├── Player.tsx         # wraps the player engine
  │   │   │   ├── Settings.tsx
  │   │   │   └── Pair.tsx
  │   │   ├── components/
  │   │   │   ├── Rail.tsx           # horizontal scrolling list
  │   │   │   ├── PosterCard.tsx
  │   │   │   ├── Hero.tsx
  │   │   │   ├── Chip.tsx
  │   │   │   └── PlayerControls.tsx
  │   │   ├── player/                # PORTED FROM v1 UNCHANGED
  │   │   │   ├── range-fetcher.ts
  │   │   │   ├── demux.ts
  │   │   │   ├── video.ts
  │   │   │   ├── audio.ts
  │   │   │   ├── audio-worklet.js
  │   │   │   └── clock.ts
  │   │   ├── subtitles/             # NEW in v2
  │   │   │   ├── vtt-parser.ts
  │   │   │   └── overlay.ts
  │   │   ├── styles.css
  │   │   └── vite-env.d.ts
  │   ├── public/
  │   ├── vite.config.ts
  │   ├── tsconfig.json
  │   └── package.json
  │
  ├── worker/                       # Cloudflare Worker (federator)
  │   ├── src/
  │   │   ├── index.ts               # router + entry
  │   │   ├── routes/
  │   │   │   ├── pair.ts
  │   │   │   ├── home.ts
  │   │   │   ├── search.ts
  │   │   │   ├── library.ts
  │   │   │   ├── item.ts
  │   │   │   ├── play.ts
  │   │   │   └── progress.ts
  │   │   ├── sources/
  │   │   │   ├── types.ts           # SourceAdapter interface, shared types
  │   │   │   ├── registry.ts        # type → adapter dispatch
  │   │   │   ├── plex.ts
  │   │   │   ├── jellyfin.ts
  │   │   │   ├── flixify.ts
  │   │   │   └── generic.ts
  │   │   ├── cache.ts               # KV-backed memoization
  │   │   ├── cors.ts                # unchanged contract: returns CORS-headered errors
  │   │   └── log.ts                 # console.* wrappers; eventually a Tail Worker target
  │   ├── wrangler.toml
  │   ├── tsconfig.json
  │   └── package.json
  │
  ├── docs/superpowers/
  │   ├── specs/
  │   │   ├── 2026-06-25-passenger-design.md          (v1, superseded)
  │   │   └── 2026-06-27-passenger-v2-design.md       (this file)
  │   └── plans/
  │       └── 2026-06-27-passenger-v2-implementation.md  (TBD by writing-plans)
  │
  └── (root unchanged)
```

`bookmarklet/` is preserved on `main` for v1 use but is not part of v2. v2 will not deploy it.

## Federated API contract

All endpoints accept `X-Sources` (JSON: `{[sourceKey]: {type, baseUrl, token}}`) except pair endpoints, which are unauthenticated.

### Pair
```
POST /api/pair/start  body: { sourceType }
  → 200 { code: "K7P-Q3M", expiresAt: number }

POST /api/pair/poll   body: { code }
  → 200 { status: 'pending' }
    | 200 { status: 'approved', source: { type, baseUrl, token, label } }
    | 410 { status: 'expired' }

POST /api/pair/approve  body: { code, type, baseUrl, token, label }
  → 204
  (called from phone after user signs in to the source; type-specific phone flow renders at /pair on the Pages site)

DELETE /api/pair/:code
  → 204  (Tesla calls this after successful pair to clean up KV)
```

### Catalog
```
GET /api/home
  → { rows: [{ kind: 'continue'|'recent'|'libraries', title, source?, items[] }] }

GET /api/search?q=
  → { hits: [{ source, type, id, title, year?, poster? }] }

GET /api/library/:src/:libId?path=
  → { breadcrumbs: [{name, libId, path}], items: Item[] }

GET /api/item/:src/:id
  → ItemDetail {
      id, title, year?, runtimeMin?, rating?, poster?, backdrop?, synopsis?,
      durationSec?, viewOffsetSec?,
      episodes?: Episode[],  // TV only
      intro?: { startSec, endSec }, credits?: { startSec, endSec }
    }
```

### Play / progress
```
POST /api/play/:src/:id
  → 200 {
      url: string,                  // direct CDN URL the canvas player streams from
      headers?: Record<string,string>,  // any required headers (Referer override, auth)
      durationSec: number,
      audioTracks?: AudioTrack[],
      subtitleTracks?: SubtitleTrack[]
    }

POST /api/progress/:src/:id  body: { posSec: number, completed?: boolean }
  → 204
```

### Errors

All non-2xx responses include CORS headers and a JSON body:
```
{ "error": <code>, "message": <human-readable>, "source"?: <which-adapter> }
```

## SourceAdapter contract

```typescript
export interface SourceAdapter {
  readonly type: 'plex' | 'jellyfin' | 'flixify' | 'generic';

  /** Returns the URL the phone visits to complete pairing. */
  startPair(code: string): Promise<{ pairUrl: string; expiresAt: number }>;

  /** Source-specific home rows (continue + recent). */
  home(ctx: SourceContext): Promise<HomeRow[]>;

  /** Source search. */
  search(ctx: SourceContext, query: string): Promise<Item[]>;

  /** Browse one library / folder. */
  library(ctx: SourceContext, libraryId?: string, path?: string): Promise<BrowseResult>;

  /** Full metadata for an item, including TV episode list. */
  item(ctx: SourceContext, id: string): Promise<ItemDetail>;

  /** Resolve a playable URL + the headers the canvas player must send. */
  resolveStream(ctx: SourceContext, id: string): Promise<PlayResolution>;

  /** Write playback progress back to the source. */
  saveProgress(ctx: SourceContext, id: string, posSec: number, completed: boolean): Promise<void>;
}

export interface SourceContext {
  baseUrl: string;
  token: string;
}
```

The four adapters in v2.0:

- **`plex`** — Plex Media Server REST. Pair via plex.tv "TV PIN" OAuth flow (Plex's documented headless-device API). Catalog via `<server>/library/sections/*`.
- **`jellyfin`** — Jellyfin REST. Pair by entering server URL + username/password on phone (no native OAuth). Catalog via `/Users/{userId}/Items`.
- **`flixify`** — endpoints lifted from the `flixify.com-2.1.17.zip` Kodi plugin source. Pair flow mirrors the Kodi PIN page already implemented on thecalm.site.
- **`generic`** — direct URL adapter. "Source" config is just `{ url, headers?: {} }`; one item per source. Use cases: raw MP4 URL, single HLS stream, IPTV item.

Adapters that don't naturally provide a feature (e.g., `generic.search` is nonsensical) return empty results — no `throw`, no missing-method.

## Caching policy

KV cache wraps every adapter call. Keys are `cache:<src>:<token-hash>:<endpoint>:<params-hash>` (token hash = first 8 chars of SHA-256). TTLs:

- `home` — 60 s (catches "recently added")
- `library` — 5 min (catalogs rarely change)
- `item` — 1 hr (per-item metadata)
- `search` — not cached (user-driven, expects fresh)
- `resolveStream` — not cached (URLs are often time-signed; always re-resolve)

A `?nocache=1` query param bypasses cache. Useful for "pull to refresh" and dev.

## UI structure

### Home (`/`)

Top chrome: `passenger` wordmark · 🔍 search · ⚙ settings (44 px row).

Body: vertical stack of horizontal rails.
- Continue Watching (federated across all sources; empty if none)
- Recently Added · {source} (one rail per paired source)
- Your Libraries (chip grid: `Movies · Plex`, `Shows · Plex`, `Movies · Flixify`, …)

Posters: 240×360 for movies, 360×200 for shows.

### Library (`/lib/:src/:libId?`)

Header: source chip + breadcrumbs (`Plex › Movies`). Body: 4-column poster grid with infinite scroll. Tap → `/item/:src/:id`.

### Item detail (`/item/:src/:id`)

Hero backdrop (full-width, fades to bg). Poster + title + meta + Play + +Watchlist. Synopsis. For TV: episode picker (horizontal rail of season chips, vertical list of episodes within selected season).

Play button auto-resumes from `viewOffsetSec` when > 60s; small "Start over" link below.

### Search (`/search`)

Top input (focused on mount). Federated results grouped by source, each group a 4-column grid.

### Player (`/play/:src/:id`)

Full-bleed `<canvas>`. Controls overlay auto-hides after 3 s of inactivity.
- Top: ✕ back, item title
- Bottom: ◀10  ▶︎/⏸  ▶10  · scrub bar · time / -remaining · audio · subs

Gestures: single-tap → toggle controls; double-tap right ⅓ → seek +10s; double-tap left ⅓ → seek −10s.

Pre-EOF (last 15 s): "Up next: S1E2 · 10s" pill bottom-right. Tap → switch immediately. Ignore → auto-jump.

Skip-intro: when `intro` markers present and `pos` inside marker, show "Skip Intro" button bottom-right.

### Settings (`/settings`)

```
Sources
  ✓ My Plex · plex.example.com   [unpair]
  ✓ thecalm.site · Flixify       [unpair]
  + Pair new source              → /settings/pair

Preferences
  Autoplay next episode    [✓]
  Default subtitle language [English ▾]
  Default audio language    [original ▾]
  Skip-intro automatically [ ]

About
  passenger v2.0.0
```

### Pair (`/settings/pair`)

1. Source-type picker (Plex, Jellyfin, Flixify, Generic URL)
2. Tesla calls `POST /api/pair/start` → receives code → shows code prominently + instructions to visit `passenger.pages.dev/pair` on phone
3. Tesla polls `POST /api/pair/poll` every 3 s
4. On `approved`: write source to localStorage, redirect to `/settings`

Phone view of `/pair`: type code → type Plex creds (or Jellyfin URL+creds, or follow Flixify activation) → `POST /api/pair/approve`.

PIN format: 6 unambiguous chars from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0/O/1/I/L`), grouped as `XXX-XXX`. ~30 bits of entropy = ~10⁹ codes, collision-free at our scale.

## Auth model

There is no `passenger`-side authentication. All authentication is to the user's sources:

1. **Pair** stores `{type, baseUrl, token, label}` per source in the Tesla's localStorage. Source token never appears in source code or in any KV other than the ephemeral pair session.
2. **Tesla requests** include `X-Sources: <JSON object keyed by sourceKey>` carrying all paired source configs.
3. **Worker** uses those configs to fan out to sources. Federated endpoints always return 200 with a per-source `errors[]` array; a failed source is `{source, status, message}` and the rest of the response is unaffected. Endpoints that target one specific source (`item`, `play`, `progress`) bubble that source's status code through.
4. **Worker** has no idea who the user is and stores no per-user state outside the per-token-hash KV cache and ephemeral pair sessions.

Rate limiting: Cloudflare's free-tier rate limiting (10 req/s per IP) is sufficient to prevent abuse of the unauthenticated `/api/pair/*` endpoints. No application-level rate limiting in v2.0.

## Player polish (additions over v1)

- **Subtitles overlay** — VTT/SRT fetched from adapter, parsed to cue list, rendered to a `<div>` positioned over the canvas. Driven from the existing audio clock. Toggle on/off via player chrome.
- **Audio track selection** — re-config `AudioDecoder` on user switch. Mid-stream switching tears down and rebuilds the audio decoder; tolerates a brief silent gap.
- **Resume playback** — read `viewOffsetSec` from `GET /api/item`; if > 60 s show "Resume from N:NN" vs "Start over." Save progress every 15 s during playback, on pause, on unload (via `navigator.sendBeacon`).
- **Auto-next episode** — at 15 s before EOF, fetch next-episode metadata via adapter (when TV); show "Up next" pill; on EOF auto-navigate.
- **Skip-intro markers** — when adapter returns `intro: {startSec, endSec}`, render "Skip Intro" button during that range.
- **Gestures** — single tap toggles controls; double tap left/right seeks ±10 s.

## Migration from v1

- v2 development on the `v2` branch.
- v2 frontend deploys to `passenger-v2.pages.dev` (separate Pages project).
- v2 worker deploys to `passenger-api-v2.<acct>.workers.dev` with a **new KV namespace** (`PASSENGER_V2`). v1's worker, KV namespace, and Pages project stay live and untouched until v2 reaches parity.
- "Parity" defined as: a normal use session (browse + play + resume) works end-to-end on the Tesla without any bookmarklet or token-entry step. At parity, the user cuts over their bookmark; v1 is decommissioned (Worker + Pages + KV deleted) on a follow-up PR.

The `main` branch holds v1 code through cutover so we can hotfix v1 if it breaks while v2 cooks.

## Out of scope for v2.0

- Multi-profile / family sharing
- Quality / bitrate selection (we play what the source returns)
- Filters / sort UI on library browse (folder browse only)
- Phone / desktop responsive UI
- Login screens, accounts on our side
- Any database beyond KV
- Public adapter registry / third-party adapters
- Casting (Chromecast, AirPlay, Tesla-to-Tesla)
- Downloads / offline
- Recommendation engine on our side (we surface the source's "Recently Added" only)
- Live TV / EPG
- Multi-room (we don't track other devices)
- Transcoding (we play what the source's CDN gives us; H.264 + AAC assumed)

## Risks and sharp edges

1. **Codec coverage.** WebCodecs is reliable for H.264 + AAC; HEVC / AC-3 / DTS support depends on Tesla Chromium build. v2.0 plays only what `VideoDecoder.isConfigSupported` / `AudioDecoder.isConfigSupported` return true for; everything else surfaces a clear "unsupported codec" error in the player.
2. **Plex `viewOffset` write semantics.** Plex's progress endpoint is `:/timeline` and has documented quirks around `state=playing|paused|stopped`. The plex adapter must send the right state on save, not just position.
3. **Jellyfin OAuth fragility.** Jellyfin has no PIN-pair-like flow; user must enter their server URL + credentials. Acceptable v1 cost; users with non-public Jellyfin servers will need to expose them (Tailscale Funnel, Cloudflare Tunnel) — that's their problem, but the docs should mention it.
4. **Flixify endpoint stability.** Endpoints lifted from a Python Kodi plugin can move without notice. We treat the flixify adapter as best-effort and ship it disabled-by-default unless the user explicitly pairs.
5. **KV write quotas during catalog cache fills.** Worst case: 4 sources × ~6 cache categories × 60-sec re-fills = ~240 writes/hr per active user. Well within 1k/day free tier per user, but a multi-user future has to switch caching strategy (e.g., shared per-server cache keys, not per-token cache keys).
6. **Cellular bandwidth.** A 1440×720 H.264 stream needs ~5–8 Mbps for smooth playback. On weak LTE we will stutter. v2.0 has no adaptive bitrate path; the user picks the source quality.
7. **Tesla cold start.** First render of the home screen calls every source in parallel. Slow sources block. v2.0 returns partial results: any source that doesn't respond within 5 s is omitted with `{source, error}` in the response, the UI shows "{source} timed out — pull to retry."

## Decomposition for implementation planning

This spec is too large for a single implementation plan. Decompose into **four sequential sub-plans**, each producing working, testable software:

1. **Plan A — Foundation** *(largest; gets us to "works for Plex only")*
   Worker rewrite around `SourceAdapter` interface + KV cache + CORS + pair endpoints. Frontend Vite + Preact SPA scaffold with Home / Library / ItemDetail / Search / Settings / Pair shells, hand-rolled router, typed API client, localStorage layer. Port v1 player engine into `src/player/` unchanged. Implement **Plex adapter** end-to-end. Deploy to `passenger-v2.pages.dev` + `passenger-api-v2` Worker with new KV namespace. Acceptance: pair a Plex server, browse the catalog, play a movie with the canvas pipeline.

2. **Plan B — More adapters**
   Implement `flixify`, `jellyfin`, `generic` adapters one at a time, each ending with a working pair flow and a successful play. Acceptance: a multi-source home screen with rows from Plex + Flixify + Jellyfin.

3. **Plan C — Player polish**
   Subtitles overlay, audio-track selection, resume playback (read/write `viewOffsetSec`), auto-next episode, skip-intro markers, touch gestures. Each polish item is a small leaf task; they're grouped here because they all live in the player surface. Acceptance: a normal movie-watching session feels indistinguishable from a real streaming app.

4. **Plan D — Cutover**
   Parity-test v2 against v1 for a full week of normal use; fix bugs found; cut DNS / default-bookmark from v1 to v2; decommission v1 Worker, KV, Pages, and the `bookmarklet/` directory on `main`. Acceptance: v1 is gone, v2 is the only deployed system.

Plans A → D run sequentially, each fully reviewed before the next begins. The `writing-plans` skill should be invoked once per sub-plan as we get to it, not all four upfront — that way each plan can incorporate lessons from the previous one.

## Success criteria

v2.0 is "done enough to cut over from v1" when:

1. Pair flow works for at least Plex and Flixify end-to-end on a Tesla.
2. Home screen renders Continue + Recently Added across both, on Tesla cellular, in under 4 seconds.
3. Tapping an item plays it via the canvas pipeline with audio sync intact (regression-tested against v1 player behavior).
4. Resume from saved position works for both Plex and Flixify.
5. Auto-next plays the next episode for at least one TV series on at least one source.
6. Subtitles toggle works for at least one item that has them.
7. Settings / pair / unpair work without typing a single token on the Tesla.

The user runs their normal in-car movie session on v2 for a week. If they don't reach for v1 once, cut over.
