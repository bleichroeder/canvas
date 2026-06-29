# canvas UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the tvOS-feel design from `docs/superpowers/specs/2026-06-28-ui-overhaul-design.md` to canvas — overhauling AppShell, Home, and Settings while leaving Player/Library/SignIn untouched.

**Architecture:** Theme tokens + 5 new shared components + 4 new Settings tab files. No structural changes (routes, data flow, storage, auth unchanged). Verification is visual — canvas has no frontend test harness; each task ends with `npm run build` clean + a `npm run dev` visual check + a commit.

**Tech Stack:** React 18 + MUI v6 (theme + components), Inter font (already loaded), pure CSS for motion, hash router (unchanged), Supabase (unchanged).

## Global Constraints

These bind every task. The reviewer's attention lens.

- **No `backdrop-filter`** in new or modified code. Use `rgba()` alphas instead.
- **Tesla browser is primary.** Touch is the assumed input; desktop is "make it work."
- **Restrained motion budget.** Transitions: 150ms / 220ms / 320ms only. Transforms limited to `translate`, `scale`. No parallax, no per-frame JS animation.
- **No new runtime dependencies.** Everything composes from MUI v6 + Inter + CSS.
- **`<canvas>` wordmark**: `<` and `>` in `primary.main` (`#4f8ef7`), `canvas` in `text.primary` — applied at every wordmark site.
- **Out of scope (do not touch):** `views/Library.tsx`, `views/ItemDetail.tsx`, `views/Player.tsx`, `views/SignIn.tsx` (other than wordmark color), `components/NowPlayingStrip.tsx`, `components/CloudSyncConflict.tsx`, the `worker/`, API contract, storage shape, Supabase schema.
- **Build budget:** new components add ≤ +30 KB minified (~+8 KB gzip) to the bundle. Existing is ~955 KB / 274 KB gzip.
- **Verification gate:** after Task 10, deploy preview and check on a real Tesla. No merging until that's green.

## File Structure

**Modified (11):**
- `web/src/theme.ts` — new surface tier, motion tokens, MUI overrides (Task 1)
- `web/src/views/SignIn.tsx` — wordmark bracket color (Task 2)
- `web/index.html` — splash wordmark bracket color (Task 2)
- `web/src/components/AppShell.tsx` — wordmark color + hero-aware transparency + touch targets + breadcrumbs (Tasks 2, 7)
- `web/src/components/Breadcrumbs.tsx` — drop bottom border (folded into toolbar) (Task 7)
- `web/src/components/Rail.tsx` — new defaults + integrate L/R nav (Task 5)
- `web/src/components/PosterCard.tsx` — drop backdrop-filter, width default 220 (Task 4)
- `web/src/components/SourcePickerCard.tsx` — wrap with ElevatedCard (Task 8)
- `web/src/components/LibraryCard.tsx` — wrap with ElevatedCard (Task 8)
- `web/src/views/Home.tsx` — Hero, ambient gradient, brand-hero fallback, pass heroHeight (Task 8)
- `web/src/views/Settings.tsx` — refactor into tab shell (Task 9)

**Created (9):**
- `web/src/components/SectionHeading.tsx` (Task 3)
- `web/src/components/ElevatedCard.tsx` (Task 3)
- `web/src/components/SettingRow.tsx` (Task 3)
- `web/src/components/RailNavButton.tsx` (Task 5)
- `web/src/components/Hero.tsx` (Task 6)
- `web/src/views/settings/AccountTab.tsx` (Task 9)
- `web/src/views/settings/SourcesTab.tsx` (Task 9)
- `web/src/views/settings/PlaybackTab.tsx` (Task 9)
- `web/src/views/settings/AboutTab.tsx` (Task 9)

---

## Task 1: Theme tokens — surface tier, motion, ambient gradient

**Files:**
- Modify: `web/src/theme.ts`

**Interfaces:**
- Consumes: none (foundational)
- Produces:
  - `theme.palette.surface.elevated`: `string` — `#22252d`, consumed by `ElevatedCard` (Task 3)
  - `theme.canvasMotion`: `{ fast: '150ms', med: '220ms', slow: '320ms', easing: 'cubic-bezier(0.2, 0, 0, 1)' }` — consumed by all motion code
  - `theme.canvasAmbient`: `string` — CSS background-image value for the page ambient gradient, consumed by Home (Task 8) and Settings (Task 9)
  - MUI overrides for `MuiCardActionArea` (scale 1.03 hover / 0.97 active) and `MuiButton` (scale 0.97 active)
  - `background.paper` value changes from `#181a1f` to `#1c1f25`

- [ ] **Step 1: Open `web/src/theme.ts` and read current contents**

Confirm baseline: `palette.mode: 'dark'`, `palette.primary.main: '#4f8ef7'`, `palette.background.default: '#0e0f12'`, `palette.background.paper: '#181a1f'`, existing `MuiCardActionArea` override uses `translateY(-2px)` on hover.

- [ ] **Step 2: Extend MUI's Palette type via module augmentation**

At the top of `theme.ts`, after the imports, add:

```ts
declare module '@mui/material/styles' {
  interface Palette {
    surface: { elevated: string };
  }
  interface PaletteOptions {
    surface?: { elevated: string };
  }
  interface Theme {
    canvasMotion: { fast: string; med: string; slow: string; easing: string };
    canvasAmbient: string;
  }
  interface ThemeOptions {
    canvasMotion?: { fast: string; med: string; slow: string; easing: string };
    canvasAmbient?: string;
  }
}
```

- [ ] **Step 3: Update palette + add new tokens**

In the `createTheme` call:

- Change `background.paper` from `'#181a1f'` to `'#1c1f25'`
- Add to `palette`: `surface: { elevated: '#22252d' }`
- Add as top-level theme keys:
  ```ts
  canvasMotion: {
    fast: '150ms',
    med: '220ms',
    slow: '320ms',
    easing: 'cubic-bezier(0.2, 0, 0, 1)',
  },
  canvasAmbient:
    'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.06), transparent 60%)',
  ```

- [ ] **Step 4: Replace `MuiCardActionArea` hover override**

Find the existing `MuiCardActionArea` styleOverrides root and replace with:

```ts
MuiCardActionArea: {
  styleOverrides: {
    root: {
      transition: 'transform 220ms cubic-bezier(0.2,0,0,1), box-shadow 220ms cubic-bezier(0.2,0,0,1)',
      '&:hover': {
        transform: 'scale(1.03)',
      },
      '&:active': {
        transform: 'scale(0.97)',
        transition: 'transform 150ms cubic-bezier(0.2,0,0,1)',
      },
      '&.Mui-focusVisible': {
        outline: '2px solid #4f8ef7',
        outlineOffset: 4,
      },
    },
  },
},
```

(The `:has(.MuiCardActionArea-root:hover)` block under `MuiCard` should be removed since the action area itself now handles motion.)

- [ ] **Step 5: Add `MuiButton` active-press override**

Inside the existing `MuiButton` styleOverrides root:

```ts
MuiButton: {
  defaultProps: { disableElevation: true },
  styleOverrides: {
    root: {
      textTransform: 'none',
      transition: 'transform 150ms cubic-bezier(0.2,0,0,1)',
      '&:active': {
        transform: 'scale(0.97)',
      },
    },
  },
},
```

- [ ] **Step 6: Drop typography h2 size**

Change `h2: { fontSize: 32, fontWeight: 600, letterSpacing: '0.5px' }` → `h2: { fontSize: 28, fontWeight: 600, letterSpacing: '0.5px' }`.

- [ ] **Step 7: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
```

Expected: `✓ built in ~4s`, no TypeScript errors. Bundle size near baseline (theme tokens add < 1 KB).

```bash
cd C:/github/passenger/web && npm run dev
```

Open `http://localhost:5173/`. Sign in. Verify:
- Existing screens render with the new (slightly lighter) paper background
- Card hover on Home rails uses `scale(1.03)` instead of `translateY(-2px)`
- Button presses scale down slightly
- Nothing visually broken

- [ ] **Step 8: Commit**

```bash
git add web/src/theme.ts
git commit -m "ui-overhaul/theme: surface tier, motion tokens, ambient gradient

- Add palette.surface.elevated, canvasMotion, canvasAmbient
- Lift background.paper #181a1f -> #1c1f25
- MuiCardActionArea: scale(1.03)/0.97 with motion tokens (was translateY)
- MuiButton: scale(0.97) on active
- h2 typography: 32 -> 28
- Module-augment Palette/Theme types for the new tokens"
```

---

## Task 2: Wordmark brackets in primary blue

**Files:**
- Modify: `web/src/views/SignIn.tsx:80-95` (the `<canvas>` Typography block)
- Modify: `web/src/components/AppShell.tsx:60` (the wordmark inside Toolbar)
- Modify: `web/index.html:34` (splash wordmark)

**Interfaces:**
- Consumes: `theme.palette.primary.main` (already #4f8ef7)
- Produces: visual change only

- [ ] **Step 1: Update SignIn wordmark**

Find in `web/src/views/SignIn.tsx` the Typography block currently rendering `{'<canvas>'}`. Replace its children with:

```tsx
<Typography
  component="h1"
  sx={{
    fontSize: 40,
    fontWeight: 500,
    letterSpacing: '4px',
    lineHeight: 1,
    mb: 4,
    textAlign: 'center',
    color: 'text.primary',
  }}
>
  <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
  canvas
  <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
</Typography>
```

Ensure `Box` is imported (it already is in this file).

- [ ] **Step 2: Update AppShell wordmark**

Find in `web/src/components/AppShell.tsx` the Typography rendering `{'<canvas>'}` (around line 60). Replace its children with:

```tsx
<Typography
  variant="h2"
  component="a"
  href="#/"
  onClick={(e) => { e.preventDefault(); navigate('/'); }}
  sx={{
    fontSize: 24, fontWeight: 500, letterSpacing: '1.5px',
    color: 'text.primary', textDecoration: 'none', cursor: 'pointer',
    mr: 'auto',
  }}
>
  <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
  canvas
  <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
</Typography>
```

(Also bumps `letter-spacing` from 1 → 1.5 per Section 2 of the spec.)

Ensure `Box` is imported (`import Box from '@mui/material/Box'` is already present).

- [ ] **Step 3: Update splash wordmark in index.html**

In `web/index.html`, change line 34 from:

```html
<div id="canvas-splash"><div id="canvas-splash-wordmark">&lt;canvas&gt;</div></div>
```

to:

```html
<div id="canvas-splash"><div id="canvas-splash-wordmark"><span class="canvas-splash-bracket">&lt;</span>canvas<span class="canvas-splash-bracket">&gt;</span></div></div>
```

Then inside the `<style>` block in `<head>`, after the `@keyframes` rule, add:

```css
.canvas-splash-bracket { color: #4f8ef7; }
```

- [ ] **Step 4: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
```

Expected: clean build, no TypeScript errors.

```bash
cd C:/github/passenger/web && npm run dev
```

Verify in browser:
- `http://localhost:5173/#/sign-in` — brackets are blue (#4f8ef7), `canvas` is white
- Any signed-in page top bar — brackets are blue at the smaller 24px size
- Hard-refresh and watch the splash before it fades — brackets are blue

- [ ] **Step 5: Commit**

```bash
git add web/src/views/SignIn.tsx web/src/components/AppShell.tsx web/index.html
git commit -m "ui-overhaul/wordmark: syntax-color the angle brackets

<canvas> renders with < and > in primary blue (#4f8ef7) at every wordmark
site: SignIn (40px), AppShell top bar (24px, letter-spacing 1.5), and the
index.html splash. Reads like syntax highlighting in a code editor."
```

---

## Task 3: SectionHeading + ElevatedCard + SettingRow

**Files:**
- Create: `web/src/components/SectionHeading.tsx`
- Create: `web/src/components/ElevatedCard.tsx`
- Create: `web/src/components/SettingRow.tsx`

**Interfaces:**
- Consumes: `theme.palette.surface.elevated`, `theme.canvasMotion` (from Task 1)
- Produces:
  - `SectionHeading({ title, action?, sx? })` — h2 + optional right-side action slot
  - `ElevatedCard({ children, variant?, onClick?, sx? })` — surface card; variant `'static' | 'interactive'`
  - `SettingRow({ label, secondary?, control?, divider? })` — Settings row primitive

- [ ] **Step 1: Create `SectionHeading.tsx`**

```tsx
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

interface SectionHeadingProps {
  title: string;
  action?: ReactNode;
  sx?: SxProps<Theme>;
}

export function SectionHeading({ title, action, sx }: SectionHeadingProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        px: 2.5,
        mt: 4,
        mb: 2,
        ...sx,
      }}
    >
      <Typography variant="h2" sx={{ m: 0 }}>{title}</Typography>
      {action && <Box>{action}</Box>}
    </Box>
  );
}
```

- [ ] **Step 2: Create `ElevatedCard.tsx`**

```tsx
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import type { SxProps, Theme } from '@mui/material/styles';

interface ElevatedCardProps {
  children: ReactNode;
  variant?: 'static' | 'interactive';
  onClick?: () => void;
  sx?: SxProps<Theme>;
}

const cardSx: SxProps<Theme> = (theme) => ({
  display: 'block',
  width: '100%',
  backgroundColor: theme.palette.surface.elevated,
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 2,
  boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
  textAlign: 'left',
  color: 'inherit',
});

export function ElevatedCard({ children, variant = 'static', onClick, sx }: ElevatedCardProps) {
  if (variant === 'interactive') {
    return (
      <ButtonBase
        onClick={onClick}
        sx={(theme) => ({
          ...(cardSx as (t: Theme) => object)(theme),
          transition: `transform ${theme.canvasMotion.med} ${theme.canvasMotion.easing}, box-shadow ${theme.canvasMotion.med} ${theme.canvasMotion.easing}`,
          '&:hover': {
            transform: 'scale(1.03)',
            boxShadow: '0 24px 56px rgba(0,0,0,0.55)',
          },
          '&:active': {
            transform: 'scale(0.97)',
            transition: `transform ${theme.canvasMotion.fast} ${theme.canvasMotion.easing}`,
          },
          '&.Mui-focusVisible': {
            outline: '2px solid #4f8ef7',
            outlineOffset: 4,
          },
          ...(sx ?? {}),
        })}
      >
        {children}
      </ButtonBase>
    );
  }
  return <Box sx={[cardSx, ...(Array.isArray(sx) ? sx : [sx])].filter(Boolean) as SxProps<Theme>}>{children}</Box>;
}
```

- [ ] **Step 3: Create `SettingRow.tsx`**

```tsx
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

interface SettingRowProps {
  label: string;
  secondary?: string;
  control?: ReactNode;
  divider?: boolean;
}

export function SettingRow({ label, secondary, control, divider = true }: SettingRowProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        minHeight: 56,
        py: 2.25,
        px: 2.5,
        borderBottom: divider ? '1px solid rgba(255,255,255,0.06)' : 'none',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontWeight: 500, fontSize: 15 }}>{label}</Typography>
        {secondary && (
          <Typography sx={{ mt: 0.25, fontSize: 12, color: 'text.secondary' }}>{secondary}</Typography>
        )}
      </Box>
      {control && <Box sx={{ flexShrink: 0 }}>{control}</Box>}
    </Box>
  );
}
```

- [ ] **Step 4: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
```

Expected: clean build. Components aren't consumed yet, so the running app is unchanged — this is a build-only checkpoint.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/SectionHeading.tsx web/src/components/ElevatedCard.tsx web/src/components/SettingRow.tsx
git commit -m "ui-overhaul/components: SectionHeading, ElevatedCard, SettingRow

Three shared building blocks the rest of the overhaul composes from:
- SectionHeading: h2 + optional right-side action slot, consistent margins
- ElevatedCard: tvOS-style elevated surface, static or interactive variant
- SettingRow: label/secondary on the left, control on the right, divider"
```

---

## Task 4: PosterCard cleanup — drop backdrop-filter, width default 220

**Files:**
- Modify: `web/src/components/PosterCard.tsx:97-99, 119-121, 13, 26`

**Interfaces:**
- Consumes: none new
- Produces: behavior change — default `width` is 220 (was 180); CC badge and rating badge use solid alpha instead of blur

- [ ] **Step 1: Update PosterCard default width**

In `web/src/components/PosterCard.tsx`, change the `width = 180` default in the function signature to `width = 220`:

```tsx
export function PosterCard({ item, source, width = 220, showSourceBadge = false }: PosterCardProps) {
```

- [ ] **Step 2: Drop backdrop-filter on CC badge**

Find the CC badge `Box` (currently around lines 92-110). Change its `backgroundColor` from `'rgba(0,0,0,0.7)'` to `'rgba(0,0,0,0.78)'` and remove the line `backdropFilter: 'blur(4px)',`. Final sx for that Box:

```tsx
sx={{
  position: 'absolute',
  bottom: 6, left: 6,
  height: 20, px: 0.625,
  borderRadius: 0.5,
  backgroundColor: 'rgba(0,0,0,0.78)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 700,
  fontSize: 10,
  letterSpacing: 0.5,
  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
}}
```

- [ ] **Step 3: Drop backdrop-filter on rating badge**

Find the rating badge `Box` (currently around lines 113-132). Change `backgroundColor` from `'rgba(0,0,0,0.7)'` to `'rgba(0,0,0,0.78)'` and remove the line `backdropFilter: 'blur(4px)',`. Final sx:

```tsx
sx={{
  position: 'absolute',
  bottom: 6, right: 6,
  height: 20, px: 0.75,
  borderRadius: 0.5,
  backgroundColor: 'rgba(0,0,0,0.78)',
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 0.25,
  fontWeight: 600,
  fontSize: 10,
  boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
}}
```

- [ ] **Step 4: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
```

```bash
cd C:/github/passenger/web && npm run dev
```

Open Home. Verify:
- Poster cards are 220px wide (visibly larger than before)
- CC and rating badges still render with dark backgrounds, no transparency-bleed
- No console errors

- [ ] **Step 5: Grep-check for any remaining backdrop-filter**

```bash
grep -rn "backdrop-filter\|backdropFilter" C:/github/passenger/web/src C:/github/passenger/web/index.html
```

Expected output: empty. If anything appears, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/PosterCard.tsx
git commit -m "ui-overhaul/poster: drop backdrop-filter, default width 220

Tesla MCU3 lags on backdrop-filter — swap the CC and rating badge blurs
for solid rgba(0,0,0,0.78). Same readability, zero perf cost. Default
width bumped 180 -> 220 to match the new tvOS-scale rails."
```

---

## Task 5: RailNavButton + Rail upgrade

**Files:**
- Create: `web/src/components/RailNavButton.tsx`
- Modify: `web/src/components/Rail.tsx`

**Interfaces:**
- Consumes: `theme.canvasMotion`, `useMediaQuery` from `@mui/material`
- Produces:
  - `RailNavButton({ direction, onClick, disabled })` — internal, used only by Rail
  - `Rail` defaults change: `cardWidth = 220` (was 180), inner gap 1.5 → 2.5

- [ ] **Step 1: Create `RailNavButton.tsx`**

```tsx
import IconButton from '@mui/material/IconButton';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

interface RailNavButtonProps {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
}

export function RailNavButton({ direction, onClick, disabled }: RailNavButtonProps) {
  const Icon = direction === 'left' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <IconButton
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === 'left' ? 'Scroll left' : 'Scroll right'}
      sx={{
        position: 'absolute',
        top: '50%',
        [direction === 'left' ? 'left' : 'right']: 4,
        transform: 'translateY(-50%)',
        width: 40,
        height: 40,
        backgroundColor: 'rgba(14,15,18,0.85)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'text.primary',
        opacity: disabled ? 0 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        transition: 'opacity 220ms cubic-bezier(0.2,0,0,1), transform 220ms cubic-bezier(0.2,0,0,1)',
        '&:hover': {
          backgroundColor: 'rgba(14,15,18,0.95)',
          transform: 'translateY(-50%) scale(1.05)',
        },
        zIndex: 2,
      }}
    >
      <Icon />
    </IconButton>
  );
}
```

- [ ] **Step 2: Upgrade `Rail.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import useMediaQuery from '@mui/material/useMediaQuery';
import { SectionHeading } from './SectionHeading';
import { PosterCard } from './PosterCard';
import { RailNavButton } from './RailNavButton';
import type { Item } from '../types';

export interface RailProps {
  title: string;
  items: (Item & { source: string })[];
  cardWidth?: number;
  showSourceBadge?: boolean;
}

const GAP_PX = 20; // matches sx gap: 2.5 (8 * 2.5)

export function Rail({ title, items, cardWidth = 220, showSourceBadge = false }: RailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const hasFineHover = useMediaQuery('(hover: hover) and (pointer: fine)');

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', update);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [items.length]);

  if (items.length === 0) return null;

  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (cardWidth + GAP_PX) * 3, behavior: 'smooth' });
  };

  return (
    <Box component="section" sx={{ mb: 4 }}>
      <SectionHeading title={title} sx={{ mt: 4, mb: 1.5 }} />
      <Box sx={{ position: 'relative' }}>
        <Box
          ref={scrollerRef}
          sx={{
            display: 'flex',
            gap: 2.5,
            overflowX: 'auto',
            px: 2.5,
            py: 1,
            scrollPaddingLeft: 20,
            scrollSnapType: 'x mandatory',
            '&::-webkit-scrollbar': { display: 'none' },
          }}
        >
          {items.map((it) => (
            <Box key={`${it.source}:${it.id}`} sx={{ scrollSnapAlign: 'start', contain: 'layout style' }}>
              <PosterCard item={it} source={it.source} width={cardWidth} showSourceBadge={showSourceBadge} />
            </Box>
          ))}
        </Box>
        {hasFineHover && (
          <>
            <RailNavButton direction="left" onClick={() => scrollBy(-1)} disabled={!canScrollLeft} />
            <RailNavButton direction="right" onClick={() => scrollBy(1)} disabled={!canScrollRight} />
          </>
        )}
      </Box>
    </Box>
  );
}
```

Note: the section heading is now rendered by `SectionHeading` (which provides `mt: 4, mb: 2` by default — we override `mb: 1.5` here to match the original tighter title-to-rail spacing).

- [ ] **Step 3: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
cd C:/github/passenger/web && npm run dev
```

Open Home in a desktop browser (mouse + hover):
- Rail cards are wider (220px), more gap between them
- L/R nav buttons appear at the rail edges when overflowing
- Right button disabled when at start; left button disabled when scrolled to end
- Click right → smooth scroll, three cards' worth
- Section headings use the new h2 size (28px)

Open Home in a phone DevTools emulator (or actual phone):
- L/R buttons hidden entirely
- Touch swipe still scrolls with snap

- [ ] **Step 4: Commit**

```bash
git add web/src/components/RailNavButton.tsx web/src/components/Rail.tsx
git commit -m "ui-overhaul/rails: L/R nav buttons on desktop, larger defaults

- New RailNavButton: 40px circular, edge-positioned, fades in only on
  '(hover: hover) and (pointer: fine)' so touch surfaces stay clean
- Rail defaults: cardWidth 180 -> 220, gap 1.5 -> 2.5
- Use SectionHeading for the rail title (consistent h2 across Home)
- CSS containment on the card wrapper (Tesla perf)
- scroll listener throttled via requestAnimationFrame"
```

---

## Task 6: Hero component

**Files:**
- Create: `web/src/components/Hero.tsx`

**Interfaces:**
- Consumes: none new
- Produces: `Hero({ backdropUrl?, eyebrow?, title, meta?, primaryAction, secondaryAction?, onHeightChange? })` — full-bleed hero, ~55vh tall, with three gradient overlays

- [ ] **Step 1: Create `Hero.tsx`**

```tsx
import { useEffect, useRef } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import type { ReactNode } from 'react';

export interface HeroAction {
  label: string;
  onClick: () => void;
}

export interface HeroProps {
  backdropUrl?: string;
  eyebrow?: string;
  title: string;
  meta?: ReactNode;
  primaryAction: HeroAction;
  secondaryAction?: HeroAction;
  onHeightChange?: (px: number) => void;
}

export function Hero({
  backdropUrl,
  eyebrow,
  title,
  meta,
  primaryAction,
  secondaryAction,
  onHeightChange,
}: HeroProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onHeightChange) return;
    const el = ref.current;
    if (!el) return;
    const report = () => onHeightChange(el.getBoundingClientRect().height);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onHeightChange]);

  return (
    <Box
      ref={ref}
      sx={{
        position: 'relative',
        height: 'min(55vh, 720px)',
        minHeight: 360,
        mb: 3,
        overflow: 'hidden',
        backgroundColor: backdropUrl ? '#0e0f12' : 'transparent',
        backgroundImage: backdropUrl
          ? `url(${backdropUrl})`
          : 'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.12), transparent 60%)',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      {/* Left-to-right readability overlay */}
      {backdropUrl && (
        <Box
          sx={{
            position: 'absolute', inset: 0,
            background:
              'linear-gradient(to right, rgba(14,15,18,0.95) 0%, rgba(14,15,18,0.7) 40%, rgba(14,15,18,0.2) 70%, transparent 100%)',
          }}
        />
      )}
      {/* Top fade so transparent AppShell stays legible */}
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 80,
          background: 'linear-gradient(to bottom, rgba(14,15,18,0.6) 0%, transparent 100%)',
        }}
      />
      {/* Bottom feather into rails */}
      <Box
        sx={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 80,
          background: 'linear-gradient(to top, #0e0f12 0%, transparent 100%)',
        }}
      />
      {/* Content */}
      <Box
        sx={{
          position: 'absolute',
          left: { xs: 24, sm: 48 },
          top: 0, bottom: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          maxWidth: 560,
          zIndex: 1,
        }}
      >
        {eyebrow && (
          <Typography
            variant="caption"
            sx={{
              color: 'text.secondary',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              mb: 1,
            }}
          >
            {eyebrow}
          </Typography>
        )}
        <Typography sx={{ fontSize: 56, fontWeight: 600, lineHeight: 1.05, mb: 1.5 }}>
          {title}
        </Typography>
        {meta && (
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>
            {meta}
          </Typography>
        )}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={primaryAction.onClick}
            sx={{ py: 1.25, px: 3, fontSize: 15, fontWeight: 600 }}
          >
            {primaryAction.label}
          </Button>
          {secondaryAction && (
            <Button
              variant="text"
              size="large"
              onClick={secondaryAction.onClick}
              sx={{ py: 1.25, px: 2, fontSize: 14 }}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
```

Expected: clean build. Component isn't wired up yet — Home still uses the inline hero — so no visual change.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Hero.tsx
git commit -m "ui-overhaul/hero: full-bleed Hero component

55vh tall (min 360, max 720), three gradient overlays (L-R readability,
top fade for transparent AppShell, bottom feather into rails), eyebrow +
56px title + meta + primary/secondary actions. Reports its rendered
height via onHeightChange so AppShell can do the transparency math."
```

---

## Task 7: AppShell hero-aware transparency + touch targets + breadcrumbs

**Files:**
- Modify: `web/src/components/AppShell.tsx`
- Modify: `web/src/components/Breadcrumbs.tsx`

**Interfaces:**
- Consumes: `theme.canvasMotion` (Task 1)
- Produces:
  - `AppShell({ children, heroHeight? })` — pages pass `heroHeight` (px) when they have a hero; AppShell makes the top bar transparent until scrolled past `heroHeight - 56`
  - `RouteBreadcrumbs` returns a more compact, border-less list suitable for embedding in the toolbar

- [ ] **Step 1: Drop the bottom-border styling from `Breadcrumbs.tsx`**

Find the `<Breadcrumbs ... sx={{ px: 2.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>` line. Change the sx to remove the border (breadcrumbs are now inside the toolbar; the toolbar's own border handles the boundary):

```tsx
sx={{ py: 0.5 }}
```

- [ ] **Step 2: Rewrite `AppShell.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import SettingsIcon from '@mui/icons-material/Settings';
import { useRoute, navigate } from '../router';
import { RouteBreadcrumbs } from './Breadcrumbs';
import { useNowPlaying } from './NowPlayingStrip';

interface AppShellProps {
  children: ReactNode;
  heroHeight?: number;
}

export function AppShell({ children, heroHeight }: AppShellProps) {
  const route = useRoute();
  const isHome = route.path === '/';
  const nowPlaying = useNowPlaying();
  const mainPaddingBottom = nowPlaying ? '108px' : 0;

  // When a hero is present, top bar starts transparent and solidifies once
  // the user scrolls past it. Without a hero, the bar is always solid.
  const [pastHero, setPastHero] = useState(heroHeight === undefined);

  useEffect(() => {
    if (heroHeight === undefined) { setPastHero(true); return; }
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setPastHero(window.scrollY > heroHeight - 56);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [heroHeight]);

  const onBack = () => {
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  };

  return (
    <Box>
      <AppBar
        position="fixed"
        color="default"
        elevation={0}
        sx={(theme) => ({
          backgroundColor: pastHero ? 'rgba(14,15,18,0.92)' : 'rgba(14,15,18,0)',
          borderBottom: pastHero ? '1px solid' : '1px solid transparent',
          borderColor: 'divider',
          transition: `background-color ${theme.canvasMotion.med} ${theme.canvasMotion.easing}, border-color ${theme.canvasMotion.med} ${theme.canvasMotion.easing}`,
          backgroundImage: 'none',
        })}
      >
        <Toolbar variant="dense" sx={{ minHeight: 56, gap: 1.5, px: { xs: 2, sm: 2 } }}>
          {!isHome && (
            <IconButton
              onClick={onBack}
              edge="start"
              aria-label="back"
              sx={{ width: 48, height: 48 }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography
            variant="h2"
            component="a"
            href="#/"
            onClick={(e) => { e.preventDefault(); navigate('/'); }}
            sx={{
              fontSize: 24, fontWeight: 500, letterSpacing: '1.5px',
              color: 'text.primary', textDecoration: 'none', cursor: 'pointer',
            }}
          >
            <Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
            canvas
            <Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
          </Typography>
          <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', ml: 1 }}>
            <RouteBreadcrumbs />
          </Box>
          <IconButton onClick={() => navigate('/search')} aria-label="search" sx={{ width: 48, height: 48 }}>
            <SearchIcon />
          </IconButton>
          <IconButton onClick={() => navigate('/settings')} aria-label="settings" sx={{ width: 48, height: 48 }}>
            <SettingsIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      <Toolbar variant="dense" sx={{ minHeight: 56 }} />
      <Box component="main" sx={{ pb: mainPaddingBottom }}>{children}</Box>
    </Box>
  );
}
```

Key changes vs current:
- `position: 'sticky'` → `position: 'fixed'` (sticky doesn't compose well with a transparent-over-hero start state)
- A second invisible `<Toolbar>` after the AppBar reserves vertical space so content doesn't slide underneath when the bar is solid. For pages with a `heroHeight`, the hero needs to extend up under the bar — so the consuming page (Home) will give itself a negative top margin equal to 56px to compensate, *but only when it has a hero*. That coordination is documented in Task 8.
- Breadcrumbs moved inside the toolbar after the wordmark
- Wordmark now uses the `<canvas>` colored-bracket markup directly (Task 2 had it already)
- All toolbar `IconButton`s become 48×48
- `RouteBreadcrumbs` returns `null` when there's only "Home" so the breadcrumbs slot is empty on Home; the flex spacer keeps layout clean
- Transparent-on-hero math via scroll listener, throttled by rAF (Tesla perf rule #4)

- [ ] **Step 3: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
cd C:/github/passenger/web && npm run dev
```

Verify:
- `/` (Home) — top bar solid (Home doesn't pass heroHeight yet; that's Task 8); content not clipped by the bar
- `/settings` — top bar solid, breadcrumbs `Home › Settings` appear inline within the toolbar
- `/lib/<src>/<libId>` — top bar solid, breadcrumbs `Home › <source> › <library>` appear inline
- Icon buttons feel bigger and easier to hit
- `<canvas>` wordmark brackets blue (Task 2 verified, double-check)
- No console errors, no layout shift

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AppShell.tsx web/src/components/Breadcrumbs.tsx
git commit -m "ui-overhaul/appshell: hero-aware transparency, 48px touch targets, inline breadcrumbs

AppShell now accepts heroHeight; when provided, the top bar starts
transparent (rgba 0) and transitions to solid (rgba 0.92) once scrolled
past hero - 56. Scroll listener is rAF-throttled. Page-without-hero
behavior unchanged (bar solid from first paint).

- position: sticky -> position: fixed + spacer toolbar so chrome can
  overlap hero artwork without pushing content
- IconButtons 40 -> 48px
- Breadcrumbs folded into the toolbar instead of a separate row below
  (single row of chrome instead of two)
- Wordmark letter-spacing 1 -> 1.5"
```

---

## Task 8: Home — wire up Hero, ambient gradient, ElevatedCard for source/library cards

**Files:**
- Modify: `web/src/views/Home.tsx`
- Modify: `web/src/components/SourcePickerCard.tsx`
- Modify: `web/src/components/LibraryCard.tsx`

**Interfaces:**
- Consumes: `Hero`, `SectionHeading`, `ElevatedCard` (from earlier tasks), `theme.canvasAmbient` (Task 1)
- Produces: Home renders the new Hero (with fallback ladder), passes its measured height to AppShell, sits on the ambient gradient

- [ ] **Step 1: Update `SourcePickerCard.tsx`**

Open the file to find its current shell (a `Card` or `Box` with custom shadow/border). Wrap the actionable content with `ElevatedCard variant="interactive"`:

Replace whatever outer container exists with:

```tsx
import { ElevatedCard } from './ElevatedCard';
// ... other imports unchanged

export function SourcePickerCard({ srcKey, label, type, libraryCount, backdropUrl }: SourcePickerCardProps) {
  return (
    <ElevatedCard
      variant="interactive"
      onClick={() => navigate(`/source/${srcKey}`)}
      sx={{ overflow: 'hidden' }}
    >
      {/* existing inner content (backdrop image, type chip, label, count) */}
    </ElevatedCard>
  );
}
```

Remove any custom `border`, `borderRadius`, `boxShadow`, `transition`, or `&:hover` from the inner content's styles — `ElevatedCard` owns those now. Keep poster/backdrop rendering, type chip, label, and count exactly as they are.

(If `SourcePickerCard` currently uses MUI's `Card` + `CardActionArea`, replace the whole pair with the single `ElevatedCard variant="interactive"` wrapper.)

- [ ] **Step 2: Update `LibraryCard.tsx`**

Same pattern — wrap with `ElevatedCard variant="interactive"`, remove any duplicate elevation/border/hover styling from inner content. Keep the library icon/title/count rendering exactly as it is.

- [ ] **Step 3: Rewrite `Home.tsx`**

Replace the entire file with:

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import { useTheme } from '@mui/material/styles';
import { api } from '../api';
import { getSources } from '../storage';
import { AppShell } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { Hero } from '../components/Hero';
import { Rail } from '../components/Rail';
import { SectionHeading } from '../components/SectionHeading';
import { SourcePickerCard } from '../components/SourcePickerCard';
import { LibraryCard } from '../components/LibraryCard';
import { navigate } from '../router';
import type { HomeRow, Item } from '../types';

interface PerSourceError { source: string; status: number; message: string }

type State =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'ok'; rows: (HomeRow & { source: string })[]; errors: PerSourceError[]; libraryCounts: Record<string, number> }
  | { kind: 'error'; message: string };

function formatRuntime(sec?: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatPos(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Home() {
  const theme = useTheme();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [singleSourceLibraries, setSingleSourceLibraries] = useState<Item[]>([]);
  const [heroH, setHeroH] = useState<number | undefined>(undefined);
  const sources = getSources();
  const sourceCount = Object.keys(sources).length;
  const singleSourceKey = sourceCount === 1 ? Object.keys(sources)[0] : undefined;

  useEffect(() => {
    if (sourceCount === 0) {
      setState({ kind: 'empty' });
      return;
    }
    api.home().then(
      ({ rows, errors, libraryCounts }) => setState({ kind: 'ok', rows, errors, libraryCounts }),
      (e: Error) => setState({ kind: 'error', message: e.message }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!singleSourceKey) { setSingleSourceLibraries([]); return; }
    let cancelled = false;
    api.sourceHome(singleSourceKey).then(
      (data) => { if (!cancelled) setSingleSourceLibraries(data.libraries); },
      () => { /* libraries are nice-to-have; ignore failures */ },
    );
    return () => { cancelled = true; };
  }, [singleSourceKey]);

  // Hero source ladder: first Continue Watching with a backdrop, else first
  // Recently Added with a backdrop, else brand hero.
  const heroPick = (() => {
    if (state.kind !== 'ok') return undefined;
    for (const row of state.rows) {
      if (row.kind !== 'continue') continue;
      const it = row.items.find((i) => i.poster) as (Item & { source?: string }) | undefined;
      if (it) return { item: { ...it, source: row.source }, eyebrow: 'Continue Watching' };
    }
    for (const row of state.rows) {
      if (row.kind !== 'recent') continue;
      const it = row.items.find((i) => i.poster) as (Item & { source?: string }) | undefined;
      if (it) return { item: { ...it, source: row.source }, eyebrow: 'Recently Added' };
    }
    return undefined;
  })();

  return (
    <AppShell heroHeight={heroH}>
      <Box
        sx={{
          minHeight: '100vh',
          backgroundImage: theme.canvasAmbient,
          // Pull content up so the hero extends beneath the (transparent) top bar.
          mt: '-56px',
          pt: '56px',
        }}
      >
        {state.kind === 'loading' && (
          <Box sx={{ pt: 2.5 }}>
            <Box sx={{ mx: 2.5, mb: 3 }}>
              <Skeleton variant="rounded" sx={{ height: 'min(55vh, 720px)', minHeight: 360 }} />
            </Box>
            {[1, 2].map((i) => (
              <Box key={i} sx={{ mb: 4 }}>
                <Skeleton variant="text" width={220} height={36} sx={{ ml: 2.5, mb: 1.5 }} />
                <Box sx={{ display: 'flex', gap: 2.5, px: 2.5, overflow: 'hidden' }}>
                  {[1, 2, 3, 4, 5].map((j) => (
                    <Skeleton key={j} variant="rectangular" width={220} height={330} sx={{ flexShrink: 0, borderRadius: 1 }} />
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        )}

        {state.kind === 'empty' && (
          <Box sx={{ pt: 8 }}>
            <EmptyState
              icon={<LibraryAddOutlinedIcon />}
              title="No sources paired yet"
              body="Pair a Plex server to get started."
              actionLabel="Pair your first source"
              onAction={() => navigate('/settings/pair')}
            />
          </Box>
        )}

        {state.kind === 'error' && (
          <Alert severity="error" sx={{ mx: 2.5, mt: 10 }}>Error: {state.message}</Alert>
        )}

        {state.kind === 'ok' && (
          <>
            {heroPick ? (
              <Hero
                backdropUrl={heroPick.item.poster}
                eyebrow={heroPick.eyebrow}
                title={heroPick.item.title}
                meta={[heroPick.item.year, formatRuntime(heroPick.item.durationSec)].filter(Boolean).join(' · ') || undefined}
                primaryAction={{
                  label: heroPick.item.viewOffsetSec && heroPick.item.viewOffsetSec > 60
                    ? `Resume ${formatPos(heroPick.item.viewOffsetSec)}`
                    : 'Play',
                  onClick: () => navigate(`/play/${heroPick.item.source}/${heroPick.item.id}`),
                }}
                secondaryAction={heroPick.item.viewOffsetSec && heroPick.item.viewOffsetSec > 60
                  ? { label: 'Start over', onClick: () => navigate(`/play/${heroPick.item.source}/${heroPick.item.id}?from=0`) }
                  : undefined}
                onHeightChange={setHeroH}
              />
            ) : (
              <Hero
                eyebrow="canvas"
                title="Your library, on every screen."
                primaryAction={{ label: 'Pair a source', onClick: () => navigate('/settings/pair') }}
                onHeightChange={setHeroH}
              />
            )}

            {state.errors.length > 0 && (
              <Box sx={{ px: 2.5, pb: 2 }}>
                {state.errors.map((err) => (
                  <Alert key={err.source} severity="warning" sx={{ my: 0.5 }}>
                    {err.source}: {err.message}
                  </Alert>
                ))}
              </Box>
            )}

            {(() => {
              const continueItems: (Item & { source: string })[] = [];
              const recentItems: (Item & { source: string })[] = [];
              for (const row of state.rows) {
                const tagged = row.items.map((i: Item) => ({ ...i, source: row.source }));
                if (row.kind === 'continue') continueItems.push(...tagged);
                else if (row.kind === 'recent') recentItems.push(...tagged);
              }
              return (
                <>
                  {continueItems.length > 0 && (
                    <Rail title="Continue Watching" items={continueItems} showSourceBadge />
                  )}
                  {recentItems.length > 0 && (
                    <Rail title="Recently Added" items={recentItems} showSourceBadge />
                  )}
                </>
              );
            })()}

            {sourceCount === 1 && singleSourceKey && singleSourceLibraries.length > 0 && (
              <Box component="section">
                <SectionHeading title="Libraries" />
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, 240px)',
                    gap: 3,
                    px: 2.5,
                    pb: 4,
                  }}
                >
                  {singleSourceLibraries.map((lib) => (
                    <LibraryCard key={lib.id} library={lib} source={singleSourceKey} />
                  ))}
                </Box>
              </Box>
            )}

            {sourceCount > 1 && (() => {
              const backdrops: Record<string, string | undefined> = {};
              for (const row of state.rows) {
                if (row.kind !== 'recent') continue;
                if (backdrops[row.source]) continue;
                const firstWithPoster = row.items.find((i) => i.poster);
                if (firstWithPoster?.poster) backdrops[row.source] = firstWithPoster.poster;
              }
              return (
                <Box component="section">
                  <SectionHeading title="Your sources" />
                  <Box
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, 240px)',
                      gap: 3,
                      px: 2.5,
                      pb: 4,
                    }}
                  >
                    {Object.entries(sources).map(([key, src]) => (
                      <SourcePickerCard
                        key={key}
                        srcKey={key}
                        label={src.label}
                        type={src.type}
                        libraryCount={state.libraryCounts[key]}
                        backdropUrl={backdrops[key]}
                      />
                    ))}
                  </Box>
                </Box>
              );
            })()}

            {state.rows.length === 0 && state.errors.length === 0 && (
              <Typography color="text.secondary" sx={{ px: 2.5 }}>
                Your sources are paired but returned nothing yet.
              </Typography>
            )}
          </>
        )}
      </Box>
    </AppShell>
  );
}
```

Key behaviors:
- `AppShell heroHeight={heroH}` — `heroH` is set when Hero mounts, so the bar transitions to transparent
- `mt: '-56px', pt: '56px'` pulls content up under AppShell's spacer (so the hero starts at y=0 on screen)
- Brand-hero fallback uses the same `Hero` component, no backdrop, internal ambient gradient
- Rails use new defaults (220 cards, gap 2.5) — `Rail` defaults from Task 5 do the work
- Source / Library grids: cell 220 → 240, gap 2.5 → 3
- Skeleton heights mirror the new hero size

- [ ] **Step 4: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
cd C:/github/passenger/web && npm run dev
```

Sign in. Verify with at least one paired source that has Continue Watching content:
- Hero fills ~55% of the viewport (on a 1080px window, ~594px tall)
- Backdrop image, title 56px, eyebrow "Continue Watching"
- Top bar starts transparent over the hero — you can see the backdrop through it
- Scroll down past the hero → top bar smoothly turns solid with a bottom border
- Resume button + "Start over" both work
- Continue Watching rail renders below the hero with bigger cards + L/R nav (desktop)
- Source/library cards have the elevated surface tier, scale on hover
- Background has the subtle blue radial in the top-left

Empty state (delete sources via Settings or use a fresh account): brand hero shows with "Pair a source" CTA.

Error state (set Plex token to garbage to force a per-source error): warning alert renders below hero, content below alerts still shows.

- [ ] **Step 5: Commit**

```bash
git add web/src/views/Home.tsx web/src/components/SourcePickerCard.tsx web/src/components/LibraryCard.tsx
git commit -m "ui-overhaul/home: cinematic hero, ambient gradient, ElevatedCard cells

- Replace 320px inline hero with full-bleed Hero component (~55vh)
- Hero source ladder: Continue Watching with backdrop -> Recently Added
  with backdrop -> brand fallback ('Pair a source')
- Pass measured hero height to AppShell for transparent-over-hero math
- Page sits on theme.canvasAmbient (subtle blue radial top-left)
- SourcePickerCard + LibraryCard use ElevatedCard variant=interactive;
  drop their bespoke elevation/border/hover styles
- Grid cell 220 -> 240, gap 2.5 -> 3"
```

---

## Task 9: Settings tabs

**Files:**
- Create: `web/src/views/settings/AccountTab.tsx`
- Create: `web/src/views/settings/SourcesTab.tsx`
- Create: `web/src/views/settings/PlaybackTab.tsx`
- Create: `web/src/views/settings/AboutTab.tsx`
- Modify: `web/src/views/Settings.tsx` (becomes the tab shell)

**Interfaces:**
- Consumes: `ElevatedCard`, `SettingRow`, `SectionHeading` (Task 3); `EmptyState` (existing)
- Produces:
  - `AccountTab()` — email + sign-out + (disabled) Change password
  - `SourcesTab()` — sources list + Pair new source action
  - `PlaybackTab()` — autoplay / skip-intro / sub-lang / audio-lang
  - `AboutTab()` — version / engine / cloud-sync status / diagnostics accordion

- [ ] **Step 1: Create `views/settings/AccountTab.tsx`**

```tsx
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CloudOutlinedIcon from '@mui/icons-material/CloudOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { useAuth } from '../../lib/use-auth';
import { getSupabase } from '../../lib/supabase';
import { navigate } from '../../router';

export function AccountTab() {
  const auth = useAuth();
  const sb = getSupabase();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (!sb || signingOut) return;
    setSigningOut(true);
    try {
      await sb.auth.signOut({ scope: 'local' });
    } catch (e) {
      console.warn('sign-out failed:', e);
    } finally {
      navigate('/sign-in');
      setSigningOut(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
          <CloudOutlinedIcon sx={{ color: 'success.main', fontSize: 28 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>{auth.user?.email ?? 'Signed in'}</Typography>
            <Typography variant="caption" color="text.secondary">
              Synced across your devices
            </Typography>
          </Box>
          <Button variant="text" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </Box>
      </ElevatedCard>

      <ElevatedCard>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2.5 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontWeight: 500 }}>Password</Typography>
            <Typography variant="caption" color="text.secondary">
              Coming soon
            </Typography>
          </Box>
          <Button variant="text" disabled>Change password</Button>
        </Box>
      </ElevatedCard>
    </Box>
  );
}
```

- [ ] **Step 2: Create `views/settings/SourcesTab.tsx`**

```tsx
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import AddIcon from '@mui/icons-material/Add';
import LibraryAddOutlinedIcon from '@mui/icons-material/LibraryAddOutlined';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SectionHeading } from '../../components/SectionHeading';
import { SourceCard } from '../../components/SourceCard';
import { EmptyState } from '../../components/EmptyState';
import { navigate } from '../../router';
import { getSources, removeSource, renameSource, SOURCES_EVENT } from '../../storage';
import type { StoredSource } from '../../storage';

export function SourcesTab() {
  const [sources, setLocalSources] = useState<Record<string, StoredSource>>(getSources());

  useEffect(() => {
    const onChange = () => setLocalSources(getSources());
    window.addEventListener(SOURCES_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(SOURCES_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);

  function unpair(key: string) {
    removeSource(key);
    setLocalSources({ ...getSources() });
  }

  function rename(key: string, newLabel: string) {
    renameSource(key, newLabel);
    setLocalSources({ ...getSources() });
  }

  const entries = Object.entries(sources);

  return (
    <Box>
      <SectionHeading
        title="Sources"
        action={
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/settings/pair')}
          >
            Pair new source
          </Button>
        }
        sx={{ mt: 0, mb: 2, px: 0 }}
      />
      {entries.length === 0 ? (
        <EmptyState
          icon={<LibraryAddOutlinedIcon />}
          title="No sources paired yet"
          body="Pair a Plex or Flixify source to start streaming."
          actionLabel="Pair your first source"
          onAction={() => navigate('/settings/pair')}
        />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {entries.map(([key, src]) => (
            <ElevatedCard key={key}>
              <SourceCard
                srcKey={key}
                label={src.label}
                type={src.type}
                baseUrl={src.baseUrl}
                onUnpair={() => unpair(key)}
                onRename={(newLabel) => rename(key, newLabel)}
              />
            </ElevatedCard>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: Create `views/settings/PlaybackTab.tsx`**

```tsx
import { useState } from 'react';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { getPrefs, setPrefs } from '../../storage';
import type { Prefs } from '../../storage';

export function PlaybackTab() {
  const [prefs, setLocalPrefs] = useState<Prefs>(getPrefs());

  function update<K extends keyof Prefs>(key: K, value: Prefs[K]) {
    const next: Prefs = { ...prefs, [key]: value };
    setLocalPrefs(next);
    setPrefs(next);
  }

  return (
    <ElevatedCard>
      <SettingRow
        label="Autoplay next episode"
        control={
          <Switch
            checked={prefs.autoplayNext}
            onChange={(e) => update('autoplayNext', e.target.checked)}
          />
        }
      />
      <SettingRow
        label="Skip intro automatically"
        control={
          <Switch
            checked={prefs.skipIntro}
            onChange={(e) => update('skipIntro', e.target.checked)}
          />
        }
      />
      <SettingRow
        label="Default subtitle language"
        control={
          <TextField
            select
            size="small"
            value={prefs.defaultSubLang}
            onChange={(e) => update('defaultSubLang', e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">None</MenuItem>
            <MenuItem value="eng">English</MenuItem>
            <MenuItem value="spa">Spanish</MenuItem>
            <MenuItem value="fre">French</MenuItem>
            <MenuItem value="deu">German</MenuItem>
          </TextField>
        }
      />
      <SettingRow
        label="Default audio language"
        divider={false}
        control={
          <TextField
            select
            size="small"
            value={prefs.defaultAudioLang}
            onChange={(e) => update('defaultAudioLang', e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">Original</MenuItem>
            <MenuItem value="eng">English</MenuItem>
            <MenuItem value="spa">Spanish</MenuItem>
            <MenuItem value="fre">French</MenuItem>
            <MenuItem value="deu">German</MenuItem>
          </TextField>
        }
      />
    </ElevatedCard>
  );
}
```

- [ ] **Step 4: Create `views/settings/AboutTab.tsx`**

```tsx
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ElevatedCard } from '../../components/ElevatedCard';
import { SettingRow } from '../../components/SettingRow';
import { useAuth } from '../../lib/use-auth';
import { isSupabaseConfigured } from '../../lib/supabase';

export function AboutTab() {
  const auth = useAuth();
  const [diagOpen, setDiagOpen] = useState(false);
  const buildSha = import.meta.env.VITE_BUILD_SHA ?? 'dev';
  const cloudConnected = isSupabaseConfigured() && !!auth.user;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <ElevatedCard>
        <SettingRow label="Version" control={<Typography color="text.secondary">v1.2.0 · build {buildSha}</Typography>} />
        <SettingRow label="Player engine" control={<Typography color="text.secondary">canvas / WebCodecs</Typography>} />
        <SettingRow
          label="Cloud sync"
          divider={false}
          control={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: cloudConnected ? 'success.main' : 'error.main',
                }}
              />
              <Typography color="text.secondary">{cloudConnected ? 'Connected' : 'Not configured'}</Typography>
            </Box>
          }
        />
      </ElevatedCard>

      <Accordion
        expanded={diagOpen}
        onChange={(_, expanded) => setDiagOpen(expanded)}
        sx={{
          backgroundColor: 'transparent',
          backgroundImage: 'none',
          boxShadow: 'none',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 1,
          '&::before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="body2" color="text.secondary">Diagnostics</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box
            component="pre"
            sx={{
              m: 0, p: 1.5,
              fontFamily: 'monospace', fontSize: 12,
              backgroundColor: 'rgba(0,0,0,0.3)',
              borderRadius: 1,
              overflow: 'auto',
              color: 'text.secondary',
            }}
          >
{JSON.stringify(
  {
    BUILD_SHA: import.meta.env.VITE_BUILD_SHA ?? 'dev',
    CANVAS_API: import.meta.env.VITE_CANVAS_API ?? 'unset',
    SUPABASE_CONFIGURED: isSupabaseConfigured(),
    USER_ID: auth.user?.id ?? null,
  },
  null,
  2,
)}
          </Box>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
```

- [ ] **Step 5: Rewrite `views/Settings.tsx` as the tab shell**

Replace the entire file with:

```tsx
import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { useTheme } from '@mui/material/styles';
import { AppShell } from '../components/AppShell';
import { AccountTab } from './settings/AccountTab';
import { SourcesTab } from './settings/SourcesTab';
import { PlaybackTab } from './settings/PlaybackTab';
import { AboutTab } from './settings/AboutTab';

type TabId = 'account' | 'sources' | 'playback' | 'about';

export function Settings() {
  const theme = useTheme();
  const [tab, setTab] = useState<TabId>('account');

  return (
    <AppShell>
      <Box
        sx={{
          minHeight: '100vh',
          backgroundImage: theme.canvasAmbient,
        }}
      >
        <Box sx={{ px: 2.5, pt: 2.5, pb: 1, maxWidth: 760, mx: 'auto' }}>
          <Typography variant="h1" sx={{ mb: 3 }}>Settings</Typography>
          <Tabs
            value={tab}
            onChange={(_, v) => setTab(v as TabId)}
            sx={{
              borderBottom: '1px solid',
              borderColor: 'divider',
              minHeight: 52,
              '& .MuiTab-root': {
                minHeight: 52,
                px: 2,
                fontWeight: 500,
                textTransform: 'none',
                fontSize: 15,
              },
              '& .MuiTabs-indicator': {
                height: 2,
                backgroundColor: 'primary.main',
              },
            }}
          >
            <Tab label="Account" value="account" />
            <Tab label="Sources" value="sources" />
            <Tab label="Playback" value="playback" />
            <Tab label="About" value="about" />
          </Tabs>
        </Box>
        <Box sx={{ px: 2.5, pt: 3, pb: 6, maxWidth: 760, mx: 'auto' }}>
          {tab === 'account' && <AccountTab />}
          {tab === 'sources' && <SourcesTab />}
          {tab === 'playback' && <PlaybackTab />}
          {tab === 'about' && <AboutTab />}
        </Box>
      </Box>
    </AppShell>
  );
}
```

- [ ] **Step 6: Build and visual-check**

```bash
cd C:/github/passenger/web && npm run build
cd C:/github/passenger/web && npm run dev
```

Navigate to `/settings`:
- Page title "Settings" (h1, 40px)
- Tabs: Account | Sources | Playback | About, primary-blue 2px indicator
- Account tab opens by default — Account card (email + Sign out) + Password card (disabled "Change password")
- Switch to Sources — heading "Sources" with "Pair new source" button on the right, source list below in elevated cards; empty state when no sources
- Switch to Playback — single elevated card with 4 rows (autoplay, skip intro, sub lang, audio lang); switches toggle, dropdowns work, dividers render between rows
- Switch to About — version + engine + cloud sync status; click Diagnostics → JSON dump of build env
- Click Pair new source → `/settings/pair` still works
- Sign out (Account tab) → redirects to /sign-in cleanly
- Breadcrumbs in the top bar show `Home › Settings`

- [ ] **Step 7: Commit**

```bash
git add web/src/views/Settings.tsx web/src/views/settings/AccountTab.tsx web/src/views/settings/SourcesTab.tsx web/src/views/settings/PlaybackTab.tsx web/src/views/settings/AboutTab.tsx
git commit -m "ui-overhaul/settings: tabbed structure (Account / Sources / Playback / About)

Settings.tsx becomes a 60-line tab shell; each tab is its own file
under views/settings/. Local state for active tab (no URL persistence).
ElevatedCard wraps each card; SettingRow handles the Playback + About
rows. AboutTab adds a cloud-sync status indicator and a collapsed
Diagnostics accordion for build env vars."
```

---

## Task 10: Verification, preview deploy, real-device check

**Files:** none

- [ ] **Step 1: Confirm no `backdrop-filter` in the codebase**

```bash
grep -rn "backdrop-filter\|backdropFilter" C:/github/passenger/web/src C:/github/passenger/web/index.html
```

Expected output: empty. If anything appears, treat as a Tesla-perf regression — fix and amend the relevant task's commit (or add a fix commit).

- [ ] **Step 2: Build size budget check**

```bash
cd C:/github/passenger/web && npm run build 2>&1 | grep "index-.*\.js"
```

Expected: bundle size within +30 KB minified of the pre-overhaul baseline (~955 KB / 274 KB gzip → ceiling ~985 KB / 282 KB gzip). If exceeded, investigate the largest new addition before merging.

- [ ] **Step 3: Deploy a preview from this branch**

```bash
cd C:/github/passenger/web && npx wrangler pages deploy dist --project-name canvas --branch ui-overhaul --commit-dirty
```

Expected output: `Deployment alias URL: https://ui-overhaul.canvas-8j0.pages.dev`. (Alias line confirms it's a preview, not prod.)

- [ ] **Step 4: Tesla verification — open the preview URL in the car**

On a real Tesla, navigate to `https://ui-overhaul.canvas-8j0.pages.dev`. Verify:

- Sign-in page renders the `<canvas>` wordmark with blue brackets
- After sign-in, Home loads with a real hero (>50% viewport height)
- Top bar starts transparent over the hero, transitions to solid on scroll — no jank, no white flash
- Rail swipe with finger snaps cleanly to card boundaries; no L/R buttons visible
- Tap a rail card — scales briefly then navigates
- Open Settings — 4 tabs switch instantly; Playback switches feel responsive; About shows "Cloud sync · Connected"
- Sign out → returns to `<canvas>` sign-in page

If any of the above lags noticeably (rail scroll stutters, tab switch hesitates, scale animations chop), grep the relevant component for transitions on properties other than `transform`/`opacity` or new uses of `box-shadow` on hot paths.

- [ ] **Step 5: Investigate hero backdrop load time on Tesla (conditional)**

If the Tesla check in Step 4 shows the hero backdrop taking noticeably long to paint (a clear "no image then image" pop after Home renders), the Plex/Flixify backdrop is too large. Verify with DevTools Network panel on desktop:

```bash
# Inspect the rendered hero element; copy its background-image URL
# In the browser console on https://ui-overhaul.canvas-8j0.pages.dev/:
document.querySelector('[data-testid="hero"], [style*="background-image"]')?.style.backgroundImage
```

If the URL points to the worker (`canvas-api.passenger-api.workers.dev/plex/...`) and the returned image is >1920px wide, patch the worker route to append `&maxWidth=1920` to the upstream Plex/Flixify request. This is a one-line change in `worker/src/routes/<adapter>.ts` for whichever adapter is serving the backdrop. Verify by re-deploying the worker (`cd worker && npx wrangler deploy`) and reloading the preview.

If the URL points directly at Plex/Flixify (no worker proxy), the fix is to add `?X-Plex-Image-Width=1920` (Plex) or equivalent at the URL construction site in the worker. Document the change in this task's commit message.

- [ ] **Step 6: Push the branch**

```bash
cd C:/github/passenger && git push origin ui-overhaul
```

- [ ] **Step 7: Hand off for merge decision**

Report to the user:
- Commits in the branch (`git log main..HEAD --oneline`)
- Preview URL
- Tesla verification result (passed / issues found)
- Bundle size delta
- Suggest merge to `main` + tag `v1.3.0` (minor — additive visual overhaul, no breaking behavior)
