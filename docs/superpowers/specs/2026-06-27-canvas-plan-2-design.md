# Canvas Plan 2 — IA Redesign + Visual Polish + QR Pair + PIN Auto-format Design Spec

**Date:** 2026-06-27
**Status:** Approved, pending implementation plan
**Builds on:** `2026-06-27-canvas-ui-redesign-design.md` (parent spec — defines the design DNA, theme tokens, and 3-plan decomposition this is one wave of)

## Purpose

Plan 1 swapped the framework (Preact → React + MUI), renamed `passenger` → `canvas`, and wired in the AppShell + Breadcrumbs without redesigning any individual screen. The result works but reads as "branded prototype." Plan 2 makes it feel like a real product:

- An information architecture that scales beyond a single source (cross-source aggregated rails on top of home; source-picker drill-down to per-source mini-homes).
- A QR-code pair flow so phone pairing doesn't require typing a URL into a Tesla.
- A PIN field that auto-formats — type 6 chars, get `K7P-Q3M`.
- Final-form visuals on every screen: hero + episode list + skeleton loading + inline error Alerts + empty states.
- Live source-status pings in Settings.
- The Plan 1 deferrals (tsconfig flags, breadcrumb item title, theme CSS variables).

Plan 3 still owns onboarding, branding finalization, and decommission of the `passenger-v2` infrastructure. Captions stay deferred separately.

## Non-goals

- No new device targets beyond Tesla landscape + phone portrait for `/pair`.
- No new source adapter (Jellyfin, TheCalm, generic URL stay disabled — same "(coming soon)" treatment).
- No quality / bitrate selection.
- No multi-profile, family sharing, Chromecast/AirPlay.
- No captions / subtitles.
- No first-run onboarding (Plan 3).
- No logo / wordmark redesign (Plan 3).
- No watchlist support (Plan 3).
- No phone responsive layout for the main app (only `/pair` is mobile-portrait).

## Audience

Same as the parent spec: David on his Tesla MCU3, occasionally with one or two trusted friends/family. UI quality should look intentional to a stranger handed the URL.

## Architectural decisions

**Routing changes.**
- New: `/source/:src` — per-source mini-home (rails + libraries grid).
- Removed (redirect): `/lib/:src` — folded into `/source/:src`. Existing internal callers updated; an old bookmark redirects to the new path.
- Unchanged: `/lib/:src/:libId`, `/item/:src/:id`, `/search`, `/settings`, `/settings/pair`, `/pair`.
- Internal navigation: PosterCard's folder branch now points to `/source/:src` when `item.type === 'folder' && libraryId === item.id` semantics no longer apply — folder cards belong to the per-library item list, not the source root.

**Source-rooted breadcrumbs.**
- `<Source>` crumb on item / library paths links to `/source/:src` instead of the deprecated `/lib/:src`.
- New item-title plumbing: `ItemDetailView` writes `canvas.itemTitles` localStorage map; `RouteBreadcrumbs` reads it. Same fallback-to-literal pattern as the existing library cache.

**Worker additions.**
- `GET /api/source-status?key=X` — pings the source's lightweight endpoint (Plex: `/identity`, others: `/`); returns `{ status: 'ok' | 'degraded' | 'unreachable', lastSeenAt: number }`. Cached 30 s in the worker to avoid hammering during Settings re-renders.
- `GET /api/source-home?key=X` — composes existing adapter calls; returns `{ continueWatching: Item[], recentlyAdded: Item[], libraries: BrowseItem[] }`.
- `/api/home` extended with `libraryCounts: { [srcKey: string]: number }` so the source picker doesn't need a second round-trip per card.

**Single-source fallback.**
- `/` with `Object.keys(sources).length === 1`: source picker section hidden; aggregate rails are the only content. With 0 sources, the existing empty-state with "Pair your first source" stays.

**Frontend dependencies added.**
- `qrcode` (npm) — ~10 KB minified, mature, supports SVG output. Used only on the Tesla pair view.
- No new MUI surface (Skeleton, Alert, Backdrop, Dialog, Switch, Select, LinearProgress, ListItemButton are all in `@mui/material` already from Plan 1).

**No new framework decisions.** Plan 1's theme tokens, MUI v6, React 18, Inter font, hash router all stay. This plan is composition + new routes + worker, not a foundation change.

## Section 1 — Plan 1 deferrals (Phase A)

Three small cleanups before the bigger work starts. One task, one commit per concern.

### 1a. `noUnusedLocals` + `noUnusedParameters` tsconfig flags

Edit `web/tsconfig.json` — add both flags under `compilerOptions`. Run `tsc --noEmit`. Fix every reported unused identifier inline (expect 2–5 sites; the final code review found `Link` in Home, but the rest of the codebase hasn't been audited). Build must remain clean.

### 1b. Breadcrumb item-title plumbing

Add to `web/src/storage.ts`:

```ts
const ITEM_TITLES_KEY = 'canvas.itemTitles';

export function getItemTitle(srcKey: string, itemId: string): string | undefined { /* same JSON-blob pattern as getLibraryName */ }
export function setItemTitle(srcKey: string, itemId: string, title: string): void { /* same pattern */ }
```

`ItemDetailView` calls `setItemTitle(source, id, item.title)` after the fetch resolves. `Breadcrumbs.tsx` reads it in `deriveCrumbs` for the `/item/:src/:id` path; falls back to literal `'Item'` while unknown.

### 1c. Theme `cssVariables: true`

Flip the flag in `web/src/theme.ts`:

```ts
export const theme = createTheme({
  cssVariables: true,
  palette: { /* unchanged */ },
  // ...
});
```

MUI injects `:root { --mui-palette-* }` properties at runtime; the existing `var(--mui-palette-background-paper, #181a1f)` patterns in `ItemDetail.tsx` will now resolve to the theme value instead of always falling through to the hex fallback. Verify the build still passes (it should be a 1-line change) and the ItemDetail epsiode rows still look correct.

## Section 2 — Information architecture (Phases B + C)

### Routes table

| Route | Plan 1 state | Plan 2 state |
|---|---|---|
| `/` | Aggregate flat-rail home | Aggregate hero + rails + source picker grid (picker hidden when 1 source) |
| `/lib/:src` | Source's libraries list | **Redirect** to `/source/:src` |
| `/lib/:src/:libId` | Items in a library | Unchanged (header band added in Phase D) |
| `/item/:src/:id` | Item detail | Visual redesign in Phase D |
| **`/source/:src`** | — | **New: per-source mini-home (rails + libraries grid)** |
| `/search` | Aggregate flat grid | Aggregate grouped-by-source |

### Aggregate home (`/`)

Top zone: hero (320 px, renders only when `continueWatching[0]` exists, full-bleed backdrop image with a `linear-gradient(to top, rgba(14,15,18,0.95), transparent)` overlay, right-aligned text column with title / year / runtime / Resume button / Start-over button).

Middle zone: rails (`<Rail>` from Plan 1, unchanged structurally). Two rails on the aggregate home: "Continue Watching · across sources" and "Recently Added · across sources." Each rail item carries `source` metadata so PosterCard can deep-link to the correct `/item/:src/:id`.

Bottom zone: source picker grid (`<Typography variant="h3">Your sources</Typography>` header; grid `repeat(auto-fill, 200px)` of `<SourceCard>` components). Hidden when only 1 source paired.

### Per-source mini-home (`/source/:src`)

Same vertical structure as aggregate, but scoped: hero from this source's continue, rails from this source's continue + recently added, then a libraries grid below. The libraries section uses `<Typography variant="h3">Libraries</Typography>` header and `repeat(auto-fill, 200px)` of `<LibraryCard>` components (name + item count).

### Source picker grid (on `/`)

Each card is a `<Card><CardActionArea>`:

```
┌─────────┐
│  ┌─┐    │   ← type icon avatar (40 × 40), top-left
│  │P│    │
│  └─┘    │
│         │
│  Plex   │   ← source label (body1 / 500)
│  5 libs │   ← library count (caption)
└─────────┘
```

Type icon: small avatar with single-letter glyph (`P` for plex, `J` for jellyfin, `F` for flixify, generic film icon for generic). Colored by source-type theme color (Plex amber-orange `#e5a00d`, Jellyfin purple `#aa5cc3`, Flixify red `#cc3333`, generic divider color). Click → `navigate('/source/' + srcKey)`. Library count from the new `libraryCounts` field on `/api/home`.

### Libraries section (on `/source/:src`)

Similar shape — `<Card><CardActionArea>` per library:

```
┌────────────┐
│  Movies    │
│  247       │
└────────────┘
```

Title (body1 / 500) + item count (caption). Click → `navigate('/lib/' + srcKey + '/' + libId)`. Counts come from the existing per-library API response.

### Breadcrumb logic

| URL | Crumbs |
|---|---|
| `/` | (none — single-crumb hides) |
| `/source/:src` | `Home › <Source label>` |
| `/lib/:src/:libId` | `Home › <Source label> › <Library name>` |
| `/item/:src/:id` | `Home › <Source label> › <Library name?> › <Item title>` |
| `/search` | `Home › Search` |
| `/settings`, `/settings/pair` | `Home › Settings [› Pair new source]` |

The `<Source label>` crumb on `/lib/:src/:libId` and `/item/:src/:id` now links to `/source/:src` (not the deprecated `/lib/:src`).

### Worker routes

```http
GET /api/source-status?key=<srcKey>
→ 200 { "status": "ok" | "degraded" | "unreachable" | "lan-only", "lastSeenAt": <ms-epoch> | null }
   404 { "error": "unknown source key" }
```

The status field always carries the verdict so the client always renders uniformly. Network failure of the upstream probe maps to `{ "status": "unreachable", "lastSeenAt": null }` still served as HTTP 200. Only an unknown `key` returns 404.

**RFC1918 LAN-skip:** The CF Worker runs on Cloudflare's edge — it cannot reach RFC1918 addresses (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`). If the worker did try to probe, it would always return "unreachable" for LAN-only Plex servers that work fine from the user's Tesla on the same LAN. Detection logic:

1. **`plex.direct` hostname pattern** (Plex's auto-issued TLS hostname): subdomain encodes the IP with dashes, e.g. `192-168-1-100.abc123.plex.direct` → `192.168.1.100`. Parse the first segment of the hostname, check against RFC1918 ranges.
2. **Bare IP literal** (e.g. `http://192.168.1.5:32400`): parse `URL.hostname` and test directly.
3. **Anything else** (regular domain names): proceed with the probe — they're presumed public.

If RFC1918 detected, the worker short-circuits and returns `{ "status": "lan-only", "lastSeenAt": null }` without probing. Clients render this with a grey status dot + caption "LAN-only — health check unavailable" instead of the red unreachable badge.

Implementation: per source-type, hit the lightweight endpoint with a 3-second timeout:
- Plex: `${baseUrl}/identity?X-Plex-Token=${token}` (returns small JSON).
- Jellyfin: `${baseUrl}/System/Info/Public` (returns small JSON, no auth).
- Flixify: `${baseUrl}/` (HEAD, follows redirects).
- Generic: `${baseUrl}/` (HEAD).

Cache the result in KV for 30 seconds per source key under `status:<srcKey>`. Settings calls one request per source on mount, sequentially.

```http
GET /api/source-home?key=<srcKey>
→ 200 { "continueWatching": Item[], "recentlyAdded": Item[], "libraries": BrowseItem[] }
   404 { "error": "unknown source key" }
   502 { "error": "<adapter-side reason>" }
```

Implementation: composes the source's `home()` and `library()` adapter methods. Plex already provides on-deck and recently-added.

```http
GET /api/home   (extended)
→ 200 { "rows": HomeRow[], "errors": SourceError[], "libraryCounts": { "<srcKey>": <number> } }
```

`libraryCounts` is populated from each adapter's library list. If a source fails (status 'unreachable'), it doesn't appear in `libraryCounts`.

## Section 3 — Per-screen visual redesign (Phase D)

### ItemDetail (`/item/:src/:id`)

Layout:

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs                                         │
├─────────────────────────────────────────────────────────────┤
│   [backdrop, full-bleed, gradient fade]                      │  ← Hero (320 px)
├─────────────────────────────────────────────────────────────┤
│   ┌──────┐                                                   │
│   │poster│  Backrooms                                        │
│   │ 200  │  2026 · 1h54m · ★ 7.6 · Drama Horror              │  ← Poster overhangs
│   │  ×   │                                                   │     hero by 40 px
│   │ 300  │  ▶ Resume 39:42    Start over                     │
│   └──────┘                                                   │
│             A therapist must venture into a dimension        │
│             beyond reality to save her patient...            │
├─────────────────────────────────────────────────────────────┤
│  (TV only) Episodes                                          │
│  [Season 1] [Season 2] ↓                                     │
│  ┌──────────────────────────────────────────┐                │
│  │ [thumb]  S1·E1 · Pilot                42m │                │
│  │          Synopsis line...                  │                │
│  │ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬─── 38%                    │ ← Resume bar  │
│  ├──────────────────────────────────────────┤                │
│  │ [thumb]  S1·E2 · ...                       │                │
│  └──────────────────────────────────────────┘                │
```

- Hero: `<Box height={320}>` with `backgroundImage` + linear gradient fading to `background.default` at the bottom.
- Info row: flex with `marginTop: -40px` on the info column so the poster overhangs by 40 px. Poster is 200 × 300 (rounded).
- Title: `<Typography variant="h1">`. Meta row: MUI `<Stack direction="row" spacing={1.5} divider={<Dot/>}>` — year, runtime, star + rating, then a chip strip for genres.
- Buttons: primary Resume = contained, PlayArrowIcon startIcon, label `Resume ${formatPos(viewOffsetSec)}` or `Play`. Start over = text variant, only when viewOffsetSec > 60.
- Synopsis: `<Typography variant="body1" sx={{ maxWidth: 720, lineHeight: 1.5 }}>`.

For TV shows: Episodes section below the info row. Season chip strip: `<Stack direction="row" spacing={1}>` of `<Chip variant={active?'filled':'outlined'}>`. Episode list: `<List>` with `<ListItemButton onClick={() => navigate('/play/...')}>` rows. Each row has `<Avatar variant="rounded" sx={{ width: 160, height: 90 }} src={ep.poster}/>` + primary text `S<n>·E<m> · <Title>` + secondary text `<runtime> · <synopsis>`. If `ep.viewOffsetSec > 60`, render `<LinearProgress variant="determinate" value={pct} sx={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}/>` at the bottom of the ListItemButton.

### Library (`/lib/:src/:libId`)

Header band: `<Typography variant="h1">{library.name}</Typography>` with inline `<Typography variant="caption" color="text.secondary"> · {N} items</Typography>`. Grid stays `repeat(auto-fill, 180px)`.

Empty state: centered `<EmptyState icon={<LibraryAddOutlinedIcon/>} title="This library is empty" actionLabel="Back to source" onAction={() => navigate('/source/'+source)}/>`.

### Search (`/search`)

Same big centered input. Results group by source: for each unique `hit.source` value with ≥1 hit, render:

```
<Typography variant="h3" sx={{ mt: 3, mb: 1.5 }}>
  {sourceLabel} · {count} results
</Typography>
<Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, 180px)', gap: 2.5 }}>
  {hits.map(...)}
</Box>
```

Idle state (q.length < 2): centered helper text. No-results state (q.length ≥ 2 and zero hits): centered "No results for \"<q>\"". Previous-results-while-typing: dim to 50% opacity, don't blank.

### Settings (`/settings`)

```
┌─────────────────────────────────────────────────────────────┐
│  Settings                                                    │  ← h1
│                                                              │
│  Sources                                                     │  ← h3
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢  [P avatar]  My Plex Server          [Unpair]    │    │
│  │                plex.direct:18403                     │    │
│  │                Last seen: 5 minutes ago              │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 🟢  [P avatar]  Plex B                  [Unpair]    │    │
│  │                ...                                    │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│        [ + Pair new source ]                                 │
│                                                              │
│  Preferences                                                 │
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

`<SourceCard>` component:
- 8 × 8 px status dot: green `#67d391` for ok, amber `#f5a623` for degraded, red `#ef5350` for unreachable, grey `#6b7280` for lan-only.
- 40 × 40 avatar with the single-letter type glyph (same as picker cards).
- Body: source label (body1 / 500) + base URL (caption) + last-seen line (caption).
- Right side: "Unpair" `<Button variant="text" color="error">` opening a MUI `<Dialog>` confirmation.
- Status text is "Loading…" while the `/api/source-status` request is in flight, then "Last seen: <X> minutes ago" or "Unreachable since: <X>" based on the response.

Preferences card: MUI `<Switch>` for the two booleans, MUI `<Select>` for the two language picks (options: English, Spanish, French, German, Original).

About card: pulls `import.meta.env.VITE_BUILD_SHA` + version from `web/package.json` (via Vite `define` injection at build time).

### Pair (`/settings/pair`)

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs (Home › Settings › Pair new source)     │
├─────────────────────────────────────────────────────────────┤
│  Pair a new source                                           │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │  Plex Media Server                       │  ← Card-button │
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
```

Stays as MUI `<Card><CardActionArea>` rows. Plex card click → transitions to QR + PIN state (Section 4). Disabled cards have `pointerEvents: 'none'` + opacity 0.5, with `(coming soon)` in muted caption.

## Section 4 — Pair flow rework (Phase E)

### Tesla side (after Plex picked from card list)

```
┌─────────────────────────────────────────────────────────────┐
│ AppBar + Breadcrumbs                                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│        Scan with your phone to pair                          │
│                                                              │
│              ┌──────────────────────────┐                    │
│              │   [QR code, ~280 × 280]  │                    │
│              │                          │                    │
│              └──────────────────────────┘                    │
│                                                              │
│   Or enter K7P-Q3M at <window.location.host>/#/pair          │
│                                                              │
│   ⏳ Waiting for approval — expires 9:42 PM                   │
```

- QR encodes: `${window.location.protocol}//${window.location.host}/#/pair?code=${pin}&type=${sourceType}`.
- Library: `qrcode` npm package. `qrcode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 280 })` returns SVG markup; render with `dangerouslySetInnerHTML` (the SVG is generated locally from the PIN — no XSS risk).
- The small text fallback uses `window.location.host` (already in place).
- Polling state machine, expiration timestamp, and 1200 ms redirect-on-approved remain unchanged from Plan 1.

### Phone side (`/pair`)

PIN auto-format: input shows 7 chars max (`XXX-XXX` with the dash). On every change, run `formatPin(stripPin(raw))`:

```ts
// web/src/lib/pin-format.ts
export function stripPin(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function formatPin(stripped: string): string {
  if (stripped.length <= 3) return stripped;
  return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
}
```

- Submit button enabled when `stripPin(input).length === 6`.
- Pasting `K7P-Q3M`, `K7PQ3M`, `k7p-q3m`, or `k7pq3m` all work (the strip handles separators and case).
- QR-prefilled URL: PhonePair reads `?code=` from `useRoute().query`, runs the same formatter, fills the field already-formatted, and **auto-submits** after a `setTimeout(0)` tick so the user doesn't have to tap the button.

Worker-side PIN generation stays in `worker/src/lib/pair-pin.ts` — it already emits `XXX-XXX` format; no change there. The frontend stripPin handles input variation; the API payload still uses `XXX-XXX`.

## Section 5 — Loading + error + empty + reseek (Phase F)

### Skeletons

Each top-level fetch gets a skeleton placeholder rendered during the loading state. Use MUI `<Skeleton>`:

- Home: skeleton rail × 2 (each: 1 skeleton-text rail title + 5 skeleton poster rectangles) + skeleton picker grid (4 cards).
- Source mini-home: skeleton rail × 2 + skeleton libraries grid (4 cards).
- Library grid: 12 skeleton posters in the `auto-fill` grid.
- ItemDetail: skeleton hero (rectangular, 320 px) + skeleton poster + 3 text-line skeletons + 4 chip skeletons.
- Search: while a query is in flight, previous results dim to 50% opacity via `filter: opacity(0.5)`. New input takes over the result region with no skeleton (debounce hides most of the latency).

### Inline error Alerts

| Failure | UI |
|---|---|
| Per-source rail on home fails | Top of screen MUI `<Alert severity="warning">` with retry button. Other rails still render. |
| Full-screen primary fetch fails | Centered MUI `<Alert severity="error">` with Retry + Home buttons. |
| Player engine fatal | MUI `<Backdrop open>` over canvas with centered `<Alert>` and "Back to details" button. |
| Pair API failures | Inline `<Alert>` inside Pair / PhonePair (unchanged structurally from Plan 1, restyled). |
| Source unreachable (Settings card) | Red status dot + "Unreachable" caption. No Alert overlay — the dot is the indicator. |

### Empty states

One reusable component `web/src/components/EmptyState.tsx`:

```tsx
interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon, title, body, actionLabel, onAction }: EmptyStateProps) {
  return (
    <Box sx={{ p: 5, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <Box sx={{ '& svg': { fontSize: 64, color: 'text.secondary' } }}>{icon}</Box>
      <Typography variant="h3">{title}</Typography>
      {body && <Typography color="text.secondary">{body}</Typography>}
      {actionLabel && onAction && (
        <Button variant="contained" onClick={onAction}>{actionLabel}</Button>
      )}
    </Box>
  );
}
```

Usage sites:
- Home with 0 sources paired (replaces the inline Plan 1 copy).
- Library with 0 items.
- Search with `q.trim().length >= 2` and 0 results.
- Per-source mini-home with 0 libraries (rare but possible — e.g. a freshly-paired source with empty libraries).

### Reseek backdrop

Player.tsx tracks `reseeking: boolean`. Set true in `reseek()` before tearing down the engine; set false when the new `VideoSink`'s first frame paints. **`VideoSink` does not currently expose a first-frame callback — add one as part of T17**: add an `onFirstFrame?: () => void` field to the `VideoSink` constructor options and invoke it once on the first successful canvas paint (the existing render loop already knows when this happens). Player.tsx wires it: `new VideoSink({ ..., onFirstFrame: () => setReseeking(false) })`. Renders:

```tsx
{reseeking && (
  <Backdrop open sx={{ zIndex: 5, bgcolor: 'rgba(0,0,0,0.6)' }}>
    <Stack alignItems="center" spacing={2}>
      <CircularProgress />
      <Typography color="common.white">Seeking…</Typography>
    </Stack>
  </Backdrop>
)}
```

## File layout

```
web/src/
  theme.ts                         ← MOD: cssVariables: true
  router.tsx                       ← (unchanged, but used by new /source/:src route)
  main.tsx                         ← MOD: add /source/:src to route table
  api.ts                           ← MOD: add sourceStatus(), sourceHome(); extend home() type
  storage.ts                       ← MOD: add getItemTitle/setItemTitle
  lib/
    pin-format.ts                  ← NEW: stripPin + formatPin
  components/
    AppShell.tsx                   ← (unchanged)
    Breadcrumbs.tsx                ← MOD: consume getItemTitle; <Source> crumb links to /source/:src
    EmptyState.tsx                 ← NEW
    SourceCard.tsx                 ← NEW: Settings source row
    SourcePickerCard.tsx           ← NEW: Home grid picker card
    LibraryCard.tsx                ← NEW: per-source-home library tile
    PosterCard.tsx                 ← (unchanged)
    Rail.tsx                       ← (unchanged)
    PlayerControls.tsx             ← (unchanged from Plan 1)
  views/
    Home.tsx                       ← MOD: hero + picker grid + single-source fallback
    SourceHome.tsx                 ← NEW: /source/:src view (hero + rails + libraries grid)
    Library.tsx                    ← MOD: header band + empty state + redirect from /lib/:src
    ItemDetail.tsx                 ← MOD: backdrop hero + poster overhang + episodes List + LinearProgress
    Search.tsx                     ← MOD: grouped-by-source
    Settings.tsx                   ← MOD: SourceCard with status pings + Dialog confirm
    Pair.tsx                       ← MOD: QR rendering
    PhonePair.tsx                  ← MOD: PIN auto-format + auto-submit on prefilled code
    Player.tsx                     ← MOD: reseeking Backdrop overlay

worker/src/
  routes/
    source-status.ts               ← NEW
    source-home.ts                 ← NEW
    home.ts                        ← MOD: extend response with libraryCounts
  index.ts                         ← MOD: wire new routes

worker/wrangler.toml               ← (unchanged)
web/package.json                   ← MOD: + qrcode
```

## Task decomposition (≈20 tasks)

**Phase A — Foundation (1 task)**
- T1: Plan 1 deferrals (tsconfig flags, item-title cache, theme cssVariables)

**Phase B — Worker (2 tasks)**
- T2: `GET /api/source-status?key=X` route + KV cache + adapter dispatch
- T3: `GET /api/source-home?key=X` route + extend `/api/home` with `libraryCounts`

**Phase C — Information architecture (4 tasks)**
- T4: New `/source/:src` route + `<SourceHome>` view scaffold (rails + libraries grid)
- T5: Home updates — hero + source picker grid + single-source fallback + `<SourcePickerCard>` component
- T6: Breadcrumb updates — `<Source>` crumb links to `/source/:src`; item-title plumbing wired through `<ItemDetailView>`
- T7: Deprecate bare `/lib/:src` — redirect to `/source/:src`; PosterCard navigation review

**Phase D — Visual redesign per screen (5 tasks)**
- T8: ItemDetail — backdrop hero + poster overhang + episodes `<List>` + LinearProgress resume bar
- T9: Library — header band + count + empty state reuse
- T10: Search — grouped-by-source rendering
- T11: Settings — SourceCard component + status pings (consumes T2) + Preferences card + About card + Unpair Dialog
- T12: Pair (Tesla) — refined card-button picker + redesigned PIN screen layout (still no QR yet — T13 adds it)

**Phase E — Pairing rework (2 tasks)**
- T13: QR code on Tesla pair screen (qrcode lib, SVG output)
- T14: PIN auto-format on phone side + auto-submit on QR-prefilled URL

**Phase F — Loading + error + empty + reseek (3 tasks)**
- T15: `<EmptyState>` component + wire into Home / Library / Search / SourceHome
- T16: Skeleton loading states for Home / SourceHome / Library / ItemDetail
- T17: Error Alert primitives (per-source warnings, full-screen failure, player fatal) + reseek `<Backdrop>` overlay

**Phase G — Deploy + smoke (1 task)**
- T18: Deploy worker + frontend; Tesla smoke

## Out of scope

- First-run onboarding flow (Plan 3).
- Logo / wordmark redesign (Plan 3).
- Favicon, apple-touch-icon (Plan 3).
- Watchlist support (Plan 3).
- Skip-intro automation actually-wired (Plan 3).
- Captions / subtitles (separate plan).
- Decommission of `passenger-v2` infrastructure (Plan 3).
- Multi-profile, family sharing, Chromecast / AirPlay.
- Phone responsive layout for the main app.

## Risks and sharp edges

1. **QR code reliability on Tesla.** The Tesla browser renders SVG correctly, but the camera-scan side is the user's phone — if QR contrast is too low against the dark theme, scanning fails. Mitigation: render the QR `<svg>` on a `<Paper>` background (white surface) so the QR's black-on-white default contrast is preserved.
2. **Source-status request flood.** Settings reloads every time the user navigates back. The 30 s KV cache absorbs most repeats. If a user has 5 sources, that's still 5 sequential requests on every Settings mount. Acceptable for v1; cache TTL could grow later.
3. **`/api/source-status` for sources behind LAN-only addresses.** Worker can't reach `192.168.x.x` from the CF edge. Resolved: worker detects RFC1918 hostnames (via `plex.direct` subdomain pattern or bare IP literal) and returns `status: 'lan-only'` without probing; SourceCard renders a grey dot instead of red unreachable. See Section 2's worker route description for the detection logic.
4. **`cssVariables: true` ripple effects.** Flipping the theme flag changes how MUI emits styles. The bundle size delta should be minimal but build size could shift. Verify after T1.
5. **Plex on-deck for Source mini-home.** Plex's `/library/onDeck` is already used. Need to verify it returns enough data for the per-source hero. If not, fall back to `/library/recentlyAdded[0]` for the hero.
6. **Library counts on the source picker.** Requires the home API to know per-source library counts. Plex returns library count cheaply (`/library/sections` already returns the array; just `.length`). For Jellyfin / Flixify (when added), the count may not be a single call. Out of scope for now (those adapters aren't enabled).
7. **Bundle size growth.** qrcode adds ~10 KB. Theme cssVariables potentially adds runtime CSS. Skeletons / Alerts / Dialog / Backdrop are all in @mui/material already. Estimate: 640–700 KB total after Plan 2 vs Plan 1's 628. Acceptable.

## Success criteria

Plan 2 is "done" when:

1. Loading `canvas-8j0.pages.dev` shows the new home: hero (if Continue has items) + cross-source rails + source picker grid (if multiple sources).
2. Tapping a source picker card navigates to `/source/:src` showing rails + libraries grid scoped to that source.
3. Breadcrumbs show "Home › <Source> › <Library> › <Item title>" on item-detail pages (not literal "Item").
4. Pair screen shows a working QR code; phone-side scan auto-fills the PIN and auto-submits.
5. PIN field on phone accepts 6 raw chars and displays them as `XXX-XXX`.
6. Settings shows status dots that turn green when sources respond, red when unreachable.
7. All screens have skeleton loading instead of blank-white waits.
8. All screens with empty data show a real empty-state component with a clear next action.
9. Network failures surface as inline MUI Alerts with retry, not red corner text.
10. Player reseek shows a "Seeking…" backdrop over the canvas instead of flickering to black.
11. The build still produces a working bundle (<750 KB / <210 KB gzip).
12. Tesla smoke passes end-to-end: pair via QR + browse aggregate + drill into a source + play a movie + seek mid-playback.
