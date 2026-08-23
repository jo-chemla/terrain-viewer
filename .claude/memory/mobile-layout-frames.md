---
name: mobile-layout-frames
description: Single shared bottom edge for all bottom overlays (root fixed inset-0, overlays absolute); no --vh hack; isMobile breakpoint matched to Tailwind sm (640)
type: project
---

# Mobile layout — one bottom edge, no `--vh`

**The rule:** every bottom-anchored overlay (historical timeline panel, minimap,
collapsed-timeline clock toggle, sidebar) is `position: absolute` inside
TerrainViewer's root div, which is `fixed inset-0` on ALL platforms. Do not add
new `position: fixed` bottom-anchored overlays, and do not reintroduce a
JS-measured viewport height.

**Why:** the app previously sized the root on mobile with a `--vh` custom
property (a JS copy of `window.innerHeight`, updated on resize) while the
timeline panel/minimap were `fixed bottom-0` against the layout viewport. Two
different "bottoms" that drift apart whenever mobile browser chrome animates or
the resize event lags — the panel stuck out past the visible screen and never
reliably aligned with the minimap/scalebar clearances measured in the other
frame. A fixed element's `bottom: 0` already tracks dynamic browser toolbars
natively, so `fixed inset-0` on the root + `absolute` children gives one shared
edge with zero JS.

**Related conventions (same change, Aug 2026):**
- `useIsMobile` breakpoint is **640** to match Tailwind's `sm:` — every
  mobile/desktop CSS split in the app flips at `sm:`, and the old 768 left a
  640–767px band where JS layout math (sidebar footprint, timeline right
  offset) disagreed with what CSS rendered.
- The timeline panel on mobile: title hidden, pills in one horizontally
  scrollable `flex-nowrap` line (each pill `shrink-0`), `max-h-[65dvh]`
  backstop, `pb-[env(safe-area-inset-bottom)]` (enabled by
  `viewport-fit=cover` in index.html's viewport meta).
- Minimap/scale clearance above the panel stays driven by the measured
  panel height ([[camera-sync]] is unrelated; see
  `historicalTimelinePanelHeightAtom` in lib/layout-constants.ts).
