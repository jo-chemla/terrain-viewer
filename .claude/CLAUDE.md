# Terrain Viewer — Agent Context

## What this is
A client-side MapLibre GL terrain visualization app (React 18 + Vite + TypeScript).
Repo: https://github.com/jo-chemla/terrain-viewer  
Live: https://jo-chemla.github.io/terrain-viewer (prod, blue favicon)  
Also deployed at: https://historical-satellite.iconem.com (Iconem, historical mode default)

Two co-located apps share this repo:
- **Main app** — Vite SPA, root. `pnpm app` → port 5173 (or 5174 in a worktree).
- **Docs** — Next.js 16 (Fumadocs), `docs/`. `pnpm docs` → port 3100, proxied at `/docs` by the Vite dev server.

## Dev servers

```bash
pnpm dev   # BOTH servers at once (concurrently; no extra args — they'd go to concurrently, not vite)
pnpm app   # app only (vite; accepts vite flags like --port)
pnpm docs  # docs only, port 3100 (proxied at /docs)
pnpm slides         # open-slide decks (slides/, own install: pnpm slides:install), port 3200 under /docs/slides/ (the app dev server proxies /docs/slides/ to it when it is up)
pnpm slides:static  # the decks as published (static, under /docs/slides/), port 4180
pnpm slides:pdf     # the static decks plus five PDFs in .cache/slides-site/ (the deploy runs this)
pnpm dev:all        # app, docs and slides together
```

```bash
# In a git worktree alongside the main checkout, every fixed port is already
# taken by the main checkout's servers — override all three (TanStack
# devtools event-bus 42169, app 5173, docs 3100; DOCS_PORT retargets
# vite.config.ts's /docs proxy):
DEVTOOLS_EVENT_BUS_PORT=42170 DOCS_PORT=3101 pnpm app --port 5174
cd docs && pnpm exec next dev -p 3101
```

The preview browser available to agents does NOT fire `requestAnimationFrame` — MapLibre never loads a style there. Do not try to verify map behavior in the agent browser; ask the user to test in a real browser. What CAN be checked there: map instances and app state exist, and in dev builds `window.__tv = { mapRefs, state, setState }` (TerrainViewer.tsx) lets `preview_evaluate` read `getMaxBounds()`, zoom limits, the transform, and drive nuqs state - used to prove the Map Bounds "None" path releases the fence.

## Environment file

`.env` (gitignored) lives in the main checkout, `C:/Dev/Iconem/terrain-viewer/.env`: the Mapbox and Planet keys the build reads (`VITE_…`) and keys for scripts and agents (`BING_WEBMASTER_API_KEY`). A worktree has none until it is copied: `cp /c/Dev/Iconem/terrain-viewer/.env .env` (Git Bash). Add new keys to the main checkout's file first, then copy.

## Tech stack

| Layer | Library |
|---|---|
| Map | maplibre-gl 5.x, react-map-gl 8 |
| State (URL) | nuqs (all shareable/bookmarkable settings) |
| State (local) | jotai + jotai/utils atomWithStorage |
| UI | Base UI (@base-ui/react), shadcn/ui on base preset, Tailwind v4 |
| Viz protocols | Custom MapLibre protocols in `lib/*-protocol.ts` |
| Docs | Next.js 16 + Fumadocs, `docs/` |

## Key files

- `components/TerrainViewer.tsx` — root component (~3000 lines). All map instances, camera sync, split/grid layout, terrain, and viz-mode protocols live here.
- `components/TerrainControlPanel/TerrainControlPanel.tsx` — sidebar shell, section routing.
- `lib/settings-atoms.ts` — all jotai atoms (API keys, beta flags, section-open state, etc.).
- `lib/grid-layouts.ts` — split/grid layout definitions (`GRID_LAYOUTS`, `rightmostViewsPerRow`, padding logic).
- `lib/layout-constants.ts` — sidebar/timeline footprint pixels, `getSidebarFootprintPx`, `splitRatioAtom`.
- `lib/terrain-types.ts` — `TerrainSource` type, hillshade method enums.
- `lib/terrain-sources.ts` — built-in DEM source configs (Mapterhorn, Mapbox, MapTiler, AWS).
- `lib/*-protocol.ts` — custom MapLibre tile protocols (slope, curvature, SVF, phong, matcap, …).

## Architecture patterns

**URL state vs local state:** Anything shareable/bookmarkable (viz modes, camera pose, app mode, split style) lives in `nuqs` (`useQueryStates` in `TerrainViewer.tsx`). Persistent-but-not-shareable settings (API keys, beta flags, collapsed sections) live in `jotai atomWithStorage`. Ephemeral UI state is plain `useState`/`useRef`.

**Beta flags:** `betaEnabledAtom` in `settings-atoms.ts` — a single `atomWithStorage` record for `{ tells, georef }`, each exposed as a `booleanField` slice. Default is `{ tells: false, georef: false }`. Since 2026-10-07 the flags are local only (no URL field): `TerrainViewer.tsx` merges them into `state` as `tellsBeta` and `georefBeta` and routes a `setState({ tellsBeta })` to the atom. The Sun Shadow Calculator and the STAC search left beta on 2026-10-06, the historical imagery sources on 2026-10-08 (always on, no flag).

**Viz protocols:** Each mode (slope, curvature, SVF, …) is a custom MapLibre `addProtocol` handler in `lib/*-protocol.ts`. The tile cache (`lib/tile-result-cache.ts`) is shared — always clone `ArrayBuffer`s before storing (MapLibre detaches them on transfer).

**Split/grid layout:** Up to 8 views (A–H), defined by `GRID_LAYOUTS` in `lib/grid-layouts.ts`. Views are absolutely positioned; switching layout never remounts a `<Map>` (keeps WebGL context/tile cache). Camera sync is handled in `handleViewMove` in `TerrainViewer.tsx`.

**react-map-gl `<Layer>` source is immutable:** `<Layer source="...">` ignores runtime `source` prop changes. Key the element to force remount when the source changes.

**UI overflow rule (selects, dialogs, sheets, popovers):** new selects, dialogs, sheets and popovers use the primitives in `components/ui/`, which already carry the overflow contract (`min-w-0` + `overflow-hidden` on the box, `truncate` on the select value with the full label as a hover title, `break-words` on titles and descriptions, a viewport-capped `max-w` on popups, `grid-cols-[minmax(0,1fr)]` on the dialog grid). Never set a fixed width on a `SelectTrigger` that holds labels longer than that width (use `flex-1 min-w-0` or `w-full`). Any flex or grid parent of a select or of a dialog title gets `min-w-0` (a grid `1fr` track is `minmax(0,1fr)`), or the min-content of a nowrap child widens it past the box. See `.claude/memory/ui-overflow-rules.md`.

**`setTerrain` is expensive:** It rebuilds `Terrain` + `RenderToTexture` and drops the RTT tile cache. Never call it in a loop or on every idle. Compare `map.terrain?.tileManager?.getSource()` (object identity) and exaggeration before re-applying.

## Camera sync — read before touching TerrainViewer.tsx

See `.claude/memory/camera-sync.md` for a full summary of the PR #10 fixes (elevation as a sixth synced camera parameter, `recalculateZoomAndCenter` settle, `_elevationFreeze` upstream wart, ground-clamping bookkeeping, drag-eaten-by-stop bug, and dead ends to avoid).

Key rule: **never issue a programmatic camera command while a pointer is held.** Use `map.transform.*` setters directly — they don't call `stop()`.

## Generated URL reference

`docs/scripts/build-url-params.mjs` scans `QUERY_STATE_PARSERS` and the `atomWithStorage` atoms and writes `docs/src/generated/url-params.json` and `docs/public/openapi.json`. Both are tracked but regenerated by hand: run `pnpm run url-params` when parameters change or before a release. No hook. The docs build regenerates them anyway, so the deployed site is always current; the deploy workflow prints a warning when the tracked copies are stale.

## Docs site

`docs/content/docs/` — MDX source. Some files are also imported `?raw` into the main app (e.g. Keyboard Shortcuts, Visualization Modes) as a single source of truth. The proxy in `vite.config.ts` handles `/docs/content/` bypass so Vite serves the raw module instead of proxying to Next.js.

## Agent memory — use `.claude/memory/`, not global

Project-wide knowledge (architecture decisions, known gotchas, fix history) belongs in **`.claude/memory/`** — it's git-tracked, shared across contributors and agents, and indexed in `.claude/memory/MEMORY.md`.

Do **not** write project architecture or gotcha notes to `~/.claude/projects/*/memory/` (the global auto-memory). That path is user-local and not shared. Reserve it for user-preference notes that apply across all of the user's projects.

When saving a project memory:
1. Write the file to `.claude/memory/<slug>.md` with the standard frontmatter (`name`, `description`, `type`).
2. Add a one-line pointer to `.claude/memory/MEMORY.md`.
3. Commit both files with the code change they document.
