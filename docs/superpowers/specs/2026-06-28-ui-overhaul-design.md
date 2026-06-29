# canvas UI overhaul — Apple TV / tvOS feel for Tesla browser

**Status:** Approved 2026-06-28
**Driver:** David — "the look of the main page/nav and the settings page isn't great"
**Out of scope:** Library view, ItemDetail view, Player, SignIn (all judged "mostly fine" or recently redesigned)

## Goal

Move canvas off "vanilla MUI dark app" and into a deliberate Apple TV / tvOS-inspired visual language, tuned for the Tesla MCU3 browser as the primary surface. The overhaul touches three surfaces — AppShell (the chrome on every screen), Home (the landing page), and Settings — plus the shared building blocks they depend on.

Success looks like: opening canvas in the car feels like opening a polished streaming app, not a website. Home leads with a hero that fills the screen. Settings reads like tvOS Settings, not a config form. Nothing else gets worse along the way.

## Architecture

The overhaul is **theme + component-layer**, not structural. Routes, data fetching, state management, and the auth/sync layer all stay as they are. We change:

1. The MUI theme — new surface tier, motion tokens, ambient gradient
2. The shared chrome (`AppShell`) — hero-aware top bar
3. The Home composition — bigger hero, upgraded rails, brand-hero fallback
4. The Settings composition — tabs, per-tab files, tvOS-style setting rows
5. A handful of new shared components — `ElevatedCard`, `SettingRow`, `SectionHeading`, `Hero`, `RailNavButton`
6. One existing component cleanup — drop `backdrop-filter` from `PosterCard`

No new runtime dependencies. No backend or worker changes. No API changes.

## Tech Stack

- React 18 + MUI v6 (theme overrides + component additions only)
- Inter font (already loaded)
- Pure CSS for motion (`transition` + `transform`), no animation libraries
- Existing hash router, existing storage layer, existing Supabase integration

## Global Constraints

These bind every section below. The reviewer's attention lens.

- **No `backdrop-filter`** anywhere in new or modified code. Tesla MCU3 lags on it. Use `rgba()` alphas. Existing uses in `PosterCard` are fixed as part of this work.
- **Tesla browser is primary.** Touch is the assumed input. Desktop is "make it work" (e.g., L/R rail nav buttons), not "make it great."
- **Restrained motion budget.** Transitions: 150ms/220ms/320ms. Transforms: `translate`, `scale` only (cheap). No parallax, no blurred chrome, no per-frame JS animation.
- **Dark theme only.** No light mode required.
- **No new dependencies.** Everything composes from MUI v6 + Inter + CSS.
- **`<canvas>` wordmark** stays the brand. Brackets in primary blue (`#4f8ef7`), `canvas` in `text.primary`. Applied at every wordmark site (SignIn, AppShell, splash if visible).
- **Out of scope (do not touch):** `views/Library.tsx`, `views/ItemDetail.tsx`, `views/Player.tsx`, `views/SignIn.tsx`, `components/NowPlayingStrip.tsx`, the worker, the API contract.

## Section 1 — Visual language & design tokens (`theme.ts`)

Three new pieces of vocabulary land in `web/src/theme.ts`.

### Surfaces (three tiers)
- `background.default` stays `#0e0f12` (page floor)
- `background.paper` lifts: `#181a1f` → `#1c1f25`
- New: `palette.surface.elevated` = `#22252d`; consumed by `ElevatedCard`. Border `rgba(255,255,255,0.08)`. Shadow `0 16px 40px rgba(0,0,0,0.45)`. Radius 16px.

### Ambient gradient
Applied to the main scroll container (below the AppShell top bar, above the now-playing strip):

```css
background-image:
  radial-gradient(ellipse 80% 50% at 20% 0%, rgba(79, 142, 247, 0.06), transparent 60%);
```

Identical technique to SignIn, opacity dialed down 50% so it's atmosphere, not a feature.

### Motion tokens
Exposed as `theme.canvasMotion`:
- `fast: '150ms'` — button press, switch toggle, tab indicator
- `med: '220ms'` — card hover/focus, scale-up, hero crossfade-in
- `slow: '320ms'` — page transitions (`Fade` already uses 250ms — bump to 320 to match)
- `easing: 'cubic-bezier(0.2, 0, 0, 1)'` — tvOS-ish ease-out-quint

### Interaction states (theme overrides)
- `MuiCardActionArea` hover: `transform: scale(1.03)`, transition `motion.med`. Active: `scale(0.97)`, transition `motion.fast`. Replace the existing `translateY(-2px)` hover.
- `MuiButton` press: `transform: scale(0.97)` on `:active`, transition `motion.fast`.
- Focus visible (already a thing): keep the 2px outline at primary, offset 4.

### Typography
No font change. One scale tweak: h2 goes from `32/600` to `28/600` (used as section headings on Home and Settings page title), so it's clearly subordinate to the hero title (which uses a custom 56/600 directly in `Hero.tsx`, not h1, since h1 is overloaded elsewhere).

## Section 2 — AppShell / nav (`components/AppShell.tsx`)

### Hero-aware transparency
`AppShell` accepts an optional `heroHeight?: number` prop. Internal state:

```tsx
const [pastHero, setPastHero] = useState(false);
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
  return () => { window.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
}, [heroHeight]);
```

The `AppBar`'s `backgroundColor` interpolates between `rgba(14,15,18,0)` (transparent) and `rgba(14,15,18,0.92)` (solid) over `motion.med`. Bottom border: 1px `divider`, opacity-keyed off `pastHero`. The `RouteBreadcrumbs` row, when present, animates in the same direction.

Pages without a hero (Settings, Library, ItemDetail, Pair, PhonePair) omit `heroHeight` and get the solid bar from first paint.

### Bigger touch targets
- `IconButton`s in the toolbar: 40 → 48 (custom `sx`, MUI's default `size="large"` is 40 visual)
- `Toolbar` horizontal padding: 8 → 16
- `Toolbar` `minHeight` stays 56

### Wordmark
Renderer becomes:
```tsx
<Box component="span" sx={{ color: 'primary.main' }}>&lt;</Box>
<Box component="span">canvas</Box>
<Box component="span" sx={{ color: 'primary.main' }}>&gt;</Box>
```
Wrapped in the existing Typography link. Same site at SignIn (font-size 40, letter-spacing 4) and splash (index.html — splash gets inline CSS to color the brackets via spans).

### Breadcrumbs
Fold `RouteBreadcrumbs` into the toolbar's right side when present, instead of below the toolbar. One row of chrome instead of two. The breadcrumb chevrons use `text.secondary` (already do) and gain a slim style (font-weight 400, letter-spacing 0).

## Section 3 — Home (`views/Home.tsx`)

### The Hero (`Hero` component)
- Full-bleed (no horizontal margin, `mx: 0`)
- Height: `min(55vh, 720px)`, `min-height: 360px`
- Backdrop image: `object-fit: cover`, `object-position: center`. Lazy-loaded only if below the fold (it's never below the fold on Home, so eager-load with `fetchpriority="high"`).
- Three composited overlays (all pure `linear-gradient`, no blur):
  - Left-to-right: `rgba(14,15,18,0.95)` → `rgba(14,15,18,0.7)` at 40% → `rgba(14,15,18,0.2)` at 70% → transparent at 100%
  - Bottom 80px: vertical fade to `background.default` so the hero blends into the rails below
  - Top 80px: vertical fade `rgba(14,15,18,0.6)` → transparent so the (transparent) AppShell stays legible
- Content block left-aligned, vertically centered, `max-width: 560px`, `padding-left: 48px`:
  - `eyebrow` (caption-cased label, e.g. "Continue Watching", `text.secondary`, letter-spacing 1)
  - Title: 56px, 600, line-height 1.05
  - Meta row: year · runtime · rating chip (each as inline span, separator `·`, `text.secondary`)
  - Two `Button`s: primary `Resume Xm:Xs` / `Play` + text `Start over` (only when `viewOffsetSec > 60`)
- Hero passes its rendered height to AppShell via `useEffect` measuring its node, so the transparency math is correct regardless of viewport.

### Hero source fallback ladder
1. First Continue Watching item with a backdrop
2. First Recently Added item with a backdrop
3. **Brand hero**: no `backdropUrl`. Renders `<canvas>` wordmark + "Pair a source to start" microcopy + primary CTA `Pair a source` → `/settings/pair`. Same `Hero` component, no special-case fork in Home.

### Rails (existing `Rail` component, upgraded)
- Default `cardWidth`: 180 → 220
- `gap`: 1.5 → 2.5
- Section headings already use `Typography variant="h3"`; switch to the new `SectionHeading` shared component (h2 sized, action slot unused on Home but available)
- `scroll-snap` already present; keep.
- Wrap the scroller in a `Box` with `position: relative`. Render two `RailNavButton` overlays (left/right) inside that container.

### `RailNavButton`
- Circular 40px button, `position: absolute`, vertically centered against the card row
- Visible only when `useMediaQuery('(hover: hover) and (pointer: fine)')` is true (desktop + mouse)
- Disabled state when at scroll boundary; entirely hidden when the rail doesn't overflow
- On click: `scrollBy({ left: ±(cardWidth + gap) × 3, behavior: 'smooth' })`
- Subtle background `rgba(14,15,18,0.85)`, border `rgba(255,255,255,0.1)`, scales 1.05 on hover

### `PosterCard` cleanup
- Drop `backdropFilter: 'blur(4px)'` from CC badge and rating badge (lines 98, 120)
- Replace background with `rgba(0,0,0,0.78)` (opaque enough that the underlying poster doesn't bleed through; cheaper than blur)
- Bump default `width` from 180 to 220 to match new `Rail` default
- Otherwise unchanged (poster art, source badge, episode subtitle logic all stay)

### Sources & libraries grids
- Grid `auto-fill, 220px` → `auto-fill, 240px` to align with the new card width (poster card is 220, source/library cards have title + meta below — wider cell breathes better)
- Gap 2.5 → 3
- `SourcePickerCard` and `LibraryCard` swap their `Card` wrapper for `ElevatedCard variant="interactive"` (the existing custom shadow/border code can be removed; theme does it)

### Page background
Apply the ambient gradient to the `Box` directly inside `AppShell` (below the hero, which is full-bleed and paints its own art).

## Section 4 — Settings (`views/Settings.tsx`)

### Tab shell (`Settings.tsx`)
```
[<canvas> ………………………………… search settings]   AppShell, solid bar
[Settings]                                       h1 page title (40px)
[Account | Sources | Playback | About]           MUI Tabs
─────────────────────────────────────
[<TabContent />]
```

- `Tabs` uses MUI's `value`/`onChange` with local `useState<'account'|'sources'|'playback'|'about'>('account')` — no URL persistence
- Tab buttons: `minHeight: 52`, `px: 2`, `textTransform: 'none'`, `fontWeight: 500`. Indicator: 2px, primary.
- Tab content area: `maxWidth: 760, mx: 'auto'` so it doesn't sprawl on Tesla landscape

### Tab files
Each tab is `<100 lines`, self-contained:
- `views/settings/AccountTab.tsx`
- `views/settings/SourcesTab.tsx`
- `views/settings/PlaybackTab.tsx`
- `views/settings/AboutTab.tsx`

### `AccountTab`
- One `ElevatedCard variant="static"`. Inside:
  - Row 1: `CloudOutlinedIcon` (success.main) + email (font-weight 500) + caption "Synced across your devices" + `Sign out` button (existing logic, existing `signingOut` state)
- Second `ElevatedCard`: heading "Password" + `Change password` button (disabled with caption "Coming soon" until the password-reset flow lands — present so the slot is reserved, not a TODO comment)

### `SourcesTab`
- `SectionHeading` `title="Sources"` with action `<Button>Pair new source</Button>` on the right (navigates to `/settings/pair`)
- Empty state when no sources: centered `EmptyState` reusing the existing component, big CTA
- Otherwise: vertical list of `SourceCard`s (each wrapped in `ElevatedCard` so the new surface treatment applies). Existing unpair/rename behavior unchanged.

### `PlaybackTab`
- One `ElevatedCard variant="static"`. Inside, four `SettingRow`s with dividers between (none after the last):
  - "Autoplay next episode" → `Switch`
  - "Skip intro automatically" → `Switch`
  - "Default subtitle language" → `Select` (existing options)
  - "Default audio language" → `Select` (existing options)
- All four bind to the existing `Prefs` shape — no schema change.

### `AboutTab`
- One `ElevatedCard variant="static"`. Inside, three `SettingRow`s:
  - "Version" → text `v1.2.0 · build {VITE_BUILD_SHA}`
  - "Player engine" → text `canvas / WebCodecs`
  - "Cloud sync" → status indicator (green dot + "Connected" when `isSupabaseConfigured()` and `auth.user` is set; red dot + "Not configured" otherwise)
- Below the card, an optional `Accordion` "Diagnostics" → raw `import.meta.env` build vars table, collapsed by default. Useful for Tesla debugging without making it noisy.

### `SettingRow` shape
```tsx
interface SettingRowProps {
  label: string;
  secondary?: string;        // small caption under label
  control?: ReactNode;       // right side (Switch, Select, Button, text…)
  divider?: boolean;         // default true; set false on the last row
}
```
- Layout: `display: flex`, label on left (column with optional secondary), control on the right
- Padding `py: 2.25`, `px: 2.5`
- Divider: `borderBottom: 1px solid rgba(255,255,255,0.06)`
- Touch target: minimum 56px row height

## Section 5 — Shared components

| Component | File | Purpose | Used by |
|---|---|---|---|
| `ElevatedCard` | `components/ElevatedCard.tsx` | tvOS-style elevated surface (static or interactive variant) | Settings tabs, SourcePickerCard, LibraryCard |
| `SettingRow` | `components/SettingRow.tsx` | Label + control row with divider | PlaybackTab, AboutTab |
| `SectionHeading` | `components/SectionHeading.tsx` | h2 + optional right-side action | Home rails, SourcesTab |
| `Hero` | `components/Hero.tsx` | Full-bleed hero with gradient overlays + content slot | Home |
| `RailNavButton` | `components/RailNavButton.tsx` | Desktop-only L/R rail nav | Rail (internal use) |

### Component interfaces

```tsx
// ElevatedCard
interface ElevatedCardProps {
  children: ReactNode;
  variant?: 'static' | 'interactive';     // default 'static'
  onClick?: () => void;                   // only meaningful when interactive
  sx?: SxProps;
}

// SectionHeading
interface SectionHeadingProps {
  title: string;
  action?: ReactNode;                     // right-side slot, e.g. <Button>
  sx?: SxProps;
}

// Hero
interface HeroProps {
  backdropUrl?: string;                   // omit for brand-hero fallback
  eyebrow?: string;                       // small caption above title
  title: string;
  meta?: ReactNode;                       // year, runtime, rating chips
  primaryAction: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  onHeightChange?: (px: number) => void;  // for AppShell heroHeight prop
}

// RailNavButton (internal; Rail consumes it directly)
interface RailNavButtonProps {
  direction: 'left' | 'right';
  onClick: () => void;
  disabled: boolean;
}
```

## Section 6 — Tesla perf guardrails

Codified rules. These apply to every task in this plan and to future work.

1. **No `backdrop-filter`** in any new or modified code. Grep for `backdropFilter` and `backdrop-filter` as a pre-merge check.
2. **Cap simultaneous animations.** Only the actively-interacted-with element animates. Page-loads and rail-scrolls are not "animations" in this sense.
3. **Image sizing.** Hero backdrops must be ≤1920px wide, JPEG. Rail card images stay `loading="lazy"`. Worker may need to add a `&maxWidth=1920` parameter for Plex/Flixify backdrop URLs — flagged for the implementation plan.
4. **Throttle scroll listeners with `requestAnimationFrame`.** The AppShell hero-aware listener is the only one introduced; others may not be added without this wrapper.
5. **No blanket `will-change`.** Apply only on the actively-interacted element; remove after the transition completes.
6. **CSS containment** on rail card root: `contain: layout style`.
7. **Avoid `:has()` in new code paths.** Existing usage in `theme.ts` stays; don't expand.
8. **Tesla verification gate.** Every PR in this overhaul gets a preview deploy and a real-device check in the car before merging. Desktop DevTools is not a substitute.

## Testing

This overhaul is visual + interaction; canvas has no frontend test harness, and the changes don't touch logic worth unit-testing. Verification is:

1. **Per-task manual check** in `npm run dev`: section behaves as spec'd, no console errors, build passes.
2. **Final whole-branch check on a real Tesla:** open `https://<branch>.canvas-8j0.pages.dev` from the car, verify Home hero, scroll behavior, rail snap, tab switching, sign-in flash. Goal: no jank perceivable while interacting.
3. **Build size budget:** the existing bundle is ~955 KB / 274 KB gzip. New components are small additions; budget ceiling +30 KB minified (~+8 KB gzip). If we exceed it, investigate.

## Out of scope (explicit, do not touch)

- `views/Library.tsx`, `views/ItemDetail.tsx`, `views/Player.tsx` — "mostly fine" per David
- `views/SignIn.tsx`, `components/CloudSyncConflict.tsx` — recently redesigned
- `components/NowPlayingStrip.tsx` — works, fits the new aesthetic without changes
- `worker/` — no backend changes
- API contract, storage shape, Supabase schema — unchanged
- Password reset flow — placeholder slot reserved in AccountTab, implementation tracked separately
- Stripe / monetization — out of scope
- Side-scroll on desktop — folded INTO this work via `RailNavButton`

## Open questions

None at time of writing. Spec was iterated through brainstorming session; user explicitly approved each section.
