# Terrain Viewer — Agent Context

## What this is
A client-side MapLibre GL terrain visualization app (React 18 + Vite + TypeScript).
Repo: https://github.com/jo-chemla/terrain-viewer  
Live: https://jo-chemla.github.io/terrain-viewer (prod, blue favicon)  
Also deployed at: https://historical-satellite.iconem.com (Iconem, historical mode default)

Two co-located apps share this repo:
- **Main app** — Vite SPA, root. `pnpm dev:app` → port 5173 (or 5174 in a worktree).
- **Docs** — Next.js 16 (Fumadocs), `docs/`. `pnpm run docs:dev` → port 3100, proxied at `/docs` by the Vite dev server.

## Dev servers

```bash
pnpm dev            # BOTH servers at once (concurrently; no extra args — they'd go to concurrently, not vite)
pnpm dev:app        # app only (vite; accepts vite flags like --port)
pnpm run docs:dev   # docs only, port 3100 (proxied at /docs)
```

```bash
# In a git worktree alongside the main checkout, every fixed port is already
# taken by the main checkout's servers — override all three (TanStack
# devtools event-bus 42169, app 5173, docs 3100; DOCS_PORT retargets
# vite.config.ts's /docs proxy):
DEVTOOLS_EVENT_BUS_PORT=42170 DOCS_PORT=3101 pnpm dev:app --port 5174
cd docs && pnpm exec next dev -p 3101
```

The preview browser available to agents does NOT fire `requestAnimationFrame` — MapLibre never loads a style there. Do not try to verify map behavior in the agent browser; ask the user to test in a real browser.

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

**Beta flags:** `betaEnabledAtom` in `settings-atoms.ts` — a single `atomWithStorage` record for `{ tells, sunShadow, historical }`, each exposed as a `booleanField` slice. Default is now `{ tells: false, sunShadow: true, historical: true }`. The corresponding nuqs field (`tellsBeta`, `sunShadowBeta`, `historicalBeta`) is what the app actually reads; the atom mirrors it across sessions without a URL param.

**Viz protocols:** Each mode (slope, curvature, SVF, …) is a custom MapLibre `addProtocol` handler in `lib/*-protocol.ts`. The tile cache (`lib/tile-result-cache.ts`) is shared — always clone `ArrayBuffer`s before storing (MapLibre detaches them on transfer).

**Split/grid layout:** Up to 8 views (A–H), defined by `GRID_LAYOUTS` in `lib/grid-layouts.ts`. Views are absolutely positioned; switching layout never remounts a `<Map>` (keeps WebGL context/tile cache). Camera sync is handled in `handleViewMove` in `TerrainViewer.tsx`.

**react-map-gl `<Layer>` source is immutable:** `<Layer source="...">` ignores runtime `source` prop changes. Key the element to force remount when the source changes.

**`setTerrain` is expensive:** It rebuilds `Terrain` + `RenderToTexture` and drops the RTT tile cache. Never call it in a loop or on every idle. Compare `map.terrain?.tileManager?.getSource()` (object identity) and exaggeration before re-applying.

## Camera sync — read before touching TerrainViewer.tsx

See `.claude/memory/camera-sync.md` for a full summary of the PR #10 fixes (elevation as a sixth synced camera parameter, `recalculateZoomAndCenter` settle, `_elevationFreeze` upstream wart, ground-clamping bookkeeping, drag-eaten-by-stop bug, and dead ends to avoid).

Key rule: **never issue a programmatic camera command while a pointer is held.** Use `map.transform.*` setters directly — they don't call `stop()`.

## Docs site

`docs/content/docs/` — MDX source. Some files are also imported `?raw` into the main app (e.g. Keyboard Shortcuts, Visualization Modes) as a single source of truth. The proxy in `vite.config.ts` handles `/docs/content/` bypass so Vite serves the raw module instead of proxying to Next.js.

## Agent memory — use `.claude/memory/`, not global

Project-wide knowledge (architecture decisions, known gotchas, fix history) belongs in **`.claude/memory/`** — it's git-tracked, shared across contributors and agents, and indexed in `.claude/memory/MEMORY.md`.

Do **not** write project architecture or gotcha notes to `~/.claude/projects/*/memory/` (the global auto-memory). That path is user-local and not shared. Reserve it for user-preference notes that apply across all of the user's projects.

When saving a project memory:
1. Write the file to `.claude/memory/<slug>.md` with the standard frontmatter (`name`, `description`, `type`).
2. Add a one-line pointer to `.claude/memory/MEMORY.md`.
3. Commit both files with the code change they document.
