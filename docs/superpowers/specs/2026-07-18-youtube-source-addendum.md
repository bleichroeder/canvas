# Sub-project Q addendum: YouTube as a first-class destination (not a Home source)

**Date:** 2026-07-18
**Amends:** `2026-07-18-youtube-source-design.md`
**Status:** design revision after first local testing.

## Why this addendum

The v1 design slotted YouTube into the shared Home alongside Plex/Flixify —
`home()` returned a "Trending" row that fed the aggregated Continue-Watching /
Recently-Added rails. Local testing surfaced two problems and one insight:

1. **YouTube killed the Trending page.** `https://www.youtube.com/feed/trending`
   now 404s / redirects to the homepage (`yt-dlp` error:
   *"trending: The channel/playlist does not exist"*). So `home()` threw on every
   render, the YouTube source errored on the Home screen, and nothing displayed —
   leaving the "Your library, on every screen" empty state.
2. **YouTube has no *continue-watching* / *recently-added* without sign-in.** The
   whole rail model that fits Plex/Flixify doesn't fit a public YouTube.
3. **Insight (from testing):** YouTube reads better as its *own* destination —
   a source card that opens a YouTube-specific page — than as rows mixed into a
   personal-media Home.

## The revised design

**YouTube does not contribute to the aggregated Home.** `home()` returns `[]`.
It appears as a **source card** (ordered after personal-media sources) that opens
a **dedicated YouTube page**: a search box plus **self-curated rails of followed
channels & playlists**.

### Why "followed channels/playlists" instead of sign-in

Sign-in was the obvious way to get feed content (recommendations / subscriptions /
watch-later). It's technically feasible via **cookie auth** (`yt-dlp --cookies`),
but rejected for v1:

- **Cookie capture is hostile to the product.** The Tesla browser can't run the
  extension that exports `cookies.txt`; setup would have to happen on a separate
  laptop, cookies **expire every few weeks** (recurring chore), and pointing it at
  a personal (Premium) account carries **ToS / rate-limit / suspension risk**.
- **The payoff is thin here.** Ad-free already works unauthenticated, and the
  Premium quality bump is VP9/AV1 we transcode to H.264 anyway.

**Followed channels/playlists** deliver the same "a feed to browse" feel without
any of that: the user curates channels/playlists they like (from any device — add
from a phone, watch from the Tesla), and the page shows each channel's latest
uploads and each playlist as a rail. Channel-uploads and playlist targets are
**reliable** `yt-dlp` inputs (verified: `@YouTube/videos` → 20 items, a playlist
→ 15), with **no account, no cookies, no expiry, no risk**.

Real cookie sign-in stays on the roadmap as an **optional, clearly-labeled
power-user add-on** (true subscriptions/history + members/age-restricted/private
content) — never a v1 dependency.

## Data model

**New table `youtube_follows`** — a user's followed channels/playlists.

```ts
export const youtubeFollows = sqliteTable('youtube_follows', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind', { enum: ['channel', 'playlist'] }).notNull(),
  ytId: text('yt_id').notNull(),          // channel id (UC…) or playlist id (PL…)
  title: text('title').notNull(),         // cached for display
  thumbnail: text('thumbnail'),           // cached poster, nullable
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  uniq: uniqueIndex('youtube_follows_user_item').on(t.userId, t.kind, t.ytId),
}));
```

Follows are **per-user** (each household member curates their own). The unique
index makes follow idempotent and blocks duplicates. This is a real Drizzle
migration (unlike the v1 enum widening).

## Server surface

- **`youtube.home()` → `[]`** (drop the dead trending call; YouTube leaves the
  aggregated Home entirely).
- **Follows CRUD** (authed), e.g. `GET/POST/DELETE /api/youtube/follows`. `POST`
  takes `{ kind, ytId }` (from a search result / channel view / pasted URL),
  resolves + caches `title`/`thumbnail` via `yt-dlp`, inserts.
- **Rail population reuses existing endpoints** — a followed channel is
  `library(c:<id>)`, a playlist is `item(p:<id>)`; no new browse code.
- **Dedup public-source add** — `POST /api/sources {type:'youtube'}` becomes
  idempotent-ish: if the user already has a YouTube source, return it instead of
  creating a second (fixes the "two YouTube sources" seen in testing).

## Frontend

- **`youtube.home()` returning `[]`** already removes it from Home's rails; add
  source-card ordering so YouTube sits **after** personal-media sources.
- **Dedicated `YouTube` view** (routed from the source card): a search box, a
  **"Your channels"/playlist rail per follow** (each fetched via the existing
  library/item endpoints), and **Follow/Unfollow** affordances on channel views
  and search results.
- Search-result **card layout** tuned for YouTube's 16:9 thumbnails + channel
  line (v1 reused the 2:3 poster card, which reads poorly).

## Reliability fixes (independent of the above, found in testing)

- **Bundle a JS runtime (Deno).** Recent `yt-dlp` warns *"No supported JavaScript
  runtime could be found … some formats may be missing"* — it needs one to solve
  YouTube's signature/`n` parameter reliably. Add Deno to the Docker image (and
  document it for local dev). Applies with or without auth.
- **yt-dlp stderr is now logged** on non-zero exit (was captured but silently
  swallowed — made the first round of debugging blind). ✅ done.
- Consider brief per-video metadata caching + a small retry/backoff to smooth the
  transient throttling seen under bursty use.

## Non-goals (unchanged from v1, reaffirmed)

Cookie/OAuth sign-in, subscriptions/history/watch-later, gated content, live
streams, >1080p / native VP9-AV1 — all still out for this slice.
