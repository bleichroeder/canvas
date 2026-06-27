# Canvas — UI Redesign + Rebrand Design Spec

**Date:** 2026-06-27
**Status:** Approved, pending implementation plans
**Codename:** `canvas` (renamed from `passenger`)
**Builds on:** `2026-06-27-passenger-v2-design.md`, `2026-06-27-player-polish-design.md`

## Purpose

The v2 stack is functionally complete — pair, browse, play, seek, volume, MP3 all work end-to-end. The UI, however, is functional-not-finished: minimal top nav, no breadcrumbs / back navigation, emoji glyphs in place of icons, hand-rolled flexbox layouts that read as "developer wireframe" rather than "product." This spec drives the work to take it from working to *real*.

Three concurrent threads:

1. **Framework + brand foundation.** Swap Preact → React; adopt MUI for components, icons, and theming. Rename the product `passenger` → `canvas`.
2. **Visible polish.** Redesign every non-player screen (Home, Library, ItemDetail, Search, Settings, Pair) with proper layout, hierarchy, and component primitives.
3. **Finished-product feel.** Onboarding, branding (logo, wordmark, favicon), loading skeletons, inline error UI, final polish.

These execute as **three sequential plans** so we ship value at each wave instead of waiting for a monolithic landing.

## Non-goals

- No captions / subtitle rendering (separate plan, deferred).
- No audio-track switching, skip-intro automation, auto-next episode beyond what already exists.
- No quality / bitrate selection.
- No multi-profile, family sharing.
- No Chromecast / AirPlay.
- No phone-side responsive layout for the main app. The phone-side `/pair` view stays as today (mobile-portrait); main app stays Tesla landscape-first.
- No new external dependencies beyond MUI (`@mui/material`, `@mui/icons-material`, `@emotion/react`, `@emotion/styled`), Inter font (`@fontsource/inter`), and the React swap (`react`, `react-dom`).

## Audience

Same as v2: David, on his Tesla MCU3, possibly with one or two trusted friends/family if they ask. UI quality should look intentional to someone who's never seen the product — a stranger handed the URL.

## Architectural decisions

**Framework swap: Preact → React + MUI.**
- React 18, MUI v6 (or whichever is current at implementation time), `@emotion/*` for MUI's styling, `@mui/icons-material` for icons.
- The component count is small (~12 components + 7 views); refactor is roughly 1 day of mechanical work.
- Bundle cost: from ~210 KB (gzipped ~55 KB) today to an estimated 600 KB (gzipped ~180 KB). One-time first-load cost on Tesla cellular; cached forever after.
- Routing stays hand-rolled (existing hash router) — MUI doesn't bundle one and the route count doesn't warrant a library.

**Hosting unchanged.** Cloudflare Pages + Worker + KV. Pages bandwidth is unlimited free; bundle size does not change hosting cost. Worker request volume is unchanged.

**Rename mechanics.**
- New Cloudflare resources are stood up in Plan 1; old `passenger-v2` resources stay live until Plan 3 cutover, then are decommissioned.
- Source-string rename targets user-visible places (`X-Plex-Product` header, About text, page titles); internal TypeScript names can stay.
- LocalStorage keys change; existing users (just David) will need to re-pair once after upgrade.
- The git repo at `C:\github\passenger\` keeps its on-disk name to avoid bookmark/path churn.

## Design DNA

A single MUI `createTheme()` lives at `web/src/theme.ts`. Every color / spacing / typography value flows from it. No inline color literals scattered through component files.

### Theme overrides

**Mode:** dark.

**Palette:**
```
background.default: #0e0f12
background.paper:   #181a1f
primary.main:       #4f8ef7
primary.dark:       #2d8cff
text.primary:       #f4f5f7
text.secondary:     #9aa0a8
divider:            #2a2d36
error.main:         #ef5350
success.main:       #67d391
```

**Typography:** Inter (self-hosted via `@fontsource/inter`, weights 400/500/600/700 — ~30 KB tree-shaken). Scale:
- `h1` 40 px / 600 / `letterSpacing: 0.5px` — screen titles on ItemDetail
- `h2` 32 px / 600 / `letterSpacing: 0.5px` — wordmark, hero titles
- `h3` 20 px / 600 / `letterSpacing: 0.5px` — rail titles, section headers
- `body1` 16 px / 400 — body text
- `body2` 14 px / 400 — meta lines
- `caption` 12 px / 500 — micro labels, timestamps

**Surfaces (Tesla-leaning aesthetic):**
- `MuiPaper.defaultProps.elevation` set to 0.
- `MuiPaper.styleOverrides.root` adds `border: 1px solid rgba(255,255,255,0.06)` + minimal shadow. Flatter, instrument-cluster feel rather than Material elevation stacking.

**Density:** MUI default (touch-comfortable). Tesla viewport is 1440 × 720 — wide but short — so we lean horizontal (rails, grids) rather than long vertical scrolls where possible.

### Icons

`@mui/icons-material` replaces every emoji. Mapping table:

| Emoji | Icon component | Used on |
|--------|---------------|---------|
| 🔍 | `<SearchIcon/>` | AppBar |
| ⚙ | `<SettingsIcon/>` | AppBar |
| ▶ | `<PlayArrowIcon/>` | ItemDetail, PlayerControls |
| ⏸ | `<PauseIcon/>` | PlayerControls |
| ◀10 | `<Replay10/>` | PlayerControls |
| 10▶ | `<Forward10/>` | PlayerControls |
| 🔇 | `<VolumeOffIcon/>` | PlayerControls |
| 🔈 | `<VolumeMuteIcon/>` | PlayerControls |
| 🔉 | `<VolumeDownIcon/>` | PlayerControls |
| 🔊 | `<VolumeUpIcon/>` | PlayerControls |
| ⤢ | `<FullscreenIcon/>` | PlayerControls |
| ⤓ | `<FullscreenExitIcon/>` | PlayerControls |
| ✕ | `<CloseIcon/>` | PlayerControls |
| (back) | `<ArrowBackIcon/>` | AppBar |
| › | `<ChevronRightIcon/>` | Breadcrumbs |
| + | `<AddIcon/>` | Pair new source |

## App shell + navigation

`Chrome.tsx` is replaced by an `AppShell` component that wraps every non-player route. Three vertical zones:

1. **AppBar** (sticky, 56 px tall, elevation 0, custom border-bottom):
   - **Back button** (left, `IconButton` with `ArrowBackIcon`): renders only when not on `/`. Click → `history.back()` if `history.length > 1`, else `navigate('/')`.
   - **Wordmark** (`canvas` in Inter 24 px / 500 / letter-spacing 1 px): clickable → `/`.
   - **Search icon** (right): → `/search`.
   - **Settings icon** (right): → `/settings`.

2. **Breadcrumbs row** (40 px tall, only rendered when depth ≥ 1):
   - MUI `<Breadcrumbs separator={<ChevronRightIcon fontSize="small"/>}>`.
   - All segments except the last are clickable links.
   - Route-derived crumbs:
     - `/lib/:src` → `Home › <Source label>`
     - `/lib/:src/:libId` → `Home › <Source label> › <Library name>`
     - `/item/:src/:id` → `Home › <Source label> › <Library name?> › <Item title>` (library segment is best-effort — read from item-detail metadata if present)
     - `/search` → `Home › Search`
     - `/settings` → `Home › Settings`
     - `/settings/pair` → `Home › Settings › Pair new source`

3. **Page content** (the route's view) — flex-fills the rest.

**Source labels in breadcrumbs:** the source key (`blackhaw`, `commonli`) is ugly. Look up the display label from the `paired sources` localStorage map; show the source's `label` field (e.g., "BLACKHAWKVI"). Falls back to the key if not found.

**Library name in breadcrumbs:** requires knowing the library that owns an item. Cache the library name in localStorage keyed by `<src>:<libId>` after first visit. Falls back to "Library" while unknown.

**Player route (`/play/...`)** does NOT use `AppShell`. It's full-bleed canvas with its own controls overlay; the existing in-player back arrow / close button handles exit.

## Home screen

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│      ┌──────────────────────────────────────────┐           │
│      │   [backdrop, gradient fade]              │  Continue  │
│      │                                          │  Backrooms │
│      │                                          │  2026 · 1h54m │  ← Hero (320 px)
│      │                                          │  ▶ Resume 39:42 │
│      └──────────────────────────────────────────┘  Start over │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  Continue Watching                                           │
│  [poster] [poster] [poster] [poster] [poster] →             │
│                                                              │
│  Recently Added · My Plex                                    │
│  [poster] [poster] [poster] [poster] →                       │
│                                                              │
│  Recently Added · thecalm.site                               │
│  [poster] [poster] [poster] →                                │
│                                                              │
│  Your libraries                                              │
│  [Movies · Plex] [Shows · Plex] [+ add source]              │
```

**Hero:**
- Renders only when `Continue Watching` has at least one item; picks `items[0]`.
- Full-bleed backdrop image (`item.backdrop` if available, else `item.poster` with `filter: blur(20px)`).
- Right-side overlay text + buttons (poster art hidden — backdrop is the visual).
- Linear gradient overlay so text stays legible.
- Resume button is `<Button variant="contained" size="large" startIcon={<PlayArrowIcon/>}>`. Start over is `<Button variant="text">`.

**Rails:**
- `<Rail title="...">` — `h3` title, horizontal scroll with `scrollSnapType: x mandatory`, hidden scrollbar.
- `<PosterCard item={...} source={...}>` for each entry.
- Hide rails with 0 items.

**`<PosterCard>`** component:
- MUI `<Card>` (elevation 0, themed border).
- Aspect: 2/3 for movies/shows/folders; 16/9 for episodes.
- Background image with placeholder fallback (slate + centered all-caps title).
- Below: title (one-line ellipsis), year/meta (muted).
- Focus state: 2 px accent outline (touch-first; hover ignored on Tesla).
- Click → `/item/<src>/<id>` (or `/lib/<src>/<id>` if folder).

**Library shortcut chips:**
- Horizontal `<Stack>` of MUI `<Chip>`s linking to each paired source's library list.
- Last chip: `<Chip icon={<AddIcon/>} label="add source" onClick={navigate('/settings/pair')}/>`.

## Library screen

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs (Home › My Plex › Movies)               │
├─────────────────────────────────────────────────────────────┤
│  Movies   ·   247 items                                      │  ← h1 + count
│                                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐    │
│  │poster│ │poster│ │poster│ │poster│ │poster│ │poster│    │  ← Grid container
│  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘ └──────┘    │     spacing={2}
│  ...                                                         │
```

- Header: `h1` title (the section name from breadcrumbs) + caption `· N items`.
- Grid: `<Grid container spacing={2}>` with `<Grid xs={6} sm={4} md={3} lg={2}>` `<PosterCard>` children (~6 columns on Tesla).
- Empty state: large centered icon (`<LibraryAddOutlinedIcon fontSize="large"/>`) + "This library is empty" + back link.
- Sort / filter controls **out of scope** for these three plans.

## ItemDetail screen

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs                                         │
├─────────────────────────────────────────────────────────────┤
│   ┌────────────────────────────────────────────────────┐    │
│   │                                                     │    │
│   │       [backdrop, full-bleed, gradient fade]         │    │  ← Hero (320 px)
│   │                                                     │    │
│   └────────────────────────────────────────────────────┘    │
│                                                              │
│   ┌──────┐                                                   │
│   │poster│  Backrooms                                        │  ← Poster overhangs
│   │ 200  │  2026 · 1h54m · ★ 7.6 · Drama Horror              │     hero by 40 px
│   │  ×   │                                                   │
│   │ 300  │  ▶ Resume 39:42    Start over                     │
│   └──────┘                                                   │
│             A therapist must venture into a dimension        │
│             beyond reality to save her patient...            │
├─────────────────────────────────────────────────────────────┤
│  (TV only)                                                   │
│  Episodes                                                    │
│  [Season 1] [Season 2] ↓                                     │
│  ┌──────────────────────────────────────────┐                │
│  │ [thumb]  S1·E1 · Pilot                42m │                │
│  │          Synopsis line...                  │                │
│  ├──────────────────────────────────────────┤                │
│  │ [thumb]  S1·E2 · ...                       │                │
│  └──────────────────────────────────────────┘                │
```

**Hero:**
- `<Box height={320} sx={{ backgroundImage: ..., backgroundSize: 'cover' }}>` with a gradient overlay (`linear-gradient(to bottom-left, rgba(14,15,18,0) 40%, rgba(14,15,18,1) 100%)`).

**Info block:**
- Flex row, poster on the left (160 × 240 rounded MUI `<Box>` with `marginTop: -40px` for the overhang), info column on the right.
- Title: `<Typography variant="h1">`.
- Meta row: `<Stack direction="row" spacing={1.5} divider={<Box sx={{...dotSeparator}}/>}>`. Year, runtime, star rating with `<StarIcon fontSize="small"/>`, genres rendered as small `<Chip variant="outlined" size="small">` pills.
- Buttons: primary Resume / Start over (Plan 1+2; same as today functionally).
- Synopsis: `<Typography variant="body1" sx={{ maxWidth: 720 }}>`.

**Episodes (TV):**
- Season `<Chip>` strip — one `<Chip variant="filled">` for active season, others `variant="outlined"`.
- Episode list using MUI `<List>` with `<ListItemButton>` children. Each row: 160 × 90 thumbnail (`<Avatar variant="rounded">`), `S<n>·E<m> · Title` as primary text, runtime + synopsis as secondary text.
- Resume affordance: if episode has `viewOffsetSec > 60`, show a thin `<LinearProgress variant="determinate" value={pct}/>` at the bottom of the row and "Resume" instead of "Play."

**Watchlist button** stays out of scope (Plex-side only; Plan 3 if user wants it).

## Search screen

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs (Home › Search)                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│        ┌──────────────────────────────────────────┐         │
│        │  🔍  Search across your libraries...      │         │  ← Big centered input
│        └──────────────────────────────────────────┘         │
│                                                              │
│  (idle)                                                      │
│  Search runs across all paired sources.                      │
│                                                              │
│  (with results)                                              │
│  My Plex · 12 results                                        │  ← Section per source
│  [poster] [poster] [poster] [poster] [poster]                │
│                                                              │
│  Flixify · 3 results                                         │
│  [poster] [poster] [poster]                                  │
```

- Centered input: MUI `<TextField fullWidth size="medium"/>` with `<InputAdornment position="start"><SearchIcon/></InputAdornment>`.
- 250 ms debounce (unchanged from today).
- Results grouped by `source` field in each hit. For each source group, render an `h3` header + a poster grid.
- No-results state: centered "No results for *'foo'*".
- Idle state: small caption helper text.

## Settings screen

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs (Home › Settings)                       │
├─────────────────────────────────────────────────────────────┤
│  Settings                                                    │  ← h1
│                                                              │
│  Paired sources                                              │  ← h3
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢  My Plex Server                       [Unpair]   │    │  ← Source card
│  │     plex · 32-218-121-209.plex.direct:18403          │    │
│  │     Last seen: 5 minutes ago                         │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢  thecalm.site                          [Unpair]  │    │
│  │     flixify                                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│        [ + Pair new source ]                                 │
│                                                              │
│  Preferences                                                 │  ← h3
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Autoplay next episode                  [Switch on]  │    │
│  │ Skip intro automatically              [Switch off]  │    │
│  │ Default subtitle language    English ▾              │    │
│  │ Default audio language       Original ▾             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  About                                                       │
│  canvas · v1.0 · build 0a1b2c3                              │
│  Player engine · canvas/WebCodecs                            │
```

**Source rows** (Plan 2):
- One MUI `<Card>` per source.
- Status dot: small `<Box width={8} height={8} borderRadius="50%">` colored by health.
- Health is determined by a Plan 2 worker route `GET /api/source-status?key=<srcKey>` that pings the source's lightweight endpoint (Plex: `/identity`, Flixify: `/`). Returns `{ status: 'ok' | 'degraded' | 'unreachable', lastSeenAt }`.
- Status text below shows the human-readable last-seen time.
- "Unpair" button → MUI `<Button variant="text" color="error">`. Click → MUI `<Dialog>` confirmation → `removeSource(key)` on confirm.

**Pair-new-source button:**
- Centered MUI `<Button variant="contained" size="large" startIcon={<AddIcon/>}>` linking to `/settings/pair`.

**Preferences card** (Plan 2 polish; not all preferences are wired to behavior yet — surfaces them for future plans):
- MUI `<Switch>` for the booleans.
- MUI `<Select>` for the language selects with at-minimum `English`, `Spanish`, `French`, `German`, `Original` (raw codes pulled from per-source available languages later).

**About card:**
- `canvas · v<package.json version> · build <VITE_BUILD_SHA>`.
- Build SHA injected at build time via Vite `define`.

## Pair screen (Tesla side)

Same state machine as today, with MUI surfaces.

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs (Home › Settings › Pair new source)     │
├─────────────────────────────────────────────────────────────┤
│  Pair a new source                                           │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │  Plex Media Server                       │  ← Card-button │
│  │                                          │                │
│  └─────────────────────────────────────────┘                │
│  ┌─────────────────────────────────────────┐                │
│  │  Jellyfin                    (coming soon)│  ← Disabled  │
│  └─────────────────────────────────────────┘                │
│  ┌─────────────────────────────────────────┐                │
│  │  thecalm.site (Flixify)      (coming soon)│              │
│  └─────────────────────────────────────────┘                │
│  ┌─────────────────────────────────────────┐                │
│  │  Direct URL                  (coming soon)│              │
│  └─────────────────────────────────────────┘                │
│                                                              │
│  (when Plex picked, transitions to:)                         │
│  On your phone, go to:                                       │
│  canvas.pages.dev/#/pair                                     │
│                                                              │
│           K7P-Q3M                                            │  ← h1, letter-spaced
│                                                              │
│  Waiting for approval…    ⏳                                 │  ← MUI CircularProgress
```

- Source-type picker: column of MUI `<Card>`s with `<CardActionArea>`.
- Disabled rows show `(coming soon)` in muted color, `pointerEvents: none`, `opacity: 0.5`.
- PIN display: `<Typography variant="h1" sx={{ fontSize: 80, letterSpacing: 16, textAlign: 'center' }}>`.
- Waiting state: `<CircularProgress size={20}/>` inline with caption.

## Phone-side `/pair`

Functionally unchanged. MUI primitives replace inline-style buttons / inputs. Mobile portrait layout stays.

## Loading + error states

**Skeletons** (Plan 2):
- Home: while `api.home()` pending, render the same row structure with MUI `<Skeleton>` rectangles in poster places.
- Library: skeleton grid (12 placeholder posters).
- ItemDetail: skeleton hero + poster + title lines.
- Search: while query is in flight, previous results dim to 50% opacity instead of blanking.

**Errors** (Plan 2):
- Per-source rail failure on Home: top-of-screen MUI `<Alert severity="warning">` strip ("My Plex unreachable — Retry"). Other rails still render. Retry calls `/api/home` again.
- Full-screen fetch failure: centered MUI `<Alert severity="error">` with retry + back-home links.
- Player engine fatal: MUI `<Backdrop>` over the canvas with `<Alert>`, "Back to details" button.
- Pair failures: inline `<Alert>` inside the Pair view.

**Empty states** (Plan 2):
- No paired sources: centered `<EmptyState>` component — large icon + h2 message + primary action button.
- Empty library: same shape, smaller.
- No search results: centered text + small icon.

**Reseek overlay** (Plan 2):
- `<Backdrop>` over canvas with `<CircularProgress>` + "Seeking…" caption. Auto-dismisses when the new engine emits its first frame.

## Player UI

Player view itself remains canvas + controls overlay; inner controls swap to MUI primitives (Plan 1):

- Scrub bar: `<Slider>` with custom theme (thicker track, larger thumb).
- All buttons: `<IconButton>` with MUI icons (per Section 1 table).
- Volume: horizontal `<Slider>` next to the speaker `<IconButton>`.
- Tooltips on every control via `<Tooltip>`.
- Thumbnail preview img: stays as a positioned `<img>`, wrapped in `<Fade>` for smoother appearance.

Tap-to-pause logic, controls-auto-hide, the BIF 404 suppression — all preserved.

## File layout

```
web/src/
  theme.ts                       ← NEW: MUI theme + Inter font
  main.tsx                       ← swaps Preact mount for React + ThemeProvider
  router.tsx                     ← unchanged (hand-rolled hash router)
  api.ts                         ← env var rename: VITE_PASSENGER_API_V2 → VITE_CANVAS_API
  storage.ts                     ← localStorage keys renamed
  config.ts                      ← env-var read renamed
  vite-env.d.ts                  ← env-var declaration renamed
  types.ts                       ← unchanged
  components/
    AppShell.tsx                 ← NEW: replaces Chrome.tsx
    Breadcrumbs.tsx              ← NEW: route → breadcrumb derivation
    PosterCard.tsx               ← rewritten on MUI Card
    Rail.tsx                     ← rewritten on MUI primitives
    EmptyState.tsx               ← NEW
    SourceCard.tsx               ← NEW: Settings source row
    PlayerControls.tsx           ← rewritten on MUI IconButton/Slider/Tooltip
  views/
    Home.tsx                     ← rewritten: hero + rails + library chips
    Library.tsx                  ← rewritten: MUI Grid
    ItemDetail.tsx               ← rewritten: hero + poster overhang + MUI episode List
    Search.tsx                   ← rewritten: grouped by source
    Settings.tsx                 ← rewritten: source cards + prefs card
    Pair.tsx                     ← rewritten: MUI Card-buttons + h1 PIN
    PhonePair.tsx                ← MUI primitives, same flow
    Player.tsx                   ← engine wiring unchanged; controls swap to MUI

worker/src/
  routes/
    source-status.ts             ← NEW (Plan 2): GET /api/source-status?key=
  index.ts                       ← wire new route; bind new KV namespace name

worker/wrangler.toml             ← name: passenger-api-v2 → canvas-api; KV id new
web/.env.example                 ← VITE_CANVAS_API placeholder
web/package.json                 ← scripts use --project-name=canvas

docs/superpowers/specs/
  2026-06-27-canvas-ui-redesign-design.md  ← this spec
docs/superpowers/plans/
  2026-06-27-canvas-plan-1-foundation.md     (TBD per writing-plans)
  2026-06-27-canvas-plan-2-screens.md        (TBD)
  2026-06-27-canvas-plan-3-polish.md         (TBD)
```

## Rename mechanics — exhaustive

**Cloudflare resources** (created in Plan 1; old ones stay live until Plan 3 cutover):
- New Pages project name: `canvas` (or `canvas-tv` if `canvas` is taken at the account level — the implementer picks during the deploy step). Deployed URL: `https://canvas.pages.dev/` (or fallback).
- New Worker name: `canvas-api`. Deployed URL: `https://canvas-api.<account>.workers.dev`.
- New KV namespace name: `CANVAS`. Created with `npx wrangler kv namespace create CANVAS`.
- Binding name inside `wrangler.toml` stays `KV` (binding is internal; the namespace id changes).

**Environment variables:**
- `VITE_PASSENGER_API_V2` → `VITE_CANVAS_API`.
- New `VITE_BUILD_SHA` populated via Vite `define` from `git rev-parse --short HEAD` at build time.
- `web/.env.example` updated.

**LocalStorage keys:**
- `passenger.v2.sources` → `canvas.sources`
- `passenger.v2.volume` → `canvas.volume`
- `passenger.plex.clientId` → `canvas.plex.clientId`
- `passenger.apiBase`, `passenger.token` (v1 leftovers) — removed entirely.
- Library-name cache (new): `canvas.libraryNames` — `{ "<src>:<libId>": "Library Name", ... }`.

**Plex `X-Plex-*` headers:**
- `X-Plex-Product: 'passenger'` → `X-Plex-Product: 'canvas'` everywhere it's sent (both worker and browser sides).
- `X-Plex-Client-Identifier: 'passenger'` → `'canvas'`.

**HTML and copy:**
- `<title>passenger</title>` → `<title>canvas</title>`.
- Page-title wordmark text.
- About-card text in Settings.

**Old resources stay alive** for the duration of Plan 1 and Plan 2 (so the user can flip back if needed). Plan 3 final step deletes `passenger-v2` Pages project, `passenger-api-v2` Worker, `PASSENGER_V2` KV namespace.

## Three-plan decomposition

### Plan 1 — Foundation: framework swap + brand rename + nav + icons

**Goal:** the visible-cheap-wins wave. Site renders under new brand, with proper nav and real icons. No screen redesigns yet (Plan 2). Player still plays.

**Scope:**
- React + MUI + Inter + theme.
- New AppShell with AppBar + Breadcrumbs.
- Replace every emoji glyph with a MUI icon.
- Replace inline-style buttons with MUI `Button`/`IconButton`.
- Refactor Chrome.tsx → AppShell.
- Rename: source strings, env vars, localStorage keys, Cloudflare resources, X-Plex headers, HTML title.
- Stand up new Cloudflare resources (`canvas-api` Worker, `CANVAS` KV, `canvas` Pages project). Old resources stay live.
- The screens themselves render with their existing layouts — just composed of MUI primitives. Pose-and-polish comes in Plan 2.

**Acceptance:**
- Site loads at the new Pages URL, displays new wordmark.
- All emoji replaced with proper icons.
- Back arrow + breadcrumbs work on every non-home route.
- Pair Plex still works; play Backrooms still works.
- localStorage migration: existing v2 sources are dropped (user re-pairs once). Acceptable for v1 release.

### Plan 2 — Visible polish: per-screen redesign

**Goal:** the per-screen wave. Every screen looks like a real streaming product.

**Scope:**
- Home: hero + new rails + library shortcut chips.
- Library: MUI Grid layout with section header.
- ItemDetail: full-bleed hero, poster overhang, MUI episode List with Resume affordance.
- Search: results grouped by source.
- Settings: SourceCard with status dots + prefs card; new `GET /api/source-status` route.
- Pair: redesigned card-button picker + giant PIN display.
- Player controls: MUI Slider + IconButton + Tooltip swap (the actual UI element swap; functional behavior unchanged).
- Loading skeletons everywhere.
- Inline `Alert`-based error UI for per-source / per-screen / player failures.
- Empty-state component on Home / Library / Search.
- Reseek `Backdrop` overlay.

**Acceptance:**
- Each screen matches the layout sketches in this spec.
- Loading no longer shows blank pages — skeletons fill in.
- Network failures surface inline with retry, not as red corner text.
- All player controls render with MUI primitives and tooltips.

### Plan 3 — Finished feel: onboarding + branding + final polish + cutover

**Goal:** the wave that makes it feel like a real product handed to a stranger.

**Scope:**
- First-run onboarding: 3-step guided flow at first visit when no sources are paired (welcome → pair-source step inline → success + tour).
- Logo / wordmark final design (text-only is fine; can add a small mark later).
- Favicon + apple-touch-icon.
- Real watchlist support (Plex-side; surfaces the `+Watchlist` button on ItemDetail).
- Skip-intro automation toggle wired to actual marker detection (Plex marker metadata).
- Final empty-state illustrations / copy passes.
- About-card touch-up.
- **Cutover:** Decommission old `passenger-v2` Pages project, `passenger-api-v2` Worker, `PASSENGER_V2` KV namespace. Delete `bookmarklet/` directory and v1 docs from the repo (or move to `docs/archive/`).

**Acceptance:**
- A stranger handed the URL understands what canvas is and pairs a source without help.
- The product reads as finished: branded, illustrated empty states, no jagged edges.
- The repo no longer carries dead v1 / v2-passenger code.

## Out of scope (entire UI workstream)

- Captions / subtitles (separate plan, queued).
- Audio-track switching, multi-profile, family sharing.
- Chromecast / AirPlay / multi-screen.
- Quality / bitrate selection UI.
- Phone / desktop responsive layouts for the main app.
- Analytics, telemetry.
- Public release / sign-up infrastructure (canvas remains single-user-per-device).

## Risks and sharp edges

1. **MUI bundle size on Tesla cellular first-load.** ~600 KB total (~180 KB gzip). One-time hit per cache lifetime. Acceptable for v1; route-level code splitting is the documented mitigation if it becomes a problem.
2. **MUI v6 quirks vs documented examples.** MUI has moved through Grid v2, sx prop, etc. Some StackOverflow answers are stale. Stick to the official MUI v6 docs in implementation.
3. **Rename ambiguity.** Source strings vs internal identifiers — be careful not to rename TypeScript variable names (`plexAdapter`) that don't affect user-visible behavior. Only user-facing strings + env vars + CF resource names change.
4. **Old Cloudflare resources lingering.** During Plans 1 and 2, both `passenger-v2` and `canvas` Cloudflare projects exist. Make sure no rogue clients are hitting the old worker, and bookmark / DNS settings get updated.
5. **`canvas` Pages project name collision.** Subdomain might be taken at the org-CF level. Implementer chooses fallback (`canvas-tv`, `canvas-app`, or similar) at deploy time.
6. **Plex BIF previews still won't appear** until the user enables them server-side and Plex finishes analysis. Not a code issue; flagged here to set expectations.

## Success criteria

This entire UI workstream is "done" when:

1. Loading `https://canvas.pages.dev/` (or chosen subdomain) on any browser yields a polished, branded app.
2. Every emoji glyph is replaced with a real icon.
3. Every non-home route has a working back button + breadcrumbs.
4. Home shows a hero + rails + library chips with poster artwork.
5. ItemDetail shows backdrop + poster + meta + episodes layout matching the spec.
6. Settings shows source-status indicators.
7. The user can hand the URL to a friend and they figure out how to pair without help.
8. The old `passenger-v2` infrastructure is fully decommissioned.
9. Plex playback continues to work end-to-end on the Tesla after all three plans complete.
