# Sub-project N: Player + TV UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four bundled frontend UX improvements (season tabs, autoplay + next/prev, kebab-menu diagnostics, error dialog) as canvas v0.9.0.

**Architecture:** Frontend-only changes under `web/src/`. Season grouping via a pure helper and MUI `<Tabs>` in the show detail view. Playback queue is a module-level singleton read by the player on mount, advanced via existing hash-based navigation on Next/Prev. Autoplay watches the existing 250ms position poll for end-of-stream. Diagnostics gains a third invocation point (kebab menu) alongside the existing triple-tap zone and `?diag=1` URL param. Errors move from a red inline div to an MUI Dialog.

**Tech Stack:** React 18 · Vite 5 · TypeScript · MUI 6 · WebCodecs · hash-based custom router (no react-router). No test framework (canvas ships with `tsc --noEmit && vite build` as verification).

## Global Constraints

- Frontend-only. Do not touch `server/`, adapter code, or the `Episode` / `ItemDetail` types in `web/src/types.ts` (types are already sufficient).
- Follow existing MUI patterns already in `PlayerControls.tsx`: the subtitles menu is the reference for the kebab menu.
- Do not break Flixify. Both Plex and Flixify normalize to `Episode { season, episode, ... }`; do not add source-type branches for browse or queue logic.
- Preserve `?diag=1` URL param and the 100×100 top-left corner triple-tap zone (Player.tsx around lines 688-692).
- Router (`web/src/router.tsx`) is hash-based (`navigate(to: string)`, no router state); use a module-level singleton for playback queue, not router state.
- Per-task verification: `npm --prefix web run build` succeeds AND manual dev-server smoke test in a browser (`npm --prefix web run dev`).
- Commit style: one commit per task, message prefix `feat:` (season tabs, next/prev, autoplay, kebab menu) or `refactor:` (error dialog), no `Co-Authored-By: Claude` trailer, no "🤖 Generated with Claude Code" footer.

---

## File Structure

**Created:**
- `web/src/lib/season-grouping.ts` — pure helpers for grouping episodes into seasons and picking the default season.
- `web/src/lib/playback-queue.ts` — module-level singleton for the current TV playback queue.
- `web/src/components/PlayerErrorDialog.tsx` — MUI Dialog replacing the red-text inline error.
- `web/src/components/UpNextOverlay.tsx` — end-of-episode autoplay overlay with countdown.

**Modified:**
- `web/src/views/ItemDetail.tsx` — inserts season tabs above the episode list; writes playback queue before navigating to Player on episode click.
- `web/src/views/Player.tsx` — reads playback queue on mount; adds `restartSession` helper for retry; replaces red-text error div with `<PlayerErrorDialog>`; watches end-of-stream and mounts `<UpNextOverlay>`.
- `web/src/components/PlayerControls.tsx` — adds `onOpenDiagnostics` prop and kebab menu; adds `queueContext` prop and conditional Prev/Next buttons.

**Untouched:**
- `web/src/components/DiagnosticsOverlay.tsx`
- `web/src/player/*` (engine, video, audio, watchdog, diagnostics)
- `web/src/types.ts`
- All `server/` code.

---

## Task 1: Season tabs in show detail

**Files:**
- Create: `web/src/lib/season-grouping.ts`
- Modify: `web/src/views/ItemDetail.tsx`

**Interfaces:**
- Consumes: `Episode` from `web/src/types.ts` (fields used: `id`, `title`, `season`, `episode`, `durationSec`, `viewOffsetSec`, `synopsis`, `poster`).
- Produces:
  - `groupBySeason(episodes: Episode[]): Map<number, Episode[]>` — Map keyed by season number, iteration order = ascending season.
  - `pickDefaultSeason(episodes: Episode[]): number` — season of the highest-indexed episode in the `(season asc, episode asc)` order with `viewOffsetSec > 0`; if none, the lowest season number present; if `episodes` is empty, returns `0`.

- [ ] **Step 1: Create `web/src/lib/season-grouping.ts`**

```ts
import type { Episode } from '../types';

/** Group episodes by season number. Map iteration order is ascending season. */
export function groupBySeason(episodes: Episode[]): Map<number, Episode[]> {
  const seasons = new Map<number, Episode[]>();
  for (const ep of episodes) {
    const list = seasons.get(ep.season);
    if (list) list.push(ep);
    else seasons.set(ep.season, [ep]);
  }
  // Sort each season's episodes by episode number ascending.
  for (const list of seasons.values()) {
    list.sort((a, b) => a.episode - b.episode);
  }
  // Return a new Map with keys in ascending season order.
  const sortedKeys = [...seasons.keys()].sort((a, b) => a - b);
  const out = new Map<number, Episode[]>();
  for (const k of sortedKeys) out.set(k, seasons.get(k)!);
  return out;
}

/**
 * Return the season number to select by default. Prefers the season of the
 * furthest-along in-progress episode (highest index in the whole-show queue
 * with viewOffsetSec > 0). If nothing is in progress, returns the lowest
 * season number present. Returns 0 for an empty list.
 */
export function pickDefaultSeason(episodes: Episode[]): number {
  if (episodes.length === 0) return 0;
  const sorted = [...episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
  for (let i = sorted.length - 1; i >= 0; i--) {
    if ((sorted[i]!.viewOffsetSec ?? 0) > 0) return sorted[i]!.season;
  }
  return sorted[0]!.season;
}

/** Label for a season tab. Plex uses parentIndex=0 for specials/extras. */
export function seasonLabel(season: number): string {
  return season === 0 ? 'Specials' : `S${season}`;
}
```

- [ ] **Step 2: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0, no type errors.

- [ ] **Step 3: Modify `web/src/views/ItemDetail.tsx` — add season tabs**

Add imports at the top of the file (after existing MUI imports):

```ts
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { groupBySeason, pickDefaultSeason, seasonLabel } from '../lib/season-grouping';
```

Replace the entire block from line 177 to line 242 (the `{item.episodes && item.episodes.length > 0 && (...)}` section, which currently renders the flat list) with the following. The `formatRuntime`, `formatPos`, and `Dot` helpers already exist at the top of the file — do not redefine them.

Add a new `useState` for the selected season right after the existing `state` useState (around line 45):

```ts
const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
```

And add a `useEffect` after the existing item-fetch effect (after the block ending around line 56) to reset the selected season when the item changes:

```ts
useEffect(() => {
  if (state.kind === 'ok' && state.item.episodes && state.item.episodes.length > 0) {
    setSelectedSeason(pickDefaultSeason(state.item.episodes));
  } else {
    setSelectedSeason(null);
  }
}, [state]);
```

Then replace the episodes-list JSX (the `{item.episodes && item.episodes.length > 0 && (...)}` block, lines 177-242):

```tsx
{item.episodes && item.episodes.length > 0 && (() => {
  const seasons = groupBySeason(item.episodes);
  const seasonKeys = [...seasons.keys()];
  const showTabs = seasonKeys.length > 1;
  const activeSeason = selectedSeason !== null && seasons.has(selectedSeason)
    ? selectedSeason
    : seasonKeys[0]!;
  const visibleEpisodes = seasons.get(activeSeason) ?? [];
  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="h3" sx={{ mb: 1.5 }}>Episodes</Typography>
      {showTabs && (
        <Tabs
          value={activeSeason}
          onChange={(_, v) => setSelectedSeason(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          {seasonKeys.map((s) => (
            <Tab key={s} value={s} label={seasonLabel(s)} />
          ))}
        </Tabs>
      )}
      <List sx={{ p: 0 }}>
        {visibleEpisodes.map((ep) => {
          const pct = ep.durationSec && ep.viewOffsetSec
            ? Math.min(100, Math.round((ep.viewOffsetSec / ep.durationSec) * 100))
            : 0;
          const resumeEp = (ep.viewOffsetSec ?? 0) > 60;
          return (
            <ListItemButton
              key={ep.id}
              onClick={() => {
                const fromSec = Math.floor(ep.viewOffsetSec ?? 0);
                const epTitle = `${item.title} · S${ep.season}E${ep.episode}: ${ep.title}`;
                setNowPlaying({
                  src: source, id: ep.id, title: epTitle,
                  poster: ep.poster, posSec: fromSec,
                  durationSec: ep.durationSec ?? 0,
                  ts: Date.now(),
                });
                navigate(`/play/${source}/${ep.id}?from=${fromSec}`);
              }}
              sx={{
                position: 'relative',
                mb: 1, p: 1.5,
                backgroundColor: 'background.paper',
                border: '1px solid', borderColor: 'divider',
                borderRadius: 1,
                gap: 2, alignItems: 'flex-start',
              }}
            >
              {ep.poster && (
                <Avatar
                  variant="rounded"
                  src={ep.poster}
                  sx={{ width: 160, height: 90, flexShrink: 0 }}
                />
              )}
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>
                  S{ep.season}·E{ep.episode} · {ep.title}
                </Typography>
                <Stack direction="row" spacing={1.5} divider={<Dot />} sx={{ mt: 0.5, color: 'text.secondary' }}>
                  {ep.durationSec && <Typography variant="caption">{formatRuntime(ep.durationSec)}</Typography>}
                  {resumeEp && <Typography variant="caption">Resume {formatPos(ep.viewOffsetSec!)}</Typography>}
                </Stack>
                {ep.synopsis && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {ep.synopsis}
                  </Typography>
                )}
              </Box>
              {resumeEp && (
                <LinearProgress
                  variant="determinate"
                  value={pct}
                  sx={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, borderRadius: 0 }}
                />
              )}
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
})()}
```

- [ ] **Step 4: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

- [ ] **Step 5: Manual smoke test**

```bash
npm --prefix C:/github/canvas/web run dev
```

Open http://localhost:5173 in a browser. Navigate to a multi-season TV show (any show with 2+ seasons in your Plex library — a common one is a sitcom). Verify:
- Tabs render above the episode list, one per season, labels `S1`, `S2`, etc.
- Default-selected tab is the season of the furthest-along in-progress episode (or `S1` if nothing is in progress).
- Clicking a different tab filters the list to that season's episodes.
- A single-season show (or a movie) renders no tabs — the flat list.
- Clicking any episode still navigates to the player and starts playback.

- [ ] **Step 6: Commit**

```bash
cd C:/github/canvas
git add web/src/lib/season-grouping.ts web/src/views/ItemDetail.tsx
git commit -m "feat: group TV episodes by season with tabbed selector"
```

---

## Task 2: Kebab menu with Diagnostics in player control bar

**Files:**
- Modify: `web/src/components/PlayerControls.tsx`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Produces: new prop on `PlayerControlsProps`:
  - `onOpenDiagnostics(): void` — invoked when the user picks the Diagnostics item from the kebab menu.

- [ ] **Step 1: Modify `web/src/components/PlayerControls.tsx` — add prop, icon import, menu state, button, menu**

Add these two icon imports (after the existing icon imports, around line 26):

```ts
import MoreVertIcon from '@mui/icons-material/MoreVert';
import BugReportIcon from '@mui/icons-material/BugReport';
```

Add the new prop to the `PlayerControlsProps` interface (right before `onSubtitleChange`):

```ts
  onOpenDiagnostics(): void;
```

Add a new state hook at the top of the component (right after the `ccAnchor` state, around line 117):

```ts
const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
```

Add the More button in the control bar, immediately BEFORE the fullscreen `<Tooltip title={p.fullscreen ? 'Exit fullscreen' ...>` block (currently around line 266). Insert this block right after the closing `</Tooltip>` of the subtitles Tooltip (or after the `{hasTracks && (<Tooltip>...)</Tooltip>}` block if hasTracks is false — in either case, immediately before the fullscreen Tooltip):

```tsx
<Tooltip title="More">
  <IconButton
    onClick={(e) => setMoreAnchor(e.currentTarget)}
    aria-label="more"
    sx={{ ml: 1 }}
  >
    <MoreVertIcon />
  </IconButton>
</Tooltip>
```

Add a new Menu at the very end of the returned JSX, AFTER the closing tag of the subtitles Menu (the `</Menu>` currently at line 326) and BEFORE the closing `</Box>` of the outer wrapper (line 327):

```tsx
<Menu
  anchorEl={moreAnchor}
  open={Boolean(moreAnchor)}
  onClose={() => setMoreAnchor(null)}
  anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
  transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
  slotProps={{ paper: { sx: { minWidth: 200, mb: 1 } } }}
>
  <MenuItem
    onClick={() => { setMoreAnchor(null); p.onOpenDiagnostics(); }}
  >
    <ListItemIcon sx={{ minWidth: 36 }}>
      <BugReportIcon fontSize="small" />
    </ListItemIcon>
    <ListItemText primary="Diagnostics" />
  </MenuItem>
</Menu>
```

- [ ] **Step 2: Modify `web/src/views/Player.tsx` — pass the handler**

In the `<PlayerControls ... />` call (currently around lines 654-675), add one line to the props being passed:

```tsx
onOpenDiagnostics={() => setDiagOpen(true)}
```

Insert it anywhere in the prop list; group with `onFullscreenToggle` is natural.

- [ ] **Step 3: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

- [ ] **Step 4: Manual smoke test**

Start dev server (`npm --prefix C:/github/canvas/web run dev`) and play any item. Verify:
- Kebab (three-dot vertical) icon appears in the control bar, immediately left of the fullscreen icon.
- Clicking it opens a menu anchored to the icon with a single "Diagnostics" item (with a bug-report icon on the left).
- Clicking Diagnostics closes the menu and opens the DiagnosticsOverlay.
- Triple-tap on the top-left corner (100×100 zone) STILL opens the DiagnosticsOverlay.
- Adding `?diag=1` to the URL hash (e.g. `#/play/1/xyz?diag=1`) STILL opens the DiagnosticsOverlay.

- [ ] **Step 5: Commit**

```bash
cd C:/github/canvas
git add web/src/components/PlayerControls.tsx web/src/views/Player.tsx
git commit -m "feat: move diagnostics into player control-bar kebab menu"
```

---

## Task 3: PlayerErrorDialog replacing red-text overlay

**Files:**
- Create: `web/src/components/PlayerErrorDialog.tsx`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Produces: `PlayerErrorDialog` component with props:
  ```ts
  interface PlayerErrorDialogProps {
    open: boolean;
    message: string;
    sessionId: string;
    onRetry(): void;
    onShowDiagnostics(): void;
    onBackToBrowse(): void;
  }
  ```
- Consumes (inside `Player.tsx`): a new `restartSession(fromSec: number): void` helper — full teardown + boot without the `errMsg` gate that `reseek` has.

- [ ] **Step 1: Create `web/src/components/PlayerErrorDialog.tsx`**

```tsx
import { useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';

interface PlayerErrorDialogProps {
  open: boolean;
  message: string;
  sessionId: string;
  onRetry(): void;
  onShowDiagnostics(): void;
  onBackToBrowse(): void;
}

export function PlayerErrorDialog(p: PlayerErrorDialogProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <Dialog
      open={p.open}
      onClose={() => { /* not dismissable — playback is broken; force a decision */ }}
      disableEscapeKeyDown
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Playback error</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          {p.message}
        </DialogContentText>
        <Box sx={{ mt: 2 }}>
          <IconButton
            size="small"
            onClick={() => setDetailsOpen((v) => !v)}
            sx={{ mr: 1 }}
            aria-label={detailsOpen ? 'Hide details' : 'Show details'}
          >
            {detailsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
          <Typography
            component="span"
            variant="body2"
            color="text.secondary"
            sx={{ cursor: 'pointer' }}
            onClick={() => setDetailsOpen((v) => !v)}
          >
            {detailsOpen ? 'Hide details' : 'Show details'}
          </Typography>
          <Collapse in={detailsOpen}>
            <Box
              sx={{
                mt: 1.5, p: 1.5,
                fontFamily: 'monospace', fontSize: 12,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                backgroundColor: 'background.default',
                border: 1, borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              {p.message}
              {'\n'}
              session: {p.sessionId}
            </Box>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={p.onBackToBrowse}>Back to browse</Button>
        <Button onClick={p.onShowDiagnostics}>Show diagnostics</Button>
        <Button onClick={p.onRetry} variant="contained">Retry</Button>
      </DialogActions>
    </Dialog>
  );
}
```

- [ ] **Step 2: Modify `web/src/views/Player.tsx` — add restartSession helper**

Add these imports at the top of the file (after existing imports, group with other component imports around line 8):

```ts
import { PlayerErrorDialog } from '../components/PlayerErrorDialog';
```

Also import the sessionId source. Look at `web/src/player/diagnostics.ts` to find how `sessionId` is exposed — if there's a `getSessionId()` or `sessionId` export, import it. If not, use a placeholder that reads from the ring buffer's most-recent event, OR add a small `sessionId: string` module-level export to `diagnostics.ts` alongside `emit` and `reportFatal`. Read `web/src/player/diagnostics.ts` first to make the right call. For this plan we assume the sessionId is accessible via `getSessionId()`:

```ts
import { emit, reportFatal, getSessionId } from '../player/diagnostics';
```

If `getSessionId` does not exist in diagnostics.ts, add a minimal export there:

```ts
// In web/src/player/diagnostics.ts, near the existing sessionId literal:
export function getSessionId(): string {
  return sessionId; // the module-level session id already in that file
}
```

Add a `restartSession` helper inside the `Player` component. Place it right after the `reseek` function (around line 503). This is a copy of the teardown-and-boot logic in `reseek` but without the `errMsg` gate check, and without a position change:

```ts
function restartSession(fromSec: number): void {
  emit('user_gesture', { kind: 'retry' });
  setErrMsg(null);
  const myToken = ++seekTokenRef.current;
  wasPlayingRef.current = false;  // splash's Play button becomes the manual restart affordance
  engineRef.current?.dispose();
  engineRef.current = null;
  videoRef.current?.close();
  videoRef.current = null;
  audioRef.current?.stop();
  audioRef.current = null;
  pendingVideoRef.current = [];
  pendingAudioRef.current = [];
  startedRef.current = false;
  setHasEverStarted(false);
  setReseeking(false);
  setStatus('Loading…');
  const handle = bootSession(fromSec);
  const interval = window.setInterval(() => {
    if (myToken !== seekTokenRef.current) {
      handle.cancel();
      clearInterval(interval);
    } else if (engineRef.current) {
      clearInterval(interval);
    }
  }, 100);
}
```

- [ ] **Step 3: Modify `web/src/views/Player.tsx` — delete red-text div, mount dialog**

Delete this block (currently lines 644-653):

```tsx
{errMsg && (
  <div style={{
    position: 'fixed', top: 12, left: 12,
    color: '#f88',
    background: 'rgba(0,0,0,0.5)', padding: '6px 10px', borderRadius: 4, fontSize: 13,
    zIndex: 12,
  }}>
    {errMsg}
  </div>
)}
```

Replace with a `<PlayerErrorDialog>` mount. Insert this after the `<CaptionsLayer ... />` block (around line 681) and before the `<Backdrop ...>` block (around line 682):

```tsx
<PlayerErrorDialog
  open={!!errMsg}
  message={errMsg ?? ''}
  sessionId={getSessionId()}
  onRetry={() => restartSession(pos)}
  onShowDiagnostics={() => setDiagOpen(true)}
  onBackToBrowse={() => {
    setErrMsg(null);
    if (window.history.length > 1) {
      window.history.back();
    } else {
      navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
    }
  }}
/>
```

- [ ] **Step 4: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

- [ ] **Step 5: Manual smoke test — inject an error**

Start dev server. Play any item. Temporarily inject an error to verify the dialog by opening the browser devtools console and running:

```js
// This won't work from console directly since setErrMsg is inside a closure.
// Instead: open a non-existent media ID URL to trigger a real fatal error:
// http://localhost:5173/#/play/1/DOES_NOT_EXIST?from=0
```

Navigate to a `/play/{source}/{nonexistent-id}` URL. Verify:
- Dialog appears with "Playback error" title, the error message as body text.
- "Show details" toggle reveals the message and a `session: ...` line.
- The three action buttons appear: Back to browse, Show diagnostics, Retry.
- **Show diagnostics** opens the DiagnosticsOverlay on top of the dialog; closing it returns to the dialog.
- **Back to browse** clears the dialog and navigates back (or to the ItemDetail).
- **Retry** clears the dialog and re-invokes bootSession. For a genuinely-broken media ID the dialog re-appears with the same error; for a transient network error, playback resumes.
- Dialog cannot be dismissed by Escape or backdrop click.
- The red top-left inline error text is gone.

- [ ] **Step 6: Commit**

```bash
cd C:/github/canvas
git add web/src/components/PlayerErrorDialog.tsx web/src/views/Player.tsx web/src/player/diagnostics.ts
git commit -m "refactor: replace red-text player error overlay with MUI dialog"
```

(If you did not need to modify `diagnostics.ts` — i.e., `getSessionId` already existed — just omit that path from `git add`.)

---

## Task 4: Playback queue + Next/Prev buttons

**Files:**
- Create: `web/src/lib/playback-queue.ts`
- Modify: `web/src/views/ItemDetail.tsx`
- Modify: `web/src/views/Player.tsx`
- Modify: `web/src/components/PlayerControls.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface PlaybackQueue {
    showId: string;
    showTitle: string;
    sourceId: string;
    episodes: Episode[];  // sorted by (season asc, episode asc)
    currentIndex: number;
  }
  export function buildQueue(params: {
    showId: string;
    showTitle: string;
    sourceId: string;
    episodes: Episode[];
    playingEpisodeId: string;
  }): PlaybackQueue;
  export function setQueue(q: PlaybackQueue): void;
  export function getQueue(): PlaybackQueue | null;
  export function clearQueue(): void;
  ```
- Produces a new prop on `PlayerControlsProps`:
  ```ts
  interface QueueControlProps {
    canPrev: boolean;
    canNext: boolean;
    onPrev(): void;
    onNext(): void;
  }
  queueContext: QueueControlProps | null;  // null = no queue, no buttons rendered
  ```
- Consumes: `Episode` from `web/src/types.ts`; `PlaybackQueue`/`getQueue`/etc. from the new module.

- [ ] **Step 1: Create `web/src/lib/playback-queue.ts`**

```ts
import type { Episode } from '../types';

export interface PlaybackQueue {
  showId: string;
  showTitle: string;
  sourceId: string;
  episodes: Episode[];
  currentIndex: number;
}

let currentQueue: PlaybackQueue | null = null;

export function setQueue(q: PlaybackQueue): void {
  currentQueue = q;
}

export function getQueue(): PlaybackQueue | null {
  return currentQueue;
}

export function clearQueue(): void {
  currentQueue = null;
}

/** Build a queue from the show's episode list, sorted (season asc, episode asc). */
export function buildQueue(params: {
  showId: string;
  showTitle: string;
  sourceId: string;
  episodes: Episode[];
  playingEpisodeId: string;
}): PlaybackQueue {
  const sorted = [...params.episodes].sort(
    (a, b) => a.season - b.season || a.episode - b.episode,
  );
  const idx = sorted.findIndex((e) => e.id === params.playingEpisodeId);
  return {
    showId: params.showId,
    showTitle: params.showTitle,
    sourceId: params.sourceId,
    episodes: sorted,
    currentIndex: idx < 0 ? 0 : idx,
  };
}
```

- [ ] **Step 2: Modify `web/src/views/ItemDetail.tsx` — write queue on episode click**

Add import at the top (grouped with other lib imports):

```ts
import { buildQueue, setQueue } from '../lib/playback-queue';
```

Inside the episode `onClick` handler that was rewritten in Task 1 (inside the tabbed episodes JSX), add a `setQueue(buildQueue(...))` call BEFORE the `navigate(...)` call. Locate the block and update it to include the queue write. The `onClick` should now look like this in full:

```tsx
onClick={() => {
  const fromSec = Math.floor(ep.viewOffsetSec ?? 0);
  const epTitle = `${item.title} · S${ep.season}E${ep.episode}: ${ep.title}`;
  setNowPlaying({
    src: source, id: ep.id, title: epTitle,
    poster: ep.poster, posSec: fromSec,
    durationSec: ep.durationSec ?? 0,
    ts: Date.now(),
  });
  setQueue(buildQueue({
    showId: item.id,
    showTitle: item.title,
    sourceId: source,
    episodes: item.episodes!,
    playingEpisodeId: ep.id,
  }));
  navigate(`/play/${source}/${ep.id}?from=${fromSec}`);
}}
```

- [ ] **Step 3: Modify `web/src/components/PlayerControls.tsx` — add prop, imports, buttons**

Add two icon imports (grouped with existing icons around line 26):

```ts
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SkipNextIcon from '@mui/icons-material/SkipNext';
```

Add these types and update `PlayerControlsProps` at the top of the file (around line 34):

```ts
export interface QueueControlProps {
  canPrev: boolean;
  canNext: boolean;
  onPrev(): void;
  onNext(): void;
}
```

Then add one field to `PlayerControlsProps` (place it near `onSubtitleChange`):

```ts
  queueContext: QueueControlProps | null;
```

Render Prev and Next buttons flanking the play/pause cluster. Inside the `<Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mt: 0.5 }}>` block (currently around line 202), add a **Prev** button IMMEDIATELY BEFORE the existing "Back 10 seconds" Tooltip, and a **Next** button IMMEDIATELY AFTER the existing "Forward 10 seconds" Tooltip.

Prev (insert just before line 203's `<Tooltip title="Back 10 seconds">`):

```tsx
{p.queueContext && (
  <Tooltip title="Previous episode">
    <span>
      <IconButton
        onClick={p.queueContext.onPrev}
        disabled={!p.queueContext.canPrev}
        aria-label="previous episode"
        size="large"
      >
        <SkipPreviousIcon sx={{ fontSize: 32 }} />
      </IconButton>
    </span>
  </Tooltip>
)}
```

(The `<span>` wrapper is required by MUI Tooltip when the child button is disabled — Tooltip needs a non-disabled element to attach to.)

Next (insert just after line 227's closing `</Tooltip>` of the Forward 10 seconds block):

```tsx
{p.queueContext && (
  <Tooltip title="Next episode">
    <span>
      <IconButton
        onClick={p.queueContext.onNext}
        disabled={!p.queueContext.canNext}
        aria-label="next episode"
        size="large"
      >
        <SkipNextIcon sx={{ fontSize: 32 }} />
      </IconButton>
    </span>
  </Tooltip>
)}
```

- [ ] **Step 4: Modify `web/src/views/Player.tsx` — read queue on mount, wire handlers**

Add imports:

```ts
import { getQueue, setQueue, type PlaybackQueue } from '../lib/playback-queue';
```

Add state for the queue right after the existing `errMsg` state (around line 74):

```ts
const [queue, setQueueState] = useState<PlaybackQueue | null>(null);
```

Add an effect that reads the queue on mount and validates it matches the current episode. Place it right after the existing metadata-fetch effect (around line 188):

```ts
useEffect(() => {
  const q = getQueue();
  if (q && q.sourceId === source && q.episodes[q.currentIndex]?.id === id) {
    setQueueState(q);
  } else {
    setQueueState(null);
  }
}, [source, id]);
```

Add prev / next handler helpers inside the Player component, near the other event handlers (place after `onVolumeChange`, around line 519):

```ts
function goToEpisode(nextIndex: number): void {
  if (!queue) return;
  const nextEp = queue.episodes[nextIndex];
  if (!nextEp) return;
  const updated: PlaybackQueue = { ...queue, currentIndex: nextIndex };
  setQueue(updated);
  const fromSec = Math.floor(nextEp.viewOffsetSec ?? 0);
  navigate(`/play/${source}/${nextEp.id}?from=${fromSec}`);
}

function onPrev(): void {
  if (!queue) return;
  if (pos > 5) {
    void reseek(0);
    return;
  }
  goToEpisode(queue.currentIndex - 1);
}

function onNext(): void {
  if (!queue) return;
  goToEpisode(queue.currentIndex + 1);
}
```

Wire the new `queueContext` prop on the `<PlayerControls ...>` call (around line 654). Add this to the props:

```tsx
queueContext={queue ? {
  canPrev: queue.currentIndex > 0 || pos > 5,
  canNext: queue.currentIndex < queue.episodes.length - 1,
  onPrev,
  onNext,
} : null}
```

- [ ] **Step 5: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

- [ ] **Step 6: Manual smoke test**

Start dev server. Navigate to a multi-episode / multi-season TV show. Click any episode from the middle of season 1 to start playback. Verify:
- Prev (skip-previous icon) and Next (skip-next icon) buttons appear flanking the play/pause cluster.
- Clicking **Next** loads the next episode in the show (crosses season boundaries — last episode of S1 → first episode of S2).
- Clicking **Next** on the last episode of the last season shows the button as disabled.
- Clicking **Prev** within the first 5 seconds of playback loads the previous episode (crosses season boundaries downward).
- Clicking **Prev** after 5+ seconds into playback seeks to 0 (without changing episodes).
- Clicking **Prev** on the first episode within the first 5 seconds shows the button as disabled.
- Now play a movie (or any non-TV item): Prev and Next buttons do NOT render.
- Refresh the page mid-playback: Prev and Next buttons disappear (queue is lost, as expected). Navigate back to the show detail and re-click an episode to restore queue context.

- [ ] **Step 7: Commit**

```bash
cd C:/github/canvas
git add web/src/lib/playback-queue.ts web/src/views/ItemDetail.tsx web/src/views/Player.tsx web/src/components/PlayerControls.tsx
git commit -m "feat: add playback queue with next/previous episode buttons"
```

---

## Task 5: UpNextOverlay with end-of-stream autoplay

**Files:**
- Create: `web/src/components/UpNextOverlay.tsx`
- Modify: `web/src/views/Player.tsx`

**Interfaces:**
- Produces: `UpNextOverlay` component with props:
  ```ts
  interface UpNextOverlayProps {
    open: boolean;
    showTitle: string;
    nextEpisode: Episode;
    countdownSec: number;
    onPlayNow(): void;
    onCancel(): void;
  }
  ```
- Consumes: `Episode` from types, `PlaybackQueue` state and `goToEpisode` handler from Task 4.

- [ ] **Step 1: Create `web/src/components/UpNextOverlay.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import type { Episode } from '../types';

interface UpNextOverlayProps {
  open: boolean;
  showTitle: string;
  nextEpisode: Episode;
  /** Total countdown length in seconds. Default 10. */
  countdownSec?: number;
  onPlayNow(): void;
  onCancel(): void;
}

export function UpNextOverlay(p: UpNextOverlayProps) {
  const total = p.countdownSec ?? 10;
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!p.open) return;
    setElapsedMs(0);
    const start = performance.now();
    const interval = window.setInterval(() => {
      const e = performance.now() - start;
      setElapsedMs(e);
      if (e >= total * 1000) {
        clearInterval(interval);
        p.onPlayNow();
      }
    }, 100);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open, total]);

  if (!p.open) return null;

  const remaining = Math.max(0, Math.ceil((total * 1000 - elapsedMs) / 1000));
  const progress = Math.min(100, (elapsedMs / (total * 1000)) * 100);

  return (
    <Box
      sx={{
        position: 'fixed', left: 0, right: 0, bottom: 0,
        px: 4, py: 3,
        background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.75) 60%, rgba(0,0,0,0.2) 100%)',
        backdropFilter: 'blur(4px)',
        zIndex: 15,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={3} sx={{ maxWidth: 1200, mx: 'auto' }}>
        {p.nextEpisode.poster && (
          <Box
            component="img"
            src={p.nextEpisode.poster}
            alt=""
            sx={{ width: 200, height: 112, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        )}
        <Box sx={{ flex: 1, color: 'common.white' }}>
          <Typography variant="caption" sx={{ opacity: 0.7, letterSpacing: 1.5, textTransform: 'uppercase' }}>
            Up next · {p.showTitle}
          </Typography>
          <Typography variant="h5" sx={{ mt: 0.5, fontWeight: 600 }}>
            S{p.nextEpisode.season}·E{p.nextEpisode.episode} · {p.nextEpisode.title}
          </Typography>
          {p.nextEpisode.synopsis && (
            <Typography variant="body2" sx={{ mt: 0.75, opacity: 0.85, maxWidth: 700 }}>
              {p.nextEpisode.synopsis}
            </Typography>
          )}
        </Box>
        <Box sx={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
          <CircularProgress
            variant="determinate"
            value={progress}
            size={64}
            thickness={4}
            sx={{ color: 'primary.main' }}
          />
          <Box
            sx={{
              position: 'absolute', inset: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'common.white', fontWeight: 600, fontSize: 20,
            }}
          >
            {remaining}
          </Box>
        </Box>
        <Stack spacing={1} sx={{ flexShrink: 0 }}>
          <Button variant="contained" onClick={p.onPlayNow}>Play now</Button>
          <Button variant="text" sx={{ color: 'common.white' }} onClick={p.onCancel}>Cancel</Button>
        </Stack>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Modify `web/src/views/Player.tsx` — end-of-stream watcher + overlay mount**

Add import (grouped with other component imports):

```ts
import { UpNextOverlay } from '../components/UpNextOverlay';
```

Add a state and a ref, immediately after the existing `queue` state added in Task 4:

```ts
const [upNextOpen, setUpNextOpen] = useState(false);
const endReachedRef = useRef(false);
```

Reset `endReachedRef` and `upNextOpen` when the current media changes. Extend the existing `[source, id]` reset effect (or add a new one):

```ts
useEffect(() => {
  endReachedRef.current = false;
  setUpNextOpen(false);
}, [source, id]);
```

Wire end-of-stream detection into the existing 250ms poll interval (currently around lines 145-169). Locate the `useEffect` that starts with `const t = window.setInterval(() => {`. Inside that interval callback, after the existing `setPos(...)` call, add:

```ts
const p = a ? sessionBaseRef.current + a.currentTime() : 0;
const dur = resolutionRef.current?.durationSec ?? 0;
if (
  !endReachedRef.current &&
  startedRef.current &&
  !paused &&
  dur > 0 &&
  p >= dur - 0.5
) {
  endReachedRef.current = true;
  const q = queue;
  if (q && q.currentIndex + 1 < q.episodes.length) {
    setUpNextOpen(true);
  } else {
    // No queue OR at last episode — navigate back to browse (or item detail).
    if (window.history.length > 1) window.history.back();
    else navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(id)}`);
  }
}
```

(Note: `p` here is a local const, not the component's `pos` state — using the ref-derived value is more accurate than reading state inside the interval closure.)

To make the `queue` state available inside the interval closure without stale-closure bugs, add `queue`, `paused`, and `source`, `id` to the effect's dependency array:

```ts
}, [source, id, queue, paused]);
```

If `paused` in the dep array causes the interval to be torn down/recreated on every pause toggle (which is wasteful), use a ref to hold `paused` and read `pausedRef.current` inside the interval instead. But for simplicity and correctness, the dependency-array approach is fine — the interval fires every 250ms; a paused-transition-triggered restart of the interval is invisible to the user.

Mount the overlay at the end of the returned JSX, just after the `<PlayerErrorDialog>` mount added in Task 3:

```tsx
{queue && queue.currentIndex + 1 < queue.episodes.length && (
  <UpNextOverlay
    open={upNextOpen}
    showTitle={queue.showTitle}
    nextEpisode={queue.episodes[queue.currentIndex + 1]!}
    onPlayNow={() => {
      setUpNextOpen(false);
      goToEpisode(queue.currentIndex + 1);
    }}
    onCancel={() => {
      setUpNextOpen(false);
      if (window.history.length > 1) window.history.back();
      else navigate(`/item/${encodeURIComponent(source)}/${encodeURIComponent(queue.showId)}`);
    }}
  />
)}
```

- [ ] **Step 3: Verify build passes**

```bash
npm --prefix C:/github/canvas/web run build
```

Expected: exits 0.

- [ ] **Step 4: Manual smoke test**

Start dev server. Navigate to a multi-episode TV show. Click an episode. Seek to the last 30 seconds using the scrub bar. Verify:
- When playback reaches end (within ~0.5s of duration), the `UpNextOverlay` mounts at the bottom of the screen.
- Poster, "Up next · {show}", `S{n}·E{n} · {episode title}` all render correctly.
- Circular countdown starts at 10 and decrements each second.
- At t+10s, next episode auto-loads.
- Repeat, but this time click **Cancel** before the countdown completes → overlay disappears, navigates back to ItemDetail.
- Repeat, click **Play now** → next episode loads immediately.
- Play the LAST episode of the LAST season, seek to end → overlay does NOT appear; player navigates back to ItemDetail.
- Play a movie, seek to end → no overlay (no queue).

- [ ] **Step 5: Commit**

```bash
cd C:/github/canvas
git add web/src/components/UpNextOverlay.tsx web/src/views/Player.tsx
git commit -m "feat: autoplay next episode with countdown overlay"
```

---

## After all tasks — release

- [ ] **Step 1: In-vehicle validation**

Deploy the branch to your canvas instance (or run dev-server + Cloudflare Quick Tunnel + open the URL on the in-car browser). Run through:
- Full TV binge session: pick a multi-season show, start an episode, watch Next/Prev buttons work, watch the UpNext overlay fire at end-of-episode, watch autoplay advance across a season boundary.
- Deliberate error injection: navigate to a non-existent media ID; verify the error dialog looks right on the in-car display.

- [ ] **Step 2: Tag and publish v0.9.0**

```bash
cd C:/github/canvas
git tag -a v0.9.0 -m "canvas v0.9.0 — TV binge UX + error dialog"
git push origin v0.9.0
```

Watch the publish workflow at https://github.com/bleichroeder/canvas/actions. Once green, `ghcr.io/bleichroeder/canvas:latest` picks up v0.9.0 and Watchtower rolls installations forward within ~5 minutes.

- [ ] **Step 3: Update project memory**

Update `project_canvas.md` at `C:\Users\David\.claude\projects\C--code\memory\project_canvas.md`: bump latest release to v0.9.0, add "N: Player + TV UX bundle" to the completed sub-projects list.

---

## Self-review

**Spec coverage:**
- Feature 1 (season tabs) → Task 1.
- Feature 2 (queue + autoplay + next/prev) → Tasks 4 and 5.
- Feature 3 (kebab menu + diagnostics move) → Task 2.
- Feature 4 (error dialog) → Task 3.
- Non-goals held (no new source, no transient-error snackbar, no keyboard shortcuts, no credit-detection, no DiagnosticsOverlay refactor).

**Placeholder scan:** No TBDs, TODOs, or "implement later" outside of the explicit "Menu is structured to accept future items" design note in Task 2 (which is a real design decision, not a placeholder).

**Type consistency:**
- `Episode` used consistently across `season-grouping.ts`, `playback-queue.ts`, `UpNextOverlay.tsx`, and the modified views — always the same type imported from `web/src/types.ts`.
- `PlaybackQueue` shape identical in the module definition (Task 4) and its consumers.
- `QueueControlProps` used consistently between `PlayerControls.tsx` and `Player.tsx`.
- `PlayerErrorDialog` prop set consistent between component and Player mount.

**Spec deviation to flag:** The spec (as amended before plan-writing) explicitly aligned the testing section with the project's no-test practice. No E2E, no unit tests. Per-task verification is `npm --prefix web run build` + manual dev-server QA. This is deliberate, not an oversight.

**Cross-file coordination:** Tasks 2 and 4 both modify `PlayerControls.tsx` in different regions (kebab menu = far-right of the control bar cluster; Prev/Next = flanking the play/pause cluster). Tasks 3, 4, 5 all modify `Player.tsx` in different regions (dialog mount = bottom of JSX; queue state + handlers = mid-component; end-of-stream watcher = inside the 250ms interval). Running the tasks sequentially avoids conflict; running them out of order would require the subagent to re-read the current file state before each edit.
