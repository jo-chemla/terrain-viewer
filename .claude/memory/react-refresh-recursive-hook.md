---
name: react-refresh-recursive-hook
description: A custom hook that calls itself breaks Vite Fast Refresh at load (Maximum call stack size exceeded in @react-refresh computeFullKey); split it into a leaf hook and a wrapper
type: project
---

# Fast Refresh and self-calling hooks (fixed 2026-10-07)

`useClientDemUpstream` (components/LayersAndSources/MapSources.tsx) used to
call itself for the two operands of a "dem-diff" source. react-refresh's
`computeFullKey` walks each hook's custom-hook list recursively and has no
cycle guard, so a hook listing itself recursed until "Maximum call stack
size exceeded" / "Invalid string length" at every dev load (production was
unaffected). Found by patching `/@react-refresh` in Playwright to log the
ownKey chain at depth 400, then grepping the transformed modules served by
Vite for that hash (.cache/pw/round113.mjs, .cache/findhash.mjs).

**Why:** the overflow was blamed on plugin-react 5 / Vite 7 for days; the
cause was ours.
**How to apply:** never let a hook call itself, even behind a flag. Split
it: a leaf hook takes the nested results as values, a wrapper calls the leaf
N times (`useClientDemUpstreamOne` + `useClientDemUpstream`). If the
error returns, rerun the two scripts above to name the hook.
