---
name: push-both-remotes
description: Pushes to main go to both remotes, origin (jo-chemla, historical-satellite) and iconem (Iconem fork, terrain-viewer.iconem.com), in the same step
type: feedback
---

Since 2026-11-10, every push of main goes to both remotes: `origin`
(jo-chemla/terrain-viewer, deploys historical-satellite.iconem.com) and
`iconem` (Iconem/terrain-viewer, deploys terrain-viewer.iconem.com):
`git push origin main && git push iconem main:main`. The fork is a plain
mirror of main (0 ahead), so the push is always a fast-forward.

**Why:** the fork used to lag behind by weeks and the two sites drifted; the
React 19 and theme-editor packaging went to jo-chemla first on purpose (a
production test on one site), and once that passed the user asked for both
to move together.

**How to apply:** the `iconem` remote may be missing on a fresh clone:
`git remote add iconem https://github.com/Iconem/terrain-viewer.git`. A
change the user wants tested on one site first is the exception, and they
say so.
