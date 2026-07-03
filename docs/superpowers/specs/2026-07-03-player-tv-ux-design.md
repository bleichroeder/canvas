# Sub-project N: Player + TV UX

**Date:** 2026-07-03
**Target release:** v0.9.0
**Scope:** Four bundled frontend UX improvements. No server/API/adapter changes.

## Goal

Land four independently-shaped UX improvements that meaningfully improve TV binge-watching and error triage:

1. Group TV episodes by season in the show detail page (currently one flat list across all seasons).
2. Autoplay the next episode at end-of-stream; add next/prev buttons in the player control bar.
3. Move the diagnostics affordance from a hidden triple-tap gesture to a discoverable kebab menu in the player control bar (triple-tap and `?diag=1` URL param retained as hidden fallbacks).
4. Replace the red-text top-left error overlay with a proper MUI Dialog carrying a clear message, expandable details, and recovery actions.

## Non-goals

- No new source types. No source-adapter refactor. No backend/API changes.
- No transient-error snackbar/toast — every error today flows to `errMsg` and is treated as fatal (player becomes non-interactive). We keep that classification for now; if we later identify recoverable cases, we add a separate mechanism.
- No keyboard shortcuts for next/prev.
- No credit-detection or "skip intro."
- No changes to `DiagnosticsOverlay` internals — only a third invocation point.
- No changes to how `viewOffsetSec` / resume position is saved.

## Global constraints

- Frontend-only. All changes live under `web/src/`. No touching `server/`, no touching adapter code.
- Follow existing MUI patterns already in `PlayerControls.tsx` (Menu with anchored button pattern from the subtitles menu is the reference).
- Do not break Flixify. Data shape from both Plex and Flixify normalizes to `Episode { season, episode, ... }`; do not add source-type branches for browse/queue logic.
- Preserve existing `?diag=1` URL param behavior.
- Preserve existing triple-tap gesture (100×100 top-left corner zone).
- Preserve the existing router pattern (`useRoute()` from `src/router.ts`, `navigate()`); playback queue context lives in router state, not URL params.

---

## Feature 1: Season tabs in show detail

**File:** `web/src/views/ItemDetail.tsx` (lines 177–242).

**Behavior:**
- If the item is a TV show and its `episodes[]` spans more than one distinct `season` value, render an MUI `<Tabs>` component immediately above the episode list.
- One tab per distinct `season` value present in `episodes[]`, ordered numerically ascending.
- Tab label format: `S{n}` (e.g. `S1`, `S2`). Season 0 → label `Specials` (Plex reports specials/extras with `parentIndex: 0`).
- Default-selected tab: the season of the highest-indexed episode in the `(season asc, episode asc)` queue that has `viewOffsetSec > 0` (i.e., the furthest-along in-progress episode). If no episodes have `viewOffsetSec > 0`, default to the lowest-numbered season.
- Episode list below the tabs is filtered to the currently-selected season's episodes. Existing per-episode rendering (poster, `S{n}·E{n}` tag, duration, resume progress bar) is unchanged.

**Edge cases:**
- **Single-season show:** if only one distinct `season` value, do not render tabs; render the flat list as today (avoids single-tab awkwardness).
- **Zero episodes:** existing "empty" state is preserved.
- **Loading state:** existing loading spinner in `ItemDetail` is preserved.

**No changes needed to:**
- Backend/adapter code (data already carries `season` and `episode`).
- The `Episode` interface in `src/types.ts`.
- `PosterCard` component (unaffected — it renders individual episodes in grids, not the show detail).

---

## Feature 2: Queue context, autoplay, next/prev buttons

### 2.1 `PlaybackContext` type

New type introduced in `web/src/types.ts` (or a new `web/src/types/playback.ts` if it fits better with existing structure):

```ts
export interface EpisodeRef {
  id: string;
  title: string;
  season: number;
  episode: number;
  poster?: string;
}

export interface PlaybackContext {
  showId: string;
  showTitle: string;
  episodes: EpisodeRef[];  // whole-show queue, ordered by (season asc, episode asc)
  currentIndex: number;
}
```

Non-TV playback (movies, standalone videos) passes `null` — player operates exactly as today.

### 2.2 Queue construction

**File:** `web/src/views/ItemDetail.tsx`.

When the user clicks Play on an episode of a TV show:
1. Sort all `episodes[]` by `(season asc, episode asc)` to build the whole-show queue.
2. Locate `currentIndex` as the position of the clicked episode in that sorted list.
3. Call `navigate('/watch/:id', { state: { context } })` where `context` is a `PlaybackContext`.

For movies / non-TV items, no context is passed (call `navigate` without a state, same as today).

### 2.3 Player consumes context

**File:** `web/src/views/Player.tsx`.

- Read `PlaybackContext | null` from router state on mount.
- Expose to `PlayerControls` via a new prop (or a small React context — implementation detail; whichever fits existing patterns better).
- When switching to a new episode within the queue (Next / Prev / autoplay), update `currentIndex` and re-invoke the media-load flow for the new episode's ID. Reuse the existing `bootSession` path so resume-position saving and telemetry keep working unchanged.

### 2.4 Next / Prev buttons

**File:** `web/src/components/PlayerControls.tsx`.

- If `PlaybackContext` is present, render **Prev** and **Next** buttons flanking the play/pause control (Prev to the left of the −10s button, Next to the right of the +10s button). Standard MUI `IconButton` with `SkipPreviousIcon` / `SkipNextIcon`.
- If `PlaybackContext` is `null` (movie playback), buttons are not rendered.
- **Next behavior:** load `episodes[currentIndex + 1]`. Button is `disabled` when `currentIndex + 1 >= episodes.length`.
- **Prev behavior:** if `currentPlaybackSec > 5`, seek to 0 (standard media-player behavior). Otherwise, load `episodes[currentIndex - 1]`. Button is `disabled` only when `currentIndex === 0` AND `currentPlaybackSec <= 5`.

### 2.5 Autoplay overlay

**New file:** `web/src/components/UpNextOverlay.tsx`.

- Mounts when playback reaches end-of-stream (whether naturally or via user seek to end) AND `PlaybackContext` is present AND `currentIndex + 1 < episodes.length`. Implementer identifies the specific signal — the existing player emits telemetry events including `frame_stall` and various error kinds; end-of-stream detection may already exist in the engine or may need a small addition.
- Full-width panel over the video (not full-screen — leaves the video visible as a faded background):
  - Left: next episode's poster (from `EpisodeRef.poster`).
  - Right: `Up next: S{n}·E{n} — {title}`, a circular 10-second countdown progress ring, and two buttons: **[Play now]** and **[Cancel]**.
- Countdown fires at t+10s → load `episodes[currentIndex + 1]`.
- **Play now** → immediate load of next episode.
- **Cancel** → close overlay, navigate back to `ItemDetail` for the show.
- If at the end of the last episode of the last season (`currentIndex + 1 >= episodes.length`), the overlay is not rendered; player auto-navigates back to `ItemDetail`.

**Edge cases:**
- Player Close button (top-right X) while overlay is showing → same as Cancel (navigate back to `ItemDetail`).
- If the user manually seeks to end-of-stream (rather than natural playback), the overlay still fires — driven by the end-of-stream event, not a duration check.
- Overlay does not appear during regular pause or seek — only on end-of-stream.

---

## Feature 3: Kebab menu in control bar + move diagnostics

**File:** `web/src/components/PlayerControls.tsx`.

- Add an MUI `IconButton` with `MoreVertIcon` positioned immediately left of the fullscreen button on the right end of the control bar.
- Clicking opens an MUI `<Menu>` anchored to the button, following the exact same pattern as the existing subtitles menu on this component.
- Initial menu items:
  - **Diagnostics** — invokes the existing `setDiagOpen(true)` handler (or whatever the current gesture handler calls) to open `DiagnosticsOverlay`.
- Menu is structured to accept future items (playback speed, video info, report issue) without additional refactor. No stub items shipped — add real ones when they land.

**Retained (unchanged):**
- The corner triple-tap zone in `Player.tsx` (lines 688–693).
- The `?diag=1` URL param opening flow.
- `DiagnosticsOverlay` component internals.

---

## Feature 4: Fatal error dialog

**New file:** `web/src/components/PlayerErrorDialog.tsx`.

**Behavior:**
- Rendered when `errMsg` state is non-null in `Player.tsx`. `errMsg` remains the single source of truth.
- MUI `<Dialog open={!!errMsg}>` with:
  - **Title:** `Playback error`
  - **Body:** the current `errMsg` string (e.g., `video: decoder init failed`), rendered as regular text (not monospace, not colored red).
  - **Details section:** collapsible (MUI `Collapse` behind a "Show details" button). Content: the full error string plus the diagnostics session ID (from `diagnostics.ts` — the same one that appears in the ring buffer's session context).
  - **Actions row:** three buttons.
    - **Back to browse** — navigate to the show/movie detail page for the currently-playing item.
    - **Show diagnostics** — set `diagOpen = true`, opening `DiagnosticsOverlay` on top of the dialog.
    - **Retry** — clear `errMsg`, re-invoke `bootSession` for the current media ID.
- Not dismissable by backdrop click or Escape (`disableEscapeKeyDown`, `onClose` no-op except on user action button). Playback is broken; we want a decision, not a dismiss.

**Deleted:**
- The red top-left inline error `<div>` in `Player.tsx` (lines 644–653).

**Unchanged:**
- All four error-source paths that populate `errMsg` (`VideoSink.onError`, `AudioSink.onError`, `bootSession` fatal catch, `engine.onFatal`).
- `reportFatal` telemetry classification and ring-buffer emission.

---

## Files created / modified

**Created:**
- `web/src/components/UpNextOverlay.tsx`
- `web/src/components/PlayerErrorDialog.tsx`
- `web/src/types/playback.ts` (or types added to existing `web/src/types.ts` — implementer's call based on file size fit)

**Modified:**
- `web/src/views/ItemDetail.tsx` — season tabs + queue-context construction on Play.
- `web/src/views/Player.tsx` — consume `PlaybackContext`; mount `UpNextOverlay` on end-of-stream; mount `PlayerErrorDialog` on `errMsg`; delete red top-left inline error div.
- `web/src/components/PlayerControls.tsx` — kebab menu with Diagnostics item; conditional Next/Prev buttons.

**Untouched:**
- `web/src/components/DiagnosticsOverlay.tsx`
- `web/src/player/diagnostics.ts`
- All `server/` code.
- All adapter code (Plex, Flixify).

---

## Testing

**Unit tests (`web/tests/`):**
- Season-grouping + default-tab-selection logic (pure function): shows with 1 / 2 / N seasons, in-progress default, no-in-progress default, specials (S0) present, all seasons watched.
- Queue construction (sort by `(season asc, episode asc)`; locate `currentIndex`).
- Prev-button decision (seek vs load previous based on `currentPlaybackSec` threshold).

**E2E tests (Playwright, `web/tests/e2e/`):**
- Fixture: a Plex TV show with 3 seasons, 5 episodes each.
- Show detail renders 3 tabs and defaults to S1 (no in-progress episodes in fixture).
- Clicking Next on the last episode of a season loads the first episode of the next season.
- Prev-early-in-episode (<5s) navigates to previous episode; Prev-mid-episode (>5s) seeks to 0 without navigating.
- Triggering end-of-stream mounts `UpNextOverlay` with correct next-episode metadata; Cancel closes it and returns to `ItemDetail`.
- Kebab menu opens; clicking Diagnostics opens the `DiagnosticsOverlay`.
- Injected fatal error opens `PlayerErrorDialog`; Retry re-invokes `bootSession`; Back-to-browse navigates to `ItemDetail`.

**Manual in-vehicle validation before release:**
- One full TV binge session (episode transition end-to-end).
- One deliberate error injection to confirm the dialog looks right on the in-car display.

---

## Release plan

1. Merge sub-project N to `main`.
2. Tag `v0.9.0`.
3. Publish workflow builds + pushes `ghcr.io/bleichroeder/canvas:0.9.0`, `:0.9`, `:latest`.
4. Watchtower rolls installations forward within ~5 minutes.
5. Release notes highlight: season tabs, autoplay + next/prev, error dialog, control-bar menu.
