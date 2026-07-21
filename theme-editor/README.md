# theme-editor

A live, draggable Tailwind v4 / shadcn theme-token editor. Full parity with
[tweakcn](https://tweakcn.com)'s own variable set (base colors, chart colors,
sidebar colors, radius, spacing, letter-spacing, typography, shadow), edited
live via inline CSS custom-property overrides — no rebuild, no CSS-in-JS.

## Requirements

- React 18+ and `react-dom` (the panel is portaled to `document.body` — see
  "Why a portal" below).
- `lucide-react`, for the randomize button's dice icon — already a
  near-universal dependency in shadcn-based projects; if your app doesn't
  have it, swap that one `<Dice5 />` import in `ThemeEditorPanel.tsx` for
  anything else (emoji, your own SVG).
- A page that already themes itself via shadcn-style CSS custom properties
  (`--background`, `--foreground`, `--primary`, …) on `<html>` or another
  element, switched by an attribute (defaults to `data-theme`, override via
  the `themeAttribute` option if your app uses e.g. a `.dark` class instead —
  see "Targeting a class-based theme" below).
- Your own CSS actually needs to *read* `--font-sans`/`--font-serif`/
  `--font-mono`/`--font-heading` somewhere (e.g. `body { font-family:
  var(--font-sans); }`), the same way it presumably already reads
  `--background`/`--primary`/etc. Otherwise every font control in here will
  visibly update the CSS variable but nothing will look different — this
  bit us in the app this was built for, whose base styles set colors from
  variables but had never wired up fonts the same way.
- Nothing else. No Tailwind, no shadcn/ui components, no color library
  (OKLCH↔hex conversion is hand-rolled in `color-math.ts` from Björn
  Ottosson's published OKLab matrices) — the rest of the folder is
  dependency-free, which is the point: copy it into any SPA.

## Install

Copy the whole `theme-editor/` folder into your project (e.g. next to your
other top-level source folders) and import from it:

```tsx
import { ThemeEditorPanel } from "./theme-editor"

function App() {
  const [open, setOpen] = useState(false)
  return (
    <>
      {/* ...your app... */}
      <button onClick={() => setOpen(true)}>Edit Theme</button>
      {open && <ThemeEditorPanel onClose={() => setOpen(false)} />}
    </>
  )
}
```

That's it — no provider, no CSS import, no build config. The panel injects
its own `<style>` tag on first mount (once per page load) and styles itself
from your app's own `--background`/`--foreground`/etc. tokens (with hard
fallbacks), so it re-themes itself live as you edit.

It renders as a floating, draggable panel rather than a blocking modal —
deliberately: the whole point of live editing is seeing the effect on your
actual app content behind it, which a backdrop-blocking dialog would hide.

## How it works

1. On mount, it snapshots the CURRENT resolved value of every token (via
   `getComputedStyle`) — whatever your active preset/stylesheet currently
   provides.
2. Every edit calls `element.style.setProperty("--token", value)` — an inline
   style always wins over a stylesheet rule, so the change applies instantly
   app-wide, without touching any CSS file.
3. Editing any of the 6 base shadow tokens (`shadow-color/opacity/blur/
   spread/offset-x/offset-y`) also regenerates the 8 derived `--shadow-2xs`
   … `--shadow-2xl` box-shadow strings live, using the same tier formula
   tweakcn's own generated presets use (reverse-engineered empirically by
   comparing base params against derived output across many real presets —
   see the comment in `shadow-formula.ts`).
4. A `MutationObserver` watches the theme attribute — if something else (a
   preset picker, say) changes the active theme while the panel is open, it
   re-snapshots from the new preset instead of showing stale values.
5. "Copy CSS" serializes the current values (edited + untouched) into a
   `[data-theme="<name>"] { --token: value; ... }` block matching the exact
   shape of a normal preset file, ready to paste in as a new one. "Reset"
   removes every inline override, reverting to whatever the underlying
   stylesheet preset says.

Nothing persists automatically — this is a live scratchpad + CSS export tool,
not a theme store. Wire persistence yourself if you want it (e.g. call
`copyCss()` yourself and save the result somewhere, or watch `values` and
write to `localStorage`).

## Why a portal

The panel renders via `createPortal(..., document.body)` rather than inline
wherever you mount it. `position: fixed` is only relative to the true
viewport when NO ancestor has a `transform`/`filter`/`will-change`/`contain`
— a very ordinary thing for an animated sidebar panel to have on itself —
otherwise it silently rebases to that ancestor's box instead, which is
exactly what happened mounting this inside a slide-in settings sidebar
during development. Portaling to `<body>` sidesteps that regardless of where
you mount the trigger from.

## Closing without committing reverts your edits

Closing the panel (`onClose`) automatically calls `reset()` — every inline
`--token` override this session made gets removed, same as clicking Reset
yourself. This is deliberate: those inline overrides always outrank a
`[data-theme="…"]` stylesheet rule, including a DIFFERENT one a normal preset
picker sets afterward, so leaving them in place after closing would silently
break every other theme control in your app until something called reset()
again. If you want to keep an edit, use Copy CSS or Save (via `onSaveTheme`)
*before* closing — closing is a cancel, not an implicit commit.

## API

```ts
import { ThemeEditorPanel, useThemeEditor, TOKEN_GROUPS } from "./theme-editor"
```

- `<ThemeEditorPanel onClose={...} target={el} themeAttribute="data-theme" defaultPosition={{x,y}} onSaveTheme={...} onModeChange={...} presetGroups={...} onLoadPreset={...} />`
  — the whole UI. `target`/`themeAttribute` are optional (default to `<html>`
  / `"data-theme"`). `onSaveTheme?(name, css)` hooks up your own persistence
  for the Save button (omit to hide it). `onModeChange?(isDark)` — this
  package can't see your app's own light/dark toggle, so when Randomize
  coin-flips a mode, wire this to keep your toggle in sync; prefer setting
  an ABSOLUTE mode (`setTheme(isDark ? "dark" : "light")`) over a
  compare-and-toggle — mashing the dice button fires faster than React
  re-renders, so a toggle based on comparing against your own state can read
  it stale and drift out of sync with what was actually just randomized.
  `presetGroups?: { label, options: { value, label }[] }[]` + `onLoadPreset?
  (value)` add a "Load Preset" picker to the Basic section — this package has
  no built-in preset library, so the host app supplies its own named list;
  `onLoadPreset` should just switch your app's own active theme (e.g. flip
  whatever sets your `data-theme` attribute) — the panel's own
  `MutationObserver` on that attribute re-snapshots every token automatically,
  the same way it already reacts to any other external preset picker. Omit
  both to hide the picker.
- `useThemeEditor({ target?, themeAttribute? })` — the engine without the UI,
  if you want to build your own panel: returns `{ values, setValue,
  themeName, setThemeName, reset, copyCss, buildCss, adjust, setAdjust,
  resetAdjust, randomize, basicOptions, setBasicOption, locks, toggleLock,
  shuffleBasic }`. `randomize()` returns the `isDark` it picked. `locks:
  Record<keyof BasicOptions, boolean>` + `toggleLock(key)` mark which
  Basic-mode fields `shuffleBasic()` should leave untouched — same idea as
  ui.shadcn.com/create's per-property lock icons next to its own Shuffle
  action; `shuffleBasic()` picks a fresh random value for every unlocked
  field and applies the result the same way any other Basic-mode edit does.
- `TOKEN_GROUPS` — the full token schema (grouped `{ id, title, tokens,
  category }[]` — `category: "color"` marks the 11 groups the panel nests
  under one outer "Colors" fold; everything else renders top-level) if you
  want to render your own custom layout.
- `deriveShadowTiers(base)`, `hexToOklch`/`oklchToHex`/`parseColorToOklch`/
  `formatOklch` — the standalone color/shadow math, usable independently.
- `STYLE_PRESETS`, `BASE_COLOR_FAMILIES`, `NAMED_HUES`, `MENU_ACCENT_LEVELS`,
  `buildBasicPalette`, `buildStyleValues` — the Basic-mode data driving the
  Style/Base Color/Theme/Chart Color/Radius/Menu controls.

## Targeting a class-based theme instead of an attribute

If your app toggles dark mode via a `.dark` class rather than an attribute
(e.g. plain shadcn without a multi-preset system), point `themeAttribute` at
`"class"` — `target.getAttribute("class")` still works as a change signal for
the `MutationObserver`, it just won't be a meaningful "preset name" for the
Copy CSS header (rename it yourself before pasting).
