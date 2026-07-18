# YouTube Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YouTube as a third source type (public, unauthenticated) so household members can search, browse playlists/channels, and play public YouTube videos ad-free through canvas's WebCodecs player — without breaking Plex or Flixify.

**Architecture:** A new `youtube` `SourceAdapter` resolves metadata via `yt-dlp -J` (no API key). `resolveStream` returns a signed canvas-internal URL; a new stream route runs `yt-dlp` (extract avc1+m4a direct URLs) → `ffmpeg` (remux to fragmented MP4) → HTTP pipe, which the existing `RangeFetcher` consumes. Playlists map to shows (videos = episodes), reusing the queue/Up-Next model. yt-dlp + ffmpeg are bundled in the Docker image behind an injectable exec wrapper. See `docs/superpowers/specs/2026-07-18-youtube-source-design.md`.

**Tech Stack:** Bun + Hono + TypeScript + Drizzle (SQLite) server; React + Vite + MUI 6 frontend; bundled yt-dlp + ffmpeg binaries.

## Global Constraints

- **Additive only.** No changes to Plex/Flixify adapters, player pipeline, auth, or pair flows. A YouTube resolve failure must degrade gracefully (Home warning badge / retryable player error), never sink other sources or crash.
- No test framework additions to `web/`; verify web via `npm --prefix web run build`. Server: `bun test`, tests follow `server/src/routes/*.test.ts` + injectable-dependency patterns.
- Commit messages: NO `Co-Authored-By` trailer, NO "Generated with Claude Code" footer.
- Migrations via `bun run db:generate` (auto-named SQL file).
- yt-dlp is version-pinned in the image and independently bumpable.

---

## File Structure

**Created (server):**
- `server/src/sources/youtube.ts` — the adapter.
- `server/src/sources/youtube.test.ts`
- `server/src/lib/ytdlp.ts` — injectable yt-dlp/ffmpeg exec wrapper + format-selection helpers.
- `server/src/lib/ytdlp.test.ts`
- `server/src/lib/yt-stream-sign.ts` — HMAC sign/verify for stream URLs.
- `server/src/lib/yt-stream-sign.test.ts`
- `server/src/routes/yt-stream.ts` — `GET /api/yt/stream/:id` + `GET /api/yt/subs/:id`.
- `server/src/routes/yt-stream.test.ts`

**Modified (server):**
- `server/src/sources/types.ts` — add `'youtube'` to `SourceType`.
- `server/src/db/schema.ts` — widen the two `type` enums.
- `server/src/app.ts` — `registerAdapter(youtubeAdapter)`; mount the stream route (public, before auth middleware); pass the signer.
- `server/src/config.ts` — `YTDLP_PATH`, `FFMPEG_PATH`, `YT_MAX_CONCURRENT_STREAMS`, `YT_STREAM_SECRET` (optional; else boot-generated).
- `server/src/routes/sources-mgmt.ts` — admin `POST /` to create a tokenless public source.
- `server/src/index.ts` — boot-time binary presence check (warn only).

**Modified (client):**
- `web/src/lib/source-style.ts` — YouTube color + glyph.
- `web/src/api.ts` — `addPublicSource` method.
- `web/src/views/Pair.tsx` (and/or `views/settings/SourcesTab.tsx`) — "Add YouTube" entry.

**Modified (deploy / docs):**
- `Dockerfile` — install ffmpeg (apk) + pinned yt-dlp binary in the runtime stage.
- `README.md` + a `docs/youtube.md` — capabilities, limits, ToS note, yt-dlp bump instructions.

**Untouched:** all of `web/src/player/*`, Plex/Flixify adapters, auth, pair, deployment.

---

## Task 1: Schema + type widening (foundations, no behavior)

**Files:** `server/src/sources/types.ts`, `server/src/db/schema.ts`.

> **No migration needed.** Drizzle's `text({ enum: [...] })` is TypeScript-only for
> SQLite — the generated DDL is plain `type text NOT NULL` with no CHECK constraint
> (verified across `server/drizzle/*.sql`). Widening the enum is a pure type change;
> existing rows and the DB file are untouched, so `db:generate` produces nothing.

- [x] Add `'youtube'` to the `SourceType` union in `sources/types.ts`.
- [x] Widen `sources.type` and `pair_sessions.type` enums in `schema.ts` to include `'youtube'`.
- [ ] `bun test` + `bun run typecheck` green. *(pending local toolchain)*

**Verify:** typecheck passes; no migration file created; Plex/Flixify rows intact.

## Task 2: yt-dlp/ffmpeg wrapper + config (injectable, testable)

**Files:** `server/src/lib/ytdlp.ts` (+test), `server/src/config.ts`.

- [x] `config.ts`: `YTDLP_PATH` (default `yt-dlp`), `FFMPEG_PATH` (default `ffmpeg`), `YT_MAX_CONCURRENT_STREAMS` (default 2), `YT_STREAM_SECRET` (optional).
- [x] `ytdlp.ts`: injectable `exec` (default `Bun.spawn`); `json(args)` → parsed JSON; `pickFormats(formats)` → `{ videoUrl, audioUrl, needsTranscode }` selecting avc1≤1080 + m4a, muxed fallback, transcode fallback; timeouts + non-zero-exit → `YtDlpError`. (Added `YtDlpError extends UpstreamError` in `errors.ts`.)
- [x] Tests inject a fake exec returning canned yt-dlp JSON; assert format selection incl. the muxed-fallback and AV1-only → `needsTranscode` branches.

**Verify:** ✅ `bun test` 326 pass / 0 fail (11 new); `bun run typecheck` clean; no real process spawned in tests.

## Task 3: Signed stream URLs

**Files:** `server/src/lib/yt-stream-sign.ts` (+test).

- [x] `makeStreamSigner(secret, {now})` → `signQuery(videoId, fromSec)` = `from=&exp=&sig=` (HMAC-SHA256 via WebCrypto, like `lib/bearer.ts`); injectable clock for testable expiry.
- [x] `verify(videoId, params)` → boolean; timing-safe compare; reject expired/tampered/missing.
- [x] Tests: round-trip, from clamp/floor, tamper (id/from/sig), expiry, wrong-secret, missing/non-numeric params. ✅ 9 pass, typecheck clean.

## Task 4: YouTube adapter (metadata)

**Files:** `server/src/sources/youtube.ts` (+test).

- [ ] Item ID encode/decode (`v:`/`p:`/`c:` prefixes).
- [ ] `search` (`ytsearchN:` via yt-dlp), `home` (trending row), `library` (sections + channel/playlist browse), `item` (video / playlist-as-show / channel).
- [ ] `resolveStream` → signed internal URL + `durationSec` + `subtitleTracks` from metadata.
- [ ] `saveProgress` no-op; `startPair` unused stub.
- [ ] Map YouTube metadata → `Item`/`ItemDetail` (title, channel→`showTitle`, duration, thumbnail→`poster`, `hasCC`).
- [ ] Tests with injected yt-dlp exec cover each method + id round-tripping.

## Task 5: Stream + subtitle routes

**Files:** `server/src/routes/yt-stream.ts` (+test), `server/src/app.ts`.

- [ ] `GET /api/yt/stream/:videoId` — verify sig → concurrency semaphore → yt-dlp extract → ffmpeg remux pipe → `video/mp4`. Kill children on `c.req.raw.signal` abort. 429 when over the concurrency cap; 403 on bad sig.
- [ ] `GET /api/yt/subs/:videoId?lang=` — fetch caption track, return `text/vtt`.
- [ ] Mount both **public** (before auth middleware) in `app.ts`, alongside `/api/telemetry`.
- [ ] Register `youtubeAdapter`.
- [ ] Tests: sig rejection, concurrency-cap 429, child-kill on abort (fake exec), VTT content-type.

**Verify:** with real binaries locally, a public video plays end-to-end through the canvas player; seek reboots cleanly; disconnect leaves no orphan ffmpeg.

## Task 6: Add-source route + frontend

**Files:** `server/src/routes/sources-mgmt.ts`, `web/src/api.ts`, `web/src/lib/source-style.ts`, `web/src/views/Pair.tsx` (and/or `SourcesTab.tsx`).

- [ ] Admin `POST /api/sources` `{ type:'youtube', label }` → tokenless source + grant to creator.
- [ ] `api.addPublicSource`; "Add YouTube" entry in the source picker (no QR).
- [ ] `source-style`: red + `YT` glyph.
- [ ] `npm --prefix web run build` green.

**Verify:** admin adds YouTube; it appears on Home with badge; search + a playlist binge (Up-Next autoplay) + captions all work; a member without the grant doesn't see it.

## Task 7: Docker + docs

**Files:** `Dockerfile`, `README.md`, `docs/youtube.md`.

- [ ] Runtime stage: `apk add --no-cache ffmpeg` + copy pinned yt-dlp binary; verify both on `PATH`.
- [ ] `docs/youtube.md`: capabilities, v1 limits, ToS note, yt-dlp bump steps.
- [ ] README: list YouTube as a source.

**Verify:** `docker build` (CI `docker-build`) green; binaries present in the image; a video plays from a container run.

## Task 8: Failure-isolation + resource regression check

- [ ] Force a resolve failure (bad video id / yt-dlp non-zero): Home still renders Plex/Flixify rows with a YouTube warning; player shows retryable error.
- [ ] Load test the concurrency cap; confirm no orphaned subprocesses after disconnect/seek storms.

---

## Rollout / PR slicing

Ships as one branch `feat/youtube-source`. Reviewable in two logical PRs if
preferred: **(1)** Tasks 1–5 (server adapter + streaming, no UI wiring — testable
via API), **(2)** Tasks 6–8 (frontend add-source, Docker, docs, hardening).
Everything is additive; can merge behind the existing per-user source ACL so it's
effectively opt-in per household member.
