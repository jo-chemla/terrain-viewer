# theme-editor

A live, draggable Tailwind v4 / shadcn theme-token editor. Full parity with
[tweakcn](https://tweakcn.com)'s own variable set (base colors, chart colors,
sidebar colors, radius, spacing, letter-spacing, typography, shadow), edited
live via inline CSS custom-property overrides — no rebuild, no CSS-in-JS.

## Requirements

- React 18+ (the only real peer dependency).
- A page that already themes itself via shadcn-style CSS custom properties
  (`--background`, `--foreground`, `--primary`, …) on `<html>` or another
  element, switched by an attribute (defaults to `data-theme`, override via
  the `themeAttribute` option if your app uses e.g. a `.dark` class instead —
  see "Targeting a class-based theme" below).
- Nothing else. No Tailwind, no shadcn/ui components, no color library
  (OKLCH↔hex conversion is hand-rolled in `color-math.ts` from Björn
  Ottosson's published OKLab matrices) — the whole folder is dependency-free
  aside from React, which is the point: copy this folder into any SPA.

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

## API

```ts
import { ThemeEditorPanel, useThemeEditor, TOKEN_GROUPS } from "./theme-editor"
```

- `<ThemeEditorPanel onClose={...} target={el} themeAttribute="data-theme" defaultPosition={{x,y}} />`
  — the whole UI. `target`/`themeAttribute` are optional (default to `<html>`
  / `"data-theme"`).
- `useThemeEditor({ target?, themeAttribute? })` — the engine without the UI,
  if you want to build your own panel: returns `{ values, setValue,
  themeName, setThemeName, reset, copyCss, buildCss }`.
- `TOKEN_GROUPS` — the full token schema (grouped `{ id, title, tokens }[]`)
  if you want to render your own custom layout.
- `deriveShadowTiers(base)`, `hexToOklch`/`oklchToHex`/`parseColorToOklch`/
  `formatOklch` — the standalone color/shadow math, usable independently.

## Targeting a class-based theme instead of an attribute

If your app toggles dark mode via a `.dark` class rather than an attribute
(e.g. plain shadcn without a multi-preset system), point `themeAttribute` at
`"class"` — `target.getAttribute("class")` still works as a change signal for
the `MutationObserver`, it just won't be a meaningful "preset name" for the
Copy CSS header (rename it yourself before pasting).
