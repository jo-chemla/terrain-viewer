---
name: pnpm-workspace-react-types
description: Why docs/, slides/ and theme-editor/ are pnpm workspace packages while video/ and desktop/ are not, and the packageExtensions fix for the docs type check reaching the app's React 18 types
type: project
---

# pnpm workspace: docs/ inside, slides/ and video/ outside (2026-11-08)

`pnpm-workspace.yaml` lists `docs` and `slides` as workspace packages: one root
`pnpm install`, one lockfile, and `pnpm dev` (app + docs together) no longer
depends on a separate `pnpm --dir docs install`, and `pnpm slides` needs no
`slides:install` (2026-11-08). `theme-editor/` joined on 2026-11-10 as a
library package: the app depends on `"theme-editor": "workspace:*"` and
imports it by name; `exports` points at `index.ts` (source, compiled by Vite
and checked by the root `tsc`, which still includes the folder). Its peers
(react, react-dom, lucide-react) are also devDependencies pinned to the
root's ranges: with only the wide peer ranges, pnpm's peer auto-install
fetched the newest lucide-react (1.x) as a second copy next to the app's
0.454. `ux-flows/` stays an app page (second Vite input) because it imports
`components/ui/*`; it would need a shared ui package first. `video/` keeps
its own `packages: []` workspace file on purpose: it is only used when
recording, and Remotion's platform binaries would otherwise land in every
install. `desktop/` is a Hutch (Electrobun)
project with its own lockfile, not pnpm.

## The React 18 / React 19 type clash and its fix

The app is on React 18, the docs on React 19. pnpm isolates each package's
runtime deps, but TypeScript resolves `import "react"` inside a dependency's
`.d.ts` by walking up from that dependency's folder in the store, and when
the dependency does not declare `@types/react` as a peer there is nothing
next to it, so the walk ends at the root `node_modules/@types/react` (18).
The docs' type check (run by `next build`) then fails with ReactNode / ref /
TransitionStartFunction mismatches, while `pnpm dev` works fine.

Fix: `packageExtensions` in `pnpm-workspace.yaml` declares `@types/react`
and `@types/react-dom` as peers of every such dependency (next, nuqs, cmdk,
next-themes, @tanstack/react-table, @tanstack/react-store,
@floating-ui/react-dom, @fumadocs-editor/ui, @scalar/api-reference-react),
so pnpm links the docs' 19 types next to each of them. To find a new
offender after adding a docs dependency: in `docs/`,
`npx tsc --noEmit --explainFiles | grep -A6 "@types+react@18"` lists the
importing package. `typeRoots` in the docs tsconfig does not help (the
problem is import resolution, not auto-included globals), and tsconfig
`paths` for "react" would also redirect Turbopack's runtime resolution.

Also: the regenerated lockfile let `fumadocs-typescript` float to a version
needing a newer `fumadocs-core` than the pinned one; it is pinned now like
the other fumadocs packages, and `docs/next.config.mjs` sets Turbopack's root
to the repository root because the docs' node_modules are symlinks into the
root store.

**How to apply:** when a docs `next build` fails on type errors that only
mention React types, look for a new dependency reaching React 18 and add it
to `packageExtensions`; do not loosen the type check.
